import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

export const PERIODS = ["1G", "1M", "6M", "1A", "Inizio"];

// Calcola la data di riferimento per ogni periodo
// usando setMonth/setFullYear per essere precisi come Yahoo/TradingView
function getPeriodCutoff(period) {
  const d = new Date();
  if (period === "1M") { d.setMonth(d.getMonth() - 1); }
  else if (period === "6M") { d.setMonth(d.getMonth() - 6); }
  else if (period === "1A") { d.setFullYear(d.getFullYear() - 1); }
  return d.toISOString().slice(0, 10);
}

export function useChart(stocks, eurRate) {
  const [rawData, setRawData] = useState({});
  const [spyData, setSpyData] = useState([]);
  const [loading, setLoading] = useState(false);

  // ── Fetch storico per tutti i ticker + SPY ─────────────────────────────────
  useEffect(() => {
    if (!stocks.length) return;
    setLoading(true);

    const tickers = [...new Set(stocks.map(s => s.ticker))];

    Promise.all([
      ...tickers.map(ticker =>
        fetchHistory(ticker, 1000)
          .then(c => ({ ticker, candles: c || [] }))
          .catch(() => ({ ticker, candles: [] }))
      ),
      fetchHistory("SPY", 1000)
        .then(c => ({ ticker: "SPY", candles: c || [] }))
        .catch(() => ({ ticker: "SPY", candles: [] })),
    ]).then(results => {
      const spy = results.find(r => r.ticker === "SPY")?.candles || [];
      const map = {};
      results
        .filter(r => r.ticker !== "SPY")
        .forEach(({ ticker, candles }) => { map[ticker] = candles; });
      setRawData(map);
      setSpyData(spy);
      setLoading(false);
    });
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    stocks.map(s => `${s.ticker}-${s.qty}-${s.buyPrice}-${s.buyDate}`).join(","),
    eurRate,
  ]);

  // ── priceMap: { ticker → { dateISO → price } } con forward fill ───────────
  const priceMap = useMemo(() => {
    const map = {};
    Object.entries(rawData).forEach(([ticker, candles]) => {
      map[ticker] = {};
      candles.forEach(c => {
        if (c.date && c.price != null) map[ticker][c.date] = c.price;
      });
    });
    return map;
  }, [rawData]);

  // ── Serie valore portafoglio giorno per giorno ─────────────────────────────
  // Per ogni giorno:
  //   valore = Σ(qty × prezzoAdj_in_USD) per le posizioni già acquistate
  //   forward fill se il prezzo manca per un giorno festivo
  const portfolioSeries = useMemo(() => {
    if (!Object.keys(priceMap).length || !stocks.length) return [];

    const tickers = Object.keys(priceMap);

    const allDates = [...new Set(
      tickers.flatMap(t => Object.keys(priceMap[t]))
    )].sort();

    if (!allDates.length) return [];

    const positions = stocks.map(s => {
      const bd = parseBuyDate(s.buyDate);
      const buyDateISO = bd ? bd.toISOString().slice(0, 10) : allDates[0];
      const costUSD = (parseFloat(s.qty) || 0) * toUSD(parseFloat(s.buyPrice) || 0, s.currency, eurRate);
      return { ...s, buyDateISO, costUSD };
    });

    // Forward fill per ogni ticker
    const lastKnown = {};
    tickers.forEach(t => { lastKnown[t] = null; });

    const series = [];

    allDates.forEach(date => {
      // Aggiorna lastKnown
      tickers.forEach(t => {
        if (priceMap[t][date] != null) lastKnown[t] = priceMap[t][date];
      });

      const active = positions.filter(p => date >= p.buyDateISO);
      if (!active.length) return;

      let valore = 0;
      let valid = true;
      for (const pos of active) {
        const p = lastKnown[pos.ticker];
        if (p == null) { valid = false; break; }
        valore += (parseFloat(pos.qty) || 0) * toUSD(p, pos.currency, eurRate);
      }
      if (!valid || valore <= 0) return;

      const costo = active.reduce((s, p) => s + p.costUSD, 0);
      const label = new Date(date + "T12:00:00")
        .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

      series.push({ date, label, valore, costo });
    });

    return series;
  }, [priceMap, stocks, eurRate]);

  // ── spyMap ─────────────────────────────────────────────────────────────────
  const spyMap = useMemo(() => {
    const m = {};
    spyData.forEach(c => { if (c.date && c.price) m[c.date] = c.price; });
    return m;
  }, [spyData]);

  // ── Costo totale investito (qty × buyPrice in USD) ────────────────────────
  // Usato come base per "Inizio" — così coincide con il P&L dell'header
  const totalInvested = useMemo(() =>
    stocks.reduce((s, x) => s + (parseFloat(x.qty) || 0) * toUSD(parseFloat(x.buyPrice) || 0, x.currency, eurRate), 0),
    [stocks, eurRate]
  );

  // ── earliestBuyDate: data del primo acquisto ─────────────────────────────
  const earliestBuyDate = useMemo(() => {
    const dates = stocks
      .map(s => { const bd = parseBuyDate(s.buyDate); return bd ? bd.toISOString().slice(0,10) : null; })
      .filter(Boolean).sort();
    return dates[0] || null;
  }, [stocks]);

  // ── buildPeriod ───────────────────────────────────────────────────────────
  // Approccio corretto:
  //   1. Prendi solo i punti della serie dove TUTTE le posizioni sono già attive
  //      (data >= earliestBuyDate) → così ogni punto ha gli stessi titoli
  //   2. Per "Inizio": base = totalInvested (buyPrice utente) → coincide con header
  //   3. Per altri periodi: base = primo punto del range nella serie filtrata
  function buildPeriod(period) {
    if (portfolioSeries.length < 2) return { chartData: [], pill: null };

    // Serie filtrata: solo giorni >= data del primo acquisto
    // così ogni punto ha lo stesso set di posizioni → curva coerente
    const activeSeries = earliestBuyDate
      ? portfolioSeries.filter(p => p.date >= earliestBuyDate)
      : portfolioSeries;

    if (activeSeries.length < 2) return { chartData: [], pill: null };

    let slice;
    let baseValore = null;

    if (period === "Inizio") {
      // Base = prezzo di acquisto utente → coincide con P&L header
      slice = activeSeries;
      baseValore = totalInvested > 0 ? totalInvested : activeSeries[0].valore;

    } else if (period === "1G") {
      // Ultima chiusura vs chiusura precedente
      slice = activeSeries.slice(-2);

    } else {
      const cutoff = getPeriodCutoff(period);

      // Se il cutoff è prima del primo acquisto → uguale a "Inizio"
      if (earliestBuyDate && cutoff < earliestBuyDate) {
        slice = activeSeries;
        baseValore = totalInvested > 0 ? totalInvested : activeSeries[0].valore;
      } else {
        // Trova il primo punto >= cutoff, poi prendi quello precedente come base
        // (stesso giorno N mesi fa, o il più vicino disponibile)
        const idx = activeSeries.findIndex(p => p.date >= cutoff);
        if (idx > 0) {
          // idx-1 = ultimo giorno di trading PRIMA del cutoff = base corretta
          slice = activeSeries.slice(idx - 1);
        } else if (idx === 0) {
          slice = activeSeries;
          baseValore = totalInvested > 0 ? totalInvested : activeSeries[0].valore;
        } else {
          // Nessun dato nel range → usa tutto come Inizio
          slice = activeSeries;
          baseValore = totalInvested > 0 ? totalInvested : activeSeries[0].valore;
        }
      }
    }

    if (!slice || slice.length < 2) return { chartData: [], pill: null };

    const last     = slice[slice.length - 1];
    const base     = baseValore ?? slice[0].valore;
    const spyFirst = spyMap[slice[0].date]
      ?? spyData.find(s => s.date >= slice[0].date)?.price;

    const chartData = slice.map(p => ({
      ...p,
      pct: base > 0
        ? parseFloat(((p.valore - base) / base * 100).toFixed(2))
        : 0,
      spyPct: (() => {
        const sv = spyMap[p.date];
        if (!sv || !spyFirst) return null;
        return parseFloat(((sv / spyFirst - 1) * 100).toFixed(2));
      })(),
    }));

    const pill = {
      pct:   chartData[chartData.length - 1].pct,
      delta: last.valore - base,
    };

    return { chartData, pill };
  }

  return { portfolioSeries, spyMap, loading, buildPeriod };
}
