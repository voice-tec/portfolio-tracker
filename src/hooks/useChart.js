import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

const DAYS_MAP = { "1M": 30, "3M": 63, "6M": 126, "1A": 252 };

export function useChart(stocks, eurRate, period = "1A") {
  const [rawSeries, setRawSeries] = useState([]);
  const [benchmark, setBenchmark] = useState([]);
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
      const spyCandles   = results.find(r => r.ticker === "SPY")?.candles || [];
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

      // Posizioni ordinate per data acquisto
      const positions = stocks
        .map((s, i) => {
          const buyDateISO = (() => {
            const d = parseBuyDate(s.buyDate);
            return d ? d.toISOString().slice(0, 10) : null;
          })();
          const costUSD = s.qty * toUSD(s.buyPrice, s.currency, eurRate);
          const firstDate = buyDateISO
            ? (Object.keys(priceMap[s.ticker] || {}).sort().find(d => d >= buyDateISO) || null)
            : null;
          return { ...s, posId: i, buyDateISO, costUSD, firstDate };
        })
        .sort((a, b) => (a.firstDate || "").localeCompare(b.firstDate || ""));

      // Tutte le date disponibili
      const allDates = [...new Set(
        Object.values(priceMap).flatMap(m => Object.keys(m))
      )].sort();

      // ── Costruisci serie con rendimento % continuo ────────────────────────
      //
      // Idea: ogni posizione contribuisce con il suo rendimento % individuale
      // pesato sul suo peso nel portafoglio al momento dell'ingresso.
      //
      // rendimentoPortafoglio(giorno) = 
      //   Σ [ peso_i × rendimento_i(giorno) ]
      //
      // dove:
      //   peso_i = costUSD_i / costoTotale_al_momento_dell_ingresso
      //   rendimento_i(giorno) = prezzoOggi_i / prezzoAcquisto_i - 1
      //
      // Quando entra una nuova posizione, i pesi vengono ricalcolati
      // ma la curva rimane continua perché il rendimento della nuova
      // posizione al giorno di ingresso è 0% — non spika mai.

      const series = [];

      allDates.forEach(dateISO => {
        // Posizioni attive oggi
        const active = positions.filter(p => p.firstDate && dateISO >= p.firstDate);
        if (!active.length) return;

        // Costo totale delle posizioni attive
        const costoTot = active.reduce((s, p) => s + p.costUSD, 0);
        if (!costoTot) return;

        // Rendimento pesato
        let rendimento = 0;
        let valoreOggi = 0;
        let allPrices  = true;

        active.forEach(pos => {
          const prezzoOggi    = priceAt(pos.ticker, dateISO);
          const prezzoAcquisto = toUSD(pos.buyPrice, pos.currency, eurRate);
          if (prezzoOggi == null || !prezzoAcquisto) { allPrices = false; return; }

          const prezzoOggiUSD = toUSD(prezzoOggi, pos.currency, eurRate);
          const peso          = pos.costUSD / costoTot;
          const ret_i         = (prezzoOggiUSD / prezzoAcquisto) - 1;

          rendimento += peso * ret_i;
          valoreOggi += pos.qty * prezzoOggiUSD;
        });

        if (!allPrices || !valoreOggi) return;

        const pct   = parseFloat((rendimento * 100).toFixed(2));
        const label = new Date(dateISO + "T12:00:00")
          .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

        series.push({ date: dateISO, label, valore: valoreOggi, costoTot, pct });
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

  const chartData = useMemo(() => {
    if (!rawSeries.length) return [];

    let slice;
    if (period === "Inizio") {
      slice = rawSeries;
    } else {
      const days   = DAYS_MAP[period] || 252;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const filtered = rawSeries.filter(p => p.date >= cutoff);
      slice = filtered.length > 1 ? filtered : rawSeries.slice(-days);
    }

    // Benchmark SPY normalizzato al valore portafoglio inizio range
    const bMap    = Object.fromEntries(benchmark.map(b => [b.date, b.spy]));
    const spyBase = bMap[slice[0]?.date]
      ?? benchmark.find(b => b.date >= slice[0]?.date)?.spy;
    const valBase = slice[0]?.valore ?? 1;

    return slice.map(p => ({
      ...p,
      spyScaled: (() => {
        const sv = bMap[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase) * valBase).toFixed(2));
      })(),
    }));
  }, [rawSeries, benchmark, period]);

  return { chartData, loading };
}
