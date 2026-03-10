import { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from "react";
import { createPortal } from "react-dom";
import { PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine, LineChart, Line, Legend, BarChart, Bar } from "recharts";
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

async function fetchRealPrice(ticker, full = false) {
  const key = ticker.toUpperCase();
  const cached = priceCache[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return full ? cached : cached.price;
  try {
    const res = await fetch(`${API_BASE}/api/price?symbol=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.price) return null;
    const marketState = data.marketState || "CLOSED";
    let effectivePrice = data.price;
    if (marketState === "PRE" && data.preMarket?.price) effectivePrice = data.preMarket.price;
    else if (marketState === "POST" && data.afterHours?.price) effectivePrice = data.afterHours.price;
    const result = { price: effectivePrice, regularPrice: data.price, marketState, preMarket: data.preMarket, afterHours: data.afterHours, ts: Date.now() };
    priceCache[key] = result;
    return full ? result : effectivePrice;
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
  { id: "covid",      label: "🦠 Covid Crash",        from: "2020-02-19", to: "2020-03-23",  spx: -34,  real: true, color: "#E87040", desc: "Il mercato perde il 34% in 33 giorni" },
  { id: "postcovid",  label: "🚀 Post-Covid Rally",    from: "2020-03-23", to: "2021-12-31",  spx: +114, real: true, color: "#5EC98A", desc: "La ripresa più rapida della storia" },
  { id: "bull2017",   label: "📈 Bull Run 2017",       from: "2017-01-01", to: "2017-12-31",  spx: +19,  real: true, color: "#5B8DEF", desc: "Un anno eccezionale per i mercati" },
  { id: "gfc",        label: "💥 Financial Crisis",    from: "2007-10-01", to: "2009-03-09",  spx: -57,  real: true, color: "#BF6EEA", desc: "La peggior crisi dal 1929 (-57% S&P500)" },
  { id: "dotcom",     label: "🫧 Dot-com Bubble",      from: "2000-03-10", to: "2002-10-09",  spx: -49,  real: true, color: "#F06292", desc: "Il crollo delle aziende tech (-49% S&P500)" },
];

// ─── MACRO SCENARIOS ──────────────────────────────────────────────────────────
const MACRO_SCENARIOS = [
  {
    id: "high_inflation", label: "📈 Alta Inflazione", color: "#E87040",
    desc: "Inflazione >5% come 2021-2022. Energia e commodities salgono, tech e bond scendono.",
    impact: { "Tech": -0.25, "Finanza": +0.08, "Energia": +0.45, "Materiali": +0.30, "Salute": -0.05, "Consumer": -0.15, "Industriali": +0.10, "Utility": -0.12, "Real Estate": -0.20, "Telecom": -0.08, "ETF": -0.10 },
    spxImpact: -0.12, duration: "12-18 mesi",
    topPicks: [
      { ticker: "XLE",   name: "Energy ETF",       reason: "Energia sale con l'inflazione",   perf: 42 },
      { ticker: "GLD",   name: "Gold ETF",          reason: "Oro come hedge inflazione",       perf: 18 },
      { ticker: "TIPS",  name: "Inflation Bonds",   reason: "Bond indicizzati all'inflazione", perf: 8  },
      { ticker: "BRK.B", name: "Berkshire",          reason: "Aziende con pricing power",       perf: 14 },
      { ticker: "CVX",   name: "Chevron",            reason: "Petrolio beneficia inflazione",   perf: 55 },
    ],
    worstPicks: [
      { ticker: "QQQ", name: "Nasdaq ETF", reason: "Tech colpito da tassi alti", perf: -28 },
      { ticker: "TLT", name: "Long Bonds", reason: "Bond lunghi crollano",       perf: -35 },
    ],
    chartData: [
      { m: "M1",  energy: 4,  tech: -3,  gold: 2  },
      { m: "M3",  energy: 12, tech: -8,  gold: 5  },
      { m: "M6",  energy: 22, tech: -15, gold: 9  },
      { m: "M9",  energy: 33, tech: -20, gold: 13 },
      { m: "M12", energy: 42, tech: -25, gold: 18 },
    ],
    lineKeys: [{ k: "energy", l: "Energia", c: "#E87040" }, { k: "tech", l: "Tech", c: "#5B8DEF" }, { k: "gold", l: "Oro", c: "#F4C542" }],
  },
  {
    id: "low_inflation", label: "📉 Bassa Inflazione", color: "#5B8DEF",
    desc: "Inflazione <2% con crescita stabile. Tech e bond in rally.",
    impact: { "Tech": +0.25, "Finanza": +0.05, "Energia": -0.10, "Materiali": -0.08, "Salute": +0.12, "Consumer": +0.15, "Industriali": +0.08, "Utility": +0.15, "Real Estate": +0.20, "Telecom": +0.10, "ETF": +0.12 },
    spxImpact: +0.18, duration: "12-24 mesi",
    topPicks: [
      { ticker: "QQQ",  name: "Nasdaq ETF",      reason: "Tech cresce con tassi bassi",       perf: 28 },
      { ticker: "TLT",  name: "Long Bonds",      reason: "Bond lunghi in rally",              perf: 22 },
      { ticker: "VNQ",  name: "Real Estate ETF", reason: "REIT beneficiano da tassi bassi",   perf: 18 },
      { ticker: "MSFT", name: "Microsoft",       reason: "Big tech, cash flow prevedibile",   perf: 32 },
      { ticker: "AAPL", name: "Apple",           reason: "Valuation espande con tassi bassi", perf: 25 },
    ],
    worstPicks: [
      { ticker: "XLE", name: "Energy ETF", reason: "Energia soffre con deflazione",      perf: -12 },
      { ticker: "GLD", name: "Gold ETF",   reason: "Oro perde appeal senza inflazione",  perf: -8  },
    ],
    chartData: [
      { m: "M1",  tech: 3,  bonds: 2,  realestate: 1  },
      { m: "M3",  tech: 9,  bonds: 6,  realestate: 4  },
      { m: "M6",  tech: 16, bonds: 12, realestate: 9  },
      { m: "M9",  tech: 22, bonds: 17, realestate: 13 },
      { m: "M12", tech: 28, bonds: 22, realestate: 18 },
    ],
    lineKeys: [{ k: "tech", l: "Tech", c: "#5B8DEF" }, { k: "bonds", l: "Bond", c: "#5EC98A" }, { k: "realestate", l: "Real Estate", c: "#BF6EEA" }],
  },
  {
    id: "high_rates", label: "🏦 Tassi Alti", color: "#BF6EEA",
    desc: "Fed Funds Rate >4% come 2022-2023. Banche e valore outperformano.",
    impact: { "Tech": -0.30, "Finanza": +0.15, "Energia": +0.05, "Materiali": -0.05, "Salute": +0.05, "Consumer": -0.12, "Industriali": -0.08, "Utility": -0.20, "Real Estate": -0.25, "Telecom": -0.10, "ETF": -0.08 },
    spxImpact: -0.15, duration: "12-24 mesi",
    topPicks: [
      { ticker: "XLF",  name: "Financial ETF", reason: "Banche guadagnano con tassi alti",  perf: 18 },
      { ticker: "BRK.B",name: "Berkshire",      reason: "Float assicurativo rende di più",   perf: 20 },
      { ticker: "JPM",  name: "JPMorgan",       reason: "Margini netti in espansione",       perf: 22 },
      { ticker: "SHY",  name: "Short Bonds",    reason: "Bond corti rendono senza rischio",  perf: 5  },
      { ticker: "BIL",  name: "T-Bill ETF",     reason: "Liquidità al 5%+ senza rischio",   perf: 5  },
    ],
    worstPicks: [
      { ticker: "VNQ",  name: "Real Estate ETF", reason: "REIT crollano con tassi alti",    perf: -25 },
      { ticker: "ARKK", name: "ARK Innovation",  reason: "Growth non profittevole affonda",  perf: -60 },
    ],
    chartData: [
      { m: "M1",  banche: 2,  realestate: -3,  tech: -4  },
      { m: "M3",  banche: 6,  realestate: -9,  tech: -12 },
      { m: "M6",  banche: 10, realestate: -16, tech: -20 },
      { m: "M9",  banche: 14, realestate: -21, tech: -26 },
      { m: "M12", banche: 18, realestate: -25, tech: -30 },
    ],
    lineKeys: [{ k: "banche", l: "Banche", c: "#5EC98A" }, { k: "realestate", l: "Real Estate", c: "#E87040" }, { k: "tech", l: "Tech", c: "#5B8DEF" }],
  },
  {
    id: "low_rates", label: "💸 Tassi Bassi", color: "#5EC98A",
    desc: "Fed Funds Rate <1% come 2009-2015 e 2020-2021. Risk-on, growth e credito salgono.",
    impact: { "Tech": +0.35, "Finanza": -0.05, "Energia": +0.10, "Materiali": +0.12, "Salute": +0.10, "Consumer": +0.20, "Industriali": +0.15, "Utility": +0.10, "Real Estate": +0.30, "Telecom": +0.12, "ETF": +0.18 },
    spxImpact: +0.25, duration: "24-36 mesi",
    topPicks: [
      { ticker: "ARKK", name: "ARK Innovation",  reason: "Growth esplode con tassi zero",   perf: 150 },
      { ticker: "VNQ",  name: "Real Estate ETF", reason: "REIT in forte rally",             perf: 35  },
      { ticker: "HYG",  name: "High Yield Bonds",reason: "Credito ad alto rendimento sale", perf: 20  },
      { ticker: "TSLA", name: "Tesla",            reason: "Growth stocks beneficiano",       perf: 200 },
      { ticker: "SPY",  name: "S&P 500",          reason: "Mercato broad in rally",          perf: 80  },
    ],
    worstPicks: [
      { ticker: "XLF", name: "Financial ETF", reason: "Banche soffre con margini compressi", perf: -5 },
      { ticker: "BIL", name: "T-Bill ETF",    reason: "Cash non rende nulla",                perf: 0  },
    ],
    chartData: [
      { m: "M1",  growth: 5,   realestate: 3,  spx: 3  },
      { m: "M3",  growth: 18,  realestate: 9,  spx: 8  },
      { m: "M6",  growth: 40,  realestate: 18, spx: 15 },
      { m: "M9",  growth: 80,  realestate: 27, spx: 22 },
      { m: "M12", growth: 120, realestate: 35, spx: 28 },
    ],
    lineKeys: [{ k: "growth", l: "Growth", c: "#26C6DA" }, { k: "realestate", l: "Real Estate", c: "#BF6EEA" }, { k: "spx", l: "S&P 500", c: "#888" }],
  },
  {
    id: "recession", label: "📊 Recessione", color: "#F4C542",
    desc: "GDP negativo per 2+ trimestri. Difensivi, oro e bond governativi come rifugio.",
    impact: { "Tech": -0.20, "Finanza": -0.30, "Energia": -0.25, "Materiali": -0.28, "Salute": +0.05, "Consumer": -0.15, "Industriali": -0.22, "Utility": +0.02, "Real Estate": -0.18, "Telecom": +0.02, "ETF": -0.18 },
    spxImpact: -0.30, duration: "6-18 mesi",
    topPicks: [
      { ticker: "GLD", name: "Gold ETF",          reason: "Oro come rifugio sicuro",           perf: 25 },
      { ticker: "TLT", name: "Long Gov Bonds",    reason: "Treasury salgono in recessione",    perf: 30 },
      { ticker: "XLV", name: "Healthcare ETF",    reason: "Salute è difensiva per natura",     perf: 5  },
      { ticker: "XLP", name: "Staples ETF",       reason: "Beni di prima necessità resistono", perf: 3  },
      { ticker: "JNJ", name: "Johnson & Johnson", reason: "Difensivo con dividendo stabile",   perf: 8  },
    ],
    worstPicks: [
      { ticker: "XLF", name: "Financial ETF", reason: "Banche colpite da NPL",      perf: -35 },
      { ticker: "XLB", name: "Materials ETF", reason: "Domanda industriale crolla",  perf: -30 },
    ],
    chartData: [
      { m: "M1",  gold: 3,  bonds: 5,  spx: -5  },
      { m: "M3",  gold: 9,  bonds: 14, spx: -14 },
      { m: "M6",  gold: 16, bonds: 22, spx: -22 },
      { m: "M9",  gold: 21, bonds: 27, spx: -28 },
      { m: "M12", gold: 25, bonds: 30, spx: -30 },
    ],
    lineKeys: [{ k: "gold", l: "Oro", c: "#F4C542" }, { k: "bonds", l: "Gov Bond", c: "#5B8DEF" }, { k: "spx", l: "S&P 500", c: "#E87040" }],
  },
  {
    id: "boom", label: "🚀 Boom Economico", color: "#26C6DA",
    desc: "Crescita GDP >3%, piena occupazione. Ciclici, tech e small cap esplodono.",
    impact: { "Tech": +0.30, "Finanza": +0.20, "Energia": +0.25, "Materiali": +0.35, "Salute": +0.08, "Consumer": +0.28, "Industriali": +0.32, "Utility": -0.05, "Real Estate": +0.15, "Telecom": +0.18, "ETF": +0.22 },
    spxImpact: +0.28, duration: "12-36 mesi",
    topPicks: [
      { ticker: "IWM",  name: "Russell 2000",     reason: "Small cap salgono in boom",        perf: 35 },
      { ticker: "XLI",  name: "Industrials ETF",  reason: "Industriali in forte crescita",    perf: 30 },
      { ticker: "XLB",  name: "Materials ETF",    reason: "Commodities in domanda",           perf: 28 },
      { ticker: "XLY",  name: "Consumer Disc.",   reason: "Consumi discrezionali esplodono",  perf: 32 },
      { ticker: "NVDA", name: "Nvidia",           reason: "Tech ciclico con boom AI+capex",   perf: 80 },
    ],
    worstPicks: [
      { ticker: "TLT", name: "Long Bonds", reason: "Bond venduti per risk-on",    perf: -15 },
      { ticker: "GLD", name: "Gold ETF",   reason: "Oro perde appeal in risk-on", perf: -5  },
    ],
    chartData: [
      { m: "M1",  smallcap: 4,  industriali: 3,  spx: 3  },
      { m: "M3",  smallcap: 12, industriali: 9,  spx: 8  },
      { m: "M6",  smallcap: 22, industriali: 18, spx: 15 },
      { m: "M9",  smallcap: 29, industriali: 24, spx: 20 },
      { m: "M12", smallcap: 35, industriali: 30, spx: 28 },
    ],
    lineKeys: [{ k: "smallcap", l: "Small Cap", c: "#26C6DA" }, { k: "industriali", l: "Industriali", c: "#5EC98A" }, { k: "spx", l: "S&P 500", c: "#888" }],
  },
];

async function fetchScenarioData(symbol, scenario) {
  try {
    const res = await fetch(`${API_BASE}/api/scenario?symbol=${encodeURIComponent(symbol)}&from=${scenario.from}&to=${scenario.to}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data; // returns { candles, spy, source }
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
        <TickerAutocomplete value={form.ticker} onChange={v => setForm(f => ({ ...f, ticker: v }))} onSelect={t => setForm(f => ({ ...f, ticker: t.ticker, sector: t.sector || "Altro" }))} />
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
// ─── MARKET BADGE ─────────────────────────────────────────────────────────────
function MarketBadge({ state = "CLOSED", size = 8, ml = 0 }) {
  const cfg = {
    PRE:     { label: "PRE",   bg: "#1a1f2a", color: "#7EB8F7" },
    REGULAR: { label: "LIVE",  bg: "#1a2a1a", color: "#5EC98A" },
    POST:    { label: "AFTER", bg: "#2a1f0a", color: "#F4C542" },
    CLOSED:  { label: "CHIUS", bg: "#2a1a1a", color: "#E87040" },
  };
  const c = cfg[state] || cfg.CLOSED;
  return <span style={{ fontSize: size, background: c.bg, color: c.color, padding: "2px 6px", borderRadius: 2, marginLeft: ml }}>{c.label}</span>;
}

// ─── TRADINGVIEW WIDGET ───────────────────────────────────────────────────────
function TradingViewWidget({ ticker }) {
  const [show, setShow] = useState(false);
  const containerId = `tv_${ticker}`;

  // Converti ticker italiano: ENI.MI → MIL:ENI
  function toTVSymbol(t) {
    if (t.endsWith(".MI")) return `MIL:${t.replace(".MI", "")}`;
    if (t.endsWith(".L"))  return `LSE:${t.replace(".L", "")}`;
    if (t.endsWith(".PA")) return `EURONEXT:${t.replace(".PA", "")}`;
    if (t.endsWith(".DE")) return `XETR:${t.replace(".DE", "")}`;
    return t; // US ticker — nessun prefisso necessario
  }

  useEffect(() => {
    if (!show) return;
    const existing = document.getElementById(containerId);
    if (existing) existing.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      if (window.TradingView) {
        new window.TradingView.widget({
          container_id: containerId,
          symbol: toTVSymbol(ticker),
          interval: "D",
          theme: "dark",
          style: "1",
          locale: "it",
          toolbar_bg: "#0D0F14",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          height: 420,
          width: "100%",
        });
      }
    };
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch(_) {} };
  }, [show, ticker]);

  return (
    <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, marginBottom: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", cursor: "pointer" }} onClick={() => setShow(v => !v)}>
        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>📈 Grafico TradingView</div>
        <span style={{ fontSize: 10, color: "#555" }}>{show ? "▲ Chiudi" : "▼ Apri"}</span>
      </div>
      {show && <div id={containerId} style={{ width: "100%", height: 420 }} />}
    </div>
  );
}

function StockModal({ stock, onClose, notes, setNotes, alerts, setAlerts, handleRemove, sym, rate, fmt, fmtPct, handleAI, aiLoading, aiText, plan, onSaveTargets }) {
  const [chartPeriod, setChartPeriod] = useState(30);
  const [history, setHistory] = useState(stock.history || []);
  const [histLoading, setHistLoading] = useState(false);
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [localTarget, setLocalTarget] = useState(String(stock.targetPrice || ""));
  const [localStop, setLocalStop] = useState(String(stock.stopLoss || ""));
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
              {stock.priceReal && <MarketBadge state={stock.marketState || "CLOSED"} size={8}/>}
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

        {/* TradingView Widget */}
        <TradingViewWidget ticker={stock.ticker} />

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
              <input type="number" step="0.01" value={localTarget} onChange={e => setLocalTarget(e.target.value)}
                onBlur={() => onSaveTargets && onSaveTargets(stock.id, parseFloat(localTarget)||null, parseFloat(localStop)||null)}
                placeholder="Es. 200.00" style={{ fontSize: 12, padding: "7px 10px" }}/>
              {parseFloat(localTarget) > 0 && stock.currentPrice >= parseFloat(localTarget) && (
                <div style={{ fontSize: 9, color: "#5EC98A", marginTop: 4 }}>✓ Target raggiunto!</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#E87040", marginBottom: 5 }}>Stop Loss (USD)</div>
              <input type="number" step="0.01" value={localStop} onChange={e => setLocalStop(e.target.value)}
                onBlur={() => onSaveTargets && onSaveTargets(stock.id, parseFloat(localTarget)||null, parseFloat(localStop)||null)}
                placeholder="Es. 150.00" style={{ fontSize: 12, padding: "7px 10px" }}/>
              {parseFloat(localStop) > 0 && stock.currentPrice <= parseFloat(localStop) && (
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
        <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>📰 Ultime notizie</div>
          {newsLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#444", fontSize: 11 }}><Spinner size={9}/> Caricamento notizie…</div>
          ) : news.length === 0 ? (
            <div style={{ fontSize: 11, color: "#2a2d35" }}>Nessuna notizia recente trovata per {stock.ticker}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {news.map((n, i) => (
                <a key={n.id || i} href={n.url} target="_blank" rel="noopener noreferrer"
                  style={{ textDecoration: "none", display: "block", padding: "10px 12px", background: "#13151c", borderRadius: 6, border: "1px solid #1a1d26", transition: "border-color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#F4C542"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1d26"}>
                  <div style={{ fontSize: 12, color: "#E8E6DF", lineHeight: 1.5, marginBottom: 4 }}>{n.headline}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: "#444" }}>{n.source}</span>
                    <span style={{ fontSize: 9, color: "#333" }}>{n.datetime ? new Date(n.datetime * 1000).toLocaleDateString("it-IT") : ""}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Delete */}
        <button onClick={() => { handleRemove(stock.id); onClose(); }}
          style={{ background: "none", border: "1px solid #2a2d35", color: "#E87040", fontFamily: "inherit", fontSize: 11, padding: "8px 16px", borderRadius: 4, cursor: "pointer", width: "100%" }}>
          🗑 Rimuovi {stock.ticker} dal portafoglio
        </button>
      </div>
    </div>
  );
}



// ─── MACRO SCENARIO TAB ───────────────────────────────────────────────────────
function MacroScenarioSection({ stocks, sym, rate, fmt, pct: fmtPct, col }) {
  const [selected, setSelected] = useState(MACRO_SCENARIOS[0]);

  const totalValue = stocks.reduce((s, x) => s + x.qty * x.currentPrice, 0);

  // Calcola impatto portafoglio per scenario selezionato
  const portfolioImpact = useMemo(() => {
    let totalPnl = 0;
    const perStock = stocks.map(s => {
      const sectorImpact = selected.impact[s.sector] ?? selected.spxImpact;
      const val = s.qty * s.currentPrice;
      const pnl = val * sectorImpact;
      totalPnl += pnl;
      return { ...s, impact: sectorImpact * 100, pnl };
    });
    return { totalPnl, pct: totalValue > 0 ? (totalPnl / totalValue) * 100 : 0, perStock };
  }, [selected, stocks]);

  // Aggiungi linea portafoglio al chartData
  const chartWithPortfolio = useMemo(() => {
    const n = selected.chartData.length;
    return selected.chartData.map((pt, i) => ({
      ...pt,
      portfolio: parseFloat((portfolioImpact.pct * (i / (n - 1))).toFixed(1)),
    }));
  }, [selected, portfolioImpact.pct]);

  // Colori linee grafico — definiti direttamente nello scenario
  const lineKeys = selected.lineKeys || [];

  return (
    <div style={{ marginTop: 40 }}>
      {/* Header sezione */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Scenari Macroeconomici</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Come reagisce il tuo portafoglio a diversi contesti macro? Cosa comprare in ogni scenario?</div>
      </div>

      {/* Selector scenari macro */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {MACRO_SCENARIOS.map(s => (
          <button key={s.id} onClick={() => setSelected(s)}
            style={{ background: selected.id === s.id ? s.color + "22" : "none", border: `1px solid ${selected.id === s.id ? s.color : "#2a2d35"}`, color: selected.id === s.id ? s.color : "#555", fontFamily: "inherit", fontSize: 11, padding: "7px 14px", borderRadius: 4, cursor: "pointer", transition: "all 0.15s" }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Scenario header */}
      <div style={{ background: "#0f1117", border: `1px solid ${selected.color}33`, borderRadius: 6, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "#E8E6DF", fontWeight: 500, marginBottom: 4 }}>{selected.label}</div>
          <div style={{ fontSize: 11, color: "#555" }}>{selected.desc}</div>
          <div style={{ fontSize: 10, color: "#333", marginTop: 6 }}>⏱ Durata tipica: {selected.duration}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>S&P 500 medio</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: selected.spxImpact >= 0 ? "#5EC98A" : "#E87040" }}>
            {selected.spxImpact >= 0 ? "+" : ""}{(selected.spxImpact * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* KPI impatto portafoglio */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { l: "Impatto stimato", v: `${portfolioImpact.totalPnl >= 0 ? "+" : ""}${sym}${fmt(Math.abs(portfolioImpact.totalPnl * rate))}`, c: portfolioImpact.totalPnl >= 0 ? "#5EC98A" : "#E87040" },
          { l: "Variazione %",    v: `${portfolioImpact.pct >= 0 ? "+" : ""}${portfolioImpact.pct.toFixed(1)}%`, c: portfolioImpact.pct >= 0 ? "#5EC98A" : "#E87040" },
          { l: "Valore stimato",  v: `${sym}${fmt((totalValue + portfolioImpact.totalPnl) * rate)}`, c: "#E8E6DF" },
        ].map(k => (
          <div key={k.l} className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{k.l}</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Grafico performance storica settori */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
              Performance storica — {selected.label}
            </div>
            <div style={{ fontSize: 10, color: "#555" }}>Rendimento cumulato dei principali asset in questo scenario (dati medi storici)</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartWithPortfolio}>
            <XAxis dataKey="m" tick={{ fill: "#333", fontSize: 9 }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fill: "#333", fontSize: 9 }} axisLine={false} tickLine={false} width={45}
              tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`} domain={["auto","auto"]}/>
            <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 6, fontSize: 11, color: "#E8E6DF" }}
              formatter={(v, n) => [`${v > 0 ? "+" : ""}${v}%`, n === "portfolio" ? "Il tuo portafoglio (stimato)" : n]}/>
            <ReferenceLine y={0} stroke="#2a2d35" strokeDasharray="3 3"/>
            {lineKeys.map(lk => (
              <Line key={lk.k} type="monotone" dataKey={lk.k} stroke={lk.c} strokeWidth={1.5}
                dot={false} name={lk.l} strokeDasharray="4 2"/>
            ))}
            <Line type="monotone" dataKey="portfolio" stroke={selected.color} strokeWidth={2.5}
              dot={false} name="Il tuo portafoglio (stimato)"/>
            <Legend wrapperStyle={{ fontSize: 10, color: "#555", paddingTop: 8 }}/>
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#2a2d35", marginTop: 8 }}>
          * Basato su performance medie storiche per settore. La linea colorata rappresenta il tuo portafoglio stimato.
        </div>
      </div>

      {/* Due colonne: titoli consigliati + titoli da evitare */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {/* Top picks */}
        <div className="card">
          <div style={{ fontSize: 8, color: "#5EC98A", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>
            ✅ Titoli che performano in questo scenario
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selected.topPicks.map(p => (
              <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1a1d26" }}>
                <div style={{ background: "#5EC98A22", color: "#5EC98A", fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 4, minWidth: 52, textAlign: "center" }}>
                  {p.ticker}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#E8E6DF" }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{p.reason}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#5EC98A", textAlign: "right" }}>
                  +{p.perf}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Worst picks + impatto per titolo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 8, color: "#E87040", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>
              ❌ Titoli da evitare o ridurre
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selected.worstPicks.map(p => (
                <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1a1d26" }}>
                  <div style={{ background: "#E8704022", color: "#E87040", fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 4, minWidth: 52, textAlign: "center" }}>
                    {p.ticker}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#E8E6DF" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{p.reason}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#E87040", textAlign: "right" }}>
                    {p.perf}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Il tuo portafoglio: titoli più esposti */}
          <div className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>
              📋 Il tuo portafoglio in questo scenario
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {portfolioImpact.perStock.sort((a, b) => a.impact - b.impact).map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#888", minWidth: 44, fontWeight: 600 }}>{s.ticker}</span>
                  <div style={{ flex: 1, height: 6, background: "#0f1117", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      width: `${Math.min(Math.abs(s.impact), 60) / 60 * 100}%`,
                      background: s.impact >= 0 ? "#5EC98A" : "#E87040",
                      opacity: 0.7,
                    }}/>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: s.impact >= 0 ? "#5EC98A" : "#E87040", minWidth: 48, textAlign: "right" }}>
                    {s.impact >= 0 ? "+" : ""}{s.impact.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 9, color: "#2a2d35", textAlign: "center", padding: "8px 0" }}>
        ⚠️ Stime basate su dati storici medi per settore. Non costituisce consulenza finanziaria ai sensi MiFID II.
      </div>
    </div>
  );
}

function SimulazioniTab({ stocks, sym, rate, fmt, fmtPct }) {
  const [selectedScenario, setSelectedScenario] = useState(SCENARIOS[0]);
  const [scenarioData, setScenarioData] = useState({});
  const [loading, setLoading] = useState(false);

  const totalValue   = stocks.reduce((s, x) => s + x.qty * x.currentPrice, 0);
  const totalInvested = stocks.reduce((s, x) => s + x.qty * x.buyPrice, 0);

  useEffect(() => {
    const key = selectedScenario.id;
    if (scenarioData[key]) return;
    setLoading(true);

    // Fetch dati reali da Yahoo Finance per tutti gli scenari
    Promise.all(stocks.map(s => fetchScenarioData(s.ticker, selectedScenario))).then(results => {
      // Prendi SPY dal primo risultato disponibile
      const spyData = results.find(r => r?.spy)?.spy || null;

      // Build combined portfolio chart (weighted average)
      const candles = results.map(r => r?.candles || null);
      const maxLen = Math.max(...candles.map(r => r?.length || 0));
      const chartData = Array.from({ length: maxLen }, (_, i) => {
        const point = { date: candles.find(r => r)?.[i]?.date || "" };
        let totalPct = 0, totalWeight = 0;
        candles.forEach((r, j) => {
          if (r && r[i]) {
            const weight = stocks[j].qty * stocks[j].currentPrice / totalValue;
            totalPct += r[i].pct * weight;
            totalWeight += weight;
          }
        });
        point.pct = totalWeight > 0 ? parseFloat((totalPct / totalWeight).toFixed(2)) : 0;
        // Aggiungi SPY come benchmark
        if (spyData && spyData[i]) point.spy = spyData[i].pct;
        return point;
      });

      const stockResults = stocks.map((s, i) => {
        const r = candles[i];
        if (!r || r.length === 0) {
          // Fallback beta-adjusted se titolo non esisteva in quel periodo
          const beta = s.sector === "Tech" ? 1.4 : s.sector === "Energy" ? 0.8 : s.sector === "Finanza" ? 1.2 : 1.0;
          const pct = selectedScenario.spx / 100 * beta;
          return { ...s, scenarioPct: pct * 100, scenarioPnl: s.qty * s.currentPrice * rate * pct, noData: true };
        }
        const pct = r[r.length - 1].pct;
        const pnl = s.qty * s.currentPrice * rate * pct / 100;
        return { ...s, scenarioPct: pct, scenarioPnl: pnl, noData: false };
      });

      setScenarioData(d => ({ ...d, [key]: { chartData, stockResults, hasSpy: !!spyData } }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [selectedScenario.id, stocks.length]);

  const data = scenarioData[selectedScenario.id];
  const totalScenarioPnl = data ? data.stockResults.reduce((s, x) => s + x.scenarioPnl, 0) : 0;
  const totalScenarioPct = totalValue > 0 ? totalScenarioPnl / (totalValue * rate) * 100 : 0;

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Stress Test Storico</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Come sarebbe andato il tuo portafoglio durante le grandi crisi?</div>
      </div>

      {/* Scenario selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {SCENARIOS.map(s => (
          <button key={s.id} onClick={() => setSelectedScenario(s)}
            style={{ background: selectedScenario.id === s.id ? s.color + "22" : "none", border: `1px solid ${selectedScenario.id === s.id ? s.color : "#2a2d35"}`, color: selectedScenario.id === s.id ? s.color : "#555", fontFamily: "inherit", fontSize: 11, padding: "7px 14px", borderRadius: 4, cursor: "pointer", transition: "all 0.15s" }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Scenario description */}
      <div style={{ background: "#0f1117", border: `1px solid ${selectedScenario.color}33`, borderRadius: 6, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "#E8E6DF", fontWeight: 500 }}>{selectedScenario.label}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{selectedScenario.desc} · {selectedScenario.from} → {selectedScenario.to}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em" }}>S&P 500</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: selectedScenario.spx >= 0 ? "#5EC98A" : "#E87040" }}>
            {selectedScenario.spx >= 0 ? "+" : ""}{selectedScenario.spx}%
          </div>
        </div>
        <div style={{ fontSize: 9, background: "#1a2a1a", color: "#5EC98A", padding: "3px 8px", borderRadius: 3 }}>● Dati reali</div>
      </div>

      {loading ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#555", fontSize: 12 }}>
          <Spinner /> Caricamento dati storici…
        </div>
      ) : data ? (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
            {[
              { l: "Impatto Portafoglio", v: `${totalScenarioPnl >= 0 ? "+" : ""}${sym}${fmt(Math.abs(totalScenarioPnl))}`, c: totalScenarioPnl >= 0 ? "#5EC98A" : "#E87040" },
              { l: "Performance %",       v: `${totalScenarioPct >= 0 ? "+" : ""}${totalScenarioPct.toFixed(2)}%`, c: totalScenarioPct >= 0 ? "#5EC98A" : "#E87040" },
              { l: "Valore Finale",       v: `${sym}${fmt((totalValue + totalScenarioPnl / rate) * rate)}`, c: "#E8E6DF" },
            ].map(k => (
              <div key={k.l} className="card">
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{k.l}</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, color: k.c }}>{k.v}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                Andamento portafoglio — {selectedScenario.label}
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 10 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 2, background: selectedScenario.color, display: "inline-block" }}/> Il tuo portafoglio
                </span>
                {data.hasSpy && <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 2, background: "#555", display: "inline-block" }}/> S&P 500 (SPY)
                </span>}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.chartData}>
                <defs>
                  <linearGradient id="scg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={selectedScenario.color} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={selectedScenario.color} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor((data.chartData.length || 1) / 5)}/>
                <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={45} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`}/>
                <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }}
                  formatter={(v, name) => [`${v > 0 ? "+" : ""}${v}%`, name === "spy" ? "S&P 500" : "Portafoglio"]}/>
                <ReferenceLine y={0} stroke="#2a2d35" strokeDasharray="4 3" strokeWidth={1}/>
                <Area type="monotone" dataKey="pct" stroke={selectedScenario.color} strokeWidth={2} fill="url(#scg)" dot={false} name="pct"/>
                {data.hasSpy && <Area type="monotone" dataKey="spy" stroke="#444" strokeWidth={1} fill="none" dot={false} strokeDasharray="4 3" name="spy"/>}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Per-stock table */}
          <div className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Dettaglio per titolo</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1a1d26" }}>
                  {["Ticker", "Settore", "Valore Attuale", "Performance Scenario", "P&L Scenario"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.stockResults.map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #0f1117" }}>
                    <td style={{ padding: "10px 10px", color: "#E8E6DF", fontWeight: 500 }}>
                      {s.ticker}
                      {s.noData && <span style={{ fontSize: 8, color: "#444", marginLeft: 6 }}>(sim.)</span>}
                    </td>
                    <td style={{ padding: "10px 10px", color: "#555" }}>{s.sector}</td>
                    <td style={{ padding: "10px 10px" }}>{sym}{fmt(s.qty * s.currentPrice * rate)}</td>
                    <td style={{ padding: "10px 10px", color: s.scenarioPct >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>
                      {s.scenarioPct >= 0 ? "+" : ""}{s.scenarioPct.toFixed(2)}%
                    </td>
                    <td style={{ padding: "10px 10px", color: s.scenarioPnl >= 0 ? "#5EC98A" : "#E87040" }}>
                      {s.scenarioPnl >= 0 ? "+" : ""}{sym}{fmt(Math.abs(s.scenarioPnl))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 14, padding: "10px 10px", background: "#0a0c10", borderRadius: 4, fontSize: 10, color: "#333" }}>
              📊 Dati storici reali da Yahoo Finance. I titoli non presenti in quel periodo usano una stima beta-adjusted. Le performance passate non garantiscono risultati futuri. Non costituisce consulenza finanziaria ai sensi MiFID II.
            </div>
          </div>
        </>
      ) : null}

      {/* ── SEZIONE MACRO ── */}
      <MacroScenarioSection stocks={stocks} sym={sym} rate={rate} fmt={fmt} pct={fmtPct} col={v => v >= 0 ? "#5EC98A" : "#E87040"} />
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── WHAT IF TAB ──────────────────────────────────────────────────────────────
// ─── DIVIDENDI TAB ────────────────────────────────────────────────────────────
// ─── FORECAST TAB ─────────────────────────────────────────────────────────────
// ─── ALLOCATION CARD ──────────────────────────────────────────────────────────
const PIE_COLORS = ["#5B8DEF","#26C6DA","#5EC98A","#F4C542","#BF6EEA","#E87040","#F06292","#FF7043","#80CBC4","#FFD54F"];

function AllocationCard({ stocks, totalValue, eurRate, fmt }) {
  const [pieTab, setPieTab] = useState("settori");
  const [etfHoldings, setEtfHoldings] = useState({}); // { ticker: { sectorWeights: [...] } }
  const [etfLoading, setEtfLoading] = useState(false);

  // ETF: lista titoli con settore ETF
  const etfStocks = useMemo(() => stocks.filter(s => s.sector === "ETF"), [stocks]);

  // Fetch ETF holdings al mount o quando cambia lista ETF
  useEffect(() => {
    if (etfStocks.length === 0) return;
    setEtfLoading(true);
    Promise.all(etfStocks.map(s =>
      fetch(`${API_BASE}/api/analyst?symbol=${encodeURIComponent(s.ticker)}`)
        .then(r => r.json())
        .then(d => ({ ticker: s.ticker, sectorWeights: d.sectorWeights || [] }))
        .catch(() => ({ ticker: s.ticker, sectorWeights: [] }))
    )).then(results => {
      const map = {};
      results.forEach(r => { map[r.ticker] = r; });
      setEtfHoldings(map);
      setEtfLoading(false);
    });
  }, [etfStocks.map(s => s.ticker).join(",")]);

  // Calcola dati torta con ETF scomposti
  const pieData = useMemo(() => {
    const map = {};

    stocks.forEach(s => {
      const posVal = s.qty * s.currentPrice;
      const holdings = etfHoldings[s.ticker];

      // Se è ETF e abbiamo i dati di scomposizione → scomponi per settore
      if (s.sector === "ETF" && holdings?.sectorWeights?.length > 0 && pieTab === "settori") {
        holdings.sectorWeights.forEach(sw => {
          map[sw.sector] = (map[sw.sector] || 0) + posVal * (sw.weight / 100);
        });
        return;
      }

      if (pieTab === "settori") {
        const key = s.sector || "Altro";
        map[key] = (map[key] || 0) + posVal;
      } else if (pieTab === "posizioni") {
        map[s.ticker] = (map[s.ticker] || 0) + posVal;
      } else if (pieTab === "tipo") {
        const tipo = s.sector === "ETF" ? "ETF" : s.sector === "Crypto" ? "Crypto" : "Azioni";
        map[tipo] = (map[tipo] || 0) + posVal;
      }
    });

    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [stocks, pieTab, etfHoldings]);

  const [activeIndex, setActiveIndex] = useState(null);
  const centerVal = activeIndex !== null ? pieData[activeIndex] : null;

  // Calcola alert concentrazione >25%
  const concentrationAlerts = useMemo(() => {
    if (pieTab !== "settori") return [];
    return pieData
      .filter(item => totalValue > 0 && (item.value / totalValue) * 100 > 25)
      .map(item => {
        const pct = ((item.value / totalValue) * 100).toFixed(1);
        const sector = item.name;
        // Suggerimenti per settore
        const suggestions = {
          "Tech":       ["Bilancia con XLV (Salute) o XLP (Beni primari)", "Aggiungi esposizione internazionale con VEA", "Considera obbligazioni TLT per ridurre volatilità"],
          "Energia":    ["Diversifica con XLK (Tech) o XLV (Salute)", "Alta ciclicità: considera XLP come difensivo", "GLD può bilanciare il rischio commodity"],
          "Finanza":    ["Bilancia con settori difensivi come XLU o XLV", "Considera esposizione internazionale VWO", "I tassi alti favoriscono le banche ma aumentano rischio"],
          "Salute":     ["Aggiungi ciclici come XLY o tech con QQQ", "Buon settore difensivo ma valuta di aggiungere crescita", "Considera small cap IWM per diversificazione"],
          "Consumer":   ["Bilancia con Tech o Finanza", "Aggiungi esposizione internazionale", "Considera obbligazioni per ridurre correlazione"],
          "Industriali":["Settore ciclico: aggiungi difensivi XLP o XLV", "Considera esposizione tech per crescita", "GLD come hedge in caso di recessione"],
          "Real Estate":["REIT sensibili ai tassi: diversifica con Tech", "Aggiungi bond a breve SHY come bilanciamento", "Considera settori meno correlati ai tassi"],
          "Valute":     ["UUP è hedge valutario: valuta esposizione azionaria", "Bilancia con azionario globale VTI o SPY", "Considera TIPS per protezione inflazione"],
          "ETF":        ["Verifica la composizione interna degli ETF", "Evita sovrapposizioni tra ETF simili", "Considera ETF settoriali per maggiore controllo"],
        };
        const tips = suggestions[sector] || ["Diversifica su altri settori", "Considera ETF globali come VTI o VEA", "Valuta obbligazioni per ridurre volatilità"];
        return { sector, pct, tips };
      });
  }, [pieData, totalValue, pieTab]);

  const [showAlerts, setShowAlerts] = useState(true);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* Tab selector */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, borderBottom: "1px solid #1a1d26", paddingBottom: 0 }}>
        <div style={{ display: "flex", gap: 0 }}>
          {["settori","posizioni","tipo"].map(t => (
            <button key={t} onClick={() => setPieTab(t)}
              style={{ background: "none", border: "none", borderBottom: pieTab === t ? "2px solid #F4C542" : "2px solid transparent",
                color: pieTab === t ? "#E8E6DF" : "#444", fontFamily: "inherit", fontSize: 11,
                padding: "6px 12px", cursor: "pointer", textTransform: "capitalize", transition: "all 0.15s", marginBottom: -1 }}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {etfLoading && <span style={{ fontSize: 9, color: "#444" }}>caricamento ETF…</span>}
          {!etfLoading && etfStocks.length > 0 && pieTab === "settori" && (
            <span style={{ fontSize: 9, color: "#5EC98A" }}>✓ ETF scomposti</span>
          )}
          {concentrationAlerts.length > 0 && (
            <button onClick={() => setShowAlerts(v => !v)}
              style={{ background: "#E8704011", border: "1px solid #E8704033", color: "#E87040",
                fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>
              ⚠️ {concentrationAlerts.length} concentrazione{concentrationAlerts.length > 1 ? "i" : ""} &gt;25%
            </button>
          )}
        </div>
      </div>

      {/* Layout principale: torta + legenda + eventuale panel alert */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>

        {/* Torta compatta */}
        <div style={{ position: "relative", width: 150, height: 150, flexShrink: 0 }}>
          <PieChart width={150} height={150}>
            <Pie data={pieData} cx={70} cy={70}
              innerRadius={46} outerRadius={68}
              dataKey="value" paddingAngle={1.5}
              onMouseEnter={(_, i) => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}>
              {pieData.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]}
                  opacity={activeIndex === null || activeIndex === i ? 1 : 0.3}
                  style={{ cursor: "pointer" }}/>
              ))}
            </Pie>
          </PieChart>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-46%,-50%)", textAlign: "center", pointerEvents: "none", width: 72 }}>
            {centerVal ? (
              <>
                <div style={{ fontSize: 8, color: "#555", lineHeight: 1.2, marginBottom: 1 }}>{centerVal.name}</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 12, color: "#E8E6DF" }}>${fmt(centerVal.value)}</div>
                <div style={{ fontSize: 11, color: "#F4C542", fontWeight: 600 }}>
                  {totalValue > 0 ? ((centerVal.value / totalValue) * 100).toFixed(1) : 0}%
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 7, color: "#444", marginBottom: 1 }}>Patrimonio</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 12, color: "#E8E6DF" }}>${fmt(totalValue)}</div>
                <div style={{ fontSize: 8, color: "#555" }}>€{fmt(totalValue * eurRate)}</div>
              </>
            )}
          </div>
        </div>

        {/* Legenda */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 160 }}>
          {pieData.map((item, i) => {
            const pct = totalValue > 0 ? ((item.value / totalValue) * 100).toFixed(1) : 0;
            const isAlert = parseFloat(pct) > 25;
            const isActive = activeIndex === i;
            return (
              <div key={item.name}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
                  opacity: activeIndex === null || isActive ? 1 : 0.35, transition: "opacity 0.15s" }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: PIE_COLORS[i % PIE_COLORS.length] }}/>
                <span style={{ fontSize: 11, color: isActive ? "#E8E6DF" : "#777", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
                <span style={{ fontSize: 11, fontWeight: 600, minWidth: 36, textAlign: "right",
                  color: isAlert ? "#E87040" : "#E8E6DF" }}>{pct}%</span>
                {isAlert && <span style={{ fontSize: 9, color: "#E87040" }}>⚠️</span>}
                <span style={{ fontSize: 10, color: "#444", minWidth: 60, textAlign: "right" }}>${fmt(item.value)}</span>
              </div>
            );
          })}
        </div>

        {/* Panel alert concentrazione */}
        {concentrationAlerts.length > 0 && showAlerts && (
          <div style={{ flex: 1, minWidth: 200, maxWidth: 280, background: "#0f1117", borderRadius: 8,
            border: "1px solid #E8704033", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#E87040", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                ⚠️ Concentrazione elevata
              </div>
              <button onClick={() => setShowAlerts(false)}
                style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
            </div>
            {concentrationAlerts.map(a => (
              <div key={a.sector} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#E8E6DF", fontWeight: 500 }}>{a.sector}</span>
                  <span style={{ fontSize: 12, color: "#E87040", fontWeight: 700 }}>{a.pct}%</span>
                </div>
                {/* Barra visuale */}
                <div style={{ height: 4, background: "#1a1d26", borderRadius: 2, marginBottom: 8, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(parseFloat(a.pct), 100)}%`,
                    background: parseFloat(a.pct) > 50 ? "#E87040" : "#F4C542", borderRadius: 2 }}/>
                  <div style={{ height: "100%", width: "2px", background: "#5EC98A", position: "relative", top: -4, left: "25%" }}/>
                </div>
                <div style={{ fontSize: 9, color: "#444", marginBottom: 6 }}>Suggerimenti:</div>
                {a.tips.map((tip, j) => (
                  <div key={j} style={{ fontSize: 10, color: "#666", marginBottom: 4, paddingLeft: 8,
                    borderLeft: "2px solid #2a2d35", lineHeight: 1.4 }}>
                    {tip}
                  </div>
                ))}
              </div>
            ))}
            <div style={{ fontSize: 9, color: "#2a2d35", marginTop: 4, borderTop: "1px solid #1a1d26", paddingTop: 8 }}>
              Soglia consigliata per settore: &lt;25%
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────
function OverviewTab({ stocks, fmt, fmtPct, sym, rate, eurRate, totalValue, totalInvested,
  totalPnL, totalPct, sectorData, portfolioHistory, alerts, setSelectedId, setEditId,
  handleRemove, setShowForm, marketOpen }) {

  const [chartPeriod, setChartPeriod] = useState("1M");
  const [variations, setVariations] = useState({ day: null, month: null, year: null });
  const [varLoading, setVarLoading] = useState(false);
  const [realChartData, setRealChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  const col = v => v >= 0 ? "#5EC98A" : "#E87040";
  const sign = v => v >= 0 ? "+" : "";

  // Parsing buyDate: supporta "dd/mm/yy", "dd/mm/yyyy", "YYYY-MM-DD"
  const parseBuyDate = (s) => {
    if (!s) return null;
    // Formato ISO YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");
    // Formato italiano dd/mm/yy o dd/mm/yyyy
    const p = s.split("/");
    if (p.length === 3) {
      const yr = p[2].length === 2 ? "20" + p[2] : p[2];
      return new Date(`${yr}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}T00:00:00`);
    }
    return null;
  };

  // Fetch storico reale e costruisci grafico portafoglio
  useEffect(() => {
    if (stocks.length === 0) return;
    setVarLoading(true);
    setChartLoading(true);

    // Variazione giornaliera
    const dayPnl = stocks.reduce((sum, s) => {
      const prevClose = s.prevClose || s.currentPrice;
      return sum + (s.currentPrice - prevClose) * s.qty;
    }, 0);
    const prevTotalValue = stocks.reduce((sum, s) => sum + (s.prevClose || s.currentPrice) * s.qty, 0);
    const dayPct = prevTotalValue > 0 ? (dayPnl / prevTotalValue) * 100 : 0;

    // Calcola giorni da fetchare: dalla prima data di acquisto
    const firstDate = stocks.reduce((min, s) => {
      const d = parseBuyDate(s.buyDate);
      return d && (!min || d < min) ? d : min;
    }, null);
    const daysSinceFirst = firstDate
      ? Math.ceil((Date.now() - firstDate.getTime()) / 86400000) + 10
      : 400;
    const daysToFetch = Math.max(daysSinceFirst, 395);

    // Fetch storico ISO per tutti i titoli
    Promise.all(stocks.map(async s => {
      try {
        const r = await fetch(`${API_BASE}/api/history?symbol=${encodeURIComponent(s.ticker)}&days=${daysToFetch}`);
        const d = await r.json();
        const bd = parseBuyDate(s.buyDate);
        return { ticker: s.ticker, qty: s.qty, buyDateISO: bd ? bd.toISOString().split("T")[0] : null, candles: d.candles || [] };
      } catch {
        return { ticker: s.ticker, qty: s.qty, buyDateISO: null, candles: [] };
      }
    })).then(results => {
      // Mappa ISO date → prezzi per ogni titolo
      const priceMap = {}; // { "2024-03-10": { AAPL: 175.0, MSFT: 380.0 } }
      results.forEach(r => {
        r.candles.forEach(c => {
          if (!priceMap[c.date]) priceMap[c.date] = {};
          priceMap[c.date][r.ticker] = c.price;
        });
      });

      // Date ordinate (ISO → sort alfabetico = sort cronologico)
      const allDates = Object.keys(priceMap).sort();

      // Costruisci serie: per ogni giorno somma solo titoli già acquistati
      const lastKnown = {}; // ultimo prezzo noto per ogni ticker
      const series = [];

      allDates.forEach(dateISO => {
        // Aggiorna lastKnown con prezzi del giorno
        results.forEach(r => {
          if (priceMap[dateISO]?.[r.ticker] != null) {
            lastKnown[r.ticker] = priceMap[dateISO][r.ticker];
          }
        });

        let total = 0;
        let anyActive = false;
        results.forEach(r => {
          // Includi il titolo solo se la data è >= data acquisto
          if (!r.buyDateISO || dateISO >= r.buyDateISO) {
            const price = lastKnown[r.ticker];
            if (price) { total += r.qty * price; anyActive = true; }
          }
        });
        if (anyActive && total > 0) {
          // Label visuale: "10 mar" per assi X
          const d = new Date(dateISO + "T12:00:00");
          const label = d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
          series.push({ date: dateISO, label, valore: parseFloat(total.toFixed(2)) });
        }
      });

      setRealChartData(series);

      // Variazioni da serie reale
      const nowVal = series[series.length - 1]?.valore || 0;
      const findAgo = (days) => {
        const target = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
        // Trova il punto più vicino
        const pt = series.filter(p => p.date <= target).slice(-1)[0];
        return pt?.valore;
      };

      const mkVar = (old) => {
        if (!old || !nowVal) return null;
        const pnl = nowVal - old;
        return { pnl: parseFloat(pnl.toFixed(2)), pct: parseFloat(((pnl/old)*100).toFixed(2)) };
      };

      setVariations({
        day:   { pnl: parseFloat(dayPnl.toFixed(2)), pct: parseFloat(dayPct.toFixed(2)) },
        month: mkVar(findAgo(30)),
        year:  mkVar(findAgo(365)),
      });
      setVarLoading(false);
      setChartLoading(false);
    }).catch(() => { setVarLoading(false); setChartLoading(false); });
  }, [stocks.map(s => s.ticker + s.qty + s.buyDate).join(",")]);

  // Slice grafico in base al periodo selezionato
  const chartData = useMemo(() => {
    if (!realChartData.length) return [];
    const n = realChartData.length;
    if (chartPeriod === "Inizio") return realChartData;
    const sliceMap = { "1M": 30, "3M": 63, "6M": 126, "1A": 252 };
    const days = sliceMap[chartPeriod] || 30;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    const filtered = realChartData.filter(p => p.date >= cutoff);
    return filtered.length > 1 ? filtered : realChartData.slice(-days);
  }, [realChartData, chartPeriod]);

  // Marker acquisti: mostra sempre tutti gli acquisti nel range visibile
  const purchaseMarkers = useMemo(() => {
    if (!chartData.length) return [];
    const markers = [];
    stocks.forEach(s => {
      const bd = parseBuyDate(s.buyDate);
      if (!bd) return;
      const bdISO = bd.toISOString().split("T")[0];
      const firstChartDate = chartData[0]?.date;
      const lastChartDate  = chartData[chartData.length - 1]?.date;
      let pt;
      if (bdISO >= firstChartDate) {
        // Acquisto nel range: trova il punto più vicino
        pt = chartData.find(p => p.date >= bdISO);
      } else {
        // Acquisto prima del range (es. periodo 1M ma comprato 6M fa)
        // Mostra marker sul primo punto con tooltip "acquistato il X"
        pt = chartData[0];
      }
      if (pt) markers.push({
        ...pt, ticker: s.ticker, qty: s.qty, buyPrice: s.buyPrice,
        actualBuyDate: bdISO,
        beforeRange: bdISO < (firstChartDate || ""),
      });
    });
    // Deduplicazione: se più acquisti stesso giorno, mostra solo il primo per ticker
    const seen = new Set();
    return markers.filter(m => {
      const key = m.ticker + m.date;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [chartData, stocks]);

  if (stocks.length === 0) return (
    <div className="fade-up" style={{ textAlign: "center", marginTop: 80 }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 36, fontWeight: 300, color: "#F4C542", marginBottom: 12 }}>◈</div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, marginBottom: 8 }}>Portafoglio vuoto</div>
      <div style={{ fontSize: 12, color: "#444", marginBottom: 24, lineHeight: 1.8 }}>Aggiungi il tuo primo titolo per iniziare.</div>
      <button className="add-btn" style={{ margin: "0 auto" }} onClick={() => setShowForm(true)}>+ Aggiungi il primo titolo</button>
    </div>
  );

  return (
    <div className="fade-up">

      {/* ── HEADER KPI ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 32, fontWeight: 300, lineHeight: 1 }}>
            ${fmt(totalValue)}
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>€{fmt(totalValue * eurRate)}</div>
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: col(totalPnL) }}>{sign(totalPnL)}${fmt(Math.abs(totalPnL))} totale</span>
            <span style={{ fontSize: 12, color: col(totalPct), fontWeight: 500 }}>{sign(totalPct)}{totalPct.toFixed(2)}%</span>
          </div>
        </div>
        {/* Variazioni */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { l: "Oggi", v: variations.day },
            { l: "1 mese", v: variations.month },
            { l: "1 anno", v: variations.year },
          ].map(({ l, v }) => (
            <div key={l} style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "10px 14px", minWidth: 90, textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>{l}</div>
              {varLoading || !v ? (
                <div style={{ fontSize: 11, color: "#333" }}>…</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 500, color: col(v.pct) }}>{sign(v.pct)}{v.pct.toFixed(2)}%</div>
                  <div style={{ fontSize: 10, color: col(v.pnl) }}>{sign(v.pnl)}${fmt(Math.abs(v.pnl))}</div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── GRAFICO PORTAFOGLIO stile GetQuin ── */}
      {(() => {
        const firstVal = chartData[0]?.valore;
        const lastVal  = chartData[chartData.length - 1]?.valore;
        const chartPct = firstVal && lastVal ? ((lastVal - firstVal) / firstVal * 100) : 0;
        const chartPos = chartPct >= 0;
        const lineColor = chartPos ? "#5EC98A" : "#E87040";
        return (
          <div style={{ marginBottom: 16, background: "#0D0F14", borderRadius: 8, padding: "20px 0 8px 0" }}>
            {/* Periodo selector stile GetQuin */}
            <div style={{ display: "flex", gap: 2, marginBottom: 16, paddingLeft: 20 }}>
              {["1M","3M","6M","1A","Inizio"].map(p => (
                <button key={p} onClick={() => setChartPeriod(p)}
                  style={{ background: chartPeriod === p ? "#1a1d26" : "none",
                    color: chartPeriod === p ? "#E8E6DF" : "#333",
                    border: "none", borderRadius: 4,
                    fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit",
                    fontWeight: chartPeriod === p ? 500 : 400 }}>
                  {p}
                </button>
              ))}
              <span style={{ marginLeft: "auto", marginRight: 20, fontSize: 11, color: chartPos ? "#5EC98A" : "#E87040", alignSelf: "center" }}>
                {chartPos ? "▲" : "▼"} {Math.abs(chartPct).toFixed(2)}%
              </span>
            </div>

            {chartLoading ? (
              <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#333", fontSize: 11 }}>
                <Spinner size={14}/> Caricamento…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity={0.15}/>
                      <stop offset="100%" stopColor={lineColor} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" tickMargin={8}/>
                  <YAxis hide domain={["auto","auto"]}/>
                  <Tooltip
                    contentStyle={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, fontSize: 11, color: "#E8E6DF", padding: "6px 12px" }}
                    formatter={(v, name, props) => [`$${fmt(v)}`, ""]}
                    labelFormatter={label => `${label}`}
                    labelStyle={{ color: "#555", fontSize: 10, marginBottom: 2 }}
                    cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: "4 2" }}
                  />
                  <Area type="monotone" dataKey="valore" stroke={lineColor} strokeWidth={1.5}
                    fill="url(#gqGrad)" dot={false}
                    activeDot={{ r: 4, fill: lineColor, stroke: "#0D0F14", strokeWidth: 2 }}/>
                  {purchaseMarkers.map(m => (
                    <ReferenceLine key={m.ticker + m.date} x={m.label}
                      stroke="#7EB8F755" strokeDasharray="3 3" strokeWidth={1}
                      label={{ value: m.ticker, position: "insideTopRight", fill: "#7EB8F7", fontSize: 8 }}/>
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}

            {/* Legenda acquisti */}
            {purchaseMarkers.length > 0 && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 20px 0", borderTop: "1px solid #0f1117", marginTop: 8 }}>
                {purchaseMarkers.map(m => (
                  <div key={m.ticker + m.date} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#444" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7EB8F7" }}/>
                    <span style={{ color: "#7EB8F7" }}>{m.ticker}</span>
                    <span>{m.qty} az. @ ${fmt(m.buyPrice)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── ALLOCAZIONE (torta stile GetQuin) ── */}
      <AllocationCard stocks={stocks} totalValue={totalValue} eurRate={eurRate} fmt={fmt} fmtPct={fmtPct} />

      {/* ── LISTA TITOLI COMPATTA ── */}
      <div className="card">
        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Posizioni</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 620 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1a1d26" }}>
                {["Ticker","Q.tà","Acquisto","Attuale","Val. EUR","Valore","P&L","P&L%","Target","Stop",""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "0 8px 10px 0", fontSize: 8, color: "#444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stocks.map(s => {
                const pnl = (s.currentPrice - s.buyPrice) * s.qty;
                const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
                const tp = s.targetPrice;
                const sl = s.stopLoss;
                const isUp = pnl >= 0;
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid #0f1117", cursor: "pointer", transition: "background 0.1s" }}
                    onClick={() => setSelectedId(s.id)}
                    onMouseEnter={e => e.currentTarget.style.background = "#0f1117"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "10px 8px 10px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 500 }}>{s.ticker}</span>
                        {s.priceReal && <MarketBadge state={s.marketState || "CLOSED"} size={7}/>}
                        {alerts[s.id] && <span style={{ fontSize: 9 }}>🔔</span>}
                      </div>
                      <div style={{ fontSize: 9, color: "#333", marginTop: 2 }}>{s.sector} · {s.buyDate}</div>
                    </td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#666" }}>{s.qty}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#555" }}>${fmt(s.buyPrice)}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#E8E6DF" }}>${fmt(s.currentPrice)}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#444" }}>€{fmt(s.currentPrice * eurRate)}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#E8E6DF" }}>${fmt(s.qty * s.currentPrice)}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: isUp ? "#5EC98A" : "#E87040" }}>{isUp?"+":""}${fmt(Math.abs(pnl))}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: isUp ? "#5EC98A" : "#E87040", fontWeight: 500 }}>{fmtPct(pct)}</td>
                    <td style={{ padding: "10px 8px 10px 0", fontSize: 10, color: tp ? (s.currentPrice >= tp ? "#5EC98A" : "#555") : "#2a2d35" }}>
                      {tp ? `🎯$${fmt(tp)}` : "—"}
                    </td>
                    <td style={{ padding: "10px 8px 10px 0", fontSize: 10, color: sl ? (s.currentPrice <= sl ? "#E87040" : "#555") : "#2a2d35" }}>
                      {sl ? `🛑$${fmt(sl)}` : "—"}
                    </td>
                    <td style={{ padding: "10px 0", whiteSpace: "nowrap" }}>
                      <button onClick={e => { e.stopPropagation(); setEditId(s.id); }}
                        style={{ background: "none", border: "1px solid #2a2d35", color: "#555", fontFamily: "inherit", fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer", marginRight: 4 }}
                        onMouseEnter={e => { e.target.style.borderColor="#F4C542"; e.target.style.color="#F4C542"; }}
                        onMouseLeave={e => { e.target.style.borderColor="#2a2d35"; e.target.style.color="#555"; }}>
                        ✎
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleRemove(s.id); }}
                        style={{ background: "none", border: "1px solid #2a2d35", color: "#444", fontFamily: "inherit", fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }}
                        onMouseEnter={e => { e.target.style.borderColor="#E87040"; e.target.style.color="#E87040"; }}
                        onMouseLeave={e => { e.target.style.borderColor="#2a2d35"; e.target.style.color="#444"; }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Best / Worst */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16, paddingTop: 16, borderTop: "1px solid #1a1d26" }}>
          {[
            { label: "🏆 Migliore", stock: [...stocks].sort((a,b) => (b.currentPrice-b.buyPrice)/b.buyPrice - (a.currentPrice-a.buyPrice)/a.buyPrice)[0], color: "#5EC98A" },
            { label: "📉 Peggiore", stock: [...stocks].sort((a,b) => (a.currentPrice-a.buyPrice)/a.buyPrice - (b.currentPrice-b.buyPrice)/b.buyPrice)[0], color: "#E87040" },
          ].map(({ label, stock, color }) => stock ? (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setSelectedId(stock.id)}>
              <div>
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>{label}</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16 }}>{stock.ticker}</div>
              </div>
              <div style={{ fontSize: 14, color, fontWeight: 500 }}>
                {fmtPct((stock.currentPrice - stock.buyPrice) / stock.buyPrice * 100)}
              </div>
            </div>
          ) : null)}
        </div>
      </div>
    </div>
  );
}

function ForecastTab({ stocks, fmt, fmtPct, sym, rate }) {
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const allLoadedRef = useRef(false);
  const [analystData, setAnalystData] = useState({}); // { ticker: { analyst, ... } }

  // Carica tutti i titoli in background al mount per card aggregata stabile
  useEffect(() => {
    if (allLoadedRef.current || stocks.length === 0) return;
    allLoadedRef.current = true;
    stocks.forEach(stock => {
      fetch(`${API_BASE}/api/forecast?symbol=${encodeURIComponent(stock.ticker)}&price=${stock.currentPrice}`)
        .then(r => r.json())
        .then(d => { if (!d.error) setData(prev => ({ ...prev, [stock.ticker]: d })); })
        .catch(() => {});
    });
  }, []);

  // Spinner visibile solo per il titolo selezionato se non ancora caricato
  useEffect(() => {
    if (!selected) return;
    if (data[selected.ticker]) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/forecast?symbol=${encodeURIComponent(selected.ticker)}&price=${selected.currentPrice}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return; }
        setData(prev => ({ ...prev, [selected.ticker]: d }));
        setLoading(false);
      })
      .catch(() => { setError("Errore nel caricamento dati"); setLoading(false); });
  }, [selected?.ticker]);

  // Fetch analyst ratings per il titolo selezionato
  useEffect(() => {
    if (!selected || analystData[selected.ticker]) return;
    fetch(`${API_BASE}/api/analyst?symbol=${encodeURIComponent(selected.ticker)}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setAnalystData(prev => ({ ...prev, [selected.ticker]: d })); })
      .catch(() => {});
  }, [selected?.ticker]);

  const portfolioForecast = useMemo(() => {
    const totalValue = stocks.reduce((s, st) => s + st.qty * st.currentPrice, 0);
    if (totalValue === 0) return null;
    let baseSum = 0, pessSum = 0, optSum = 0, covered = 0;
    stocks.forEach(st => {
      const d = data[st.ticker];
      if (!d) return;
      const w = (st.qty * st.currentPrice) / totalValue;
      baseSum += d.projection.base * w;
      pessSum += d.projection.pessimistic * w;
      optSum += d.projection.optimistic * w;
      covered++;
    });
    if (covered === 0) return null;
    return {
      base: parseFloat(baseSum.toFixed(2)),
      pessimistic: parseFloat(pessSum.toFixed(2)),
      optimistic: parseFloat(optSum.toFixed(2)),
      baseValue: parseFloat((totalValue * (1 + baseSum / 100)).toFixed(2)),
      pessValue: parseFloat((totalValue * (1 + pessSum / 100)).toFixed(2)),
      optValue: parseFloat((totalValue * (1 + optSum / 100)).toFixed(2)),
      totalValue: parseFloat(totalValue.toFixed(2)),
      covered, total: stocks.length,
    };
  }, [data, stocks]);

  const d = selected ? data[selected.ticker] : null;
  const pct = v => v > 0 ? `+${v}%` : `${v}%`;
  const col = v => v > 0 ? "#5EC98A" : v < 0 ? "#E87040" : "#888";

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>{"🔮 Previsioni 12 mesi"}</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Analisi storica + proiezione statistica basata su dati reali</div>
      </div>

      {portfolioForecast && (
        <div className="card" style={{ marginBottom: 20, border: "1px solid #2a2d35" }}>
          <div style={{ fontSize: 8, color: "#F4C542", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>
            {"◈ Proiezione portafoglio aggregata ("}{portfolioForecast.covered}/{portfolioForecast.total}{" titoli analizzati)"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[
              { l: "Pessimistico", pct: portfolioForecast.pessimistic, val: portfolioForecast.pessValue, c: "#E87040" },
              { l: "Base",         pct: portfolioForecast.base,        val: portfolioForecast.baseValue, c: "#F4C542" },
              { l: "Ottimistico",  pct: portfolioForecast.optimistic,  val: portfolioForecast.optValue,  c: "#5EC98A" },
            ].map(s => (
              <div key={s.l} style={{ textAlign: "center", padding: "12px 8px", background: "#0f1117", borderRadius: 6 }}>
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{s.l}</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 300, color: s.c }}>{pct(s.pct)}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{sym}{fmt(s.val * rate)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 9, color: "#333", textAlign: "center" }}>
            {"⚠️ Stime statistiche basate su dati storici. Non costituisce consulenza finanziaria."}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {stocks.map(s => (
          <button key={s.id} onClick={() => setSelected(s)}
            style={{ padding: "8px 14px", borderRadius: 6,
              border: `1px solid ${selected?.id === s.id ? "#F4C542" : "#1a1d26"}`,
              background: selected?.id === s.id ? "#1a1a0a" : "#0f1117",
              color: selected?.id === s.id ? "#F4C542" : "#888",
              cursor: "pointer", fontSize: 12, fontFamily: "inherit", transition: "all 0.15s" }}>
            {s.ticker}
            {data[s.ticker] && (
              <span style={{ marginLeft: 6, color: col(data[s.ticker].projection.base), fontSize: 10 }}>
                {pct(data[s.ticker].projection.base)}
              </span>
            )}
          </button>
        ))}
      </div>

      {!selected && !loading && (
        <div style={{ textAlign: "center", marginTop: 40, color: "#444", fontSize: 13 }}>
          {"↑ Seleziona un titolo per vedere l'analisi dettagliata"}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <Spinner size={20}/>
          <div style={{ color: "#444", fontSize: 12, marginTop: 10 }}>Analisi dati storici in corso…</div>
        </div>
      )}

      {error && <div style={{ color: "#E87040", textAlign: "center", marginTop: 30, fontSize: 13 }}>{"⚠️ "}{error}</div>}

      {d && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── PROIEZIONE + ANALISTI ── */}
          <div className="card">
            {/* Header con stats */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
                  📈 Proiezione 12 mesi — {selected.ticker}
                </div>
                <div style={{ fontSize: 10, color: "#555" }}>
                  Trend 3 anni: <span style={{ color: col(d.annualizedReturn) }}>{pct(d.annualizedReturn)}</span>
                  {" · "}Vol: <span style={{ color: "#666" }}>{d.annualVol}%</span>
                </div>
              </div>
              {/* Target analisti accanto */}
              {(() => {
                const a = analystData[selected?.ticker]?.analyst;
                if (!a?.targetMean) return null;
                const upside = selected.currentPrice ? (((a.targetMean - selected.currentPrice) / selected.currentPrice) * 100).toFixed(1) : null;
                return (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 8, color: "#F4C542", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>Target analisti</div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: "#F4C542" }}>${fmt(a.targetMean)}</div>
                    {upside && <div style={{ fontSize: 10, color: upside > 0 ? "#5EC98A" : "#E87040" }}>{upside > 0 ? "+" : ""}{upside}% upside</div>}
                  </div>
                );
              })()}
            </div>

            {/* Grafico con linea analisti */}
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={(() => {
                const a = analystData[selected?.ticker]?.analyst;
                if (!a?.targetMean) return d.projectionChart;
                // Aggiungi linea analisti al grafico: sale linearmente da prezzo attuale a target
                return d.projectionChart.map((pt, i) => ({
                  ...pt,
                  analyst: parseFloat((d.currentPrice + (a.targetMean - d.currentPrice) * (i / (d.projectionChart.length - 1))).toFixed(2))
                }));
              })()}>
                <defs>
                  <linearGradient id="optGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#5EC98A" stopOpacity={0.12}/>
                    <stop offset="95%" stopColor="#5EC98A" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="pessGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E87040" stopOpacity={0.08}/>
                    <stop offset="95%" stopColor="#E87040" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fill: "#333", fontSize: 9 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill: "#333", fontSize: 9 }} axisLine={false} tickLine={false} width={55}
                  tickFormatter={v => `$${v}`} domain={["auto","auto"]}/>
                <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 6, fontSize: 11, color: "#E8E6DF" }}
                  formatter={(v, n) => [`$${v}`, n === "base" ? "Proiezione base" : n === "optimistic" ? "Ottimistico" : n === "pessimistic" ? "Pessimistico" : "Target analisti"]}/>
                <Area type="monotone" dataKey="optimistic" stroke="#5EC98A" strokeWidth={1} strokeDasharray="3 3" fill="url(#optGrad2)" dot={false}/>
                <Area type="monotone" dataKey="pessimistic" stroke="#E87040" strokeWidth={1} strokeDasharray="3 3" fill="url(#pessGrad2)" dot={false}/>
                <Area type="monotone" dataKey="base" stroke="#F4C542" strokeWidth={2} fill="none" dot={false}/>
                {analystData[selected?.ticker]?.analyst?.targetMean && (
                  <Area type="monotone" dataKey="analyst" stroke="#7EB8F7" strokeWidth={2} strokeDasharray="6 3" fill="none" dot={false}/>
                )}
                <ReferenceLine y={d.currentPrice} stroke="#2a2d35" strokeDasharray="3 3"/>
              </AreaChart>
            </ResponsiveContainer>

            {/* Legenda */}
            <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
              {[
                { color: "#5EC98A", label: "Ottimistico", v: `$${d.projection.optimisticPriceTarget}`, pct: pct(d.projection.optimistic) },
                { color: "#F4C542", label: "Base",        v: `$${d.projection.basePriceTarget}`,       pct: pct(d.projection.base) },
                { color: "#E87040", label: "Pessimistico",v: `$${d.projection.pessimisticPriceTarget}`, pct: pct(d.projection.pessimistic) },
                ...(analystData[selected?.ticker]?.analyst?.targetMean ? [{ color: "#7EB8F7", label: "Analisti", v: `$${fmt(analystData[selected.ticker].analyst.targetMean)}`, pct: "" }] : []),
              ].map(s => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 20, height: 2, background: s.color, borderRadius: 1 }}/>
                  <span style={{ fontSize: 10, color: "#555" }}>{s.label}:</span>
                  <span style={{ fontSize: 10, color: s.color, fontWeight: 500 }}>{s.v}</span>
                  {s.pct && <span style={{ fontSize: 9, color: "#444" }}>({s.pct})</span>}
                </div>
              ))}
            </div>
          </div>

          {/* ── ANALYST RATINGS ── */}
          {(() => {
            const a = analystData[selected?.ticker]?.analyst;
            if (!a || (!a.targetMean && !a.recommendation && !a.buy && !a.hold && !a.sell)) return null;
            const rec = a.recommendation;
            const recColor = rec === "strongBuy" || rec === "buy" ? "#5EC98A" : rec === "hold" ? "#F4C542" : "#E87040";
            const recLabel = { strongBuy: "Acquisto Forte", buy: "Acquisto", hold: "Neutrale", sell: "Vendita", strongSell: "Vendita Forte" }[rec] || rec;
            const total = (a.strongBuy + a.buy + a.hold + a.sell + a.strongSell) || 1;
            const upside = a.currentPrice ? (((a.targetMean - a.currentPrice) / a.currentPrice) * 100).toFixed(1) : null;
            return (
              <div className="card" style={{ border: "1px solid #2a2d35" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 8, color: "#F4C542", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>
                      📊 Rating Analisti — {selected.ticker}
                    </div>
                    {a.numberOfAnalysts && (
                      <div style={{ fontSize: 10, color: "#444" }}>{a.numberOfAnalysts} analisti coperti</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: recColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>{recLabel}</div>
                    {upside && <div style={{ fontSize: 10, color: upside > 0 ? "#5EC98A" : "#E87040", marginTop: 2 }}>Upside: {upside > 0 ? "+" : ""}{upside}%</div>}
                  </div>
                </div>

                {/* Target price */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
                  {[
                    { l: "Target min", v: a.targetLow,  c: "#E87040" },
                    { l: "Target medio", v: a.targetMean, c: "#F4C542" },
                    { l: "Target max", v: a.targetHigh, c: "#5EC98A" },
                  ].map(t => t.v ? (
                    <div key={t.l} style={{ textAlign: "center", background: "#0f1117", borderRadius: 6, padding: "10px 6px" }}>
                      <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{t.l}</div>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: t.c }}>${fmt(t.v)}</div>
                      {a.currentPrice && (
                        <div style={{ fontSize: 9, color: t.c, marginTop: 2 }}>
                          {(((t.v - a.currentPrice) / a.currentPrice) * 100) > 0 ? "+" : ""}
                          {(((t.v - a.currentPrice) / a.currentPrice) * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  ) : null)}
                </div>

                {/* Consensus bar */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Consenso analisti</div>
                  <div style={{ display: "flex", borderRadius: 4, overflow: "hidden", height: 8 }}>
                    {[
                      { key: "strongBuy", color: "#2E7D32", val: a.strongBuy },
                      { key: "buy",       color: "#5EC98A", val: a.buy },
                      { key: "hold",      color: "#F4C542", val: a.hold },
                      { key: "sell",      color: "#E87040", val: a.sell },
                      { key: "strongSell",color: "#B71C1C", val: a.strongSell },
                    ].map(b => b.val > 0 ? (
                      <div key={b.key} style={{ background: b.color, width: `${(b.val/total)*100}%`, transition: "width 0.3s" }}/>
                    ) : null)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    {[
                      { label: "Forte acq.", val: a.strongBuy, color: "#2E7D32" },
                      { label: "Acquisto",   val: a.buy,       color: "#5EC98A" },
                      { label: "Neutrale",   val: a.hold,      color: "#F4C542" },
                      { label: "Vendita",    val: a.sell,      color: "#E87040" },
                      { label: "Forte vend.", val: a.strongSell, color: "#B71C1C" },
                    ].filter(b => b.val > 0).map(b => (
                      <div key={b.label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: b.color }}>{b.val}</div>
                        <div style={{ fontSize: 8, color: "#444" }}>{b.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Key stats */}
                {(a.forwardPE || a.beta) && (
                  <div style={{ display: "flex", gap: 16, paddingTop: 12, borderTop: "1px solid #1a1d26" }}>
                    {a.forwardPE && <div><span style={{ fontSize: 9, color: "#444" }}>Forward P/E: </span><span style={{ fontSize: 11, color: "#888" }}>{a.forwardPE.toFixed(1)}</span></div>}
                    {a.beta && <div><span style={{ fontSize: 9, color: "#444" }}>Beta: </span><span style={{ fontSize: 11, color: "#888" }}>{a.beta.toFixed(2)}</span></div>}
                    {a.shortRatio && <div><span style={{ fontSize: 9, color: "#444" }}>Short ratio: </span><span style={{ fontSize: 11, color: "#888" }}>{a.shortRatio.toFixed(1)}</span></div>}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>
              🔍 Analisi storica — {selected.ticker} a questo prezzo (±7%)
            </div>
            {d.occurrences === 0 ? (
              <div style={{ color: "#555", fontSize: 12 }}>Nessun caso storico trovato a questo livello di prezzo.</div>
            ) : (
              <>
                {/* KPI row */}
                <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
                  {[
                    { l: "Casi trovati",  v: d.occurrences,     c: "#888",    sub: "occorrenze storiche" },
                    { l: "Win Rate",      v: `${d.winRate}%`,   c: d.winRate >= 50 ? "#5EC98A" : "#E87040", sub: "volte in positivo" },
                    { l: "Rend. medio",   v: pct(d.avgOutcome), c: col(d.avgOutcome), sub: "dopo 12 mesi" },
                    { l: "Miglior caso",  v: `+${d.maxGain}%`,  c: "#5EC98A", sub: "massimo storico" },
                    { l: "Peggior caso",  v: `${d.maxLoss}%`,   c: "#E87040", sub: "minimo storico" },
                  ].map((k, i) => (
                    <div key={k.l} style={{ flex: 1, textAlign: "center", borderRight: i < 4 ? "1px solid #1a1d26" : "none", padding: "0 8px" }}>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: k.c, fontWeight: 300 }}>{k.v}</div>
                      <div style={{ fontSize: 8, color: "#333", marginTop: 3 }}>{k.l}</div>
                      <div style={{ fontSize: 8, color: "#2a2d35", marginTop: 1 }}>{k.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Barre orizzontali casi storici */}
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
                  Dettaglio casi storici
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {d.historicalOutcomes.slice().reverse().map((o, i) => {
                    const isPos = o.pct >= 0;
                    const maxAbs = Math.max(...d.historicalOutcomes.map(x => Math.abs(x.pct)));
                    const barW = maxAbs > 0 ? Math.abs(o.pct) / maxAbs * 100 : 0;
                    return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 60px", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#444", textAlign: "right" }}>{o.date}</span>
                        <div style={{ position: "relative", height: 20, background: "#0f1117", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            position: "absolute", top: 0, bottom: 0,
                            left: isPos ? "50%" : `calc(50% - ${barW/2}%)`,
                            width: `${barW/2}%`,
                            background: isPos ? "#5EC98A" : "#E87040",
                            opacity: 0.7,
                            borderRadius: isPos ? "0 2px 2px 0" : "2px 0 0 2px",
                          }}/>
                          <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "#2a2d35" }}/>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: isPos ? "#5EC98A" : "#E87040" }}>{pct(o.pct)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>
              {"📅 Stagionalità storica — rendimento medio per mese"}
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={d.seasonality} barSize={22}>
                <XAxis dataKey="month" tick={{ fill: "#444", fontSize: 9 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill: "#444", fontSize: 9 }} axisLine={false} tickLine={false} width={35}
                  tickFormatter={v => `${v}%`}/>
                <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11 }}
                  formatter={v => [`${v}%`, "Rendimento medio"]}/>
                <ReferenceLine y={0} stroke="#333"/>
                <Bar dataKey="avgReturn" radius={[3,3,0,0]}>
                  {d.seasonality.map((entry, index) => (
                    <Cell key={index} fill={entry.avgReturn >= 0 ? "#5EC98A" : "#E87040"}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>
      )}

      <div style={{ marginTop: 20, fontSize: 9, color: "#2a2d35", textAlign: "center" }}>
        {"⚠️ Tutte le proiezioni sono stime statistiche basate su performance storiche. I rendimenti passati non garantiscono risultati futuri. Non costituisce consulenza finanziaria."}
      </div>
    </div>
  );
}

function DividendiTab({ stocks, fmt, fmtPct, sym, rate }) {
  const [divData, setDivData] = useState({});
  const [loading, setLoading] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || stocks.length === 0) return;
    setLoaded(true);
    stocks.forEach(stock => {
      setLoading(l => ({ ...l, [stock.ticker]: true }));
      fetch(`${API_BASE}/api/dividends?symbol=${encodeURIComponent(stock.ticker)}`)
        .then(r => r.json())
        .then(d => {
          setDivData(prev => ({ ...prev, [stock.ticker]: { ...d, qty: stock.qty } }));
          setLoading(l => ({ ...l, [stock.ticker]: false }));
        })
        .catch(() => setLoading(l => ({ ...l, [stock.ticker]: false })));
    });
  }, [stocks.length]);

  // Calcola totali
  const stocksWithDiv = stocks
    .filter(s => divData[s.ticker]?.annualDividend > 0)
    .map(s => ({ ...s, div: divData[s.ticker] }));

  const totalAnnualIncome = stocksWithDiv.reduce((sum, s) => sum + (s.div.annualDividend * s.qty), 0);
  const totalMonthlyIncome = totalAnnualIncome / 12;
  const totalInvested = stocks.reduce((sum, s) => sum + s.qty * s.buyPrice, 0);
  const portfolioYield = totalInvested > 0 ? (totalAnnualIncome / totalInvested) * 100 : 0;

  // Proiezione 12 mesi
  const freqDaysMap = { "Mensile": 30, "Trimestrale": 91, "Semestrale": 182, "Annuale": 365 };
  const projection12m = [];
  const now12 = new Date();
  const end12m = new Date(); end12m.setFullYear(end12m.getFullYear() + 1);
  stocksWithDiv.forEach(s => {
    if (!s.div.frequency) return;
    const freqDays = freqDaysMap[s.div.frequency] || 91;
    const lastHistTs = s.div.history?.slice(-1)[0]?.dateTs;
    let nextTs = lastHistTs ? new Date(lastHistTs * 1000) : new Date();
    while (nextTs <= now12) nextTs = new Date(nextTs.getTime() + freqDays * 86400000);
    while (nextTs <= end12m) {
      projection12m.push({
        date: nextTs,
        dateStr: nextTs.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }),
        monthKey: nextTs.toLocaleDateString("it-IT", { month: "short", year: "2-digit" }),
        ticker: s.ticker,
        amount: (s.div.lastAmount || 0) * s.qty,
      });
      nextTs = new Date(nextTs.getTime() + freqDays * 86400000);
    }
  });
  projection12m.sort((a, b) => a.date - b.date);
  const byMonth = {};
  projection12m.forEach(p => {
    if (!byMonth[p.monthKey]) byMonth[p.monthKey] = { month: p.monthKey, total: 0, items: [] };
    byMonth[p.monthKey].total = parseFloat((byMonth[p.monthKey].total + p.amount).toFixed(2));
    byMonth[p.monthKey].items.push(p);
  });
  const monthlyChart = Object.values(byMonth);

  // Prossimi dividendi ordinati per data
  const upcoming = stocksWithDiv
    .filter(s => s.div.nextDate)
    .sort((a, b) => new Date(a.div.nextDate) - new Date(b.div.nextDate));

  // Storico aggregato tutti i titoli
  const allHistory = stocksWithDiv.flatMap(s =>
    (s.div.history || []).map(h => ({ ...h, ticker: s.ticker, totalAmount: h.amount * s.qty }))
  ).sort((a, b) => b.dateTs - a.dateTs).slice(0, 30);

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>💰 Dividendi & Cedole</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Tracking completo dei dividendi del tuo portafoglio</div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { l: "Reddito Annuale", v: `${sym}${fmt(totalAnnualIncome * rate)}`, sub: `€${fmt(totalAnnualIncome * rate)}`, c: "#5EC98A" },
          { l: "Reddito Mensile", v: `${sym}${fmt(totalMonthlyIncome * rate)}`, sub: "media mensile stimata", c: "#F4C542" },
          { l: "Yield Portafoglio", v: `${portfolioYield.toFixed(2)}%`, sub: "dividend yield medio", c: "#7EB8F7" },
        ].map(k => (
          <div key={k.l} className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{k.l}</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, color: k.c }}>{k.v}</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Per titolo */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Dividendi per titolo</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1a1d26" }}>
              {["Ticker", "Yield", "Div/Azione", "Frequenza", "Reddito Annuale", "Prossimo Stacco"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stocks.map(s => {
              const d = divData[s.ticker];
              const isLoading = loading[s.ticker];
              return (
                <tr key={s.id} style={{ borderBottom: "1px solid #0f1117" }}>
                  <td style={{ padding: "10px 10px", color: "#E8E6DF", fontWeight: 500 }}>{s.ticker}</td>
                  <td style={{ padding: "10px 10px", color: d?.yieldPct > 0 ? "#5EC98A" : "#555" }}>
                    {isLoading ? <Spinner size={9}/> : d?.yieldPct > 0 ? `${d.yieldPct.toFixed(2)}%` : "—"}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#E8E6DF" }}>
                    {isLoading ? "…" : d?.lastAmount > 0 ? `$${d.lastAmount.toFixed(4)}` : "—"}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#888" }}>
                    {isLoading ? "…" : d?.frequency || "—"}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#5EC98A" }}>
                    {isLoading ? "…" : d?.annualDividend > 0 ? `$${fmt(d.annualDividend * s.qty)}` : "—"}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#F4C542" }}>
                    {isLoading ? "…" : d?.nextDate || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Prossimi stacchi */}
      {upcoming.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>📅 Prossimi stacchi cedola</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {upcoming.map(s => (
              <div key={s.ticker} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#0f1117", borderRadius: 6, border: "1px solid #1a1d26" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{s.ticker}</span>
                  <span style={{ fontSize: 10, color: "#555" }}>{s.div.frequency}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, color: "#F4C542" }}>{s.div.nextDate}</div>
                  <div style={{ fontSize: 10, color: "#5EC98A" }}>+${fmt(s.div.lastAmount * s.qty)} stimati</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proiezione 12 mesi */}
      {monthlyChart.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>📆 Proiezione dividendi — prossimi 12 mesi</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyChart} barSize={28}>
              <XAxis dataKey="month" tick={{ fill: "#444", fontSize: 9 }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fill: "#444", fontSize: 9 }} axisLine={false} tickLine={false} width={45} tickFormatter={v => `$${v}`}/>
              <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }}
                formatter={v => [`$${v.toFixed(2)}`, "Dividendo stimato"]}/>
              <Bar dataKey="total" fill="#F4C542" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {projection12m.slice(0, 8).map((p, i) => (
              <div key={i} style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 4, padding: "6px 10px", fontSize: 10 }}>
                <span style={{ color: "#F4C542", fontWeight: 500 }}>{p.ticker}</span>
                <span style={{ color: "#555", marginLeft: 6 }}>{p.dateStr}</span>
                <span style={{ color: "#5EC98A", marginLeft: 6 }}>+${p.amount.toFixed(2)}</span>
              </div>
            ))}
            {projection12m.length > 8 && <div style={{ fontSize: 10, color: "#444", padding: "6px 4px" }}>+{projection12m.length - 8} altri</div>}
          </div>
        </div>
      )}

      {/* Storico ultimi dividendi */}
      {allHistory.length > 0 && (
        <div className="card">
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>📜 Storico dividendi ricevuti</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {allHistory.map((h, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 4, background: i % 2 === 0 ? "#0f1117" : "transparent" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#E8E6DF", minWidth: 50 }}>{h.ticker}</span>
                  <span style={{ fontSize: 11, color: "#555" }}>{h.date}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 12, color: "#5EC98A" }}>+${fmt(h.totalAmount)}</span>
                  <span style={{ fontSize: 9, color: "#444", marginLeft: 8 }}>${h.amount}/az.</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 10, color: "#333" }}>
            ⚠️ Storico basato su dati Yahoo Finance. Importi calcolati sulla quantità attuale in portafoglio.
          </div>
        </div>
      )}

      {stocksWithDiv.length === 0 && !Object.values(loading).some(Boolean) && (
        <div style={{ textAlign: "center", marginTop: 60, color: "#444", fontSize: 13 }}>
          Nessun dividendo trovato per i titoli in portafoglio.
        </div>
      )}
    </div>
  );
}

function WhatIfTab({ fmt, fmtPct, eurRate }) {
  const [ticker, setTicker] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split("T")[0];
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function simulate() {
    const t = ticker.trim().toUpperCase();
    const amt = parseFloat(amount);
    if (!t || !amt || !date) return setErr("Compila tutti i campi.");
    setErr(""); setLoading(true); setResult(null);
    try {
      // Current price
      const curRes = await fetch(`${API_BASE}/api/price?symbol=${t}`);
      const curData = await curRes.json();
      const currentPrice = curData.price;
      if (!currentPrice) { setErr("Ticker non trovato o prezzo non disponibile."); setLoading(false); return; }

      const buyDate = new Date(date);
      const today = new Date();
      const daysDiff = Math.round((today - buyDate) / (1000 * 60 * 60 * 24));

      // Fetch dati storici reali da Yahoo Finance (illimitati)
      const histRes = await fetch(`${API_BASE}/api/history?symbol=${t}&from=${date}`);
      const histData = await histRes.json();
      const candles = histData.candles || [];

      if (!candles.length) {
        setErr("Dati storici non disponibili per questa data e questo titolo.");
        setLoading(false);
        return;
      }

      // Prima candle = prezzo alla data di acquisto
      const buyPrice = candles[0].price;

      // Grafico: tutte le candle dalla data di acquisto
      const chartData = candles.map(c => ({
        date: c.date,
        valore: parseFloat(((amt / buyPrice) * c.price).toFixed(2)),
      }));
      // Assicura che l'ultima candle sia il prezzo attuale
      if (chartData.length) chartData[chartData.length - 1].valore = parseFloat(((amt / buyPrice) * currentPrice).toFixed(2));

      const shares = amt / buyPrice;
      const currentValue = shares * currentPrice;
      const pnl = currentValue - amt;
      const pct = (pnl / amt) * 100;

      setResult({ ticker: t, amount: amt, shares: parseFloat(shares.toFixed(4)), buyPrice, currentPrice, currentValue, pnl, pct, chartData, date, real: true });
    } catch (e) {
      setErr("Errore nel calcolo. Riprova.");
    }
    setLoading(false);
  }

  // Preset examples
  const presets = [
    { label: "AAPL 1 anno fa", ticker: "AAPL", date: (() => { const d = new Date(); d.setFullYear(d.getFullYear()-1); return d.toISOString().split("T")[0]; })() },
    { label: "NVDA 2 anni fa", ticker: "NVDA", date: (() => { const d = new Date(); d.setFullYear(d.getFullYear()-2); return d.toISOString().split("T")[0]; })() },
    { label: "MSFT 5 anni fa", ticker: "MSFT", date: (() => { const d = new Date(); d.setFullYear(d.getFullYear()-5); return d.toISOString().split("T")[0]; })() },
  ];

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>E se avessi comprato…?</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Scopri quanto varrebbe oggi un investimento passato</div>
      </div>

      {/* Form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <TickerAutocomplete value={ticker} onChange={v => setTicker(v)} onSelect={t => setTicker(t.ticker)} />
          <div style={{ flex: "0 0 140px" }}>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Data acquisto</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} max={new Date().toISOString().split("T")[0]} style={{ colorScheme: "dark" }}/>
          </div>
          <div style={{ flex: "0 0 130px" }}>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Importo investito ($)</div>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1000"/>
          </div>
          <button className="add-btn" onClick={simulate} disabled={loading}>
            {loading ? <><Spinner color="#0D0F14" size={10}/> Calcolo…</> : "Simula →"}
          </button>
        </div>
        {err && <div style={{ fontSize: 11, color: "#E87040", marginTop: 10 }}>{err}</div>}

        {/* Presets */}
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, color: "#333", alignSelf: "center" }}>Prova con:</span>
          {presets.map(p => (
            <button key={p.label} onClick={() => { setTicker(p.ticker); setDate(p.date); setAmount("1000"); }}
              style={{ background: "none", border: "1px solid #2a2d35", color: "#555", fontFamily: "inherit", fontSize: 10, padding: "4px 10px", borderRadius: 3, cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={e => { e.target.style.borderColor="#F4C542"; e.target.style.color="#F4C542"; }}
              onMouseLeave={e => { e.target.style.borderColor="#2a2d35"; e.target.style.color="#555"; }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="fade-up">
          {/* Big result */}
          <div className="card" style={{ marginBottom: 16, textAlign: "center", padding: "28px 20px", border: `1px solid ${result.pct >= 0 ? "#5EC98A33" : "#E8704033"}` }}>
            <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>
              ${fmt(result.amount)} in {result.ticker} il {new Date(result.date).toLocaleDateString("it-IT")}




            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 44, fontWeight: 300, color: result.pct >= 0 ? "#5EC98A" : "#E87040", lineHeight: 1 }}>
              ${fmt(result.currentValue)}
            </div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>€{fmt(result.currentValue * eurRate)}</div>
            <div style={{ fontSize: 20, color: result.pct >= 0 ? "#5EC98A" : "#E87040", marginTop: 12, fontWeight: 500 }}>
              {result.pct >= 0 ? "+" : ""}${fmt(Math.abs(result.pnl))} · {fmtPct(result.pct)}
            </div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 8 }}>
              {result.shares} azioni · acquisto ${fmt(result.buyPrice)} → oggi ${fmt(result.currentPrice)}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { l: "Investito", v: `$${fmt(result.amount)}` },
              { l: "Valore oggi", v: `$${fmt(result.currentValue)}`, c: result.pct >= 0 ? "#5EC98A" : "#E87040" },
              { l: "Rendimento", v: fmtPct(result.pct), c: result.pct >= 0 ? "#5EC98A" : "#E87040" },
            ].map(k => (
              <div key={k.l} className="card" style={{ textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{k.l}</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 300, color: k.c || "#E8E6DF" }}>{k.v}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Andamento investimento</div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={result.chartData}>
                <defs>
                  <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={result.pct >= 0 ? "#5EC98A" : "#E87040"} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={result.pct >= 0 ? "#5EC98A" : "#E87040"} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor(result.chartData.length / 5)}/>
                <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={55} tickFormatter={v => `$${(v/1000).toFixed(1)}k`}/>
                <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={v => [`$${fmt(v)}`, "Valore"]}/>
                <ReferenceLine y={result.amount} stroke="#F4C542" strokeDasharray="4 3" strokeWidth={1} label={{ value: "Investito", fill: "#F4C542", fontSize: 8, position: "insideTopRight" }}/>
                <Area type="monotone" dataKey="valore" stroke={result.pct >= 0 ? "#5EC98A" : "#E87040"} strokeWidth={1.5} fill="url(#wg)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);

  // Check Supabase session on mount
  useEffect(() => {
    getSession().then(u => {
      if (u) setUser({ id: u.id, email: u.email, name: u.user_metadata?.name || u.email.split("@")[0] });
      setUserLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email, name: session.user.user_metadata?.name || session.user.email.split("@")[0] });
      } else {
        setUser(null);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  const [plan, setPlanRaw] = useState(() => ls("pt_plan", "free"));
  const [showUpgrade, setShowUpgrade] = useState(false);
  const currency = "USD";
  const sym = "$";
  const rate = 1;
  const [eurRate, setEurRate] = useState(0.92); // live EUR/USD rate

  // Fetch live EUR rate on mount
  useEffect(() => {
    fetch("https://api.exchangerate-api.com/v4/latest/USD")
      .then(r => r.json())
      .then(d => {
        if (d.rates?.EUR) {
          const liveEur = parseFloat(d.rates.EUR.toFixed(4));
          setEurRate(liveEur);
          CURRENCIES.EUR.rate = liveEur; // aggiorna tasso live
        }
      })
      .catch(() => {});
  }, []);

  const setPlan = (p) => { setPlanRaw(p); lsSet("pt_plan", p); };

  const [stocks, setStocksRaw] = useState([]);
  const [notes, setNotesRaw] = useState({});
  const [alerts, setAlertsRaw] = useState({});
  const [dataLoading, setDataLoading] = useState(false);
  const [marketOpen, setMarketOpen] = useState(null);
  const [stockStates, setStockStates] = useState({});

  // Load data from Supabase when user logs in
  useEffect(() => {
    if (!user) { setStocksRaw([]); setNotesRaw({}); setAlertsRaw({}); return; }
    setDataLoading(true);
    Promise.all([loadStocks(user.id), loadNotes(user.id), loadAlerts(user.id)]).then(([dbStocks, dbNotes, dbAlerts]) => {
      const mapped = dbStocks.map(s => ({
        id: s.id, dbId: s.id,
        ticker: s.ticker, qty: s.qty, buyPrice: s.buy_price,
        currentPrice: s.current_price || s.buy_price,
        sector: s.sector, buyDate: s.buy_date, priceReal: s.price_real,
        targetPrice: s.target_price ?? null,
        stopLoss: s.stop_loss ?? null,
        history: simulateHistory(s.current_price || s.buy_price)
      }));

      setStocksRaw(mapped.length > 0 ? mapped : []);
      setNotesRaw(dbNotes);
      setAlertsRaw(dbAlerts);
      setDataLoading(false);

      // 🔄 Refresh prezzi sempre al login — serve per marketState e badge corretti
      if (mapped.length > 0) {
        mapped.forEach(stock => {
          // Fix settore mancante: prima controlla ETF noti, poi Yahoo
          const needsSector = !stock.sector || stock.sector === "Altro" || stock.sector === "—";
          const KNOWN_ETFS = ["QQQ","SPY","IVV","VOO","VTI","VEA","VWO","XLE","XLF","XLK","XLV","XLI","XLP","XLY","XLB","XLU","XLRE","XLC","GLD","SLV","TLT","IEF","HYG","LQD","ARKK","ARKG","IWM","EEM","UUP","CQQQ","TIPS","BIL","SHY"];
          if (needsSector) {
            if (KNOWN_ETFS.includes(stock.ticker.toUpperCase())) {
              setStocksRaw(prev => prev.map(s => s.id === stock.id ? { ...s, sector: "ETF" } : s));
              if (stock.dbId) saveStock(user.id, { ...stock, sector: "ETF", dbId: stock.dbId }).catch(() => {});
            } else {
              fetch(`${API_BASE}/api/search?q=${encodeURIComponent(stock.ticker)}`)
                .then(r => r.json())
                .then(d => {
                  const match = d.results?.find(r => r.ticker === stock.ticker);
                  if (match?.sector && match.sector !== "Altro") {
                    setStocksRaw(prev => prev.map(s => s.id === stock.id ? { ...s, sector: match.sector } : s));
                    if (stock.dbId) saveStock(user.id, { ...stock, sector: match.sector, dbId: stock.dbId }).catch(() => {});
                  }
                }).catch(() => {});
            }
          }

          fetchRealPrice(stock.ticker, true).then(result => {
            if (!result) return;
            const livePrice = result.price;
            const ms = result.marketState || "CLOSED";
            setStocksRaw(prev => prev.map(s => s.id === stock.id
              ? { ...s, currentPrice: livePrice, priceReal: true, marketState: ms,
                  prevClose: result.prevClose || livePrice,
                  change: result.change || 0,
                  changePct: result.changePct || 0 }
              : s
            ));
            setStockStates(prev => ({ ...prev, [stock.ticker]: ms }));
            if (stock.dbId && ms !== "CLOSED") {
              saveStock(user.id, {
                ...stock,
                buyPrice: stock.buyPrice,
                currentPrice: livePrice,
                priceReal: true,
                dbId: stock.dbId,
              }).catch(() => {});
            }
          });
        });
      }
    }).catch(() => {
      setStocksRaw([]);
      setDataLoading(false);
    });
  }, [user?.id]);

  const setStocks = fn => setStocksRaw(prev => typeof fn === "function" ? fn(prev) : fn);
  const setNotes  = fn => setNotesRaw(prev => typeof fn === "function" ? fn(prev) : fn);
  const setAlerts = fn => setAlertsRaw(prev => typeof fn === "function" ? fn(prev) : fn);

  const [activeTabRaw, setActiveTabRaw] = useState("overview");
  const activeTab = activeTabRaw;
  const setActiveTab = (t) => setActiveTabRaw(t);
  const [selectedId, setSelectedId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);


  // Controlla status mercati via API Finnhub
  useEffect(() => {
    fetch(`${API_BASE}/api/market-status`)
      .then(r => r.json())
      .then(d => setMarketOpen(d.isOpen))
      .catch(() => {
        const now = new Date();
        const day = now.getDay();
        if (day === 0 || day === 6) { setMarketOpen(false); return; }
        const h = now.getUTCHours() + 1;
        const t = h + now.getUTCMinutes() / 60;
        setMarketOpen((t >= 9 && t < 17.5) || (t >= 15.5 && t < 22));
      });
  }, []);

  function refreshPrices() {
    if (refreshing || stocks.length === 0) return;
    setRefreshing(true);
    let done = 0;
    stocks.forEach(stock => {
      fetchRealPrice(stock.ticker, true).then(result => {
        if (result) {
          const livePrice = result.price;
          const ms = result.marketState || "CLOSED";
          setStocksRaw(prev => prev.map(s => s.id === stock.id
            ? { ...s, currentPrice: livePrice, priceReal: true, marketState: ms }
            : s
          ));
          setStockStates(prev => ({ ...prev, [stock.ticker]: ms }));
          if (stock.dbId) saveStock(user.id, { ...stock, buyPrice: stock.buyPrice, currentPrice: livePrice, priceReal: true, dbId: stock.dbId }).catch(() => {});
        }
        done++;
        if (done === stocks.length) setRefreshing(false);
      });
    });
  }

  // Helper badge stato mercato per un ticker

  const [chartPeriod, setChartPeriod] = useState(30); // 30, 90, 180, 365
  const [periodHistory, setPeriodHistory] = useState({});
  const [periodLoading, setPeriodLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importErr, setImportErr] = useState("");
  const csvInputRef = useRef(null);
  const [form, setForm] = useState({ ticker: "", qty: "", buyPrice: "", sector: "Altro", buyDate: new Date().toISOString().split("T")[0] });
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

  // YTD benchmark — costruito sui prezzi reali, non sulla history simulata
  const ytdHistory = (() => {
    if (!stocks.length) return [];
    const days = 30;
    // S&P500 YTD 2024 reale: ~+24%. Usiamo un valore fisso realistico
    const spxYTD = 8.2; // YTD simulato S&P500 periodo corrente
    const result = [];
    for (let i = 0; i <= days; i++) {
      const progress = i / days;
      // Portfolio: interpolazione lineare da 0% a totalPct
      const portPct = parseFloat((totalPct * progress).toFixed(2));
      // S&P500: interpolazione lineare con piccolo rumore
      const noise = (Math.random() - 0.5) * 0.3;
      const spx = parseFloat((spxYTD * progress + noise).toFixed(2));
      const d = new Date(); d.setDate(d.getDate() - (days - i));
      result.push({
        date: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
        portafoglio: portPct,
        spx,
      });
    }
    return result;
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
    // Valida sempre il ticker — se non esiste blocca l'aggiunta
    const realPrice = await fetchRealPrice(t);
    if (!realPrice) {
      setFormErr(`Ticker "${t}" non trovato. Verifica il simbolo e riprova.`);
      setAdding(false);
      return;
    }
    const curPrice = realPrice;
    const history = simulateHistory(curPrice);
    if (realPrice) history[history.length - 1].price = realPrice;
    // Converti data da YYYY-MM-DD a dd/mm/yy
    const rawDate = form.buyDate || new Date().toISOString().split("T")[0];
    const dp = rawDate.split("-");
    const buyDateFormatted = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0].slice(2)}` : new Date().toLocaleDateString("it-IT");
    const ns = { ticker: t, qty: q, buyPrice: p, currentPrice: parseFloat(curPrice.toFixed(2)), history, sector: form.sector || "Altro", priceReal: !!realPrice, buyDate: buyDateFormatted };
    // Save to Supabase if logged in
    let dbId = null;
    if (user) {
      try { const saved = await saveStock(user.id, ns); dbId = saved.id; } catch {}
    }
    const withId = { ...ns, id: dbId || nextId.current++, dbId };
    setStocks(prev => [...prev, withId]);
    setSelectedId(withId.id);
    setForm({ ticker: "", qty: "", buyPrice: "", sector: "Altro", buyDate: new Date().toISOString().split("T")[0] });
    setAdding(false); setShowForm(false);
    // Auto-refresh prezzo live dopo aggiunta
    fetchRealPrice(t, true).then(result => {
      if (!result) return;
      setStocksRaw(prev => prev.map(s => s.ticker === t && !s.priceReal
        ? { ...s, currentPrice: result.price, priceReal: true, marketState: result.marketState || "CLOSED",
            prevClose: result.prevClose || result.price }
        : s
      ));
    }).catch(() => {});
  }

  function handleRemove(id) {
    const stock = stocks.find(s => s.id === id);
    if (stock?.dbId && user) deleteStock(stock.dbId).catch(() => {});
    setStocks(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(stocks.find(s => s.id !== id)?.id || null);
  }

  function handleEdit(updated) {
    // Prendi lo stock corrente per avere currentPrice e campi mancanti
    const current = stocks.find(s => s.id === updated.id) || {};
    const merged = { ...current, ...updated };
    setStocks(prev => prev.map(s => s.id === updated.id ? merged : s));
    if (merged.dbId && user) {
      saveStock(user.id, {
        ticker: merged.ticker,
        qty: parseFloat(merged.qty) || current.qty,
        buyPrice: parseFloat(merged.buyPrice) || current.buyPrice,
        currentPrice: merged.currentPrice || current.currentPrice,
        sector: merged.sector || current.sector || "Altro",
        buyDate: merged.buyDate || current.buyDate,
        priceReal: merged.priceReal || false,
        targetPrice: parseFloat(merged.targetPrice) || null,
        stopLoss: parseFloat(merged.stopLoss) || null,
        dbId: merged.dbId,
      }).catch(e => console.error("✗ Errore salvataggio:", e));
    }
  }

  function handleSaveTargets(stockId, targetPrice, stopLoss) {
    const stock = stocks.find(s => s.id === stockId);
    if (!stock) return;
    setStocks(prev => prev.map(s => s.id === stockId ? { ...s, targetPrice: targetPrice || null, stopLoss: stopLoss || null } : s));
    if (stock.dbId && user) {
      saveStock(user.id, {
        ticker: stock.ticker, qty: stock.qty, buyPrice: stock.buyPrice,
        currentPrice: stock.currentPrice, sector: stock.sector,
        buyDate: stock.buyDate, priceReal: stock.priceReal,
        targetPrice: targetPrice || null, stopLoss: stopLoss || null,
        dbId: stock.dbId,
      }).catch(e => console.error("Errore salvataggio target/stop:", e));
    }
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
    const text = await fetchAIAnalysis(stock, notes[stock.id], sym, currency);
    setAiText(t => ({ ...t, [stock.id]: text }));
    setAiLoading(l => ({ ...l, [stock.id]: false }));
  }

  const planCtx = { plan, setPlan, setShowUpgrade };
  const currCtx = { currency, sym, rate, eurRate };

  if (userLoading) return (
    <div style={{ minHeight: "100vh", background: "#0D0F14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600&display=swap'); *{box-sizing:border-box;margin:0;padding:0} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 300, color: "#F4C542", marginBottom: 16 }}>Portfolio</div>
        <span style={{ display: "inline-block", width: 16, height: 16, borderRadius: "50%", border: "2px solid #F4C542", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
      </div>
    </div>
  );

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
            input:focus,textarea:focus,select:focus{border-color:#F4C542} input::placeholder,textarea::placeholder{color:#3a3d45}
            select{cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23555'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px}
            input[type="date"]{color-scheme:dark}
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

            /* ── MOBILE ── */
            @media(max-width:768px){
              .desktop-sidebar{display:none!important}
              .desktop-tabs{display:none!important}
              .mobile-nav{display:flex!important}
              .mobile-header-actions .action-btn{font-size:10px;padding:5px 8px}
              .main-content{padding:12px 12px 80px!important}
              .header-logo span:last-child{display:none}
              .kpi-grid{grid-template-columns:repeat(2,1fr)!important}
              .comparison-grid{grid-template-columns:1fr!important}
              .card{padding:12px 14px!important}
              table{font-size:11px!important}
              th,td{padding:8px 6px 8px 0!important;font-size:10px!important}
              .add-btn{font-size:12px;padding:9px 16px}
              .action-btn{font-size:10px;padding:5px 8px}
              input,select,textarea{font-size:14px!important} /* prevents iOS zoom */
              .hide-mobile{display:none!important}
            }
            @media(min-width:769px){
              .mobile-nav{display:none!important}
              .mobile-portfolio-header{display:none!important}
            }
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
          <div style={{ padding: "0 16px 0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #161820", height: 52, gap: 10 }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 300, color: "#F4C542" }}>Portfolio</span>
              <span className="hide-mobile" style={{ fontSize: 9, color: "#2a2d35", letterSpacing: "0.2em", textTransform: "uppercase" }}>Tracker</span>
              {plan === "pro" && <span style={{ fontSize: 8, background: "#F4C542", color: "#0D0F14", padding: "2px 6px", borderRadius: 2, fontWeight: 700, letterSpacing: "0.1em" }}>PRO</span>}
            </div>
            {/* Desktop tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", flex: 1, justifyContent: "center" }} className="desktop-tabs">
              {["overview","confronto","alert","simulazioni","whatif","dividendi","previsioni"].map(t => (
                <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                  {t === "whatif" ? "e se?" : t === "dividendi" ? "💰 dividendi" : t === "previsioni" ? "🔮 previsioni" : t}
                </button>
              ))}
            </div>
            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {plan === "free" && <button className="action-btn" onClick={() => setShowUpgrade(true)} style={{ color: "#F4C542", borderColor: "#F4C542", fontSize: 10, padding: "4px 8px" }}>✦ Pro</button>}
              <button className="action-btn hide-mobile" onClick={() => setShowImport(v => !v)}>↑ CSV</button>
              {plan === "pro" && <>
                <button onClick={exportCSV} className="action-btn hide-mobile" style={{ fontSize: 9, padding: "4px 10px" }}>↓ CSV</button>
                <button onClick={exportPDF} className="action-btn hide-mobile" style={{ fontSize: 9, padding: "4px 10px" }}>↓ PDF</button>
              </>}
              <button onClick={refreshPrices} disabled={refreshing || !marketOpen} title={marketOpen === null ? "Verifica mercati..." : marketOpen ? "Mercati aperti — clicca per aggiornare" : "Mercati chiusi"}
                className="action-btn"
                style={{ display: "flex", alignItems: "center", gap: 5, opacity: (!marketOpen || refreshing) ? 0.5 : 1, fontSize: 11 }}>
                {refreshing
                  ? <Spinner size={10}/>
                  : <span style={{ width: 7, height: 7, borderRadius: "50%", background: marketOpen === null ? "#888" : marketOpen ? "#4CAF50" : "#E87040", display: "inline-block", flexShrink: 0 }}/>
                }
                <span className="hide-mobile">{marketOpen === null ? "..." : marketOpen ? "Live" : "Chiusi"}</span>
              </button>
              <button className="add-btn" onClick={() => setShowForm(v => !v)} style={{ fontSize: 11, padding: "6px 12px" }}>{showForm ? "✕" : "+ Aggiungi"}</button>
              {/* Mobile: user avatar button */}
              <button onClick={() => signOut().then(() => setUser(null))}
                style={{ background: "#1a1d26", border: "1px solid #2a2d35", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "#555", fontSize: 11, fontFamily: "inherit" }}
                title={`${user.name} — Esci`}>
                {user.name?.charAt(0).toUpperCase() || "U"}
              </button>
            </div>
          </div>

          {/* Add form */}
          {showForm && (
            <div className="fade-up" style={{ padding: "14px 28px", background: "#0a0c10", borderBottom: "1px solid #1a1d26", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <TickerAutocomplete value={form.ticker} onChange={v => setForm(f => ({ ...f, ticker: v }))}
                onSelect={t => {
                  const sector = t.sector || "Altro";
                  setForm(f => ({ ...f, ticker: t.ticker, sector }));
                }} />
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Settore
                  {form.sector && form.sector !== "Altro" && <span style={{ color: "#5EC98A", marginLeft: 6 }}>✓ auto</span>}
                </div>
                <select value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 90 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Quantità</div>
                <input type="number" placeholder="10" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Prezzo Acquisto</div>
                <input type="number" placeholder="175.00" value={form.buyPrice} onChange={e => setForm(f => ({ ...f, buyPrice: e.target.value }))} />
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Data Acquisto</div>
                <input type="date" value={form.buyDate}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={e => setForm(f => ({ ...f, buyDate: e.target.value }))}
                  style={{ colorScheme: "dark" }}/>
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

          <div style={{ display: "flex", height: "calc(100vh - 52px)", overflow: "hidden" }}>

            {/* Main — full width, no sidebar */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }} className="main-content">

              {/* OVERVIEW */}
              {activeTab === "overview" && (
                <OverviewTab
                  stocks={stocks} fmt={fmt} fmtPct={fmtPct} sym={sym} rate={rate}
                  eurRate={eurRate} totalValue={totalValue} totalInvested={totalInvested}
                  totalPnL={totalPnL} totalPct={totalPct} sectorData={sectorData}
                  portfolioHistory={portfolioHistory} alerts={alerts}
                  setSelectedId={setSelectedId} setEditId={setEditId} handleRemove={handleRemove}
                  setShowForm={setShowForm} marketOpen={marketOpen}
                />
              )}

              {/* STORICO */}
              {/* TITOLI */}
              {activeTab === "titoli" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>I tuoi Titoli</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Clicca per vedere dettaglio, grafico e analisi AI</div>
                  </div>
                  {stocks.length === 0 ? (
                    <div style={{ textAlign: "center", marginTop: 60, color: "#444" }}>Nessun titolo nel portafoglio.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {stocks.map(s => {
                        const pnl = (s.currentPrice - s.buyPrice) * s.qty;
                        const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
                        const isUp = pct >= 0;
                        return (
                          <div key={s.id} className="card" style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", transition: "border-color 0.15s" }}
                            onClick={() => setSelectedId(s.id)}
                            onMouseEnter={e => e.currentTarget.style.borderColor = "#F4C542"}
                            onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1d26"}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                                <span style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300 }}>{s.ticker}</span>
                                <span style={{ fontSize: 9, background: "#1a1d26", color: "#555", padding: "2px 7px", borderRadius: 2 }}>{s.sector}</span>
                                {s.priceReal && <MarketBadge state={s.marketState || "CLOSED"} size={7}/>}
                                {alerts[s.id] && <span style={{ fontSize: 9 }}>🔔</span>}
                              </div>
                              <div style={{ fontSize: 10, color: "#333" }}>{s.qty} az. · acquisto ${fmt(s.buyPrice)} · {s.buyDate}</div>
                              {(s.targetPrice || s.stopLoss) && (
                                <div style={{ display: "flex", gap: 12, marginTop: 5 }}>
                                  {s.targetPrice && <span style={{ fontSize: 9, color: s.currentPrice >= s.targetPrice ? "#5EC98A" : "#555" }}>🎯 Target ${fmt(s.targetPrice)}</span>}
                                  {s.stopLoss && <span style={{ fontSize: 9, color: s.currentPrice <= s.stopLoss ? "#E87040" : "#555" }}>🛑 Stop ${fmt(s.stopLoss)}</span>}
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 16, fontFamily: "'Fraunces', serif" }}>${fmt(s.currentPrice)}</div>
                              <div style={{ fontSize: 10, color: "#444" }}>€{fmt(s.currentPrice * eurRate)}</div>
                              <div style={{ fontSize: 12, color: isUp ? "#5EC98A" : "#E87040", fontWeight: 500, marginTop: 2 }}>{isUp?"+":""}${fmt(Math.abs(pnl))} · {fmtPct(pct)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* SETTORI */}
              {activeTab === "settori" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Diversificazione</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Distribuzione del capitale per settore</div>
                  </div>
                  {stocks.length === 0 ? (
                    <div style={{ textAlign: "center", marginTop: 60, color: "#444" }}>Aggiungi titoli per vedere la diversificazione.</div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 24 }}>
                        {sectorData.map((s, i) => {
                          const pct = totalValue > 0 ? (s.value / totalValue * 100) : 0;
                          const sectorStocks = stocks.filter(st => st.sector === s.name);
                          const sectorPnl = sectorStocks.reduce((acc, st) => acc + (st.currentPrice - st.buyPrice) * st.qty, 0);
                          const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
                          return (
                            <div key={s.name} style={{ background: "#0f1117", border: `1px solid ${color}33`, borderRadius: 8, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                              <div style={{ position: "absolute", top: 0, left: 0, width: `${pct}%`, height: 3, background: color }}/>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>{s.name}</div>
                                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, color }}>{pct.toFixed(1)}%</div>
                                  <div style={{ fontSize: 10, color: "#555", marginTop: 3 }}>${fmt(s.value, 0)}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: 9, color: "#333", marginBottom: 4 }}>{sectorStocks.length} titol{sectorStocks.length === 1 ? "o" : "i"}</div>
                                  <div style={{ fontSize: 12, color: sectorPnl >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>{sectorPnl>=0?"+":""}${fmt(Math.abs(sectorPnl),0)}</div>
                                </div>
                              </div>
                              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {sectorStocks.map(st => (
                                  <span key={st.id} style={{ fontSize: 9, background: color+"22", color, padding: "2px 7px", borderRadius: 3 }}>{st.ticker}</span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Concentrazione risk */}
                      <div className="card" style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Concentrazione per titolo</div>
                        {[...stocks].sort((a,b) => b.qty*b.currentPrice - a.qty*a.currentPrice).map(s => {
                          const weight = totalValue > 0 ? (s.qty * s.currentPrice / totalValue * 100) : 0;
                          return (
                            <div key={s.id} style={{ marginBottom: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ fontSize: 12, fontWeight: 500 }}>{s.ticker}</span>
                                <span style={{ fontSize: 11, color: "#888" }}>${fmt(s.qty*s.currentPrice,0)} · {weight.toFixed(1)}%</span>
                              </div>
                              <div style={{ background: "#1a1d26", borderRadius: 2, height: 2 }}>
                                <div style={{ width: `${weight}%`, height: "100%", background: weight > 30 ? "#E87040" : "#F4C542", borderRadius: 2 }}/>
                              </div>
                            </div>
                          );
                        })}
                        {stocks.some(s => s.qty*s.currentPrice/totalValue > 0.3) && (
                          <div style={{ marginTop: 10, fontSize: 10, color: "#E87040" }}>⚠️ Un titolo supera il 30% del portafoglio — considera di diversificare.</div>
                        )}
                      </div>

                      <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Benchmark vs S&P 500 (simulato)</div>
                      <ProGate feat="benchmark" h={200}>
                        <div className="card">
                          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Performance YTD %</div>
                          <ResponsiveContainer width="100%" height={170}>
                            <LineChart data={ytdHistory}>
                              <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={6}/>
                              <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={45} tickFormatter={v => `${v>0?"+":""}${v}%`}/>
                              <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={(v, n) => [`${v>0?"+":""}${v}%`, n]}/>
                              <ReferenceLine y={0} stroke="#2a2d35" strokeDasharray="4 3" strokeWidth={1}/>
                              <Legend wrapperStyle={{ fontSize: 10, color: "#555" }}/>
                              <Line type="monotone" dataKey="portafoglio" name="Il tuo portafoglio" stroke="#F4C542" strokeWidth={1.5} dot={false}/>
                              <Line type="monotone" dataKey="spx" name="S&P 500 (sim.)" stroke="#5B8DEF" strokeWidth={1.5} dot={false} strokeDasharray="4 3"/>
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </ProGate>
                    </>
                  )}
                </div>
              )}

              {/* WATCHLIST */}
              {activeTab === "watchlist" && <WatchlistTab eurRate={eurRate} fmt={fmt} fmtPct={fmtPct} />}

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

              {/* SIMULAZIONI */}
              {activeTab === "simulazioni" && (
                <SimulazioniTab stocks={stocks} sym={sym} rate={rate} fmt={fmt} fmtPct={fmtPct} />
              )}

              {activeTab === "whatif" && (
                <WhatIfTab fmt={fmt} fmtPct={fmtPct} eurRate={eurRate} />
              )}
              {activeTab === "dividendi" && (
                <DividendiTab stocks={stocks} fmt={fmt} fmtPct={fmtPct} sym={sym} rate={rate} />
              )}
              {activeTab === "previsioni" && (
                <ForecastTab stocks={stocks} fmt={fmt} fmtPct={fmtPct} sym={sym} rate={rate} />
              )}

            </div>
          </div>

          {/* Edit modal */}
          {editId && stocks.find(s => s.id === editId) && (
            <EditModal
              stock={stocks.find(s => s.id === editId)}
              onClose={() => setEditId(null)}
              onSave={handleEdit}
            />
          )}

          {/* Stock detail modal */}
          {selectedId && stocks.find(s => s.id === selectedId) ? (
            <StockModal
              stock={stocks.find(s => s.id === selectedId)}
              onClose={() => setSelectedId(null)}
              notes={notes} setNotes={setNotes}
              alerts={alerts} setAlerts={setAlerts}
              handleRemove={handleRemove}
              sym={sym} rate={rate} fmt={fmt} fmtPct={fmtPct}
              handleAI={handleAI} aiLoading={aiLoading} aiText={aiText}
              plan={plan} eurRate={eurRate}
              onSaveTargets={handleSaveTargets}
            />
          ) : null}

          {/* Mobile portfolio summary */}
          <div className="mobile-portfolio-header" style={{ padding: "12px 16px", borderBottom: "1px solid #161820", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 8, color: "#2a2d35", letterSpacing: "0.18em", textTransform: "uppercase" }}>Portafoglio</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, color: "#E8E6DF" }}>{sym}{fmt(totalValue)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: totalPnL >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>{totalPnL >= 0 ? "+" : ""}{sym}{fmt(Math.abs(totalPnL))}</div>
              <div style={{ fontSize: 10, color: totalPct >= 0 ? "#5EC98A" : "#E87040" }}>{fmtPct(totalPct)}</div>
            </div>
          </div>

          {/* Mobile bottom navigation */}
          <div className="mobile-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0a0c10", borderTop: "1px solid #161820", zIndex: 999, justifyContent: "space-around", alignItems: "center", padding: "6px 0", paddingBottom: "env(safe-area-inset-bottom)" }}>
            {[
              { id: "overview",    icon: "◈",  label: "Overview" },
              { id: "confronto",   icon: "📊", label: "Confronto" },
              { id: "simulazioni", icon: "⚡", label: "Stress" },
              { id: "whatif",      icon: "🔁", label: "E se?" },
              { id: "dividendi",   icon: "💰", label: "Divid." },
              { id: "previsioni",  icon: "🔮", label: "Prev." },
              { id: "alert",       icon: "🔔", label: "Alert" },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 8px", color: activeTab === t.id ? "#F4C542" : "#444", fontFamily: "inherit", transition: "color 0.15s" }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>{t.label}</span>
              </button>
            ))}
          </div>

        </div>
      </CurrencyCtx.Provider>
    </PlanCtx.Provider>
  );
}
