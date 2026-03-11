import { useState, useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { useChart } from "../hooks/useChart";
import { parseBuyDate } from "../utils/dates";
import { fmt } from "../utils/format";

function Spinner({ color = "#5EC98A", size = 11 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />;
}

const PERIODS = ["1M", "3M", "6M", "1A", "Inizio"];

export function ChartCard({ stocks, eurRate }) {
  const [period, setPeriod]           = useState("1A");
  const [showBenchmark, setShowBenchmark] = useState(false);

  const { chartData, loading } = useChart(stocks, eurRate, period);

  const lastPoint  = chartData[chartData.length - 1];
  const lastValore = lastPoint?.valore  ?? 0;
  const lastCosto  = lastPoint?.costoTot ?? 0;
  const lastPct    = lastPoint?.pct     ?? 0;
  const isPositive = lastValore >= lastCosto;
  const lineColor  = isPositive ? "#5EC98A" : "#E87040";

  // Linea break-even = costo medio del periodo (costante o a gradini)
  // Usiamo il costoTot del primo punto del range come riferimento
  const costoBase  = chartData[0]?.costoTot ?? 0;

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
    <div className="card" style={{ marginBottom: 16, padding: "20px 20px 12px" }}>

      {/* ── Valore + % header stile Getquin ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: "#E8E6DF", letterSpacing: "-0.5px" }}>
          ${fmt(lastValore)}
        </div>
        <div style={{ fontSize: 12, color: lineColor, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
          <span>{isPositive ? "↑" : "↓"} {Math.abs(lastPct).toFixed(2)}%</span>
          <span style={{ color: "#444" }}>
            ({isPositive ? "+" : ""}${fmt(lastValore - lastCosto)})
          </span>
          <span style={{ color: "#2a2d35", margin: "0 2px" }}>·</span>
          <span style={{ color: "#444", fontSize: 11 }}>{period === "Inizio" ? "da inizio" : `ultimi ${period}`}</span>
        </div>
      </div>

      {/* ── Controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              background: period === p ? "#1a1d26" : "none",
              border: "none",
              color: period === p ? "#E8E6DF" : "#444",
              fontFamily: "inherit", fontSize: 10, padding: "3px 9px",
              borderRadius: 3, cursor: "pointer",
              fontWeight: period === p ? 600 : 400,
            }}>
              {p}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={() => setShowBenchmark(v => !v)} style={{
            fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer",
            fontFamily: "inherit", border: "1px solid",
            background: showBenchmark ? "#F4C54211" : "none",
            color: showBenchmark ? "#F4C542" : "#444",
            borderColor: showBenchmark ? "#F4C54244" : "#2a2d35",
          }}>
            vs S&P 500
          </button>
        </div>
      </div>

      {/* ── Grafico ── */}
      {loading ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#444", fontSize: 11 }}>
          <Spinner size={14} color={lineColor} /> Caricamento…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={lineColor} stopOpacity={0.18} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, fontSize: 11, color: "#E8E6DF", padding: "6px 12px" }}
              formatter={(v, name) => {
                if (name === "valore")    return [`$${fmt(v)}`, "Portafoglio"];
                if (name === "spyScaled") return [`$${fmt(v)}`, "S&P 500"];
                return [v, name];
              }}
              labelStyle={{ color: "#555", fontSize: 10, marginBottom: 3 }}
              cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: "4 2" }}
            />

            {/* Linea break-even (costo acquisto) */}
            {costoBase > 0 && (
              <ReferenceLine y={costoBase}
                stroke="#2a2d35" strokeDasharray="4 3" strokeWidth={1}
              />
            )}

            {/* Linea portafoglio */}
            <Area type="monotone" dataKey="valore"
              stroke={lineColor} strokeWidth={1.5}
              fill="url(#chartGrad)" dot={false}
              activeDot={{ r: 4, fill: lineColor, stroke: "#0D0F14", strokeWidth: 2 }}
            />

            {/* S&P 500 scalato */}
            {showBenchmark && (
              <Line type="monotone" dataKey="spyScaled"
                stroke="#F4C542" strokeWidth={1}
                dot={false} strokeDasharray="4 2"
                activeDot={{ r: 3, fill: "#F4C542" }}
                connectNulls
              />
            )}

            {/* Marker acquisti */}
            {purchaseMarkers.map(m => (
              <ReferenceLine key={m.ticker + m.date} x={m.label}
                stroke="#7EB8F733" strokeWidth={1}
                label={{ value: m.ticker, position: "insideTopRight", fill: "#7EB8F7", fontSize: 8 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* ── Legenda ── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid #0f1117", marginTop: 6, alignItems: "center" }}>
        {showBenchmark && (() => {
          const spyLast  = [...chartData].reverse().find(p => p.spyScaled != null)?.spyScaled;
          const spyFirst = chartData.find(p => p.spyScaled != null)?.spyScaled;
          if (!spyLast || !spyFirst) return null;
          const spyPct = ((spyLast / spyFirst - 1) * 100).toFixed(2);
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
              <div style={{ width: 16, height: 1, borderTop: "1px dashed #F4C542" }} />
              <span style={{ color: "#F4C542" }}>S&P 500</span>
              <span style={{ color: spyPct >= 0 ? "#5EC98A" : "#E87040" }}>
                {spyPct >= 0 ? "+" : ""}{spyPct}%
              </span>
            </div>
          );
        })()}
        {purchaseMarkers.map(m => (
          <div key={m.ticker + m.date} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7EB8F7", flexShrink: 0 }} />
            <span style={{ color: "#7EB8F7" }}>{m.ticker}</span>
            {m.beforeRange && <span style={{ color: "#333" }}>(prima del periodo)</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
