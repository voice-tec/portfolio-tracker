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

      const active = positions.filter(p => date >= p.buyDateISO);
      if (!active.length) return;

      let value = 0;
      let valid = true;
      for (const p of active) {
        if (lastKnown[p.ticker] == null) { valid = false; break; }
        value += p.qty * toUSD(lastKnown[p.ticker], p.currency, eurRate);
      }
      if (!valid || value <= 0) return;

      // baseValue = costo totale delle posizioni attive oggi
      const baseValue = active.reduce((s, p) => s + p.costUSD, 0);

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

  // buildPeriod — stessa logica del file HTML di riferimento:
  //   "Inizio": pct = (value - baseValue) / baseValue  (baseValue cambia con nuovi acquisti)
  //   altri:    pct = (value - startVal)  / startVal   (startVal = valore al primo giorno del range)
  function buildPeriod(period) {
    if (fullSeries.length < 2) return { chartData: [], pill: null };

    let slice;

    if (period === "Inizio") {
      slice = fullSeries;
    } else if (period === "1G") {
      slice = fullSeries.slice(-2);
    } else {
      const cutoff = getPeriodCutoff(period);
      const idx = fullSeries.findIndex(p => p.date >= cutoff);
      slice = idx > 0 ? fullSeries.slice(idx - 1) : fullSeries;
    }

    if (!slice || slice.length < 2) return { chartData: [], pill: null };

    const startVal = slice[0].value;
    const spyBase  = spyIndex[slice[0].date]
      ?? spyData.find(s => s.date >= slice[0].date)?.price;

    const chartData = slice.map(p => {
      let pct;
      if (period === "Inizio") {
        // Come l'HTML: (value - baseValue) / baseValue
        pct = parseFloat(((p.value - p.baseValue) / p.baseValue * 100).toFixed(2));
      } else {
        // Come l'HTML: (value - startVal) / startVal
        pct = parseFloat(((p.value - startVal) / startVal * 100).toFixed(2));
      }

      const spyPct = (() => {
        const sv = spyIndex[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
      })();

      return { ...p, pct, spyPct };
    });

    const last = chartData[chartData.length - 1];
    const pill = {
      pct:   last.pct,
      delta: slice[slice.length - 1].value - (period === "Inizio" ? slice[slice.length - 1].baseValue : startVal),
    };

    return { chartData, pill };
  }

  return { fullSeries, loading, buildPeriod };
}
