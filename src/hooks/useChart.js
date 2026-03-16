import { useEffect, useState, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

export const PERIODS = ["1G", "1M", "6M", "1A", "Inizio"];

const PERIOD_DAYS = {
  "1G":    1,
  "1M":    30,
  "6M":    180,
  "1A":    365,
  "Inizio": Infinity,
};

export function useChart(stocks, eurRate) {
  const [histories, setHistories] = useState({});
  const [loading, setLoading]     = useState(false);

  // 1️⃣ Scarica prezzi storici per ogni ticker
  useEffect(() => {
    if (!stocks.length) return;
    setLoading(true);
    const tickers = [...new Set(stocks.map(s => s.ticker))];
    Promise.all(
      tickers.map(t =>
        fetchHistory(t, 1000)
          .then(c => ({ ticker: t, candles: c || [] }))
          .catch(() => ({ ticker: t, candles: [] }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.ticker] = r.candles; });
      setHistories(map);
      setLoading(false);
    });
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    stocks.map(s => `${s.ticker}-${s.qty}-${s.buyPrice}-${s.buyDate}`).join(","),
    eurRate,
  ]);

  // 2️⃣ Serie completa con Modified Dietz
  const fullSeries = useMemo(() => {
    if (!Object.keys(histories).length || !stocks.length) return [];

    // Prepara posizioni con buyDateISO e costUSD
    const positions = stocks.map(s => {
      const bd = parseBuyDate(s.buyDate);
      return {
        ticker:     s.ticker,
        qty:        parseFloat(s.qty) || 0,
        costUSD:    toUSD(parseFloat(s.buyPrice) || 0, s.currency, eurRate),
        buyDateISO: bd ? bd.toISOString().slice(0, 10) : "1970-01-01",
        currency:   s.currency,
      };
    });

    // Unione di tutte le date disponibili
    const allDates = new Set();
    Object.values(histories).forEach(candles =>
      candles.forEach(c => { if (c.date) allDates.add(c.date); })
    );
    const dates = [...allDates].sort();

    let prevValue = null;
    let cumulative = 0;
    const series = [];

    for (const date of dates) {
      // Posizioni attive a questa data
      const active = positions.filter(p => date >= p.buyDateISO);
      if (!active.length) continue;

      // Valore portafoglio = Σ(qty × prezzo_adj_in_USD)
      let value = 0;
      for (const pos of active) {
        const price = getPrice(histories[pos.ticker] || [], date);
        value += pos.qty * toUSD(price, pos.currency, eurRate);
      }
      if (value <= 0) continue;

      // Cash flow Ct = capitale nuovo entrato OGGI (al prezzo di acquisto)
      const cashIn = active
        .filter(p => p.buyDateISO === date)
        .reduce((s, p) => s + p.qty * p.costUSD, 0);

      // rt = (Vt - Vt-1 - Ct) / Vt-1   (Modified Dietz)
      let dailyReturn = 0;
      if (prevValue !== null && prevValue > 0) {
        dailyReturn = (value - prevValue - cashIn) / prevValue;
      }

      // Rendimento cumulato concatenato
      cumulative = (1 + cumulative) * (1 + dailyReturn) - 1;

      const label = new Date(date + "T12:00:00")
        .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

      series.push({ date, label, value, pct: cumulative });

      prevValue = value;
    }

    return series;
  }, [histories, stocks, eurRate]);

  // 3️⃣ buildPeriod: taglia e rinormalizza la serie per il periodo scelto
  function buildPeriod(period) {
    if (fullSeries.length < 2) return { chartData: [], pill: null };

    let slice;

    if (period === "Inizio") {
      slice = fullSeries;

    } else if (period === "1G") {
      slice = fullSeries.slice(-2);

    } else {
      const days   = PERIOD_DAYS[period];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffISO = cutoff.toISOString().slice(0, 10);

      const idx = fullSeries.findIndex(p => p.date >= cutoffISO);
      // Prende il punto precedente come base (ultimo giorno prima del cutoff)
      slice = idx > 0 ? fullSeries.slice(idx - 1) : fullSeries;
    }

    if (!slice || slice.length < 2) return { chartData: [], pill: null };

    // Rinormalizza: 0% al primo punto dello slice
    const base = slice[0].pct;
    const chartData = slice.map(p => ({
      ...p,
      pct: parseFloat((((1 + p.pct) / (1 + base) - 1) * 100).toFixed(2)),
    }));

    const pill = {
      pct:   chartData[chartData.length - 1].pct,
      delta: slice[slice.length - 1].value - slice[0].value,
    };

    return { chartData, pill };
  }

  return { fullSeries, loading, buildPeriod };
}

// Forward fill: restituisce il prezzo più recente disponibile fino a `date`
function getPrice(candles, date) {
  let last = 0;
  for (const c of candles) {
    if (c.date <= date) last = c.price ?? 0;
    else break;
  }
  return last;
}
