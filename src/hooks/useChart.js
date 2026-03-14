import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

export const PERIODS = ["1G", "1M", "6M", "1A", "Inizio"];

// Restituisce la data di cutoff per ogni periodo
function getCutoff(period) {
  const d = new Date();
  if (period === "1M")  { d.setMonth(d.getMonth() - 1); }
  if (period === "6M")  { d.setMonth(d.getMonth() - 6); }
  if (period === "1A")  { d.setFullYear(d.getFullYear() - 1); }
  return d.toISOString().slice(0, 10);
}

export function useChart(stocks, eurRate) {
  // rawPrices: { ticker → [ {date, price} ] } — prezzi storici adj
  const [rawPrices, setRawPrices] = useState({});
  const [spyPrices, setSpyPrices] = useState([]);
  const [loading, setLoading]     = useState(false);

  // ── 1. Fetch prezzi storici ──────────────────────────────────────────────
  useEffect(() => {
    if (!stocks.length) return;
    setLoading(true);

    const tickers = [...new Set(stocks.map(s => s.ticker))];

    Promise.all([
      ...tickers.map(t =>
        fetchHistory(t, 1000)
          .then(c => [t, c || []])
          .catch(() => [t, []])
      ),
      fetchHistory("SPY", 1000)
        .then(c => ["SPY", c || []])
        .catch(() => ["SPY", []]),
    ]).then(results => {
      const spy = results.find(([t]) => t === "SPY")?.[1] || [];
      const map = {};
      results
        .filter(([t]) => t !== "SPY")
        .forEach(([t, candles]) => { map[t] = candles; });
      setRawPrices(map);
      setSpyPrices(spy);
      setLoading(false);
    });
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    stocks.map(s => `${s.ticker}-${s.qty}-${s.buyPrice}-${s.buyDate}`).join(","),
  ]);

  // ── 2. Indicizzazione veloce: { ticker → { date → price } } ─────────────
  const priceIndex = useMemo(() => {
    const idx = {};
    Object.entries(rawPrices).forEach(([t, candles]) => {
      idx[t] = {};
      candles.forEach(c => { idx[t][c.date] = c.price; });
    });
    return idx;
  }, [rawPrices]);

  const spyIndex = useMemo(() => {
    const idx = {};
    spyPrices.forEach(c => { idx[c.date] = c.price; });
    return idx;
  }, [spyPrices]);

  // ── 3. Info posizioni ─────────────────────────────────────────────────────
  const positions = useMemo(() =>
    stocks.map(s => {
      const bd = parseBuyDate(s.buyDate);
      return {
        ticker:     s.ticker,
        qty:        parseFloat(s.qty) || 0,
        buyPrice:   toUSD(parseFloat(s.buyPrice) || 0, s.currency, eurRate),
        buyDateISO: bd ? bd.toISOString().slice(0, 10) : "1970-01-01",
        currency:   s.currency,
      };
    }),
  [stocks, eurRate]);

  // ── 4. Forward-fill helper ────────────────────────────────────────────────
  // Dato un ticker e una data, restituisce il prezzo più recente disponibile
  function priceAt(ticker, date) {
    const candles = rawPrices[ticker];
    if (!candles?.length) return null;
    // Cerca il prezzo esatto o il più vicino precedente
    let best = null;
    for (const c of candles) {
      if (c.date <= date) best = c.price;
      else break;
    }
    return best;
  }

  function spyAt(date) {
    const sorted = spyPrices;
    let best = null;
    for (const c of sorted) {
      if (c.date <= date) best = c.price;
      else break;
    }
    return best;
  }

  // ── 5. Valore portafoglio in una data specifica ──────────────────────────
  // Considera solo le posizioni già acquistate a quella data
  function portfolioValueAt(date) {
    let total = 0;
    for (const pos of positions) {
      if (date < pos.buyDateISO) continue; // non ancora acquistato
      const p = priceAt(pos.ticker, date);
      if (p == null) return null; // dati mancanti
      total += pos.qty * toUSD(p, pos.currency ?? "USD", eurRate);
    }
    return total > 0 ? total : null;
  }

  // ── 6. buildPeriod: costruisce chartData e pill per un periodo ────────────
  // Approccio:
  //   - Prende tutte le date disponibili nel range
  //   - Per ogni data calcola portfolioValue
  //   - Normalizza a 0% dal primo punto
  //   - pill = ultimo punto (identico al tooltip per costruzione)
  function buildPeriod(period) {
    if (!Object.keys(rawPrices).length || !positions.length) {
      return { chartData: [], pill: null };
    }

    // Data del primo acquisto
    const earliestBuy = positions
      .map(p => p.buyDateISO)
      .sort()[0];

    // Cutoff del periodo
    let cutoff;
    if (period === "Inizio") {
      cutoff = earliestBuy;
    } else if (period === "1G") {
      // Ultimi 2 giorni di mercato disponibili
      const allDates = [...new Set(
        Object.values(rawPrices).flatMap(c => c.map(x => x.date))
      )].sort().filter(d => d >= earliestBuy);

      if (allDates.length < 2) return { chartData: [], pill: null };
      const last2 = allDates.slice(-2);

      const chartData = last2.map((date, i) => {
        const v = portfolioValueAt(date);
        return { date, label: fmtLabel(date), valore: v, pct: 0, spyPct: null, _v: v };
      }).filter(p => p.valore != null);

      if (chartData.length < 2) return { chartData: [], pill: null };
      const base = chartData[0].valore;
      chartData.forEach(p => { p.pct = base > 0 ? +((p.valore - base) / base * 100).toFixed(2) : 0; });
      return { chartData, pill: { pct: chartData[chartData.length - 1].pct, delta: chartData[chartData.length - 1].valore - base } };
    } else {
      const raw = getCutoff(period);
      // Se il cutoff è prima del primo acquisto → usa earliestBuy
      cutoff = raw < earliestBuy ? earliestBuy : raw;
    }

    // Tutte le date disponibili nel range [cutoff, oggi]
    const allDates = [...new Set(
      Object.values(rawPrices).flatMap(c => c.map(x => x.date))
    )].sort().filter(d => d >= cutoff);

    if (allDates.length < 2) return { chartData: [], pill: null };

    // Calcola valore per ogni data
    const points = [];
    for (const date of allDates) {
      const v = portfolioValueAt(date);
      if (v != null) {
        points.push({ date, label: fmtLabel(date), valore: v });
      }
    }

    if (points.length < 2) return { chartData: [], pill: null };

    // Base: valore al primo punto del range
    const base     = points[0].valore;
    const spyBase  = spyAt(points[0].date);

    const chartData = points.map(p => ({
      ...p,
      pct:    base > 0 ? +((p.valore - base) / base * 100).toFixed(2) : 0,
      spyPct: spyBase && spyAt(p.date)
        ? +((spyAt(p.date) / spyBase - 1) * 100).toFixed(2)
        : null,
    }));

    const pill = {
      pct:   chartData[chartData.length - 1].pct,
      delta: points[points.length - 1].valore - base,
    };

    return { chartData, pill };
  }

  function fmtLabel(date) {
    return new Date(date + "T12:00:00")
      .toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  }

  // ── 7. totalInvested per header P&L ──────────────────────────────────────
  const totalInvested = useMemo(() =>
    positions.reduce((s, p) => s + p.qty * p.buyPrice, 0),
  [positions]);

  return { loading, buildPeriod, totalInvested };
}
