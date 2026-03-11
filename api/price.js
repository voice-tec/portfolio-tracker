export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });
  const s = symbol.toUpperCase();

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

  // ── 1. Yahoo Finance v7 ──────────────────────────────────────────────────────
  async function tryYahoo(sym) {
    try {
      const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
          "Referer": "https://finance.yahoo.com",
          "Origin": "https://finance.yahoo.com",
        }
      });
      if (!r.ok) return null;
      const data = await r.json();
      const q = data?.quoteResponse?.result?.[0];
      if (!q?.regularMarketPrice) return null;
      return q;
    } catch { return null; }
  }

  // ── 2. Twelve Data — ottimo per titoli europei ───────────────────────────────
  async function tryTwelveData(sym) {
    try {
      const tdKey = process.env.TWELVE_DATA_API_KEY;
      if (!tdKey) return null;
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(sym)}&apikey=${tdKey}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      // Twelve Data ritorna { code: 400 } se non trova il ticker
      if (d.code || !d.close || d.close === "0") return null;
      const price = parseFloat(d.close);
      const prevClose = parseFloat(d.previous_close) || price;
      const change = parseFloat(d.change) || 0;
      const changePct = parseFloat(d.percent_change) || 0;
      if (!price || isNaN(price)) return null;
      return { price, prevClose, change, changePct, source: "twelve_data" };
    } catch { return null; }
  }

  // ── 3. Finnhub — fallback solo US ────────────────────────────────────────────
  async function tryFinnhub(sym) {
    try {
      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) return null;
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`);
      if (!r.ok) return null;
      const d = await r.json();
      if (!d.c || d.c === 0) return null;
      return { price: d.c, prevClose: d.pc, change: d.d, changePct: d.dp, source: "finnhub" };
    } catch { return null; }
  }

  try {
    // Prova Yahoo prima (veloce, nessun limite)
    const yq = await tryYahoo(s);
    if (yq) {
      const regularPrice = yq.regularMarketPrice;
      const prevClose = yq.regularMarketPreviousClose || regularPrice;
      const yhState = yq.marketState || "";
      const marketState = (yhState && yhState !== "CLOSED") ? yhState : getMarketStateByTime();

      let preMarket = null;
      if (yq.preMarketPrice > 0) preMarket = {
        price: parseFloat(yq.preMarketPrice.toFixed(2)),
        change: parseFloat((yq.preMarketPrice - prevClose).toFixed(2)),
        changePct: parseFloat(((yq.preMarketPrice - prevClose) / prevClose * 100).toFixed(2)),
      };
      let afterHours = null;
      if (yq.postMarketPrice > 0) afterHours = {
        price: parseFloat(yq.postMarketPrice.toFixed(2)),
        change: parseFloat((yq.postMarketPrice - regularPrice).toFixed(2)),
        changePct: parseFloat(((yq.postMarketPrice - regularPrice) / regularPrice * 100).toFixed(2)),
      };
      let effectivePrice = regularPrice;
      if (marketState === "PRE" && preMarket?.price) effectivePrice = preMarket.price;
      else if ((marketState === "POST" || marketState === "POSTPOST") && afterHours?.price) effectivePrice = afterHours.price;

      return res.status(200).json({
        symbol: s, price: parseFloat(effectivePrice.toFixed(2)),
        regularPrice: parseFloat(regularPrice.toFixed(2)),
        change: yq.regularMarketChange || 0,
        changePercent: yq.regularMarketChangePercent || 0,
        high: yq.regularMarketDayHigh, low: yq.regularMarketDayLow,
        open: yq.regularMarketOpen, prevClose,
        marketState, preMarket, afterHours,
        source: "yahoo_v7",
      });
    }

    // Fallback: Twelve Data (copre ETF europei, Borsa Italiana, Euronext, ecc.)
    const td = await tryTwelveData(s);
    if (td) {
      return res.status(200).json({
        symbol: s, price: parseFloat(td.price.toFixed(2)),
        regularPrice: parseFloat(td.price.toFixed(2)),
        change: td.change, changePercent: td.changePct,
        prevClose: td.prevClose,
        marketState: getMarketStateByTime(),
        preMarket: null, afterHours: null,
        source: "twelve_data",
      });
    }

    // Ultimo fallback: Finnhub (solo US)
    const fh = await tryFinnhub(s);
    if (fh) {
      return res.status(200).json({
        symbol: s, price: fh.price, regularPrice: fh.price,
        change: fh.change, changePercent: fh.changePct,
        prevClose: fh.prevClose,
        marketState: getMarketStateByTime(),
        preMarket: null, afterHours: null,
        source: "finnhub",
      });
    }

    return res.status(404).json({ error: `Ticker "${s}" non trovato` });

  } catch (err) {
    console.error("Price error:", err);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
}
