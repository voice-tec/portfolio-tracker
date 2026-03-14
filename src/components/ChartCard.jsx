import { useState, useMemo, useEffect } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { useChart, PERIODS } from "../hooks/useChart";
import { parseBuyDate } from "../utils/dates";

function Spinner({ color = "#5EC98A", size = 12 }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size,
      borderRadius: "50%", border: `1.5px solid ${color}`,
      borderTopColor: "transparent",
      animation: "spin 0.7s linear infinite", flexShrink: 0,
    }} />
  );
}

const col  = v => v == null ? "#8A9AB0" : v >= 0 ? "#5EC98A" : "#E87040";
const sign = v => (v != null && v >= 0) ? "+" : "";

export function ChartCard({ stocks, eurRate, onPillsReady }) {
  const [period, setPeriod]       = useState("1M");
  const [showBenchmark, setShowBenchmark] = useState(false);

  const { loading, buildPeriod } = useChart(stocks, eurRate);

  // Periodo corrente
  const { chartData, pill } = useMemo(
    () => buildPeriod(period),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, period]
  );

  // Tutte le pills
  const allPills = useMemo(() => {
    const r = {};
    PERIODS.forEach(p => { r[p] = buildPeriod(p).pill; });
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Notifica parent
  useEffect(() => {
    if (onPillsReady && Object.values(allPills).some(p => p != null)) {
      onPillsReady(allPills);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPills]);

  // Marker acquisti
  const purchaseMarkers = useMemo(() => {
    if (!chartData.length) return [];
    const firstDate = chartData[0].date;
    const seen = new Set();
    return stocks.flatMap(s => {
      const bd = parseBuyDate(s.buyDate);
      if (!bd) return [];
      const iso = bd.toISOString().slice(0, 10);
      const key = s.ticker + iso;
      if (seen.has(key)) return [];
      seen.add(key);
      const pt = iso >= firstDate
        ? chartData.find(p => p.date >= iso)
        : null;
      return pt ? [{ ...pt, ticker: s.ticker }] : [];
    });
  }, [chartData, stocks]);

  const lineColor = col(pill?.pct);

  return (
    <div className="card" style={{ marginBottom: 16, padding: "20px 20px 14px" }}>

      {/* ── Pills ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {PERIODS.map(p => {
          const v      = allPills[p]?.pct ?? null;
          const active = period === p;
          const c      = col(v);
          return (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: "5px 12px", borderRadius: 20, cursor: "pointer",
              fontFamily: "inherit", fontSize: 11, fontWeight: 600,
              transition: "all 0.15s", border: "none",
              background: active ? c + "18" : "rgba(0,0,0,0.04)",
              color: active ? c : "#8A9AB0",
              outline: active ? `1.5px solid ${c}33` : "none",
            }}>
              {p} {v != null ? `${sign(v)}${Math.abs(v).toFixed(2)}%` : "—"}
            </button>
          );
        })}

        <button onClick={() => setShowBenchmark(v => !v)} style={{
          marginLeft: "auto", fontSize: 9, padding: "4px 10px",
          borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
          border: "1px solid",
          background: showBenchmark ? "#F4C54211" : "none",
          color: showBenchmark ? "#F4C542" : "#8A9AB0",
          borderColor: showBenchmark ? "#F4C54244" : "#E0E4EF",
        }}>
          vs S&P 500
        </button>
      </div>

      {/* ── Grafico ── */}
      {loading ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#8A9AB0", fontSize: 11 }}>
          <Spinner color="#5EC98A" size={14} /> Caricamento…
        </div>
      ) : chartData.length < 2 ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#8A9AB0", fontSize: 12 }}>
          Dati insufficienti per questo periodo
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="cGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={lineColor} stopOpacity={0.18} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 11, color: "#0A1628", padding: "6px 12px" }}
              formatter={(v, name) => {
                if (name === "pct")    return [`${sign(v)}${v?.toFixed(2)}%`, "Portafoglio"];
                if (name === "spyPct") return [`${sign(v)}${v?.toFixed(2)}%`, "S&P 500"];
                return [v, name];
              }}
              labelStyle={{ color: "#8A9AB0", fontSize: 10, marginBottom: 3 }}
              cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: "4 2" }}
            />

            <ReferenceLine y={0} stroke="#E0E4EF" strokeDasharray="4 3" strokeWidth={1} />

            <Area type="monotone" dataKey="pct"
              stroke={lineColor} strokeWidth={1.5}
              fill="url(#cGrad)" dot={false}
              activeDot={{ r: 4, fill: lineColor, stroke: "#fff", strokeWidth: 2 }}
            />

            {showBenchmark && (
              <Line type="monotone" dataKey="spyPct"
                stroke="#F4C542" strokeWidth={1} dot={false}
                strokeDasharray="4 2" connectNulls
                activeDot={{ r: 3, fill: "#F4C542" }}
              />
            )}

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
      {!loading && chartData.length >= 2 && (showBenchmark || purchaseMarkers.length > 0) && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid #F0F2F7", marginTop: 6, alignItems: "center" }}>
          {showBenchmark && (() => {
            const sv = [...chartData].reverse().find(p => p.spyPct != null)?.spyPct;
            if (sv == null) return null;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
                <div style={{ width: 16, height: 1, borderTop: "1px dashed #F4C542" }} />
                <span style={{ color: "#F4C542" }}>S&P 500</span>
                <span style={{ color: col(sv) }}>{sign(sv)}{sv.toFixed(2)}%</span>
              </div>
            );
          })()}
          {purchaseMarkers.map(m => (
            <div key={m.ticker + m.date} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7EB8F7" }} />
              <span style={{ color: "#7EB8F7" }}>{m.ticker}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
