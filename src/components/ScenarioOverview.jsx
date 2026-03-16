import { useState, useMemo } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";

const MACRO_SCENARIOS = [
  {
    id: "high_inflation", label: "Alta Inflazione", icon: "📈", color: "#E87040",
    desc: "Inflazione >5%. Energia e commodities salgono, tech e bond scendono.",
    impact: { "Tech": -0.25, "Finanza": +0.08, "Energia": +0.45, "Materiali": +0.30, "Salute": -0.05, "Consumer": -0.15, "Industriali": +0.10, "Utility": -0.12, "Real Estate": -0.20, "Telecom": -0.08, "ETF": -0.10, "Altro": -0.05 },
    spxImpact: -0.12, duration: "12-18 mesi",
    topPicks: [
      { ticker: "XLE", name: "Energy ETF", reason: "Energia sale con inflazione", perf: 42 },
      { ticker: "GLD", name: "Gold ETF", reason: "Oro come hedge", perf: 18 },
      { ticker: "CVX", name: "Chevron", reason: "Petrolio beneficia", perf: 55 },
    ],
    chartData: [
      { m: "M1", port: -2, spx: -1 }, { m: "M3", port: -6, spx: -4 },
      { m: "M6", port: -11, spx: -8 }, { m: "M9", port: -15, spx: -10 }, { m: "M12", port: -18, spx: -12 },
    ],
  },
  {
    id: "low_rates", label: "Tassi Bassi", icon: "💸", color: "#5EC98A",
    desc: "Fed Funds Rate <1%. Risk-on, growth e credito salgono.",
    impact: { "Tech": +0.35, "Finanza": -0.05, "Energia": +0.10, "Materiali": +0.12, "Salute": +0.10, "Consumer": +0.20, "Industriali": +0.15, "Utility": +0.10, "Real Estate": +0.30, "Telecom": +0.12, "ETF": +0.18, "Altro": +0.10 },
    spxImpact: +0.25, duration: "24-36 mesi",
    topPicks: [
      { ticker: "QQQ", name: "Nasdaq ETF", reason: "Tech esplode con tassi zero", perf: 80 },
      { ticker: "VNQ", name: "Real Estate ETF", reason: "REIT in forte rally", perf: 35 },
      { ticker: "TSLA", name: "Tesla", reason: "Growth stocks beneficiano", perf: 200 },
    ],
    chartData: [
      { m: "M1", port: 3, spx: 3 }, { m: "M3", port: 9, spx: 8 },
      { m: "M6", port: 18, spx: 15 }, { m: "M9", port: 26, spx: 22 }, { m: "M12", port: 32, spx: 28 },
    ],
  },
  {
    id: "recession", label: "Recessione", icon: "📊", color: "#F4C542",
    desc: "GDP negativo 2+ trimestri. Difensivi, oro e bond come rifugio.",
    impact: { "Tech": -0.20, "Finanza": -0.30, "Energia": -0.25, "Materiali": -0.28, "Salute": +0.05, "Consumer": -0.15, "Industriali": -0.22, "Utility": +0.02, "Real Estate": -0.18, "Telecom": +0.02, "ETF": -0.18, "Altro": -0.15 },
    spxImpact: -0.30, duration: "6-18 mesi",
    topPicks: [
      { ticker: "GLD", name: "Gold ETF", reason: "Oro come rifugio sicuro", perf: 25 },
      { ticker: "TLT", name: "Long Gov Bonds", reason: "Treasury salgono", perf: 30 },
      { ticker: "XLV", name: "Healthcare ETF", reason: "Salute è difensiva", perf: 5 },
    ],
    chartData: [
      { m: "M1", port: -4, spx: -5 }, { m: "M3", port: -11, spx: -14 },
      { m: "M6", port: -18, spx: -22 }, { m: "M9", port: -23, spx: -28 }, { m: "M12", port: -26, spx: -30 },
    ],
  },
  {
    id: "boom", label: "Boom Economico", icon: "🚀", color: "#26C6DA",
    desc: "Crescita GDP >3%, piena occupazione. Ciclici e tech esplodono.",
    impact: { "Tech": +0.30, "Finanza": +0.20, "Energia": +0.25, "Materiali": +0.35, "Salute": +0.08, "Consumer": +0.28, "Industriali": +0.32, "Utility": -0.05, "Real Estate": +0.15, "Telecom": +0.18, "ETF": +0.22, "Altro": +0.15 },
    spxImpact: +0.28, duration: "12-36 mesi",
    topPicks: [
      { ticker: "IWM", name: "Russell 2000", reason: "Small cap salgono in boom", perf: 35 },
      { ticker: "XLI", name: "Industrials ETF", reason: "Industriali in forte crescita", perf: 30 },
      { ticker: "NVDA", name: "Nvidia", reason: "Tech ciclico + AI capex", perf: 80 },
    ],
    chartData: [
      { m: "M1", port: 3, spx: 3 }, { m: "M3", port: 8, spx: 8 },
      { m: "M6", port: 16, spx: 15 }, { m: "M9", port: 22, spx: 20 }, { m: "M12", port: 28, spx: 28 },
    ],
  },
  {
    id: "high_rates", label: "Tassi Alti", icon: "🏦", color: "#BF6EEA",
    desc: "Fed Funds Rate >4%. Banche e valore outperformano.",
    impact: { "Tech": -0.30, "Finanza": +0.15, "Energia": +0.05, "Materiali": -0.05, "Salute": +0.05, "Consumer": -0.12, "Industriali": -0.08, "Utility": -0.20, "Real Estate": -0.25, "Telecom": -0.10, "ETF": -0.08, "Altro": -0.10 },
    spxImpact: -0.15, duration: "12-24 mesi",
    topPicks: [
      { ticker: "XLF", name: "Financial ETF", reason: "Banche con margini in espansione", perf: 18 },
      { ticker: "JPM", name: "JPMorgan", reason: "Margini netti crescono", perf: 22 },
      { ticker: "BRK.B", name: "Berkshire", reason: "Float assicurativo rende di più", perf: 20 },
    ],
    chartData: [
      { m: "M1", port: -2, spx: -1 }, { m: "M3", port: -5, spx: -4 },
      { m: "M6", port: -9, spx: -8 }, { m: "M9", port: -12, spx: -12 }, { m: "M12", port: -14, spx: -15 },
    ],
  },
  {
    id: "low_inflation", label: "Bassa Inflazione", icon: "📉", color: "#5B8DEF",
    desc: "Inflazione <2% con crescita stabile. Tech e bond in rally.",
    impact: { "Tech": +0.25, "Finanza": +0.05, "Energia": -0.10, "Materiali": -0.08, "Salute": +0.12, "Consumer": +0.15, "Industriali": +0.08, "Utility": +0.15, "Real Estate": +0.20, "Telecom": +0.10, "ETF": +0.12, "Altro": +0.08 },
    spxImpact: +0.18, duration: "12-24 mesi",
    topPicks: [
      { ticker: "QQQ", name: "Nasdaq ETF", reason: "Tech cresce con tassi bassi", perf: 28 },
      { ticker: "TLT", name: "Long Bonds", reason: "Bond lunghi in rally", perf: 22 },
      { ticker: "VNQ", name: "Real Estate ETF", reason: "REIT beneficiano", perf: 18 },
    ],
    chartData: [
      { m: "M1", port: 2, spx: 1 }, { m: "M3", port: 6, spx: 5 },
      { m: "M6", port: 12, spx: 10 }, { m: "M9", port: 16, spx: 14 }, { m: "M12", port: 20, spx: 18 },
    ],
  },
];

export function ScenarioOverview({ stocks, totalValue, fmt, sym }) {
  const [selected, setSelected] = useState(MACRO_SCENARIOS[0]);
  const [showAlert, setShowAlert] = useState(true);

  // Calcola impatto sul portafoglio per lo scenario selezionato
  const portfolioImpact = useMemo(() => {
    if (!stocks.length || !totalValue) return null;

    let totalImpact = 0;
    let totalWeight = 0;

    stocks.forEach(s => {
      const val    = (parseFloat(s.qty) || 0) * (parseFloat(s.currentPrice) || 0);
      const sector = s.sector || "Altro";
      const impact = selected.impact[sector] ?? selected.impact["Altro"] ?? 0;
      totalImpact += impact * val;
      totalWeight += val;
    });

    const pct    = totalWeight > 0 ? (totalImpact / totalWeight) * 100 : 0;
    const deltaUSD = totalValue * (pct / 100);
    return { pct, deltaUSD };
  }, [stocks, totalValue, selected]);

  // Alert: scenari negativi con esposizione significativa
  const negativeAlert = useMemo(() => {
    return MACRO_SCENARIOS.filter(sc => {
      if (sc.spxImpact >= 0) return false;
      let impact = 0, weight = 0;
      stocks.forEach(s => {
        const val = (parseFloat(s.qty) || 0) * (parseFloat(s.currentPrice) || 0);
        const sector = s.sector || "Altro";
        impact += (sc.impact[sector] ?? -0.1) * val;
        weight += val;
      });
      const pct = weight > 0 ? impact / weight * 100 : 0;
      return pct < -10;
    });
  }, [stocks]);

  // Proiezione portafoglio con scenario
  const projectionData = useMemo(() => {
    if (!totalValue || !portfolioImpact) return [];
    return selected.chartData.map(d => ({
      m: d.m,
      portafoglio: parseFloat((totalValue * (1 + d.port / 100)).toFixed(0)),
      spx: parseFloat((totalValue * (1 + d.spx / 100)).toFixed(0)),
      portPct: d.port,
      spxPct: d.spx,
    }));
  }, [selected, totalValue, portfolioImpact]);

  const isPositive = (portfolioImpact?.pct ?? 0) >= 0;
  const impactColor = isPositive ? "#5EC98A" : "#E87040";

  return (
    <div style={{ marginBottom: 16 }}>

      {/* ── Alert scenari negativi ── */}
      {showAlert && negativeAlert.length > 0 && (
        <div style={{
          background: "linear-gradient(135deg, #1a0a00, #2d1200)",
          border: "1px solid #E8704044", borderRadius: 12,
          padding: "14px 16px", marginBottom: 12,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#E87040", marginBottom: 2 }}>
              Esposizione a scenari negativi
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
              Il tuo portafoglio è vulnerabile a: {negativeAlert.map(s => s.label).join(", ")}
            </div>
          </div>
          <button onClick={() => setShowAlert(false)} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
        </div>
      )}

      <div className="card" style={{ padding: "20px 20px 16px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628", marginBottom: 2 }}>Scenari Macro</div>
            <div style={{ fontSize: 11, color: "#8A9AB0" }}>Come reagisce il tuo portafoglio?</div>
          </div>
          {portfolioImpact && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: impactColor, letterSpacing: "-0.02em" }}>
                {portfolioImpact.pct >= 0 ? "+" : ""}{portfolioImpact.pct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 10, color: "#8A9AB0" }}>
                {portfolioImpact.deltaUSD >= 0 ? "+" : ""}{sym}{fmt(Math.abs(portfolioImpact.deltaUSD))}
              </div>
            </div>
          )}
        </div>

        {/* Selector scenari */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {MACRO_SCENARIOS.map(sc => (
            <button key={sc.id} onClick={() => setSelected(sc)} style={{
              padding: "6px 12px", borderRadius: 20, cursor: "pointer",
              fontFamily: "inherit", fontSize: 11, fontWeight: 600,
              border: "none", transition: "all 0.15s",
              background: selected.id === sc.id ? sc.color + "20" : "rgba(0,0,0,0.04)",
              color: selected.id === sc.id ? sc.color : "#8A9AB0",
              outline: selected.id === sc.id ? `1.5px solid ${sc.color}44` : "none",
            }}>
              {sc.icon} {sc.label}
            </button>
          ))}
        </div>

        {/* Descrizione scenario */}
        <div style={{
          background: selected.color + "10", border: `1px solid ${selected.color}22`,
          borderRadius: 10, padding: "10px 14px", marginBottom: 16,
          fontSize: 12, color: "#5A6A7E", lineHeight: 1.6,
        }}>
          <span style={{ color: selected.color, fontWeight: 600 }}>{selected.duration}</span> — {selected.desc}
        </div>

        {/* Layout 2 colonne */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Grafico proiezione */}
          <div>
            <div style={{ fontSize: 10, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              Proiezione portafoglio
            </div>
            {projectionData.length > 0 && (
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={projectionData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={impactColor} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={impactColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="m" tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} />
                  <YAxis hide domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 10, padding: "4px 10px" }}
                    formatter={(v, name) => [`${sym}${v?.toLocaleString()}`, name === "portafoglio" ? "Portafoglio" : "S&P 500"]}
                  />
                  <Area type="monotone" dataKey="portafoglio" stroke={impactColor} strokeWidth={1.5} fill="url(#portGrad)" dot={false} />
                  <Area type="monotone" dataKey="spx" stroke="#8A9AB0" strokeWidth={1} fill="none" dot={false} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            )}
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: impactColor }}>
                <div style={{ width: 12, height: 2, background: impactColor, borderRadius: 1 }} />
                Il tuo portafoglio
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#8A9AB0" }}>
                <div style={{ width: 12, height: 1, borderTop: "1px dashed #8A9AB0" }} />
                S&P 500
              </div>
            </div>
          </div>

          {/* Titoli consigliati */}
          <div>
            <div style={{ fontSize: 10, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              Titoli consigliati
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {selected.topPicks.map(p => (
                <div key={p.ticker} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "#F8FAFF", borderRadius: 8, padding: "8px 10px",
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: selected.color + "15", border: `1px solid ${selected.color}30`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 800, color: selected.color,
                  }}>
                    {p.ticker.slice(0, 3)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628" }}>{p.ticker}</div>
                    <div style={{ fontSize: 9, color: "#8A9AB0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.reason}</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#5EC98A", flexShrink: 0 }}>
                    +{p.perf}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Impatto per settore */}
        {stocks.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #F0F2F7" }}>
            <div style={{ fontSize: 10, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
              Impatto sui tuoi titoli
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stocks.map(s => {
                const sector  = s.sector || "Altro";
                const impact  = (selected.impact[sector] ?? 0) * 100;
                const val     = (parseFloat(s.qty) || 0) * (parseFloat(s.currentPrice) || 0);
                const deltaUSD = val * (impact / 100);
                const isPos   = impact >= 0;
                return (
                  <div key={s.id || s.ticker} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 44, fontSize: 10, fontWeight: 700, color: "#0A1628", flexShrink: 0 }}>{s.ticker}</div>
                    <div style={{ flex: 1, height: 4, background: "#F0F2F7", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 2,
                        width: `${Math.min(Math.abs(impact) * 2, 100)}%`,
                        background: isPos ? "#5EC98A" : "#E87040",
                        marginLeft: isPos ? 0 : "auto",
                      }} />
                    </div>
                    <div style={{ width: 48, fontSize: 10, fontWeight: 600, color: isPos ? "#5EC98A" : "#E87040", textAlign: "right", flexShrink: 0 }}>
                      {isPos ? "+" : ""}{impact.toFixed(0)}%
                    </div>
                    <div style={{ width: 60, fontSize: 9, color: "#8A9AB0", textAlign: "right", flexShrink: 0 }}>
                      {deltaUSD >= 0 ? "+" : ""}{sym}{fmt(Math.abs(deltaUSD))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
