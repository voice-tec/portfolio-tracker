// api/price.js
// ── CORS helper ───────────────────────────────────────────────────────────────
function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ["https://www.trackfolio.eu", "https://trackfolio.eu"];
  const allowedOrigin = allowed.includes(origin) ? origin : "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getMarketStateByTime() {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = nyTime.getHours(), m = nyTime.getMinutes();
  const mins = h * 60 + m;
  const day = nyTime.getDay();
  if (day === 0 || day === 6) return "CLOSED";
  if (mins >= 240 && mins < 570)  return "PRE";
  if (mins >= 570 && mins < 960)  return "REGULAR";
  if (mins >= 960 && mins < 1200) return "POST";
  return "CLOSED";
}

const YH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Accept": "application/json",
  "Referer": "https://finance.yahoo.com/",
};

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });
  const s = symbol.toUpperCase();

  if (s === "__MACRO__") {
    const fetchM = async (ticker) => {
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`, { headers: YH_HEADERS });
        if (!r.ok) return null;
        const d = await r.json();
        const result = d?.chart?.result?.[0];
        if (!result) return null;
        const closes = result.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
        const last = closes[closes.length - 1];
        const prev = closes[closes.length - 2];
        return { price: last, changePct: last && prev ? parseFloat(((last - prev) / prev * 100).toFixed(2)) : null };
      } catch { return null; }
    };
    const [vix, t10y, t3m, sp500, dxy, gold, oil] = await Promise.all([
      fetchM("^VIX"), fetchM("^TNX"), fetchM("^IRX"), fetchM("^GSPC"), fetchM("DX-Y.NYB"), fetchM("GC=F"), fetchM("CL=F"),
    ]);
    const yieldSpread = t10y?.price && t3m?.price ? parseFloat((t10y.price - t3m.price).toFixed(2)) : null;
    return res.status(200).json({
      fedRate: t3m?.price ? parseFloat(t3m.price.toFixed(2)) : null,
      treasury10y: t10y?.price ? parseFloat(t10y.price.toFixed(2)) : null,
      treasury10yChange: t10y?.changePct ?? null,
      yieldSpread, yieldCurveInverted: yieldSpread !== null ? yieldSpread < 0 : null,
      vix: vix?.price ? parseFloat(vix.price.toFixed(1)) : null,
      vixChange: vix?.changePct ?? null,
      sp500: sp500?.price ? parseFloat(sp500.price.toFixed(0)) : null,
      sp500Change: sp500?.changePct ?? null,
      dxy: dxy?.price ? parseFloat(dxy.price.toFixed(1)) : null,
      gold: gold?.price ? parseFloat(gold.price.toFixed(0)) : null,
      goldChange: gold?.changePct ?? null,
      oil: oil?.price ? parseFloat(oil.price.toFixed(1)) : null,
      timestamp: new Date().toISOString(),
    });
  }

  async function tryYahooV8(sym) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`, { headers: YH_HEADERS });
      if (!r.ok) return null;
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result?.meta?.regularMarketPrice) return null;
      const meta = result.meta;
      const price = meta.regularMarketPrice;
      const prevClose = meta.previousClose || meta.chartPreviousClose || price;
      return { price, prevClose, change: parseFloat((price - prevClose).toFixed(4)), changePct: parseFloat(((price - prevClose) / prevClose * 100).toFixed(4)), high: meta.regularMarketDayHigh, low: meta.regularMarketDayLow, open: meta.regularMarketOpen, marketState: meta.marketState || getMarketStateByTime(), currency: meta.currency, preMarket: null, afterHours: null };
    } catch { return null; }
  }

  async function tryYahooV7(sym) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`, { headers: YH_HEADERS });
      if (!r.ok) return null;
      const data = await r.json();
      const q = data?.quoteResponse?.result?.[0];
      if (!q?.regularMarketPrice) return null;
      const price = q.regularMarketPrice;
      const prevClose = q.regularMarketPreviousClose || price;
      return { price, prevClose, change: q.regularMarketChange || 0, changePct: q.regularMarketChangePercent || 0, high: q.regularMarketDayHigh, low: q.regularMarketDayLow, open: q.regularMarketOpen, marketState: q.marketState || getMarketStateByTime(), currency: q.currency, preMarket: q.preMarketPrice > 0 ? { price: q.preMarketPrice, change: parseFloat((q.preMarketPrice - prevClose).toFixed(4)), changePct: parseFloat(((q.preMarketPrice - prevClose) / prevClose * 100).toFixed(4)) } : null, afterHours: q.postMarketPrice > 0 ? { price: q.postMarketPrice, change: parseFloat((q.postMarketPrice - price).toFixed(4)), changePct: parseFloat(((q.postMarketPrice - price) / price * 100).toFixed(4)) } : null };
    } catch { return null; }
  }

  async function tryTwelveData(sym) {
    try {
      const tdKey = process.env.TWELVE_DATA_API_KEY;
      if (!tdKey) return null;
      const r = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(sym)}&apikey=${tdKey}`);
      if (!r.ok) return null;
      const d = await r.json();
      if (d.code || !d.close) return null;
      const price = parseFloat(d.close);
      const prevClose = parseFloat(d.previous_close) || price;
      return { price, prevClose, change: parseFloat((price - prevClose).toFixed(4)), changePct: parseFloat(((price - prevClose) / prevClose * 100).toFixed(4)), high: parseFloat(d.high) || null, low: parseFloat(d.low) || null, open: parseFloat(d.open) || null, marketState: getMarketStateByTime(), currency: d.currency || "USD", preMarket: null, afterHours: null };
    } catch { return null; }
  }

  async function tryFinnhub(sym) {
    try {
      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) return null;
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`);
      if (!r.ok) return null;
      const d = await r.json();
      if (!d.c || d.c === 0) return null;
      return { price: d.c, prevClose: d.pc, change: d.d, changePct: d.dp, high: d.h, low: d.l, open: d.o, marketState: getMarketStateByTime(), currency: "USD", preMarket: null, afterHours: null };
    } catch { return null; }
  }

  try {
    const result = await tryYahooV8(s) || await tryYahooV7(s) || await tryTwelveData(s) || await tryFinnhub(s);
    if (!result) return res.status(404).json({ error: `Ticker "${s}" non trovato` });
    const marketState = (result.marketState && result.marketState !== "CLOSED") ? result.marketState : getMarketStateByTime();
    return res.status(200).json({ symbol: s, price: parseFloat(result.price.toFixed(4)), regularPrice: parseFloat(result.price.toFixed(4)), change: result.change, changePercent: result.changePct, high: result.high, low: result.low, open: result.open, prevClose: result.prevClose, marketState, preMarket: result.preMarket || null, afterHours: result.afterHours || null, currency: result.currency || "USD" });
  } catch (err) {
    console.error("Price error:", err);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
}
