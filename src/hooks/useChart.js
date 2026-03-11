import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

const DAYS_MAP = { "1M": 30, "3M": 63, "6M": 126, "1A": 252 };

/**
 * Calcola il Time-Weighted Return (TWR) per un portafoglio multi-titolo multi-valuta.
 *
 * Algoritmo:
 * - Per ogni giorno, calcola il valore totale del portafoglio in USD
 * - Quando entra un nuovo titolo, il rendimento del giorno è calcolato solo
 *   sulla parte "vecchia" del portafoglio (metodo TWR standard)
 * - Il TWR cumulativo è il prodotto di tutti i rendimenti giornalieri
 */
export function useChart(stocks, eurRate, period = "Inizio") {
  const [rawSeries, setRawSeries] = useState([]);   // [{date, label, valore, twr}]
  const [benchmark, setBenchmark] = useState([]);    // [{date, spy}]
  const [loading, setLoading] = useState(false);

  // ── Fetch dati storici ────────────────────────────────────────────────────
  useEffect(() => {
    if (stocks.length === 0) return;
    setLoading(true);

    const daysToFetch = 365 * 3; // max 3 anni

    // Fetch storia di ogni titolo + SPY
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

      // Costruisci mappa {dateISO: {ticker: price}}
      const priceMap = {};
      stockResults.forEach(r => {
        r.candles.forEach(c => {
          const dateISO = new Date(c.t * 1000).toISOString().split("T")[0];
          if (!priceMap[dateISO]) priceMap[dateISO] = {};
          priceMap[dateISO][r.ticker] = c.c;
        });
      });

      // Arricchisci stocks con buyDateISO e eurRate
      const enriched = stocks.map(s => ({
        ...s,
        buyDateISO: (() => { const d = parseBuyDate(s.buyDate); return d ? d.toISOString().split("T")[0] : null; })(),
        eurRate,
      }));

      // ── Calcolo TWR ────────────────────────────────────────────────────────
      const allDates = Object.keys(priceMap).sort();
      const lastKnown = {};
      const series = [];
      let prevDayValue = null;
      let twrFactor = 1.0;
      let prevActiveSet = new Set();

      allDates.forEach(dateISO => {
        // Aggiorna prezzi noti
        enriched.forEach(s => {
          if (priceMap[dateISO]?.[s.ticker] != null) {
            lastKnown[s.ticker] = priceMap[dateISO][s.ticker];
          }
        });

        // Valore totale in USD dei titoli attivi oggi
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

        if (prevDayValue === null) {
          // Primo giorno: TWR parte da 0%
          twrFactor = 1.0;
          series.push({ date: dateISO, label, valore: todayValue, twr: 0 });
        } else {
          const newEntries = [...activeToday].filter(t => !prevActiveSet.has(t));

          if (newEntries.length > 0) {
            // Nuovi acquisti: rendimento solo sulla parte vecchia del portafoglio
            // Valore di OGGI per i titoli già esistenti
            let oldPartToday = 0;
            enriched.forEach(s => {
              if (prevActiveSet.has(s.ticker)) {
                const rawPrice = lastKnown[s.ticker] || 0;
                oldPartToday += s.qty * toUSD(rawPrice, s.currency, eurRate);
              }
            });

            // Valore di IERI totale meno il valore di acquisto dei nuovi titoli (in USD)
            const newEntriesValueAtBuy = newEntries.reduce((sum, t) => {
              const s = enriched.find(x => x.ticker === t);
              if (!s) return sum;
              const rawBuyPrice = priceMap[s.buyDateISO]?.[t] || lastKnown[t] || 0;
              return sum + s.qty * toUSD(rawBuyPrice, s.currency, eurRate);
            }, 0);

            const oldYesterday = prevDayValue - newEntriesValueAtBuy;

            if (oldYesterday > 0 && oldPartToday > 0) {
              const dayReturn = (oldPartToday - oldYesterday) / oldYesterday;
              // Cap ±30% per evitare spike matematici su dati mancanti
              twrFactor *= (1 + Math.max(-0.3, Math.min(0.3, dayReturn)));
            }
          } else {
            // Nessun nuovo titolo: rendimento normale
            const dayReturn = prevDayValue > 0
              ? (todayValue - prevDayValue) / prevDayValue
              : 0;
            twrFactor *= (1 + Math.max(-0.3, Math.min(0.3, dayReturn)));
          }

          const twrPct = parseFloat(((twrFactor - 1) * 100).toFixed(2));
          series.push({ date: dateISO, label, valore: todayValue, twr: twrPct });
        }

        prevDayValue = todayValue;
        prevActiveSet = new Set(activeToday);
      });

      setRawSeries(series);

      // Benchmark SPY
      if (spyResult?.candles?.length) {
        const spyData = spyResult.candles.map(c => ({
          date: new Date(c.t * 1000).toISOString().split("T")[0],
          spy: c.c,
        }));
        setBenchmark(spyData);
      }

      setLoading(false);
    });
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    stocks.map(s => `${s.ticker}-${s.qty}-${s.buyDate}`).join(","),
    eurRate,
  ]);

  // ── Slice per periodo selezionato ─────────────────────────────────────────
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

    // Resetta TWR all'inizio del range
    const baseTwr = base[0]?.twr ?? 0;

    // Benchmark normalizzato all'inizio del range
    const bMap = Object.fromEntries(benchmark.map(b => [b.date, b.spy]));
    const spyBase = bMap[base[0]?.date]
      ?? benchmark.find(b => b.date >= base[0]?.date)?.spy;

    return base.map(p => ({
      ...p,
      pct: parseFloat(
        (((1 + (p.twr ?? 0) / 100) / (1 + baseTwr / 100) - 1) * 100).toFixed(2)
      ),
      spyPct: (() => {
        const sv = bMap[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv - spyBase) / spyBase * 100).toFixed(2));
      })(),
    }));
  }, [rawSeries, benchmark, period]);

  return { chartData, loading };
}
