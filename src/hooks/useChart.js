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

  // priceMap: { ticker -> { date -> price } }
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

  // spyIndex
  const spyIndex = useMemo(() => {
    const m = {};
    spyData.forEach(c => { if (c.date && c.price) m[c.date] = c.price; });
    return m;
  }, [spyData]);

  // Posizioni con info acquisto
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

  // totalInvested = costo totale di tutti i titoli
  const totalInvested = useMemo(() =>
    positions.reduce((s, p) => s + p.costUSD, 0),
  [positions]);

  // Forward fill helper
  function getPriceAt(ticker, date) {
    const prices = priceMap[ticker];
    if (!prices) return null;
    const dates = Object.keys(prices).filter(d => d <= date).sort();
    const last = dates[dates.length - 1];
    return last ? prices[last] : null;
  }

  // Valore portafoglio in una data: solo titoli già acquistati
  function portfolioValueAt(date) {
    let total = 0;
    for (const p of positions) {
      if (date < p.buyDateISO) continue;
      const price = getPriceAt(p.ticker, date);
      if (price == null) return null;
      total += p.qty * toUSD(price, p.currency, eurRate);
    }
    return total > 0 ? total : null;
  }

  // fullSeries: serie giornaliera { date, label, value, pctInizio }
  // pctInizio = (value - totalInvested) / totalInvested
  // Questa formula è identica all'header P&L
  const fullSeries = useMemo(() => {
    if (!Object.keys(priceMap).length || !positions.length) return [];

    const allDates = [...new Set(
      Object.keys(priceMap).flatMap(t => Object.keys(priceMap[t]))
    )].sort();

    const series = [];
    // Forward fill cache
    const lastKnown = {};
    Object.keys(priceMap).forEach(t => { lastKnown[t] = null; });

    allDates.forEach(date => {
      Object.keys(priceMap).forEach(t => {
        if (priceMap[t][date] != null) lastKnown[t] = priceMap[t][date];
      });

      const active = positions.filter(p => date >= p.buyDateISO);
      if (!active.length) return;

      let value = 0;
      for (const p of active) {
        const price = lastKnown[p.ticker];
        if (price == null) return;
        value += p.qty * toUSD(price, p.currency, eurRate);
      }
      if (value <= 0) return;

      // costo delle posizioni attive oggi
      const costAttivo = active.reduce((s, p) => s + p.costUSD, 0);

      const label = new Date(date + "T12:00:00")
        .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

      series.push({
        date,
        label,
        value,
        cost: costAttivo,
        // pctInizio: rendimento dall'acquisto — identico all'header quando tutti i titoli sono attivi
        pctInizio: parseFloat(((value - costAttivo) / costAttivo * 100).toFixed(2)),
      });
    });

    return series;
  }, [priceMap, positions, eurRate]);

  // buildPeriod
  function buildPeriod(period) {
    if (fullSeries.length < 2) return { chartData: [], pill: null };

    let slice;

    if (period === "Inizio") {
      // Usa pctInizio direttamente — coincide con l'header
      slice = fullSeries;
      const spyBase = spyIndex[slice[0].date]
        ?? spyData.find(s => s.date >= slice[0].date)?.price;

      const chartData = slice.map(p => ({
        ...p,
        pct: p.pctInizio,
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
          delta: slice[slice.length - 1].value - slice[slice.length - 1].cost,
        },
      };
    }

    if (period === "1G") {
      slice = fullSeries.slice(-2);
      const base = slice[0].value;
      const chartData = slice.map(p => ({
        ...p,
        pct:    parseFloat(((p.value - base) / base * 100).toFixed(2)),
        spyPct: null,
      }));
      return {
        chartData,
        pill: { pct: chartData[chartData.length - 1].pct, delta: slice[slice.length-1].value - base },
      };
    }

    // 1M, 6M, 1A
    // base = valore portafoglio al cutoff (solo titoli presenti)
    // Per titoli entrati dopo il cutoff: base = loro costUSD
    // pct = (value_oggi - base_effettiva) / base_effettiva
    const cutoff = getPeriodCutoff(period);
    const idx = fullSeries.findIndex(p => p.date >= cutoff);
    slice = idx > 0 ? fullSeries.slice(idx - 1) : fullSeries;
    if (!slice || slice.length < 2) return { chartData: [], pill: null };

    // Valore al primo punto dello slice per i titoli già presenti
    const baseDate = slice[0].date;
    // base effettiva = per ogni titolo:
    //   se buyDate <= baseDate → prezzo di mercato al baseDate × qty
    //   se buyDate > baseDate  → costUSD (prezzo di acquisto)
    const baseValue = positions.reduce((s, p) => {
      if (p.buyDateISO <= baseDate) {
        const price = getPriceAt(p.ticker, baseDate);
        return s + (price ? p.qty * toUSD(price, p.currency, eurRate) : 0);
      } else {
        return s + p.costUSD;
      }
    }, 0);

    if (baseValue <= 0) return { chartData: [], pill: null };

    const spyBase = spyIndex[slice[0].date]
      ?? spyData.find(s => s.date >= slice[0].date)?.price;

    const chartData = slice.map(p => ({
      ...p,
      pct: parseFloat(((p.value - baseValue) / baseValue * 100).toFixed(2)),
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
        delta: slice[slice.length - 1].value - baseValue,
      },
    };
  }

  return { fullSeries, loading, buildPeriod, priceMap };
}
