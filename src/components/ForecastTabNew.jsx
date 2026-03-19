import { useState, useEffect, useMemo, useRef } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, Cell, Legend,
} from "recharts";
import { toUSD } from "../utils/currency";
import { API_BASE } from "../utils/api";
import { EarningsImpact, RiskConcentration } from "./AnalysisWidgets";

// ── Helpers ───────────────────────────────────────────────────────────────────
const col  = v => v == null ? "#8A9AB0" : v > 0 ? "#16A34A" : v < 0 ? "#DC2626" : "#8A9AB0";
const sign = v => v != null && v > 0 ? "+" : "";
const fmtPct = (v, d = 1) => v != null ? `${sign(v)}${Math.abs(v).toFixed(d)}%` : "—";

function Spinner({ size = 14, color = "#4361ee" }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />;
}

// ── Indicatori tecnici calcolati dai prezzi storici ───────────────────────────
function calcTechnicals(candles) {
  if (!candles || candles.length < 20) return null;
  const prices = candles.map(c => c.price);
  const n = prices.length;

  // RSI 14
  const gains = [], losses = [];
  for (let i = 1; i < Math.min(15, n); i++) {
    const diff = prices[n - i] - prices[n - i - 1];
    if (diff > 0) gains.push(diff); else losses.push(Math.abs(diff));
  }
  const avgGain = gains.reduce((s, g) => s + g, 0) / 14;
  const avgLoss = losses.reduce((s, l) => s + l, 0) / 14;
  const rs  = avgLoss > 0 ? avgGain / avgLoss : 100;
  const rsi = parseFloat((100 - 100 / (1 + rs)).toFixed(1));

  // SMA 20, 50, 200
  const sma = (period) => {
    if (n < period) return null;
    return parseFloat((prices.slice(-period).reduce((s, p) => s + p, 0) / period).toFixed(2));
  };
  const sma20  = sma(20);
  const sma50  = sma(50);
  const sma200 = sma(200);

  // Supporto / Resistenza (min/max ultimi 52 settimane)
  const year = prices.slice(-252);
  const support    = parseFloat(Math.min(...year).toFixed(2));
  const resistance = parseFloat(Math.max(...year).toFixed(2));

  // MACD (12, 26, 9)
  const ema = (period, data) => {
    const k = 2 / (period + 1);
    let e = data[0];
    for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  };
  const ema12 = ema(12, prices.slice(-26));
  const ema26 = ema(26, prices.slice(-26));
  const macd  = parseFloat((ema12 - ema26).toFixed(2));

  // Trend (prezzo vs SMA50)
  const current = prices[n - 1];
  const trend = sma50 ? (current > sma50 ? "rialzista" : "ribassista") : null;

  return { rsi, sma20, sma50, sma200, support, resistance, macd, current, trend };
}

// ── Sentiment da news e analisti ─────────────────────────────────────────────
function SentimentWidget({ ticker, analystData }) {
  const a = analystData?.analyst;
  if (!a) return null;

  const total = (a.strongBuy || 0) + (a.buy || 0) + (a.hold || 0) + (a.sell || 0) + (a.strongSell || 0);
  if (!total) return null;

  const bullish = ((a.strongBuy || 0) + (a.buy || 0)) / total * 100;
  const neutral = (a.hold || 0) / total * 100;
  const bearish = ((a.sell || 0) + (a.strongSell || 0)) / total * 100;

  const sentiment = bullish > 60 ? "Bullish" : bullish > 40 ? "Neutrale" : "Bearish";
  const sentCol   = bullish > 60 ? "#16A34A" : bullish > 40 ? "#F4A020" : "#DC2626";

  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
        💬 Sentiment Analisti
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
        <div style={{ position: "relative", width: 52, height: 52, flexShrink: 0 }}>
          <svg viewBox="0 0 36 36" style={{ width: "100%", transform: "rotate(-90deg)" }}>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F0F2F7" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke={sentCol} strokeWidth="3"
              strokeDasharray={`${bullish} ${100 - bullish}`} strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: sentCol }}>
            {Math.round(bullish)}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: sentCol }}>{sentiment}</div>
          <div style={{ fontSize: 10, color: "#8A9AB0" }}>{total} analisti coperti</div>
        </div>
      </div>

      {/* Barra consenso */}
      <div style={{ height: 8, borderRadius: 4, overflow: "hidden", display: "flex", marginBottom: 8 }}>
        <div style={{ width: `${bullish}%`, background: "#16A34A" }} />
        <div style={{ width: `${neutral}%`, background: "#F4A020" }} />
        <div style={{ width: `${bearish}%`, background: "#DC2626" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9 }}>
        <span style={{ color: "#16A34A" }}>🟢 {(a.strongBuy || 0) + (a.buy || 0)} Acquisto</span>
        <span style={{ color: "#F4A020" }}>🟡 {a.hold || 0} Neutrale</span>
        <span style={{ color: "#DC2626" }}>🔴 {(a.sell || 0) + (a.strongSell || 0)} Vendita</span>
      </div>

      {/* Target price */}
      {a.targetMean && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #F0F2F7" }}>
          <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 8 }}>Target price analisti</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[
              { l: "Min", v: a.targetLow, c: "#DC2626" },
              { l: "Medio", v: a.targetMean, c: "#F4A020" },
              { l: "Max", v: a.targetHigh, c: "#16A34A" },
            ].map(t => t.v ? (
              <div key={t.l} style={{ textAlign: "center", background: "#F8FAFF", borderRadius: 8, padding: "8px 4px" }}>
                <div style={{ fontSize: 8, color: "#8A9AB0", marginBottom: 4 }}>{t.l}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: t.c }}>${t.v.toFixed(2)}</div>
              </div>
            ) : null)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Indicatori tecnici widget ─────────────────────────────────────────────────
function TechnicalsWidget({ technicals, currentPrice, fmt }) {
  if (!technicals) return null;
  const { rsi, sma20, sma50, sma200, support, resistance, macd, trend } = technicals;

  const rsiColor = rsi > 70 ? "#DC2626" : rsi < 30 ? "#16A34A" : "#F4A020";
  const rsiLabel = rsi > 70 ? "Ipercomprato" : rsi < 30 ? "Ipervenduto" : "Neutrale";

  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
        📐 Indicatori Tecnici
      </div>

      {/* RSI */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: "#8A9AB0" }}>RSI 14</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: rsiColor }}>{rsi} — {rsiLabel}</span>
        </div>
        <div style={{ height: 6, background: "linear-gradient(90deg, #16A34A, #F4A020, #DC2626)", borderRadius: 3, position: "relative" }}>
          <div style={{
            position: "absolute", top: -3, width: 12, height: 12, borderRadius: "50%",
            background: rsiColor, border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
            left: `calc(${rsi}% - 6px)`, transition: "left 0.3s",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#C0C8D8", marginTop: 4 }}>
          <span>0 — Ipervenduto</span><span>70 — Ipercomprato</span>
        </div>
      </div>

      {/* MACD */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#F8FAFF", borderRadius: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#8A9AB0" }}>MACD (12,26)</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: col(macd) }}>{macd > 0 ? "+" : ""}{macd}</span>
      </div>

      {/* Medie mobili */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {[
          { l: "SMA 20", v: sma20 },
          { l: "SMA 50", v: sma50 },
          { l: "SMA 200", v: sma200 },
        ].filter(x => x.v).map(x => (
          <div key={x.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#8A9AB0" }}>{x.l}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#0A1628" }}>${x.v}</span>
              <span style={{ fontSize: 9, color: currentPrice > x.v ? "#16A34A" : "#DC2626", background: currentPrice > x.v ? "#ECFDF5" : "#FEF2F2", padding: "1px 6px", borderRadius: 8 }}>
                {currentPrice > x.v ? "▲ sopra" : "▼ sotto"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Supporto / Resistenza */}
      <div style={{ paddingTop: 12, borderTop: "1px solid #F0F2F7" }}>
        <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 8 }}>Supporto / Resistenza (52 settimane)</div>
        <div style={{ position: "relative", height: 24, background: "#F0F2F7", borderRadius: 12, overflow: "hidden" }}>
          <div style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${(currentPrice - support) / (resistance - support) * 100}%`,
            width: 4, background: "#4361ee", borderRadius: 2,
            transform: "translateX(-50%)",
          }} />
          <div style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 9, fontWeight: 700, color: "#DC2626" }}>${support}</div>
          <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 9, fontWeight: 700, color: "#16A34A" }}>${resistance}</div>
        </div>
        <div style={{ textAlign: "center", fontSize: 9, color: "#8A9AB0", marginTop: 4 }}>
          Posizione attuale: {(((currentPrice - support) / (resistance - support)) * 100).toFixed(0)}% del range
        </div>
      </div>

      {/* Trend */}
      {trend && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: trend === "rialzista" ? "#ECFDF5" : "#FEF2F2", textAlign: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: trend === "rialzista" ? "#16A34A" : "#DC2626" }}>
            {trend === "rialzista" ? "📈 Trend Rialzista" : "📉 Trend Ribassista"}
          </span>
          <span style={{ fontSize: 9, color: "#8A9AB0", marginLeft: 6 }}>(prezzo vs SMA50)</span>
        </div>
      )}
    </div>
  );
}

// ── Analisi storica migliorata ────────────────────────────────────────────────
function HistoricalAnalysis({ d, ticker, band, setBand, macroCtx }) {
  if (!d || d.occurrences === 0) return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
        🔍 Analisi Storica — {ticker}
      </div>
      <div style={{ fontSize: 12, color: "#8A9AB0", textAlign: "center", padding: "20px 0" }}>
        Nessun caso storico trovato a questo livello di prezzo
      </div>
    </div>
  );

  const outcomes = d.historicalOutcomes || [];
  const positive = outcomes.filter(o => o.pct > 0).length;
  const negative = outcomes.filter(o => o.pct < 0).length;
  const maxAbs   = Math.max(...outcomes.map(o => Math.abs(o.pct)));

  // Distribuzione dei rendimenti in bucket
  const buckets = [-50, -30, -20, -10, -5, 0, 5, 10, 20, 30, 50];
  const distribution = buckets.slice(0, -1).map((b, i) => ({
    range: `${b}→${buckets[i+1]}`,
    count: outcomes.filter(o => o.pct >= b && o.pct < buckets[i+1]).length,
    positive: buckets[i+1] > 0,
  }));

  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      {/* Header con slider */}
      <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>
        🔍 Analisi Storica — {ticker} a questo prezzo (±7%)
      </div>

      {/* Contesto macro — evidenzia periodi simili */}
      {macroCtx && (() => {
        const vix = macroCtx.vix;
        const t10y = macroCtx.treasury10y;
        const spread = macroCtx.yieldSpread;
        let label = null, color = "#8A9AB0";
        if (vix > 25)       { label = "⚠️ Alta volatilità (VIX " + vix + ") — i casi storici in periodi simili tendono ad essere più variabili"; color = "#DC2626"; }
        else if (t10y > 4.5) { label = "🏦 Tassi elevati (10Y " + t10y + "%) — contesto simile a 2022-2023"; color = "#7C3AED"; }
        else if (spread < 0) { label = "📉 Curva invertita — storicamente precede rallentamento"; color = "#F97316"; }
        else                  { label = "✅ Contesto macro stabile — dati storici ben rappresentativi"; color = "#16A34A"; }
        return label ? (
          <div style={{ padding: "8px 12px", borderRadius: 8, background: color + "10", border: `1px solid ${color}25`, marginBottom: 14, fontSize: 10, color, lineHeight: 1.5 }}>
            {label}
          </div>
        ) : null;
      })()}

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 16 }}>
        {[
          { l: "Casi", v: d.occurrences, c: "#0A1628", sub: "trovati" },
          { l: "Win Rate", v: `${d.winRate}%`, c: d.winRate >= 50 ? "#16A34A" : "#DC2626", sub: "casi positivi" },
          { l: "Medio", v: fmtPct(d.avgOutcome, 1), c: col(d.avgOutcome), sub: "dopo 12 mesi" },
          { l: "Miglior", v: `+${d.maxGain}%`, c: "#16A34A", sub: "caso storico" },
          { l: "Peggior", v: `${d.maxLoss}%`, c: "#DC2626", sub: "caso storico" },
        ].map(k => (
          <div key={k.l} style={{ textAlign: "center", background: "#F8FAFF", borderRadius: 8, padding: "10px 6px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.c, letterSpacing: "-0.01em" }}>{k.v}</div>
            <div style={{ fontSize: 8, color: "#0A1628", fontWeight: 600, marginTop: 2 }}>{k.l}</div>
            <div style={{ fontSize: 8, color: "#C0C8D8" }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Distribuzione rendimenti */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 8 }}>Distribuzione dei rendimenti storici</div>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={distribution} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="range" tick={{ fontSize: 7, fill: "#8A9AB0" }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 6, fontSize: 10, padding: "4px 8px" }}
              formatter={v => [v, "casi"]} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {distribution.map((d, i) => (
                <Cell key={i} fill={d.positive ? "#16A34A" : "#DC2626"} fillOpacity={0.6} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Casi storici barre */}
      <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 8 }}>Dettaglio casi ({positive} positivi, {negative} negativi)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
        {[...outcomes].reverse().map((o, i) => {
          const isPos = o.pct >= 0;
          const barW  = maxAbs > 0 ? Math.abs(o.pct) / maxAbs * 45 : 0;
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 56px", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 9, color: "#8A9AB0", textAlign: "right" }}>{o.date}</span>
              <div style={{ position: "relative", height: 14, background: "#F8FAFF", borderRadius: 2 }}>
                <div style={{
                  position: "absolute", top: 0, bottom: 0,
                  left: isPos ? "50%" : `calc(50% - ${barW}%)`,
                  width: `${barW}%`,
                  background: isPos ? "#16A34A" : "#DC2626",
                  opacity: 0.5, borderRadius: 2,
                }} />
                <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "#E0E4EF" }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: isPos ? "#16A34A" : "#DC2626" }}>
                {isPos ? "+" : ""}{o.pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Export principale ─────────────────────────────────────────────────────────
export function ForecastTabNew({ stocks, fmt, sym, rate, eurRate }) {
  const [selected, setSelected]   = useState(null);
  const [forecastData, setForecastData] = useState({});
  const [analystData, setAnalystData]   = useState({});
  const [historyData, setHistoryData]   = useState({});
  const [loading, setLoading]     = useState(false);
  const [band, setBand]           = useState(7);   // ±7% default
  const [macroCtx, setMacroCtx]   = useState(null); // contesto macro live
  const allLoadedRef = useRef(false);

  // Fetch contesto macro per evidenziare periodi simili
  useEffect(() => {
    fetch(`${API_BASE}/api/price?symbol=__MACRO__`)
      .then(r => r.json())
      .then(d => setMacroCtx(d))
      .catch(() => {});
  }, []);

  // Carica forecast per tutti i titoli in background
  useEffect(() => {
    if (allLoadedRef.current || !stocks.length) return;
    allLoadedRef.current = true;
    stocks.forEach(s => {
      fetch(`${API_BASE}/api/forecast?symbol=${encodeURIComponent(s.ticker)}&price=${s.currentPrice}`)
        .then(r => r.json())
        .then(d => { if (!d.error) setForecastData(p => ({ ...p, [s.ticker]: d })); })
        .catch(() => {});
    });
  }, [stocks.length]);

  // Carica dati per titolo selezionato
  useEffect(() => {
    if (!selected) return;
    const t = selected.ticker;

    // Analyst
    if (!analystData[t]) {
      fetch(`${API_BASE}/api/analyst?symbol=${encodeURIComponent(t)}`)
        .then(r => r.json())
        .then(d => { if (!d.error) setAnalystData(p => ({ ...p, [t]: d })); })
        .catch(() => {});
    }

    // History per tecnicali
    if (!historyData[t]) {
      fetch(`${API_BASE}/api/history?symbol=${encodeURIComponent(t)}&days=400`)
        .then(r => r.json())
        .then(d => { if (d.candles) setHistoryData(p => ({ ...p, [t]: d.candles })); })
        .catch(() => {});
    }

    // Forecast se non caricato
    if (!forecastData[t]) {
      setLoading(true);
      fetch(`${API_BASE}/api/forecast?symbol=${encodeURIComponent(t)}&price=${selected.currentPrice}&band=${band/100}`)
        .then(r => r.json())
        .then(d => { if (!d.error) setForecastData(p => ({ ...p, [t]: d })); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, [selected?.ticker, band]);

  // Refetch analisi storica quando cambia banda
  useEffect(() => {
    if (!selected) return;
    const t = selected.ticker;
    setLoading(true);
    fetch(`${API_BASE}/api/forecast?symbol=${encodeURIComponent(t)}&price=${selected.currentPrice}&band=${band/100}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setForecastData(p => ({ ...p, [t]: d })); setLoading(false); })
      .catch(() => setLoading(false));
  }, [band]);

  // Portfolio forecast aggregato
  const portfolioForecast = useMemo(() => {
    const totalValue = stocks.reduce((s, st) => s + (parseFloat(st.qty)||0) * toUSD(parseFloat(st.currentPrice)||0, st.currency, eurRate), 0);
    if (!totalValue) return null;
    let base = 0, pess = 0, opt = 0, covered = 0;
    stocks.forEach(st => {
      const d = forecastData[st.ticker];
      if (!d) return;
      const w = (parseFloat(st.qty)||0) * (parseFloat(st.currentPrice)||0) / totalValue;
      base += d.projection.base * w;
      pess += d.projection.pessimistic * w;
      opt  += d.projection.optimistic * w;
      covered++;
    });
    if (!covered) return null;
    return {
      base: parseFloat(base.toFixed(1)),
      pess: parseFloat(pess.toFixed(1)),
      opt:  parseFloat(opt.toFixed(1)),
      baseVal: parseFloat((totalValue * (1 + base / 100) * rate).toFixed(0)),
      pessVal: parseFloat((totalValue * (1 + pess / 100) * rate).toFixed(0)),
      optVal:  parseFloat((totalValue * (1 + opt  / 100) * rate).toFixed(0)),
      totalValue, covered, total: stocks.length,
    };
  }, [forecastData, stocks, eurRate, rate]);

  const d   = selected ? forecastData[selected.ticker] : null;
  const a   = selected ? analystData[selected.ticker]  : null;
  const candles = selected ? historyData[selected.ticker] : null;
  const tech = useMemo(() => calcTechnicals(candles), [candles]);

  // Grafico proiezione con linea analisti
  const projectionChart = useMemo(() => {
    if (!d) return [];
    const analyst = a?.analyst;
    return (d.projectionChart || []).map((pt, i) => ({
      ...pt,
      analyst: analyst?.targetMean
        ? parseFloat((d.currentPrice + (analyst.targetMean - d.currentPrice) * (i / Math.max((d.projectionChart.length - 1), 1))).toFixed(2))
        : null,
    }));
  }, [d, a]);

  return (
    <div className="fade-up" style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 40px" }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.01em" }}>🔮 Previsioni</div>
        <div style={{ fontSize: 12, color: "#8A9AB0", marginTop: 4 }}>Proiezioni statistiche, analisi tecnica e sentiment di mercato</div>
      </div>

      {/* Portfolio aggregato */}
      {portfolioForecast && (
        <div style={{ background: "linear-gradient(135deg, #0f1f5c, #1a3a8f)", borderRadius: 16, padding: "20px 24px", marginBottom: 20, color: "#fff" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
            Proiezione portafoglio aggregata — {portfolioForecast.covered}/{portfolioForecast.total} titoli
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {[
              { l: "Pessimistico", pct: portfolioForecast.pess, val: portfolioForecast.pessVal, c: "#f87171" },
              { l: "Base",         pct: portfolioForecast.base, val: portfolioForecast.baseVal, c: "#fbbf24" },
              { l: "Ottimistico",  pct: portfolioForecast.opt,  val: portfolioForecast.optVal,  c: "#4ade80" },
            ].map(s => (
              <div key={s.l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>{s.l}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: s.c, letterSpacing: "-0.02em" }}>{fmtPct(s.pct, 1)}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{sym}{s.val.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selector titoli */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {stocks.map(s => {
          const fd = forecastData[s.ticker];
          const isSelected = selected?.ticker === s.ticker;
          return (
            <button key={s.ticker} onClick={() => setSelected(s)} style={{
              padding: "8px 16px", borderRadius: 10, cursor: "pointer",
              fontFamily: "inherit", fontSize: 12, fontWeight: 600,
              border: "none", transition: "all 0.15s",
              background: isSelected ? "#0A1628" : "#F0F2F7",
              color: isSelected ? "#fff" : "#8A9AB0",
              boxShadow: isSelected ? "0 2px 8px rgba(10,22,40,0.2)" : "none",
            }}>
              {s.ticker}
              {fd && (
                <span style={{ marginLeft: 8, fontSize: 10, color: fd.projection.base > 0 ? "#4ade80" : "#f87171" }}>
                  {fmtPct(fd.projection.base, 1)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!selected && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#8A9AB0", fontSize: 13 }}>
          ↑ Seleziona un titolo per l'analisi dettagliata
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Spinner size={24} /> <div style={{ color: "#8A9AB0", fontSize: 12, marginTop: 10 }}>Analisi in corso…</div>
        </div>
      )}

      {selected && d && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Proiezione prezzo */}
          <div className="card" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>
                  Proiezione 12 mesi — {selected.ticker}
                </div>
                <div style={{ fontSize: 11, color: "#8A9AB0" }}>
                  Trend 3 anni: <span style={{ color: col(d.annualizedReturn), fontWeight: 600 }}>{fmtPct(d.annualizedReturn, 1)}</span>
                  {" · "}Volatilità: <span style={{ fontWeight: 600 }}>{d.annualVol}%</span>
                </div>
              </div>
              {/* Target analisti */}
              {a?.analyst?.targetMean && (() => {
                const upside = selected.currentPrice ? ((a.analyst.targetMean - selected.currentPrice) / selected.currentPrice * 100).toFixed(1) : null;
                return (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em" }}>Target analisti</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#F4A020" }}>${a.analyst.targetMean.toFixed(2)}</div>
                    {upside && <div style={{ fontSize: 10, color: col(parseFloat(upside)) }}>{fmtPct(parseFloat(upside), 1)} upside</div>}
                  </div>
                );
              })()}
            </div>

            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={projectionChart} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="optG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="pessG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#DC2626" stopOpacity={0.08} />
                    <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} width={50} tickFormatter={v => `$${v}`} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 11, padding: "6px 12px" }}
                  formatter={(v, n) => [`$${v}`, n === "base" ? "Base" : n === "optimistic" ? "Ottimistico" : n === "pessimistic" ? "Pessimistico" : "Analisti"]} />
                <ReferenceLine y={d.currentPrice} stroke="#E0E4EF" strokeDasharray="4 3" label={{ value: "Prezzo attuale", fontSize: 8, fill: "#8A9AB0" }} />
                <Area type="monotone" dataKey="optimistic" stroke="#16A34A" strokeWidth={1} strokeDasharray="3 3" fill="url(#optG)" dot={false} />
                <Area type="monotone" dataKey="pessimistic" stroke="#DC2626" strokeWidth={1} strokeDasharray="3 3" fill="url(#pessG)" dot={false} />
                <Area type="monotone" dataKey="base" stroke="#F4A020" strokeWidth={2} fill="none" dot={false} />
                {a?.analyst?.targetMean && <Area type="monotone" dataKey="analyst" stroke="#4361ee" strokeWidth={2} strokeDasharray="6 3" fill="none" dot={false} />}
              </AreaChart>
            </ResponsiveContainer>

            {/* Nota metodologia */}
            {d.methodology && (
              <div style={{ marginTop: 12, padding: "8px 12px", background: "#F8FAFF", borderRadius: 8, fontSize: 9, color: "#8A9AB0", lineHeight: 1.6 }}>
                📊 <strong style={{ color: "#0A1628" }}>Metodologia:</strong> {d.methodology.note}
                {d.methodology.analystWeight > 0 && (
                  <span style={{ marginLeft: 6, color: "#4361ee" }}>· Target analisti: ${d.methodology.analystTarget?.toFixed(2)}</span>
                )}
              </div>
            )}

            {/* Legenda + scenari */}
            <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              {[
                { c: "#16A34A", l: "Ottimistico", v: `$${d.projection.optimisticPriceTarget}`, pct: fmtPct(d.projection.optimistic, 1) },
                { c: "#F4A020", l: "Base",        v: `$${d.projection.basePriceTarget}`,       pct: fmtPct(d.projection.base, 1) },
                { c: "#DC2626", l: "Pessimistico",v: `$${d.projection.pessimisticPriceTarget}`, pct: fmtPct(d.projection.pessimistic, 1) },
                ...(a?.analyst?.targetMean ? [{ c: "#4361ee", l: "Analisti", v: `$${a.analyst.targetMean.toFixed(2)}`, pct: "" }] : []),
              ].map(s => (
                <div key={s.l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 16, height: 2, background: s.c, borderRadius: 1 }} />
                  <span style={{ fontSize: 10, color: "#8A9AB0" }}>{s.l}:</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: s.c }}>{s.v}</span>
                  {s.pct && <span style={{ fontSize: 9, color: "#8A9AB0" }}>({s.pct})</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Griglia: Sentiment + Tecnicali */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <SentimentWidget ticker={selected.ticker} analystData={a} />
            <TechnicalsWidget technicals={tech} currentPrice={selected.currentPrice} fmt={fmt} />
          </div>

          {/* Analisi storica */}
          <HistoricalAnalysis d={d} ticker={selected.ticker} band={band} setBand={setBand} macroCtx={macroCtx} />

          {/* Stagionalità */}
          {d.seasonality?.length > 0 && (
            <div className="card" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                📅 Stagionalità storica — rendimento medio per mese
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={d.seasonality} barSize={24}>
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} width={32} tickFormatter={v => `${v}%`} />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 10, padding: "4px 8px" }}
                    formatter={v => [`${v}%`, "Media storica"]} />
                  <ReferenceLine y={0} stroke="#E0E4EF" />
                  <Bar dataKey="avgReturn" radius={[3, 3, 0, 0]}>
                    {d.seasonality.map((s, i) => (
                      <Cell key={i} fill={s.avgReturn >= 0 ? "#16A34A" : "#DC2626"} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Earnings Impact */}
          <EarningsImpact ticker={selected.ticker} />

          <div style={{ fontSize: 9, color: "#C0C8D8", textAlign: "center" }}>
            ⚠️ Stime statistiche basate su dati storici. Non costituisce consulenza finanziaria ai sensi MiFID II.
          </div>
        </div>
      )}
    </div>
  );
}
