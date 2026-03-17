import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";

// Calcola rendimento pesato per valore per un dato cutoff
function calcWeightedReturn(stocks, histories, cutoffISO) {
  let totalValue = 0;
  let weightedSum = 0;

  for (const s of stocks) {
    const candles = histories[s.ticker];
    if (!candles?.length) continue;

    const getPrice = (date) => {
      let last = null;
      for (const c of candles) {
        if (c.date <= date) last = c.price;
        else break;
      }
      return last;
    };

    const priceNow = candles[candles.length - 1]?.price;
    if (!priceNow) continue;

    const valueNow = (parseFloat(s.qty) || 0) * priceNow;
    totalValue += valueNow;

    // Base: max(buyDate, cutoff) → se comprato dopo il cutoff usa buyPrice
    const buyDateISO = (() => {
      const bd = parseBuyDate(s.buyDate);
      return bd ? bd.toISOString().slice(0, 10) : cutoffISO;
    })();

    const basePrice = buyDateISO > cutoffISO
      ? (parseFloat(s.buyPrice) || priceNow)
      : (getPrice(cutoffISO) ?? parseFloat(s.buyPrice) ?? priceNow);

    const ret = (priceNow - basePrice) / basePrice * 100;
    weightedSum += ret * valueNow;
  }

  return totalValue > 0 ? weightedSum / totalValue : null;
}

export function OverviewWidgets({ stocks, eurRate, totalValue, totalInvested, totalPnL, totalPct, fmt, sym }) {
  const [histories, setHistories] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!stocks.length) return;
    setLoading(true);
    const tickers = [...new Set(stocks.map(s => s.ticker))];
    Promise.all(
      tickers.map(t =>
        fetchHistory(t, 400)
          .then(c => ({ ticker: t, candles: c || [] }))
          .catch(() => ({ ticker: t, candles: [] }))
      )
    ).then(results => {
      const map = {};
      results.forEach(({ ticker, candles }) => { map[ticker] = candles; });
      setHistories(map);
      setLoading(false);
    });
  }, [stocks.map(s => `${s.ticker}-${s.qty}-${s.buyPrice}-${s.buyDate}`).join(",")]);

  // Cutoff per ogni periodo
  const cutoffs = useMemo(() => ({
    "1G": (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })(),
    "1M": (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })(),
    "6M": (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); })(),
    "1A": (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })(),
  }), []);

  // Rendimenti per periodo
  const returns = useMemo(() => {
    if (!Object.keys(histories).length) return {};
    const r = {};
    for (const [period, cutoff] of Object.entries(cutoffs)) {
      r[period] = calcWeightedReturn(stocks, histories, cutoff);
    }
    return r;
  }, [histories, stocks, cutoffs]);

  // Miglior e peggior titolo (da Inizio)
  const bestWorst = useMemo(() => {
    if (!Object.keys(histories).length) return null;
    const perfs = stocks.map(s => {
      const candles = histories[s.ticker];
      if (!candles?.length) return null;
      const priceNow = candles[candles.length - 1]?.price;
      const buyPrice = parseFloat(s.buyPrice);
      if (!priceNow || !buyPrice) return null;
      return { ticker: s.ticker, pct: (priceNow - buyPrice) / buyPrice * 100 };
    }).filter(Boolean);

    if (!perfs.length) return null;
    perfs.sort((a, b) => b.pct - a.pct);
    return { best: perfs[0], worst: perfs[perfs.length - 1] };
  }, [histories, stocks]);

  const col  = v => v == null ? "#8A9AB0" : v >= 0 ? "#16A34A" : "#DC2626";
  const sign = v => v != null && v >= 0 ? "+" : "";
  const fmtPct = v => v != null ? `${sign(v)}${Math.abs(v).toFixed(2)}%` : "—";

  const periods = ["1G", "1M", "6M", "1A"];

  return (
    <div style={{ marginBottom: 16 }}>

      {/* ── Riga 1: P&L totale ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10, marginBottom: 10,
      }}>
        {/* P&L assoluto */}
        <div style={{
          background: "#fff", border: "1px solid #E8EBF4", borderRadius: 12,
          padding: "16px 18px",
          borderLeft: `3px solid ${totalPnL >= 0 ? "#16A34A" : "#DC2626"}`,
        }}>
          <div style={{ fontSize: 10, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            P&L Totale
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: col(totalPnL), letterSpacing: "-0.02em", lineHeight: 1 }}>
            {sign(totalPnL)}{sym}{fmt(Math.abs(totalPnL))}
          </div>
          <div style={{ fontSize: 11, color: "#8A9AB0", marginTop: 6 }}>
            Investito: {sym}{fmt(totalInvested)}
          </div>
        </div>

        {/* P&L % */}
        <div style={{
          background: "#fff", border: "1px solid #E8EBF4", borderRadius: 12,
          padding: "16px 18px",
          borderLeft: `3px solid ${totalPct >= 0 ? "#16A34A" : "#DC2626"}`,
        }}>
          <div style={{ fontSize: 10, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Rendimento Totale
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: col(totalPct), letterSpacing: "-0.02em", lineHeight: 1 }}>
            {sign(totalPct)}{Math.abs(totalPct).toFixed(2)}%
          </div>
          <div style={{ fontSize: 11, color: "#8A9AB0", marginTop: 6 }}>
            Valore: {sym}{fmt(totalValue)}
          </div>
        </div>
      </div>

      {/* ── Riga 2: Rendimenti per periodo ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10, marginBottom: 10,
      }}>
        {periods.map(p => {
          const v = loading ? null : (returns[p] ?? null);
          const c = col(v);
          return (
            <div key={p} style={{
              background: "#fff", border: "1px solid #E8EBF4", borderRadius: 12,
              padding: "14px 16px", position: "relative", overflow: "hidden",
            }}>
              {/* Accent bar in alto */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 3,
                background: v == null ? "#E8EBF4" : v >= 0
                  ? "linear-gradient(90deg, #16A34A, #4ADE80)"
                  : "linear-gradient(90deg, #DC2626, #F87171)",
              }} />
              <div style={{ fontSize: 10, color: "#8A9AB0", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
                {p}
              </div>
              {loading ? (
                <div style={{ fontSize: 16, color: "#E0E4EF", fontWeight: 800 }}>…</div>
              ) : (
                <div style={{ fontSize: 18, fontWeight: 800, color: c, letterSpacing: "-0.02em" }}>
                  {fmtPct(v)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Riga 3: Miglior / Peggior titolo ── */}
      {bestWorst && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{
            background: "#fff", border: "1px solid #E8EBF4", borderRadius: 12,
            padding: "14px 16px", borderLeft: "3px solid #16A34A",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 10, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>↑ Miglior titolo</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0A1628" }}>{bestWorst.best.ticker}</div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#16A34A" }}>
              +{bestWorst.best.pct.toFixed(2)}%
            </div>
          </div>

          <div style={{
            background: "#fff", border: "1px solid #E8EBF4", borderRadius: 12,
            padding: "14px 16px", borderLeft: "3px solid #DC2626",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 10, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>↓ Peggior titolo</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0A1628" }}>{bestWorst.worst.ticker}</div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#DC2626" }}>
              {bestWorst.worst.pct.toFixed(2)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
