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

  // priceMap: { ticker -> { date -> price } } con forward fill
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

  // Serie completa: { date, value, baseValue }
  // value     = valore di mercato del portafoglio quel giorno
  // baseValue = costo investito fino a quel giorno (qty × buyPrice)
  //             cambia solo quando entra un nuovo titolo
  const fullSeries = useMemo(() => {
    if (!Object.keys(priceMap).length || !stocks.length) return [];

    const tickers = Object.keys(priceMap);
    const allDates = [...new Set(
      tickers.flatMap(t => Object.keys(priceMap[t]))
    )].sort();
    if (!allDates.length) return [];

    const positions = stocks.map(s => {
      const bd = parseBuyDate(s.buyDate);
      return {
        ticker:     s.ticker,
        qty:        parseFloat(s.qty) || 0,
        costUSD:    (parseFloat(s.qty) || 0) * toUSD(parseFloat(s.buyPrice) || 0, s.currency, eurRate),
        buyDateISO: bd ? bd.toISOString().slice(0, 10) : allDates[0],
        currency:   s.currency,
      };
    });

    // Forward fill
    const lastKnown = {};
    tickers.forEach(t => { lastKnown[t] = null; });

    const series = [];

    allDates.forEach(date => {
      tickers.forEach(t => {
        if (priceMap[t][date] != null) lastKnown[t] = priceMap[t][date];
      });

      // Usa TUTTI i titoli sempre (non solo quelli già comprati)
      // così non ci sono spike quando entra un nuovo titolo
      let value = 0;
      let valid = true;
      for (const p of positions) {
        if (lastKnown[p.ticker] == null) { valid = false; break; }
        value += p.qty * toUSD(lastKnown[p.ticker], p.currency, eurRate);
      }
      if (!valid || value <= 0) return;

      // baseValue = costo totale di TUTTI i titoli (costante)
      const baseValue = positions.reduce((s, p) => s + p.costUSD, 0);

      const label = new Date(date + "T12:00:00")
        .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

      series.push({ date, label, value, baseValue });
    });

    return series;
  }, [priceMap, stocks, eurRate]);

  // spyIndex per benchmark
  const spyIndex = useMemo(() => {
    const m = {};
    spyData.forEach(c => { if (c.date && c.price) m[c.date] = c.price; });
    return m;
  }, [spyData]);

  // buildPeriod:
  //   "Inizio": pct = (value - baseValue) / baseValue
  //             baseValue = costo investito (cambia quando entra nuovo titolo) → no spike
  //   "1G":     ultimi 2 punti della serie
  //   altri:    startVal = valore di TUTTI i titoli attuali al prezzo del cutoff
  //             (come se fossero già in portafoglio) → no spike da nuovo capitale
  function buildPeriod(period) {
    if (fullSeries.length < 2) return { chartData: [], pill: null };

    // Posizioni attuali (tutte, indipendentemente da buyDate)
    const allPositions = stocks.map(s => ({
      ticker:   s.ticker,
      qty:      parseFloat(s.qty) || 0,
      currency: s.currency,
    }));

    if (period === "Inizio") {
      const spyBase = spyIndex[fullSeries[0].date]
        ?? spyData.find(s => s.date >= fullSeries[0].date)?.price;

      const chartData = fullSeries.map(p => ({
        ...p,
        pct: parseFloat(((p.value - p.baseValue) / p.baseValue * 100).toFixed(2)),
        spyPct: (() => {
          const sv = spyIndex[p.date];
          if (!sv || !spyBase) return null;
          return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
        })(),
      }));

      return {
        chartData,
        pill: {
          pct:   chartData[chartData.length - 1].pct,
          delta: fullSeries[fullSeries.length - 1].value - fullSeries[fullSeries.length - 1].baseValue,
        },
      };
    }

    if (period === "1G") {
      const slice = fullSeries.slice(-2);
      const startVal = slice[0].value;
      const chartData = slice.map(p => ({
        ...p,
        pct: parseFloat(((p.value - startVal) / startVal * 100).toFixed(2)),
        spyPct: null,
      }));
      return {
        chartData,
        pill: { pct: chartData[chartData.length - 1].pct, delta: slice[slice.length - 1].value - startVal },
      };
    }

    // 1M, 6M, 1A: startVal = valore di TUTTI i titoli attuali al prezzo del cutoff
    const cutoff = getPeriodCutoff(period);

    // Calcola startVal usando priceMap (già indicizzato { date -> price })
    // Forward fill: cerca la data più vicina <= cutoff
    let startVal = 0;
    for (const pos of allPositions) {
      const tickerPrices = priceMap[pos.ticker] || {};
      // Prendi tutte le date <= cutoff e usa l'ultima
      const dates = Object.keys(tickerPrices).filter(d => d <= cutoff).sort();
      const lastDate = dates[dates.length - 1];
      const price = lastDate ? tickerPrices[lastDate] : null;
      if (price) startVal += pos.qty * toUSD(price, pos.currency, eurRate);
    }

    if (startVal <= 0) return { chartData: [], pill: null };

    // Slice della serie dal cutoff in poi
    const idx = fullSeries.findIndex(p => p.date >= cutoff);
    const slice = idx >= 0 ? fullSeries.slice(idx) : fullSeries;
    if (slice.length < 2) return { chartData: [], pill: null };

    const spyBase = spyIndex[slice[0].date]
      ?? spyData.find(s => s.date >= slice[0].date)?.price;

    const chartData = slice.map(p => ({
      ...p,
      pct: parseFloat(((p.value - startVal) / startVal * 100).toFixed(2)),
      spyPct: (() => {
        const sv = spyIndex[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
      })(),
    }));

    return {
      chartData,
      pill: {
        pct:   chartData[chartData.length - 1].pct,
        delta: slice[slice.length - 1].value - startVal,
      },
    };
  }

  return { fullSeries, loading, buildPeriod, priceMap };
}
