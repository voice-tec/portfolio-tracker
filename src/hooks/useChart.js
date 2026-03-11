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

      // Mappa prezzi {ticker: {dateISO: price}}
      const tickerPriceMap = {};
      stockResults.forEach(r => {
        tickerPriceMap[r.ticker] = {};
        r.candles.forEach(c => {
          const dateISO = new Date(c.t * 1000).toISOString().split("T")[0];
          tickerPriceMap[r.ticker][dateISO] = c.c;
        });
      });

      // Per ogni titolo, trova il prezzo più vicino a una data
      function getPriceAt(ticker, dateISO) {
        const prices = tickerPriceMap[ticker];
        if (!prices) return null;
        if (prices[dateISO]) return prices[dateISO];
        // Cerca il prezzo più recente disponibile prima di questa data
        const dates = Object.keys(prices).sort();
        let last = null;
        for (const d of dates) {
          if (d <= dateISO) last = prices[d];
          else break;
        }
        return last;
      }

      // Arricchisci con buyDateISO e prezzo di acquisto storico
      const enriched = stocks.map(s => {
        const buyDateISO = (() => {
          const d = parseBuyDate(s.buyDate);
          return d ? d.toISOString().split("T")[0] : null;
        })();
        // Prezzo storico alla data di acquisto (in USD)
        const buyPriceHistorical = buyDateISO
          ? toUSD(getPriceAt(s.ticker, buyDateISO) || s.buyPrice, s.currency, eurRate)
          : toUSD(s.buyPrice, s.currency, eurRate);

        return { ...s, buyDateISO, buyPriceHistorical };
      });

      // Raccoglie tutte le date con almeno un titolo attivo
      const allDatesSet = new Set();
      enriched.forEach(s => {
        if (!s.buyDateISO) return;
        Object.keys(tickerPriceMap[s.ticker] || {}).forEach(d => {
          if (d >= s.buyDateISO) allDatesSet.add(d);
        });
      });
      const allDates = [...allDatesSet].sort();

      // ── Algoritmo TWR corretto ────────────────────────────────────────────
      // Per ogni giorno:
      //   1. Calcola il valore attuale del portafoglio (solo titoli attivi)
      //   2. Calcola il "valore base" = somma dei costi di acquisto storici
      //   3. TWR% = (valoreAttuale / valoreBase) - 1
      //
      // Questo evita qualsiasi spike perché non dipende dal giorno precedente.
      // Il rendimento è sempre relativo al costo di acquisto reale.

      const series = [];

      allDates.forEach(dateISO => {
        let todayValue = 0;
        let baseValue = 0;
        let activeCount = 0;

        enriched.forEach(s => {
          if (!s.buyDateISO || dateISO < s.buyDateISO) return;
          const rawPrice = getPriceAt(s.ticker, dateISO);
          if (rawPrice == null) return;

          const priceUSD = toUSD(rawPrice, s.currency, eurRate);
          todayValue += s.qty * priceUSD;
          baseValue  += s.qty * s.buyPriceHistorical;
          activeCount++;
        });

        if (activeCount === 0 || baseValue === 0) return;

        const twr = parseFloat(((todayValue / baseValue - 1) * 100).toFixed(2));
        const label = new Date(dateISO + "T12:00:00")
          .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

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

    // Normalizza: il primo punto del range = 0%
    // Converti twr assoluto in twr relativo al periodo selezionato
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
