import { useState, useMemo } from "react";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, Tooltip } from "recharts";
import { API_BASE } from "../utils/api";

// ── Helpers ───────────────────────────────────────────────────────────────────
const scoreColor = s => s == null ? "#C0C8D8" : s >= 70 ? "#16A34A" : s >= 40 ? "#F4A020" : "#DC2626";

function ScoreBar({ value, color = "#4361ee" }) {
  if (value == null) return <span style={{ color: "#C0C8D8", fontSize: 11 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 56, height: 4, background: "#F0F2F7", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 10, color: "#8A9AB0", minWidth: 22 }}>{value}</span>
    </div>
  );
}

function Spinner({ size = 14, color = "#4361ee" }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />;
}

// ── Confronto radar tra 2 titoli ─────────────────────────────────────────────
function ComparePanel({ a, b, onClose }) {
  if (!a || !b) return null;
  const radarData = [
    { subject: "Value",    A: a.scores.value ?? 0,        B: b.scores.value ?? 0 },
    { subject: "Size",     A: a.scores.size ?? 0,         B: b.scores.size ?? 0 },
    { subject: "Profit.",  A: a.scores.profitability ?? 0, B: b.scores.profitability ?? 0 },
    { subject: "Momentum", A: a.scores.momentum ?? 0,     B: b.scores.momentum ?? 0 },
    { subject: "Score",    A: a.scores.composite ?? 0,    B: b.scores.composite ?? 0 },
  ];

  return (
    <div className="card" style={{ marginBottom: 16, padding: "18px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628" }}>
          Confronto: <span style={{ color: "#4361ee" }}>{a.symbol}</span> vs <span style={{ color: "#F97316" }}>{b.symbol}</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#8A9AB0" }}>×</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 1fr", gap: 20, alignItems: "center" }}>
        {/* Stats A */}
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#4361ee", marginBottom: 12 }}>{a.symbol}</div>
          {[
            { l: "Prezzo", v: `$${a.price}` },
            { l: "P/E", v: a.pe ?? "—" },
            { l: "P/B", v: a.pb ?? "—" },
            { l: "ROE", v: a.roe != null ? `${a.roe}%` : "—" },
            { l: "Cap (M)", v: `$${a.mktCapM}` },
            { l: "Settore", v: a.sector },
          ].map(({ l, v }) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #F8FAFF" }}>
              <span style={{ fontSize: 10, color: "#8A9AB0" }}>{l}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#0A1628" }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Radar */}
        <ResponsiveContainer width="100%" height={180}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#E8EBF4" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: "#8A9AB0" }} />
            <Radar dataKey="A" stroke="#4361ee" fill="#4361ee" fillOpacity={0.15} strokeWidth={1.5} />
            <Radar dataKey="B" stroke="#F97316" fill="#F97316" fillOpacity={0.15} strokeWidth={1.5} />
            <Tooltip contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 6 }} />
          </RadarChart>
        </ResponsiveContainer>

        {/* Stats B */}
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#F97316", marginBottom: 12, textAlign: "right" }}>{b.symbol}</div>
          {[
            { l: "Prezzo", v: `$${b.price}` },
            { l: "P/E", v: b.pe ?? "—" },
            { l: "P/B", v: b.pb ?? "—" },
            { l: "ROE", v: b.roe != null ? `${b.roe}%` : "—" },
            { l: "Cap (M)", v: `$${b.mktCapM}` },
            { l: "Settore", v: b.sector },
          ].map(({ l, v }) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #F8FAFF" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#0A1628", textAlign: "right", flex: 1 }}>{v}</span>
              <span style={{ fontSize: 10, color: "#8A9AB0", marginLeft: 8 }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Score comparison */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #F0F2F7" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {[
            { l: "Value", ak: "value", color: "#1E4FD8" },
            { l: "Size", ak: "size", color: "#7C3AED" },
            { l: "Profit.", ak: "profitability", color: "#16A34A" },
            { l: "Momentum", ak: "momentum", color: "#F4A020" },
            { l: "Score", ak: "composite", color: "#0A1628" },
          ].map(({ l, ak, color }) => {
            const va = a.scores[ak] ?? 0;
            const vb = b.scores[ak] ?? 0;
            const winner = va > vb ? "A" : va < vb ? "B" : null;
            return (
              <div key={l} style={{ textAlign: "center", background: "#F8FAFF", borderRadius: 8, padding: "8px 4px" }}>
                <div style={{ fontSize: 8, color: "#8A9AB0", marginBottom: 6 }}>{l}</div>
                <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: winner === "A" ? "#4361ee" : "#8A9AB0" }}>{va}</span>
                  <span style={{ fontSize: 9, color: "#C0C8D8" }}>vs</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: winner === "B" ? "#F97316" : "#8A9AB0" }}>{vb}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Export principale ─────────────────────────────────────────────────────────
export function ScreenerTabNew({ fmt, onAddTicker, portfolioTickers = [] }) {
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [loaded, setLoaded]         = useState(false);
  const [expanded, setExpanded]     = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [updating, setUpdating]     = useState(false);

  // Filtri
  const [exchange, setExchange] = useState("NASDAQ,NYSE");
  const [sortBy, setSortBy]     = useState("composite");
  const [sector, setSector]     = useState("Tutti");
  const [maxPE, setMaxPE]       = useState("");
  const [minROE, setMinROE]     = useState("");
  const [maxCap, setMaxCap]     = useState("");
  const [minCap, setMinCap]     = useState("");

  // Confronto
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [showCompare, setShowCompare] = useState(false);

  async function updateCache() {
    setUpdating(true);
    try {
      const res = await fetch(`${API_BASE}/api/screener-update`);
      const data = await res.json();
      if (data.success) {
        alert(`✅ Aggiornati ${data.saved} titoli S&P 500. Ricarica lo screener.`);
        await runScreener();
      } else {
        alert("❌ Errore aggiornamento: " + (data.error || "sconosciuto"));
      }
    } catch (e) {
      alert("❌ Errore: " + e.message);
    }
    setUpdating(false);
  }

  async function runScreener() {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${API_BASE}/api/screener?exchange=${exchange}&limit=80`);
      const data = await res.json();
      if (data.error && !data.results?.length) throw new Error(data.error);
      setResults(data.results || []);
      setLoaded(true);
      if (data.lastUpdate) setLastUpdate(data.lastUpdate);
      if (data.source === "cache" && !data.lastUpdate) setLastUpdate("cache");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Settori disponibili
  const sectors = useMemo(() => {
    const s = new Set(results.map(r => r.sector).filter(Boolean));
    return ["Tutti", ...Array.from(s).sort()];
  }, [results]);

  // Filtra e ordina
  const filtered = useMemo(() => {
    let r = [...results];
    if (sector !== "Tutti") r = r.filter(x => x.sector === sector);
    if (maxPE)  r = r.filter(x => x.pe != null && x.pe <= parseFloat(maxPE));
    if (minROE) r = r.filter(x => x.roe != null && x.roe >= parseFloat(minROE));
    if (minCap) r = r.filter(x => x.mktCapM != null && x.mktCapM >= parseFloat(minCap));
    if (maxCap) r = r.filter(x => x.mktCapM != null && x.mktCapM <= parseFloat(maxCap));
    r.sort((a, b) => {
      if (sortBy === "composite")  return (b.scores.composite ?? 0) - (a.scores.composite ?? 0);
      if (sortBy === "value")      return (b.scores.value ?? 0) - (a.scores.value ?? 0);
      if (sortBy === "size")       return (b.scores.size ?? 0) - (a.scores.size ?? 0);
      if (sortBy === "prof")       return (b.scores.profitability ?? 0) - (a.scores.profitability ?? 0);
      if (sortBy === "momentum")   return (b.scores.momentum ?? 0) - (a.scores.momentum ?? 0);
      if (sortBy === "pe")         return (a.pe ?? 999) - (b.pe ?? 999);
      if (sortBy === "roe")        return (b.roe ?? 0) - (a.roe ?? 0);
      return 0;
    });
    return r;
  }, [results, sector, maxPE, minROE, minCap, maxCap, sortBy]);

  const portfolioSet = new Set(portfolioTickers.map(t => t.toUpperCase()));

  const handleCompare = (r) => {
    if (!compareA || (compareA && compareB)) {
      setCompareA(r); setCompareB(null); setShowCompare(false);
    } else if (compareA.symbol !== r.symbol) {
      setCompareB(r); setShowCompare(true);
    }
  };

  const selectStyle = {
    background: "#F8FAFF", border: "1px solid #E0E8F4", borderRadius: 8,
    padding: "7px 12px", fontSize: 11, color: "#0A1628", cursor: "pointer",
    fontFamily: "inherit",
  };

  const inputStyle = {
    ...selectStyle, width: 80,
  };

  return (
    <div className="fade-up" style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 40px" }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.01em", marginBottom: 4 }}>
          🔬 Screener Fama-French
        </div>
        <div style={{ fontSize: 12, color: "#8A9AB0", lineHeight: 1.6 }}>
          Titoli filtrati per <strong>Value</strong>, <strong>Size</strong>, <strong>Profitability</strong> e <strong>Momentum</strong>.
          {portfolioSet.size > 0 && <span style={{ color: "#4361ee", marginLeft: 8 }}>● = già in portafoglio</span>}
        </div>
      </div>

      {/* Filtri */}
      <div className="card" style={{ marginBottom: 16, padding: "14px 18px" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Mercato</div>
            <select value={exchange} onChange={e => setExchange(e.target.value)} style={selectStyle}>
              <option value="NASDAQ,NYSE">NASDAQ + NYSE</option>
              <option value="NASDAQ">Solo NASDAQ</option>
              <option value="NYSE">Solo NYSE</option>
              <option value="EURONEXT">Euronext</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Settore</div>
            <select value={sector} onChange={e => setSector(e.target.value)} style={selectStyle}>
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ordina per</div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selectStyle}>
              <option value="composite">Score composito</option>
              <option value="value">Value</option>
              <option value="size">Size</option>
              <option value="prof">Profitability</option>
              <option value="momentum">Momentum</option>
              <option value="pe">P/E (basso)</option>
              <option value="roe">ROE (alto)</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Max P/E</div>
            <input type="number" placeholder="es. 20" value={maxPE} onChange={e => setMaxPE(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Min ROE %</div>
            <input type="number" placeholder="es. 15" value={minROE} onChange={e => setMinROE(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Cap min (M$)</div>
            <input type="number" placeholder="es. 500" value={minCap} onChange={e => setMinCap(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Cap max (M$)</div>
            <input type="number" placeholder="es. 5000" value={maxCap} onChange={e => setMaxCap(e.target.value)} style={inputStyle} />
          </div>
          <button onClick={runScreener} disabled={loading} style={{
            background: "#0A1628", border: "none", color: "#fff", borderRadius: 8,
            padding: "9px 22px", fontSize: 12, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            display: "flex", alignItems: "center", gap: 8,
            fontFamily: "inherit",
          }}>
            {loading ? <><Spinner color="#fff" size={12} /> Analisi…</> : "🔍 Analizza"}
          </button>
          {loaded && (maxPE || minROE || minCap || maxCap || sector !== "Tutti") && (
            <button onClick={() => { setMaxPE(""); setMinROE(""); setMinCap(""); setMaxCap(""); setSector("Tutti"); }}
              style={{ background: "none", border: "1px solid #E0E8F4", borderRadius: 8, padding: "9px 14px", fontSize: 11, color: "#8A9AB0", cursor: "pointer", fontFamily: "inherit" }}>
              Reset filtri
            </button>
          )}
          <button onClick={updateCache} disabled={updating} style={{
            background: "none", border: "1px solid #E0E8F4", borderRadius: 8,
            padding: "9px 14px", fontSize: 11, color: "#8A9AB0",
            cursor: updating ? "not-allowed" : "pointer", fontFamily: "inherit",
            opacity: updating ? 0.6 : 1,
          }}>
            {updating ? "⏳ Aggiornando..." : "🔄 Aggiorna S&P 500"}
          </button>
          {lastUpdate && (
            <span style={{ fontSize: 10, color: "#C0C8D8", alignSelf: "center" }}>
              Aggiornato: {lastUpdate}
            </span>
          )}
        </div>
      </div>

      {/* Confronto panel */}
      {showCompare && compareA && compareB && (
        <ComparePanel a={compareA} b={compareB} onClose={() => { setShowCompare(false); setCompareA(null); setCompareB(null); }} />
      )}

      {/* Bar confronto in corso */}
      {compareA && !showCompare && (
        <div style={{ padding: "10px 16px", background: "#EEF4FF", borderRadius: 10, marginBottom: 12, fontSize: 11, color: "#4361ee", display: "flex", alignItems: "center", gap: 8 }}>
          <span>Confronto: <strong>{compareA.symbol}</strong> selezionato — clicca ⚖️ su un altro titolo</span>
          <button onClick={() => setCompareA(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8A9AB0", fontSize: 14, padding: 0 }}>×</button>
        </div>
      )}

      {error && (
        <div style={{ color: "#DC2626", fontSize: 12, marginBottom: 16, padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, border: "1px solid #FECACA" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Info fattori pre-analisi */}
      {!loaded && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 28 }}>
          {[
            { icon: "💰", label: "Value", color: "#1E4FD8", desc: "P/E e P/B bassi. Aziende sottovalutate dal mercato." },
            { icon: "📐", label: "Size", color: "#7C3AED", desc: "Small/mid cap (100M–10B). Più spazio di crescita." },
            { icon: "📈", label: "Profitability", color: "#16A34A", desc: "Alto ROE e ROA. Aziende realmente redditizie." },
            { icon: "🚀", label: "Momentum", color: "#F4A020", desc: "Trend positivo 12 mesi. Il momentum tende a persistere." },
          ].map(f => (
            <div key={f.label} style={{ background: "#fff", border: `1px solid ${f.color}22`, borderRadius: 10, padding: "16px 14px" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{f.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>{f.label}</div>
              <div style={{ fontSize: 11, color: "#8A9AB0", lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      )}

      {/* Risultati */}
      {filtered.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "#8A9AB0", marginBottom: 12 }}>
            {filtered.length} titoli {results.length !== filtered.length ? `(filtrati da ${results.length})` : ""} · score Fama-French
          </div>

          {/* Header colonne */}
          <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 80px 56px 64px 64px 64px 64px 64px 80px", gap: 8, padding: "6px 14px", fontSize: 8, color: "#C0C8D8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <span>#</span><span>Titolo</span><span>Prezzo</span><span>1D</span>
            <span>Value</span><span>Size</span><span>Profit.</span><span>Momentum</span>
            <span></span><span>Score</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map((r, idx) => {
              const inPortfolio = portfolioSet.has(r.symbol.toUpperCase());
              const isCompareA  = compareA?.symbol === r.symbol;
              return (
                <div key={r.symbol} style={{
                  background: inPortfolio ? "#F0F8FF" : "#fff",
                  border: `1px solid ${isCompareA ? "#4361ee" : inPortfolio ? "#BFDBFE" : "#E2E8F4"}`,
                  borderRadius: 10, overflow: "hidden",
                  boxShadow: "0 1px 3px rgba(10,22,40,0.04)",
                  cursor: "pointer",
                }}>
                  {/* Row principale */}
                  <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 80px 56px 64px 64px 64px 64px 64px 80px", alignItems: "center", padding: "10px 14px", gap: 8 }}
                    onClick={() => setExpanded(expanded === r.symbol ? null : r.symbol)}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#C0C8D8" }}>#{idx+1}</div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#0A1628" }}>{r.symbol}</span>
                        {inPortfolio && <span style={{ fontSize: 8, background: "#DBEAFE", color: "#1D4ED8", padding: "1px 6px", borderRadius: 8, fontWeight: 700 }}>IN PORTAFOGLIO</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "#8A9AB0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{r.name}</div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628" }}>${fmt(r.price)}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: parseFloat(r.change1d) >= 0 ? "#16A34A" : "#DC2626" }}>
                      {parseFloat(r.change1d) >= 0 ? "+" : ""}{r.change1d}%
                    </div>
                    <ScoreBar value={r.scores.value}        color="#1E4FD8" />
                    <ScoreBar value={r.scores.size}         color="#7C3AED" />
                    <ScoreBar value={r.scores.profitability} color="#16A34A" />
                    <ScoreBar value={r.scores.momentum}     color="#F4A020" />
                    {/* Pulsante confronto */}
                    <button onClick={e => { e.stopPropagation(); handleCompare(r); }} style={{
                      background: isCompareA ? "#EEF4FF" : "none",
                      border: `1px solid ${isCompareA ? "#4361ee" : "#E0E8F4"}`,
                      borderRadius: 6, padding: "3px 8px", fontSize: 10,
                      color: isCompareA ? "#4361ee" : "#8A9AB0",
                      cursor: "pointer", fontFamily: "inherit",
                    }}>⚖️</button>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 42, height: 42, borderRadius: "50%",
                      background: `${scoreColor(r.scores.composite)}15`,
                      border: `2px solid ${scoreColor(r.scores.composite)}`,
                      fontWeight: 800, fontSize: 14, color: scoreColor(r.scores.composite),
                    }}>
                      {r.scores.composite}
                    </div>
                  </div>

                  {/* Dettaglio espanso */}
                  {expanded === r.symbol && (
                    <div style={{ borderTop: "1px solid #F0F2F7", padding: "14px 16px", background: "#F8FAFF" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 14 }}>
                        {[
                          { l: "P/E",     v: r.pe   ?? "—" },
                          { l: "P/B",     v: r.pb   ?? "—" },
                          { l: "ROE",     v: r.roe  != null ? `${r.roe}%` : "—" },
                          { l: "ROA",     v: r.roa  != null ? `${r.roa}%` : "—" },
                          { l: "Cap (M)", v: `$${r.mktCapM}` },
                          { l: "Settore", v: r.sector },
                        ].map(({ l, v }) => (
                          <div key={l} style={{ background: "#fff", borderRadius: 8, padding: "8px 10px", border: "1px solid #E8EEF8" }}>
                            <div style={{ fontSize: 8, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{l}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={e => { e.stopPropagation(); onAddTicker && onAddTicker(r.symbol); }}
                          style={{ background: "#0A1628", border: "none", color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          + Aggiungi al portafoglio
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleCompare(r); }}
                          style={{ background: "none", border: "1px solid #4361ee", color: "#4361ee", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                          ⚖️ Confronta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 9, color: "#C0C8D8", marginTop: 14, lineHeight: 1.8 }}>
            📊 Dati via Financial Modeling Prep. Score calcolati internamente (Fama-French 1992, 1993). Non costituisce consulenza finanziaria.
          </div>
        </div>
      )}
    </div>
  );
}
