import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

const DAYS_MAP = { "1M": 30, "3M": 63, "6M": 126, "1A": 365 };

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
        fetchHistory(ticker, 1000)
          .then(c => ({ ticker, candles: c || [] }))
          .catch(() => ({ ticker, candles: [] }))
      ),
      fetchHistory("SPY", 1000)
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

      // Posizioni con buyDateISO e costo in USD
      const positions = stocks.map((s, i) => {
        const buyDateISO = (() => {
          const d = parseBuyDate(s.buyDate);
          return d ? d.toISOString().slice(0, 10) : null;
        })();
        const costUSD = (parseFloat(s.qty) || 0) * toUSD(parseFloat(s.buyPrice) || 0, s.currency, eurRate);
        // Prima candela disponibile >= buyDate
        const availDates = Object.keys(priceMap[s.ticker] || {}).sort();
        const firstDate  = buyDateISO
          ? (availDates.find(d => d >= buyDateISO) || null)
          : availDates[0] || null;
        return { ...s, posId: i, buyDateISO, costUSD, firstDate };
      });

      // Tutte le date disponibili nei dati storici
      const allDates = [...new Set(
        Object.values(priceMap).flatMap(m => Object.keys(m))
      )].sort();

      // ── Costruisci serie completa (da prima data disponibile a oggi) ──────
      // Per ogni giorno:
      //   - considera solo le posizioni già attive (firstDate <= dateISO)
      //   - se nessuna posizione è attiva → skip (non mostrare nulla)
      //   - calcola rendimento pesato: Σ(peso_i × ret_i)
      //     dove ret_i = prezzoOggi/prezzoAcquisto - 1
      //     e peso_i   = costUSD_i / costoTotale_attivo
      //
      // Questo garantisce:
      //   - 0% esatto al giorno del primo acquisto
      //   - nessuno spike quando entra nuovo titolo
      //   - curva continua

      const series = [];

      allDates.forEach(dateISO => {
        const active = positions.filter(p => p.firstDate && dateISO >= p.firstDate);
        if (!active.length) return;

        const costoTot = active.reduce((s, p) => s + p.costUSD, 0);
        if (!costoTot) return;

        let rendimento = 0;
        let valoreOggi = 0;
        let valid = true;

        for (const pos of active) {
          const rawPrice       = priceAt(pos.ticker, dateISO);
          const buyPriceUSD    = toUSD(parseFloat(pos.buyPrice) || 0, pos.currency, eurRate);
          if (rawPrice == null || !buyPriceUSD) { valid = false; break; }

          const prezzoOggiUSD  = toUSD(parseFloat(rawPrice), pos.currency, eurRate);
          const peso           = pos.costUSD / costoTot;
          rendimento          += peso * (prezzoOggiUSD / buyPriceUSD - 1);
          valoreOggi          += (parseFloat(pos.qty) || 0) * prezzoOggiUSD;
        }

        if (!valid || !valoreOggi) return;

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

  // ── Slice per periodo ──────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!rawSeries.length) return [];

    let slice;
    if (period === "Inizio") {
      // Tutto lo storico dalla prima data di acquisto
      slice = rawSeries;
    } else {
      const days   = DAYS_MAP[period] || 365;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      // Prendi tutti i punti dal cutoff in poi
      // Se non ci sono abbastanza dati (titolo comprato dopo il cutoff),
      // mostra comunque dal cutoff — la curva inizierà quando c'è il primo dato
      const filtered = rawSeries.filter(p => p.date >= cutoff);
      slice = filtered.length > 0 ? filtered : rawSeries;
    }

    if (!slice.length) return [];

    // Normalizza pct al primo punto del range (parte da 0%)
    const basePct = slice[0]?.pct ?? 0;

    // Benchmark SPY normalizzato al primo giorno del range
    const bMap    = Object.fromEntries(benchmark.map(b => [b.date, b.spy]));
    const spyBase = bMap[slice[0]?.date]
      ?? benchmark.find(b => b.date >= slice[0]?.date)?.spy;

    return slice.map(p => ({
      ...p,
      pct: parseFloat((p.pct - basePct).toFixed(2)),
      spyPct: (() => {
        const sv = bMap[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
      })(),
    }));
  }, [rawSeries, benchmark, period]);

  // ── Rendimenti periodali da valore assoluto (non normalizzato) ──────────────
  // Usa rawSeries.valore (USD) — non tocca pct che è normalizzata per il grafico
  const periodReturns = useMemo(() => {
    if (rawSeries.length < 2) return { day: null, month: null, threeMonth: null, year: null };

    const last = rawSeries[rawSeries.length - 1];
    const d    = new Date(last.date + "T12:00:00");

    // Cerca il punto con data <= targetISO più vicino
    function pointAt(targetISO) {
      let found = null;
      for (const p of rawSeries) {
        if (p.date <= targetISO) found = p;
        else break;
      }
      return found;
    }

    function pct(from) {
      if (!from?.valore || !last.valore) return null;
      return parseFloat(((last.valore - from.valore) / from.valore * 100).toFixed(2));
    }

    // 1G: giorno lavorativo precedente (cerca indietro fino a 5 giorni)
    let prev1d = null;
    for (let i = rawSeries.length - 2; i >= 0; i--) {
      prev1d = rawSeries[i];
      break;
    }

    // 1M: punto più vicino a 30 giorni fa
    const ago1m = new Date(d - 30 * 86400000).toISOString().slice(0, 10);
    const prevMonthEnd = pointAt(ago1m);

    // 3M e 1A
    const ago3m = new Date(d - 91  * 86400000).toISOString().slice(0, 10);
    const ago1y = new Date(d - 365 * 86400000).toISOString().slice(0, 10);

    return {
      day:        pct(prev1d),
      month:      pct(prevMonthEnd),
      threeMonth: pct(pointAt(ago3m)),
      year:       pct(pointAt(ago1y)),
    };
  }, [rawSeries]);

  return { chartData, loading, periodReturns };
}
