import { useState, useMemo, useEffect, useRef } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import { useChart } from "../hooks/useChart";
import { parseBuyDate } from "../utils/dates";
import { fmt } from "../utils/format";

function Spinner({ color = "#5EC98A", size = 11 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />;
}

const PERIODS = ["1M", "3M", "6M", "1A", "Inizio"];

export function ChartCard({ stocks, eurRate, onPeriodReturns }) {
  const prevReturnsRef = useRef(null);
  const [period, setPeriod]           = useState("1A");
  const [showBenchmark, setShowBenchmark] = useState(false);

  const { chartData, loading, periodReturns } = useChart(stocks, eurRate, period);

  useEffect(() => {
    if (!periodReturns || !onPeriodReturns) return;
    const key = JSON.stringify(periodReturns);
    if (prevReturnsRef.current === key) return;
    prevReturnsRef.current = key;
    onPeriodReturns(periodReturns);
  }, [periodReturns]);

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

      {/* ── Controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              background: period === p ? "#E8EBF4" : "none",
              border: "none",
              color: period === p ? "#0A1628" : "#5A6A7E",
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
            color: showBenchmark ? "#F4C542" : "#5A6A7E",
            borderColor: showBenchmark ? "#F4C54244" : "#D8DCE8",
          }}>
            vs S&P 500
          </button>
        </div>
      </div>

      {/* ── Variazione periodo corrente ── */}
      {(() => {
        const varMap = { "1M": periodReturns?.day != null ? periodReturns?.month : null, "3M": periodReturns?.threeMonth, "1A": periodReturns?.year, "Inizio": lastPct, "6M": null };
        const v = period === "Inizio" ? lastPct : (period === "1M" ? periodReturns?.month : period === "3M" ? periodReturns?.threeMonth : period === "1A" ? periodReturns?.year : null);
        if (v == null) return null;
        const c = v >= 0 ? "#5EC98A" : "#E87040";
        return (
          <div style={{ fontSize: 11, color: c, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>{v >= 0 ? "+" : ""}{v.toFixed(2)}%</span>
            <span style={{ color: "#5A6A7E" }}>{period === "Inizio" ? "da inizio" : `ultimi ${period}`}</span>
          </div>
        );
      })()}

      {/* ── Grafico ── */}
      {loading ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#5A6A7E", fontSize: 11 }}>
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
              contentStyle={{ background: "#FFFFFF", border: "1px solid #1a1d26", borderRadius: 6, fontSize: 11, color: "#0A1628", padding: "6px 12px" }}
              formatter={(v, name) => {
                if (name === "pct")      return [`${v >= 0 ? "+" : ""}${v?.toFixed(2)}%`, "Portafoglio"];
                if (name === "spyPct")   return [`${v >= 0 ? "+" : ""}${v?.toFixed(2)}%`, "S&P 500"];
                return [v, name];
              }}
              labelStyle={{ color: "#5A6A7E", fontSize: 10, marginBottom: 3 }}
              cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: "4 2" }}
            />

            {/* Linea break-even a 0% */}
            <ReferenceLine y={0}
              stroke="#D8DCE8" strokeDasharray="4 3" strokeWidth={1}
            />

            {/* Linea portafoglio */}
            <Area type="monotone" dataKey="pct"
              stroke={lineColor} strokeWidth={1.5}
              fill="url(#chartGrad)" dot={false}
              activeDot={{ r: 4, fill: lineColor, stroke: "#F8F9FC", strokeWidth: 2 }}
            />

            {/* S&P 500 scalato */}
            {showBenchmark && (
              <Line type="monotone" dataKey="spyPct"
                stroke="#F4C542" strokeWidth={1}
                dot={false} strokeDasharray="4 2"
                activeDot={{ r: 3, fill: "#F4C542" }}
                connectNulls
              />
            )}

            {/* Marker acquisti */}
            {purchaseMarkers.map(m => (
              <ReferenceLine key={m.ticker + m.date} x={m.label}
                stroke="#7EB8F7" strokeWidth={1.5} strokeDasharray="3 3"
                label={{ value: `▼ ${m.ticker}`, position: "insideTopLeft", fill: "#7EB8F7", fontSize: 9, fontWeight: 600 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* ── Legenda ── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid #0f1117", marginTop: 6, alignItems: "center" }}>
        {showBenchmark && (() => {
          const spyLast  = [...chartData].reverse().find(p => p.spyPct != null)?.spyPct;
          if (spyLast == null) return null;
          const spyPct = spyLast.toFixed(2);
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
            {m.beforeRange && <span style={{ color: "#3A4A5E" }}>(prima del periodo)</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
