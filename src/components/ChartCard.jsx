import { useState, useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { useChart } from "../hooks/useChart";
import { parseBuyDate } from "../utils/dates";
import { fmt } from "../utils/format";

function Spinner({ color = "#F4C542", size = 11 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />;
}

const PERIODS = ["1M", "3M", "6M", "1A", "Inizio"];

export function ChartCard({ stocks, eurRate }) {
  const [period, setPeriod]           = useState("6M");
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [mode, setMode]               = useState("performance"); // "performance" | "valore"

  const { chartData, loading } = useChart(stocks, eurRate, period);

  // Ultimo valore per header
  const lastPoint  = chartData[chartData.length - 1];
  const lastPct    = lastPoint?.pnlPct  ?? 0;   // P&L% assoluto (da inizio investimento)
  const lastValore = lastPoint?.valore  ?? 0;
  const isPositive = lastPct >= 0;
  const lineColor  = isPositive ? "#5EC98A" : "#E87040";

  // dataKey in base alla modalità
  const dataKey = mode === "performance" ? "pnlPct" : "valore";

  // Formatter tooltip
  const tooltipFmt = (v, name) => {
    if (name === "pnlPct")  return [`${v >= 0 ? "+" : ""}${v?.toFixed(2)}%`, "Portafoglio"];
    if (name === "valore")  return [`$${fmt(v)}`, "Portafoglio"];
    if (name === "spyPct")  return [`${v >= 0 ? "+" : ""}${v?.toFixed(2)}%`, "S&P 500"];
    return [v, name];
  };

  // Marker acquisti
  const purchaseMarkers = useMemo(() => {
    if (!chartData.length) return [];
    const firstDate = chartData[0]?.date;
    const seen = new Set();
    const markers = [];

    stocks.forEach(s => {
      const bd = parseBuyDate(s.buyDate);
      if (!bd) return;
      const bdISO = bd.toISOString().split("T")[0];
      const key = s.ticker + bdISO;
      if (seen.has(key)) return;
      seen.add(key);

      const pt = bdISO >= firstDate
        ? chartData.find(p => p.date >= bdISO)
        : chartData[0];

      if (pt) markers.push({ ...pt, ticker: s.ticker, beforeRange: bdISO < firstDate });
    });

    return markers;
  }, [chartData, stocks]);

  return (
    <div className="card" style={{ marginBottom: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>

        {/* Toggle Valore / Performance */}
        <div style={{ display: "flex", background: "#0f1117", borderRadius: 4, padding: 2, gap: 2 }}>
          {[["performance", "%"], ["valore", "$"]].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              background: mode === m ? "#1a1d26" : "none",
              border: "none", borderRadius: 3,
              color: mode === m ? "#E8E6DF" : "#444",
              fontFamily: "inherit", fontSize: 10, padding: "3px 10px",
              cursor: "pointer", fontWeight: mode === m ? 600 : 400,
              transition: "all 0.15s",
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* Periodo */}
        <div style={{ display: "flex", gap: 2 }}>
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              background: period === p ? "#F4C54222" : "none",
              border: period === p ? "1px solid #F4C54244" : "1px solid transparent",
              color: period === p ? "#F4C542" : "#333",
              fontFamily: "inherit", fontSize: 10, padding: "3px 9px",
              borderRadius: 3, cursor: "pointer",
            }}>
              {p}
            </button>
          ))}
        </div>

        {/* vs S&P e % header */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setShowBenchmark(v => !v)} style={{
            fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer",
            fontFamily: "inherit", border: "1px solid",
            background: showBenchmark ? "#F4C54211" : "none",
            color: showBenchmark ? "#F4C542" : "#333",
            borderColor: showBenchmark ? "#F4C54244" : "#2a2d35",
          }}>
            vs S&P 500
          </button>
          <span style={{ fontSize: 11, color: lineColor, fontWeight: 600 }}>
            {isPositive ? "▲" : "▼"} {Math.abs(lastPct).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* ── Grafico ── */}
      {loading ? (
        <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#333", fontSize: 11 }}>
          <Spinner size={14} /> Caricamento…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={lineColor} stopOpacity={0.15} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide axisLine={false} tickLine={false} />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, fontSize: 11, color: "#E8E6DF", padding: "6px 12px" }}
              formatter={tooltipFmt}
              labelStyle={{ color: "#555", fontSize: 10, marginBottom: 2 }}
              cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: "4 2" }}
            />
            <Area type="monotone" dataKey={dataKey}
              stroke={lineColor} strokeWidth={1.5}
              fill="url(#chartGrad)" dot={false}
              activeDot={{ r: 4, fill: lineColor, stroke: "#0D0F14", strokeWidth: 2 }}
            />
            {/* S&P 500 solo in modalità performance */}
            {showBenchmark && mode === "performance" && (
              <Line type="monotone" dataKey="spyPct"
                stroke="#F4C542" strokeWidth={1}
                dot={false} strokeDasharray="4 2"
                activeDot={{ r: 3, fill: "#F4C542" }}
                connectNulls={true}
              />
            )}
            {purchaseMarkers.map(m => (
              <ReferenceLine key={m.ticker + m.date} x={m.label}
                stroke="#7EB8F755" strokeDasharray="3 3" strokeWidth={1}
                label={{ value: m.ticker, position: "insideTopRight", fill: "#7EB8F7", fontSize: 8 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* ── Legenda ── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "8px 0 0", borderTop: "1px solid #0f1117", marginTop: 8, alignItems: "center" }}>
        {showBenchmark && mode === "performance" && (() => {
          const spyLast = [...chartData].reverse().find(p => p.spyPct != null)?.spyPct;
          if (spyLast == null) return null;
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#444" }}>
              <div style={{ width: 16, height: 1, borderTop: "1px dashed #F4C542" }} />
              <span style={{ color: "#F4C542" }}>S&P 500</span>
              <span style={{ color: spyLast >= 0 ? "#5EC98A" : "#E87040" }}>
                {spyLast >= 0 ? "+" : ""}{spyLast.toFixed(2)}%
              </span>
            </div>
          );
        })()}
        {purchaseMarkers.map(m => (
          <div key={m.ticker + m.date} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7EB8F7", flexShrink: 0 }} />
            <span style={{ color: "#7EB8F7" }}>{m.ticker}</span>
            <span style={{ color: "#333" }}>{m.beforeRange ? "(prima del periodo)" : `@ $${fmt(m.beforeRange ? 0 : lastValore)}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
