import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ReferenceLine, Legend, BarChart, Bar, Cell,
} from "recharts";
import { API_BASE } from "../utils/api";
import { toUSD } from "../utils/currency";

// ── Dati scenari ──────────────────────────────────────────────────────────────
const SCENARIOS_STORICI = [
  { id: "covid",     label: "🦠 Covid Crash",      from: "2020-02-19", to: "2020-03-23", spx: -34, color: "#DC2626", desc: "Il mercato perde il 34% in 33 giorni" },
  { id: "postcovid", label: "🚀 Post-Covid Rally",  from: "2020-03-23", to: "2021-12-31", spx: +114, color: "#16A34A", desc: "La ripresa più rapida della storia" },
  { id: "gfc",       label: "💥 Financial Crisis",  from: "2007-10-01", to: "2009-03-09", spx: -57, color: "#7C3AED", desc: "La peggior crisi dal 1929 (-57% S&P500)" },
  { id: "dotcom",    label: "🫧 Dot-com Bubble",    from: "2000-03-10", to: "2002-10-09", spx: -49, color: "#F97316", desc: "Il crollo delle aziende tech (-49%)" },
  { id: "bull2017",  label: "📈 Bull Run 2017",     from: "2017-01-01", to: "2017-12-31", spx: +19, color: "#0EA5E9", desc: "Un anno eccezionale per i mercati" },
];

const MACRO_SCENARI = [
  {
    id: "high_inflation", label: "📈 Alta Inflazione", color: "#F97316",
    from: "2021-06-01", to: "2022-12-31", periodLabel: "Giu 2021 – Dic 2022",
    desc: "Inflazione >5% come 2021-2022. Energia e commodities salgono, tech e bond scendono.",
    spxImpact: -12, duration: "12-18 mesi",
    impact: { "Tech": -25, "Finanza": +8, "Energia": +45, "Materiali": +30, "Salute": -5, "Consumer": -15, "Industriali": +10, "Utility": -12, "Real Estate": -20, "Telecom": -8, "ETF": -10, "Altro": -5 },
    topPicks: [
      { ticker: "XLE", name: "Energy ETF", reason: "Energia sale con inflazione", perf: 42 },
      { ticker: "GLD", name: "Gold ETF", reason: "Oro come hedge", perf: 18 },
      { ticker: "CVX", name: "Chevron", reason: "Petrolio beneficia", perf: 55 },
      { ticker: "TIPS", name: "Inflation Bonds", reason: "Bond indicizzati", perf: 8 },
      { ticker: "BRK.B", name: "Berkshire", reason: "Aziende con pricing power", perf: 14 },
    ],
    worstPicks: [
      { ticker: "QQQ", name: "Nasdaq ETF", reason: "Tech colpito da tassi alti", perf: -28 },
      { ticker: "TLT", name: "Long Bonds", reason: "Bond lunghi crollano", perf: -35 },
    ],
    chartData: [
      { m: "M1", energy: 4, tech: -3, gold: 2 }, { m: "M3", energy: 12, tech: -8, gold: 5 },
      { m: "M6", energy: 22, tech: -15, gold: 9 }, { m: "M9", energy: 33, tech: -20, gold: 13 },
      { m: "M12", energy: 42, tech: -25, gold: 18 },
    ],
    lineKeys: [{ k: "energy", l: "Energia", c: "#F97316" }, { k: "tech", l: "Tech", c: "#0EA5E9" }, { k: "gold", l: "Oro", c: "#F4C542" }],
  },
  {
    id: "recession", label: "📊 Recessione", color: "#DC2626",
    from: "2007-10-01", to: "2009-03-09", periodLabel: "Ott 2007 – Mar 2009",
    desc: "GDP negativo per 2+ trimestri. Difensivi, oro e bond governativi come rifugio.",
    spxImpact: -30, duration: "6-18 mesi",
    impact: { "Tech": -20, "Finanza": -30, "Energia": -25, "Materiali": -28, "Salute": +5, "Consumer": -15, "Industriali": -22, "Utility": +2, "Real Estate": -18, "Telecom": +2, "ETF": -18, "Altro": -15 },
    topPicks: [
      { ticker: "GLD", name: "Gold ETF", reason: "Rifugio sicuro", perf: 25 },
      { ticker: "TLT", name: "Gov Bonds", reason: "Treasury salgono", perf: 30 },
      { ticker: "XLV", name: "Healthcare ETF", reason: "Settore difensivo", perf: 5 },
      { ticker: "XLP", name: "Staples ETF", reason: "Beni necessità", perf: 3 },
    ],
    worstPicks: [
      { ticker: "XLF", name: "Financial ETF", reason: "Banche colpite da NPL", perf: -35 },
      { ticker: "XLB", name: "Materials ETF", reason: "Domanda industriale crolla", perf: -30 },
    ],
    chartData: [
      { m: "M1", gold: 3, bonds: 5, spx: -5 }, { m: "M3", gold: 9, bonds: 14, spx: -14 },
      { m: "M6", gold: 16, bonds: 22, spx: -22 }, { m: "M9", gold: 21, bonds: 27, spx: -28 },
      { m: "M12", gold: 25, bonds: 30, spx: -30 },
    ],
    lineKeys: [{ k: "gold", l: "Oro", c: "#F4C542" }, { k: "bonds", l: "Gov Bond", c: "#0EA5E9" }, { k: "spx", l: "S&P 500", c: "#DC2626" }],
  },
  {
    id: "boom", label: "🚀 Boom Economico", color: "#16A34A",
    from: "2017-01-01", to: "2017-12-31", periodLabel: "Anno 2017",
    desc: "Crescita GDP >3%, piena occupazione. Ciclici, tech e small cap esplodono.",
    spxImpact: +28, duration: "12-36 mesi",
    impact: { "Tech": +30, "Finanza": +20, "Energia": +25, "Materiali": +35, "Salute": +8, "Consumer": +28, "Industriali": +32, "Utility": -5, "Real Estate": +15, "Telecom": +18, "ETF": +22, "Altro": +15 },
    topPicks: [
      { ticker: "IWM", name: "Russell 2000", reason: "Small cap in boom", perf: 35 },
      { ticker: "XLI", name: "Industrials ETF", reason: "Industriali crescono", perf: 30 },
      { ticker: "NVDA", name: "Nvidia", reason: "Tech + AI capex", perf: 80 },
      { ticker: "XLY", name: "Consumer Disc.", reason: "Consumi esplodono", perf: 32 },
    ],
    worstPicks: [
      { ticker: "TLT", name: "Long Bonds", reason: "Venduti per risk-on", perf: -15 },
      { ticker: "GLD", name: "Gold ETF", reason: "Perde appeal in risk-on", perf: -5 },
    ],
    chartData: [
      { m: "M1", smallcap: 4, industriali: 3, spx: 3 }, { m: "M3", smallcap: 12, industriali: 9, spx: 8 },
      { m: "M6", smallcap: 22, industriali: 18, spx: 15 }, { m: "M9", smallcap: 29, industriali: 24, spx: 20 },
      { m: "M12", smallcap: 35, industriali: 30, spx: 28 },
    ],
    lineKeys: [{ k: "smallcap", l: "Small Cap", c: "#16A34A" }, { k: "industriali", l: "Industriali", c: "#0EA5E9" }, { k: "spx", l: "S&P 500", c: "#8A9AB0" }],
  },
  {
    id: "high_rates", label: "🏦 Tassi Alti", color: "#7C3AED",
    from: "2022-01-01", to: "2023-12-31", periodLabel: "Gen 2022 – Dic 2023",
    desc: "Fed Funds Rate >4% come 2022-2023. Banche e valore outperformano.",
    spxImpact: -15, duration: "12-24 mesi",
    impact: { "Tech": -30, "Finanza": +15, "Energia": +5, "Materiali": -5, "Salute": +5, "Consumer": -12, "Industriali": -8, "Utility": -20, "Real Estate": -25, "Telecom": -10, "ETF": -8, "Altro": -10 },
    topPicks: [
      { ticker: "XLF", name: "Financial ETF", reason: "Banche con margini alti", perf: 18 },
      { ticker: "JPM", name: "JPMorgan", reason: "Margini netti espandono", perf: 22 },
      { ticker: "BRK.B", name: "Berkshire", reason: "Float assicurativo rende", perf: 20 },
    ],
    worstPicks: [
      { ticker: "VNQ", name: "Real Estate ETF", reason: "REIT crollano", perf: -25 },
      { ticker: "ARKK", name: "ARK Innovation", reason: "Growth affonda", perf: -60 },
    ],
    chartData: [
      { m: "M1", banche: 2, realestate: -3, tech: -4 }, { m: "M3", banche: 6, realestate: -9, tech: -12 },
      { m: "M6", banche: 10, realestate: -16, tech: -20 }, { m: "M9", banche: 14, realestate: -21, tech: -26 },
      { m: "M12", banche: 18, realestate: -25, tech: -30 },
    ],
    lineKeys: [{ k: "banche", l: "Banche", c: "#16A34A" }, { k: "realestate", l: "Real Estate", c: "#DC2626" }, { k: "tech", l: "Tech", c: "#0EA5E9" }],
  },
  {
    id: "low_rates", label: "💸 Tassi Bassi", color: "#0EA5E9",
    from: "2009-03-01", to: "2015-12-31", periodLabel: "Mar 2009 – Dic 2015",
    desc: "Fed Funds Rate <1%. Risk-on, growth e credito salgono.",
    spxImpact: +25, duration: "24-36 mesi",
    impact: { "Tech": +35, "Finanza": -5, "Energia": +10, "Materiali": +12, "Salute": +10, "Consumer": +20, "Industriali": +15, "Utility": +10, "Real Estate": +30, "Telecom": +12, "ETF": +18, "Altro": +10 },
    topPicks: [
      { ticker: "QQQ", name: "Nasdaq ETF", reason: "Tech esplode con tassi zero", perf: 80 },
      { ticker: "VNQ", name: "Real Estate ETF", reason: "REIT in forte rally", perf: 35 },
      { ticker: "TSLA", name: "Tesla", reason: "Growth stocks beneficiano", perf: 200 },
    ],
    worstPicks: [
      { ticker: "XLF", name: "Financial ETF", reason: "Margini compressi", perf: -5 },
      { ticker: "BIL", name: "T-Bill ETF", reason: "Cash non rende nulla", perf: 0 },
    ],
    chartData: [
      { m: "M1", growth: 5, realestate: 3, spx: 3 }, { m: "M3", growth: 18, realestate: 9, spx: 8 },
      { m: "M6", growth: 40, realestate: 18, spx: 15 }, { m: "M9", growth: 80, realestate: 27, spx: 22 },
      { m: "M12", growth: 120, realestate: 35, spx: 28 },
    ],
    lineKeys: [{ k: "growth", l: "Growth", c: "#0EA5E9" }, { k: "realestate", l: "Real Estate", c: "#7C3AED" }, { k: "spx", l: "S&P 500", c: "#8A9AB0" }],
  },
  {
    id: "low_inflation", label: "📉 Bassa Inflazione", color: "#06B6D4",
    from: "2012-01-01", to: "2016-12-31",
    desc: "Inflazione <2% con crescita stabile. Tech e bond in rally.",
    spxImpact: +18, duration: "12-24 mesi",
    impact: { "Tech": +25, "Finanza": +5, "Energia": -10, "Materiali": -8, "Salute": +12, "Consumer": +15, "Industriali": +8, "Utility": +15, "Real Estate": +20, "Telecom": +10, "ETF": +12, "Altro": +8 },
    topPicks: [
      { ticker: "QQQ", name: "Nasdaq ETF", reason: "Tech cresce con tassi bassi", perf: 28 },
      { ticker: "TLT", name: "Long Bonds", reason: "Bond lunghi in rally", perf: 22 },
      { ticker: "VNQ", name: "Real Estate ETF", reason: "REIT beneficiano", perf: 18 },
    ],
    worstPicks: [
      { ticker: "XLE", name: "Energy ETF", reason: "Energia soffre", perf: -12 },
      { ticker: "GLD", name: "Gold ETF", reason: "Oro perde appeal", perf: -8 },
    ],
    chartData: [
      { m: "M1", tech: 3, bonds: 2, realestate: 1 }, { m: "M3", tech: 9, bonds: 6, realestate: 4 },
      { m: "M6", tech: 16, bonds: 12, realestate: 9 }, { m: "M9", tech: 22, bonds: 17, realestate: 13 },
      { m: "M12", tech: 28, bonds: 22, realestate: 18 },
    ],
    lineKeys: [{ k: "tech", l: "Tech", c: "#0EA5E9" }, { k: "bonds", l: "Bond", c: "#16A34A" }, { k: "realestate", l: "Real Estate", c: "#7C3AED" }],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const col  = v => v == null ? "#8A9AB0" : v >= 0 ? "#16A34A" : "#DC2626";
const sign = v => v != null && v >= 0 ? "+" : "";
const fmtPct = (v, dec = 1) => v != null ? `${sign(v)}${Math.abs(v).toFixed(dec)}%` : "—";

function Spinner({ size = 14, color = "#4361ee" }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />;
}

// ── Sezione 1: Stress Test Storico ────────────────────────────────────────────
function StressTest({ stocks, sym, rate, fmt, eurRate }) {
  const [selected, setSelected] = useState(SCENARIOS_STORICI[0]);
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(false);
  const totalValue = stocks.reduce((s, x) => s + (parseFloat(x.qty)||0) * toUSD(parseFloat(x.currentPrice)||0, x.currency, eurRate), 0);

  // Usa /api/scenario come il vecchio codice — funziona già
  const fetchScenario = useCallback(async (sc) => {
    if (cache[sc.id]) return;
    setLoading(true);
    try {
      const results = await Promise.all(
        stocks.map(s =>
          fetch(`${API_BASE}/api/scenario?symbol=${encodeURIComponent(s.ticker)}&from=${sc.from}&to=${sc.to}`)
            .then(r => r.json())
            .catch(() => null)
        )
      );

      const spyData = results.find(r => r?.spy)?.spy || null;
      const candles = results.map(r => r?.candles || null);

      // Serie portafoglio pesata (identica al vecchio codice)
      const maxLen = Math.max(...candles.map(r => r?.length || 0));
      // Ricalcola totalValue qui per sicurezza
      const tv = stocks.reduce((s, x) => s + (parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0), 0) || 1;

      // Filtra candles con date invalide e tronca alla lunghezza minima comune
      const validCandles = candles.map(c => c ? c.filter(p => p.date && !isNaN(new Date(p.date))) : null);
      const minLen = Math.min(...validCandles.map(c => c?.length || maxLen));
      const safeLen = Math.min(maxLen, minLen);
      const portSeries = Array.from({ length: safeLen }, (_, i) => {
        const refDate = validCandles.find(r => r)?.[i]?.date || "";
        const label = (() => {
          if (!refDate) return "";
          try { return new Date(refDate + "T12:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" }); }
          catch { return refDate; }
        })();

        let totalPct = 0, totalW = 0;
        // Calcola peso totale solo sui titoli con dati in questo punto
        const availableW = validCandles.reduce((sum, r, j) => {
          if (r && r[i]) return sum + (parseFloat(stocks[j]?.qty)||0) * (parseFloat(stocks[j]?.currentPrice)||0);
          return sum;
        }, 0);
        if (availableW === 0) return null;
        validCandles.forEach((r, j) => {
          if (r && r[i]) {
            const w = (parseFloat(stocks[j]?.qty)||0) * (parseFloat(stocks[j]?.currentPrice)||0) / availableW;
            totalPct += r[i].pct * w;
            totalW   += w;
          }
        });
        return {
          date: refDate, label,
          pct: totalW > 0 ? parseFloat((totalPct / totalW).toFixed(2)) : 0,
          spy: spyData?.[i]?.pct ?? null,
        };
      });

      // Impatto per titolo
      const perStock = stocks.map((s, i) => {
        const r = candles[i];
        if (!r?.length) {
          const beta = s.sector === "Tech" ? 1.4 : s.sector === "Finanza" ? 1.2 : 1.0;
          const pct  = sc.spx * beta;
          return { ...s, pct, pnl: (parseFloat(s.qty)||0) * (parseFloat(s.currentPrice)||0) * rate * pct / 100, noData: true };
        }
        const pct = r[r.length - 1].pct;
        return { ...s, pct: parseFloat(pct.toFixed(2)), pnl: (parseFloat(s.qty)||0) * (parseFloat(s.currentPrice)||0) * rate * pct / 100, noData: false };
      });

      const finalPct = portSeries.length ? portSeries[portSeries.length - 1].pct : 0;
      const totalPnl = totalValue * rate * finalPct / 100;

      // Rimuovi null e ultimo punto anomalo
      const filteredSeries = portSeries.filter(Boolean).slice(0, -1);
      setCache(c => ({ ...c, [sc.id]: { portSeries: filteredSeries, perStock, totalPct: finalPct, totalPnl } }));
    } catch(e) { console.error(e); }
    setLoading(false);
  }, [stocks, totalValue, rate, eurRate]);

  useEffect(() => { fetchScenario(selected); }, [selected.id]);

  const data = cache[selected.id];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.01em" }}>Stress Test Storico</div>
        <div style={{ fontSize: 12, color: "#8A9AB0", marginTop: 4 }}>Come sarebbe andato il tuo portafoglio durante le grandi crisi? Dati reali da Yahoo Finance.</div>
      </div>

      {/* Selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {SCENARIOS_STORICI.map(sc => (
          <button key={sc.id} onClick={() => setSelected(sc)} style={{
            padding: "7px 14px", borderRadius: 20, cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, fontWeight: 600,
            border: "none", transition: "all 0.15s",
            background: selected.id === sc.id ? sc.color + "18" : "#F0F2F7",
            color: selected.id === sc.id ? sc.color : "#8A9AB0",
            outline: selected.id === sc.id ? `1.5px solid ${sc.color}44` : "none",
          }}>
            {sc.label}
          </button>
        ))}
      </div>

      {/* Header scenario */}
      <div style={{ background: "#F8FAFF", border: `1px solid ${selected.color}33`, borderRadius: 12, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>{selected.label}</div>
          <div style={{ fontSize: 11, color: "#8A9AB0" }}>{selected.desc} · {selected.from} → {selected.to}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em" }}>S&P 500</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: col(selected.spx), letterSpacing: "-0.02em" }}>{fmtPct(selected.spx, 0)}</div>
        </div>
        <div style={{ fontSize: 10, background: "#ECFDF5", color: "#16A34A", padding: "4px 10px", borderRadius: 20, fontWeight: 600 }}>● Dati reali</div>
      </div>

      {/* KPI */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Impatto portafoglio", value: `${sign(data.totalPnl)}${sym}${fmt(Math.abs(data.totalPnl))}`, color: col(data.totalPnl) },
            { label: "Performance %", value: fmtPct(data.totalPct, 2), color: col(data.totalPct) },
            { label: "Valore finale", value: `${sym}${fmt((totalValue + data.totalPnl / rate) * rate)}`, color: "#0A1628" },
          ].map(k => (
            <div key={k.label} className="card">
              <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>{k.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: k.color, letterSpacing: "-0.02em" }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Grafico */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
          Andamento portafoglio vs S&P 500
        </div>
        {loading ? (
          <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#8A9AB0", fontSize: 12 }}>
            <Spinner /> Caricamento dati storici reali…
          </div>
        ) : data?.portSeries?.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.portSeries} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} width={40} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 11, padding: "6px 12px" }}
                formatter={(v, n) => [`${v >= 0 ? "+" : ""}${v?.toFixed(2)}%`, n === "pct" ? "Portafoglio" : "S&P 500"]} />
              <ReferenceLine y={0} stroke="#E0E4EF" strokeDasharray="4 3" />
              <Line type="monotone" dataKey="pct" stroke={selected.color} strokeWidth={2} dot={false} name="pct" />
              <Line type="monotone" dataKey="spy" stroke="#8A9AB0" strokeWidth={1} dot={false} strokeDasharray="4 2" name="spy" connectNulls />
              <Legend wrapperStyle={{ fontSize: 10, color: "#8A9AB0", paddingTop: 8 }} formatter={v => v === "pct" ? "Il tuo portafoglio" : "S&P 500"} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#8A9AB0", fontSize: 12 }}>
            Dati storici non disponibili per questo scenario
          </div>
        )}
      </div>

      {/* Impatto per titolo */}
      {data?.perStock?.length > 0 && (
        <div className="card">
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Impatto per titolo</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[...data.perStock].sort((a, b) => a.pct - b.pct).map(s => (
              <div key={s.ticker} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 44, fontSize: 11, fontWeight: 700, color: "#0A1628", flexShrink: 0 }}>{s.ticker}</div>
                <div style={{ flex: 1, height: 6, background: "#F0F2F7", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, width: `${Math.min(Math.abs(s.pct), 100)}%`, background: col(s.pct) }} />
                </div>
                <div style={{ width: 60, fontSize: 11, fontWeight: 700, color: col(s.pct), textAlign: "right", flexShrink: 0 }}>
                  {fmtPct(s.pct, 1)}
                </div>
                <div style={{ width: 64, fontSize: 10, color: col(s.pnl), textAlign: "right", flexShrink: 0 }}>
                  {sign(s.pnl)}{sym}{fmt(Math.abs(s.pnl))}
                </div>
                {s.noData && <span style={{ fontSize: 8, color: "#C0C8D8" }}>stima</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sezione 2: Scenari Macro ───────────────────────────────────────────────────
function MacroScenari({ stocks, sym, rate, fmt, eurRate }) {
  const [selected, setSelected]     = useState(MACRO_SCENARI[0]);
  const [investment, setInvestment] = useState(1000);
  const [liveData, setLiveData]     = useState({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [realCache, setRealCache]   = useState({});
  const [macroData, setMacroData]   = useState(null);

  useEffect(() => {
    fetch("/api/price?symbol=__MACRO__").then(r => r.json()).then(setMacroData).catch(() => {});
  }, []);
  const [realLoading, setRealLoading] = useState(false);

  const totalValue = stocks.reduce((s, x) => s + (parseFloat(x.qty)||0) * toUSD(parseFloat(x.currentPrice)||0, x.currency, eurRate), 0);

  // Fetch dati storici reali — solo se l'utente ha selezionato esplicitamente
  const [userSelected, setUserSelected] = useState(true);
  useEffect(() => {
    if (!stocks.length || !selected.from) return;
    if (realCache[selected.id]) return;
    if (!userSelected) return;
    setRealLoading(true);
    Promise.all(
      stocks.map(s =>
        fetch(`${API_BASE}/api/scenario?symbol=${encodeURIComponent(s.ticker)}&from=${selected.from}&to=${selected.to}`)
          .then(r => r.json())
          .catch(() => null)
      )
    ).then(results => {
      const spyData = results.find(r => r?.spy)?.spy || null;
      const candles = results.map(r => r?.candles || null);
      const maxLen  = Math.max(...candles.map(r => r?.length || 0));

      // Ricalcola totalValue qui — non usare la closure
      const tv = stocks.reduce((s, x) => s + (parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0), 0) || 1;

      // Controlla se ci sono candele valide
      const hasData = candles.some(c => c && c.length > 0);

      let portSeries = [];
      if (hasData) {
        const validCandles2 = candles.map(c => c ? c.filter(p => p.date && !isNaN(new Date(p.date))) : null);
        portSeries = Array.from({ length: maxLen }, (_, i) => {
          const date = candles.find(r => r)?.[i]?.date || "";
          let totalPct = 0, totalW = 0;
          candles.forEach((r, j) => {
            if (r?.[i]) {
              const w = (parseFloat(stocks[j]?.qty)||0) * (parseFloat(stocks[j]?.currentPrice)||0) / tv;
              totalPct += r[i].pct * w;
              totalW   += w;
            }
          });
          return {
            date,
            label: date ? (() => { try { return new Date(date + "T12:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" }); } catch { return date; } })() : "",
            pct:   totalW > 0 ? parseFloat((totalPct / totalW).toFixed(2)) : 0,
            spy:   spyData?.[i]?.pct ?? null,
          };
        });
      }

      const allZero = !hasData || portSeries.every(p => p.pct === 0);
      setRealCache(c => ({ ...c, [selected.id]: { portSeries, allZero } }));
      setRealLoading(false);
    });
  }, [selected.id, stocks.length]);

  // Fetch prezzi live dei titoli consigliati
  const fetchLive = useCallback(async (sc) => {
    if (liveData[sc.id]) return;
    setLiveLoading(true);
    const tickers = [...sc.topPicks, ...sc.worstPicks].map(p => p.ticker);
    const results = await Promise.all(
      tickers.map(t =>
        fetch(`${API_BASE}/api/price?symbol=${t}`).then(r => r.json()).catch(() => null)
      )
    );
    const map = {};
    tickers.forEach((t, i) => { map[t] = results[i]; });
    setLiveData(d => ({ ...d, [sc.id]: map }));
    setLiveLoading(false);
  }, [liveData]);

  useEffect(() => { fetchLive(selected); }, [selected.id]);

  // Calcola impatto portafoglio
  const impact = useMemo(() => {
    let totalImp = 0, totalW = 0;
    stocks.forEach(s => {
      const val = (parseFloat(s.qty)||0) * (parseFloat(s.currentPrice)||0);
      // Normalizza settore: "Tecnologia" → "Tech", ecc.
      const normSector = (s.sector||"Altro")
        .replace("Tecnologia","Tech").replace("Technology","Tech")
        .replace("Financial","Finanza").replace("Finance","Finanza")
        .replace("Energy","Energia").replace("Healthcare","Salute")
        .replace("Health","Salute").replace("Materials","Materiali")
        .replace("Industrial","Industriali").replace("Utilities","Utility")
        .replace("Telecom","Telecom").replace("Consumer Disc","Consumer")
        .replace("Consumer Staples","Consumer");
      const imp = selected.impact[normSector] ?? selected.impact["Altro"] ?? 0;
      totalImp += imp * val;
      totalW   += val;
    });
    const pct    = totalW > 0 ? totalImp / totalW : 0;
    const deltaUSD = totalValue * rate * pct / 100;
    return { pct, deltaUSD };
  }, [selected, stocks, totalValue, rate]);

  // Simulazione slider: se investissi X nei top picks
  const sliderReturn = useMemo(() => {
    const avgPerf = selected.topPicks.reduce((s, p) => s + p.perf, 0) / selected.topPicks.length;
    return investment * avgPerf / 100;
  }, [investment, selected]);

  // Dati grafico con linea portafoglio
  const chartData = useMemo(() => {
    const n = selected.chartData.length;
    return selected.chartData.map((pt, i) => ({
      ...pt,
      portfolio: parseFloat((impact.pct * (i / Math.max(n - 1, 1))).toFixed(1)),
    }));
  }, [selected, impact.pct]);

  const live = liveData[selected.id] || {};

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.01em" }}>Scenari Macroeconomici</div>
        <div style={{ fontSize: 12, color: "#8A9AB0", marginTop: 4 }}>Come reagisce il tuo portafoglio a diversi contesti macro? Titoli consigliati e simulazione interattiva.</div>
      </div>

      {/* Selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {MACRO_SCENARI.map(sc => (
          <button key={sc.id} onClick={() => { setSelected(sc); setUserSelected(true); }} style={{
            padding: "7px 14px", borderRadius: 20, cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, fontWeight: 600,
            border: "none", transition: "all 0.15s",
            background: selected.id === sc.id ? sc.color + "18" : "#F0F2F7",
            color: selected.id === sc.id ? sc.color : "#8A9AB0",
            outline: selected.id === sc.id ? `1.5px solid ${sc.color}44` : "none",
          }}>
            {sc.label}
          </button>
        ))}
      </div>

      {/* Header */}
      <div style={{ background: "#F8FAFF", border: `1px solid ${selected.color}33`, borderRadius: 12, padding: "14px 18px", marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>{selected.label}</div>
          <div style={{ fontSize: 11, color: "#8A9AB0", lineHeight: 1.6 }}>{selected.desc}</div>
          <div style={{ fontSize: 10, color: "#8A9AB0", marginTop: 6 }}>⏱ Durata tipica: <strong style={{ color: "#0A1628" }}>{selected.duration}</strong></div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em" }}>S&P 500 medio</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: col(selected.spxImpact), letterSpacing: "-0.02em" }}>{fmtPct(selected.spxImpact, 0)}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em" }}>Tuo portafoglio</div>
          {(() => {
            const series = realCache[selected.id]?.portSeries;
            const realPct = series?.length ? series[series.length-1].pct : null;
            const deltaUSD = realPct != null ? totalValue * rate * realPct / 100 : null;
            return realPct != null ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, color: col(realPct), letterSpacing: "-0.02em" }}>{fmtPct(realPct, 1)}</div>
                <div style={{ fontSize: 10, color: col(deltaUSD) }}>{sign(deltaUSD)}{sym}{fmt(Math.abs(deltaUSD))}</div>
              </>
            ) : (
              <div style={{ fontSize: 22, fontWeight: 800, color: "#8A9AB0" }}>—</div>
            );
          })()}
        </div>
      </div>

      {/* Layout 2 colonne */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Grafico */}
        <div className="card">
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
            Andamento reale portafoglio — {selected.from?.slice(0,4)} / {selected.to?.slice(0,4)}
          </div>
          <div style={{ fontSize: 9, color: "#16A34A", marginBottom: 10 }}>● Dati storici reali da Yahoo Finance</div>
          {realLoading ? (
            <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#8A9AB0", fontSize: 11 }}>
              <Spinner /> Caricamento dati reali…
            </div>
          ) : realCache[selected.id]?.allZero ? (
            <div style={{ height: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#8A9AB0", fontSize: 11, textAlign: "center", gap: 8, padding: "0 20px" }}>
              <span style={{ fontSize: 24 }}>📊</span>
              <span>I tuoi titoli non erano quotati in questo periodo.</span>
              <span style={{ fontSize: 10 }}>L'impatto è stimato in base al settore → <strong style={{ color: col(impact.pct) }}>{fmtPct(impact.pct, 1)}</strong></span>
            </div>
          ) : realCache[selected.id]?.portSeries?.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={realCache[selected.id].portSeries} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} width={36} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 10, padding: "4px 10px" }}
                  formatter={(v, n) => [`${v >= 0 ? "+" : ""}${v?.toFixed(2)}%`, n === "pct" ? "Portafoglio" : "S&P 500"]} />
                <ReferenceLine y={0} stroke="#E0E4EF" strokeDasharray="4 3" />
                <Line type="monotone" dataKey="pct" stroke={selected.color} strokeWidth={2} dot={false} name="pct" />
                <Line type="monotone" dataKey="spy" stroke="#8A9AB0" strokeWidth={1} dot={false} strokeDasharray="4 2" name="spy" connectNulls />
                <Legend wrapperStyle={{ fontSize: 9, color: "#8A9AB0" }} formatter={v => v === "pct" ? "Il tuo portafoglio" : "S&P 500"} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#8A9AB0", fontSize: 11 }}>
              Dati non disponibili
            </div>
          )}
        </div>

        {/* Impatto per settore (barre) */}
        <div className="card">
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
            Impatto per settore
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={Object.entries(selected.impact).map(([sector, pct]) => ({ sector: sector.slice(0, 8), pct }))}
              margin={{ top: 4, right: 0, bottom: 20, left: 0 }}
            >
              <XAxis dataKey="sector" tick={{ fontSize: 8, fill: "#8A9AB0" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#8A9AB0" }} axisLine={false} tickLine={false} width={30} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 10, padding: "4px 8px" }}
                formatter={v => [`${v >= 0 ? "+" : ""}${v}%`, "Impatto"]} />
              <ReferenceLine y={0} stroke="#E0E4EF" />
              <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                {Object.entries(selected.impact).map(([sector, pct]) => (
                  <Cell key={sector} fill={pct >= 0 ? "#16A34A" : "#DC2626"} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Analisi approfondita */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>

        {/* 1. Probabilità scenario */}
        <div className="card">
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>🎯 Probabilità Scenario</div>
          {(() => {
            // Calcola probabilità da dati macro live
            const m = macroData;
            const fedRate = m?.fedRate ?? 3.75;
            const t10y    = m?.treasury10y ?? 4.3;
            const vix     = m?.vix ?? 18;
            const spread  = m?.yieldSpread ?? 0.5;
            const inflation = m?.impliedInflation ?? 2.5;

            let prob = 25;
            let factors = [];

            if (selected.id === "high_inflation") {
              prob = inflation > 3.5 ? 60 : inflation > 2.5 ? 35 : 20;
              factors = [
                { l: "Inflazione implicita", v: `${inflation.toFixed(1)}%`, ok: inflation > 2.5 },
                { l: "Treasury 10Y", v: `${t10y.toFixed(2)}%`, ok: t10y > 4 },
                { l: "Oro", v: m?.gold ? `$${m.gold}` : "—", ok: (m?.goldChange ?? 0) > 0 },
              ];
            } else if (selected.id === "recession") {
              prob = spread < 0 ? 55 : vix > 25 ? 45 : 25;
              factors = [
                { l: "Yield spread", v: `${spread.toFixed(2)}%`, ok: spread > 0 },
                { l: "VIX", v: vix.toFixed(1), ok: vix < 20 },
                { l: "Fed Rate", v: `${fedRate.toFixed(2)}%`, ok: fedRate < 4 },
              ];
            } else if (selected.id === "boom") {
              prob = vix < 15 && t10y < 5 ? 50 : vix < 20 ? 35 : 20;
              factors = [
                { l: "VIX (bassa paura)", v: vix.toFixed(1), ok: vix < 20 },
                { l: "S&P500 trend", v: m?.sp500Change ? `${m.sp500Change > 0 ? "+" : ""}${m.sp500Change}%` : "—", ok: (m?.sp500Change ?? 0) > 0 },
                { l: "Treasury 10Y", v: `${t10y.toFixed(2)}%`, ok: t10y < 5 },
              ];
            } else if (selected.id === "high_rates") {
              prob = fedRate > 4 ? 45 : fedRate > 3 ? 30 : 15;
              factors = [
                { l: "Fed Rate", v: `${fedRate.toFixed(2)}%`, ok: fedRate > 3.5 },
                { l: "Inflazione", v: `${inflation.toFixed(1)}%`, ok: inflation < 3 },
                { l: "Spread curva", v: `${spread.toFixed(2)}%`, ok: spread > 0 },
              ];
            } else if (selected.id === "low_rates") {
              prob = fedRate < 2 ? 55 : fedRate < 3.5 ? 30 : 15;
              factors = [
                { l: "Fed Rate", v: `${fedRate.toFixed(2)}%`, ok: fedRate < 3 },
                { l: "Inflazione", v: `${inflation.toFixed(1)}%`, ok: inflation < 2.5 },
                { l: "VIX", v: vix.toFixed(1), ok: vix < 20 },
              ];
            } else {
              prob = inflation < 2.5 && vix < 20 ? 45 : 30;
              factors = [
                { l: "Inflazione", v: `${inflation.toFixed(1)}%`, ok: inflation < 2.5 },
                { l: "Fed Rate", v: `${fedRate.toFixed(2)}%`, ok: fedRate < 4 },
                { l: "Treasury 10Y", v: `${t10y.toFixed(2)}%`, ok: t10y < 4.5 },
              ];
            }
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
                    <svg viewBox="0 0 36 36" style={{ width: "100%", transform: "rotate(-90deg)" }}>
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F0F2F7" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke={selected.color} strokeWidth="3"
                        strokeDasharray={`${prob} ${100-prob}`} strokeLinecap="round" />
                    </svg>
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: selected.color }}>{prob}%</div>
                  </div>
                  <div style={{ fontSize: 10, color: "#8A9AB0", lineHeight: 1.5 }}>
                    Probabilità stimata nei prossimi 12 mesi basata su indicatori macro attuali
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {factors.map(f => (
                    <div key={f.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#8A9AB0" }}>{f.l}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: f.ok ? "#16A34A" : "#DC2626", background: f.ok ? "#ECFDF5" : "#FEF2F2", padding: "2px 8px", borderRadius: 10 }}>{f.v}</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* 2. Analisi rischio */}
        <div className="card">
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>⚠️ Analisi Rischio</div>
          {(() => {
            const series = realCache[selected.id]?.portSeries || [];
            if (!series.length) return <div style={{ fontSize: 11, color: "#8A9AB0" }}>Carica dati per vedere il rischio</div>;

            const returns = series.slice(1).map((p, i) => p.pct - series[i].pct);
            const mean = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
            const std  = Math.sqrt(returns.reduce((s, r) => s + (r - mean)**2, 0) / (returns.length || 1));

            // VaR 95% (z=1.645)
            const var95 = -(mean - 1.645 * std);

            // Max drawdown
            let peak = series[0]?.pct || 0, maxDD = 0;
            series.forEach(p => {
              if (p.pct > peak) peak = p.pct;
              const dd = p.pct - peak;
              if (dd < maxDD) maxDD = dd;
            });

            // Correlazione con SPY
            const spySeries = series.filter(p => p.spy != null);
            let corr = null;
            if (spySeries.length > 5) {
              const portR = spySeries.slice(1).map((p, i) => p.pct - spySeries[i].pct);
              const spyR  = spySeries.slice(1).map((p, i) => p.spy - spySeries[i].spy);
              const mP = portR.reduce((s,r)=>s+r,0)/portR.length;
              const mS = spyR.reduce((s,r)=>s+r,0)/spyR.length;
              let num=0, dP=0, dS=0;
              portR.forEach((r,i) => { num+=(r-mP)*(spyR[i]-mS); dP+=(r-mP)**2; dS+=(spyR[i]-mS)**2; });
              corr = dP*dS > 0 ? num/Math.sqrt(dP*dS) : null;
            }

            const metrics = [
              { l: "VaR 95% (giorn.)", v: `${var95.toFixed(2)}%`, color: "#DC2626" },
              { l: "Max Drawdown", v: `${maxDD.toFixed(1)}%`, color: "#DC2626" },
              { l: "Volatilità", v: `${(std * Math.sqrt(252)).toFixed(1)}%`, color: "#F97316" },
              { l: "Corr. S&P500", v: corr != null ? corr.toFixed(2) : "—", color: "#8A9AB0" },
            ];

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {metrics.map(m => (
                  <div key={m.l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#F8FAFF", borderRadius: 8 }}>
                    <span style={{ fontSize: 10, color: "#8A9AB0" }}>{m.l}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: m.color }}>{m.v}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* 3. Raccomandazioni ribilanciamento */}
        <div className="card">
          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>🔄 Ribilanciamento Consigliato</div>
          {(() => {
            const totalVal = stocks.reduce((s, x) => s + (parseFloat(x.qty)||0)*(parseFloat(x.currentPrice)||0), 0) || 1;
            // Raggruppa per settore
            const bySector = {};
            stocks.forEach(s => {
              const sec = s.sector || "Altro";
              const val = (parseFloat(s.qty)||0)*(parseFloat(s.currentPrice)||0);
              bySector[sec] = (bySector[sec] || 0) + val;
            });
            // Calcola peso attuale vs ottimale (basato sull'impatto dello scenario)
            const recs = Object.entries(bySector).map(([sec, val]) => {
              const currentPct = val / totalVal * 100;
              const imp = selected.impact[sec] ?? selected.impact["Altro"] ?? 0;
              // Scenario positivo per settore → aumenta peso; negativo → riduci
              const targetPct = Math.max(5, Math.min(50, currentPct + imp * 0.3));
              const diff = targetPct - currentPct;
              return { sec, currentPct, targetPct, diff };
            }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 4);

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recs.map(r => (
                  <div key={r.sec}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#0A1628" }}>{r.sec}</span>
                      <span style={{ fontSize: 10, color: r.diff >= 0 ? "#16A34A" : "#DC2626", fontWeight: 700 }}>
                        {r.diff >= 0 ? "↑" : "↓"} {Math.abs(r.diff).toFixed(0)}pp
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <div style={{ flex: 1, height: 4, background: "#F0F2F7", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${r.currentPct}%`, background: "#8A9AB0", borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 9, color: "#8A9AB0", width: 30, textAlign: "right" }}>{r.currentPct.toFixed(0)}%→{r.targetPct.toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 9, color: "#C0C8D8", marginTop: 4, lineHeight: 1.5 }}>
                  * Basato su performance storiche del settore in scenari simili
                </div>
              </div>
            );
          })()}
        </div>

      </div>

      {/* Titoli consigliati con prezzi live */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div style={{ fontSize: 9, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>✅ Acquista in questo scenario</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selected.topPicks.map(p => {
              const ld = live[p.ticker];
              return (
                <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: "#16A34A12", border: "1px solid #16A34A30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#16A34A", flexShrink: 0 }}>
                    {p.ticker.slice(0, 3)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628" }}>{p.ticker}</div>
                    <div style={{ fontSize: 9, color: "#8A9AB0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.reason}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {liveLoading ? (
                      <div style={{ fontSize: 10, color: "#C0C8D8" }}>…</div>
                    ) : ld?.price ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628" }}>${ld.price.toFixed(2)}</div>
                        <div style={{ fontSize: 9, color: col(ld.changePct) }}>{fmtPct(ld.changePct, 2)}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#16A34A" }}>+{p.perf}%</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 9, color: "#DC2626", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>❌ Riduci o evita</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selected.worstPicks.map(p => {
              const ld = live[p.ticker];
              return (
                <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: "#DC262612", border: "1px solid #DC262630", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#DC2626", flexShrink: 0 }}>
                    {p.ticker.slice(0, 3)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628" }}>{p.ticker}</div>
                    <div style={{ fontSize: 9, color: "#8A9AB0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.reason}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {liveLoading ? (
                      <div style={{ fontSize: 10, color: "#C0C8D8" }}>…</div>
                    ) : ld?.price ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628" }}>${ld.price.toFixed(2)}</div>
                        <div style={{ fontSize: 9, color: col(ld.changePct) }}>{fmtPct(ld.changePct, 2)}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#DC2626" }}>{p.perf}%</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Impatto sui tuoi titoli */}
          {stocks.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #F0F2F7" }}>
              <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Il tuo portafoglio</div>
              {stocks.map(s => {
                // Normalizza settore: "Tecnologia" → "Tech", ecc.
      const normSector = (s.sector||"Altro")
        .replace("Tecnologia","Tech").replace("Technology","Tech")
        .replace("Financial","Finanza").replace("Finance","Finanza")
        .replace("Energy","Energia").replace("Healthcare","Salute")
        .replace("Health","Salute").replace("Materials","Materiali")
        .replace("Industrial","Industriali").replace("Utilities","Utility")
        .replace("Telecom","Telecom").replace("Consumer Disc","Consumer")
        .replace("Consumer Staples","Consumer");
      const imp = selected.impact[normSector] ?? selected.impact["Altro"] ?? 0;
                return (
                  <div key={s.ticker} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#0A1628", width: 44, flexShrink: 0 }}>{s.ticker}</span>
                    <div style={{ flex: 1, height: 4, background: "#F0F2F7", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(Math.abs(imp), 50) * 2}%`, background: col(imp), borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: col(imp), width: 44, textAlign: "right", flexShrink: 0 }}>{fmtPct(imp, 0)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sezione 3: Confronto scenari ──────────────────────────────────────────────
function ConfrونtoScenari({ stocks, sym, rate, fmt, eurRate }) {
  const totalValue = stocks.reduce((s, x) => s + (parseFloat(x.qty)||0) * toUSD(parseFloat(x.currentPrice)||0, x.currency, eurRate), 0);

  const rows = MACRO_SCENARI.map(sc => {
    let totalImp = 0, totalW = 0;
    stocks.forEach(s => {
      const val = (parseFloat(s.qty)||0) * (parseFloat(s.currentPrice)||0);
      const imp = sc.impact[s.sector || "Altro"] ?? 0;
      totalImp += imp * val;
      totalW   += val;
    });
    const pct = totalW > 0 ? totalImp / totalW : 0;
    const deltaUSD = totalValue * rate * pct / 100;
    return { ...sc, portPct: pct, deltaUSD };
  }).sort((a, b) => b.portPct - a.portPct);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.01em" }}>Confronto Scenari</div>
        <div style={{ fontSize: 12, color: "#8A9AB0", marginTop: 4 }}>Tutti gli scenari macro a confronto — impatto stimato sul tuo portafoglio.</div>
      </div>

      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 100px 80px", gap: 8, padding: "8px 0 12px", borderBottom: "1px solid #F0F2F7", marginBottom: 8 }}>
          {["Scenario", "Durata", "S&P 500", "Tuo portafoglio", "Delta USD"].map(h => (
            <div key={h} style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{h}</div>
          ))}
        </div>
        {rows.map((sc, i) => (
          <div key={sc.id} style={{
            display: "grid", gridTemplateColumns: "1fr 80px 80px 100px 80px",
            gap: 8, padding: "12px 0",
            borderBottom: i < rows.length - 1 ? "1px solid #F8FAFF" : "none",
            background: sc.portPct >= 0 ? "transparent" : "#FFF8F8",
            borderRadius: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 4, height: 24, borderRadius: 2, background: sc.color, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628" }}>{sc.label}</div>
                <div style={{ fontSize: 9, color: "#8A9AB0" }}>{sc.desc.slice(0, 40)}…</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#8A9AB0", display: "flex", alignItems: "center" }}>{sc.duration}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: col(sc.spxImpact), display: "flex", alignItems: "center" }}>{fmtPct(sc.spxImpact, 0)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, height: 6, background: "#F0F2F7", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(Math.abs(sc.portPct), 50) * 2}%`, background: col(sc.portPct), borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: col(sc.portPct), minWidth: 44, textAlign: "right" }}>{fmtPct(sc.portPct, 1)}</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: col(sc.deltaUSD), display: "flex", alignItems: "center" }}>
              {sign(sc.deltaUSD)}{sym}{fmt(Math.abs(sc.deltaUSD))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── EXPORT PRINCIPALE ─────────────────────────────────────────────────────────
export function SimulazioniTabNew({ stocks, sym, rate, fmt, eurRate }) {
  const [section, setSection] = useState("stress");

  const tabs = [
    { id: "stress",    label: "🔴 Stress Test Storico" },
    { id: "macro",     label: "🌍 Scenari Macro" },
  ];

  return (
    <div className="fade-up" style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 40px" }}>
      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 28, borderBottom: "1px solid #E8EBF4", paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSection(t.id)} style={{
            padding: "10px 16px", background: "none", border: "none",
            fontSize: 12, fontWeight: section === t.id ? 700 : 500,
            color: section === t.id ? "#0A1628" : "#8A9AB0",
            cursor: "pointer", fontFamily: "inherit",
            borderBottom: section === t.id ? "2px solid #0A1628" : "2px solid transparent",
            marginBottom: -1, transition: "all 0.15s",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {section === "stress"    && <StressTest stocks={stocks} sym={sym} rate={rate} fmt={fmt} eurRate={eurRate} />}
      {section === "macro"     && <MacroScenari stocks={stocks} sym={sym} rate={rate} fmt={fmt} eurRate={eurRate} />}

    </div>
  );
}
