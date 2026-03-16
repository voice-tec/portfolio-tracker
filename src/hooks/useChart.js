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

  const spyIndex = useMemo(() => {
    const m = {};
    spyData.forEach(c => { if (c.date && c.price) m[c.date] = c.price; });
    return m;
  }, [spyData]);

  const positions = useMemo(() =>
    stocks.map(s => {
      const bd = parseBuyDate(s.buyDate);
      return {
        ticker:     s.ticker,
        qty:        parseFloat(s.qty) || 0,
        costUSD:    (parseFloat(s.qty) || 0) * toUSD(parseFloat(s.buyPrice) || 0, s.currency, eurRate),
        buyDateISO: bd ? bd.toISOString().slice(0, 10) : "1970-01-01",
        currency:   s.currency,
      };
    }),
  [stocks, eurRate]);

  // Calcola TWR giornaliero su un sottoinsieme di date a partire da fromDate
  // r_giorno = (V_oggi - V_ieri - CashIn) / V_ieri
  // CashIn = buyPrice × qty per titoli entrati oggi
  // Ritorna array { date, label, value, pct } dove pct parte da 0%
  function calcTWR(fromDate) {
    const tickers = Object.keys(priceMap);
    if (!tickers.length) return [];

    const allDates = [...new Set(
      tickers.flatMap(t => Object.keys(priceMap[t]))
    )].filter(d => d >= fromDate).sort();

    if (allDates.length < 2) return [];

    // Forward fill: inizializza con l'ultimo prezzo noto prima di fromDate
    const lastKnown = {};
    tickers.forEach(t => {
      const dates = Object.keys(priceMap[t]).filter(d => d < fromDate).sort();
      const last = dates[dates.length - 1];
      lastKnown[t] = last ? priceMap[t][last] : null;
    });

    const series = [];
    let prevValue = null;
    let cumulative = 0;

    for (const date of allDates) {
      // Aggiorna forward fill
      tickers.forEach(t => {
        if (priceMap[t][date] != null) lastKnown[t] = priceMap[t][date];
      });

      // Posizioni attive
      const active = positions.filter(p => date >= p.buyDateISO);
      if (!active.length) continue;

      let value = 0;
      let valid = true;
      for (const p of active) {
        if (lastKnown[p.ticker] == null) { valid = false; break; }
        value += p.qty * toUSD(lastKnown[p.ticker], p.currency, eurRate);
      }
      if (!valid || value <= 0) continue;

      // CashIn = costo dei titoli entrati oggi
      const cashIn = positions
        .filter(p => p.buyDateISO === date && date >= fromDate)
        .reduce((s, p) => s + p.costUSD, 0);

      if (prevValue !== null && prevValue > 0) {
        const r = (value - prevValue - cashIn) / prevValue;
        cumulative = (1 + cumulative) * (1 + r) - 1;
      }

      const label = new Date(date + "T12:00:00")
        .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

      series.push({ date, label, value, pct: parseFloat((cumulative * 100).toFixed(2)) });
      prevValue = value;
    }

    return series;
  }

  // fullSeries per "Inizio" — TWR dall'acquisto del primo titolo
  const fullSeries = useMemo(() => {
    if (!Object.keys(priceMap).length || !positions.length) return [];
    const earliest = positions.map(p => p.buyDateISO).sort()[0];
    return calcTWR(earliest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceMap, positions, eurRate]);

  // buildPeriod: per ogni periodo calcola il TWR dal cutoff
  function buildPeriod(period) {
    if (!Object.keys(priceMap).length || !positions.length) return { chartData: [], pill: null };

    let chartData;

    if (period === "Inizio") {
      if (fullSeries.length < 2) return { chartData: [], pill: null };
      chartData = fullSeries;
    } else if (period === "1G") {
      if (fullSeries.length < 2) return { chartData: [], pill: null };
      const last2 = fullSeries.slice(-2);
      const base = last2[0].value;
      chartData = last2.map(p => ({
        ...p,
        pct: parseFloat(((p.value - base) / base * 100).toFixed(2)),
      }));
    } else {
      // Calcola TWR fresco dal cutoff — parte sempre da 0% e non ha spike
      const cutoff = getPeriodCutoff(period);
      chartData = calcTWR(cutoff);
      if (chartData.length < 2) return { chartData: [], pill: null };
    }

    // Aggiungi spyPct
    const spyBase = spyIndex[chartData[0].date]
      ?? spyData.find(s => s.date >= chartData[0].date)?.price;

    const chartDataWithSpy = chartData.map(p => ({
      ...p,
      spyPct: (() => {
        const sv = spyIndex[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
      })(),
    }));

    const pill = {
      pct:   chartDataWithSpy[chartDataWithSpy.length - 1].pct,
      delta: chartData[chartData.length - 1].value - chartData[0].value,
    };

    return { chartData: chartDataWithSpy, pill };
  }

  return { fullSeries, loading, buildPeriod, priceMap };
}
