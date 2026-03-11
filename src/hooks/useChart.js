import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

const DAYS_MAP = { "1M": 30, "3M": 63, "6M": 126, "1A": 252 };

export function useChart(stocks, eurRate, period = "Inizio") {
  const [rawSeries, setRawSeries] = useState([]);
  const [benchmark, setBenchmark] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (stocks.length === 0) return;
    setLoading(true);

    const daysToFetch = 365 * 3;

    const allFetches = [
      ...stocks.map(s =>
        fetchHistory(s.ticker, daysToFetch)
          .then(candles => ({ ticker: s.ticker, candles: candles || [] }))
          .catch(() => ({ ticker: s.ticker, candles: [] }))
      ),
      fetchHistory("SPY", daysToFetch)
        .then(candles => ({ ticker: "SPY", candles: candles || [] }))
        .catch(() => ({ ticker: "SPY", candles: [] })),
    ];

    Promise.all(allFetches).then(results => {
      const spyResult = results.find(r => r.ticker === "SPY");
      const stockResults = results.filter(r => r.ticker !== "SPY");

      // Mappa {dateISO: {ticker: price}}
      const priceMap = {};
      stockResults.forEach(r => {
        r.candles.forEach(c => {
          const dateISO = new Date(c.t * 1000).toISOString().split("T")[0];
          if (!priceMap[dateISO]) priceMap[dateISO] = {};
          priceMap[dateISO][r.ticker] = c.c;
        });
      });

      // Arricchisci con buyDateISO e ordina per data acquisto (cronologico)
      const enriched = stocks
        .map(s => ({
          ...s,
          buyDateISO: (() => {
            const d = parseBuyDate(s.buyDate);
            return d ? d.toISOString().split("T")[0] : null;
          })(),
        }))
        .sort((a, b) => {
          if (!a.buyDateISO) return 1;
          if (!b.buyDateISO) return -1;
          return a.buyDateISO.localeCompare(b.buyDateISO);
        });

      // ── TWR robusto ────────────────────────────────────────────────────────
      // Approccio: per ogni giorno calcola il valore del portafoglio in USD.
      // Il TWR è semplicemente: (ValoreOggi / ValoreIeri) - 1
      // MA quando entra un nuovo titolo, "ValoreIeri" deve includere anche
      // il valore iniziale del nuovo titolo (al suo prezzo di acquisto),
      // altrimenti il denominatore è troppo piccolo e il rendimento esplode.
      //
      // Soluzione corretta:
      // - Teniamo traccia del "valore base" cumulativo del portafoglio
      // - Quando entra un nuovo titolo, aggiungiamo il suo costo al valore base
      // - Il TWR = (ValoreOggi / ValoreBase) - 1 — senza reset, senza moltiplicazioni
      //
      // Questo è equivalente al TWR ma più stabile numericamente.

      const allDates = Object.keys(priceMap).sort();
      const lastKnown = {};
      const series = [];

      // "baseValue" cresce ogni volta che entra un nuovo titolo
      // rappresenta il totale investito cumulativo ai prezzi del giorno di acquisto
      let portfolioBase = null;    // valore base cumulativo (cresce con nuovi acquisti)
      let prevPortfolioValue = null;
      let twrFactor = 1.0;
      let prevActiveSet = new Set();

      allDates.forEach(dateISO => {
        // Aggiorna lastKnown con i prezzi di oggi
        enriched.forEach(s => {
          if (priceMap[dateISO]?.[s.ticker] != null) {
            lastKnown[s.ticker] = priceMap[dateISO][s.ticker];
          }
        });

        // Calcola valore totale oggi in USD (solo titoli già comprati)
        let todayValue = 0;
        const activeToday = new Set();
        enriched.forEach(s => {
          if (!s.buyDateISO || dateISO >= s.buyDateISO) {
            const rawPrice = lastKnown[s.ticker];
            if (rawPrice != null) {
              todayValue += s.qty * toUSD(rawPrice, s.currency, eurRate);
              activeToday.add(s.ticker);
            }
          }
        });

        if (activeToday.size === 0 || todayValue === 0) return;

        const label = new Date(dateISO + "T12:00:00")
          .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

        // Nuovi titoli entrati oggi
        const newEntries = [...activeToday].filter(t => !prevActiveSet.has(t));

        if (prevPortfolioValue === null) {
          // Primo giorno assoluto — inizializza base
          portfolioBase = todayValue;
          twrFactor = 1.0;
          series.push({ date: dateISO, label, valore: todayValue, twr: 0 });
        } else if (newEntries.length > 0) {
          // Entrano nuovi titoli:
          // 1. Prima calcola il rendimento del giorno sui titoli VECCHI
          const oldValue = enriched
            .filter(s => prevActiveSet.has(s.ticker))
            .reduce((sum, s) => {
              const p = lastKnown[s.ticker] || 0;
              return sum + s.qty * toUSD(p, s.currency, eurRate);
            }, 0);

          if (prevPortfolioValue > 0 && oldValue > 0) {
            const dayReturn = (oldValue - prevPortfolioValue) / prevPortfolioValue;
            twrFactor *= (1 + Math.max(-0.15, Math.min(0.15, dayReturn)));
          }

          // 2. Aggiungi il costo dei nuovi titoli al base
          // (usa il prezzo di oggi come proxy del prezzo di acquisto se non c'è la candela esatta)
          newEntries.forEach(t => {
            const s = enriched.find(x => x.ticker === t);
            if (!s) return;
            // Cerca il prezzo nella data di acquisto, altrimenti usa lastKnown
            const buyDatePrice = priceMap[s.buyDateISO]?.[t] || lastKnown[t] || 0;
            portfolioBase += s.qty * toUSD(buyDatePrice, s.currency, eurRate);
          });

          const twrPct = parseFloat(((twrFactor - 1) * 100).toFixed(2));
          series.push({ date: dateISO, label, valore: todayValue, twr: twrPct });
        } else {
          // Giorno normale — nessun nuovo titolo
          if (prevPortfolioValue > 0) {
            const dayReturn = (todayValue - prevPortfolioValue) / prevPortfolioValue;
            twrFactor *= (1 + Math.max(-0.15, Math.min(0.15, dayReturn)));
          }
          const twrPct = parseFloat(((twrFactor - 1) * 100).toFixed(2));
          series.push({ date: dateISO, label, valore: todayValue, twr: twrPct });
        }

        prevPortfolioValue = todayValue;
        prevActiveSet = new Set(activeToday);
      });

      setRawSeries(series);

      // Benchmark SPY
      if (spyResult?.candles?.length) {
        setBenchmark(spyResult.candles.map(c => ({
          date: new Date(c.t * 1000).toISOString().split("T")[0],
          spy: c.c,
        })));
      }

      setLoading(false);
    });
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    stocks.map(s => `${s.ticker}-${s.qty}-${s.buyDate}`).join(","),
    eurRate,
  ]);

  // Slice per periodo + normalizza benchmark
  const chartData = useMemo(() => {
    if (!rawSeries.length) return [];

    let base;
    if (period === "Inizio") {
      base = rawSeries;
    } else {
      const days = DAYS_MAP[period] || 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
      const filtered = rawSeries.filter(p => p.date >= cutoff);
      base = filtered.length > 1 ? filtered : rawSeries.slice(-days);
    }

    const baseTwr = base[0]?.twr ?? 0;
    const bMap = Object.fromEntries(benchmark.map(b => [b.date, b.spy]));
    const spyBase = bMap[base[0]?.date] ?? benchmark.find(b => b.date >= base[0]?.date)?.spy;

    return base.map(p => ({
      ...p,
      pct: parseFloat((((1 + (p.twr ?? 0) / 100) / (1 + baseTwr / 100) - 1) * 100).toFixed(2)),
      spyPct: (() => {
        const sv = bMap[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv - spyBase) / spyBase * 100).toFixed(2));
      })(),
    }));
  }, [rawSeries, benchmark, period]);

  return { chartData, loading };
}
