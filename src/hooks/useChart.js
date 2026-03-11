import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

const DAYS_MAP = { "1M": 30, "3M": 63, "6M": 126, "1A": 252 };

export function useChart(stocks, eurRate, period = "Inizio") {
  const [rawSeries, setRawSeries] = useState([]); // [{date, label, valore, pnlPct}]
  const [benchmark, setBenchmark] = useState([]); // [{date, spy}]
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (!stocks.length) return;
    setLoading(true);

    const uniqueTickers = [...new Set(stocks.map(s => s.ticker))];

    Promise.all([
      ...uniqueTickers.map(ticker =>
        fetchHistory(ticker, 365 * 3)
          .then(c => ({ ticker, candles: c || [] }))
          .catch(() => ({ ticker, candles: [] }))
      ),
      fetchHistory("SPY", 365 * 3)
        .then(c => ({ ticker: "SPY", candles: c || [] }))
        .catch(() => ({ ticker: "SPY", candles: [] })),
    ]).then(results => {
      const spyCandles  = results.find(r => r.ticker === "SPY")?.candles || [];
      const stockResults = results.filter(r => r.ticker !== "SPY");

      // {ticker → {dateISO → price}}
      const priceMap = {};
      stockResults.forEach(({ ticker, candles }) => {
        priceMap[ticker] = {};
        candles.forEach(c => {
          const d = c.date || new Date(c.t * 1000).toISOString().slice(0, 10);
          const p = c.price ?? c.c;
          if (d && p != null) priceMap[ticker][d] = p;
        });
      });

      // Prezzo più recente disponibile fino a dateISO
      function priceAt(ticker, dateISO) {
        const m = priceMap[ticker];
        if (!m) return null;
        if (m[dateISO] != null) return m[dateISO];
        const dates = Object.keys(m).sort();
        let last = null;
        for (const d of dates) {
          if (d <= dateISO) last = m[d];
          else break;
        }
        return last;
      }

      // Posizioni con buyDateISO e costoBases in USD
      const positions = stocks
        .map((s, i) => {
          const buyDateISO = (() => {
            const d = parseBuyDate(s.buyDate);
            return d ? d.toISOString().slice(0, 10) : null;
          })();
          // Costo acquisto in USD (fisso — non cambia mai)
          const costUSD = s.qty * toUSD(s.buyPrice, s.currency, eurRate);
          return { ...s, posId: i, buyDateISO, costUSD };
        })
        .sort((a, b) => (a.buyDateISO || "").localeCompare(b.buyDateISO || ""));

      // Prima data disponibile per ogni posizione
      positions.forEach(pos => {
        pos._firstDate = pos.buyDateISO
          ? (Object.keys(priceMap[pos.ticker] || {}).sort().find(d => d >= pos.buyDateISO) || null)
          : null;
      });

      // Tutte le date con dati
      const allDates = [...new Set(
        Object.values(priceMap).flatMap(m => Object.keys(m))
      )].sort();

      // ── Serie storica ────────────────────────────────────────────────────
      // Per ogni giorno calcola:
      //   valore    = Σ qty × prezzoStorico  (in USD)
      //   costoTot  = Σ costUSD per posizioni attive (fisso)
      //   pnlPct    = (valore / costoTot - 1) × 100
      //
      // pnlPct non ha mai spike perché il denominatore (costoTot) è fisso
      // e cresce solo quando entra una nuova posizione — in modo graduale.

      const series = [];

      allDates.forEach(dateISO => {
        let valore   = 0;
        let costoTot = 0;
        let active   = 0;

        positions.forEach(pos => {
          if (!pos._firstDate || dateISO < pos._firstDate) return;
          const p = priceAt(pos.ticker, dateISO);
          if (p == null) return;
          valore   += pos.qty * toUSD(p, pos.currency, eurRate);
          costoTot += pos.costUSD;
          active++;
        });

        if (active === 0 || valore === 0 || costoTot === 0) return;

        const pnlPct = parseFloat(((valore / costoTot - 1) * 100).toFixed(2));
        const label  = new Date(dateISO + "T12:00:00")
          .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

        series.push({ date: dateISO, label, valore, pnlPct });
      });

      setRawSeries(series);

      setBenchmark(spyCandles.map(c => ({
        date: c.date || new Date(c.t * 1000).toISOString().slice(0, 10),
        spy:  c.price ?? c.c,
      })));

      setLoading(false);
    });
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    stocks.map(s => `${s.ticker}-${s.qty}-${s.buyDate}`).join(","),
    eurRate,
  ]);

  // ── Slice per periodo ──────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!rawSeries.length) return [];

    let slice;
    if (period === "Inizio") {
      slice = rawSeries;
    } else {
      const days   = DAYS_MAP[period] || 30;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const filtered = rawSeries.filter(p => p.date >= cutoff);
      slice = filtered.length > 1 ? filtered : rawSeries.slice(-days);
    }

    // Modalità VALORE: usa valore assoluto — nessuna normalizzazione
    // Modalità PERFORMANCE: usa pnlPct già calcolato — nessuna normalizzazione
    // Entrambe non hanno spike perché:
    //   - valore: è la somma reale dei prezzi storici
    //   - pnlPct: denominatore fisso (costo acquisto)

    // Benchmark SPY normalizzato al primo giorno del range
    const bMap   = Object.fromEntries(benchmark.map(b => [b.date, b.spy]));
    const spyBase = bMap[slice[0]?.date]
      ?? benchmark.find(b => b.date >= slice[0]?.date)?.spy;

    return slice.map(p => ({
      ...p,
      // pct = performance relativa al periodo (per modalità "performance nel range")
      pct: parseFloat((p.pnlPct - (slice[0]?.pnlPct ?? 0)).toFixed(2)),
      spyPct: (() => {
        const sv = bMap[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
      })(),
    }));
  }, [rawSeries, benchmark, period]);

  return { chartData, loading };
}
