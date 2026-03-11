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

      // Mappa {ticker: {dateISO: price}}
      const tickerPriceMap = {};
      stockResults.forEach(r => {
        tickerPriceMap[r.ticker] = {};
        r.candles.forEach(c => {
          const dateISO = new Date(c.t * 1000).toISOString().split("T")[0];
          tickerPriceMap[r.ticker][dateISO] = c.c;
        });
      });

      // Trova il prezzo più recente disponibile per un ticker fino a una data
      function getPriceAt(ticker, dateISO) {
        const prices = tickerPriceMap[ticker];
        if (!prices) return null;
        if (prices[dateISO]) return prices[dateISO];
        const dates = Object.keys(prices).sort();
        let last = null;
        for (const d of dates) {
          if (d <= dateISO) last = prices[d];
          else break;
        }
        return last;
      }

      // Arricchisci stocks con buyDateISO, ordinati cronologicamente
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

      // Raccoglie tutte le date con prezzi disponibili
      const allDatesSet = new Set();
      enriched.forEach(s => {
        Object.keys(tickerPriceMap[s.ticker] || {}).forEach(d => {
          allDatesSet.add(d);
        });
      });
      const allDates = [...allDatesSet].sort();

      // ── TWR giorno-per-giorno CORRETTO ───────────────────────────────────
      //
      // Regola fondamentale del TWR:
      // Quando entra un nuovo titolo al giorno D:
      //   - Il rendimento di D si calcola SOLO sui titoli già presenti (D-1 → D)
      //   - Il valore "di partenza" per il giorno successivo è:
      //     valore_vecchi_titoli_oggi + valore_nuovo_titolo_oggi
      //   - Il twrFactor NON viene moltiplicato per il peso del nuovo titolo
      //
      // Implementazione: teniamo prevValue = valore portafoglio fine giornata,
      // ma quando entrano nuovi titoli aggiungiamo il loro valore a prevValue
      // PRIMA di calcolare il rendimento del giorno successivo.
      // Così il denominatore è sempre corretto.

      const series = [];
      let twrFactor = 1.0;
      let prevValue = null;          // valore fine giornata (aggiustato per nuovi ingressi)
      let prevActiveSet = new Set();

      allDates.forEach(dateISO => {
        // Titoli attivi oggi (buyDateISO <= dateISO e prezzo disponibile)
        const activeToday = new Set();
        let todayValue = 0;

        enriched.forEach(s => {
          if (!s.buyDateISO || dateISO < s.buyDateISO) return;
          const rawPrice = getPriceAt(s.ticker, dateISO);
          if (rawPrice == null) return;
          todayValue += s.qty * toUSD(rawPrice, s.currency, eurRate);
          activeToday.add(s.ticker);
        });

        if (activeToday.size === 0 || todayValue === 0) return;

        const newEntries = [...activeToday].filter(t => !prevActiveSet.has(t));
        const label = new Date(dateISO + "T12:00:00")
          .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

        if (prevValue === null) {
          // Primo giorno assoluto
          twrFactor = 1.0;
          prevValue = todayValue;
          prevActiveSet = new Set(activeToday);
          series.push({ date: dateISO, label, valore: todayValue, twr: 0 });
          return;
        }

        if (newEntries.length > 0) {
          // Giorno con nuovi ingressi:
          // Step 1 — rendimento sui titoli VECCHI (da ieri a oggi)
          let oldValueToday = 0;
          enriched.forEach(s => {
            if (!prevActiveSet.has(s.ticker)) return;
            const rawPrice = getPriceAt(s.ticker, dateISO);
            if (rawPrice == null) return;
            oldValueToday += s.qty * toUSD(rawPrice, s.currency, eurRate);
          });

          if (prevValue > 0 && oldValueToday > 0) {
            const dayReturn = (oldValueToday - prevValue) / prevValue;
            // Nessun cap — se i dati sono corretti non ci sarà spike
            twrFactor *= (1 + dayReturn);
          }

          // Step 2 — aggiorna prevValue includendo i nuovi titoli
          // (così domani il denominatore sarà corretto)
          prevValue = todayValue; // include già vecchi + nuovi
        } else {
          // Giorno normale
          if (prevValue > 0) {
            const dayReturn = (todayValue - prevValue) / prevValue;
            twrFactor *= (1 + dayReturn);
          }
          prevValue = todayValue;
        }

        prevActiveSet = new Set(activeToday);
        const twr = parseFloat(((twrFactor - 1) * 100).toFixed(2));
        series.push({ date: dateISO, label, valore: todayValue, twr });
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

  // Slice per periodo + normalizza al primo punto del range
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
    const spyBase = bMap[base[0]?.date]
      ?? benchmark.find(b => b.date >= base[0]?.date)?.spy;

    return base.map(p => ({
      ...p,
      pct: parseFloat((((1 + p.twr / 100) / (1 + baseTwr / 100) - 1) * 100).toFixed(2)),
      spyPct: (() => {
        const sv = bMap[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv - spyBase) / spyBase * 100).toFixed(2));
      })(),
    }));
  }, [rawSeries, benchmark, period]);

  return { chartData, loading };
}
