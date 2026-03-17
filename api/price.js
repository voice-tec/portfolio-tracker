export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });
  const s = symbol.toUpperCase();

  // ── ROUTE MACRO: ?symbol=__MACRO__ ──────────────────────────────────────
  if (s === "__MACRO__") {
    async function fetchYahooMacro(sym) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
        if (!r.ok) return null;
        const data = await r.json();
        const result = data?.chart?.result?.[0];
        if (!result) return null;
        const closes = result.indicators?.quote?.[0]?.close || [];
        const last = closes.filter(Boolean).pop();
        const prev = closes.filter(Boolean).slice(-2)[0];
        const changePct = last && prev ? parseFloat(((last - prev) / prev * 100).toFixed(2)) : null;
        return { price: last, changePct };
      } catch { return null; }
    }
    const [vix, t10y, t3m, sp500, dxy, gold, oil] = await Promise.all([
      fetchYahooMacro("^VIX"), fetchYahooMacro("^TNX"), fetchYahooMacro("^IRX"),
      fetchYahooMacro("^GSPC"), fetchYahooMacro("DX-Y.NYB"), fetchYahooMacro("GC=F"), fetchYahooMacro("CL=F"),
    ]);
    const yieldSpread = (t10y?.price && t3m?.price) ? parseFloat((t10y.price - t3m.price).toFixed(2)) : null;
    return res.status(200).json({
      fedRate:         t3m?.price  ? parseFloat(t3m.price.toFixed(2))  : null,
      treasury10y:     t10y?.price ? parseFloat(t10y.price.toFixed(2)) : null,
      treasury10yChange: t10y?.changePct,
      yieldSpread,
      yieldCurveInverted: yieldSpread !== null ? yieldSpread < 0 : null,
      vix:             vix?.price  ? parseFloat(vix.price.toFixed(1))  : null,
      vixChange:       vix?.changePct,
      sp500:           sp500?.price ? parseFloat(sp500.price.toFixed(0)) : null,
      sp500Change:     sp500?.changePct,
      dxy:             dxy?.price  ? parseFloat(dxy.price.toFixed(1))  : null,
      gold:            gold?.price ? parseFloat(gold.price.toFixed(0)) : null,
      goldChange:      gold?.changePct,
      oil:             oil?.price  ? parseFloat(oil.price.toFixed(1))  : null,
      timestamp:       new Date().toISOString(),
    });
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

  // ── 1. Yahoo v8/chart — funziona per US e EU da Vercel ──────────────────────
  async function tryYahooV8(sym) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`;
      const r = await fetch(url, { headers: YH_HEADERS });
      if (!r.ok) return null;
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result?.meta?.regularMarketPrice) return null;
      const meta = result.meta;
      const price = meta.regularMarketPrice;
      const prevClose = meta.previousClose || meta.chartPreviousClose || price;
      return {
        price, prevClose,
        change: parseFloat((price - prevClose).toFixed(4)),
        changePct: parseFloat(((price - prevClose) / prevClose * 100).toFixed(4)),
        high: meta.regularMarketDayHigh,
        low: meta.regularMarketDayLow,
        open: meta.regularMarketOpen,
        marketState: meta.marketState || getMarketStateByTime(),
        currency: meta.currency,
      };
    } catch { return null; }
  }

  // ── 2. Yahoo v7 — funziona meno da Vercel ma proviamo ───────────────────────
  async function tryYahooV7(sym) {
    try {
      const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`;
      const r = await fetch(url, { headers: YH_HEADERS });
      if (!r.ok) return null;
      const data = await r.json();
      const q = data?.quoteResponse?.result?.[0];
      if (!q?.regularMarketPrice) return null;
      const price = q.regularMarketPrice;
      const prevClose = q.regularMarketPreviousClose || price;
      return {
        price, prevClose,
        change: q.regularMarketChange || 0,
        changePct: q.regularMarketChangePercent || 0,
        high: q.regularMarketDayHigh,
        low: q.regularMarketDayLow,
        open: q.regularMarketOpen,
        marketState: q.marketState || getMarketStateByTime(),
        preMarket: q.preMarketPrice > 0 ? {
          price: q.preMarketPrice,
          change: q.preMarketPrice - prevClose,
          changePct: (q.preMarketPrice - prevClose) / prevClose * 100,
        } : null,
        afterHours: q.postMarketPrice > 0 ? {
          price: q.postMarketPrice,
          change: q.postMarketPrice - price,
          changePct: (q.postMarketPrice - price) / price * 100,
        } : null,
      };
    } catch { return null; }
  }

  // ── 3. Finnhub — solo US ─────────────────────────────────────────────────────
  async function tryFinnhub(sym) {
    try {
      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) return null;
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`);
      if (!r.ok) return null;
      const d = await r.json();
      if (!d.c || d.c === 0) return null;
      return { price: d.c, prevClose: d.pc, change: d.d, changePct: d.dp, marketState: getMarketStateByTime() };
    } catch { return null; }
  }

  try {
    // Prova v8 prima (funziona per tutti i mercati da Vercel)
    const v8 = await tryYahooV8(s);
    if (v8) {
      const marketState = (v8.marketState && v8.marketState !== "CLOSED") ? v8.marketState : getMarketStateByTime();
      return res.status(200).json({
        symbol: s,
        price: parseFloat(v8.price.toFixed(4)),
        regularPrice: parseFloat(v8.price.toFixed(4)),
        change: v8.change,
        changePercent: v8.changePct,
        high: v8.high, low: v8.low, open: v8.open,
        prevClose: v8.prevClose,
        marketState,
        preMarket: null, afterHours: null,
        source: "yahoo_v8",
        currency: v8.currency,
      });
    }

    // Fallback v7
    const v7 = await tryYahooV7(s);
    if (v7) {
      const marketState = (v7.marketState && v7.marketState !== "CLOSED") ? v7.marketState : getMarketStateByTime();
      let effectivePrice = v7.price;
      if (marketState === "PRE" && v7.preMarket?.price) effectivePrice = v7.preMarket.price;
      else if ((marketState === "POST" || marketState === "POSTPOST") && v7.afterHours?.price) effectivePrice = v7.afterHours.price;
      return res.status(200).json({
        symbol: s,
        price: parseFloat(effectivePrice.toFixed(4)),
        regularPrice: parseFloat(v7.price.toFixed(4)),
        change: v7.change, changePercent: v7.changePct,
        high: v7.high, low: v7.low, open: v7.open,
        prevClose: v7.prevClose,
        marketState,
        preMarket: v7.preMarket, afterHours: v7.afterHours,
        source: "yahoo_v7",
      });
    }

    // Ultimo fallback Finnhub (US only)
    const fh = await tryFinnhub(s);
    if (fh) {
      return res.status(200).json({
        symbol: s, price: fh.price, regularPrice: fh.price,
        change: fh.change, changePercent: fh.changePct,
        prevClose: fh.prevClose,
        marketState: fh.marketState,
        preMarket: null, afterHours: null,
        source: "finnhub",
      });
    }

    // Se richiesto solo il profilo (settore)
    if (req.query.info === "1") {
      try {
        const apiKey = process.env.FINNHUB_API_KEY;
        if (apiKey) {
          const pr = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(s)}&token=${apiKey}`);
          if (pr.ok) {
            const pd = await pr.json();
            if (pd.finnhubIndustry) {
              // Mappa Finnhub industry -> settori Trackfolio
              const map = {
                "Technology": "Tecnologia", "Software": "Tecnologia", "Semiconductors": "Tecnologia",
                "Banks": "Finanza", "Insurance": "Finanza", "Capital Markets": "Finanza",
                "Oil, Gas & Consumable Fuels": "Energia", "Energy Equipment": "Energia",
                "Healthcare": "Salute", "Pharmaceuticals": "Salute", "Biotechnology": "Salute",
                "Retail": "Consumo", "Consumer": "Consumo", "Automobiles": "Consumo",
                "Industrials": "Industriale", "Aerospace": "Industriale", "Machinery": "Industriale",
                "Real Estate": "Immobiliare", "REITs": "Immobiliare",
                "Utilities": "Utilities",
                "Materials": "Materiali",
                "Communication": "Comunicazione", "Media": "Comunicazione",
              };
              const industry = pd.finnhubIndustry || "";
              const sector = Object.entries(map).find(([k]) => industry.includes(k))?.[1] || "Altro";
              return res.status(200).json({ sector, name: pd.name, industry });
            }
          }
        }
      } catch {}
      return res.status(200).json({ sector: "Altro" });
    }

    return res.status(404).json({ error: `Ticker "${s}" non trovato` });
  } catch (err) {
    console.error("Price error:", err);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
}
