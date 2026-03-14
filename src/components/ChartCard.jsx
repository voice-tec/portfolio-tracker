import { useState } from "react";
import { PERIODS, useChart } from "../hooks/useChart";
import Chart from "./Chart";

export default function ChartCard({ stocks, eurRate }) {
  const [period, setPeriod] = useState("1M");

  const { buildPeriod, loading } = useChart(stocks, eurRate);

  const { chartData, pill } = buildPeriod(period);

  // Calcola tutte le pill per mostrarle sui bottoni
  const allPills = {};
  PERIODS.forEach(p => {
    allPills[p] = buildPeriod(p).pill;
  });

  const isPos = (pill?.pct ?? 0) >= 0;

  return (
    <div className="chart-card">

      <div className="chart-header">
        <div className="chart-performance">
          {pill?.pct != null && (
            <span className={isPos ? "pos" : "neg"}>
              {pill.pct > 0 ? "+" : ""}{pill.pct}%
            </span>
          )}
        </div>

        <div className="chart-periods">
          {PERIODS.map(p => {
            const v = allPills[p]?.pct;
            const c = v == null ? "" : v >= 0 ? "pos" : "neg";
            return (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`period-btn ${period === p ? "active" : ""} ${period === p ? c : ""}`}
              >
                {p}
                {v != null && (
                  <span className={`period-pct ${c}`}>
                    {v > 0 ? "+" : ""}{v.toFixed(2)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="chart-body">
        <Chart data={chartData} loading={loading} />
      </div>

    </div>
  );
}
