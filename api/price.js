// api/price.js — Vercel Serverless Function
// Usa Yahoo Finance v7/quote come fonte principale (più affidabile per pre/after)
// Finnhub come fallback

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const s = symbol.toUpperCase();

  try {
    // ── 1. Yahoo Finance v7/quote — fonte principale ─────────────────────────
    // Più affidabile di v8/chart per preMarketPrice e postMarketPrice
    const yhUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(s)}&fields=regularMarketPrice,preMarketPrice,postMarketPrice,preMarketChangePercent,postMarketChangePercent,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,marketState`;
    const yhRes = await fetch(yhUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json" }
    });

    if (yhRes.ok) {
      const yhData = await yhRes.json();
      const q = yhData?.quoteResponse?.result?.[0];

      if (q && q.regularMarketPrice) {
        const marketState = q.marketState || "CLOSED";
        const regularPrice = q.regularMarketPrice;
        const prevClose = q.regularMarketPreviousClose || regularPrice;

        // Pre-market
        let preMarket = null;
        if (q.preMarketPrice && q.preMarketPrice > 0) {
          preMarket = {
            price: q.preMarketPrice,
            change: parseFloat((q.preMarketPrice - prevClose).toFixed(2)),
            changePct: parseFloat(((q.preMarketPrice - prevClose) / prevClose * 100).toFixed(2)),
          };
        }

        // After-hours / post-market
        let afterHours = null;
        if (q.postMarketPrice && q.postMarketPrice > 0) {
          afterHours = {
            price: q.postMarketPrice,
            change: parseFloat((q.postMarketPrice - regularPrice).toFixed(2)),
            changePct: parseFloat(((q.postMarketPrice - regularPrice) / regularPrice * 100).toFixed(2)),
          };
        }

        // Prezzo effettivo: usa pre/after se attivi
        let effectivePrice = regularPrice;
        if (marketState === "PRE" && preMarket?.price) effectivePrice = preMarket.price;
        else if ((marketState === "POST" || marketState === "POSTPOST") && afterHours?.price) effectivePrice = afterHours.price;

        return res.status(200).json({
          symbol: s,
          price: effectivePrice,
          regularPrice,
          change: q.regularMarketChange || 0,
          changePercent: q.regularMarketChangePercent || 0,
          high: q.regularMarketDayHigh,
          low: q.regularMarketDayLow,
          open: q.regularMarketOpen,
          prevClose,
          marketState,
          preMarket,
          afterHours,
          source: "yahoo",
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ── 2. Fallback: Finnhub + Yahoo v8 per pre/after ────────────────────────
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "No data available" });

    const [finnRes, v8Res] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${apiKey}`),
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1m&range=1d`, {
        headers: { "User-Agent": "Mozilla/5.0" }
      })
    ]);

    if (!finnRes.ok) return res.status(404).json({ error: `Ticker "${s}" non trovato` });
    const finn = await finnRes.json();
    if (!finn.c || finn.c === 0) return res.status(404).json({ error: `Ticker "${s}" non trovato` });

    let preMarket = null, afterHours = null, marketState = "CLOSED";
    if (v8Res.ok) {
      const v8 = await v8Res.json();
      const meta = v8?.chart?.result?.[0]?.meta;
      if (meta) {
        marketState = meta.marketState || "CLOSED";
        if (meta.preMarketPrice > 0) preMarket = {
          price: meta.preMarketPrice,
          change: parseFloat((meta.preMarketPrice - finn.pc).toFixed(2)),
          changePct: parseFloat(((meta.preMarketPrice - finn.pc) / finn.pc * 100).toFixed(2)),
        };
        if (meta.postMarketPrice > 0) afterHours = {
          price: meta.postMarketPrice,
          change: parseFloat((meta.postMarketPrice - finn.c).toFixed(2)),
          changePct: parseFloat(((meta.postMarketPrice - finn.c) / finn.c * 100).toFixed(2)),
        };
      }
    }

    let effectivePrice = finn.c;
    if (marketState === "PRE" && preMarket?.price) effectivePrice = preMarket.price;
    else if ((marketState === "POST" || marketState === "POSTPOST") && afterHours?.price) effectivePrice = afterHours.price;

    return res.status(200).json({
      symbol: s,
      price: effectivePrice,
      regularPrice: finn.c,
      change: finn.d,
      changePercent: finn.dp,
      high: finn.h, low: finn.l, open: finn.o, prevClose: finn.pc,
      marketState, preMarket, afterHours,
      source: "finnhub",
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Price error:", err);
    return res.status(500).json({ error: "Failed to fetch price" });
  }
}
