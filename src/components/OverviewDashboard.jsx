import { useState, useEffect, useMemo } from "react";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";
import { fetchHistory, fetchAnalyst, API_BASE } from "../utils/api";
import { parseBuyDate } from "../utils/dates";
import { toUSD } from "../utils/currency";

// ── Helpers ──────────────────────────────────────────────────────────────────
const col  = v => v == null ? "#8A9AB0" : v >= 0 ? "#16A34A" : "#DC2626";
const sign = v => v != null && v >= 0 ? "+" : "";
const fmtPct = v => v != null ? `${sign(v)}${Math.abs(v).toFixed(2)}%` : "—";

function MiniTag({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, background: color + "12", border: `1px solid ${color}30` }}>
      <span style={{ fontSize: 10, color: "#8A9AB0" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

// ── 1. RADAR DEL PORTAFOGLIO ─────────────────────────────────────────────────
function PortfolioRadar({ stocks, eurRate }) {
  const [analystData, setAnalystData] = useState({});

  useEffect(() => {
    if (!stocks.length) return;
    Promise.all(
      stocks.map(s =>
        fetchAnalyst(s.ticker)
          .then(d => ({ ticker: s.ticker, data: d }))
          .catch(() => ({ ticker: s.ticker, data: null }))
      )
    ).then(results => {
      const map = {};
      results.forEach(({ ticker, data }) => { map[ticker] = data; });
      setAnalystData(map);
    });
  }, [stocks.map(s => s.ticker).join(",")]);

  const radarData = useMemo(() => {
    if (!stocks.length) return [];
    const totalValue = stocks.reduce((s, x) => s + (parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0), 0);
    if (!totalValue) return [];

    // Diversificazione: numero settori / numero titoli (max 100)
    const sectors = new Set(stocks.map(s => s.sector || "Altro"));
    const diversification = Math.min(100, (sectors.size / Math.max(stocks.length, 1)) * 100 + (stocks.length >= 5 ? 30 : 0));

    // Qualità: media analyst score (targetPrice vs currentPrice)
    let qualitySum = 0, qualityCount = 0;
    stocks.forEach(s => {
      const d = analystData[s.ticker];
      if (d?.targetPrice && s.currentPrice) {
        const upside = (d.targetPrice - s.currentPrice) / s.currentPrice * 100;
        qualitySum += Math.min(100, Math.max(0, 50 + upside));
        qualityCount++;
      }
    });
    const quality = qualityCount > 0 ? qualitySum / qualityCount : 50;

    // Momentum: % titoli in positivo dall'acquisto
    const posCount = stocks.filter(s => {
      const pct = s.buyPrice > 0 ? (s.currentPrice - s.buyPrice) / s.buyPrice : 0;
      return pct > 0;
    }).length;
    const momentum = (posCount / stocks.length) * 100;

    // Valore: P&L medio pesato (normalizzato)
    const totalPnL = stocks.reduce((s, x) => {
      const val = (parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0);
      const pct = x.buyPrice > 0 ? (x.currentPrice - x.buyPrice) / x.buyPrice * 100 : 0;
      return s + pct * (val / totalValue);
    }, 0);
    const valore = Math.min(100, Math.max(0, 50 + totalPnL * 2));

    // Difensività: % settori difensivi (Salute, Utility, Consumer Staples)
    const defensiveSectors = ["Salute", "Utility", "Consumer"];
    const defensiveValue = stocks.reduce((s, x) => {
      if (defensiveSectors.some(d => (x.sector||"").includes(d))) {
        return s + (parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0);
      }
      return s;
    }, 0);
    const defensiveness = Math.min(100, (defensiveValue / totalValue) * 200);

    // Crescita: % settori growth (Tech, Consumer Discretionary)
    const growthSectors = ["Tech", "Tecnologia", "Consumer Disc"];
    const growthValue = stocks.reduce((s, x) => {
      if (growthSectors.some(g => (x.sector||"").includes(g))) {
        return s + (parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0);
      }
      return s;
    }, 0);
    const growth = Math.min(100, (growthValue / totalValue) * 150);

    return [
      { subject: "Diversif.", value: Math.round(diversification), fullMark: 100 },
      { subject: "Qualità",   value: Math.round(quality),         fullMark: 100 },
      { subject: "Momentum",  value: Math.round(momentum),        fullMark: 100 },
      { subject: "Valore",    value: Math.round(valore),          fullMark: 100 },
      { subject: "Difensiv.", value: Math.round(defensiveness),   fullMark: 100 },
      { subject: "Crescita",  value: Math.round(growth),          fullMark: 100 },
    ];
  }, [stocks, analystData, eurRate]);

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
        Radar Portafoglio
      </div>
      {radarData.length > 0 ? (
        <ResponsiveContainer width="100%" height={200}>
          <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
            <PolarGrid stroke="#E8EBF4" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "#8A9AB0" }} />
            <Radar dataKey="value" stroke="#4361ee" fill="#4361ee" fillOpacity={0.15} strokeWidth={1.5}
              dot={{ fill: "#4361ee", r: 3 }} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 11, padding: "6px 12px" }}
              formatter={v => [`${v}/100`, "Score"]}
            />
          </RadarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#8A9AB0", fontSize: 12 }}>
          Aggiungi titoli per vedere il radar
        </div>
      )}
    </div>
  );
}

// ── 2. PULSE DEL MERCATO ─────────────────────────────────────────────────────
function MarketPulse() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch VIX, DXY, Gold, Treasury 10Y tramite Yahoo
    Promise.all([
      fetch(`${API_BASE}/api/price?symbol=^VIX`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/price?symbol=DX-Y.NYB`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/price?symbol=GC=F`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/price?symbol=^TNX`).then(r => r.json()).catch(() => null),
    ]).then(([vix, dxy, gold, tnx]) => {
      setData({ vix, dxy, gold, tnx });
      setLoading(false);
    });
  }, []);

  const indicators = data ? [
    {
      label: "VIX", sublabel: "Indice paura",
      value: data.vix?.price ? data.vix.price.toFixed(1) : "—",
      change: data.vix?.changePct,
      color: data.vix?.price > 25 ? "#DC2626" : data.vix?.price > 18 ? "#F4A020" : "#16A34A",
      icon: "😰",
    },
    {
      label: "DXY", sublabel: "Dollaro USA",
      value: data.dxy?.price ? data.dxy.price.toFixed(1) : "—",
      change: data.dxy?.changePct,
      color: "#4361ee",
      icon: "💵",
    },
    {
      label: "Oro", sublabel: "Gold Futures",
      value: data.gold?.price ? `$${Math.round(data.gold.price)}` : "—",
      change: data.gold?.changePct,
      color: "#F4C542",
      icon: "🥇",
    },
    {
      label: "Treasury 10Y", sublabel: "Rendimento",
      value: data.tnx?.price ? `${data.tnx.price.toFixed(2)}%` : "—",
      change: data.tnx?.changePct,
      color: "#8A9AB0",
      icon: "🏦",
    },
  ] : [];

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
        Pulse del Mercato
      </div>
      {loading ? (
        <div style={{ fontSize: 11, color: "#8A9AB0" }}>Caricamento…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {indicators.map(ind => (
            <div key={ind.label} style={{
              background: "#F8FAFF", borderRadius: 10, padding: "12px 14px",
              borderLeft: `3px solid ${ind.color}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 4 }}>{ind.icon} {ind.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.01em" }}>{ind.value}</div>
                  <div style={{ fontSize: 9, color: "#8A9AB0", marginTop: 2 }}>{ind.sublabel}</div>
                </div>
                {ind.change != null && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: col(ind.change) }}>
                    {fmtPct(ind.change)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 3. PROSSIMI EVENTI ───────────────────────────────────────────────────────
function UpcomingEvents({ stocks }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!stocks.length) { setLoading(false); return; }
    Promise.all(
      stocks.map(s =>
        fetch(`${API_BASE}/api/dividends?symbol=${s.ticker}`)
          .then(r => r.json())
          .then(d => ({ ticker: s.ticker, div: d }))
          .catch(() => ({ ticker: s.ticker, div: null }))
      )
    ).then(results => {
      const evs = [];
      results.forEach(({ ticker, div }) => {
        if (div?.nextDividendDate) {
          evs.push({
            ticker,
            type: "dividendo",
            date: div.nextDividendDate,
            value: div.dividendAmount ? `$${div.dividendAmount.toFixed(3)}` : null,
            color: "#16A34A",
            icon: "💰",
          });
        }
        if (div?.earningsDate) {
          evs.push({
            ticker,
            type: "earnings",
            date: div.earningsDate,
            value: null,
            color: "#4361ee",
            icon: "📊",
          });
        }
      });
      // Ordina per data
      evs.sort((a, b) => new Date(a.date) - new Date(b.date));
      setEvents(evs.slice(0, 6));
      setLoading(false);
    });
  }, [stocks.map(s => s.ticker).join(",")]);

  const fmtDate = d => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  };

  const daysTo = d => {
    if (!d) return null;
    const diff = Math.round((new Date(d) - new Date()) / 86400000);
    return diff;
  };

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
        Prossimi Eventi
      </div>
      {loading ? (
        <div style={{ fontSize: 11, color: "#8A9AB0" }}>Caricamento…</div>
      ) : events.length === 0 ? (
        <div style={{ fontSize: 11, color: "#8A9AB0" }}>Nessun evento imminente</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map((ev, i) => {
            const days = daysTo(ev.date);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: ev.color + "12", border: `1px solid ${ev.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                  {ev.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628" }}>
                    {ev.ticker} <span style={{ fontWeight: 400, color: "#8A9AB0" }}>— {ev.type}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#8A9AB0" }}>{fmtDate(ev.date)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {ev.value && <div style={{ fontSize: 11, fontWeight: 700, color: ev.color }}>{ev.value}</div>}
                  {days != null && days >= 0 && (
                    <div style={{ fontSize: 9, color: days <= 7 ? "#DC2626" : "#8A9AB0" }}>
                      {days === 0 ? "oggi" : `tra ${days}gg`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 4. SCENARI COMPATTI ──────────────────────────────────────────────────────
const SCENARIOS_COMPACT = [
  { id: "recession",     label: "Recessione",      icon: "📊", color: "#DC2626", spx: -30, impact: { "Tech": -0.20, "Finanza": -0.30, "Energia": -0.25, "Salute": +0.05, "Altro": -0.15 } },
  { id: "high_rates",    label: "Tassi Alti",       icon: "🏦", color: "#BF6EEA", spx: -15, impact: { "Tech": -0.30, "Finanza": +0.15, "Energia": +0.05, "Salute": +0.05, "Altro": -0.10 } },
  { id: "high_inflation",label: "Alta Inflazione",  icon: "📈", color: "#F4A020", spx: -12, impact: { "Tech": -0.25, "Finanza": +0.08, "Energia": +0.45, "Salute": -0.05, "Altro": -0.05 } },
  { id: "boom",          label: "Boom Economico",   icon: "🚀", color: "#16A34A", spx: +28, impact: { "Tech": +0.30, "Finanza": +0.20, "Energia": +0.25, "Salute": +0.08, "Altro": +0.15 } },
  { id: "low_rates",     label: "Tassi Bassi",      icon: "💸", color: "#4361ee", spx: +25, impact: { "Tech": +0.35, "Finanza": -0.05, "Energia": +0.10, "Salute": +0.10, "Altro": +0.10 } },
  { id: "low_inflation", label: "Bassa Inflazione", icon: "📉", color: "#26C6DA", spx: +18, impact: { "Tech": +0.25, "Finanza": +0.05, "Energia": -0.10, "Salute": +0.12, "Altro": +0.08 } },
];

function ScenarioCompact({ stocks, totalValue, fmt, sym, onNavigate }) {
  const calcImpact = (sc) => {
    if (!stocks.length || !totalValue) return null;
    let sum = 0, weight = 0;
    stocks.forEach(s => {
      const val = (parseFloat(s.qty)||0) * (parseFloat(s.currentPrice)||0);
      const sector = s.sector || "Altro";
      const imp = sc.impact[sector] ?? sc.impact["Altro"] ?? 0;
      sum += imp * val;
      weight += val;
    });
    return weight > 0 ? (sum / weight) * 100 : 0;
  };

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Scenari Macro
        </div>
        {onNavigate && (
          <button onClick={onNavigate} style={{ fontSize: 10, color: "#4361ee", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            Dettagli →
          </button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {SCENARIOS_COMPACT.map(sc => {
          const imp = calcImpact(sc);
          const c = imp != null ? col(imp) : col(sc.spx);
          return (
            <div key={sc.id} style={{
              background: "#F8FAFF", borderRadius: 10, padding: "10px 12px",
              borderTop: `3px solid ${sc.color}`,
            }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>{sc.icon}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#0A1628", marginBottom: 6, lineHeight: 1.3 }}>{sc.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: c }}>
                {imp != null ? fmtPct(imp) : fmtPct(sc.spx)}
              </div>
              <div style={{ fontSize: 8, color: "#8A9AB0", marginTop: 2 }}>portafoglio</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 5. SCREENER INTEGRATO ────────────────────────────────────────────────────
function ScreenerWidget({ fmt, onAddTicker }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/screener?exchange=NASDAQ,NYSE&limit=20`);
      const data = await res.json();
      setResults((data.results || []).slice(0, 5));
      setLoaded(true);
    } catch {}
    setLoading(false);
  }

  const scoreColor = s => s >= 70 ? "#16A34A" : s >= 40 ? "#F4A020" : "#DC2626";

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          🔬 Top Opportunità
        </div>
        <button onClick={run} disabled={loading} style={{
          fontSize: 10, color: "#fff", background: "#4361ee",
          border: "none", borderRadius: 6, padding: "4px 12px",
          cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600,
          opacity: loading ? 0.7 : 1,
        }}>
          {loading ? "…" : loaded ? "Aggiorna" : "Analizza"}
        </button>
      </div>

      {!loaded && !loading && (
        <div style={{ fontSize: 11, color: "#8A9AB0", textAlign: "center", padding: "20px 0" }}>
          Clicca Analizza per vedere i top titoli Fama-French
        </div>
      )}

      {loaded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map((r, i) => (
            <div key={r.symbol} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 10, color: "#C0C8D8", fontWeight: 700, width: 16 }}>#{i+1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628" }}>{r.symbol}</div>
                <div style={{ fontSize: 9, color: "#8A9AB0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{r.name}</div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#0A1628" }}>${fmt(r.price)}</div>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                background: scoreColor(r.scores?.composite) + "18",
                border: `2px solid ${scoreColor(r.scores?.composite)}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 800, color: scoreColor(r.scores?.composite),
              }}>
                {r.scores?.composite}
              </div>
              {onAddTicker && (
                <button onClick={() => onAddTicker(r.symbol)} style={{
                  fontSize: 11, color: "#4361ee", background: "none",
                  border: "1px solid #4361ee33", borderRadius: 6, padding: "3px 8px",
                  cursor: "pointer", fontFamily: "inherit",
                }}>+</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── EXPORT PRINCIPALE ────────────────────────────────────────────────────────
export function OverviewDashboard({ stocks, eurRate, totalValue, fmt, sym, onNavigateSimulazioni, onAddTicker }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>

      {/* Colonna sinistra */}
      <div>
        <PortfolioRadar stocks={stocks} eurRate={eurRate} />
        <MarketPulse />
        <UpcomingEvents stocks={stocks} />
      </div>

      {/* Colonna destra */}
      <div>
        <ScenarioCompact stocks={stocks} totalValue={totalValue} fmt={fmt} sym={sym} onNavigate={onNavigateSimulazioni} />
        <ScreenerWidget fmt={fmt} onAddTicker={onAddTicker} />
      </div>

    </div>
  );
}
