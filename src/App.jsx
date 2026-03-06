import { useState, useEffect, useRef, useCallback } from "react";
import { PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";

const SECTOR_COLORS = ["#F4C542","#E87040","#5B8DEF","#5EC98A","#BF6EEA","#F06292","#26C6DA","#FF7043"];

function getSector(ticker) {
  return "Altro";
}

function useTickerSearch(query) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const cacheRef = useRef({});

  const search = useCallback(async (q) => {
    if (!q || q.length < 1) { setResults([]); return; }
    const key = q.toUpperCase();
    if (cacheRef.current[key]) { setResults(cacheRef.current[key]); return; }
    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          system: `You are a stock ticker database. When given a search query, respond ONLY with a raw JSON array (no markdown, no backticks, no explanation) of up to 6 matching stocks. Each object: {"ticker":"...","name":"...","exchange":"...","sector":"..."}. Use your training knowledge only — no search needed. Cover all world exchanges.`,
          messages: [{ role: "user", content: q }]
        })
      });
      const data = await res.json();
      const text = (data.content || []).map(b => b.text || "").join("");
      const match = text.match(/\[[\s\S]*?\]/);
      const parsed = match ? JSON.parse(match[0]) : [];
      cacheRef.current[key] = parsed;
      setResults(parsed);
    } catch (e) {
      setResults([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query || query.length < 1) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  return { results, loading };
}

function TickerAutocomplete({ value, onChange, onSelect }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef(null);
  const { results, loading } = useTickerSearch(open ? value : "");

  useEffect(() => { setHighlighted(0); }, [results]);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKey(e) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    if (e.key === "Enter" && results[highlighted]) { e.preventDefault(); onSelect(results[highlighted]); setOpen(false); }
    if (e.key === "Escape") setOpen(false);
  }

  const showDropdown = open && value.length > 0 && (loading || results.length > 0);

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.12em", textTransform: "uppercase" }}>Ticker</div>
      <input
        placeholder="es. PLAB, ENI, AAPL…"
        value={value}
        autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
      />
      {showDropdown && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 999,
          background: "#13151c", border: "1px solid #2a2d35", borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden", minWidth: 300
        }}>
          {loading && results.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: "1.5px solid #F4C542", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
              Ricerca in corso…
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : results.map((t, i) => (
            <div
              key={t.ticker + i}
              onMouseDown={() => { onSelect(t); setOpen(false); }}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
                cursor: "pointer", background: i === highlighted ? "#1a1d26" : "transparent",
                borderBottom: i < results.length - 1 ? "1px solid #161820" : "none",
                transition: "background 0.1s"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#E8E6DF", minWidth: 48 }}>{t.ticker}</span>
                <span style={{ fontSize: 11, color: "#555" }}>{t.name}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {t.exchange && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: "#0D0F14", color: "#444", letterSpacing: "0.08em", textTransform: "uppercase" }}>{t.exchange}</span>}
                {t.sector && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: "#0D0F14", color: "#666", letterSpacing: "0.08em", textTransform: "uppercase" }}>{t.sector}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchRealPrice(ticker) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 60,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: `You are a stock price lookup tool. Search for the current stock price of the given ticker and respond ONLY with a single number (the price in USD or local currency). No text, no symbol, no explanation. Just the number, e.g.: 189.42`,
        messages: [{ role: "user", content: `Current stock price of ${ticker}` }]
      })
    });
    const data = await res.json();
    const text = (data.content || []).map(b => b.text || "").join("").trim();
    const num = parseFloat(text.replace(/[^0-9.]/g, ""));
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

// Simulate realistic price fluctuation
function simulateHistory(buyPrice, days = 30) {
  let price = buyPrice * (0.85 + Math.random() * 0.1);
  const history = [];
  for (let i = days; i >= 0; i--) {
    price = price * (1 + (Math.random() - 0.48) * 0.025);
    const d = new Date();
    d.setDate(d.getDate() - i);
    history.push({ date: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }), price: parseFloat(price.toFixed(2)) });
  }
  return history;
}

function simulateCurrentPrice(buyPrice) {
  const change = (Math.random() - 0.45) * 0.4;
  return parseFloat((buyPrice * (1 + change)).toFixed(2));
}

const initialStocks = [
  { id: 1, ticker: "AAPL", qty: 10, buyPrice: 175.0 },
  { id: 2, ticker: "MSFT", qty: 5, buyPrice: 380.0 },
  { id: 3, ticker: "NVDA", qty: 8, buyPrice: 495.0 },
];

export default function App() {
  const [stocks, setStocks] = useState(() =>
    initialStocks.map(s => ({
      ...s,
      currentPrice: simulateCurrentPrice(s.buyPrice),
      history: simulateHistory(s.buyPrice),
      sector: getSector(s.ticker)
    }))
  );
  const [form, setForm] = useState({ ticker: "", qty: "", buyPrice: "", sector: "Altro" });
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedStock, setSelectedStock] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const nextId = useRef(100);

  const totalInvested = stocks.reduce((s, x) => s + x.qty * x.buyPrice, 0);
  const totalValue = stocks.reduce((s, x) => s + x.qty * x.currentPrice, 0);
  const totalPnL = totalValue - totalInvested;
  const totalPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  // Sector aggregation
  const sectorData = Object.entries(
    stocks.reduce((acc, s) => {
      const sec = s.sector;
      acc[sec] = (acc[sec] || 0) + s.qty * s.currentPrice;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));

  // Portfolio history (sum of all stocks)
  const portfolioHistory = stocks[0]?.history.map((_, i) => ({
    date: stocks[0].history[i].date,
    valore: parseFloat(stocks.reduce((s, st) => s + st.qty * (st.history[i]?.price || st.currentPrice), 0).toFixed(2))
  })) || [];

  const [notes, setNotes] = useState({});
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);

  useEffect(() => {
    async function refreshPrices() {
      const updated = await Promise.all(
        stocks.map(async s => {
          const real = await fetchRealPrice(s.ticker);
          if (!real) return s;
          const history = simulateHistory(real);
          history[history.length - 1].price = real;
          return { ...s, currentPrice: real, history, priceReal: true };
        })
      );
      setStocks(updated);
    }
    refreshPrices();
  }, []);

  async function handleAdd() {
    const t = form.ticker.trim().toUpperCase();
    const q = parseFloat(form.qty);
    const p = parseFloat(form.buyPrice);
    if (!t) return setError("Inserisci un ticker valido.");
    if (!q || q <= 0) return setError("Quantità non valida.");
    if (!p || p <= 0) return setError("Prezzo acquisto non valido.");
    setError("");
    setAdding(true);
    const realPrice = await fetchRealPrice(t);
    const curPrice = realPrice || simulateCurrentPrice(p);
    const history = simulateHistory(realPrice || p);
    // Make last history point match real price
    if (realPrice && history.length > 0) history[history.length - 1].price = realPrice;
    const newStock = {
      id: nextId.current++,
      ticker: t,
      qty: q,
      buyPrice: p,
      currentPrice: curPrice,
      history,
      sector: form.sector || getSector(t),
      priceReal: !!realPrice
    };
    setStocks(prev => [...prev, newStock]);
    setForm({ ticker: "", qty: "", buyPrice: "", sector: "Altro" });
    setAdding(false);
    setShowForm(false);
  }

  function handleRemove(id) {
    setStocks(prev => prev.filter(s => s.id !== id));
    if (selectedStock?.id === id) setSelectedStock(null);
  }

  const displayStock = selectedStock || stocks[0];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0D0F14",
      color: "#E8E6DF",
      fontFamily: "'DM Mono', 'Courier New', monospace",
      padding: "0"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600;1,9..144,300&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } 
        ::-webkit-scrollbar-track { background: #0D0F14; }
        ::-webkit-scrollbar-thumb { background: #2a2d35; border-radius: 2px; }
        .tab-btn { background: none; border: none; cursor: pointer; font-family: inherit; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; padding: 8px 18px; color: #555; transition: color 0.2s; }
        .tab-btn:hover { color: #aaa; }
        .tab-btn.active { color: #F4C542; border-bottom: 1.5px solid #F4C542; }
        .action-btn { background: none; border: 1px solid #2a2d35; cursor: pointer; font-family: inherit; color: #aaa; font-size: 11px; padding: 6px 14px; border-radius: 4px; transition: all 0.15s; letter-spacing: 0.08em; }
        .action-btn:hover { border-color: #F4C542; color: #F4C542; }
        .remove-btn { background: none; border: none; cursor: pointer; color: #444; font-size: 14px; transition: color 0.15s; padding: 2px 6px; }
        .remove-btn:hover { color: #E87040; }
        .stock-row { border-bottom: 1px solid #161820; transition: background 0.15s; cursor: pointer; }
        .stock-row:hover { background: #13151c; }
        .stock-row.selected { background: #15171f; border-left: 2px solid #F4C542; }
        input { background: #13151c; border: 1px solid #2a2d35; color: #E8E6DF; font-family: inherit; font-size: 13px; padding: 9px 12px; border-radius: 4px; outline: none; width: 100%; }
        input:focus { border-color: #F4C542; }
        input::placeholder { color: #3a3d45; }
        .add-btn { background: #F4C542; border: none; color: #0D0F14; font-family: inherit; font-size: 12px; font-weight: 500; padding: 10px 20px; border-radius: 4px; cursor: pointer; letter-spacing: 0.08em; text-transform: uppercase; transition: opacity 0.15s; }
        .add-btn:hover { opacity: 0.85; }
        .badge { font-size: 10px; padding: 2px 8px; border-radius: 2px; letter-spacing: 0.08em; text-transform: uppercase; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.35s ease forwards; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "28px 36px 0", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #161820" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, color: "#F4C542", letterSpacing: "-0.02em" }}>Portfolio</span>
          <span style={{ fontSize: 11, color: "#3a3d45", letterSpacing: "0.2em", textTransform: "uppercase" }}>Tracker</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["overview", "storico", "settori", "confronto"].map(t => (
            <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>
        <button className="action-btn" onClick={() => setShowForm(v => !v)}>
          {showForm ? "✕ Annulla" : "+ Aggiungi Azione"}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="fade-up" style={{ padding: "18px 36px", background: "#0f1117", borderBottom: "1px solid #1a1d26", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <TickerAutocomplete
            value={form.ticker}
            onChange={v => setForm(f => ({ ...f, ticker: v }))}
            onSelect={t => setForm(f => ({ ...f, ticker: t.ticker, sector: t.sector || "Altro" }))}
          />
          <div style={{ flex: 1, minWidth: 100 }}>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.12em", textTransform: "uppercase" }}>Quantità</div>
            <input type="number" placeholder="es. 10" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.12em", textTransform: "uppercase" }}>Prezzo Acquisto $</div>
            <input type="number" placeholder="es. 175.00" value={form.buyPrice} onChange={e => setForm(f => ({ ...f, buyPrice: e.target.value }))} />
          </div>
          <button className="add-btn" onClick={handleAdd} disabled={adding} style={{ opacity: adding ? 0.6 : 1, display: "flex", alignItems: "center", gap: 7 }}>
            {adding && <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", border: "1.5px solid #0D0F14", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />}
            {adding ? "Cerco prezzo…" : "Aggiungi"}
          </button>
          {error && <span style={{ color: "#E87040", fontSize: 12, alignSelf: "center" }}>{error}</span>}
        </div>
      )}

      {/* Main content */}
      <div style={{ display: "flex", minHeight: "calc(100vh - 60px)" }}>

        {/* Sidebar: stock list */}
        <div style={{ width: 280, borderRight: "1px solid #161820", padding: "20px 0", flexShrink: 0 }}>
          {/* Summary KPIs */}
          <div style={{ padding: "0 20px 20px", borderBottom: "1px solid #161820" }}>
            <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>Valore Totale</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 300, color: "#E8E6DF", letterSpacing: "-0.02em" }}>
              ${totalValue.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: totalPnL >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>
                {totalPnL >= 0 ? "+" : ""}{totalPnL.toLocaleString("it-IT", { minimumFractionDigits: 2 })}$
              </span>
              <span style={{ fontSize: 11, color: totalPct >= 0 ? "#5EC98A" : "#E87040" }}>
                ({totalPct >= 0 ? "+" : ""}{totalPct.toFixed(2)}%)
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#3a3d45", marginTop: 3 }}>
              Investito: ${totalInvested.toLocaleString("it-IT", { minimumFractionDigits: 2 })}
            </div>
          </div>

          {/* Stocks */}
          <div style={{ marginTop: 4 }}>
            {stocks.map(s => {
              const pnl = (s.currentPrice - s.buyPrice) * s.qty;
              const pct = ((s.currentPrice - s.buyPrice) / s.buyPrice) * 100;
              const isUp = pct >= 0;
              return (
                <div key={s.id}
                  className={`stock-row ${displayStock?.id === s.id ? "selected" : ""}`}
                  style={{ padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                  onClick={() => setSelectedStock(s)}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#E8E6DF", letterSpacing: "0.05em" }}>{s.ticker}</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{s.qty} az. · ${s.buyPrice}</div>
                  </div>
                  <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, color: "#E8E6DF", display: "flex", alignItems: "center", gap: 5 }}>
                          ${s.currentPrice}
                          {s.priceReal && <span style={{ fontSize: 8, background: "#1a2e1a", color: "#5EC98A", padding: "1px 5px", borderRadius: 2, letterSpacing: "0.08em" }}>LIVE</span>}
                        </div>
                      <div style={{ fontSize: 11, color: isUp ? "#5EC98A" : "#E87040" }}>
                        {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
                      </div>
                    </div>
                    <button className="remove-btn" onClick={e => { e.stopPropagation(); handleRemove(s.id); }}>✕</button>
                  </div>
                </div>
              );
            })}
            {stocks.length === 0 && (
              <div style={{ padding: "30px 20px", color: "#333", fontSize: 12, textAlign: "center" }}>
                Nessuna azione nel portafoglio.<br />Aggiungi la prima!
              </div>
            )}
          </div>
        </div>

        {/* Main panel */}
        <div style={{ flex: 1, padding: "28px 36px", overflow: "auto" }}>

          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <div className="fade-up">
              {displayStock ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontFamily: "'Fraunces', serif", fontSize: 36, fontWeight: 300, letterSpacing: "-0.03em" }}>{displayStock.ticker}</span>
                        <span className="badge" style={{ background: "#1a1d26", color: "#888" }}>{displayStock.sector}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#444", marginTop: 4 }}>{displayStock.qty} azioni acquistate a ${displayStock.buyPrice}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 32, fontWeight: 300 }}>${displayStock.currentPrice}</div>
                      {(() => {
                        const p = ((displayStock.currentPrice - displayStock.buyPrice) / displayStock.buyPrice) * 100;
                        const pnl = (displayStock.currentPrice - displayStock.buyPrice) * displayStock.qty;
                        return (
                          <div style={{ color: p >= 0 ? "#5EC98A" : "#E87040", fontSize: 14, marginTop: 3 }}>
                            {p >= 0 ? "+" : ""}{p.toFixed(2)}% &nbsp;|&nbsp; {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Mini KPI cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 32 }}>
                    {[
                      { label: "Prezzo Acquisto", val: `$${displayStock.buyPrice}` },
                      { label: "Valore Posizione", val: `$${(displayStock.qty * displayStock.currentPrice).toFixed(2)}` },
                      { label: "Costo Totale", val: `$${(displayStock.qty * displayStock.buyPrice).toFixed(2)}` },
                      { label: "Peso Portafoglio", val: `${((displayStock.qty * displayStock.currentPrice / totalValue) * 100).toFixed(1)}%` },
                    ].map(k => (
                      <div key={k.label} style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "16px 18px" }}>
                        <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>{k.label}</div>
                        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300 }}>{k.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Price chart for selected stock */}
                  <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "20px 18px" }}>
                    <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 16 }}>Andamento Prezzo — Ultimi 30 giorni</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={displayStock.history}>
                        <defs>
                          <linearGradient id="stockGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F4C542" stopOpacity={0.18} />
                            <stop offset="95%" stopColor="#F4C542" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tick={{ fill: "#333", fontSize: 10 }} axisLine={false} tickLine={false} interval={6} />
                        <YAxis tick={{ fill: "#333", fontSize: 10 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={55} tickFormatter={v => `$${v}`} />
                        <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 12, color: "#E8E6DF" }} formatter={v => [`$${v}`, "Prezzo"]} />
                        <Area type="monotone" dataKey="price" stroke="#F4C542" strokeWidth={1.5} fill="url(#stockGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Notes panel */}
                  <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "20px 18px", marginTop: 14 }}>
                    <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>📝 Note personali</div>
                    <textarea
                      value={notes[displayStock.id] || ""}
                      onChange={e => setNotes(n => ({ ...n, [displayStock.id]: e.target.value }))}
                      placeholder={`Aggiungi note su ${displayStock.ticker}… es. motivo d'acquisto, target price, strategia`}
                      style={{
                        width: "100%", minHeight: 80, background: "#13151c", border: "1px solid #2a2d35",
                        color: "#E8E6DF", fontFamily: "inherit", fontSize: 12, padding: "10px 12px",
                        borderRadius: 4, outline: "none", resize: "vertical", lineHeight: 1.6
                      }}
                      onFocus={e => e.target.style.borderColor = "#F4C542"}
                      onBlur={e => e.target.style.borderColor = "#2a2d35"}
                    />
                    {notes[displayStock.id] && (
                      <div style={{ fontSize: 10, color: "#3a3d45", marginTop: 6, textAlign: "right" }}>
                        {notes[displayStock.id].length} caratteri · salvato automaticamente
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ color: "#333", textAlign: "center", marginTop: 80 }}>Aggiungi un'azione per iniziare.</div>
              )}
            </div>
          )}

          {/* STORICO TAB */}
          {activeTab === "storico" && (
            <div className="fade-up">
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, marginBottom: 4 }}>Andamento Portafoglio</div>
                <div style={{ fontSize: 11, color: "#444" }}>Valore totale stimato — ultimi 30 giorni</div>
              </div>
              <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "24px 18px" }}>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={portfolioHistory}>
                    <defs>
                      <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#5B8DEF" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#5B8DEF" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "#333", fontSize: 10 }} axisLine={false} tickLine={false} interval={4} />
                    <YAxis tick={{ fill: "#333", fontSize: 10 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={70} tickFormatter={v => `$${(v/1000).toFixed(1)}k`} />
                    <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 12, color: "#E8E6DF" }} formatter={v => [`$${v.toLocaleString("it-IT", { minimumFractionDigits: 2 })}`, "Portafoglio"]} />
                    <Area type="monotone" dataKey="valore" stroke="#5B8DEF" strokeWidth={2} fill="url(#portGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div style={{ marginTop: 28 }}>
                <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Dettaglio Posizioni</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1a1d26" }}>
                      {["Ticker", "Quantità", "P. Acquisto", "P. Attuale", "Valore", "P&L $", "P&L %"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "0 0 10px", fontSize: 10, color: "#444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 400 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stocks.map(s => {
                      const pnl = (s.currentPrice - s.buyPrice) * s.qty;
                      const pct = ((s.currentPrice - s.buyPrice) / s.buyPrice) * 100;
                      return (
                        <tr key={s.id} style={{ borderBottom: "1px solid #0f1117" }}>
                          <td style={{ padding: "12px 0", fontWeight: 500, color: "#E8E6DF" }}>{s.ticker}</td>
                          <td style={{ padding: "12px 0", color: "#888" }}>{s.qty}</td>
                          <td style={{ padding: "12px 0", color: "#888" }}>${s.buyPrice}</td>
                          <td style={{ padding: "12px 0", color: "#E8E6DF" }}>${s.currentPrice}</td>
                          <td style={{ padding: "12px 0", color: "#E8E6DF" }}>${(s.qty * s.currentPrice).toFixed(2)}</td>
                          <td style={{ padding: "12px 0", color: pnl >= 0 ? "#5EC98A" : "#E87040" }}>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</td>
                          <td style={{ padding: "12px 0", color: pct >= 0 ? "#5EC98A" : "#E87040" }}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SETTORI TAB */}
          {activeTab === "settori" && (
            <div className="fade-up">
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, marginBottom: 4 }}>Diversificazione per Settore</div>
                <div style={{ fontSize: 11, color: "#444" }}>Distribuzione del capitale per settore</div>
              </div>
              <div style={{ display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <PieChart width={240} height={240}>
                    <Pie data={sectorData} cx={115} cy={115} innerRadius={70} outerRadius={108} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {sectorData.map((entry, i) => (
                        <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 12, color: "#E8E6DF" }} formatter={v => [`$${v.toLocaleString("it-IT", { minimumFractionDigits: 2 })}`, ""]} />
                  </PieChart>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  {sectorData.map((s, i) => {
                    const pct = ((s.value / totalValue) * 100).toFixed(1);
                    return (
                      <div key={s.name} style={{ marginBottom: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                            <span style={{ fontSize: 13 }}>{s.name}</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#888" }}>
                            <span style={{ color: "#E8E6DF" }}>${s.value.toLocaleString("it-IT")}</span>
                            <span style={{ marginLeft: 8 }}>{pct}%</span>
                          </div>
                        </div>
                        <div style={{ background: "#1a1d26", borderRadius: 2, height: 4, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: SECTOR_COLORS[i % SECTOR_COLORS.length], borderRadius: 2, transition: "width 0.6s ease" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stock breakdown per sector */}
              <div style={{ marginTop: 32 }}>
                <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Azioni per Settore</div>
                {Object.entries(stocks.reduce((acc, s) => { (acc[s.sector] = acc[s.sector] || []).push(s); return acc; }, {})).map(([sec, list]) => (
                  <div key={sec} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 8, letterSpacing: "0.08em" }}>{sec.toUpperCase()}</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {list.map(s => {
                        const p = ((s.currentPrice - s.buyPrice) / s.buyPrice) * 100;
                        return (
                          <div key={s.id} style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "12px 16px", minWidth: 130 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>{s.ticker}</div>
                            <div style={{ fontSize: 12, color: "#E8E6DF", marginTop: 4 }}>${s.currentPrice}</div>
                            <div style={{ fontSize: 11, color: p >= 0 ? "#5EC98A" : "#E87040", marginTop: 2 }}>{p >= 0 ? "+" : ""}{p.toFixed(2)}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* CONFRONTO TAB */}
          {activeTab === "confronto" && (
            <div className="fade-up">
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, marginBottom: 4 }}>Confronto Titoli</div>
                <div style={{ fontSize: 11, color: "#444" }}>Seleziona due azioni per confrontarle</div>
              </div>

              {/* Selectors */}
              <div style={{ display: "flex", gap: 16, marginBottom: 28 }}>
                {[{ label: "Titolo A", color: "#F4C542", val: compareA, set: setCompareA },
                  { label: "Titolo B", color: "#5B8DEF", val: compareB, set: setCompareB }].map(({ label, color, val, set }) => (
                  <div key={label} style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>{label}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {stocks.map(s => (
                        <button key={s.id} onClick={() => set(s)}
                          style={{
                            background: val?.id === s.id ? color : "#13151c",
                            border: `1px solid ${val?.id === s.id ? color : "#2a2d35"}`,
                            color: val?.id === s.id ? "#0D0F14" : "#888",
                            fontFamily: "inherit", fontSize: 12, fontWeight: 500,
                            padding: "6px 14px", borderRadius: 4, cursor: "pointer", transition: "all 0.15s"
                          }}>{s.ticker}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {compareA && compareB && compareA.id !== compareB.id ? (() => {
                const metrics = [
                  { label: "Prezzo Acquisto", a: `$${compareA.buyPrice}`, b: `$${compareB.buyPrice}` },
                  { label: "Prezzo Attuale", a: `$${compareA.currentPrice}`, b: `$${compareB.currentPrice}` },
                  { label: "Quantità", a: compareA.qty, b: compareB.qty },
                  { label: "Valore Posizione", a: `$${(compareA.qty * compareA.currentPrice).toFixed(2)}`, b: `$${(compareB.qty * compareB.currentPrice).toFixed(2)}` },
                  { label: "Costo Totale", a: `$${(compareA.qty * compareA.buyPrice).toFixed(2)}`, b: `$${(compareB.qty * compareB.buyPrice).toFixed(2)}` },
                  {
                    label: "P&L $",
                    a: `${((compareA.currentPrice - compareA.buyPrice) * compareA.qty) >= 0 ? "+" : ""}$${((compareA.currentPrice - compareA.buyPrice) * compareA.qty).toFixed(2)}`,
                    b: `${((compareB.currentPrice - compareB.buyPrice) * compareB.qty) >= 0 ? "+" : ""}$${((compareB.currentPrice - compareB.buyPrice) * compareB.qty).toFixed(2)}`,
                    aColor: (compareA.currentPrice - compareA.buyPrice) >= 0 ? "#5EC98A" : "#E87040",
                    bColor: (compareB.currentPrice - compareB.buyPrice) >= 0 ? "#5EC98A" : "#E87040",
                  },
                  {
                    label: "P&L %",
                    a: `${((compareA.currentPrice - compareA.buyPrice) / compareA.buyPrice * 100) >= 0 ? "+" : ""}${((compareA.currentPrice - compareA.buyPrice) / compareA.buyPrice * 100).toFixed(2)}%`,
                    b: `${((compareB.currentPrice - compareB.buyPrice) / compareB.buyPrice * 100) >= 0 ? "+" : ""}${((compareB.currentPrice - compareB.buyPrice) / compareB.buyPrice * 100).toFixed(2)}%`,
                    aColor: (compareA.currentPrice - compareA.buyPrice) >= 0 ? "#5EC98A" : "#E87040",
                    bColor: (compareB.currentPrice - compareB.buyPrice) >= 0 ? "#5EC98A" : "#E87040",
                  },
                  { label: "Settore", a: compareA.sector, b: compareB.sector },
                  { label: "Note", a: notes[compareA.id] || "—", b: notes[compareB.id] || "—", small: true },
                ];
                return (
                  <>
                    {/* Header */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, marginBottom: 4 }}>
                      <div />
                      {[{ ticker: compareA.ticker, color: "#F4C542" }, { ticker: compareB.ticker, color: "#5B8DEF" }].map(({ ticker, color }) => (
                        <div key={ticker} style={{ background: "#0f1117", border: `1px solid ${color}22`, borderRadius: "6px 6px 0 0", padding: "10px 16px", textAlign: "center" }}>
                          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, color }}>{ticker}</span>
                        </div>
                      ))}
                    </div>
                    {metrics.map((m, i) => (
                      <div key={m.label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, marginBottom: 2 }}>
                        <div style={{ background: "#0f1117", border: "1px solid #1a1d26", padding: "10px 16px", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", display: "flex", alignItems: "center" }}>{m.label}</div>
                        {[{ val: m.a, color: m.aColor }, { val: m.b, color: m.bColor }].map(({ val, color }, j) => (
                          <div key={j} style={{ background: "#0f1117", border: "1px solid #1a1d26", padding: "10px 16px", fontSize: m.small ? 11 : 13, color: color || "#E8E6DF", display: "flex", alignItems: "center", wordBreak: "break-word" }}>{val}</div>
                        ))}
                      </div>
                    ))}

                    {/* Overlaid chart */}
                    <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "20px 18px", marginTop: 20 }}>
                      <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 16 }}>Performance relativa — Ultimi 30 giorni (base 0%)</div>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={compareA.history.map((h, i) => ({
                          date: h.date,
                          [compareA.ticker]: parseFloat(((h.price / compareA.history[0].price - 1) * 100).toFixed(2)),
                          [compareB.ticker]: parseFloat((((compareB.history[i]?.price || compareB.history[0].price) / compareB.history[0].price - 1) * 100).toFixed(2)),
                        }))}>
                          <defs>
                            <linearGradient id="cgA" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#F4C542" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#F4C542" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="cgB" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#5B8DEF" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#5B8DEF" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{ fill: "#333", fontSize: 10 }} axisLine={false} tickLine={false} interval={6} />
                          <YAxis tick={{ fill: "#333", fontSize: 10 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={45} tickFormatter={v => `${v}%`} />
                          <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 12, color: "#E8E6DF" }} formatter={v => [`${v}%`]} />
                          <Area type="monotone" dataKey={compareA.ticker} stroke="#F4C542" strokeWidth={1.5} fill="url(#cgA)" dot={false} />
                          <Area type="monotone" dataKey={compareB.ticker} stroke="#5B8DEF" strokeWidth={1.5} fill="url(#cgB)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 10 }}>
                        {[{ ticker: compareA.ticker, color: "#F4C542" }, { ticker: compareB.ticker, color: "#5B8DEF" }].map(({ ticker, color }) => (
                          <div key={ticker} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#888" }}>
                            <div style={{ width: 20, height: 2, background: color, borderRadius: 1 }} />
                            {ticker}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })() : (
                <div style={{ color: "#333", textAlign: "center", marginTop: 60, fontSize: 13 }}>
                  Seleziona due titoli diversi per iniziare il confronto.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
