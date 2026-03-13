import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

export const PERIODS = ["1G", "1M", "6M", "1A", "Inizio"];
// Giorni di calendario per ogni periodo — usati per trovare la data di cutoff
// nella serie storica (giorni di trading effettivi, non di calendario)
const PERIOD_DAYS = { "1G": 1, "1M": 30, "6M": 182, "1A": 365 };
// Giorni di trading approssimativi per ogni periodo
// usati come fallback se la serie è troppo corta
const PERIOD_TRADING_DAYS = { "1G": 1, "1M": 21, "6M": 126, "1A": 252 };

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

  // ── buildPeriod: dato un periodo, ritorna chartData e pill ─────────────────
  // "Inizio": base = totalInvested (qty × buyPrice) → coincide con header P&L
  // Altri periodi: base = punto precedente al cutoff → stesso metodo Yahoo/TradingView
  function buildPeriod(period) {
    if (portfolioSeries.length < 2) return { chartData: [], pill: null };

    let slice;
    let baseValore = null; // null = usa slice[0].valore

    if (period === "Inizio") {
      slice = portfolioSeries;
      // Base = costo di acquisto reale, non il prezzo storico del primo giorno
      baseValore = totalInvested > 0 ? totalInvested : slice[0].valore;
    } else if (period === "1G") {
      slice = portfolioSeries.slice(-2);
    } else {
      const days   = PERIOD_DAYS[period];
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const idx    = portfolioSeries.findIndex(p => p.date >= cutoff);
      if (idx > 0) {
        slice = portfolioSeries.slice(idx - 1);
        // Se il punto base precede il primo acquisto reale, usa totalInvested
        // (es: 1A quando il portafoglio esiste da meno di un anno)
        const earliestBuy = stocks
          .map(s => { const bd = parseBuyDate(s.buyDate); return bd ? bd.toISOString().slice(0,10) : null; })
          .filter(Boolean)
          .sort()[0];
        if (earliestBuy && slice[0].date < earliestBuy) {
          baseValore = totalInvested > 0 ? totalInvested : slice[0].valore;
        }
      } else {
        slice = portfolioSeries;
      }
    }

    if (slice.length < 2) return { chartData: [], pill: null };

    const first    = slice[0];
    const last     = slice[slice.length - 1];
    const base     = baseValore ?? first.valore; // valore di riferimento per pct
    const spyFirst = spyMap[first.date]
      ?? spyData.find(s => s.date >= first.date)?.price;

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
