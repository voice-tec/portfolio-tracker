import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

export const PERIODS = ["1G", "1M", "6M", "1A", "Inizio"];

function getPeriodCutoff(period) {
  const d = new Date();
  if (period === "1M") d.setMonth(d.getMonth() - 1);
  else if (period === "6M") d.setMonth(d.getMonth() - 6);
  else if (period === "1A") d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export function useChart(stocks, eurRate) {
  const [rawData, setRawData] = useState({});
  const [spyData, setSpyData] = useState([]);
  const [loading, setLoading] = useState(false);

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
      const map = {};
      results
        .filter(r => r.ticker !== "SPY")
        .forEach(({ ticker, candles }) => { map[ticker] = candles; });
      setRawData(map);
      setSpyData(results.find(r => r.ticker === "SPY")?.candles || []);
      setLoading(false);
    });
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    stocks.map(s => `${s.ticker}-${s.qty}-${s.buyPrice}-${s.buyDate}`).join(","),
    eurRate,
  ]);

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

  // ── Serie grezza: { date, label, valore } con forward fill ───────────────
  const portfolioSeries = useMemo(() => {
    if (!Object.keys(priceMap).length || !stocks.length) return [];

    const tickers = Object.keys(priceMap);
    const allDates = [...new Set(tickers.flatMap(t => Object.keys(priceMap[t])))].sort();
    if (!allDates.length) return [];

    const positions = stocks.map(s => {
      const bd = parseBuyDate(s.buyDate);
      return {
        ...s,
        buyDateISO: bd ? bd.toISOString().slice(0, 10) : allDates[0],
      };
    });

    const lastKnown = {};
    tickers.forEach(t => { lastKnown[t] = null; });

    const series = [];

    allDates.forEach(date => {
      // Forward fill
      tickers.forEach(t => {
        if (priceMap[t][date] != null) lastKnown[t] = priceMap[t][date];
      });

      const active = positions.filter(p => date >= p.buyDateISO);
      if (!active.length) return;

      let totalValue = 0;
      let valid = true;
      for (const p of active) {
        const price = lastKnown[p.ticker];
        if (price == null) { valid = false; break; }
        totalValue += (parseFloat(p.qty) || 0) * toUSD(price, p.currency, eurRate);
      }
      if (!valid || totalValue <= 0) return;

      const label = new Date(date + "T12:00:00")
        .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

      series.push({ date, label, valore: totalValue });
    });

    return series;
  }, [priceMap, stocks, eurRate]);

  // SPY index
  const spyIndex = useMemo(() => {
    const m = {};
    spyData.forEach(c => { if (c.date && c.price) m[c.date] = c.price; });
    return m;
  }, [spyData]);

  // ── Costo totale investito (qty × buyPrice) ──────────────────────────────
  const totalInvested = stocks.reduce((sum, s) => {
    return sum + (parseFloat(s.qty) || 0) * toUSD(parseFloat(s.buyPrice) || 0, s.currency, eurRate);
  }, 0);

  // ── buildPeriod: taglia + normalizza a 0% dal primo punto del range ───────
  // Per "Inizio": base = totalInvested (buyPrice utente) → coincide con P&L header
  // Per altri periodi: base = valore portafoglio al primo punto del range
  function buildPeriod(period) {
    if (portfolioSeries.length < 2) return { chartData: [], pill: null };

    let slice;
    let baseValore;

    if (period === "Inizio") {
      slice = portfolioSeries;
      // Usa il prezzo di acquisto reale, non il prezzo Yahoo di quel giorno
      baseValore = totalInvested > 0 ? totalInvested : slice[0].valore;
    } else if (period === "1G") {
      slice = portfolioSeries.slice(-2);
      baseValore = slice[0].valore;
    } else {
      const cutoff = getPeriodCutoff(period);
      const idx = portfolioSeries.findIndex(p => p.date >= cutoff);
      slice = idx > 0 ? portfolioSeries.slice(idx - 1) : portfolioSeries;
      // Se il cutoff è prima del primo acquisto → usa totalInvested
      const earliestBuy = stocks
        .map(s => { const bd = parseBuyDate(s.buyDate); return bd ? bd.toISOString().slice(0,10) : null; })
        .filter(Boolean).sort()[0];
      if (earliestBuy && slice[0].date < earliestBuy) {
        baseValore = totalInvested > 0 ? totalInvested : slice[0].valore;
      } else {
        baseValore = slice[0].valore;
      }
    }

    if (!slice || slice.length < 2) return { chartData: [], pill: null };

    const spyBase = spyIndex[slice[0].date]
      ?? spyData.find(s => s.date >= slice[0].date)?.price;

    const chartData = slice.map(p => ({
      ...p,
      pct: parseFloat(((p.valore / baseValore - 1) * 100).toFixed(2)),
      spyPct: (() => {
        const sv = spyIndex[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
      })(),
    }));

    const pill = {
      pct:   chartData[chartData.length - 1].pct,
      delta: slice[slice.length - 1].valore - baseValore,
    };

    return { chartData, pill };
  }

  return { portfolioSeries, spyData, spyIndex, loading, buildPeriod };
}
