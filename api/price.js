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

  const YH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
    "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
  };

  // Prova più endpoint Yahoo con vari host
  async function tryYahoo(sym) {
    const endpoints = [
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`,
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,
    ];
    for (const url of endpoints) {
      try {
        const r = await fetch(url, { headers: YH_HEADERS });
        if (!r.ok) continue;
        const data = await r.json();
        // v7 response
        const q = data?.quoteResponse?.result?.[0];
        if (q?.regularMarketPrice) return { type: "v7", q };
        // v8 chart response — estrai prezzo dal chart
        const chart = data?.chart?.result?.[0];
        if (chart) {
          const meta = chart.meta;
          if (meta?.regularMarketPrice) return { type: "v8", q: {
            regularMarketPrice: meta.regularMarketPrice,
            regularMarketPreviousClose: meta.previousClose || meta.chartPreviousClose,
            regularMarketChange: meta.regularMarketPrice - (meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice),
            regularMarketChangePercent: meta.previousClose ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100) : 0,
            marketState: meta.marketState || "CLOSED",
          }};
        }
      } catch { continue; }
    }
    return null;
  }

  // Twelve Data — per ticker europei
  async function tryTwelveData(sym) {
    try {
      const tdKey = process.env.TWELVE_DATA_API_KEY;
      if (!tdKey) return null;
      // Twelve Data vuole exchange separato per ticker europei
      // Mappa suffisso → exchange code
      const exchangeMap = {
        ".MI": "MIL", ".AS": "AMS", ".PA": "EPA", ".DE": "XETR",
        ".L": "LSE", ".SW": "SWX", ".MA": "BME", ".BR": "EBR",
        ".LS": "ELI", ".HE": "HEL", ".ST": "STO",
      };
      let apiSym = sym;
      let exchange = "";
      for (const [suffix, ex] of Object.entries(exchangeMap)) {
        if (sym.endsWith(suffix)) {
          apiSym = sym.replace(suffix, "");
          exchange = ex;
          break;
        }
      }
      const params = exchange
        ? `symbol=${encodeURIComponent(apiSym)}&exchange=${exchange}`
        : `symbol=${encodeURIComponent(apiSym)}`;
      const url = `https://api.twelvedata.com/quote?${params}&apikey=${tdKey}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      if (d.code || !d.close || d.close === "0.00000") return null;
      const price = parseFloat(d.close);
      if (!price || isNaN(price)) return null;
      return {
        price,
        prevClose: parseFloat(d.previous_close) || price,
        change: parseFloat(d.change) || 0,
        changePct: parseFloat(d.percent_change) || 0,
      };
    } catch { return null; }
  }

  // Finnhub — solo US
  async function tryFinnhub(sym) {
    try {
      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) return null;
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`);
      if (!r.ok) return null;
      const d = await r.json();
      if (!d.c || d.c === 0) return null;
      return { price: d.c, prevClose: d.pc, change: d.d, changePct: d.dp };
    } catch { return null; }
  }

  try {
    // 1. Yahoo
    const yh = await tryYahoo(s);
    if (yh) {
      const { q } = yh;
      const regularPrice = q.regularMarketPrice;
      const prevClose = q.regularMarketPreviousClose || regularPrice;
      const yhState = q.marketState || "";
      const marketState = (yhState && yhState !== "CLOSED") ? yhState : getMarketStateByTime();
      let preMarket = null, afterHours = null;
      if (q.preMarketPrice > 0) preMarket = {
        price: parseFloat(q.preMarketPrice.toFixed(2)),
        change: parseFloat((q.preMarketPrice - prevClose).toFixed(2)),
        changePct: parseFloat(((q.preMarketPrice - prevClose) / prevClose * 100).toFixed(2)),
      };
      if (q.postMarketPrice > 0) afterHours = {
        price: parseFloat(q.postMarketPrice.toFixed(2)),
        change: parseFloat((q.postMarketPrice - regularPrice).toFixed(2)),
        changePct: parseFloat(((q.postMarketPrice - regularPrice) / regularPrice * 100).toFixed(2)),
      };
      let effectivePrice = regularPrice;
      if (marketState === "PRE" && preMarket?.price) effectivePrice = preMarket.price;
      else if ((marketState === "POST" || marketState === "POSTPOST") && afterHours?.price) effectivePrice = afterHours.price;
      return res.status(200).json({
        symbol: s, price: parseFloat(effectivePrice.toFixed(4)),
        regularPrice: parseFloat(regularPrice.toFixed(4)),
        change: q.regularMarketChange || 0,
        changePercent: q.regularMarketChangePercent || 0,
        high: q.regularMarketDayHigh, low: q.regularMarketDayLow,
        open: q.regularMarketOpen, prevClose,
        marketState, preMarket, afterHours, source: "yahoo",
      });
    }

    // 2. Twelve Data (europei con exchange separato)
    const td = await tryTwelveData(s);
    if (td) {
      return res.status(200).json({
        symbol: s, price: parseFloat(td.price.toFixed(4)),
        regularPrice: parseFloat(td.price.toFixed(4)),
        change: td.change, changePercent: td.changePct,
        prevClose: td.prevClose,
        marketState: getMarketStateByTime(),
        preMarket: null, afterHours: null, source: "twelve_data",
      });
    }

    // 3. Finnhub (US fallback)
    const fh = await tryFinnhub(s);
    if (fh) {
      return res.status(200).json({
        symbol: s, price: fh.price, regularPrice: fh.price,
        change: fh.change, changePercent: fh.changePct,
        prevClose: fh.prevClose,
        marketState: getMarketStateByTime(),
        preMarket: null, afterHours: null, source: "finnhub",
      });
    }

    return res.status(404).json({ error: `Ticker "${s}" non trovato` });
  } catch (err) {
    console.error("Price error:", err);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
}
