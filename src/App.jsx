import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine, LineChart, Line, Legend } from "recharts";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SECTOR_COLORS = ["#F4C542","#E87040","#5B8DEF","#5EC98A","#BF6EEA","#F06292","#26C6DA","#FF7043"];
const CURRENCIES = { USD: { symbol: "$", rate: 1 }, EUR: { symbol: "€", rate: 0.92 }, GBP: { symbol: "£", rate: 0.79 } };
const PLANS = {
  free:  { name: "Free",  maxStocks: 5,        features: { realPrices: false, history: false, comparison: false, ai: false, alerts: false, export: false, benchmark: false } },
  pro:   { name: "Pro",   maxStocks: Infinity,  features: { realPrices: true,  history: true,  comparison: true,  ai: true,  alerts: true,  export: true,  benchmark: true  } },
};

// ─── CONTEXTS ─────────────────────────────────────────────────────────────────
const PlanCtx = createContext(null);
const CurrencyCtx = createContext(null);
function usePlan() { return useContext(PlanCtx); }
function useCurrency() { return useContext(CurrencyCtx); }

// ─── UTILS ────────────────────────────────────────────────────────────────────
function ls(key, fallback) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } }
function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
function fmt(n, dec = 2) { return Math.abs(Number(n)).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
function fmtPct(n) { return `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%`; }

function simulateHistory(base, days = 30) {
  let p = base * (0.88 + Math.random() * 0.1);
  return Array.from({ length: days + 1 }, (_, i) => {
    p = p * (1 + (Math.random() - 0.478) * 0.022);
    const d = new Date(); d.setDate(d.getDate() - (days - i));
    return { date: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }), price: parseFloat(p.toFixed(2)) };
  });
}

// ─── API ──────────────────────────────────────────────────────────────────────
// Detect if running on Vercel (production) or Claude preview
const IS_VERCEL = typeof window !== "undefined" && window.location.hostname.includes("vercel.app");
const API_BASE  = IS_VERCEL ? "" : "https://portfolio-tracker-i97337xz6-voice-tecs-projects.vercel.app";

// Price cache to avoid hammering the API
const priceCache = {};
const CACHE_TTL = 60_000; // 60 seconds

async function fetchRealPrice(ticker) {
  const key = ticker.toUpperCase();
  const cached = priceCache[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.price;
  try {
    const res = await fetch(`${API_BASE}/api/price?symbol=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.price) return null;
    priceCache[key] = { price: data.price, ts: Date.now() };
    return data.price;
  } catch { return null; }
}

async function fetchRealHistory(ticker, days = 30) {
  try {
    const res = await fetch(`${API_BASE}/api/history?symbol=${encodeURIComponent(ticker.toUpperCase())}&days=${days}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.candles || null;
  } catch { return null; }
}

async function fetchTickerSearch(q) {
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(r => ({ ticker: r.ticker, name: r.name, exchange: r.exchange, sector: "—" }));
  } catch { return []; }
}

async function claudeCall(system, userMsg, tools = []) {
  const body = { model: "claude-sonnet-4-20250514", max_tokens: 400, system, messages: [{ role: "user", content: userMsg }] };
  if (tools.length) body.tools = tools;
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  return (data.content || []).map(b => b.text || "").join("").trim();
}

async function fetchAIAnalysis(stock, note, sym) {
  return claudeCall(
    `Sei un assistente finanziario informativo. Rispondi in italiano, max 5 frasi, cerca notizie recenti sul titolo. Termina SEMPRE con: "⚠️ Solo a scopo informativo — non costituisce consulenza finanziaria ai sensi MiFID II."`,
    `Analisi su ${stock.ticker}: ${stock.qty} azioni, acquisto ${sym}${fmt(stock.buyPrice)}, attuale ${sym}${fmt(stock.currentPrice)}, P&L ${fmtPct((stock.currentPrice - stock.buyPrice) / stock.buyPrice * 100)}. Note: "${note || 'nessuna'}"`,
    [{ type: "web_search_20250305", name: "web_search" }]
  );
}

// ─── SPINNER ──────────────────────────────────────────────────────────────────
function Spinner({ color = "#F4C542", size = 11 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />;
}

// ─── PRO GATE ─────────────────────────────────────────────────────────────────
function ProGate({ feat, children, h = 180 }) {
  const { plan, setShowUpgrade } = usePlan();
  if (PLANS[plan]?.features[feat]) return children;
  return (
    <div style={{ position: "relative" }}>
      <div style={{ filter: "blur(5px)", pointerEvents: "none", opacity: 0.25, minHeight: h }}>{children}</div>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <span style={{ fontSize: 24 }}>🔒</span>
        <span style={{ fontSize: 12, color: "#bbb" }}>Disponibile con Piano Pro</span>
        <button onClick={() => setShowUpgrade(true)} style={{ background: "#F4C542", border: "none", color: "#0D0F14", fontFamily: "inherit", fontSize: 11, fontWeight: 600, padding: "8px 20px", borderRadius: 4, cursor: "pointer" }}>Sblocca Pro</button>
      </div>
    </div>
  );
}

// ─── UPGRADE MODAL ────────────────────────────────────────────────────────────
function UpgradeModal({ onClose }) {
  const { setPlan } = usePlan();
  const perks = [["📈","Prezzi live reali"],["🤖","Analisi AI per titolo"],["📊","Storico grafici"],["🔔","Alert target prezzo"],["⚖️","Confronto titoli"],["📥","Export CSV"],["📐","Benchmark vs S&P500"],["♾️","Titoli illimitati"],["☁️","Sync cloud (presto)"],["💱","Multi-valuta"]];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 14, padding: "36px 38px", maxWidth: 480, width: "100%", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 18, background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18 }}>✕</button>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 30, fontWeight: 300, marginBottom: 4 }}>Portfolio <span style={{ color: "#F4C542" }}>Pro</span></div>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 24 }}>Tutto quello che serve per investire con più consapevolezza.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 26 }}>
          {perks.map(([icon, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#13151c", borderRadius: 6, fontSize: 12, color: "#aaa" }}>
              {icon} {label}
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 38, color: "#F4C542" }}>€12<span style={{ fontSize: 14, color: "#555" }}>/mese</span></div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>oppure <strong style={{ color: "#888" }}>€99/anno</strong> · Cancella quando vuoi</div>
        </div>
        <button onClick={() => { setPlan("pro"); onClose(); }} style={{ width: "100%", background: "#F4C542", border: "none", color: "#0D0F14", fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "14px", borderRadius: 8, cursor: "pointer" }}>
          Attiva Pro — Demo gratuita
        </button>
        <div style={{ fontSize: 10, color: "#2a2d35", textAlign: "center", marginTop: 10 }}>Demo: in produzione aprirà Stripe Checkout</div>
      </div>
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email || !pw) return setErr("Compila tutti i campi.");
    if (mode === "register" && !name) return setErr("Inserisci il tuo nome.");
    setLoading(true); setErr("");
    await new Promise(r => setTimeout(r, 600));
    // TODO: replace with → supabase.auth.signInWithPassword({ email, password: pw })
    const user = { id: btoa(email).replace(/[^a-z0-9]/gi, ""), email, name: name || email.split("@")[0] };
    lsSet("pt_user", user);
    onAuth(user);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0D0F14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input{background:#13151c;border:1px solid #2a2d35;color:#E8E6DF;font-family:inherit;font-size:13px;padding:11px 14px;border-radius:6px;outline:none;width:100%}
        input:focus{border-color:#F4C542} input::placeholder{color:#3a3d45}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
      <div style={{ animation: "fadeUp 0.4s ease", width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 38, fontWeight: 300, color: "#F4C542", letterSpacing: "-0.02em" }}>Portfolio</div>
          <div style={{ fontSize: 9, color: "#2a2d35", letterSpacing: "0.4em", textTransform: "uppercase", marginTop: 2 }}>Tracker</div>
        </div>
        <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 12, padding: "30px 28px" }}>
          <div style={{ display: "flex", background: "#13151c", borderRadius: 6, padding: 3, marginBottom: 22 }}>
            {[["login","Accedi"],["register","Registrati"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{ flex: 1, background: mode === m ? "#1a1d26" : "transparent", border: "none", color: mode === m ? "#E8E6DF" : "#444", fontFamily: "inherit", fontSize: 11, padding: "8px", borderRadius: 4, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em", transition: "all 0.15s" }}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mode === "register" && <input placeholder="Nome" value={name} onChange={e => setName(e.target.value)} />}
            <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            <input placeholder="Password" type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          {err && <div style={{ fontSize: 11, color: "#E87040", marginTop: 10 }}>{err}</div>}
          <button onClick={submit} disabled={loading} style={{ marginTop: 18, width: "100%", background: "#F4C542", border: "none", color: "#0D0F14", fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "13px", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: loading ? 0.7 : 1 }}>
            {loading && <Spinner color="#0D0F14" />}
            {mode === "login" ? "Entra nel portafoglio" : "Crea Account"}
          </button>
          <div style={{ fontSize: 10, color: "#2a2d35", textAlign: "center", marginTop: 12 }}>Demo — qualsiasi email/password funziona</div>
        </div>
        <div style={{ fontSize: 9, color: "#1e2028", textAlign: "center", marginTop: 18, lineHeight: 1.8 }}>
          ⚠️ Strumento a scopo puramente informativo.<br />Non costituisce consulenza finanziaria ai sensi MiFID II.
        </div>
      </div>
    </div>
  );
}

// ─── TICKER AUTOCOMPLETE ──────────────────────────────────────────────────────
function TickerAutocomplete({ value, onChange, onSelect }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  const cache = useRef({});
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!open || !value) { setResults([]); setLoading(false); return; }
    const k = value.toUpperCase();
    if (cache.current[k]) { setResults(cache.current[k]); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const r = await fetchTickerSearch(value);
      cache.current[k] = r;
      setResults(r);
      setLoading(false);
    }, 320);
    return () => clearTimeout(timer.current);
  }, [value, open]);

  useEffect(() => { setHi(0); }, [results]);
  useEffect(() => {
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn);
  }, []);

  function handleKey(e) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h+1, results.length-1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h-1, 0)); }
    if (e.key === "Enter" && results[hi]) { e.preventDefault(); onSelect(results[hi]); setOpen(false); }
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.12em", textTransform: "uppercase" }}>Ticker</div>
      <input placeholder="AAPL, ENI, PLAB…" value={value} autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onKeyDown={handleKey} />
      {open && value.length > 0 && (loading || results.length > 0) && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 9999, background: "#13151c", border: "1px solid #2a2d35", borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", overflow: "hidden", minWidth: 320 }}>
          {loading && results.length === 0
            ? <div style={{ padding: "12px 16px", fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 8 }}><Spinner /> Ricerca ticker…</div>
            : results.map((t, i) => (
              <div key={t.ticker+i} onMouseDown={() => { onSelect(t); setOpen(false); }} onMouseEnter={() => setHi(i)}
                style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: i === hi ? "#1a1d26" : "transparent", borderBottom: i < results.length-1 ? "1px solid #161820" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#E8E6DF", minWidth: 52 }}>{t.ticker}</span>
                  <span style={{ fontSize: 11, color: "#555" }}>{t.name}</span>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  {t.exchange && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: "#0D0F14", color: "#444" }}>{t.exchange}</span>}
                  {t.sector && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: "#0D0F14", color: "#666" }}>{t.sector}</span>}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── DEFAULT DATA ─────────────────────────────────────────────────────────────
const DEFAULT_STOCKS = [
  { id: 1, ticker: "AAPL",  qty: 10, buyPrice: 175.0, currentPrice: 213.49, sector: "Tech",     priceReal: false, buyDate: "01/01/24" },
  { id: 2, ticker: "MSFT",  qty: 5,  buyPrice: 380.0, currentPrice: 415.32, sector: "Tech",     priceReal: false, buyDate: "15/03/24" },
  { id: 3, ticker: "NVDA",  qty: 8,  buyPrice: 495.0, currentPrice: 875.20, sector: "Tech",     priceReal: false, buyDate: "10/06/24" },
];

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => ls("pt_user", null));
  const [plan, setPlanRaw] = useState(() => ls("pt_plan", "free"));
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [currency, setCurrency] = useState(() => ls("pt_currency", "USD"));
  const setPlan = (p) => { setPlanRaw(p); lsSet("pt_plan", p); };
  const sym = CURRENCIES[currency]?.symbol || "$";
  const rate = CURRENCIES[currency]?.rate || 1;

  const uid = user?.id || "demo";
  const [stocks, setStocksRaw] = useState(() => {
    const saved = ls(`pt_stocks_${uid}`, null);
    return (saved || DEFAULT_STOCKS).map(s => ({ ...s, history: simulateHistory(s.currentPrice || s.buyPrice) }));
  });
  const [notes, setNotesRaw] = useState(() => ls(`pt_notes_${uid}`, {}));
  const [alerts, setAlertsRaw] = useState(() => ls(`pt_alerts_${uid}`, {}));

  const setStocks = fn => setStocksRaw(prev => { const next = typeof fn === "function" ? fn(prev) : fn; lsSet(`pt_stocks_${uid}`, next.map(s => ({ ...s, history: [] }))); return next; });
  const setNotes  = fn => setNotesRaw(prev => { const next = typeof fn === "function" ? fn(prev) : fn; lsSet(`pt_notes_${uid}`, next); return next; });
  const setAlerts = fn => setAlertsRaw(prev => { const next = typeof fn === "function" ? fn(prev) : fn; lsSet(`pt_alerts_${uid}`, next); return next; });

  const [activeTab, setActiveTab] = useState("overview");
  const [selectedId, setSelectedId] = useState(stocks[0]?.id || null);
  const [showForm, setShowForm] = useState(false);
  const [chartPeriod, setChartPeriod] = useState(30); // 30, 90, 180, 365
  const [periodHistory, setPeriodHistory] = useState({});
  const [periodLoading, setPeriodLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importErr, setImportErr] = useState("");
  const csvInputRef = useRef(null);
  const [form, setForm] = useState({ ticker: "", qty: "", buyPrice: "", sector: "Altro" });
  const [adding, setAdding] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [aiText, setAiText] = useState({});
  const [aiLoading, setAiLoading] = useState({});
  const [firedAlerts, setFiredAlerts] = useState([]);
  const nextId = useRef(200);

  const displayStock = stocks.find(s => s.id === selectedId) || stocks[0];
  const totalInvested = stocks.reduce((s, x) => s + x.qty * x.buyPrice, 0) * rate;
  const totalValue    = stocks.reduce((s, x) => s + x.qty * x.currentPrice, 0) * rate;
  const totalPnL      = totalValue - totalInvested;
  const totalPct      = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const sectorData = Object.entries(
    stocks.reduce((acc, s) => { acc[s.sector] = (acc[s.sector] || 0) + s.qty * s.currentPrice * rate; return acc; }, {})
  ).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));

  const portfolioHistory = stocks[0]?.history.map((_, i) => ({
    date: stocks[0].history[i].date,
    valore: parseFloat(stocks.reduce((s, st) => s + st.qty * (st.history[i]?.price || st.currentPrice), 0).toFixed(2))
  })) || [];

  const benchmarkHistory = (() => {
    let p = portfolioHistory[0]?.valore || 10000;
    return portfolioHistory.map(pt => ({ ...pt, benchmark: parseFloat((p = p * (1 + (Math.random() - 0.475) * 0.012)).toFixed(2)) }));
  })();

  // Alert check
  useEffect(() => {
    const fired = [];
    stocks.forEach(s => {
      const a = alerts[s.id];
      if (!a) return;
      if (a.above && s.currentPrice >= a.above) fired.push({ id: s.id, msg: `▲ ${s.ticker} ha superato ${sym}${fmt(a.above)}` });
      if (a.below && s.currentPrice <= a.below) fired.push({ id: s.id, msg: `▼ ${s.ticker} è sceso sotto ${sym}${fmt(a.below)}` });
    });
    setFiredAlerts(fired);
  }, [stocks, alerts]);

  // Fetch real prices + history on mount via Finnhub proxy
  useEffect(() => {
    (async () => {
      const updated = await Promise.all(stocks.map(async s => {
        const real = await fetchRealPrice(s.ticker);
        const history = await fetchRealHistory(s.ticker) || simulateHistory(real || s.buyPrice);
        if (real && history.length > 0) history[history.length - 1].price = real;
        return { ...s, currentPrice: real || s.currentPrice, history, priceReal: !!real };
      }));
      setStocksRaw(updated);
    })();
  }, []);

  async function handleAdd() {
    const t = form.ticker.trim().toUpperCase();
    const q = parseFloat(form.qty);
    const p = parseFloat(form.buyPrice);
    if (!t) return setFormErr("Inserisci un ticker.");
    if (!q || q <= 0) return setFormErr("Quantità non valida.");
    if (!p || p <= 0) return setFormErr("Prezzo non valido.");
    if (plan === "free" && stocks.length >= PLANS.free.maxStocks) { setShowUpgrade(true); return; }
    setFormErr(""); setAdding(true);
    const realPrice = plan === "pro" ? await fetchRealPrice(t) : null;
    const curPrice = realPrice || p * (1 + (Math.random() - 0.45) * 0.3);
    const history = simulateHistory(curPrice);
    if (realPrice) history[history.length - 1].price = realPrice;
    const ns = { id: nextId.current++, ticker: t, qty: q, buyPrice: p, currentPrice: parseFloat(curPrice.toFixed(2)), history, sector: form.sector || "Altro", priceReal: !!realPrice, buyDate: new Date().toLocaleDateString("it-IT") };
    setStocks(prev => [...prev, ns]);
    setSelectedId(ns.id);
    setForm({ ticker: "", qty: "", buyPrice: "", sector: "Altro" });
    setAdding(false); setShowForm(false);
  }

  function handleRemove(id) {
    setStocks(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(stocks.find(s => s.id !== id)?.id || null);
  }

  function exportCSV() {
    const rows = [["Ticker","Settore","Quantità","P.Acquisto","P.Attuale","Valore","P&L","P&L%","Data","Note"],
      ...stocks.map(s => {
        const pnl = (s.currentPrice - s.buyPrice) * s.qty * rate;
        const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
        return [s.ticker, s.sector, s.qty, `${sym}${fmt(s.buyPrice*rate)}`, `${sym}${fmt(s.currentPrice*rate)}`, `${sym}${fmt(s.qty*s.currentPrice*rate)}`, `${sym}${fmt(Math.abs(pnl))}`, fmtPct(pct), s.buyDate, notes[s.id] || ""];
      })
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv); a.download = "portafoglio.csv"; a.click();
  }

  // Fetch history when period changes for selected stock
  useEffect(() => {
    if (!displayStock) return;
    const key = `${displayStock.ticker}_${chartPeriod}`;
    if (periodHistory[key]) return;
    setPeriodLoading(true);
    fetchRealHistory(displayStock.ticker, chartPeriod).then(candles => {
      setPeriodHistory(h => ({ ...h, [key]: candles || simulateHistory(displayStock.currentPrice, chartPeriod) }));
      setPeriodLoading(false);
    });
  }, [displayStock?.ticker, chartPeriod]);

  const currentHistory = (() => {
    if (!displayStock) return [];
    const key = `${displayStock.ticker}_${chartPeriod}`;
    return periodHistory[key] || displayStock.history;
  })();

  // CSV Import — supports Degiro, Fineco, generic format
  function parseCSV(text) {
    const lines = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase().replace(/"/g, "");
    const cols = header.split(/[,;]/);

    // Detect format
    const isDegiro  = cols.some(c => c.includes("prodotto")) && cols.some(c => c.includes("quantità"));
    const isFineco  = cols.some(c => c.includes("titolo")) && cols.some(c => c.includes("quantita"));
    const isGeneric = cols.some(c => c.includes("ticker") || c.includes("symbol"));

    return lines.slice(1).map(line => {
      const parts = line.replace(/"/g, "").split(/[,;]/);
      const get = i => parts[i]?.trim() || "";

      if (isDegiro) {
        const tickerIdx = cols.findIndex(c => c.includes("simbolo") || c.includes("codice"));
        const qtyIdx    = cols.findIndex(c => c.includes("quantità") || c.includes("quantita"));
        const priceIdx  = cols.findIndex(c => c.includes("prezzo") || c.includes("valore"));
        return { ticker: get(tickerIdx) || get(0), qty: parseFloat(get(qtyIdx)) || 0, buyPrice: parseFloat(get(priceIdx)?.replace(",",".")) || 0, sector: "Altro" };
      }
      if (isFineco) {
        const tickerIdx = cols.findIndex(c => c.includes("ticker") || c.includes("codice"));
        const qtyIdx    = cols.findIndex(c => c.includes("quantita") || c.includes("quantità"));
        const priceIdx  = cols.findIndex(c => c.includes("prezzo") || c.includes("costo medio"));
        return { ticker: get(tickerIdx) || get(0), qty: parseFloat(get(qtyIdx)) || 0, buyPrice: parseFloat(get(priceIdx)?.replace(",",".")) || 0, sector: "Altro" };
      }
      // Generic: ticker, qty, buyPrice
      const tickerIdx = cols.findIndex(c => c.includes("ticker") || c.includes("symbol"));
      const qtyIdx    = cols.findIndex(c => c.includes("qty") || c.includes("quantity") || c.includes("quantit"));
      const priceIdx  = cols.findIndex(c => c.includes("price") || c.includes("prezzo") || c.includes("buy"));
      return {
        ticker:   get(tickerIdx >= 0 ? tickerIdx : 0).toUpperCase(),
        qty:      parseFloat(get(qtyIdx >= 0 ? qtyIdx : 1)) || 0,
        buyPrice: parseFloat(get(priceIdx >= 0 ? priceIdx : 2)?.replace(",",".")) || 0,
        sector:   "Altro"
      };
    }).filter(r => r.ticker && r.qty > 0 && r.buyPrice > 0);
  }

  function handleCSVFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErr("");
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      const rows = parseCSV(text);
      if (rows.length === 0) { setImportErr("Nessun dato valido trovato. Controlla il formato del file."); return; }
      setImportPreview(rows);
    };
    reader.readAsText(file, "UTF-8");
  }

  async function confirmImport() {
    if (plan === "free" && stocks.length + importPreview.length > PLANS.free.maxStocks) {
      setShowUpgrade(true); return;
    }
    const imported = await Promise.all(importPreview.map(async (r, i) => {
      const real = await fetchRealPrice(r.ticker);
      const history = simulateHistory(real || r.buyPrice);
      return { id: nextId.current++, ticker: r.ticker, qty: r.qty, buyPrice: r.buyPrice, currentPrice: real || r.buyPrice, history, sector: r.sector, priceReal: !!real, buyDate: new Date().toLocaleDateString("it-IT") };
    }));
    setStocks(prev => [...prev, ...imported]);
    setImportPreview([]);
    setShowImport(false);
    setSelectedId(imported[0]?.id);
  }

  // PDF Report
  function exportPDF() {
    const date = new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
    const rows = stocks.map(s => {
      const pnl = (s.currentPrice - s.buyPrice) * s.qty * rate;
      const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
      return `<tr>
        <td>${s.ticker}</td><td>${s.sector}</td><td>${s.qty}</td>
        <td>${sym}${fmt(s.buyPrice*rate)}</td><td>${sym}${fmt(s.currentPrice*rate)}</td>
        <td>${sym}${fmt(s.qty*s.currentPrice*rate)}</td>
        <td style="color:${pnl>=0?"#16a34a":"#dc2626"}">${pnl>=0?"+":""}${sym}${fmt(Math.abs(pnl))}</td>
        <td style="color:${pct>=0?"#16a34a":"#dc2626"}">${fmtPct(pct)}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Report Portafoglio — ${date}</title>
    <style>
      body{font-family:'Helvetica Neue',sans-serif;color:#1a1a1a;padding:40px;max-width:900px;margin:0 auto}
      h1{font-size:28px;font-weight:300;margin-bottom:4px}
      .sub{color:#888;font-size:13px;margin-bottom:32px}
      .kpi-row{display:flex;gap:20px;margin-bottom:32px}
      .kpi{background:#f8f8f8;border-radius:8px;padding:16px 20px;flex:1}
      .kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:6px}
      .kpi-val{font-size:22px;font-weight:300}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th{text-align:left;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;border-bottom:2px solid #eee}
      td{padding:10px 12px;border-bottom:1px solid #f0f0f0}
      tr:hover td{background:#fafafa}
      .footer{margin-top:40px;font-size:10px;color:#ccc;text-align:center;line-height:1.8}
      .positive{color:#16a34a} .negative{color:#dc2626}
    </style></head><body>
    <h1>Portfolio Report</h1>
    <div class="sub">Generato il ${date} · ${user?.name || ""}</div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Valore Totale</div><div class="kpi-val">${sym}${fmt(totalValue)}</div></div>
      <div class="kpi"><div class="kpi-label">Investito</div><div class="kpi-val">${sym}${fmt(totalInvested)}</div></div>
      <div class="kpi"><div class="kpi-label">P&L Totale</div><div class="kpi-val" style="color:${totalPnL>=0?"#16a34a":"#dc2626"}">${totalPnL>=0?"+":""}${sym}${fmt(Math.abs(totalPnL))}</div></div>
      <div class="kpi"><div class="kpi-label">Performance</div><div class="kpi-val" style="color:${totalPct>=0?"#16a34a":"#dc2626"}">${fmtPct(totalPct)}</div></div>
    </div>
    <table><thead><tr><th>Ticker</th><th>Settore</th><th>Q.tà</th><th>P.Acquisto</th><th>P.Attuale</th><th>Valore</th><th>P&L</th><th>P&L%</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer">⚠️ Documento generato da Portfolio Tracker a scopo puramente informativo.<br>Non costituisce consulenza finanziaria ai sensi della normativa MiFID II.<br>Dati con possibile ritardo di 15 minuti.</div>
    </body></html>`;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }

  async function handleAI(stock) {
    if (aiLoading[stock.id]) return;
    setAiLoading(l => ({ ...l, [stock.id]: true }));
    const text = await fetchAIAnalysis(stock, notes[stock.id], sym);
    setAiText(t => ({ ...t, [stock.id]: text }));
    setAiLoading(l => ({ ...l, [stock.id]: false }));
  }

  const planCtx = { plan, setPlan, setShowUpgrade };
  const currCtx = { currency, setCurrency, sym, rate };

  if (!user) return <AuthScreen onAuth={u => setUser(u)} />;

  return (
    <PlanCtx.Provider value={planCtx}>
      <CurrencyCtx.Provider value={currCtx}>
        <div style={{ minHeight: "100vh", background: "#0D0F14", color: "#E8E6DF", fontFamily: "'DM Mono', 'Courier New', monospace" }}>
          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600&display=swap');
            *{box-sizing:border-box;margin:0;padding:0}
            ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0D0F14} ::-webkit-scrollbar-thumb{background:#2a2d35;border-radius:2px}
            input,textarea,select{background:#13151c;border:1px solid #2a2d35;color:#E8E6DF;font-family:inherit;font-size:13px;padding:9px 12px;border-radius:4px;outline:none;width:100%}
            input:focus,textarea:focus{border-color:#F4C542} input::placeholder,textarea::placeholder{color:#3a3d45}
            select{cursor:pointer}
            .tab-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;padding:8px 14px;color:#555;transition:color 0.2s;white-space:nowrap;border-bottom:1.5px solid transparent}
            .tab-btn:hover{color:#aaa} .tab-btn.active{color:#F4C542;border-bottom-color:#F4C542}
            .action-btn{background:none;border:1px solid #2a2d35;cursor:pointer;font-family:inherit;color:#aaa;font-size:11px;padding:6px 14px;border-radius:4px;transition:all 0.15s;letter-spacing:0.06em;white-space:nowrap}
            .action-btn:hover{border-color:#F4C542;color:#F4C542}
            .remove-btn{background:none;border:none;cursor:pointer;color:#333;font-size:13px;padding:2px 6px;transition:color 0.15s;flex-shrink:0}
            .remove-btn:hover{color:#E87040}
            .stock-row{border-bottom:1px solid #0f1117;transition:background 0.12s;cursor:pointer}
            .stock-row:hover{background:#12141b}
            .stock-row.active{background:#14171f;border-left:2px solid #F4C542}
            .add-btn{background:#F4C542;border:none;color:#0D0F14;font-family:inherit;font-size:12px;font-weight:600;padding:10px 20px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:7px;white-space:nowrap;transition:opacity 0.15s}
            .add-btn:hover{opacity:0.85} .add-btn:disabled{opacity:0.5;cursor:not-allowed}
            .card{background:#0f1117;border:1px solid #1a1d26;border-radius:6px;padding:16px 18px}
            @keyframes spin{to{transform:rotate(360deg)}}
            @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
            .fade-up{animation:fadeUp 0.3s ease forwards}
          `}</style>

          {/* Alert toasts */}
          {firedAlerts.length > 0 && (
            <div style={{ position: "fixed", top: 16, right: 16, zIndex: 8888, display: "flex", flexDirection: "column", gap: 8 }}>
              {firedAlerts.map((a, i) => (
                <div key={i} style={{ background: "#1a1400", border: "1px solid #F4C542", borderRadius: 6, padding: "10px 16px", fontSize: 12, color: "#F4C542", display: "flex", alignItems: "center", gap: 10 }}>
                  🔔 {a.msg}
                  <button onClick={() => setFiredAlerts(x => x.filter((_,j) => j !== i))} style={{ background: "none", border: "none", color: "#F4C542", cursor: "pointer", fontSize: 14, marginLeft: 4 }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

          {/* Header */}
          <div style={{ padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #161820", height: 52, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 300, color: "#F4C542" }}>Portfolio</span>
              <span style={{ fontSize: 9, color: "#2a2d35", letterSpacing: "0.2em", textTransform: "uppercase" }}>Tracker</span>
              {plan === "pro" && <span style={{ fontSize: 8, background: "#F4C542", color: "#0D0F14", padding: "2px 6px", borderRadius: 2, fontWeight: 700, letterSpacing: "0.1em" }}>PRO</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", flex: 1, justifyContent: "center" }}>
              {["overview","storico","settori","confronto","alert"].map(t => (
                <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
              <select value={currency} onChange={e => { setCurrency(e.target.value); lsSet("pt_currency", e.target.value); }} style={{ width: "auto", padding: "5px 8px", fontSize: 11, color: "#888" }}>
                {Object.keys(CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {plan === "free" && <button className="action-btn" onClick={() => setShowUpgrade(true)} style={{ color: "#F4C542", borderColor: "#F4C542" }}>✦ Pro</button>}
              <button className="action-btn" onClick={() => setShowImport(v => !v)}>↑ Import CSV</button>
              <button className="action-btn" onClick={() => setShowForm(v => !v)}>{showForm ? "✕" : "+ Aggiungi"}</button>
              <button className="action-btn" onClick={() => { lsSet("pt_user", null); setUser(null); }} style={{ color: "#333", fontSize: 10 }}>{user.name} ↩</button>
            </div>
          </div>

          {/* Add form */}
          {showForm && (
            <div className="fade-up" style={{ padding: "14px 28px", background: "#0a0c10", borderBottom: "1px solid #1a1d26", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <TickerAutocomplete value={form.ticker} onChange={v => setForm(f => ({ ...f, ticker: v }))} onSelect={t => setForm(f => ({ ...f, ticker: t.ticker, sector: t.sector || "Altro" }))} />
              <div style={{ flex: 1, minWidth: 90 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Quantità</div>
                <input type="number" placeholder="10" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Prezzo Acquisto</div>
                <input type="number" placeholder="175.00" value={form.buyPrice} onChange={e => setForm(f => ({ ...f, buyPrice: e.target.value }))} />
              </div>
              <button className="add-btn" onClick={handleAdd} disabled={adding}>
                {adding && <Spinner color="#0D0F14" />}
                {adding ? "Recupero prezzo…" : "Aggiungi"}
              </button>
              {plan === "free" && stocks.length >= PLANS.free.maxStocks && <span style={{ fontSize: 11, color: "#E87040", alignSelf: "center" }}>Limite Free: max {PLANS.free.maxStocks} titoli</span>}
              {formErr && <span style={{ fontSize: 11, color: "#E87040", alignSelf: "center" }}>{formErr}</span>}
            </div>
          )}

          {/* Import CSV panel */}
          {showImport && (
            <div className="fade-up" style={{ padding: "16px 28px", background: "#0a0c10", borderBottom: "1px solid #1a1d26" }}>
              <input ref={csvInputRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleCSVFile} />
              {importPreview.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: "#555" }}>Supporta file CSV di <strong style={{color:"#888"}}>Degiro</strong>, <strong style={{color:"#888"}}>Fineco</strong> e formato generico (ticker, qty, prezzo)</div>
                  <button className="add-btn" onClick={() => csvInputRef.current?.click()}>📂 Scegli file CSV</button>
                  {importErr && <span style={{ fontSize: 11, color: "#E87040" }}>{importErr}</span>}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 11, color: "#5EC98A", marginBottom: 10 }}>✓ Trovati {importPreview.length} titoli — controlla e conferma</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    {importPreview.map((r, i) => (
                      <div key={i} style={{ background: "#13151c", border: "1px solid #2a2d35", borderRadius: 4, padding: "6px 12px", fontSize: 12 }}>
                        <span style={{ color: "#E8E6DF", fontWeight: 500 }}>{r.ticker}</span>
                        <span style={{ color: "#555", marginLeft: 8 }}>{r.qty} az. @ ${r.buyPrice}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="add-btn" onClick={confirmImport}>✓ Importa tutti</button>
                    <button className="action-btn" onClick={() => { setImportPreview([]); setImportErr(""); }}>✕ Annulla</button>
                  </div>
                </div>
              )}
            </div>
          )}

            {/* Sidebar */}
            <div style={{ width: 258, borderRight: "1px solid #161820", flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid #161820" }}>
                <div style={{ fontSize: 9, color: "#2a2d35", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 5 }}>Valore Portafoglio</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em" }}>{sym}{fmt(totalValue)}</div>
                <div style={{ display: "flex", gap: 7, marginTop: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: totalPnL >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>{totalPnL >= 0 ? "+" : ""}{sym}{fmt(Math.abs(totalPnL))}</span>
                  <span style={{ fontSize: 10, color: totalPct >= 0 ? "#5EC98A" : "#E87040" }}>({fmtPct(totalPct)})</span>
                </div>
                <div style={{ fontSize: 9, color: "#2a2d35", marginTop: 2 }}>Investito: {sym}{fmt(totalInvested)}</div>
                {plan === "pro" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                    <button onClick={exportCSV} style={{ background: "none", border: "1px solid #1a1d26", color: "#444", fontFamily: "inherit", fontSize: 9, padding: "4px 10px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.08em", transition: "all 0.15s" }}
                      onMouseEnter={e => { e.target.style.borderColor = "#F4C542"; e.target.style.color = "#F4C542"; }}
                      onMouseLeave={e => { e.target.style.borderColor = "#1a1d26"; e.target.style.color = "#444"; }}>
                      ↓ CSV
                    </button>
                    <button onClick={exportPDF} style={{ background: "none", border: "1px solid #1a1d26", color: "#444", fontFamily: "inherit", fontSize: 9, padding: "4px 10px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.08em", transition: "all 0.15s" }}
                      onMouseEnter={e => { e.target.style.borderColor = "#F4C542"; e.target.style.color = "#F4C542"; }}
                      onMouseLeave={e => { e.target.style.borderColor = "#1a1d26"; e.target.style.color = "#444"; }}>
                      ↓ PDF
                    </button>
                  </div>
                )}
              </div>

              <div style={{ flex: 1, overflowY: "auto" }}>
                {stocks.map(s => {
                  const pnlPct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
                  const isUp = pnlPct >= 0;
                  return (
                    <div key={s.id} className={`stock-row ${displayStock?.id === s.id ? "active" : ""}`}
                      style={{ padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                      onClick={() => { setSelectedId(s.id); setActiveTab("overview"); }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.04em" }}>{s.ticker}</span>
                          {s.priceReal && <span style={{ fontSize: 7, background: "#1a2a1a", color: "#5EC98A", padding: "1px 5px", borderRadius: 2 }}>LIVE</span>}
                          {alerts[s.id] && <span style={{ fontSize: 9 }}>🔔</span>}
                        </div>
                        <div style={{ fontSize: 9, color: "#2a2d35", marginTop: 2 }}>{s.qty} az · acquisto {sym}{fmt(s.buyPrice * rate)}</div>
                      </div>
                      <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 6 }}>
                        <div>
                          <div style={{ fontSize: 12 }}>{sym}{fmt(s.currentPrice * rate)}</div>
                          <div style={{ fontSize: 9, color: isUp ? "#5EC98A" : "#E87040" }}>{isUp ? "▲" : "▼"} {Math.abs(pnlPct).toFixed(1)}%</div>
                        </div>
                        <button className="remove-btn" onClick={e => { e.stopPropagation(); handleRemove(s.id); }}>✕</button>
                      </div>
                    </div>
                  );
                })}
                {stocks.length === 0 && <div style={{ padding: "28px 18px", color: "#2a2d35", fontSize: 12, textAlign: "center" }}>Portafoglio vuoto.</div>}
              </div>

              <div style={{ padding: "10px 18px", borderTop: "1px solid #0f1117", fontSize: 8, color: "#1e2028", lineHeight: 1.7 }}>
                ⚠️ Solo a scopo informativo. Non costituisce consulenza finanziaria ai sensi MiFID II.
              </div>
            </div>

            {/* Main */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>

              {/* OVERVIEW */}
              {activeTab === "overview" && (
                <div className="fade-up">
                  {displayStock ? (() => {
                    const pnlPct = (displayStock.currentPrice - displayStock.buyPrice) / displayStock.buyPrice * 100;
                    const pnlAbs = (displayStock.currentPrice - displayStock.buyPrice) * displayStock.qty * rate;
                    const isUp = pnlPct >= 0;
                    return (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 32, fontWeight: 300, letterSpacing: "-0.02em" }}>{displayStock.ticker}</span>
                              <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 2, background: "#1a1d26", color: "#666", letterSpacing: "0.08em", textTransform: "uppercase" }}>{displayStock.sector}</span>
                              {displayStock.priceReal && <span style={{ fontSize: 8, background: "#1a2a1a", color: "#5EC98A", padding: "2px 7px", borderRadius: 2 }}>LIVE</span>}
                            </div>
                            <div style={{ fontSize: 10, color: "#2a2d35", marginTop: 3 }}>Acquistato il {displayStock.buyDate} · {displayStock.qty} azioni</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 300 }}>{sym}{fmt(displayStock.currentPrice * rate)}</div>
                            <div style={{ fontSize: 12, color: isUp ? "#5EC98A" : "#E87040", marginTop: 2 }}>
                              {isUp ? "+" : ""}{sym}{fmt(Math.abs(pnlAbs))} · {fmtPct(pnlPct)}
                            </div>
                          </div>
                        </div>

                        {/* KPIs */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
                          {[
                            { l: "Prezzo Acquisto",  v: `${sym}${fmt(displayStock.buyPrice * rate)}` },
                            { l: "Valore Posizione", v: `${sym}${fmt(displayStock.qty * displayStock.currentPrice * rate)}` },
                            { l: "Costo Totale",     v: `${sym}${fmt(displayStock.qty * displayStock.buyPrice * rate)}` },
                            { l: "Peso Portafoglio", v: `${((displayStock.qty * displayStock.currentPrice * rate / totalValue) * 100).toFixed(1)}%` },
                          ].map(k => (
                            <div key={k.l} className="card">
                              <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{k.l}</div>
                              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 300 }}>{k.v}</div>
                            </div>
                          ))}
                        </div>

                        {/* Chart with period selector */}
                        <div className="card" style={{ marginBottom: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>Andamento Prezzo</div>
                            <div style={{ display: "flex", gap: 4 }}>
                              {[{l:"1M",v:30},{l:"3M",v:90},{l:"6M",v:180},{l:"1A",v:365}].map(p => (
                                <button key={p.v} onClick={() => setChartPeriod(p.v)}
                                  style={{ background: chartPeriod===p.v?"#F4C542":"none", border:`1px solid ${chartPeriod===p.v?"#F4C542":"#2a2d35"}`, color: chartPeriod===p.v?"#0D0F14":"#555", fontFamily:"inherit", fontSize:9, padding:"3px 8px", borderRadius:3, cursor:"pointer", transition:"all 0.15s" }}>
                                  {p.l}
                                </button>
                              ))}
                            </div>
                          </div>
                          <ProGate feat="history" h={150}>
                            {periodLoading ? (
                              <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#555", fontSize: 11 }}><Spinner /> Caricamento…</div>
                            ) : (
                              <ResponsiveContainer width="100%" height={150}>
                                <AreaChart data={currentHistory}>
                                  <defs>
                                    <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#F4C542" stopOpacity={0.18}/>
                                      <stop offset="95%" stopColor="#F4C542" stopOpacity={0}/>
                                    </linearGradient>
                                  </defs>
                                  <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor(currentHistory.length / 5)}/>
                                  <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={50} tickFormatter={v => `${sym}${v}`}/>
                                  <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={v => [`${sym}${v}`, "Prezzo"]}/>
                                  <ReferenceLine y={displayStock.buyPrice} stroke="#E87040" strokeDasharray="4 3" strokeWidth={1} label={{ value: "Acquisto", fill: "#E87040", fontSize: 8, position: "insideTopRight" }}/>
                                  <Area type="monotone" dataKey="price" stroke="#F4C542" strokeWidth={1.5} fill="url(#sg)" dot={false}/>
                                </AreaChart>
                              </ResponsiveContainer>
                            )}
                          </ProGate>
                        </div>

                        {/* AI */}
                        <div className="card" style={{ marginBottom: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>🤖 Analisi AI</div>
                            <ProGate feat="ai" h={32}>
                              <button onClick={() => handleAI(displayStock)} disabled={aiLoading[displayStock.id]}
                                style={{ background: "none", border: "1px solid #2a2d35", color: "#888", fontFamily: "inherit", fontSize: 10, padding: "5px 12px", borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = "#F4C542"}
                                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2d35"}>
                                {aiLoading[displayStock.id] ? <><Spinner size={9}/> Analisi…</> : "Analizza ora"}
                              </button>
                            </ProGate>
                          </div>
                          {aiText[displayStock.id]
                            ? <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.8 }}>{aiText[displayStock.id]}</div>
                            : <div style={{ fontSize: 11, color: "#2a2d35" }}>Clicca "Analizza ora" per un'analisi AI contestuale del titolo.</div>}
                        </div>

                        {/* Notes */}
                        <div className="card">
                          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>📝 Note personali</div>
                          <textarea rows={3} value={notes[displayStock.id] || ""} onChange={e => setNotes(n => ({ ...n, [displayStock.id]: e.target.value }))}
                            placeholder={`Motivo acquisto, target price, strategia per ${displayStock.ticker}…`} style={{ resize: "vertical", lineHeight: 1.7, fontSize: 12 }}/>
                          {notes[displayStock.id] && <div style={{ fontSize: 8, color: "#2a2d35", marginTop: 4, textAlign: "right" }}>Salvato · {notes[displayStock.id].length} car.</div>}
                        </div>
                      </>
                    );
                  })() : <div style={{ color: "#2a2d35", textAlign: "center", marginTop: 80 }}>Aggiungi un'azione per iniziare.</div>}
                </div>
              )}

              {/* STORICO */}
              {activeTab === "storico" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Storico Portafoglio</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Andamento totale — ultimi 30 giorni</div>
                  </div>
                  <ProGate feat="history" h={220}>
                    <div className="card" style={{ marginBottom: 18 }}>
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={portfolioHistory}>
                          <defs>
                            <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#5B8DEF" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#5B8DEF" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={4}/>
                          <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={60} tickFormatter={v => `${sym}${(v*rate/1000).toFixed(1)}k`}/>
                          <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={v => [`${sym}${fmt(v*rate,0)}`, "Portafoglio"]}/>
                          <Area type="monotone" dataKey="valore" stroke="#5B8DEF" strokeWidth={2} fill="url(#pg)" dot={false}/>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </ProGate>
                  <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>Posizioni</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1a1d26" }}>
                        {["Ticker","Settore","Q.tà","P.Acquisto","P.Attuale","Valore","P&L","P&L%","Data"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "0 8px 8px 0", fontSize: 8, color: "#444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 400 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stocks.map(s => {
                        const pnl = (s.currentPrice - s.buyPrice) * s.qty * rate;
                        const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
                        return (
                          <tr key={s.id} style={{ borderBottom: "1px solid #0f1117" }}>
                            <td style={{ padding: "10px 8px 10px 0", fontWeight: 500 }}>{s.ticker}</td>
                            <td style={{ padding: "10px 8px 10px 0", color: "#555", fontSize: 11 }}>{s.sector}</td>
                            <td style={{ padding: "10px 8px 10px 0", color: "#888" }}>{s.qty}</td>
                            <td style={{ padding: "10px 8px 10px 0", color: "#888" }}>{sym}{fmt(s.buyPrice*rate)}</td>
                            <td style={{ padding: "10px 8px 10px 0" }}>{sym}{fmt(s.currentPrice*rate)}</td>
                            <td style={{ padding: "10px 8px 10px 0" }}>{sym}{fmt(s.qty*s.currentPrice*rate)}</td>
                            <td style={{ padding: "10px 8px 10px 0", color: pnl >= 0 ? "#5EC98A" : "#E87040" }}>{pnl>=0?"+":""}{sym}{fmt(Math.abs(pnl))}</td>
                            <td style={{ padding: "10px 8px 10px 0", color: pct >= 0 ? "#5EC98A" : "#E87040" }}>{fmtPct(pct)}</td>
                            <td style={{ padding: "10px 8px 10px 0", color: "#555", fontSize: 10 }}>{s.buyDate}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* SETTORI */}
              {activeTab === "settori" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Diversificazione</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Distribuzione del capitale per settore</div>
                  </div>
                  <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 28 }}>
                    <PieChart width={220} height={220}>
                      <Pie data={sectorData} cx={105} cy={105} innerRadius={62} outerRadius={100} paddingAngle={3} dataKey="value" strokeWidth={0}>
                        {sectorData.map((_,i) => <Cell key={i} fill={SECTOR_COLORS[i%SECTOR_COLORS.length]}/>)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={v => [`${sym}${fmt(v)}`, ""]}/>
                    </PieChart>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      {sectorData.map((s, i) => {
                        const pct = ((s.value / totalValue) * 100).toFixed(1);
                        return (
                          <div key={s.name} style={{ marginBottom: 13 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <div style={{ width: 7, height: 7, borderRadius: "50%", background: SECTOR_COLORS[i%SECTOR_COLORS.length] }}/>
                                <span style={{ fontSize: 13 }}>{s.name}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "#888" }}>{sym}{fmt(s.value,0)} <span style={{ color: "#555" }}>{pct}%</span></div>
                            </div>
                            <div style={{ background: "#1a1d26", borderRadius: 2, height: 3, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: SECTOR_COLORS[i%SECTOR_COLORS.length], borderRadius: 2, transition: "width 0.6s ease" }}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Benchmark vs S&P 500 (simulato)</div>
                  <ProGate feat="benchmark" h={170}>
                    <div className="card">
                      <ResponsiveContainer width="100%" height={170}>
                        <LineChart data={benchmarkHistory}>
                          <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={6}/>
                          <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={56} tickFormatter={v => `${sym}${(v*rate/1000).toFixed(1)}k`}/>
                          <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }}/>
                          <Legend wrapperStyle={{ fontSize: 10, color: "#555" }}/>
                          <Line type="monotone" dataKey="valore" name="Il tuo portafoglio" stroke="#F4C542" strokeWidth={1.5} dot={false}/>
                          <Line type="monotone" dataKey="benchmark" name="S&P 500 (sim.)" stroke="#5B8DEF" strokeWidth={1.5} dot={false} strokeDasharray="4 3"/>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </ProGate>
                </div>
              )}

              {/* CONFRONTO */}
              {activeTab === "confronto" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Confronto Titoli</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Analisi comparativa tra due posizioni</div>
                  </div>
                  <ProGate feat="comparison" h={300}>
                    <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
                      {[{label:"Titolo A",color:"#F4C542",val:compareA,set:setCompareA},{label:"Titolo B",color:"#5B8DEF",val:compareB,set:setCompareB}].map(({label,color,val,set}) => (
                        <div key={label} style={{ flex:1, minWidth:180 }}>
                          <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{label}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {stocks.map(s => (
                              <button key={s.id} onClick={() => set(s)} style={{ background: val?.id===s.id?color:"#13151c", border:`1px solid ${val?.id===s.id?color:"#2a2d35"}`, color: val?.id===s.id?"#0D0F14":"#888", fontFamily:"inherit", fontSize:12, fontWeight:500, padding:"5px 13px", borderRadius:4, cursor:"pointer", transition:"all 0.15s" }}>{s.ticker}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {compareA && compareB && compareA.id !== compareB.id ? (() => {
                      const rows = [
                        { l:"Prezzo Acquisto", a:`${sym}${fmt(compareA.buyPrice*rate)}`, b:`${sym}${fmt(compareB.buyPrice*rate)}` },
                        { l:"Prezzo Attuale",  a:`${sym}${fmt(compareA.currentPrice*rate)}`, b:`${sym}${fmt(compareB.currentPrice*rate)}` },
                        { l:"Quantità",        a:compareA.qty, b:compareB.qty },
                        { l:"Valore Posizione",a:`${sym}${fmt(compareA.qty*compareA.currentPrice*rate)}`, b:`${sym}${fmt(compareB.qty*compareB.currentPrice*rate)}` },
                        { l:"P&L assoluto", a:`${(compareA.currentPrice-compareA.buyPrice)>=0?"+":""}${sym}${fmt(Math.abs((compareA.currentPrice-compareA.buyPrice)*compareA.qty*rate))}`, b:`${(compareB.currentPrice-compareB.buyPrice)>=0?"+":""}${sym}${fmt(Math.abs((compareB.currentPrice-compareB.buyPrice)*compareB.qty*rate))}`, ac:(compareA.currentPrice-compareA.buyPrice)>=0?"#5EC98A":"#E87040", bc:(compareB.currentPrice-compareB.buyPrice)>=0?"#5EC98A":"#E87040" },
                        { l:"P&L %", a:fmtPct((compareA.currentPrice-compareA.buyPrice)/compareA.buyPrice*100), b:fmtPct((compareB.currentPrice-compareB.buyPrice)/compareB.buyPrice*100), ac:(compareA.currentPrice-compareA.buyPrice)>=0?"#5EC98A":"#E87040", bc:(compareB.currentPrice-compareB.buyPrice)>=0?"#5EC98A":"#E87040" },
                        { l:"Settore", a:compareA.sector, b:compareB.sector },
                        { l:"Note", a:notes[compareA.id]||"—", b:notes[compareB.id]||"—", small:true },
                      ];
                      return (
                        <>
                          <div style={{ display:"grid", gridTemplateColumns:"130px 1fr 1fr", gap:2, marginBottom:2 }}>
                            <div/>
                            {[{t:compareA.ticker,c:"#F4C542"},{t:compareB.ticker,c:"#5B8DEF"}].map(({t,c}) => (
                              <div key={t} style={{ background:"#0f1117", border:`1px solid ${c}22`, borderRadius:"6px 6px 0 0", padding:"8px 14px", textAlign:"center" }}>
                                <span style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:c }}>{t}</span>
                              </div>
                            ))}
                          </div>
                          {rows.map(m => (
                            <div key={m.l} style={{ display:"grid", gridTemplateColumns:"130px 1fr 1fr", gap:2, marginBottom:2 }}>
                              <div style={{ background:"#0f1117", border:"1px solid #1a1d26", padding:"8px 12px", fontSize:8, color:"#555", textTransform:"uppercase", letterSpacing:"0.08em", display:"flex", alignItems:"center" }}>{m.l}</div>
                              {[{v:m.a,c:m.ac},{v:m.b,c:m.bc}].map(({v,c},j) => (
                                <div key={j} style={{ background:"#0f1117", border:"1px solid #1a1d26", padding:"8px 14px", fontSize:m.small?11:12, color:c||"#E8E6DF", display:"flex", alignItems:"center" }}>{v}</div>
                              ))}
                            </div>
                          ))}
                          <div className="card" style={{ marginTop:16 }}>
                            <div style={{ fontSize:8, color:"#444", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:12 }}>Andamento comparato</div>
                            <ResponsiveContainer width="100%" height={180}>
                              <AreaChart>
                                <defs>
                                  <linearGradient id="cA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F4C542" stopOpacity={0.15}/><stop offset="95%" stopColor="#F4C542" stopOpacity={0}/></linearGradient>
                                  <linearGradient id="cB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#5B8DEF" stopOpacity={0.15}/><stop offset="95%" stopColor="#5B8DEF" stopOpacity={0}/></linearGradient>
                                </defs>
                                <XAxis dataKey="date" tick={{fill:"#2a2d35",fontSize:9}} axisLine={false} tickLine={false} interval={6} data={compareA.history}/>
                                <YAxis tick={{fill:"#2a2d35",fontSize:9}} axisLine={false} tickLine={false} domain={["auto","auto"]} width={50} tickFormatter={v=>`${sym}${v}`}/>
                                <Tooltip contentStyle={{background:"#0f1117",border:"1px solid #2a2d35",borderRadius:4,fontSize:11,color:"#E8E6DF"}}/>
                                <Area type="monotone" data={compareA.history} dataKey="price" name={compareA.ticker} stroke="#F4C542" strokeWidth={1.5} fill="url(#cA)" dot={false}/>
                                <Area type="monotone" data={compareB.history} dataKey="price" name={compareB.ticker} stroke="#5B8DEF" strokeWidth={1.5} fill="url(#cB)" dot={false}/>
                              </AreaChart>
                            </ResponsiveContainer>
                            <div style={{ display:"flex", gap:16, justifyContent:"center", marginTop:8 }}>
                              {[{t:compareA.ticker,c:"#F4C542"},{t:compareB.ticker,c:"#5B8DEF"}].map(({t,c}) => (
                                <div key={t} style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#666" }}>
                                  <div style={{ width:16, height:2, background:c, borderRadius:1 }}/> {t}
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })() : <div style={{ color:"#2a2d35", textAlign:"center", marginTop:50, fontSize:13 }}>Seleziona due titoli diversi per confrontarli.</div>}
                  </ProGate>
                </div>
              )}

              {/* ALERT */}
              {activeTab === "alert" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Alert Prezzi</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Notifica quando un titolo supera i tuoi target</div>
                  </div>
                  <ProGate feat="alerts" h={200}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {stocks.map(s => {
                        const a = alerts[s.id] || {};
                        return (
                          <div key={s.id} className="card" style={{ display:"flex", alignItems:"center", gap:18, flexWrap:"wrap" }}>
                            <div style={{ minWidth:80 }}>
                              <div style={{ fontSize:14, fontWeight:500 }}>{s.ticker}</div>
                              <div style={{ fontSize:9, color:"#555", marginTop:2 }}>Attuale: {sym}{fmt(s.currentPrice*rate)}</div>
                            </div>
                            <div style={{ display:"flex", gap:14, flex:1, flexWrap:"wrap", alignItems:"flex-end" }}>
                              <div style={{ flex:1, minWidth:110 }}>
                                <div style={{ fontSize:8, color:"#444", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:5 }}>🔼 Alert sopra</div>
                                <input type="number" placeholder={`${(s.currentPrice*1.1).toFixed(0)}`} value={a.above||""}
                                  onChange={e => setAlerts(al => ({ ...al, [s.id]: { ...(al[s.id]||{}), above: e.target.value ? parseFloat(e.target.value) : null } }))} style={{ width:"100%" }}/>
                              </div>
                              <div style={{ flex:1, minWidth:110 }}>
                                <div style={{ fontSize:8, color:"#444", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:5 }}>🔽 Alert sotto</div>
                                <input type="number" placeholder={`${(s.currentPrice*0.9).toFixed(0)}`} value={a.below||""}
                                  onChange={e => setAlerts(al => ({ ...al, [s.id]: { ...(al[s.id]||{}), below: e.target.value ? parseFloat(e.target.value) : null } }))} style={{ width:"100%" }}/>
                              </div>
                              {(a.above || a.below) && (
                                <button onClick={() => setAlerts(al => { const n={...al}; delete n[s.id]; return n; })}
                                  style={{ background:"none", border:"1px solid #2a2d35", color:"#E87040", fontFamily:"inherit", fontSize:9, padding:"5px 10px", borderRadius:3, cursor:"pointer", whiteSpace:"nowrap" }}>
                                  ✕ Rimuovi
                                </button>
                              )}
                            </div>
                            {(a.above || a.below) && <span style={{ fontSize:9, color:"#5EC98A" }}>🔔 attivo</span>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop:16, padding:"12px 16px", background:"#0a0c10", borderRadius:6, fontSize:9, color:"#2a2d35", lineHeight:1.8 }}>
                      In produzione: notifiche via <strong style={{color:"#333"}}>email</strong> (Resend) e <strong style={{color:"#333"}}>push</strong> (Web Push API) · Alert controllati ogni 60s durante l'orario di borsa
                    </div>
                  </ProGate>
                </div>
              )}

            </div>
          </div>
        </div>
      </CurrencyCtx.Provider>
    </PlanCtx.Provider>
  );
}
