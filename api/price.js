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

  // Prova a fetchare da Yahoo v7 con un simbolo specifico
  async function tryYahoo(sym) {
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
  }

  // Lista suffissi da provare per ticker europei senza suffisso
  function getEuropeanVariants(sym) {
    // Se ha già suffisso → nessuna variante
    if (sym.includes(".")) return [];
    return [
      `${sym}.MI`,  // Borsa Italiana
      `${sym}.AS`,  // Amsterdam / Euronext
      `${sym}.L`,   // Londra
      `${sym}.PA`,  // Parigi
      `${sym}.DE`,  // Francoforte
      `${sym}.SW`,  // Svizzera
      `${sym}.MA`,  // Madrid
    ];
  }

  try {
    // 1. Prova il simbolo così com'è
    let q = await tryYahoo(s);
    let resolvedSymbol = s;

    // 2. Se non trovato e non ha suffisso → prova varianti europee
    if (!q) {
      const variants = getEuropeanVariants(s);
      for (const v of variants) {
        q = await tryYahoo(v);
        if (q) { resolvedSymbol = v; break; }
      }
    }

    if (q) {
      const regularPrice = q.regularMarketPrice;
      const prevClose = q.regularMarketPreviousClose || regularPrice;
      const yhState = q.marketState || "";
      const timeState = getMarketStateByTime();
      const marketState = (yhState && yhState !== "CLOSED") ? yhState : timeState;

      let preMarket = null;
      if (q.preMarketPrice && q.preMarketPrice > 0) {
        preMarket = {
          price: parseFloat(q.preMarketPrice.toFixed(2)),
          change: parseFloat((q.preMarketPrice - prevClose).toFixed(2)),
          changePct: parseFloat(((q.preMarketPrice - prevClose) / prevClose * 100).toFixed(2)),
        };
      }
      let afterHours = null;
      if (q.postMarketPrice && q.postMarketPrice > 0) {
        afterHours = {
          price: parseFloat(q.postMarketPrice.toFixed(2)),
          change: parseFloat((q.postMarketPrice - regularPrice).toFixed(2)),
          changePct: parseFloat(((q.postMarketPrice - regularPrice) / regularPrice * 100).toFixed(2)),
        };
      }
      let effectivePrice = regularPrice;
      if (marketState === "PRE" && preMarket?.price) effectivePrice = preMarket.price;
      else if ((marketState === "POST" || marketState === "POSTPOST") && afterHours?.price) effectivePrice = afterHours.price;

      return res.status(200).json({
        symbol: resolvedSymbol, // Ritorna il simbolo risolto (es. SWDA.AS)
        originalSymbol: s,
        price: parseFloat(effectivePrice.toFixed(2)),
        regularPrice: parseFloat(regularPrice.toFixed(2)),
        change: q.regularMarketChange || 0,
        changePercent: q.regularMarketChangePercent || 0,
        high: q.regularMarketDayHigh, low: q.regularMarketDayLow,
        open: q.regularMarketOpen, prevClose,
        marketState, preMarket, afterHours,
        source: "yahoo_v7",
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Fallback Finnhub (solo ticker US)
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return res.status(404).json({ error: `Ticker "${s}" non trovato` });
    const finnRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${apiKey}`);
    if (!finnRes.ok) return res.status(404).json({ error: `Ticker "${s}" non trovato` });
    const finn = await finnRes.json();
    if (!finn.c || finn.c === 0) return res.status(404).json({ error: `Ticker "${s}" non trovato` });

    return res.status(200).json({
      symbol: s, price: finn.c, regularPrice: finn.c,
      change: finn.d, changePercent: finn.dp,
      high: finn.h, low: finn.l, open: finn.o, prevClose: finn.pc,
      marketState: getMarketStateByTime(),
      preMarket: null, afterHours: null,
      source: "finnhub",
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Price error:", err);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
}
