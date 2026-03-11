// ─── API CLIENT ───────────────────────────────────────────────────────────────

const IS_VERCEL = typeof window !== "undefined" && window.location.hostname.includes("vercel.app");
export const API_BASE = IS_VERCEL ? "" : "https://portfolio-tracker-i97337xz6-voice-tecs-projects.vercel.app";

// Cache prezzi in memoria (TTL 60s)
const priceCache = {};
const CACHE_TTL = 60_000;

export async function fetchPrice(ticker, full = false) {
  const key = ticker.toUpperCase();
  const cached = priceCache[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return full ? cached : cached.price;
  try {
    const res = await fetch(`${API_BASE}/api/price?symbol=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.price) return null;
    const result = {
      price: data.price,
      regularPrice: data.regularPrice || data.price,
      marketState: data.marketState || "CLOSED",
      prevClose: data.prevClose || null,
      change: data.change || 0,
      changePct: data.changePercent || 0,
      currency: data.currency || "USD",
      preMarket: data.preMarket || null,
      afterHours: data.afterHours || null,
      ts: Date.now(),
    };
    priceCache[key] = result;
    return full ? result : result.price;
  } catch { return null; }
}

export async function fetchHistory(ticker, days = 30) {
  try {
    const res = await fetch(`${API_BASE}/api/history?symbol=${encodeURIComponent(ticker.toUpperCase())}&days=${days}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.candles || null;
  } catch { return null; }
}

export async function fetchAnalyst(ticker) {
  try {
    const res = await fetch(`${API_BASE}/api/analyst?symbol=${encodeURIComponent(ticker)}`);
    if (!res.ok) return { sectorWeights: [], analyst: null };
    return await res.json();
  } catch { return { sectorWeights: [], analyst: null }; }
}

export async function fetchSearch(q) {
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(r => ({ ticker: r.ticker, name: r.name, exchange: r.exchange }));
  } catch { return []; }
}

export async function fetchNews(ticker) {
  try {
    const res = await fetch(`${API_BASE}/api/news?symbol=${encodeURIComponent(ticker)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function fetchScenario(ticker, from, to) {
  try {
    const res = await fetch(`${API_BASE}/api/scenario?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function fetchAIAnalysis(stock, note, currencySymbol) {
  try {
    const pnlPct = ((stock.currentPrice - stock.buyPrice) / stock.buyPrice * 100).toFixed(2);
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: stock.ticker, qty: stock.qty,
        buyPrice: stock.buyPrice.toFixed(2),
        currentPrice: stock.currentPrice.toFixed(2),
        pnlPct, note: note || "", currency: currencySymbol,
      }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    return data.analysis || "Analisi non disponibile.";
  } catch { return "Errore nel recupero dell'analisi. Riprova tra qualche secondo."; }
}
