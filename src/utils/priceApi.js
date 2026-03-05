// src/utils/priceApi.js
// All price fetching goes through /api/* which proxies to Finnhub server-side.
// This keeps the API key out of the browser bundle entirely.

const BASE = import.meta.env.VITE_API_BASE_URL || "";  // empty = same origin

// ─── CACHE ────────────────────────────────────────────────────────────────────
// Simple in-memory cache with TTL to avoid hammering the proxy.
const priceCache = new Map();   // symbol → { price, ts }
const historyCache = new Map(); // symbol → { candles, ts }
const searchCache = new Map();  // query  → { results, ts }

const PRICE_TTL   = 60_000;    // 60 seconds
const HISTORY_TTL = 3_600_000; // 1 hour
const SEARCH_TTL  = 86_400_000; // 24 hours

function isFresh(entry, ttl) {
  return entry && Date.now() - entry.ts < ttl;
}

// ─── FETCH CURRENT PRICE ─────────────────────────────────────────────────────
/**
 * Returns the current price for a ticker symbol.
 * Falls back to null on any error so the UI can degrade gracefully.
 *
 * @param {string} symbol  e.g. "AAPL"
 * @returns {Promise<number|null>}
 */
export async function fetchPrice(symbol) {
  const key = symbol.toUpperCase();
  const cached = priceCache.get(key);
  if (isFresh(cached, PRICE_TTL)) return cached.price;

  try {
    const res = await fetch(`${BASE}/api/price?symbol=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    priceCache.set(key, { price: data.price, ts: Date.now() });
    return data.price;
  } catch (err) {
    console.warn(`[priceApi] fetchPrice(${key}) failed:`, err.message);
    return null;
  }
}

// ─── FETCH MULTIPLE PRICES (BATCH) ───────────────────────────────────────────
/**
 * Fetches prices for multiple symbols in parallel, respecting cache.
 * Returns a map: { AAPL: 213.49, MSFT: 415.32, ... }
 *
 * @param {string[]} symbols
 * @returns {Promise<Record<string, number|null>>}
 */
export async function fetchPrices(symbols) {
  const entries = await Promise.all(
    symbols.map(async (sym) => [sym.toUpperCase(), await fetchPrice(sym)])
  );
  return Object.fromEntries(entries);
}

// ─── FETCH HISTORICAL CANDLES ─────────────────────────────────────────────────
/**
 * Returns daily closing prices for charting.
 * Format: [{ date: "01 gen", price: 213.49 }, ...]
 *
 * @param {string} symbol
 * @param {number} days  defaults to 30
 * @returns {Promise<Array<{date: string, price: number}>|null>}
 */
export async function fetchHistory(symbol, days = 30) {
  const key = `${symbol.toUpperCase()}_${days}`;
  const cached = historyCache.get(key);
  if (isFresh(cached, HISTORY_TTL)) return cached.candles;

  try {
    const res = await fetch(`${BASE}/api/history?symbol=${encodeURIComponent(symbol.toUpperCase())}&days=${days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    historyCache.set(key, { candles: data.candles, ts: Date.now() });
    return data.candles;
  } catch (err) {
    console.warn(`[priceApi] fetchHistory(${symbol}) failed:`, err.message);
    return null;
  }
}

// ─── SEARCH TICKERS ───────────────────────────────────────────────────────────
/**
 * Searches for ticker symbols matching a query string.
 * Returns an array of { ticker, name, exchange, type }.
 *
 * @param {string} query  e.g. "apple" or "AAPL"
 * @returns {Promise<Array<{ticker: string, name: string, exchange: string}>>}
 */
export async function searchTickers(query) {
  const key = query.toLowerCase().trim();
  if (!key) return [];

  const cached = searchCache.get(key);
  if (isFresh(cached, SEARCH_TTL)) return cached.results;

  try {
    const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    searchCache.set(key, { results: data.results, ts: Date.now() });
    return data.results;
  } catch (err) {
    console.warn(`[priceApi] searchTickers(${key}) failed:`, err.message);
    return [];
  }
}

// ─── AUTO-REFRESH ─────────────────────────────────────────────────────────────
/**
 * Sets up a polling interval that refreshes prices for the given symbols.
 * Calls onUpdate(pricesMap) whenever fresh data arrives.
 * Returns a cleanup function — call it to stop polling.
 *
 * Only polls during market hours (Mon–Fri, 14:30–21:00 UTC = 9:30–16:00 EST).
 *
 * @param {string[]} symbols
 * @param {(prices: Record<string, number>) => void} onUpdate
 * @param {number} intervalMs  defaults to 60_000 (1 min)
 * @returns {() => void}  cleanup function
 */
export function startPricePolling(symbols, onUpdate, intervalMs = 60_000) {
  function isMarketHours() {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;
    const hours = now.getUTCHours();
    const minutes = now.getUTCMinutes();
    const totalMinutes = hours * 60 + minutes;
    return totalMinutes >= 870 && totalMinutes <= 1260; // 14:30–21:00 UTC
  }

  async function poll() {
    if (!isMarketHours()) return; // skip outside market hours
    const prices = await fetchPrices(symbols);
    onUpdate(prices);
  }

  poll(); // immediate first call
  const id = setInterval(poll, intervalMs);
  return () => clearInterval(id);
}
