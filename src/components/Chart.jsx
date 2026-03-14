import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 14, height: 14,
      borderRadius: "50%", border: "1.5px solid #5EC98A",
      borderTopColor: "transparent",
      animation: "spin 0.7s linear infinite",
    }} />
  );
}

export default function Chart({ data, loading, lineColor = "#5EC98A", showSpy = false }) {
  if (loading) {
    return (
      <div className="chart-empty">
        <Spinner /> Caricamento…
      </div>
    );
  }

  if (!data || data.length < 2) {
    return (
      <div className="chart-empty">
        Dati insufficienti per questo periodo
      </div>
    );
  }

  const color = (data[data.length - 1]?.pct ?? 0) >= 0 ? "#5EC98A" : "#E87040";

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        <XAxis dataKey="label" hide />
        <YAxis hide domain={["auto", "auto"]} />

        <Tooltip
          contentStyle={{
            background: "#fff", border: "1px solid #E8EBF4",
            borderRadius: 8, fontSize: 11, color: "#0A1628", padding: "6px 12px",
          }}
          formatter={(v, name) => {
            const s = v >= 0 ? "+" : "";
            if (name === "pct")    return [`${s}${v?.toFixed(2)}%`, "Portafoglio"];
            if (name === "spyPct") return [`${s}${v?.toFixed(2)}%`, "S&P 500"];
            return [v, name];
          }}
          labelStyle={{ color: "#8A9AB0", fontSize: 10, marginBottom: 3 }}
          cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "4 2" }}
        />

        <ReferenceLine y={0} stroke="#E0E4EF" strokeDasharray="4 3" strokeWidth={1} />

        <Area
          type="monotone" dataKey="pct"
          stroke={color} strokeWidth={1.5}
          fill="url(#chartGrad)" dot={false}
          activeDot={{ r: 4, fill: color, stroke: "#fff", strokeWidth: 2 }}
        />

        {showSpy && (
          <Line
            type="monotone" dataKey="spyPct"
            stroke="#F4C542" strokeWidth={1} dot={false}
            strokeDasharray="4 2" connectNulls
            activeDot={{ r: 3, fill: "#F4C542" }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
