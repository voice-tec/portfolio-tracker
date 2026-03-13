import { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from "react";
import { createPortal } from "react-dom";
import { PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine, LineChart, Line, Legend, BarChart, Bar, ComposedChart } from "recharts";
import { supabase, signIn, signUp, signOut, getSession, loadStocks, saveStock, deleteStock, loadNotes, saveNote, loadAlerts, saveAlert, deleteAlert } from "./utils/supabase";
import { toUSD, detectCurrency } from "./utils/currency";
import { resolveMarketState } from "./utils/market";
import { parseBuyDate, isoToDisplay } from "./utils/dates";
import { fmt as fmtUtil, fmtPct as fmtPctUtil } from "./utils/format";
import { isKnownETF } from "./utils/etf";
import { fetchPrice, fetchHistory, fetchAnalyst, fetchSearch, fetchNews, fetchScenario, fetchAIAnalysis, API_BASE } from "./utils/api";
import { useEurRate } from "./hooks/useEurRate";
import { AllocationCard } from "./components/AllocationCard";
import { ChartCard } from "./components/ChartCard";
import { MarketBadge } from "./components/MarketBadge";

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

// ─── API ora in src/utils/api.js ───────────────────────────────────────────────

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
    lineKeys: [{ k: "growth", l: "Growth", c: "#26C6DA" }, { k: "realestate", l: "Real Estate", c: "#BF6EEA" }, { k: "spx", l: "S&P 500", c: "#444" }],
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
    lineKeys: [{ k: "smallcap", l: "Small Cap", c: "#26C6DA" }, { k: "industriali", l: "Industriali", c: "#5EC98A" }, { k: "spx", l: "S&P 500", c: "#444" }],
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


// ─── TRACKFOLIO LOGO SVG ──────────────────────────────────────────────────────
function TrackfolioLogo({ size = 28, showText = true, textColor = "#FFFFFF" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size * 0.7} viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="logoGrad" x1="0" y1="28" x2="40" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4B6EF5"/>
            <stop offset="100%" stopColor="#00D4AA"/>
          </linearGradient>
        </defs>
        {/* Freccia grafico: scende, poi risale con angolo netto */}
        <polyline
          points="2,20 14,14 22,18 38,2"
          stroke="url(#logoGrad)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Punta freccia */}
        <polyline
          points="30,2 38,2 38,10"
          stroke="url(#logoGrad)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      {showText && (
        <span style={{
          fontSize: size * 0.64,
          fontWeight: 600,
          color: textColor,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontFamily: "'Geist', sans-serif",
        }}>
          Trackfolio
        </span>
      )}
    </div>
  );
}

// ─── ONBOARDING MODAL ─────────────────────────────────────────────────────────

function OnboardingIllustration({ slide }) {
  if (slide === 0) return (
    // Mini grafico animato — Overview
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0A1628 0%, #0f2040 100%)", gap: 20, padding: 32 }}>
      {/* KPI mock */}
      <div style={{ display: "flex", gap: 24, width: "100%" }}>
        {[{ l: "Valore", v: "$12,480", c: "#E8E6DF" }, { l: "P&L Totale", v: "+$2,840", c: "#5EC98A" }, { l: "Rendimento", v: "+29.4%", c: "#5EC98A" }].map(k => (
          <div key={k.l} style={{ flex: 1, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 10, color: "#8BA4C0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>{k.l}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>
      {/* SVG grafico stilizzato */}
      <div style={{ width: "100%", background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "16px 16px 8px", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 10, color: "#8BA4C0", marginBottom: 8 }}>↑ 29.4%  ·  ultimi 1A</div>
        <svg viewBox="0 0 320 80" style={{ width: "100%", height: 80 }}>
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5EC98A" stopOpacity="0.3"/>
              <stop offset="100%" stopColor="#5EC98A" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d="M0,70 C20,68 40,65 60,58 C80,51 100,45 120,38 C140,31 160,35 180,28 C200,21 220,18 240,14 C260,10 280,12 320,8" stroke="#5EC98A" strokeWidth="2" fill="none"/>
          <path d="M0,70 C20,68 40,65 60,58 C80,51 100,45 120,38 C140,31 160,35 180,28 C200,21 220,18 240,14 C260,10 280,12 320,8 L320,80 L0,80Z" fill="url(#g1)"/>
        </svg>
        <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
          {["Mar","Giu","Set","Dic","Mar"].map(m => <span key={m} style={{ fontSize: 9, color: "#3A4A5E", flex: 1, textAlign: "center" }}>{m}</span>)}
        </div>
      </div>
    </div>
  );

  if (slide === 1) return (
    // Simulazioni — scenari storici
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1a0800 0%, #2d1000 100%)", gap: 16, padding: 32 }}>
      <div style={{ fontSize: 11, color: "#E87040", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Scenari Storici</div>
      {/* Scenario cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, width: "100%" }}>
        {[
          { label: "🦠 Covid Crash", val: "-34%", color: "#E87040" },
          { label: "💥 Crisi 2008", val: "-57%", color: "#E87040" },
          { label: "🚀 Bull 2017", val: "+19%", color: "#5EC98A" },
          { label: "📈 Alta Inflazione", val: "-18%", color: "#E87040" },
          { label: "💸 Tassi Bassi", val: "+24%", color: "#5EC98A" },
          { label: "📊 Recessione", val: "-22%", color: "#E87040" },
        ].map(s => (
          <div key={s.label} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${s.color}33`, borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#D8C8B8", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>
      {/* Mini chart */}
      <div style={{ width: "100%", background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 16px", border: "1px solid rgba(232,112,64,0.2)" }}>
        <div style={{ fontSize: 9, color: "#E87040", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Il tuo portafoglio vs S&P 500</div>
        <svg viewBox="0 0 320 50" style={{ width: "100%", height: 50 }}>
          <path d="M0,10 C40,12 80,20 120,28 C160,36 200,42 240,44 C280,46 300,44 320,43" stroke="#E87040" strokeWidth="2" fill="none"/>
          <path d="M0,8 C40,10 80,18 120,24 C160,30 200,36 240,40 C280,44 300,43 320,42" stroke="#8BA4C0" strokeWidth="1.5" fill="none" strokeDasharray="4 3"/>
        </svg>
      </div>
    </div>
  );

  // slide === 2 — Previsioni
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0d0820 0%, #1a0f35 100%)", gap: 16, padding: 32 }}>
      <div style={{ fontSize: 11, color: "#A78BFA", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Previsioni 12 mesi</div>
      {/* 3 scenari */}
      <div style={{ display: "flex", gap: 12, width: "100%" }}>
        {[
          { l: "Pessimistico", v: "-2.0%", c: "#E87040", sub: "$2,557" },
          { l: "Base", v: "+17.8%", c: "#F4C542", sub: "$3,071" },
          { l: "Ottimistico", v: "+27.9%", c: "#5EC98A", sub: "$3,336" },
        ].map(s => (
          <div key={s.l} style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: `1px solid ${s.c}33`, borderRadius: 10, padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#8878AA", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.c, marginBottom: 2 }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "#6A5A8A" }}>{s.sub}</div>
          </div>
        ))}
      </div>
      {/* Cono di proiezione SVG */}
      <div style={{ width: "100%", background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 16px", border: "1px solid rgba(167,139,250,0.2)" }}>
        <svg viewBox="0 0 320 60" style={{ width: "100%", height: 60 }}>
          {/* storico */}
          <path d="M0,40 C40,38 80,35 130,32" stroke="#8BA4C0" strokeWidth="1.5" fill="none"/>
          {/* proiezioni divergenti */}
          <path d="M130,32 C180,26 240,18 320,10" stroke="#5EC98A" strokeWidth="1.5" fill="none" strokeDasharray="5 3"/>
          <path d="M130,32 C180,30 240,28 320,26" stroke="#F4C542" strokeWidth="1.5" fill="none" strokeDasharray="5 3"/>
          <path d="M130,32 C180,34 240,38 320,44" stroke="#E87040" strokeWidth="1.5" fill="none" strokeDasharray="5 3"/>
          {/* linea verticale separazione */}
          <line x1="130" y1="5" x2="130" y2="55" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3 2"/>
          <text x="60" y="58" fontSize="8" fill="#4A5A6A">Storico</text>
          <text x="200" y="58" fontSize="8" fill="#6A5A8A">Proiezione →</text>
        </svg>
      </div>
    </div>
  );
}

const ONBOARDING_SLIDES = [
  {
    badge: "📊 Overview",
    title: "Il tuo portafoglio in tempo reale",
    desc: "Visualizza il valore totale, la performance % nel tempo e confronta il tuo rendimento con l'S&P 500. Il grafico si aggiorna automaticamente ogni giorno di mercato aperto.",
    color: "#1E4FD8",
    badge: "📊 Overview",
    title: "Il tuo portafoglio in tempo reale",
    desc: "Visualizza il valore totale, la performance % nel tempo e confronta il tuo rendimento con l'S&P 500. Il grafico si aggiorna automaticamente ogni giorno di mercato aperto.",
    color: "#1E4FD8",
  },
  {
    badge: "🔁 Simulazioni",
    title: "Testa il tuo portafoglio in scenari storici",
    desc: "Scopri come avrebbe reagito il tuo portafoglio durante il Covid Crash, la crisi del 2008, o scenari macroeconomici come alta inflazione e tassi alti.",
    color: "#E87040",
  },
  {
    badge: "🔮 Previsioni",
    title: "Proiezioni a 12 mesi basate su dati reali",
    desc: "Analisi statistica con scenario pessimistico, base e ottimistico. Include il target price degli analisti e il rating di consenso per ogni titolo.",
    color: "#7C3AED",
  },
];

function OnboardingModal({ onClose }) {
  const [slide, setSlide] = useState(0);
  const current = ONBOARDING_SLIDES[slide];
  const isLast = slide === ONBOARDING_SLIDES.length - 1;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(10,22,40,0.7)",
      zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, backdropFilter: "blur(4px)"
    }}>
      <div style={{
        background: "#FFFFFF", borderRadius: 20, maxWidth: 680, width: "100%",
        overflow: "hidden", boxShadow: "0 24px 80px rgba(10,22,64,0.22)",
        display: "flex", flexDirection: "column"
      }}>
        {/* Illustration */}
        <div style={{ position: "relative", height: 300, overflow: "hidden" }}>
          <OnboardingIllustration slide={slide} />
          {/* Badge overlay */}
          <div style={{
            position: "absolute", top: 16, left: 16,
            background: current.color, color: "#fff",
            fontSize: 11, fontWeight: 700, padding: "5px 12px",
            borderRadius: 20, letterSpacing: "0.05em"
          }}>
            {current.badge}
          </div>
          {/* Slide indicators */}
          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
            {ONBOARDING_SLIDES.map((_, i) => (
              <button key={i} onClick={() => setSlide(i)} style={{
                width: i === slide ? 20 : 6, height: 6, borderRadius: 3,
                background: i === slide ? "#FFFFFF" : "rgba(255,255,255,0.4)",
                border: "none", cursor: "pointer", padding: 0,
                transition: "all 0.2s"
              }} />
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "28px 32px 24px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0A1628", marginBottom: 10, lineHeight: 1.3 }}>
            {current.title}
          </div>
          <div style={{ fontSize: 14, color: "#5A6A7E", lineHeight: 1.7, marginBottom: 28 }}>
            {current.desc}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <button onClick={onClose} style={{
              background: "none", border: "none", color: "#A0AABF",
              fontSize: 13, cursor: "pointer", padding: 0
            }}>
              Salta il tour
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              {slide > 0 && (
                <button onClick={() => setSlide(s => s - 1)} style={{
                  background: "#F0F4FA", border: "none", color: "#0A1628",
                  fontSize: 13, fontWeight: 600, padding: "10px 22px",
                  borderRadius: 8, cursor: "pointer"
                }}>
                  ← Indietro
                </button>
              )}
              <button onClick={() => isLast ? onClose() : setSlide(s => s + 1)} style={{
                background: current.color, border: "none", color: "#fff",
                fontSize: 13, fontWeight: 700, padding: "10px 26px",
                borderRadius: 8, cursor: "pointer"
              }}>
                {isLast ? "Inizia ora ✦" : "Avanti →"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
        <span style={{ fontSize: 12, color: "#666" }}>Disponibile con Piano Pro</span>
        <button onClick={() => setShowUpgrade(true)} style={{ background: "#F4C542", border: "none", color: "#F8F9FC", fontFamily: "inherit", fontSize: 11, fontWeight: 600, padding: "8px 20px", borderRadius: 4, cursor: "pointer" }}>Sblocca Pro</button>
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
      <div style={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 14, padding: "36px 38px", maxWidth: 480, width: "100%", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 18, background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18 }}>✕</button>
        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 30, fontWeight: 300, marginBottom: 4 }}>Trackfolio <span style={{ color: "#F4C542" }}>Pro</span></div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 24 }}>Tutto quello che serve per investire con più consapevolezza.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 26 }}>
          {perks.map(([icon, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#F0F2F7", borderRadius: 6, fontSize: 12, color: "#666" }}>
              {icon} {label}
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 38, color: "#F4C542" }}>€12<span style={{ fontSize: 14, color: "#666" }}>/mese</span></div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>oppure <strong style={{ color: "#444" }}>€99/anno</strong> · Cancella quando vuoi</div>
        </div>
        <button onClick={() => { setPlan("pro"); onClose(); }} style={{ width: "100%", background: "#F4C542", border: "none", color: "#F8F9FC", fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "14px", borderRadius: 8, cursor: "pointer" }}>
          Attiva Pro — Demo gratuita
        </button>
        <div style={{ fontSize: 10, color: "#D8DCE8", textAlign: "center", marginTop: 10 }}>Demo: in produzione aprirà Stripe Checkout</div>
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
    <div style={{ minHeight: "100vh", background: "#EEF2FA", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Geist', sans-serif", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;height:-webkit-fill-available;overflow-x:hidden;-webkit-tap-highlight-color:transparent}
        input{background:#FFFFFF;border:1.5px solid #D0D8EC;color:#0A1628;font-family:inherit;font-size:13px;padding:12px 14px;border-radius:8px;outline:none;width:100%;transition:border-color 0.15s;box-shadow:0 1px 3px rgba(10,22,64,0.06)}input:focus{border-color:#1E4FD8;box-shadow:0 0 0 3px rgba(30,79,216,0.1)}select{background:#FFFFFF;border:1.5px solid #D0D8EC;color:#0A1628;font-family:inherit;font-size:13px;padding:12px 14px;border-radius:8px;outline:none;width:100%;transition:border-color 0.15s;box-shadow:0 1px 3px rgba(10,22,64,0.06);cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%231E4FD8'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
        input:focus{border-color:#1E4FD8;box-shadow:0 0 0 3px rgba(30,79,216,0.08)} input::placeholder{color:#A0AABF}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
      <div style={{ animation: "fadeUp 0.4s ease", width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ marginBottom: 8 }}><TrackfolioLogo size={36} showText={true} textColor="#0A1628" /></div>
        </div>
        <div style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 12, padding: "30px 28px" }}>
          <div style={{ display: "flex", background: "#EEF2FA", borderRadius: 6, padding: 3, marginBottom: 22 }}>
            {[["login","Accedi"],["register","Registrati"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{ flex: 1, background: mode === m ? "#E8EBF2" : "transparent", border: "none", color: mode === m ? "#0A0E1A" : "#444", fontFamily: "inherit", fontSize: 11, padding: "8px", borderRadius: 4, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em", transition: "all 0.15s" }}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mode === "register" && <input placeholder="Nome" value={name} onChange={e => setName(e.target.value)} />}
            <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            <input placeholder="Password" type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          {err && <div style={{ fontSize: 11, color: "#E87040", marginTop: 10 }}>{err}</div>}
          <button onClick={submit} disabled={loading} style={{ marginTop: 18, width: "100%", background: "#1E4FD8", border: "none", color: "#FFFFFF", fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "13px", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: loading ? 0.7 : 1 }}>
            {loading && <Spinner color="#F8F9FC" />}
            {mode === "login" ? "Entra nel portafoglio" : "Crea Account"}
          </button>
          <div style={{ fontSize: 10, color: "#D8DCE8", textAlign: "center", marginTop: 12 }}>Benvenuto su Trackfolio</div>
        </div>
        <div style={{ fontSize: 9, color: "#C8CDD8", textAlign: "center", marginTop: 18, lineHeight: 1.8 }}>
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
      const r = await fetchSearch(value);
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
      background: "#F0F2F7",
      border: "1px solid #2a2d35",
      borderRadius: 8,
      boxShadow: "0 16px 48px rgba(0,0,0,0.95)",
      overflow: "hidden",
      maxHeight: 280,
      overflowY: "auto",
    }}>
      {loading && results.length === 0
        ? <div style={{ padding: "12px 16px", fontSize: 11, color: "#666", display: "flex", alignItems: "center", gap: 8 }}><Spinner /> Ricerca ticker…</div>
        : results.map((t, i) => (
          <div key={t.ticker+i}
            onMouseDown={e => { e.preventDefault(); onSelect(t); setOpen(false); }}
            onMouseEnter={() => setHi(i)}
            style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: i === hi ? "#E8EBF2" : "transparent", borderBottom: i < results.length-1 ? "1px solid #E0E4EE" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#0A0E1A", minWidth: 52 }}>{t.ticker}</span>
              <span style={{ fontSize: 11, color: "#666" }}>{t.name}</span>
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              {t.exchange && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: "#F8F9FC", color: "#444" }}>{t.exchange}</span>}
              {t.sector && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: "#F8F9FC", color: "#666" }}>{t.sector}</span>}
            </div>
          </div>
        ))
      }
    </div>,
    document.body
  );

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#666", marginBottom: 5, letterSpacing: "0.12em", textTransform: "uppercase" }}>Ticker</div>
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
      fetchPrice(item.ticker).then(p => {
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
        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>Watchlist</div>
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
                    <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 18, fontWeight: 300 }}>{item.ticker}</span>
                    {item.sector && <span style={{ fontSize: 9, background: "#E8EBF2", color: "#666", padding: "2px 7px", borderRadius: 2 }}>{item.sector}</span>}
                    <span style={{ fontSize: 9, color: "#333" }}>aggiunto {item.addedAt}</span>
                  </div>
                  {item.note && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{item.note}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ textAlign: "right" }}>
                    {isLoading ? <Spinner /> : price ? (
                      <>
                        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 16 }}>${fmt(price)}</div>
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

  // Converti buyDate in YYYY-MM-DD per il datepicker
  const toISO = (s) => {
    if (!s) return new Date().toISOString().split("T")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const p = s.split("/");
    if (p.length === 3) {
      const yr = p[2].length === 2 ? "20" + p[2] : p[2];
      return `${yr}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;
    }
    return new Date().toISOString().split("T")[0];
  };
  const [buyDate, setBuyDate] = useState(toISO(stock.buyDate));

  useEffect(() => {
    const fn = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  function handleSave() {
    // Converti data da YYYY-MM-DD a dd/mm/yy
    const buyDateFormatted = buyDate; // salva direttamente in YYYY-MM-DD
    onSave({ ...stock, qty: parseFloat(qty)||stock.qty, buyPrice: parseFloat(buyPrice)||stock.buyPrice,
      targetPrice: parseFloat(targetPrice)||null, stopLoss: parseFloat(stopLoss)||null,
      sector, buyDate: buyDateFormatted });
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 9100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#F8F9FC", border: "1px solid #E8EBF4", borderRadius: 12, width: "100%", maxWidth: 420, padding: "28px 28px 24px", animation: "fadeUp 0.2s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div>
            <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>{stock.ticker}</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>Modifica posizione</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "1px solid #2a2d35", color: "#666", fontFamily: "inherit", fontSize: 16, padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}>✕</button>
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
          <div>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>📅 Data Acquisto</div>
            <input type="date" value={buyDate} max={new Date().toISOString().split("T")[0]}
              onChange={e => setBuyDate(e.target.value)} style={{ fontSize: 13, colorScheme: "dark" }}/>
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
          toolbar_bg: "#F8F9FC",
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
    <div style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, marginBottom: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", cursor: "pointer" }} onClick={() => setShow(v => !v)}>
        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>📈 Grafico TradingView</div>
        <span style={{ fontSize: 10, color: "#666" }}>{show ? "▲ Chiudi" : "▼ Apri"}</span>
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
  const _cur = rate && stock.currency === "EUR" ? stock.currentPrice / (rate || 0.92)
              : stock.currency === "GBp" ? (stock.currentPrice / 100) / ((rate || 0.92) * 0.85)
              : stock.currentPrice;
  const _buy = rate && stock.currency === "EUR" ? stock.buyPrice / (rate || 0.92)
              : stock.currency === "GBp" ? (stock.buyPrice / 100) / ((rate || 0.92) * 0.85)
              : stock.buyPrice;
  const pnlPct = _buy > 0 ? (_cur - _buy) / _buy * 100 : 0;
  const pnlAbs = (_cur - _buy) * stock.qty;
  const isUp = pnlPct >= 0;

  useEffect(() => {
    setHistLoading(true);
    fetchHistory(stock.ticker, chartPeriod).then(candles => {
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
      <div onClick={e => e.stopPropagation()} style={{ background: "#F8F9FC", border: "1px solid #E8EBF4", borderRadius: "12px 12px 0 0", width: "100%", maxWidth: 800, maxHeight: "88vh", overflowY: "auto", padding: "24px 28px", animation: "fadeUp 0.25s ease" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 28, fontWeight: 300 }}>{stock.ticker}</span>
              <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 2, background: "#E8EBF2", color: "#666", letterSpacing: "0.08em", textTransform: "uppercase" }}>{stock.sector}</span>
              {stock.priceReal && <MarketBadge state={stock.marketState || "CLOSED"} size={8}/>}
            </div>
            <div style={{ fontSize: 10, color: "#D8DCE8", marginTop: 3 }}>Acquistato il {stock.buyDate} · {stock.qty} azioni</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 24, fontWeight: 300 }}>
                {stock.currency === "EUR" ? "€" : sym}{fmt(stock.currentPrice)}
                {stock.currency && stock.currency !== "USD" && <span style={{fontSize:11,color:"#666",marginLeft:4}}>(=${fmt(_cur)})</span>}
              </div>
              <div style={{ fontSize: 12, color: isUp ? "#5EC98A" : "#E87040" }}>{isUp?"+":""}{sym}{fmt(Math.abs(pnlAbs))} · {fmtPct(pnlPct)}</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "1px solid #2a2d35", color: "#666", fontFamily: "inherit", fontSize: 16, padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}>✕</button>
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
            <div key={k.l} style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>{k.l}</div>
              <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 15, fontWeight: 300, color: k.c || "#0A0E1A" }}>{k.v}</div>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>Andamento</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[{l:"1M",v:30},{l:"3M",v:90},{l:"6M",v:180},{l:"1A",v:365}].map(p => (
                <button key={p.v} onClick={() => setChartPeriod(p.v)}
                  style={{ background: chartPeriod===p.v?"#F4C542":"none", border:`1px solid ${chartPeriod===p.v?"#F4C542":"#D8DCE8"}`, color: chartPeriod===p.v?"#F8F9FC":"#666", fontFamily:"inherit", fontSize:9, padding:"3px 8px", borderRadius:3, cursor:"pointer" }}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>
          {histLoading ? (
            <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#666", fontSize: 11 }}><Spinner /> Caricamento…</div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={history}>
                <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F4C542" stopOpacity={0.18}/><stop offset="95%" stopColor="#F4C542" stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="date" tick={{ fill: "#D8DCE8", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor(history.length/5)}/>
                <YAxis tick={{ fill: "#D8DCE8", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={50} tickFormatter={v => `${sym}${v}`}/>
                <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#0A0E1A" }} formatter={v => [`${sym}${v}`, "Prezzo"]}/>
                <ReferenceLine y={stock.buyPrice} stroke="#E87040" strokeDasharray="4 3" strokeWidth={1}/>
                <Area type="monotone" dataKey="price" stroke="#F4C542" strokeWidth={1.5} fill="url(#mg)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* TradingView Widget */}
        <TradingViewWidget ticker={stock.ticker} />

        {/* AI */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em" }}>🤖 Analisi AI</div>
            <button onClick={() => handleAI(stock)} disabled={aiLoading[stock.id]}
              style={{ background: "none", border: "1px solid #2a2d35", color: "#444", fontFamily: "inherit", fontSize: 10, padding: "5px 12px", borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {aiLoading[stock.id] ? <><Spinner size={9}/> Analisi…</> : "Analizza ora"}
            </button>
          </div>
          {aiText[stock.id]
            ? <div style={{ fontSize: 12, color: "#666", lineHeight: 1.8 }}>{aiText[stock.id]}</div>
            : <div style={{ fontSize: 11, color: "#D8DCE8" }}>Clicca "Analizza ora" per un'analisi AI contestuale.</div>}
        </div>

        {/* Target & Stop */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
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

        {/* 🔔 Alert prezzi */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>🔔 Alert Prezzi</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: "#16A34A", marginBottom: 5, fontWeight: 600 }}>↑ Avvisami sopra</div>
              <input type="number" step="0.01"
                value={alerts[stock.id]?.above || ""}
                onChange={e => setAlerts(al => ({ ...al, [stock.id]: { ...(al[stock.id]||{}), above: e.target.value ? parseFloat(e.target.value) : null } }))}
                placeholder={`Es. ${(stock.currentPrice * 1.1).toFixed(0)}`}
                style={{ fontSize: 12, padding: "7px 10px", width: "100%", background: "#F8FAFF", border: "1px solid #D0D8EC", borderRadius: 6, outline: "none", colorScheme: "light" }} />
              {alerts[stock.id]?.above && <div style={{ fontSize: 9, color: "#16A34A", marginTop: 4 }}>✓ Alert attivo a ${alerts[stock.id].above}</div>}
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#E87040", marginBottom: 5, fontWeight: 600 }}>↓ Avvisami sotto</div>
              <input type="number" step="0.01"
                value={alerts[stock.id]?.below || ""}
                onChange={e => setAlerts(al => ({ ...al, [stock.id]: { ...(al[stock.id]||{}), below: e.target.value ? parseFloat(e.target.value) : null } }))}
                placeholder={`Es. ${(stock.currentPrice * 0.9).toFixed(0)}`}
                style={{ fontSize: 12, padding: "7px 10px", width: "100%", background: "#F8FAFF", border: "1px solid #D0D8EC", borderRadius: 6, outline: "none", colorScheme: "light" }} />
              {alerts[stock.id]?.below && <div style={{ fontSize: 9, color: "#E87040", marginTop: 4 }}>✓ Alert attivo a ${alerts[stock.id].below}</div>}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#8A9AB0", marginTop: 10 }}>Gli alert si attivano al prossimo aggiornamento prezzi mentre hai l'app aperta.</div>
        </div>

        {/* Notes */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>📝 Note</div>
          <textarea rows={3} value={notes[stock.id] || ""} onChange={e => setNotes(n => ({ ...n, [stock.id]: e.target.value }))}
            placeholder={`Motivo acquisto, target price, strategia…`} style={{ resize: "vertical", lineHeight: 1.7, fontSize: 12, width: "100%", background: "#F0F2F7", border: "1px solid #2a2d35", color: "#0A0E1A", fontFamily: "inherit", padding: "9px 12px", borderRadius: 4, outline: "none" }}/>
        </div>

        {/* News */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>📰 Ultime notizie</div>
          {newsLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#444", fontSize: 11 }}><Spinner size={9}/> Caricamento notizie…</div>
          ) : news.length === 0 ? (
            <div style={{ fontSize: 11, color: "#D8DCE8" }}>Nessuna notizia recente trovata per {stock.ticker}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {news.map((n, i) => (
                <a key={n.id || i} href={n.url} target="_blank" rel="noopener noreferrer"
                  style={{ textDecoration: "none", display: "block", padding: "10px 12px", background: "#F0F2F7", borderRadius: 6, border: "1px solid #E8EBF4", transition: "border-color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#F4C542"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#E8EBF2"}>
                  <div style={{ fontSize: 12, color: "#0A0E1A", lineHeight: 1.5, marginBottom: 4 }}>{n.headline}</div>
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
function MacroScenarioSection({ stocks, sym, rate, fmt, pct: fmtPct, col, eurRate }) {
  const [selected, setSelected] = useState(MACRO_SCENARIOS[0]);

  const totalValue = stocks.reduce((s, x) => s + x.qty * toUSD(x.currentPrice, x.currency, eurRate), 0);

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
        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>Scenari Macroeconomici</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Come reagisce il tuo portafoglio a diversi contesti macro? Cosa comprare in ogni scenario?</div>
      </div>

      {/* Selector scenari macro */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {MACRO_SCENARIOS.map(s => (
          <button key={s.id} onClick={() => setSelected(s)}
            style={{ background: selected.id === s.id ? s.color + "22" : "none", border: `1px solid ${selected.id === s.id ? s.color : "#D8DCE8"}`, color: selected.id === s.id ? s.color : "#666", fontFamily: "inherit", fontSize: 11, padding: "7px 14px", borderRadius: 4, cursor: "pointer", transition: "all 0.15s" }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Scenario header */}
      <div style={{ background: "#FFFFFF", border: `1px solid ${selected.color}33`, borderRadius: 6, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "#0A0E1A", fontWeight: 500, marginBottom: 4 }}>{selected.label}</div>
          <div style={{ fontSize: 11, color: "#666" }}>{selected.desc}</div>
          <div style={{ fontSize: 10, color: "#333", marginTop: 6 }}>⏱ Durata tipica: {selected.duration}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>S&P 500 medio</div>
          <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, color: selected.spxImpact >= 0 ? "#5EC98A" : "#E87040" }}>
            {selected.spxImpact >= 0 ? "+" : ""}{(selected.spxImpact * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* KPI impatto portafoglio */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { l: "Impatto stimato", v: `${portfolioImpact.totalPnl >= 0 ? "+" : ""}${sym}${fmt(Math.abs(portfolioImpact.totalPnl * rate))}`, c: portfolioImpact.totalPnl >= 0 ? "#5EC98A" : "#E87040" },
          { l: "Variazione %",    v: `${portfolioImpact.pct >= 0 ? "+" : ""}${portfolioImpact.pct.toFixed(1)}%`, c: portfolioImpact.pct >= 0 ? "#5EC98A" : "#E87040" },
          { l: "Valore stimato",  v: `${sym}${fmt((totalValue + portfolioImpact.totalPnl) * rate)}`, c: "#0A0E1A" },
        ].map(k => (
          <div key={k.l} className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{k.l}</div>
            <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 20, fontWeight: 300, color: k.c }}>{k.v}</div>
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
            <div style={{ fontSize: 10, color: "#666" }}>Rendimento cumulato dei principali asset in questo scenario (dati medi storici)</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartWithPortfolio}>
            <XAxis dataKey="m" tick={{ fill: "#333", fontSize: 9 }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fill: "#333", fontSize: 9 }} axisLine={false} tickLine={false} width={45}
              tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`} domain={["auto","auto"]}/>
            <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 6, fontSize: 11, color: "#0A0E1A" }}
              formatter={(v, n) => [`${v > 0 ? "+" : ""}${v}%`, n === "portfolio" ? "Il tuo portafoglio (stimato)" : n]}/>
            <ReferenceLine y={0} stroke="#D8DCE8" strokeDasharray="3 3"/>
            {lineKeys.map(lk => (
              <Line key={lk.k} type="monotone" dataKey={lk.k} stroke={lk.c} strokeWidth={1.5}
                dot={false} name={lk.l} strokeDasharray="4 2"/>
            ))}
            <Line type="monotone" dataKey="portfolio" stroke={selected.color} strokeWidth={2.5}
              dot={false} name="Il tuo portafoglio (stimato)"/>
            <Legend wrapperStyle={{ fontSize: 10, color: "#666", paddingTop: 8 }}/>
          </LineChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 9, color: "#D8DCE8", marginTop: 8 }}>
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
              <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #E8EBF4" }}>
                <div style={{ background: "#5EC98A22", color: "#5EC98A", fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 4, minWidth: 52, textAlign: "center" }}>
                  {p.ticker}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#0A0E1A" }}>{p.name}</div>
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
                <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #E8EBF4" }}>
                  <div style={{ background: "#E8704022", color: "#E87040", fontSize: 11, fontWeight: 700, padding: "4px 8px", borderRadius: 4, minWidth: 52, textAlign: "center" }}>
                    {p.ticker}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#0A0E1A" }}>{p.name}</div>
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
                  <span style={{ fontSize: 10, color: "#444", minWidth: 44, fontWeight: 600 }}>{s.ticker}</span>
                  <div style={{ flex: 1, height: 6, background: "#FFFFFF", borderRadius: 3, overflow: "hidden" }}>
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

      <div style={{ fontSize: 9, color: "#D8DCE8", textAlign: "center", padding: "8px 0" }}>
        ⚠️ Stime basate su dati storici medi per settore. Non costituisce consulenza finanziaria ai sensi MiFID II.
      </div>
    </div>
  );
}

function SimulazioniTab({ stocks, sym, rate, fmt, fmtPct, eurRate }) {
  const [selectedScenario, setSelectedScenario] = useState(SCENARIOS[0]);
  const [scenarioData, setScenarioData] = useState({});
  const [loading, setLoading] = useState(false);

  const totalValue   = stocks.reduce((s, x) => s + x.qty * toUSD(x.currentPrice, x.currency, eurRate), 0);
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
        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>Stress Test Storico</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Come sarebbe andato il tuo portafoglio durante le grandi crisi?</div>
      </div>

      {/* Scenario selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {SCENARIOS.map(s => (
          <button key={s.id} onClick={() => setSelectedScenario(s)}
            style={{ background: selectedScenario.id === s.id ? s.color + "22" : "none", border: `1px solid ${selectedScenario.id === s.id ? s.color : "#D8DCE8"}`, color: selectedScenario.id === s.id ? s.color : "#666", fontFamily: "inherit", fontSize: 11, padding: "7px 14px", borderRadius: 4, cursor: "pointer", transition: "all 0.15s" }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Scenario description */}
      <div style={{ background: "#FFFFFF", border: `1px solid ${selectedScenario.color}33`, borderRadius: 6, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "#0A0E1A", fontWeight: 500 }}>{selectedScenario.label}</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>{selectedScenario.desc} · {selectedScenario.from} → {selectedScenario.to}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em" }}>S&P 500</div>
          <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 20, color: selectedScenario.spx >= 0 ? "#5EC98A" : "#E87040" }}>
            {selectedScenario.spx >= 0 ? "+" : ""}{selectedScenario.spx}%
          </div>
        </div>
        <div style={{ fontSize: 9, background: "#1a2a1a", color: "#5EC98A", padding: "3px 8px", borderRadius: 3 }}>● Dati reali</div>
      </div>

      {loading ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#666", fontSize: 12 }}>
          <Spinner /> Caricamento dati storici…
        </div>
      ) : data ? (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
            {[
              { l: "Impatto Portafoglio", v: `${totalScenarioPnl >= 0 ? "+" : ""}${sym}${fmt(Math.abs(totalScenarioPnl))}`, c: totalScenarioPnl >= 0 ? "#5EC98A" : "#E87040" },
              { l: "Performance %",       v: `${totalScenarioPct >= 0 ? "+" : ""}${totalScenarioPct.toFixed(2)}%`, c: totalScenarioPct >= 0 ? "#5EC98A" : "#E87040" },
              { l: "Valore Finale",       v: `${sym}${fmt((totalValue + totalScenarioPnl / rate) * rate)}`, c: "#0A0E1A" },
            ].map(k => (
              <div key={k.l} className="card">
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{k.l}</div>
                <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 20, fontWeight: 300, color: k.c }}>{k.v}</div>
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
                  <span style={{ width: 12, height: 2, background: "#666", display: "inline-block" }}/> S&P 500 (SPY)
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
                <XAxis dataKey="date" tick={{ fill: "#D8DCE8", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor((data.chartData.length || 1) / 5)}/>
                <YAxis tick={{ fill: "#D8DCE8", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={45} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`}/>
                <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#0A0E1A" }}
                  formatter={(v, name) => [`${v > 0 ? "+" : ""}${v}%`, name === "spy" ? "S&P 500" : "Portafoglio"]}/>
                <ReferenceLine y={0} stroke="#D8DCE8" strokeDasharray="4 3" strokeWidth={1}/>
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
                <tr style={{ borderBottom: "1px solid #E8EBF4" }}>
                  {["Ticker", "Settore", "Valore Attuale", "Performance Scenario", "P&L Scenario"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.stockResults.map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #F0F2F8" }}>
                    <td style={{ padding: "10px 10px", color: "#0A0E1A", fontWeight: 500 }}>
                      {s.ticker}
                      {s.noData && <span style={{ fontSize: 8, color: "#444", marginLeft: 6 }}>(sim.)</span>}
                    </td>
                    <td style={{ padding: "10px 10px", color: "#666" }}>{s.sector}</td>
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
            <div style={{ marginTop: 14, padding: "10px 10px", background: "#F0F4FA", borderRadius: 4, fontSize: 10, color: "#333" }}>
              📊 Dati storici reali da Yahoo Finance. I titoli non presenti in quel periodo usano una stima beta-adjusted. Le performance passate non garantiscono risultati futuri. Non costituisce consulenza finanziaria ai sensi MiFID II.
            </div>
          </div>
        </>
      ) : null}

      {/* ── SEZIONE MACRO ── */}
      <MacroScenarioSection stocks={stocks} sym={sym} rate={rate} fmt={fmt} pct={fmtPct} col={v => v >= 0 ? "#5EC98A" : "#E87040"} eurRate={eurRate} />
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── WHAT IF TAB ──────────────────────────────────────────────────────────────
// ─── DIVIDENDI TAB ────────────────────────────────────────────────────────────
// ─── FORECAST TAB ─────────────────────────────────────────────────────────────

// ─── SCREENER TAB — Fama-French Factor Screener ───────────────────────────────
function ScoreBar({ value, color = "#1E4FD8" }) {
  if (value == null) return <span style={{ color: "#C0C8D8", fontSize: 11 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 60, height: 5, background: "#EEF2F8", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 11, color: "#5A6A7E", minWidth: 24 }}>{value}</span>
    </div>
  );
}

function FactorBadge({ label, score, color }) {
  const c = score == null ? "#C0C8D8" : score >= 70 ? "#16A34A" : score >= 40 ? "#F4A020" : "#E87040";
  return (
    <div style={{ textAlign: "center", padding: "6px 8px", background: "#F8FAFF", borderRadius: 6, border: `1px solid ${c}33` }}>
      <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{score ?? "—"}</div>
    </div>
  );
}

function ScreenerTab({ fmt, onAddTicker }) {
  const [results, setResults]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [exchange, setExchange]   = useState("NASDAQ,NYSE");
  const [sortBy, setSortBy]       = useState("composite");
  const [expanded, setExpanded]   = useState(null);
  const [loaded, setLoaded]       = useState(false);

  async function runScreener() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/screener?exchange=${exchange}&limit=50`);
      const data = await res.json();
      if (data.error && !data.results?.length) throw new Error(data.error);
      setResults(data.results || []);
      setLoaded(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const sorted = [...results].sort((a, b) => {
    if (sortBy === "composite") return b.scores.composite - a.scores.composite;
    if (sortBy === "value")     return (b.scores.value ?? 0) - (a.scores.value ?? 0);
    if (sortBy === "size")      return (b.scores.size ?? 0) - (a.scores.size ?? 0);
    if (sortBy === "prof")      return (b.scores.profitability ?? 0) - (a.scores.profitability ?? 0);
    if (sortBy === "momentum")  return (b.scores.momentum ?? 0) - (a.scores.momentum ?? 0);
    return 0;
  });

  const scoreColor = s => s == null ? "#C0C8D8" : s >= 70 ? "#16A34A" : s >= 40 ? "#F4A020" : "#E87040";

  return (
    <div className="fade-up" style={{ padding: "24px 20px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>
          🔬 Screener Fama-French
        </div>
        <div style={{ fontSize: 13, color: "#5A6A7E", lineHeight: 1.6 }}>
          Titoli filtrati secondo i 4 fattori di Fama &amp; French: <strong>Value</strong> (P/E, P/B bassi),{" "}
          <strong>Size</strong> (small/mid cap), <strong>Profitability</strong> (ROE/ROA alti),{" "}
          <strong>Momentum</strong> (trend 12 mesi). Ispirato all'approccio DFA.
        </div>
      </div>

      {/* Filtri */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Mercato</div>
          <select value={exchange} onChange={e => setExchange(e.target.value)}
            style={{ background: "#F8FAFF", border: "1px solid #D0D8EC", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#0A1628", cursor: "pointer" }}>
            <option value="NASDAQ,NYSE">NASDAQ + NYSE</option>
            <option value="NASDAQ">Solo NASDAQ</option>
            <option value="NYSE">Solo NYSE</option>
            <option value="EURONEXT">Euronext</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ordina per</div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ background: "#F8FAFF", border: "1px solid #D0D8EC", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#0A1628", cursor: "pointer" }}>
            <option value="composite">Score composito</option>
            <option value="value">Value</option>
            <option value="size">Size</option>
            <option value="prof">Profitability</option>
            <option value="momentum">Momentum</option>
          </select>
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button onClick={runScreener} disabled={loading}
            style={{ background: "#1E4FD8", border: "none", color: "#fff", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, display: "flex", alignItems: "center", gap: 8 }}>
            {loading ? <><Spinner color="#fff" size={10} /> Analisi in corso…</> : "🔍 Analizza"}
          </button>
        </div>
      </div>

      {/* Info fattori */}
      {!loaded && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 28 }}>
          {[
            { icon: "💰", label: "Value", color: "#1E4FD8", desc: "Aziende con P/E e P/B bassi rispetto al mercato. Storicamente sovraperformano nel lungo periodo." },
            { icon: "📐", label: "Size", color: "#7C3AED", desc: "Small e mid cap (100M–10B). Le aziende più piccole tendono a crescere più delle large cap." },
            { icon: "📈", label: "Profitability", color: "#16A34A", desc: "Alto ROE e ROA. Le aziende più redditizie generano rendimenti superiori nel lungo termine." },
            { icon: "🚀", label: "Momentum", color: "#F4A020", desc: "Posizione relativa nel range 52 settimane. Il trend recente tende a persistere." },
          ].map(f => (
            <div key={f.label} style={{ background: "#FFFFFF", border: `1px solid ${f.color}22`, borderRadius: 10, padding: "16px 14px", boxShadow: "0 1px 4px rgba(10,22,64,0.05)" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{f.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>{f.label}</div>
              <div style={{ fontSize: 11, color: "#5A6A7E", lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ color: "#E87040", fontSize: 13, marginBottom: 16, padding: "10px 14px", background: "#FFF4F0", borderRadius: 8, border: "1px solid #FFCCC0" }}>⚠️ {error}</div>}

      {/* Risultati */}
      {sorted.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "#8A9AB0", marginBottom: 12 }}>
            {sorted.length} titoli trovati · score composito Fama-French
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sorted.map((r, idx) => (
              <div key={r.symbol}
                style={{ background: "#FFFFFF", border: "1px solid #E2E8F4", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(10,22,64,0.04)", cursor: "pointer" }}
                onClick={() => setExpanded(expanded === r.symbol ? null : r.symbol)}>
                {/* Row principale */}
                <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 80px 60px repeat(4,70px) 80px", alignItems: "center", padding: "12px 16px", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#C0C8D8" }}>#{idx+1}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0A1628" }}>{r.symbol}</div>
                    <div style={{ fontSize: 11, color: "#8A9AB0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>{r.name}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0A1628" }}>${fmt(r.price)}</div>
                  <div style={{ fontSize: 12, color: parseFloat(r.change1d) >= 0 ? "#16A34A" : "#E87040", fontWeight: 600 }}>
                    {parseFloat(r.change1d) >= 0 ? "+" : ""}{r.change1d}%
                  </div>
                  <ScoreBar value={r.scores.value}       color="#1E4FD8" />
                  <ScoreBar value={r.scores.size}        color="#7C3AED" />
                  <ScoreBar value={r.scores.profitability} color="#16A34A" />
                  <ScoreBar value={r.scores.momentum}    color="#F4A020" />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: "50%", background: `${scoreColor(r.scores.composite)}18`, border: `2px solid ${scoreColor(r.scores.composite)}`, fontWeight: 800, fontSize: 15, color: scoreColor(r.scores.composite) }}>
                    {r.scores.composite}
                  </div>
                </div>

                {/* Dettaglio espanso */}
                {expanded === r.symbol && (
                  <div style={{ borderTop: "1px solid #EEF2F8", padding: "16px", background: "#F8FAFF" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
                      <FactorBadge label="Value"         score={r.scores.value} />
                      <FactorBadge label="Size"          score={r.scores.size} />
                      <FactorBadge label="Profitability" score={r.scores.profitability} />
                      <FactorBadge label="Momentum"      score={r.scores.momentum} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px,1fr))", gap: 8, marginBottom: 14 }}>
                      {[
                        { l: "P/E", v: r.pe ?? "—" },
                        { l: "P/B", v: r.pb ?? "—" },
                        { l: "ROE", v: r.roe != null ? `${r.roe}%` : "—" },
                        { l: "ROA", v: r.roa != null ? `${r.roa}%` : "—" },
                        { l: "Cap (M)", v: `$${r.mktCapM}` },
                        { l: "Settore", v: r.sector },
                      ].map(({ l, v }) => (
                        <div key={l} style={{ background: "#FFFFFF", borderRadius: 6, padding: "8px 10px", border: "1px solid #E8EEF8" }}>
                          <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{l}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0A1628" }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <button onClick={e => { e.stopPropagation(); onAddTicker && onAddTicker(r.symbol); }}
                      style={{ background: "#1E4FD8", border: "none", color: "#fff", borderRadius: 7, padding: "8px 20px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      + Aggiungi al portafoglio
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#C0C8D8", marginTop: 16, lineHeight: 1.8 }}>
            📊 Dati fondamentali via Financial Modeling Prep. Score calcolati internamente basati sui principi Fama-French (1992, 1993). Non costituisce consulenza finanziaria.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────
function OverviewTab({ stocks, fmt, fmtPct, sym, rate, eurRate, totalValue, totalInvested,
  totalPnL, totalPct, sectorData, portfolioHistory, alerts, setSelectedId, setEditId,
  handleRemove, setShowForm, marketOpen }) {

  const [variations, setVariations] = useState({ day: null, month: null, year: null });
  const [varLoading, setVarLoading] = useState(false);

  const col = v => v >= 0 ? "#5EC98A" : "#E87040";
  const sign = v => v >= 0 ? "+" : "";





  if (stocks.length === 0) return (
    <div className="fade-up" style={{ maxWidth: 900, margin: "0 auto", padding: "48px 20px" }}>
      {/* Welcome hero */}
      <div style={{ textAlign: "center", marginBottom: 52 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#EEF4FF", border: "1px solid #C7D8FF", borderRadius: 20, padding: "6px 16px", fontSize: 11, color: "#1E4FD8", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 24 }}>
          ✦ Benvenuto su Trackfolio
        </div>
        <div style={{ fontSize: "clamp(22px, 6vw, 38px)", fontWeight: 700, color: "#0A1628", lineHeight: 1.2, marginBottom: 16, letterSpacing: "-0.01em" }}>
          Il tuo portafoglio,<br/><span style={{ color: "#1E4FD8" }}>sempre sotto controllo</span>
        </div>
        <div style={{ fontSize: 15, color: "#5A6A7E", maxWidth: 480, margin: "0 auto 32px", lineHeight: 1.7 }}>
          Traccia i tuoi investimenti, analizza le performance e prendi decisioni più consapevoli.
        </div>
        <button className="add-btn" style={{ margin: "0 auto", fontSize: 13, padding: "12px 28px" }} onClick={() => setShowForm(true)}>
          + Aggiungi il primo titolo
        </button>
      </div>

      {/* Feature highlights */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 40 }}>
        {[
          { icon: "📈", title: "Grafico performance", desc: "Visualizza il rendimento % del tuo portafoglio nel tempo, con confronto S&P 500.", color: "#EEF4FF", accent: "#1E4FD8" },
          { icon: "🎯", title: "Analisi settori", desc: "Scopri come è distribuito il tuo portafoglio per settore e ricevi suggerimenti di bilanciamento.", color: "#FFF8EE", accent: "#F4A020" },
          { icon: "🔔", title: "Alert prezzi", desc: "Imposta soglie di prezzo e ricevi notifiche quando un titolo supera i tuoi livelli target.", color: "#EEFAF3", accent: "#16A34A" },
          { icon: "🔮", title: "Simulazioni & previsioni", desc: "Simula scenari macroeconomici e proiezioni future per preparare la tua strategia.", color: "#F5EEFF", accent: "#7C3AED" },
        ].map(({ icon, title, desc, color, accent }) => (
          <div key={title} style={{ background: color, border: `1px solid ${accent}22`, borderRadius: 12, padding: "20px 18px" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0A1628", marginBottom: 6 }}>{title}</div>
            <div style={{ fontSize: 12, color: "#5A6A7E", lineHeight: 1.6 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* How to start */}
      <div style={{ background: "#F8FAFF", border: "1px solid #D8E4F8", borderRadius: 12, padding: "20px 24px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>Come iniziare</div>
          <div style={{ fontSize: 12, color: "#5A6A7E", lineHeight: 1.7 }}>
            Clicca <strong>+ Aggiungi</strong> in alto a destra, cerca il ticker del titolo (es. AAPL, QQQ, MSFT), inserisci quantità e prezzo di acquisto. Il grafico si aggiornerà automaticamente.
          </div>
        </div>
        <button className="add-btn" style={{ flexShrink: 0, fontSize: 12, padding: "10px 22px" }} onClick={() => setShowForm(true)}>
          Inizia ora →
        </button>
      </div>
    </div>
  );

  return (
    <div className="fade-up">

      {/* ── HEADER KPI ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em", color: "#0A1628" }}>
            ${fmt(totalValue)}
          </div>
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
            <div key={l} style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 6, padding: "10px 14px", minWidth: 90, textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>{l}</div>
              {varLoading ? (
                <div style={{ fontSize: 11, color: "#333" }}>…</div>
              ) : !v || isNaN(v.pct) || isNaN(v.pnl) ? (
                <div style={{ fontSize: 11, color: "#333" }}>—</div>
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

      <ChartCard stocks={stocks} eurRate={eurRate} />

      {/* ── ALLOCAZIONE (torta stile GetQuin) ── */}
      <AllocationCard stocks={stocks} eurRate={eurRate} />

      {/* ── LISTA TITOLI COMPATTA ── */}
      <div className="card">
        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Posizioni</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 620 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #E8EBF4" }}>
                {["Ticker","Q.tà","Acquisto","Attuale","Val. EUR","Valore","P&L","P&L%","Target","Stop",""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "0 8px 10px 0", fontSize: 8, color: "#444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stocks.map(s => {
                const curUSD = toUSD(s.currentPrice, s.currency, eurRate);
                const buyUSD = toUSD(s.buyPrice, s.currency, eurRate);
                const pnl = (curUSD - buyUSD) * s.qty;
                const pct = buyUSD > 0 ? (curUSD - buyUSD) / buyUSD * 100 : 0;
                const tp = s.targetPrice;
                const sl = s.stopLoss;
                const isUp = pnl >= 0;
                const currLabel = s.currency && s.currency !== "USD" ? s.currency : null;
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid #F0F2F8", cursor: "pointer", transition: "background 0.1s" }}
                    onClick={() => setSelectedId(s.id)}
                    onMouseEnter={e => e.currentTarget.style.background = "#FFFFFF"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "10px 8px 10px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <img
                          src={`https://assets.parqet.com/logos/symbol/${s.ticker}?format=svg`}
                          onError={e => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }}
                          style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #E8EBF4", objectFit: "contain", background: "#fff", padding: 2 }}
                        />
                        <div style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #E8EBF4", background: "#F0F4FA", display: "none", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#1E4FD8" }}>
                          {s.ticker.slice(0,2)}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{s.ticker}</span>
                            {s.priceReal && <MarketBadge state={s.marketState || "CLOSED"} size={7}/>}
                            {currLabel && <span style={{ fontSize: 7, color: "#7EB8F7", background: "#E8EBF2", padding: "1px 4px", borderRadius: 2 }}>{currLabel}</span>}
                            {alerts[s.id] && <span style={{ fontSize: 9 }}>🔔</span>}
                          </div>
                          <div style={{ fontSize: 10, color: "#8A9AB0", marginTop: 1 }}>{s.sector} · {s.buyDate}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#666" }}>{s.qty}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#666" }}>{currLabel ? `${s.currency === "EUR" ? "€" : ""}${fmt(s.buyPrice)}` : `$${fmt(s.buyPrice)}`}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#0A0E1A" }}>{currLabel ? `${s.currency === "EUR" ? "€" : ""}${fmt(s.currentPrice)}` : `$${fmt(s.currentPrice)}`}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#444" }}>€{fmt(curUSD * eurRate)}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: "#0A0E1A" }}>${fmt(s.qty * curUSD)}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: isUp ? "#5EC98A" : "#E87040" }}>{isUp?"+":""}${fmt(Math.abs(pnl))}</td>
                    <td style={{ padding: "10px 8px 10px 0", color: isUp ? "#5EC98A" : "#E87040", fontWeight: 500 }}>{fmtPct(pct)}</td>
                    <td style={{ padding: "10px 8px 10px 0", fontSize: 10, color: tp ? (s.currentPrice >= tp ? "#5EC98A" : "#666") : "#D8DCE8" }}>
                      {tp ? `🎯$${fmt(tp)}` : "—"}
                    </td>
                    <td style={{ padding: "10px 8px 10px 0", fontSize: 10, color: sl ? (s.currentPrice <= sl ? "#E87040" : "#666") : "#D8DCE8" }}>
                      {sl ? `🛑$${fmt(sl)}` : "—"}
                    </td>
                    <td style={{ padding: "10px 0", whiteSpace: "nowrap" }}>
                      <button onClick={e => { e.stopPropagation(); setEditId(s.id); }}
                        style={{ background: "none", border: "1px solid #2a2d35", color: "#666", fontFamily: "inherit", fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer", marginRight: 4 }}
                        onMouseEnter={e => { e.target.style.borderColor="#F4C542"; e.target.style.color="#F4C542"; }}
                        onMouseLeave={e => { e.target.style.borderColor="#D8DCE8"; e.target.style.color="#666"; }}>
                        ✎
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleRemove(s.id); }}
                        style={{ background: "none", border: "1px solid #2a2d35", color: "#444", fontFamily: "inherit", fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }}
                        onMouseEnter={e => { e.target.style.borderColor="#E87040"; e.target.style.color="#E87040"; }}
                        onMouseLeave={e => { e.target.style.borderColor="#D8DCE8"; e.target.style.color="#444"; }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16, paddingTop: 16, borderTop: "1px solid #E8EBF4" }}>
          {[
            { label: "🏆 Migliore", stock: [...stocks].sort((a,b) => (b.currentPrice-b.buyPrice)/b.buyPrice - (a.currentPrice-a.buyPrice)/a.buyPrice)[0], color: "#5EC98A" },
            { label: "📉 Peggiore", stock: [...stocks].sort((a,b) => (a.currentPrice-a.buyPrice)/a.buyPrice - (b.currentPrice-b.buyPrice)/b.buyPrice)[0], color: "#E87040" },
          ].map(({ label, stock, color }) => stock ? (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setSelectedId(stock.id)}>
              <div>
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>{label}</div>
                <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 16 }}>{stock.ticker}</div>
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

function ForecastTab({ stocks, fmt, fmtPct, sym, rate, eurRate }) {
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
    const totalValue = stocks.reduce((s, st) => s + st.qty * toUSD(st.currentPrice, st.currency, eurRate), 0);
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
  const col = v => v > 0 ? "#5EC98A" : v < 0 ? "#E87040" : "#444";

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>{"🔮 Previsioni 12 mesi"}</div>
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
              <div key={s.l} style={{ textAlign: "center", padding: "12px 8px", background: "#FFFFFF", borderRadius: 6 }}>
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{s.l}</div>
                <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 24, fontWeight: 300, color: s.c }}>{pct(s.pct)}</div>
                <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>{sym}{fmt(s.val * rate)}</div>
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
              border: `1px solid ${selected?.id === s.id ? "#F4C542" : "#E8EBF2"}`,
              background: selected?.id === s.id ? "#1a1a0a" : "#FFFFFF",
              color: selected?.id === s.id ? "#F4C542" : "#444",
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
                <div style={{ fontSize: 10, color: "#666" }}>
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
                    <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 20, color: "#F4C542" }}>${fmt(a.targetMean)}</div>
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
                <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 6, fontSize: 11, color: "#0A0E1A" }}
                  formatter={(v, n) => [`$${v}`, n === "base" ? "Proiezione base" : n === "optimistic" ? "Ottimistico" : n === "pessimistic" ? "Pessimistico" : "Target analisti"]}/>
                <Area type="monotone" dataKey="optimistic" stroke="#5EC98A" strokeWidth={1} strokeDasharray="3 3" fill="url(#optGrad2)" dot={false}/>
                <Area type="monotone" dataKey="pessimistic" stroke="#E87040" strokeWidth={1} strokeDasharray="3 3" fill="url(#pessGrad2)" dot={false}/>
                <Area type="monotone" dataKey="base" stroke="#F4C542" strokeWidth={2} fill="none" dot={false}/>
                {analystData[selected?.ticker]?.analyst?.targetMean && (
                  <Area type="monotone" dataKey="analyst" stroke="#7EB8F7" strokeWidth={2} strokeDasharray="6 3" fill="none" dot={false}/>
                )}
                <ReferenceLine y={d.currentPrice} stroke="#D8DCE8" strokeDasharray="3 3"/>
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
                  <span style={{ fontSize: 10, color: "#666" }}>{s.label}:</span>
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
                    <div key={t.l} style={{ textAlign: "center", background: "#FFFFFF", borderRadius: 6, padding: "10px 6px" }}>
                      <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{t.l}</div>
                      <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 18, color: t.c }}>${fmt(t.v)}</div>
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
                  <div style={{ display: "flex", gap: 16, paddingTop: 12, borderTop: "1px solid #E8EBF4" }}>
                    {a.forwardPE && <div><span style={{ fontSize: 9, color: "#444" }}>Forward P/E: </span><span style={{ fontSize: 11, color: "#444" }}>{a.forwardPE.toFixed(1)}</span></div>}
                    {a.beta && <div><span style={{ fontSize: 9, color: "#444" }}>Beta: </span><span style={{ fontSize: 11, color: "#444" }}>{a.beta.toFixed(2)}</span></div>}
                    {a.shortRatio && <div><span style={{ fontSize: 9, color: "#444" }}>Short ratio: </span><span style={{ fontSize: 11, color: "#444" }}>{a.shortRatio.toFixed(1)}</span></div>}
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
              <div style={{ color: "#666", fontSize: 12 }}>Nessun caso storico trovato a questo livello di prezzo.</div>
            ) : (
              <>
                {/* KPI row */}
                <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
                  {[
                    { l: "Casi trovati",  v: d.occurrences,     c: "#444",    sub: "occorrenze storiche" },
                    { l: "Win Rate",      v: `${d.winRate}%`,   c: d.winRate >= 50 ? "#5EC98A" : "#E87040", sub: "volte in positivo" },
                    { l: "Rend. medio",   v: pct(d.avgOutcome), c: col(d.avgOutcome), sub: "dopo 12 mesi" },
                    { l: "Miglior caso",  v: `+${d.maxGain}%`,  c: "#5EC98A", sub: "massimo storico" },
                    { l: "Peggior caso",  v: `${d.maxLoss}%`,   c: "#E87040", sub: "minimo storico" },
                  ].map((k, i) => (
                    <div key={k.l} style={{ flex: 1, textAlign: "center", borderRight: i < 4 ? "1px solid #E8EBF4" : "none", padding: "0 8px" }}>
                      <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 20, color: k.c, fontWeight: 300 }}>{k.v}</div>
                      <div style={{ fontSize: 8, color: "#333", marginTop: 3 }}>{k.l}</div>
                      <div style={{ fontSize: 8, color: "#D8DCE8", marginTop: 1 }}>{k.sub}</div>
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
                        <div style={{ position: "relative", height: 20, background: "#FFFFFF", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            position: "absolute", top: 0, bottom: 0,
                            left: isPos ? "50%" : `calc(50% - ${barW/2}%)`,
                            width: `${barW/2}%`,
                            background: isPos ? "#5EC98A" : "#E87040",
                            opacity: 0.7,
                            borderRadius: isPos ? "0 2px 2px 0" : "2px 0 0 2px",
                          }}/>
                          <div style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "#D8DCE8" }}/>
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
                <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11 }}
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

      <div style={{ marginTop: 20, fontSize: 9, color: "#D8DCE8", textAlign: "center" }}>
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
        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>💰 Dividendi & Cedole</div>
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
            <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300, color: k.c }}>{k.v}</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Per titolo */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Dividendi per titolo</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #E8EBF4" }}>
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
                <tr key={s.id} style={{ borderBottom: "1px solid #F0F2F8" }}>
                  <td style={{ padding: "10px 10px", color: "#0A0E1A", fontWeight: 500 }}>{s.ticker}</td>
                  <td style={{ padding: "10px 10px", color: d?.yieldPct > 0 ? "#5EC98A" : "#666" }}>
                    {isLoading ? <Spinner size={9}/> : d?.yieldPct > 0 ? `${d.yieldPct.toFixed(2)}%` : "—"}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#0A0E1A" }}>
                    {isLoading ? "…" : d?.lastAmount > 0 ? `$${d.lastAmount.toFixed(4)}` : "—"}
                  </td>
                  <td style={{ padding: "10px 10px", color: "#444" }}>
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
              <div key={s.ticker} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#FFFFFF", borderRadius: 6, border: "1px solid #E8EBF4" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{s.ticker}</span>
                  <span style={{ fontSize: 10, color: "#666" }}>{s.div.frequency}</span>
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
              <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#0A0E1A" }}
                formatter={v => [`$${v.toFixed(2)}`, "Dividendo stimato"]}/>
              <Bar dataKey="total" fill="#F4C542" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {projection12m.slice(0, 8).map((p, i) => (
              <div key={i} style={{ background: "#FFFFFF", border: "1px solid #E8EBF4", borderRadius: 4, padding: "6px 10px", fontSize: 10 }}>
                <span style={{ color: "#F4C542", fontWeight: 500 }}>{p.ticker}</span>
                <span style={{ color: "#666", marginLeft: 6 }}>{p.dateStr}</span>
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
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 4, background: i % 2 === 0 ? "#FFFFFF" : "transparent" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#0A0E1A", minWidth: 50 }}>{h.ticker}</span>
                  <span style={{ fontSize: 11, color: "#666" }}>{h.date}</span>
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
        <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>E se avessi comprato…?</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Scopri quanto varrebbe oggi un investimento passato</div>
      </div>

      {/* Form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <TickerAutocomplete value={ticker} onChange={v => setTicker(v)} onSelect={t => setTicker(t.ticker)} />
          <div style={{ flex: "0 0 140px" }}>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Data acquisto</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} max={new Date().toISOString().split("T")[0]} style={{ colorScheme: "light" }}/>
          </div>
          <div style={{ flex: "0 0 130px" }}>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Importo investito ($)</div>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1000"/>
          </div>
          <button className="add-btn" onClick={simulate} disabled={loading}>
            {loading ? <><Spinner color="#F8F9FC" size={10}/> Calcolo…</> : "Simula →"}
          </button>
        </div>
        {err && <div style={{ fontSize: 11, color: "#E87040", marginTop: 10 }}>{err}</div>}

        {/* Presets */}
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, color: "#333", alignSelf: "center" }}>Prova con:</span>
          {presets.map(p => (
            <button key={p.label} onClick={() => { setTicker(p.ticker); setDate(p.date); setAmount("1000"); }}
              style={{ background: "none", border: "1px solid #2a2d35", color: "#666", fontFamily: "inherit", fontSize: 10, padding: "4px 10px", borderRadius: 3, cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={e => { e.target.style.borderColor="#F4C542"; e.target.style.color="#F4C542"; }}
              onMouseLeave={e => { e.target.style.borderColor="#D8DCE8"; e.target.style.color="#666"; }}>
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
            <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 44, fontWeight: 300, color: result.pct >= 0 ? "#5EC98A" : "#E87040", lineHeight: 1 }}>
              ${fmt(result.currentValue)}
            </div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>€{fmt(result.currentValue * eurRate)}</div>
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
                <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 16, fontWeight: 300, color: k.c || "#0A0E1A" }}>{k.v}</div>
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
                <XAxis dataKey="date" tick={{ fill: "#D8DCE8", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor(result.chartData.length / 5)}/>
                <YAxis tick={{ fill: "#D8DCE8", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={55} tickFormatter={v => `$${(v/1000).toFixed(1)}k`}/>
                <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#0A0E1A" }} formatter={v => [`$${fmt(v)}`, "Valore"]}/>
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

// Converte prezzo in USD usando il tasso EUR/USD corrente
// EUR → price / eurRate | GBp (pence) → price/100 / (eurRate*0.85) | USD → invariato


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
  const eurRate = useEurRate(); // live EUR/USD rate
  const [swUpdate, setSwUpdate] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => setSwUpdate(true));
  }, []);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem("trackfolio_onboarding_done"); }
    catch { return true; }
  });
  function closeOnboarding() {
    try { localStorage.setItem("trackfolio_onboarding_done", "1"); } catch {}
    setShowOnboarding(false);
  }



  // eurRate gestito da useEurRate hook

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
          const KNOWN_ETFS = ["QQQ","SPY","IVV","VOO","VTI","VEA","VWO","XLE","XLF","XLK","XLV","XLI","XLP","XLY","XLB","XLU","XLRE","XLC","GLD","SLV","TLT","IEF","HYG","LQD","ARKK","ARKG","IWM","EEM","UUP","CQQQ","TIPS","BIL","SHY","SWDA","VWCE","IWDA","CSPX","EUNL","IUSQ","XDWD","VUSA","MEUD","IEMA","AGGH","IBCI","SGLD","IBTM","VGOV","VMID"];
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

          fetchPrice(stock.ticker, true).then(result => {
            if (!result) return;
            const livePrice = result.price;
            const ms = result.marketState || "CLOSED";
            const currency = result.currency || (stock.ticker.endsWith(".MI") || stock.ticker.endsWith(".AS") || stock.ticker.endsWith(".PA") || stock.ticker.endsWith(".DE") || stock.ticker.endsWith(".SW") || stock.ticker.endsWith(".MA") || stock.ticker.endsWith(".BR") ? "EUR" : stock.ticker.endsWith(".L") ? "GBp" : "USD");
            setStocksRaw(prev => prev.map(s => s.id === stock.id
              ? { ...s, currentPrice: livePrice, priceReal: true, marketState: ms,
                  prevClose: result.prevClose || livePrice,
                  change: result.change || 0,
                  changePct: result.changePct || 0,
                  currency }
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
      fetchPrice(stock.ticker, true).then(result => {
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
  const [form, setForm] = useState({ ticker: "", qty: "", buyPrice: "", sector: "Altro", buyDate: "" });
  const [adding, setAdding] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [aiText, setAiText] = useState({});
  const [aiLoading, setAiLoading] = useState({});
  const [firedAlerts, setFiredAlerts] = useState([]);
  const nextId = useRef(200);

  const displayStock = stocks.find(s => s.id === selectedId) || stocks[0];
  const totalInvested = stocks.reduce((s, x) => s + x.qty * toUSD(x.buyPrice, x.currency, eurRate), 0);
  const totalValue    = stocks.reduce((s, x) => s + x.qty * toUSD(x.currentPrice, x.currency, eurRate), 0);
  const totalPnL      = totalValue - totalInvested;
  const totalPct      = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const sectorData = Object.entries(
    stocks.reduce((acc, s) => { acc[s.sector] = (acc[s.sector] || 0) + s.qty * toUSD(s.currentPrice, s.currency, eurRate); return acc; }, {})
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
        const real = await fetchPrice(s.ticker);
        const history = await fetchHistory(s.ticker) || simulateHistory(real || s.buyPrice);
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
    const realPrice = await fetchPrice(t);
    if (!realPrice) {
      setFormErr(`Ticker "${t}" non trovato. Verifica il simbolo e riprova.`);
      setAdding(false);
      return;
    }
    const curPrice = realPrice;
    const history = simulateHistory(curPrice);
    if (realPrice) history[history.length - 1].price = realPrice;
    // Converti data da YYYY-MM-DD a dd/mm/yy
    const buyDateFormatted = form.buyDate; // salva direttamente in YYYY-MM-DD
    // Determina valuta dal ticker o dalla risposta API
    const detectedCurrency = (() => {
      if (t.endsWith(".MI") || t.endsWith(".AS") || t.endsWith(".PA") || t.endsWith(".DE") || t.endsWith(".SW") || t.endsWith(".MA") || t.endsWith(".BR")) return "EUR";
      if (t.endsWith(".L")) return "GBp"; // Pence sterline
      return "USD";
    })();
    const ns = { ticker: t, qty: q, buyPrice: p, currentPrice: parseFloat(curPrice.toFixed(2)), history, sector: form.sector || "Altro", priceReal: !!realPrice, buyDate: buyDateFormatted, currency: detectedCurrency };
    // Save to Supabase if logged in
    let dbId = null;
    if (user) {
      try { const saved = await saveStock(user.id, ns); dbId = saved.id; } catch {}
    }
    const withId = { ...ns, id: dbId || nextId.current++, dbId };
    setStocks(prev => [...prev, withId]);
    setSelectedId(withId.id);
    setForm({ ticker: "", qty: "", buyPrice: "", sector: "Altro", buyDate: "" });
    setAdding(false); setShowForm(false);
    // Auto-refresh prezzo live dopo aggiunta
    fetchPrice(t, true).then(result => {
      if (!result) return;
      const detCurr = result.currency || (
        t.endsWith(".MI")||t.endsWith(".AS")||t.endsWith(".PA")||t.endsWith(".DE")||t.endsWith(".SW") ? "EUR" :
        t.endsWith(".L") ? "GBp" : "USD"
      );
      const msFromTime = (() => {
        const now = new Date();
        if (detCurr === "EUR" || detCurr === "GBp") {
          const cet = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
          const m = cet.getHours()*60+cet.getMinutes(), d = cet.getDay();
          if (d===0||d===6) return "CLOSED";
          if (m>=540&&m<1050) return "REGULAR";
          if (m>=1050&&m<1200) return "POST";
          return "CLOSED";
        }
        const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const m = ny.getHours()*60+ny.getMinutes(), d = ny.getDay();
        if (d===0||d===6) return "CLOSED";
        if (m>=240&&m<570) return "PRE";
        if (m>=570&&m<960) return "REGULAR";
        if (m>=960&&m<1200) return "POST";
        return "CLOSED";
      })();
      const ms = (result.marketState && result.marketState !== "CLOSED") ? result.marketState : msFromTime;
      setStocksRaw(prev => prev.map(s => s.ticker === t
        ? { ...s, currentPrice: result.price, priceReal: true, marketState: ms,
            prevClose: result.prevClose || result.price,
            change: result.change || 0, changePct: result.changePct || 0,
            currency: detCurr }
        : s
      ));
      setStockStates(prev => ({ ...prev, [t]: ms }));
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
    fetchHistory(displayStock.ticker, chartPeriod).then(candles => {
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
      // Generic: ticker, qty, buyPrice, buy_date, sector
      const tickerIdx  = cols.findIndex(c => c.includes("ticker") || c.includes("symbol"));
      const qtyIdx     = cols.findIndex(c => c.includes("qty") || c.includes("quantity") || c.includes("quantit"));
      const priceIdx   = cols.findIndex(c => c.includes("price") || c.includes("prezzo") || c.includes("buy_price"));
      const dateIdx    = cols.findIndex(c => c.includes("date") || c.includes("data") || c.includes("buy_date"));
      const sectorIdx  = cols.findIndex(c => c.includes("sector") || c.includes("settore"));
      const ticker = get(tickerIdx >= 0 ? tickerIdx : 0).toUpperCase();
      // Normalizza data: YYYY-MM-DD → dd/mm/yy
      let buyDate = "";
      if (dateIdx >= 0) {
        const raw = get(dateIdx);
        if (raw.includes("-")) {
          const dp = raw.split("-");
          buyDate = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0].slice(2)}` : raw;
        } else {
          buyDate = raw;
        }
      }
      return {
        ticker,
        qty:      parseFloat(get(qtyIdx >= 0 ? qtyIdx : 1)) || 0,
        buyPrice: parseFloat(get(priceIdx >= 0 ? priceIdx : 2)?.replace(",",".")) || 0,
        sector:   sectorIdx >= 0 && get(sectorIdx) ? get(sectorIdx) : "Altro",
        buyDate:  buyDate || new Date().toLocaleDateString("it-IT", { day:"2-digit", month:"2-digit", year:"2-digit" }),
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
    const KNOWN_ETFS_IMPORT = ["QQQ","SPY","IVV","VOO","VTI","VEA","VWO","XLE","XLF","XLK","XLV","XLI","XLP","XLY","XLB","XLU","XLRE","XLC","GLD","SLV","TLT","IEF","HYG","LQD","ARKK","ARKG","IWM","EEM","SWDA","VWCE","IWDA","CSPX","EUNL","IUSQ","XDWD","VUSA","MEUD","IEMA","AGGH","IBCI","SGLD","IBTM","VGOV","VMID","CQQQ","TIPS","BIL","SHY","VWRL","SXR8","VUAA"];
    const imported = await Promise.all(importPreview.map(async (r) => {
      const result = await fetchPrice(r.ticker, true);
      const livePrice = result?.price || null;
      const detectedCurrency = result?.currency || (
        r.ticker.endsWith(".MI")||r.ticker.endsWith(".AS")||r.ticker.endsWith(".PA")||r.ticker.endsWith(".DE")||r.ticker.endsWith(".SW") ? "EUR" :
        r.ticker.endsWith(".L") ? "GBp" : "USD"
      );
      // Settore: usa quello dal CSV se non è "Altro", altrimenti auto-detect
      let sector = r.sector && r.sector !== "Altro" ? r.sector : null;
      if (!sector) {
        const base = r.ticker.replace(/\.[A-Z]+$/, "").toUpperCase();
        if (KNOWN_ETFS_IMPORT.includes(base)) sector = "ETF";
        else if (!sector || sector === "-" || sector === "—") sector = "Altro";
      }
      const history = simulateHistory(livePrice || r.buyPrice);
      return {
        id: nextId.current++, ticker: r.ticker, qty: r.qty,
        buyPrice: r.buyPrice, currentPrice: livePrice || r.buyPrice,
        history, sector: sector || "Altro",
        priceReal: !!livePrice,
        marketState: result?.marketState || "CLOSED",
        prevClose: result?.prevClose || null,
        change: result?.change || 0,
        changePct: result?.changePct || 0,
        currency: detectedCurrency,
        buyDate: r.buyDate || new Date().toLocaleDateString("it-IT", { day:"2-digit", month:"2-digit", year:"2-digit" }),
      };
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
    <h1>Trackfolio Report</h1>
    <div class="sub">Generato il ${date} · ${user?.name || ""}</div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Valore Totale</div><div class="kpi-val">${sym}${fmt(totalValue)}</div></div>
      <div class="kpi"><div class="kpi-label">Investito</div><div class="kpi-val">${sym}${fmt(totalInvested)}</div></div>
      <div class="kpi"><div class="kpi-label">P&L Totale</div><div class="kpi-val" style="color:${totalPnL>=0?"#16a34a":"#dc2626"}">${totalPnL>=0?"+":""}${sym}${fmt(Math.abs(totalPnL))}</div></div>
      <div class="kpi"><div class="kpi-label">Performance</div><div class="kpi-val" style="color:${totalPct>=0?"#16a34a":"#dc2626"}">${fmtPct(totalPct)}</div></div>
    </div>
    <table><thead><tr><th>Ticker</th><th>Settore</th><th>Q.tà</th><th>P.Acquisto</th><th>P.Attuale</th><th>Valore</th><th>P&L</th><th>P&L%</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer">⚠️ Documento generato da Trackfolio a scopo puramente informativo.<br>Non costituisce consulenza finanziaria ai sensi della normativa MiFID II.<br>Dati con possibile ritardo di 15 minuti.</div>
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
    <div style={{ minHeight: "100vh", background: "#F8F9FC", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Geist', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0} body{-webkit-tap-highlight-color:transparent} @keyframes spin{to{transform:rotate(360deg)}} @supports(padding-top: env(safe-area-inset-top)){.safe-top{padding-top:env(safe-area-inset-top)!important}}`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 16 }}><TrackfolioLogo size={28} showText={true} textColor="#0A1628" /></div>
        <span style={{ display: "inline-block", width: 16, height: 16, borderRadius: "50%", border: "2px solid #F4C542", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
      </div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={u => setUser(u)} />;

  return (
    <PlanCtx.Provider value={planCtx}>
      <CurrencyCtx.Provider value={currCtx}>
        <div style={{ minHeight: "100vh", background: "#F8F9FC", color: "#0A0E1A", fontFamily: "'Geist', sans-serif" }}>
          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');
            *{box-sizing:border-box;margin:0;padding:0}
            ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0D0F14} ::-webkit-scrollbar-thumb{background:#2a2d35;border-radius:2px}
            input,textarea,select{background:#13151c;border:1px solid #2a2d35;color:#E8E6DF;font-family:inherit;font-size:13px;padding:9px 12px;border-radius:4px;outline:none;width:100%}
            input:focus,textarea:focus,select:focus{border-color:#F4C542} input::placeholder,textarea::placeholder{color:#3a3d45}
            select{cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23555'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px}
            input[type="date"]{color-scheme:dark}
            .tab-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;padding:8px 14px;color:#8BA4C0;transition:color 0.2s;white-space:nowrap;border-bottom:1.5px solid transparent}
            .tab-btn:hover{color:#CBD8E8} .tab-btn.active{color:#F4C542;border-bottom-color:#F4C542}
            .action-btn{background:none;border:1px solid #2a2d35;cursor:pointer;font-family:inherit;color:#aaa;font-size:11px;padding:6px 14px;border-radius:4px;transition:all 0.15s;letter-spacing:0.06em;white-space:nowrap}
            .action-btn:hover{border-color:#F4C542;color:#F4C542}
            .remove-btn{background:none;border:none;cursor:pointer;color:#333;font-size:13px;padding:2px 6px;transition:color 0.15s;flex-shrink:0}
            .remove-btn:hover{color:#E87040}
            .stock-row{border-bottom:1px solid #0f1117;transition:background 0.12s;cursor:pointer}
            .stock-row:hover{background:#12141b}
            .stock-row.active{background:#14171f;border-left:2px solid #F4C542}
            .add-btn{background:#F4C542;border:none;color:#0D0F14;font-family:inherit;font-size:12px;font-weight:600;padding:10px 20px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:7px;white-space:nowrap;transition:opacity 0.15s}
            .add-btn:hover{opacity:0.85} .add-btn:disabled{opacity:0.5;cursor:not-allowed}
            .card{background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;padding:16px 18px;box-shadow:0 1px 4px rgba(10,22,40,0.06)}
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

          {/* SW Update banner */}
          {swUpdate && (
            <div style={{ background: "#1E4FD8", color: "#fff", padding: "10px 20px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>🚀 Nuova versione disponibile!</span>
              <button onClick={() => window.location.reload()}
                style={{ background: "#fff", color: "#1E4FD8", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Aggiorna
              </button>
            </div>
          )}

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
          {showOnboarding && <OnboardingModal onClose={closeOnboarding} />}

          {/* Header */}
          <div style={{ padding: "0 16px 0 20px", paddingTop: "env(safe-area-inset-top)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1a2d4a", minHeight: 52, gap: 10, background: "#0A1628", position: "sticky", top: 0, zIndex: 100 }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <TrackfolioLogo size={22} showText={true} textColor="#FFFFFF" />
              {plan === "pro" && <span style={{ fontSize: 8, background: "#F4C542", color: "#0A1628", padding: "2px 6px", borderRadius: 2, fontWeight: 700, letterSpacing: "0.1em" }}>PRO</span>}
            </div>
            {/* Desktop tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", flex: 1, justifyContent: "center" }} className="desktop-tabs">
              {["overview","confronto","screener","simulazioni","whatif","dividendi","previsioni"].map(t => (
                <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                  {t === "whatif" ? "e se?" : t === "dividendi" ? "💰 dividendi" : t === "previsioni" ? "🔮 previsioni" : t === "screener" ? "🔬 screener" : t}
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
                  : <span style={{ width: 7, height: 7, borderRadius: "50%", background: marketOpen === null ? "#444" : marketOpen ? "#4CAF50" : "#E87040", display: "inline-block", flexShrink: 0 }}/>
                }
                <span className="hide-mobile">{marketOpen === null ? "..." : marketOpen ? "Live" : "Chiusi"}</span>
              </button>
              <button className="add-btn" onClick={() => setShowForm(v => !v)} style={{ fontSize: 11, padding: "6px 14px", background: showForm ? "#E87040" : "#1E4FD8" }}>{showForm ? "✕ Chiudi" : "+ Aggiungi"}</button>
              {/* Mobile: user avatar button */}
              <button onClick={() => signOut().then(() => setUser(null))}
                style={{ background: "#1a2d4a", border: "1px solid #2a4a6a", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "#8BA4C0", fontSize: 11, fontFamily: "inherit" }}
                title={`${user.name} — Esci`}>
                {user.name?.charAt(0).toUpperCase() || "U"}
              </button>
            </div>
          </div>

          {/* Add form */}
          {showForm && (
            <div className="fade-up" style={{ padding: "16px 20px", background: "#FFFFFF", borderBottom: "1px solid #E2E8F4", boxShadow: "0 4px 16px rgba(10,22,64,0.06)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 10 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Ticker</div>
                  <TickerAutocomplete value={form.ticker} onChange={v => setForm(f => ({ ...f, ticker: v }))}
                    onSelect={t => {
                      const sector = t.sector && t.sector !== "Altro" ? t.sector : "Altro";
                      setForm(f => ({ ...f, ticker: t.ticker, sector }));
                    }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Quantità</div>
                  <input type="number" placeholder="10" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} style={{ colorScheme: "light" }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Prezzo acquisto</div>
                  <input type="number" placeholder="175.00" value={form.buyPrice} onChange={e => setForm(f => ({ ...f, buyPrice: e.target.value }))} style={{ colorScheme: "light" }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Data acquisto</div>
                  <input type="date" value={form.buyDate} max={new Date().toISOString().split("T")[0]}
                    onChange={e => setForm(f => ({ ...f, buyDate: e.target.value }))} style={{ colorScheme: "light" }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 4, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    Settore
                    {form.sector && form.sector !== "Altro"
                      ? <span style={{ color: "#16A34A", fontSize: 9, fontWeight: 700 }}>✓ {form.sector}</span>
                      : null}
                  </div>
                  {(!form.sector || form.sector === "Altro") ? (
                    <select value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}>
                      {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 14px", background: "#F0FDF4", border: "1.5px solid #16A34A44", borderRadius: 8, fontSize: 13, color: "#16A34A", fontWeight: 600 }}>
                      <span>{form.sector}</span>
                      <button onClick={() => setForm(f => ({ ...f, sector: "Altro" }))}
                        style={{ marginLeft: "auto", background: "none", border: "none", color: "#8A9AB0", cursor: "pointer", fontSize: 11, padding: 0 }}>
                        cambia
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button className="add-btn" onClick={handleAdd} disabled={adding} style={{ flex: 1, justifyContent: "center" }}>
                  {adding && <Spinner color="#FFFFFF" />}
                  {adding ? "Recupero prezzo…" : "Aggiungi titolo"}
                </button>
              </div>
              {plan === "free" && stocks.length >= PLANS.free.maxStocks && <div style={{ fontSize: 11, color: "#E87040", marginTop: 8 }}>Limite Free: max {PLANS.free.maxStocks} titoli</div>}
              {formErr && <div style={{ fontSize: 11, color: "#E87040", marginTop: 8 }}>{formErr}</div>}
            </div>
          )}

          {/* Import CSV panel */}
          {showImport && (
            <div className="fade-up" style={{ padding: "16px 28px", background: "#F8FAFF", borderBottom: "1px solid #E2E8F4" }}>
              <input ref={csvInputRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleCSVFile} />
              {importPreview.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: "#666" }}>Supporta file CSV di <strong style={{color:"#444"}}>Degiro</strong>, <strong style={{color:"#444"}}>Fineco</strong> e formato generico (ticker, qty, prezzo)</div>
                  <button className="add-btn" onClick={() => csvInputRef.current?.click()}>📂 Scegli file CSV</button>
                  {importErr && <span style={{ fontSize: 11, color: "#E87040" }}>{importErr}</span>}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 11, color: "#5EC98A", marginBottom: 10 }}>✓ Trovati {importPreview.length} titoli — controlla e conferma</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    {importPreview.map((r, i) => (
                      <div key={i} style={{ background: "#F0F2F7", border: "1px solid #2a2d35", borderRadius: 4, padding: "6px 12px", fontSize: 12 }}>
                        <span style={{ color: "#0A0E1A", fontWeight: 500 }}>{r.ticker}</span>
                        <span style={{ color: "#666", marginLeft: 8 }}>{r.qty} az. @ ${r.buyPrice}</span>
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
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", paddingBottom: "calc(80px + env(safe-area-inset-bottom))" }} className="main-content">

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
                    <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>I tuoi Titoli</div>
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
                            onMouseLeave={e => e.currentTarget.style.borderColor = "#E8EBF2"}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                                <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 18, fontWeight: 300 }}>{s.ticker}</span>
                                <span style={{ fontSize: 9, background: "#E8EBF2", color: "#666", padding: "2px 7px", borderRadius: 2 }}>{s.sector}</span>
                                {s.priceReal && <MarketBadge state={s.marketState || "CLOSED"} size={7}/>}
                                {alerts[s.id] && <span style={{ fontSize: 9 }}>🔔</span>}
                              </div>
                              <div style={{ fontSize: 10, color: "#333" }}>{s.qty} az. · acquisto ${fmt(s.buyPrice)} · {s.buyDate}</div>
                              {(s.targetPrice || s.stopLoss) && (
                                <div style={{ display: "flex", gap: 12, marginTop: 5 }}>
                                  {s.targetPrice && <span style={{ fontSize: 9, color: s.currentPrice >= s.targetPrice ? "#5EC98A" : "#666" }}>🎯 Target ${fmt(s.targetPrice)}</span>}
                                  {s.stopLoss && <span style={{ fontSize: 9, color: s.currentPrice <= s.stopLoss ? "#E87040" : "#666" }}>🛑 Stop ${fmt(s.stopLoss)}</span>}
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 16, fontFamily: "'Geist', sans-serif" }}>${fmt(s.currentPrice)}</div>
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
                    <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>Diversificazione</div>
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
                            <div key={s.name} style={{ background: "#FFFFFF", border: `1px solid ${color}33`, borderRadius: 8, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                              <div style={{ position: "absolute", top: 0, left: 0, width: `${pct}%`, height: 3, background: color }}/>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>{s.name}</div>
                                  <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 20, fontWeight: 300, color }}>{pct.toFixed(1)}%</div>
                                  <div style={{ fontSize: 10, color: "#666", marginTop: 3 }}>${fmt(s.value, 0)}</div>
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
                                <span style={{ fontSize: 11, color: "#444" }}>${fmt(s.qty*s.currentPrice,0)} · {weight.toFixed(1)}%</span>
                              </div>
                              <div style={{ background: "#E8EBF2", borderRadius: 2, height: 2 }}>
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
                              <XAxis dataKey="date" tick={{ fill: "#D8DCE8", fontSize: 9 }} axisLine={false} tickLine={false} interval={6}/>
                              <YAxis tick={{ fill: "#D8DCE8", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={45} tickFormatter={v => `${v>0?"+":""}${v}%`}/>
                              <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#0A0E1A" }} formatter={(v, n) => [`${v>0?"+":""}${v}%`, n]}/>
                              <ReferenceLine y={0} stroke="#D8DCE8" strokeDasharray="4 3" strokeWidth={1}/>
                              <Legend wrapperStyle={{ fontSize: 10, color: "#666" }}/>
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
                    <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>Confronto Titoli</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Analisi comparativa tra due posizioni</div>
                  </div>
                  <ProGate feat="comparison" h={300}>
                    <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
                      {[{label:"Titolo A",color:"#F4C542",val:compareA,set:setCompareA},{label:"Titolo B",color:"#5B8DEF",val:compareB,set:setCompareB}].map(({label,color,val,set}) => (
                        <div key={label} style={{ flex:1, minWidth:180 }}>
                          <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{label}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {stocks.map(s => (
                              <button key={s.id} onClick={() => set(s)} style={{ background: val?.id===s.id?color:"#F0F2F7", border:`1px solid ${val?.id===s.id?color:"#D8DCE8"}`, color: val?.id===s.id?"#F8F9FC":"#444", fontFamily:"inherit", fontSize:12, fontWeight:500, padding:"5px 13px", borderRadius:4, cursor:"pointer", transition:"all 0.15s" }}>{s.ticker}</button>
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
                              <div key={t} style={{ background:"#FFFFFF", border:`1px solid ${c}22`, borderRadius:"6px 6px 0 0", padding:"8px 14px", textAlign:"center" }}>
                                <span style={{ fontFamily:"'Geist', sans-serif", fontSize:18, color:c }}>{t}</span>
                              </div>
                            ))}
                          </div>
                          {rows.map(m => (
                            <div key={m.l} style={{ display:"grid", gridTemplateColumns:"130px 1fr 1fr", gap:2, marginBottom:2 }}>
                              <div style={{ background:"#FFFFFF", border:"1px solid #E8EBF4", padding:"8px 12px", fontSize:8, color:"#666", textTransform:"uppercase", letterSpacing:"0.08em", display:"flex", alignItems:"center" }}>{m.l}</div>
                              {[{v:m.a,c:m.ac},{v:m.b,c:m.bc}].map(({v,c},j) => (
                                <div key={j} style={{ background:"#FFFFFF", border:"1px solid #E8EBF4", padding:"8px 14px", fontSize:m.small?11:12, color:c||"#0A0E1A", display:"flex", alignItems:"center" }}>{v}</div>
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
                                <XAxis dataKey="date" tick={{fill:"#D8DCE8",fontSize:9}} axisLine={false} tickLine={false} interval={6} data={compareA.history}/>
                                <YAxis tick={{fill:"#D8DCE8",fontSize:9}} axisLine={false} tickLine={false} domain={["auto","auto"]} width={50} tickFormatter={v=>`${sym}${v}`}/>
                                <Tooltip contentStyle={{background:"#FFFFFF",border:"1px solid #2a2d35",borderRadius:4,fontSize:11,color:"#0A0E1A"}}/>
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
                    })() : <div style={{ color:"#D8DCE8", textAlign:"center", marginTop:50, fontSize:13 }}>Seleziona due titoli diversi per confrontarli.</div>}
                  </ProGate>
                </div>
              )}

              {/* ALERT */}
              {activeTab === "screener" && (
                <ScreenerTab fmt={fmt} onAddTicker={ticker => {
                  setForm(f => ({ ...f, ticker }));
                  setShowForm(true);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }} />
              )}
              {activeTab === "alert" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 22, fontWeight: 300 }}>Alert Prezzi</div>
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
                              <div style={{ fontSize:9, color:"#666", marginTop:2 }}>Attuale: {sym}{fmt(s.currentPrice*rate)}</div>
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
                    <div style={{ marginTop:16, padding:"12px 16px", background:"#F0F4FA", borderRadius:6, fontSize:9, color:"#D8DCE8", lineHeight:1.8 }}>
                      In produzione: notifiche via <strong style={{color:"#333"}}>email</strong> (Resend) e <strong style={{color:"#333"}}>push</strong> (Web Push API) · Alert controllati ogni 60s durante l'orario di borsa
                    </div>
                  </ProGate>
                </div>
              )}

              {/* SIMULAZIONI */}
              {activeTab === "simulazioni" && (
                <SimulazioniTab stocks={stocks} sym={sym} rate={rate} fmt={fmt} fmtPct={fmtPct} eurRate={eurRate} />
              )}

              {activeTab === "whatif" && (
                <WhatIfTab fmt={fmt} fmtPct={fmtPct} eurRate={eurRate} />
              )}
              {activeTab === "dividendi" && (
                <DividendiTab stocks={stocks} fmt={fmt} fmtPct={fmtPct} sym={sym} rate={rate} />
              )}
              {activeTab === "previsioni" && (
                <ForecastTab stocks={stocks} fmt={fmt} fmtPct={fmtPct} sym={sym} rate={rate} eurRate={eurRate} />
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
          <div className="mobile-portfolio-header" style={{ padding: "12px 16px", paddingTop: "max(12px, env(safe-area-inset-top))", borderBottom: "1px solid #E0E4EE", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FFFFFF", position: "sticky", top: 0, zIndex: 100 }}>
            <div>
              <div style={{ fontSize: 8, color: "#D8DCE8", letterSpacing: "0.18em", textTransform: "uppercase" }}>Portafoglio</div>
              <div style={{ fontFamily: "'Geist', sans-serif", fontSize: 20, fontWeight: 300, color: "#0A0E1A" }}>{sym}{fmt(totalValue)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: totalPnL >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>{totalPnL >= 0 ? "+" : ""}{sym}{fmt(Math.abs(totalPnL))}</div>
              <div style={{ fontSize: 10, color: totalPct >= 0 ? "#5EC98A" : "#E87040" }}>{fmtPct(totalPct)}</div>
            </div>
          </div>

          {/* Mobile bottom navigation */}
          <div className="mobile-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#F0F4FA", borderTop: "1px solid #E0E4EE", zIndex: 999, justifyContent: "space-around", alignItems: "center", padding: "6px 0", paddingBottom: "env(safe-area-inset-bottom)" }}>
            {[
              { id: "overview",    label: "Home",     svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
              { id: "simulazioni", label: "Stress",   svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> },
              { id: "whatif",      label: "E se?",    svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
              { id: "dividendi",   label: "Divid.",   svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
              { id: "previsioni",  label: "Prev.",    svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
              { id: "screener",    label: "Screener", svg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 10px", color: activeTab === t.id ? "#1E4FD8" : "#94A3B8", fontFamily: "inherit", transition: "color 0.15s", flex: 1 }}>
                {t.svg}
                <span style={{ fontSize: 9, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: activeTab === t.id ? 700 : 400 }}>{t.label}</span>
              </button>
            ))}
          </div>

        </div>
      </CurrencyCtx.Provider>
    </PlanCtx.Provider>
  );
}
