import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

export const PERIODS = ["1G", "1M", "6M", "1A", "Inizio"];

function getCutoff(period) {
  const d = new Date();
  if (period === "1M") { d.setMonth(d.getMonth() - 1); }
  if (period === "6M") { d.setMonth(d.getMonth() - 6); }
  if (period === "1A") { d.setFullYear(d.getFullYear() - 1); }
  return d.toISOString().slice(0, 10);
}

export function useChart(stocks, eurRate) {
  const [history, setHistory] = useState({});
  const [spyHistory, setSpyHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!stocks.length) return;
    setLoading(true);
    const tickers = [...new Set(stocks.map(s => s.ticker))];
    Promise.all([
      ...tickers.map(t =>
        fetchHistory(t, 1000)
          .then(c => ({ ticker: t, candles: c || [] }))
          .catch(() => ({ ticker: t, candles: [] }))
      ),
      fetchHistory("SPY", 1000)
        .then(c => ({ ticker: "SPY", candles: c || [] }))
        .catch(() => ({ ticker: "SPY", candles: [] })),
    ]).then(results => {
      const spy = results.find(r => r.ticker === "SPY")?.candles || [];
      const map = {};
      results
        .filter(r => r.ticker !== "SPY")
        .forEach(r => { map[r.ticker] = r.candles; });
      setHistory(map);
      setSpyHistory(spy);
      setLoading(false);
    });
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    stocks.map(s => `${s.ticker}-${s.qty}-${s.buyPrice}-${s.buyDate}`).join(","),
    eurRate,
  ]);

  // ── Serie completa con chain-linking e cashflow adjustment ────────────────
  const fullSeries = useMemo(() => {
    if (!Object.keys(history).length) return [];

    const priceMap = {};
    const allDates = new Set();
    Object.entries(history).forEach(([ticker, candles]) => {
      priceMap[ticker] = {};
      candles.forEach(c => {
        if (!c.date || c.price == null) return;
        priceMap[ticker][c.date] = c.price;
        allDates.add(c.date);
      });
    });

    const dates = [...allDates].sort();
    const positions = stocks.map(s => {
      const d = parseBuyDate(s.buyDate);
      return { ...s, buyDateISO: d ? d.toISOString().slice(0, 10) : null };
    });

    const lastPrice = {};
    const series = [];
    let prevValue = null;
    let cumulative = 0;

    dates.forEach(date => {
      // Forward fill
      Object.keys(priceMap).forEach(t => {
        if (priceMap[t][date] != null) lastPrice[t] = priceMap[t][date];
      });

      const active = positions.filter(p => p.buyDateISO && date >= p.buyDateISO);
      if (!active.length) return;

      let value = 0;
      let cashFlow = 0;
      active.forEach(pos => {
        const p = lastPrice[pos.ticker];
        if (!p) return;
        const priceUSD = toUSD(p, pos.currency, eurRate);
        value += priceUSD * pos.qty;
        // Cash flow: il costo di acquisto al giorno di entrata
        if (pos.buyDateISO === date) {
          cashFlow += toUSD(pos.buyPrice, pos.currency, eurRate) * pos.qty;
        }
      });

      if (value <= 0) return;

      if (prevValue !== null) {
        const dailyReturn = prevValue > 0
          ? (value - prevValue - cashFlow) / prevValue
          : 0;
        cumulative = (1 + cumulative) * (1 + dailyReturn) - 1;
      }

      const label = new Date(date + "T12:00:00")
        .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

      series.push({
        date,
        label,
        value,
        pct: parseFloat((cumulative * 100).toFixed(2)),
      });

      prevValue = value;
    });

    return series;
  }, [history, stocks, eurRate]);

  // ── SPY index ─────────────────────────────────────────────────────────────
  const spyIndex = useMemo(() => {
    const m = {};
    spyHistory.forEach(c => { m[c.date] = c.price; });
    return m;
  }, [spyHistory]);

  // ── buildPeriod ───────────────────────────────────────────────────────────
  // Taglia fullSeries al range, rinormalizza pct a 0% dal primo punto,
  // aggiunge spyPct. pill = ultimo punto = identico al tooltip.
  function buildPeriod(period) {
    if (fullSeries.length < 2) return { chartData: [], pill: null };

    const earliestBuy = stocks
      .map(s => { const d = parseBuyDate(s.buyDate); return d ? d.toISOString().slice(0, 10) : null; })
      .filter(Boolean).sort()[0];

    let slice;

    if (period === "Inizio") {
      slice = fullSeries;
    } else if (period === "1G") {
      slice = fullSeries.slice(-2);
    } else {
      const cutoff = getCutoff(period);
      // Se cutoff è prima del primo acquisto → uguale a Inizio
      const effectiveCutoff = (earliestBuy && cutoff < earliestBuy) ? earliestBuy : cutoff;
      const idx = fullSeries.findIndex(p => p.date >= effectiveCutoff);
      slice = idx > 0 ? fullSeries.slice(idx - 1) : fullSeries;
    }

    if (!slice || slice.length < 2) return { chartData: [], pill: null };

    // Rinormalizza: 0% al primo punto del range
    const basePct  = slice[0].pct;
    const spyBase  = spyIndex[slice[0].date]
      ?? spyHistory.find(s => s.date >= slice[0].date)?.price;

    const chartData = slice.map(p => ({
      ...p,
      // Denormalizza e rinormalizza da basePct
      pct: parseFloat(
        ((((1 + p.pct / 100) / (1 + basePct / 100)) - 1) * 100).toFixed(2)
      ),
      spyPct: (() => {
        const sv = spyIndex[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
      })(),
    }));

    const pill = {
      pct:   chartData[chartData.length - 1].pct,
      delta: slice[slice.length - 1].value - slice[0].value,
    };

    return { chartData, pill };
  }

  return { fullSeries, loading, buildPeriod };
}
