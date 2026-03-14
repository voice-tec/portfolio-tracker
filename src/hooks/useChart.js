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

    const lastKnown = {};
    tickers.forEach(t => { lastKnown[t] = null; });

    const series = [];

    allDates.forEach(date => {
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

      const label = new Date(date + "T12:00:00")
        .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

      series.push({ date, label, valore });
    });

    // ── Chain-linking ──────────────────────────────────────────────────────
    // Per ogni giorno calcola il rendimento giornaliero r_i = (v_i - v_{i-1}) / v_{i-1}
    // ma solo se il set di posizioni attive è lo stesso del giorno precedente.
    // Se entra un nuovo titolo (cash-flow in), il denominatore viene aggiustato:
    //   v_{i-1} corretto = v_{i-1} + nuovoCosto  (come se il titolo fosse già lì ieri)
    // Così l'ingresso di capitale non crea rendimento artificiale.

    const positionsByDate = {};
    allDates.forEach(date => {
      positionsByDate[date] = positions.filter(p => date >= p.buyDateISO).map(p => p.ticker + p.buyDateISO);
    });

    // Ricostruisci serie con chain-linking
    const chainSeries = [];
    let cumulativeIndex = 0; // parte da 0%

    for (let i = 0; i < series.length; i++) {
      const pt = series[i];

      if (i === 0) {
        chainSeries.push({ ...pt, chainPct: 0 });
        continue;
      }

      const prev = series[i - 1];

      // Controlla se sono entrate nuove posizioni oggi
      const prevActive = positions.filter(p => prev.date >= p.buyDateISO);
      const currActive = positions.filter(p => pt.date >= p.buyDateISO);
      const newPositions = currActive.filter(p =>
        !prevActive.find(pa => pa.ticker === p.ticker && pa.buyDateISO === p.buyDateISO)
      );

      const cashIn = newPositions.reduce((s, p) => s + p.costUSD, 0);
      const dailyReturn = prev.valore > 0
        ? (pt.valore - prev.valore - cashIn) / prev.valore
        : 0;
      cumulativeIndex = (1 + cumulativeIndex / 100) * (1 + dailyReturn) - 1;
      const chainPct = parseFloat((cumulativeIndex * 100).toFixed(2));

      chainSeries.push({ ...pt, chainPct });
    }

    return chainSeries;
  }, [priceMap, stocks, eurRate]);

  // ── spyMap ─────────────────────────────────────────────────────────────────
  const spyMap = useMemo(() => {
    const m = {};
    spyData.forEach(c => { if (c.date && c.price) m[c.date] = c.price; });
    return m;
  }, [spyData]);

  // ── earliestBuyDate ───────────────────────────────────────────────────────
  const earliestBuyDate = useMemo(() => {
    const dates = stocks
      .map(s => { const bd = parseBuyDate(s.buyDate); return bd ? bd.toISOString().slice(0,10) : null; })
      .filter(Boolean).sort();
    return dates[0] || null;
  }, [stocks]);

  // ── buildPeriod ───────────────────────────────────────────────────────────
  // Usa chainPct (rendimento concatenato) immune agli spike da nuovo capitale.
  // Per ogni periodo trova il punto base e rinormalizza chainPct a 0% da lì.
  // pill = ultimo punto rinormalizzato = identico al tooltip. Sempre.
  function buildPeriod(period) {
    if (portfolioSeries.length < 2) return { chartData: [], pill: null };

    const activeSeries = earliestBuyDate
      ? portfolioSeries.filter(p => p.date >= earliestBuyDate)
      : portfolioSeries;

    if (activeSeries.length < 2) return { chartData: [], pill: null };

    let slice;

    if (period === "Inizio") {
      slice = activeSeries;
    } else if (period === "1G") {
      slice = activeSeries.slice(-2);
    } else {
      const cutoff = getPeriodCutoff(period);
      if (earliestBuyDate && cutoff < earliestBuyDate) {
        slice = activeSeries;
      } else {
        const idx = activeSeries.findIndex(p => p.date >= cutoff);
        slice = idx > 0 ? activeSeries.slice(idx - 1) : activeSeries;
      }
    }

    if (!slice || slice.length < 2) return { chartData: [], pill: null };

    const baseChain = slice[0].chainPct ?? 0;
    const spyFirst  = spyMap[slice[0].date]
      ?? spyData.find(s => s.date >= slice[0].date)?.price;

    const chartData = slice.map(p => {
      // Rinormalizza chainPct: 0% al primo punto, X% all'ultimo
      const pct = parseFloat(
        ((((1 + (p.chainPct ?? 0) / 100) / (1 + baseChain / 100)) - 1) * 100).toFixed(2)
      );
      const spyPct = (() => {
        const sv = spyMap[p.date];
        if (!sv || !spyFirst) return null;
        return parseFloat(((sv / spyFirst - 1) * 100).toFixed(2));
      })();
      return { ...p, pct, spyPct };
    });

    const pill = {
      pct:   chartData[chartData.length - 1].pct,
      delta: slice[slice.length - 1].valore - slice[0].valore,
    };

    return { chartData, pill };
  }

  return { portfolioSeries, spyMap, loading, buildPeriod };
}
