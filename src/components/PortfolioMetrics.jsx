import { useState, useEffect, useMemo } from "react";
import { fetchHistory } from "../utils/api";
import { toUSD } from "../utils/currency";
import { parseBuyDate } from "../utils/dates";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from "recharts";

// ── Calcola rendimento semplice per un titolo in un periodo ──────────────────
// Se buyDate > cutoff → usa buyPrice come base
// Se buyDate <= cutoff → usa prezzo storico al cutoff come base
function calcReturn(candles, buyDate, buyPrice, cutoffISO) {
  const getPrice = (date) => {
    let last = null;
    for (const c of candles) {
      if (c.date <= date) last = c.price;
      else break;
    }
    return last;
  };
  const today = candles[candles.length - 1]?.price;
  if (!today) return null;
  const base = buyDate > cutoffISO
    ? buyPrice
    : (getPrice(cutoffISO) ?? buyPrice);
  if (!base) return null;
  return (today - base) / base * 100;
}

// ── Rendimento portafoglio pesato per valore ─────────────────────────────────
function weightedReturn(stocks, histories, cutoffISO) {
  let totalValue = 0;
  let weightedSum = 0;

  for (const s of stocks) {
    const candles = histories[s.ticker];
    if (!candles?.length) continue;
    const price = candles[candles.length - 1]?.price ?? 0;
    const value = (parseFloat(s.qty) || 0) * price;
    const ret   = calcReturn(candles, s.buyDateISO, s.buyPrice, cutoffISO);
    if (ret == null) continue;
    totalValue  += value;
    weightedSum += ret * value;
  }

  return totalValue > 0 ? weightedSum / totalValue : null;
}

// ── Indicatori statistici ────────────────────────────────────────────────────
function calcIndicators(valueSeries, spyCandles) {
  if (valueSeries.length < 10) return null;

  // Rendimenti giornalieri
  const returns = [];
  for (let i = 1; i < valueSeries.length; i++) {
    const r = (valueSeries[i].value - valueSeries[i-1].value) / valueSeries[i-1].value;
    returns.push(r);
  }

  // Volatilità 30gg (annualizzata)
  const last30 = returns.slice(-30);
  const mean30 = last30.reduce((s, r) => s + r, 0) / last30.length;
  const variance = last30.reduce((s, r) => s + (r - mean30) ** 2, 0) / last30.length;
  const vol30 = Math.sqrt(variance * 252) * 100;

  // Sharpe ratio (risk-free = 4.5% annuo)
  const meanR = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdR  = Math.sqrt(returns.reduce((s, r) => s + (r - meanR) ** 2, 0) / returns.length);
  const sharpe = stdR > 0 ? ((meanR * 252) - 0.045) / (stdR * Math.sqrt(252)) : null;

  // Max drawdown
  let peak = valueSeries[0].value;
  let maxDD = 0;
  for (const p of valueSeries) {
    if (p.value > peak) peak = p.value;
    const dd = (p.value - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  }

  // Beta vs S&P500
  let beta = null;
  if (spyCandles?.length > 10) {
    const spyMap = {};
    spyCandles.forEach(c => { spyMap[c.date] = c.price; });
    const spyReturns = [];
    const portReturns = [];
    for (let i = 1; i < valueSeries.length; i++) {
      const d0 = valueSeries[i-1].date;
      const d1 = valueSeries[i].date;
      if (!spyMap[d0] || !spyMap[d1]) continue;
      spyReturns.push((spyMap[d1] - spyMap[d0]) / spyMap[d0]);
      portReturns.push((valueSeries[i].value - valueSeries[i-1].value) / valueSeries[i-1].value);
    }
    if (spyReturns.length > 5) {
      const meanS = spyReturns.reduce((s,r) => s+r, 0) / spyReturns.length;
      const meanP = portReturns.reduce((s,r) => s+r, 0) / portReturns.length;
      let cov = 0, varS = 0;
      for (let i = 0; i < spyReturns.length; i++) {
        cov  += (spyReturns[i] - meanS) * (portReturns[i] - meanP);
        varS += (spyReturns[i] - meanS) ** 2;
      }
      beta = varS > 0 ? cov / varS : null;
    }
  }

  return { vol30, sharpe, maxDD, beta };
}

// ── Componente principale ────────────────────────────────────────────────────
export function PortfolioMetrics({ stocks, eurRate, totalValue, totalPnL, totalPct, fmt, sym }) {
  const [histories, setHistories] = useState({});
  const [spyCandles, setSpyCandles] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!stocks.length) return;
    setLoading(true);
    const tickers = [...new Set(stocks.map(s => s.ticker))];
    Promise.all([
      ...tickers.map(t =>
        fetchHistory(t, 400).then(c => ({ ticker: t, candles: c || [] })).catch(() => ({ ticker: t, candles: [] }))
      ),
      fetchHistory("SPY", 400).then(c => ({ ticker: "SPY", candles: c || [] })).catch(() => ({ ticker: "SPY", candles: [] })),
    ]).then(results => {
      const map = {};
      results.filter(r => r.ticker !== "SPY").forEach(({ ticker, candles }) => { map[ticker] = candles; });
      setHistories(map);
      setSpyCandles(results.find(r => r.ticker === "SPY")?.candles || []);
      setLoading(false);
    });
  }, [stocks.map(s => `${s.ticker}-${s.qty}-${s.buyPrice}-${s.buyDate}`).join(","), eurRate]);

  // Arricchisci stocks con buyDateISO
  const enriched = useMemo(() => stocks.map(s => {
    const bd = parseBuyDate(s.buyDate);
    return { ...s, buyDateISO: bd ? bd.toISOString().slice(0,10) : "1970-01-01" };
  }), [stocks]);

  // Pill rendimenti
  const pills = useMemo(() => {
    if (!Object.keys(histories).length) return null;
    const today = new Date().toISOString().slice(0,10);
    const cutoffs = {
      "1G": (() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })(),
      "1M": (() => { const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10); })(),
      "6M": (() => { const d = new Date(); d.setMonth(d.getMonth()-6); return d.toISOString().slice(0,10); })(),
      "1A": (() => { const d = new Date(); d.setFullYear(d.getFullYear()-1); return d.toISOString().slice(0,10); })(),
      "Inizio": "1970-01-01",
    };
    const result = {};
    for (const [period, cutoff] of Object.entries(cutoffs)) {
      result[period] = weightedReturn(enriched, histories, cutoff);
    }
    return result;
  }, [histories, enriched]);

  // Serie valore USD per grafico
  const valueSeries = useMemo(() => {
    if (!Object.keys(histories).length) return [];
    const allDates = [...new Set(
      Object.values(histories).flatMap(c => c.map(x => x.date))
    )].sort();

    const lastKnown = {};
    Object.keys(histories).forEach(t => { lastKnown[t] = null; });

    return allDates.map(date => {
      Object.entries(histories).forEach(([t, c]) => {
        const p = c.find(x => x.date === date);
        if (p) lastKnown[t] = p.price;
      });
      const active = enriched.filter(s => date >= s.buyDateISO);
      if (!active.length) return null;
      let value = 0;
      for (const s of active) {
        if (!lastKnown[s.ticker]) return null;
        value += (parseFloat(s.qty)||0) * toUSD(lastKnown[s.ticker], s.currency, eurRate);
      }
      if (value <= 0) return null;
      const label = new Date(date+"T12:00:00").toLocaleDateString("it-IT", { day:"2-digit", month:"short" });
      return { date, label, value: parseFloat(value.toFixed(2)) };
    }).filter(Boolean);
  }, [histories, enriched, eurRate]);

  // Indicatori
  const indicators = useMemo(() => calcIndicators(valueSeries, spyCandles), [valueSeries, spyCandles]);

  const col  = v => v == null ? "#8A9AB0" : v >= 0 ? "#5EC98A" : "#E87040";
  const sign = v => v != null && v >= 0 ? "+" : "";
  const isPos = (totalPnL ?? 0) >= 0;
  const lineColor = isPos ? "#5EC98A" : "#E87040";

  return (
    <div className="card" style={{ marginBottom: 16, padding: "20px 20px 16px" }}>

      {/* ── Pill rendimenti ── */}
      {loading ? (
        <div style={{ fontSize: 11, color: "#8A9AB0", marginBottom: 14 }}>Caricamento rendimenti…</div>
      ) : pills ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
          {["1G","1M","6M","1A","Inizio"].map(p => {
            const v = pills[p];
            const c = col(v);
            return (
              <div key={p} style={{
                padding: "5px 12px", borderRadius: 20,
                background: c + "14", border: `1px solid ${c}33`,
                fontSize: 11, fontWeight: 600, color: c,
              }}>
                {p} {v != null ? `${sign(v)}${Math.abs(v).toFixed(2)}%` : "—"}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── Grafico valore USD ── */}
      {valueSeries.length > 1 && (
        <>
          <div style={{ fontSize: 10, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Valore portafoglio (USD)
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={valueSeries} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={lineColor} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 11, padding: "6px 12px" }}
                formatter={v => [`$${v?.toLocaleString("it-IT", { minimumFractionDigits: 2 })}`, "Valore"]}
                labelStyle={{ color: "#8A9AB0", fontSize: 10 }}
              />
              <Area type="monotone" dataKey="value" stroke={lineColor} strokeWidth={1.5} fill="url(#valGrad)" dot={false}
                activeDot={{ r: 4, fill: lineColor, stroke: "#fff", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}

      {/* ── Indicatori ── */}
      {indicators && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 16, paddingTop: 16, borderTop: "1px solid #F0F2F7" }}>
          {[
            { label: "Volatilità 30gg", value: `${indicators.vol30.toFixed(1)}%`, color: indicators.vol30 > 20 ? "#E87040" : "#5EC98A", icon: "〰️" },
            { label: "Sharpe Ratio",    value: indicators.sharpe != null ? indicators.sharpe.toFixed(2) : "—", color: indicators.sharpe > 1 ? "#5EC98A" : indicators.sharpe > 0 ? "#F4C542" : "#E87040", icon: "⚖️" },
            { label: "Beta S&P500",     value: indicators.beta != null ? indicators.beta.toFixed(2) : "—", color: "#8A9AB0", icon: "📐" },
            { label: "Max Drawdown",    value: `${indicators.maxDD.toFixed(1)}%`, color: "#E87040", icon: "📉" },
          ].map(({ label, value, color, icon }) => (
            <div key={label} style={{ background: "#F8FAFF", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 16, marginBottom: 6 }}>{icon}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color, letterSpacing: "-0.01em" }}>{value}</div>
              <div style={{ fontSize: 10, color: "#8A9AB0", marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
