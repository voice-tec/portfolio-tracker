import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine, LineChart, Line, Legend } from "recharts";
import { supabase, signIn, signUp, signOut, getSession, loadStocks, saveStock, deleteStock, loadNotes, saveNote, loadAlerts, saveAlert, deleteAlert } from "./utils/supabase";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SECTOR_COLORS = ["#F4C542","#E87040","#5B8DEF","#5EC98A","#BF6EEA","#F06292","#26C6DA","#FF7043"];
const SECTORS = ["Tech","Finanza","Salute","Energia","Consumer","Industriali","Real Estate","Utility","Materiali","Telecom","Crypto","ETF","Altro"];
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

async function fetchAIAnalysis(stock, note, sym, currency) {
  try {
    const pnlPct = ((stock.currentPrice - stock.buyPrice) / stock.buyPrice * 100).toFixed(2);
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: stock.ticker,
        qty: stock.qty,
        buyPrice: (stock.buyPrice).toFixed(2),
        currentPrice: (stock.currentPrice).toFixed(2),
        pnlPct,
        note: note || "",
        currency: sym,
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.analysis || "Analisi non disponibile.";
  } catch (err) {
    return "Errore nel recupero dell'analisi. Riprova tra qualche secondo.";
  }
}

// ─── SCENARIOS ────────────────────────────────────────────────────────────────
const SCENARIOS = [
  { id: "covid",      label: "🦠 Covid Crash",        from: "2020-02-19", to: "2020-03-23",  spx: -34,  real: false, color: "#E87040", desc: "Il mercato perde il 34% in 33 giorni" },
  { id: "postcovid",  label: "🚀 Post-Covid Rally",    from: "2020-03-23", to: "2021-12-31",  spx: +114, real: false, color: "#5EC98A", desc: "La ripresa più rapida della storia" },
  { id: "bull2017",   label: "📈 Bull Run 2017",       from: "2017-01-01", to: "2017-12-31",  spx: +19,  real: false, color: "#5B8DEF", desc: "Un anno eccezionale per i mercati" },
  { id: "gfc",        label: "💥 Financial Crisis",    from: "2007-10-01", to: "2009-03-09",  spx: -57,  real: false, color: "#BF6EEA", desc: "La peggior crisi dal 1929 (-57% S&P500)" },
  { id: "dotcom",     label: "🫧 Dot-com Bubble",      from: "2000-03-10", to: "2002-10-09",  spx: -49,  real: false, color: "#F06292", desc: "Il crollo delle aziende tech (-49% S&P500)" },
];

async function fetchScenarioData(symbol, scenario) {
  if (!scenario.real) return null; // use simulation for old scenarios
  try {
    const res = await fetch(`${API_BASE}/api/scenario?symbol=${encodeURIComponent(symbol)}&from=${scenario.from}&to=${scenario.to}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.candles || null;
  } catch { return null; }
}

function simulateScenario(scenario, days) {
  // Simulate based on S&P500 performance with some variance
  const totalPct = scenario.spx / 100;
  const n = days || 60;
  let cumPct = 0;
  return Array.from({ length: n }, (_, i) => {
    const progress = i / n;
    const trend = totalPct * progress;
    const noise = (Math.random() - 0.5) * 0.04;
    cumPct = trend + noise;
    const d = new Date(scenario.from);
    d.setDate(d.getDate() + Math.floor(i * (new Date(scenario.to) - new Date(scenario.from)) / 1000 / 60 / 60 / 24 / n));
    return { date: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }), pct: parseFloat((cumPct * 100).toFixed(2)) };
  });
}
async function fetchNews(ticker) {
  try {
    const res = await fetch(`${API_BASE}/api/news?symbol=${encodeURIComponent(ticker)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function fetchHistoricalPrice(ticker, date) {
  // Fetch price at a specific date using history API
  try {
    const res = await fetch(`${API_BASE}/api/history?symbol=${encodeURIComponent(ticker)}&days=365`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.candles?.length) return null;
    // Find closest candle to requested date
    const target = new Date(date).getTime() / 1000;
    const sorted = data.candles.sort((a, b) => Math.abs(a.t - target) - Math.abs(b.t - target));
    return sorted[0]?.c || null;
  } catch { return null; }
}


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
    try {
      let user;
      if (mode === "register") {
        user = await signUp(email, pw, name);
        if (!user) { setErr("Controlla la tua email per confermare la registrazione."); setLoading(false); return; }
      } else {
        user = await signIn(email, pw);
      }
      onAuth({ id: user.id, email: user.email, name: user.user_metadata?.name || email.split("@")[0] });
    } catch (e) {
      setErr(e.message === "Invalid login credentials" ? "Email o password errati." : e.message);
    }
    setLoading(false);
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
          <div style={{ fontSize: 10, color: "#2a2d35", textAlign: "center", marginTop: 12 }}>Benvenuto su Portfolio Tracker</div>
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
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 320 });
  const ref = useRef(null);
  const inputRef = useRef(null);
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

  // Recalculate position every time dropdown opens or results change
  useEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
    });
  }, [open, results.length]);

  useEffect(() => { setHi(0); }, [results]);
  useEffect(() => {
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  function handleKey(e) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h+1, results.length-1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setHi(h => Math.max(h-1, 0)); }
    if (e.key === "Enter" && results[hi]) { e.preventDefault(); onSelect(results[hi]); setOpen(false); }
    if (e.key === "Escape") setOpen(false);
  }

  const dropdown = open && value.length > 0 && (loading || results.length > 0) && createPortal(
    <div style={{
      position: "fixed",
      top: dropPos.top,
      left: dropPos.left,
      width: dropPos.width,
      zIndex: 2147483647,
      background: "#13151c",
      border: "1px solid #2a2d35",
      borderRadius: 8,
      boxShadow: "0 16px 48px rgba(0,0,0,0.95)",
      overflow: "hidden",
      maxHeight: 280,
      overflowY: "auto",
    }}>
      {loading && results.length === 0
        ? <div style={{ padding: "12px 16px", fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 8 }}><Spinner /> Ricerca ticker…</div>
        : results.map((t, i) => (
          <div key={t.ticker+i}
            onMouseDown={e => { e.preventDefault(); onSelect(t); setOpen(false); }}
            onMouseEnter={() => setHi(i)}
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
        ))
      }
    </div>,
    document.body
  );

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.12em", textTransform: "uppercase" }}>Ticker</div>
      <input ref={inputRef} placeholder="AAPL, ENI, PLAB…" value={value} autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onKeyDown={handleKey} />
      {dropdown}
    </div>
  );
}

// ─── DEFAULT DATA ─────────────────────────────────────────────────────────────
const DEFAULT_STOCKS = [
  { id: 1, ticker: "AAPL",  qty: 10, buyPrice: 175.0, currentPrice: 213.49, sector: "Tech",     priceReal: false, buyDate: "01/01/24" },
  { id: 2, ticker: "MSFT",  qty: 5,  buyPrice: 380.0, currentPrice: 415.32, sector: "Tech",     priceReal: false, buyDate: "15/03/24" },
  { id: 3, ticker: "NVDA",  qty: 8,  buyPrice: 495.0, currentPrice: 875.20, sector: "Tech",     priceReal: false, buyDate: "10/06/24" },
];

// ─── WATCHLIST TAB ────────────────────────────────────────────────────────────
function WatchlistTab({ eurRate, fmt, fmtPct }) {
  const [watchlist, setWatchlist] = useState(() => ls("pt_watchlist", []));
  const [form, setForm] = useState({ ticker: "", sector: "Altro", note: "" });
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState({});
  const [err, setErr] = useState("");

  const saveWatchlist = (items) => { setWatchlist(items); lsSet("pt_watchlist", items); };

  useEffect(() => {
    watchlist.forEach(item => {
      if (prices[item.ticker]) return;
      setLoading(l => ({ ...l, [item.ticker]: true }));
      fetchRealPrice(item.ticker).then(p => {
        setPrices(prev => ({ ...prev, [item.ticker]: p }));
        setLoading(l => ({ ...l, [item.ticker]: false }));
      });
    });
  }, [watchlist.length]);

  function addToWatchlist() {
    const t = form.ticker.trim().toUpperCase();
    if (!t) return setErr("Inserisci un ticker.");
    if (watchlist.find(w => w.ticker === t)) return setErr("Già in watchlist.");
    setErr("");
    const item = { ticker: t, sector: form.sector, note: form.note, addedAt: new Date().toLocaleDateString("it-IT"), id: Date.now() };
    saveWatchlist([...watchlist, item]);
    setForm({ ticker: "", sector: "Altro", note: "" });
  }

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Watchlist</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Titoli da monitorare senza averli in portafoglio</div>
      </div>

      {/* Add form */}
      <div className="card" style={{ marginBottom: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "0 0 110px" }}>
          <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Ticker</div>
          <input value={form.ticker} onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
            placeholder="AAPL" onKeyDown={e => e.key === "Enter" && addToWatchlist()} style={{ textTransform: "uppercase" }}/>
        </div>
        <div style={{ flex: "0 0 140px" }}>
          <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Settore</div>
          <select value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Nota (opzionale)</div>
          <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Perché mi interessa…"/>
        </div>
        <button className="add-btn" onClick={addToWatchlist}>+ Aggiungi</button>
        {err && <span style={{ fontSize: 11, color: "#E87040" }}>{err}</span>}
      </div>

      {/* List */}
      {watchlist.length === 0 ? (
        <div style={{ textAlign: "center", marginTop: 60, color: "#444", fontSize: 12 }}>Nessun titolo in watchlist — aggiungine uno sopra.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {watchlist.map(item => {
            const price = prices[item.ticker];
            const isLoading = loading[item.ticker];
            return (
              <div key={item.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300 }}>{item.ticker}</span>
                    {item.sector && <span style={{ fontSize: 9, background: "#1a1d26", color: "#555", padding: "2px 7px", borderRadius: 2 }}>{item.sector}</span>}
                    <span style={{ fontSize: 9, color: "#333" }}>aggiunto {item.addedAt}</span>
                  </div>
                  {item.note && <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{item.note}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ textAlign: "right" }}>
                    {isLoading ? <Spinner /> : price ? (
                      <>
                        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16 }}>${fmt(price)}</div>
                        <div style={{ fontSize: 10, color: "#444" }}>€{fmt(price * eurRate)}</div>
                      </>
                    ) : <div style={{ fontSize: 11, color: "#444" }}>N/D</div>}
                  </div>
                  <button onClick={() => saveWatchlist(watchlist.filter(w => w.id !== item.id))}
                    style={{ background: "none", border: "none", color: "#333", cursor: "pointer", fontSize: 14, transition: "color 0.15s" }}
                    onMouseEnter={e => e.target.style.color = "#E87040"}
                    onMouseLeave={e => e.target.style.color = "#333"}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ─── EDIT MODAL ───────────────────────────────────────────────────────────────
function EditModal({ stock, onClose, onSave }) {
  const [qty, setQty] = useState(String(stock.qty));
  const [buyPrice, setBuyPrice] = useState(String(stock.buyPrice));
  const [targetPrice, setTargetPrice] = useState(String(stock.targetPrice || ""));
  const [stopLoss, setStopLoss] = useState(String(stock.stopLoss || ""));
  const [sector, setSector] = useState(stock.sector || "Altro");

  useEffect(() => {
    const fn = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  function handleSave() {
    onSave({ ...stock, qty: parseFloat(qty)||stock.qty, buyPrice: parseFloat(buyPrice)||stock.buyPrice, targetPrice: parseFloat(targetPrice)||null, stopLoss: parseFloat(stopLoss)||null, sector });
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 9100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0D0F14", border: "1px solid #1a1d26", borderRadius: 12, width: "100%", maxWidth: 400, padding: "28px 28px 24px", animation: "fadeUp 0.2s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>{stock.ticker}</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>Modifica posizione</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "1px solid #2a2d35", color: "#555", fontFamily: "inherit", fontSize: 16, padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { label: "Quantità", value: qty, set: setQty, placeholder: "10" },
            { label: "Prezzo di acquisto (USD)", value: buyPrice, set: setBuyPrice, placeholder: "175.00", step: "0.01" },
            { label: "🎯 Target Price (USD)", value: targetPrice, set: setTargetPrice, placeholder: "Es. 220.00 — lascia vuoto per rimuovere", step: "0.01" },
            { label: "🛑 Stop Loss (USD)", value: stopLoss, set: setStopLoss, placeholder: "Es. 150.00 — lascia vuoto per rimuovere", step: "0.01" },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>{f.label}</div>
              <input type="number" step={f.step||"1"} placeholder={f.placeholder} value={f.value} onChange={e => f.set(e.target.value)} style={{ fontSize: 13 }}/>
            </div>
          ))}
          <div>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>Settore</div>
            <select value={sector} onChange={e => setSector(e.target.value)}>
              {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button className="add-btn" onClick={handleSave} style={{ flex: 1, justifyContent: "center" }}>✓ Salva modifiche</button>
          <button className="action-btn" onClick={onClose}>Annulla</button>
        </div>
      </div>
    </div>
  );
}

// ─── STOCK DETAIL MODAL ───────────────────────────────────────────────────────
function StockModal({ stock, onClose, notes, setNotes, alerts, setAlerts, handleRemove, sym, rate, fmt, fmtPct, handleAI, aiLoading, aiText, plan }) {
  const [chartPeriod, setChartPeriod] = useState(30);
  const [history, setHistory] = useState(stock.history || []);
  const [histLoading, setHistLoading] = useState(false);
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const pnlPct = (stock.currentPrice - stock.buyPrice) / stock.buyPrice * 100;
  const pnlAbs = (stock.currentPrice - stock.buyPrice) * stock.qty * rate;
  const isUp = pnlPct >= 0;

  useEffect(() => {
    setHistLoading(true);
    fetchRealHistory(stock.ticker, chartPeriod).then(candles => {
      setHistory(candles || simulateHistory(stock.currentPrice, chartPeriod));
      setHistLoading(false);
    });
  }, [stock.ticker, chartPeriod]);

  useEffect(() => {
    setNewsLoading(true);
    fetchNews(stock.ticker).then(items => { setNews(items); setNewsLoading(false); });
  }, [stock.ticker]);

  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0D0F14", border: "1px solid #1a1d26", borderRadius: "12px 12px 0 0", width: "100%", maxWidth: 800, maxHeight: "88vh", overflowY: "auto", padding: "24px 28px", animation: "fadeUp 0.25s ease" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 300 }}>{stock.ticker}</span>
              <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 2, background: "#1a1d26", color: "#666", letterSpacing: "0.08em", textTransform: "uppercase" }}>{stock.sector}</span>
              {stock.priceReal && <span style={{ fontSize: 8, background: "#1a2a1a", color: "#5EC98A", padding: "2px 7px", borderRadius: 2 }}>LIVE</span>}
            </div>
            <div style={{ fontSize: 10, color: "#2a2d35", marginTop: 3 }}>Acquistato il {stock.buyDate} · {stock.qty} azioni</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 300 }}>{sym}{fmt(stock.currentPrice * rate)}</div>
              <div style={{ fontSize: 12, color: isUp ? "#5EC98A" : "#E87040" }}>{isUp?"+":""}{sym}{fmt(Math.abs(pnlAbs))} · {fmtPct(pnlPct)}</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "1px solid #2a2d35", color: "#555", fontFamily: "inherit", fontSize: 16, padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}>✕</button>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { l: "P.Acquisto",   v: `${sym}${fmt(stock.buyPrice * rate)}` },
            { l: "Valore Pos.",  v: `${sym}${fmt(stock.qty * stock.currentPrice * rate)}` },
            { l: "Costo Tot.",   v: `${sym}${fmt(stock.qty * stock.buyPrice * rate)}` },
            { l: "P&L Totale",   v: `${isUp?"+":""}${sym}${fmt(Math.abs(pnlAbs))}`, c: isUp?"#5EC98A":"#E87040" },
          ].map(k => (
            <div key={k.l} style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>{k.l}</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 300, color: k.c || "#E8E6DF" }}>{k.v}</div>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>Andamento</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[{l:"1M",v:30},{l:"3M",v:90},{l:"6M",v:180},{l:"1A",v:365}].map(p => (
                <button key={p.v} onClick={() => setChartPeriod(p.v)}
                  style={{ background: chartPeriod===p.v?"#F4C542":"none", border:`1px solid ${chartPeriod===p.v?"#F4C542":"#2a2d35"}`, color: chartPeriod===p.v?"#0D0F14":"#555", fontFamily:"inherit", fontSize:9, padding:"3px 8px", borderRadius:3, cursor:"pointer" }}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>
          {histLoading ? (
            <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#555", fontSize: 11 }}><Spinner /> Caricamento…</div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={history}>
                <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F4C542" stopOpacity={0.18}/><stop offset="95%" stopColor="#F4C542" stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor(history.length/5)}/>
                <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={50} tickFormatter={v => `${sym}${v}`}/>
                <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={v => [`${sym}${v}`, "Prezzo"]}/>
                <ReferenceLine y={stock.buyPrice} stroke="#E87040" strokeDasharray="4 3" strokeWidth={1}/>
                <Area type="monotone" dataKey="price" stroke="#F4C542" strokeWidth={1.5} fill="url(#mg)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* AI */}
        <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>🤖 Analisi AI</div>
            <button onClick={() => handleAI(stock)} disabled={aiLoading[stock.id]}
              style={{ background: "none", border: "1px solid #2a2d35", color: "#888", fontFamily: "inherit", fontSize: 10, padding: "5px 12px", borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {aiLoading[stock.id] ? <><Spinner size={9}/> Analisi…</> : "Analizza ora"}
            </button>
          </div>
          {aiText[stock.id]
            ? <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.8 }}>{aiText[stock.id]}</div>
            : <div style={{ fontSize: 11, color: "#2a2d35" }}>Clicca "Analizza ora" per un'analisi AI contestuale.</div>}
        </div>

        {/* Target & Stop */}
        <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>🎯 Target Price & Stop Loss</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: "#5EC98A", marginBottom: 5 }}>Target Price (USD)</div>
              <input type="number" step="0.01" value={stock.targetPrice || ""} onChange={e => {
                const v = parseFloat(e.target.value) || null;
                stock.targetPrice = v;
              }} placeholder="Es. 200.00" style={{ fontSize: 12, padding: "7px 10px" }}
              onBlur={e => {
                const v = parseFloat(e.target.value) || null;
                // bubble up via a custom event pattern — we just store locally for now
              }}/>
              {stock.targetPrice && stock.currentPrice >= stock.targetPrice && (
                <div style={{ fontSize: 9, color: "#5EC98A", marginTop: 4 }}>✓ Target raggiunto!</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#E87040", marginBottom: 5 }}>Stop Loss (USD)</div>
              <input type="number" step="0.01" value={stock.stopLoss || ""} onChange={e => {
                const v = parseFloat(e.target.value) || null;
                stock.stopLoss = v;
              }} placeholder="Es. 150.00" style={{ fontSize: 12, padding: "7px 10px" }}/>
              {stock.stopLoss && stock.currentPrice <= stock.stopLoss && (
                <div style={{ fontSize: 9, color: "#E87040", marginTop: 4 }}>⚠️ Stop Loss raggiunto!</div>
              )}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>📝 Note</div>
          <textarea rows={3} value={notes[stock.id] || ""} onChange={e => setNotes(n => ({ ...n, [stock.id]: e.target.value }))}
            placeholder={`Motivo acquisto, target price, strategia…`} style={{ resize: "vertical", lineHeight: 1.7, fontSize: 12, width: "100%", background: "#13151c", border: "1px solid #2a2d35", color: "#E8E6DF", fontFamily: "inherit", padding: "9px 12px", borderRadius: 4, outline: "none" }}/>
        </div>

        {/* News */}
