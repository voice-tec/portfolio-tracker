import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

const DAYS_MAP = { "1M": 30, "3M": 63, "6M": 126, "1A": 252 };

export function useChart(stocks, eurRate, period = "Inizio") {
  const [rawSeries, setRawSeries]   = useState([]); // [{date, label, valore}]
  const [benchmark, setBenchmark]   = useState([]); // [{date, spy}]
  const [loading, setLoading]       = useState(false);

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
      const spyCandles = results.find(r => r.ticker === "SPY")?.candles || [];
      const stockResults = results.filter(r => r.ticker !== "SPY");

      // Mappa {ticker → {dateISO → price}}
      const priceMap = {};
      stockResults.forEach(({ ticker, candles }) => {
        priceMap[ticker] = {};
        candles.forEach(c => {
          const d = c.date || new Date(c.t * 1000).toISOString().slice(0, 10);
          const p = c.price ?? c.c;
          if (d && p != null) priceMap[ticker][d] = p;
        });
      });

      // Prezzo più recente disponibile per ticker fino a dateISO
      function priceAt(ticker, dateISO) {
        const m = priceMap[ticker];
        if (!m) return null;
        if (m[dateISO] != null) return m[dateISO];
        // cerca indietro
        const dates = Object.keys(m).sort();
        let last = null;
        for (const d of dates) {
          if (d <= dateISO) last = m[d];
          else break;
        }
        return last;
      }

      // Posizioni: ogni riga DB è una posizione con posId univoco
      const positions = stocks
        .map((s, i) => ({
          ...s,
          posId: i,
          buyDateISO: (() => {
            const d = parseBuyDate(s.buyDate);
            return d ? d.toISOString().slice(0, 10) : null;
          })(),
        }))
        .sort((a, b) => (a.buyDateISO || "").localeCompare(b.buyDateISO || ""));

      // Tutte le date con dati disponibili
      const allDates = [...new Set(
        Object.values(priceMap).flatMap(m => Object.keys(m))
      )].sort();

      // ── Costruisci serie: valore portafoglio per ogni giorno ──────────────
      // Semplice: per ogni data, somma qty×prezzo per le posizioni già attive.
      // Nessun TWR, nessuna matematica complicata.
      // Il % lo calcoliamo dopo in useMemo, normalizzato al range selezionato.

      const series = [];
      positions.forEach(pos => {
        // Pre-calcola la prima data disponibile per questa posizione
        pos._firstDate = pos.buyDateISO
          ? allDates.find(d => d >= pos.buyDateISO && priceAt(pos.ticker, d) != null)
          : null;
      });

      allDates.forEach(dateISO => {
        let valore = 0;
        let active = 0;

        positions.forEach(pos => {
          if (!pos._firstDate || dateISO < pos._firstDate) return;
          const p = priceAt(pos.ticker, dateISO);
          if (p == null) return;
          valore += pos.qty * toUSD(p, pos.currency, eurRate);
          active++;
        });

        if (active === 0 || valore === 0) return;

        const label = new Date(dateISO + "T12:00:00")
          .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

        series.push({ date: dateISO, label, valore });
      });

      setRawSeries(series);

      // Benchmark SPY
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

  // ── Normalizza al periodo selezionato ──────────────────────────────────────
  // pct = (valoreOggi / valoreBase - 1) × 100
  // valoreBase = valore del portafoglio al PRIMO giorno del range
  //
  // Quando entra un nuovo titolo DENTRO il range:
  //   - valoreBase viene "aumentato" del costo del nuovo titolo
  //   - così la % continua senza spike
  //
  // Questo è esattamente come funziona Getquin/Parqet.

  const chartData = useMemo(() => {
    if (!rawSeries.length) return [];

    // Slice per periodo
    let slice;
    if (period === "Inizio") {
      slice = rawSeries;
    } else {
      const days = DAYS_MAP[period] || 30;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const filtered = rawSeries.filter(p => p.date >= cutoff);
      slice = filtered.length > 1 ? filtered : rawSeries.slice(-days);
    }

    if (!slice.length) return [];

    // Valore base = valore al primo giorno del range
    let base = slice[0].valore;

    // Aggiustamento base per nuovi ingressi dentro il range:
    // se il valore salta di più del 50% in un giorno → nuovo titolo entrato
    // aggiungiamo la differenza al base così la % non spika
    const adjusted = [];
    let prevValore = slice[0].valore;

    slice.forEach((p, i) => {
      if (i === 0) {
        adjusted.push({ ...p, pct: 0 });
        prevValore = p.valore;
        return;
      }

      const jump = prevValore > 0 ? (p.valore - prevValore) / prevValore : 0;

      // Se salto > 25% in un giorno, quasi certamente è un nuovo acquisto
      // Aggiustiamo base in modo che la % rimanga continua
      if (jump > 0.25) {
        // Quanto vale il portafoglio "vecchio" oggi?
        // Non lo sappiamo esattamente, ma il valore precedente + crescita normale
        // è una buona stima. Aumentiamo base della differenza.
        base += (p.valore - prevValore);
      }

      const pct = base > 0 ? parseFloat(((p.valore / base - 1) * 100).toFixed(2)) : 0;
      adjusted.push({ ...p, pct });
      prevValore = p.valore;
    });

    // Benchmark SPY normalizzato
    const bMap = Object.fromEntries(benchmark.map(b => [b.date, b.spy]));
    const spyBase = bMap[slice[0].date]
      ?? benchmark.find(b => b.date >= slice[0].date)?.spy;

    return adjusted.map(p => ({
      ...p,
      spyPct: (() => {
        const sv = bMap[p.date];
        if (!sv || !spyBase) return null;
        return parseFloat(((sv / spyBase - 1) * 100).toFixed(2));
      })(),
    }));
  }, [rawSeries, benchmark, period]);

  return { chartData, loading };
}
