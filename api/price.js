// api/price.js — Vercel Serverless Function
// GET /api/price?symbol=AAPL
// Restituisce prezzo live + pre-market + after-hours

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol parameter" });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ error: "Finnhub error" });

    const data = await response.json();
    if (!data.c || data.c === 0) return res.status(404).json({ error: "No price data" });

    let preMarket = null, afterHours = null, marketState = "CLOSED";
    try {
      const yhRes = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?interval=1m&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (yhRes.ok) {
        const yh = await yhRes.json();
        const meta = yh?.chart?.result?.[0]?.meta;
        if (meta) {
          marketState = meta.marketState || "CLOSED";
          if (meta.preMarketPrice > 0) preMarket = { price: meta.preMarketPrice, change: +(meta.preMarketPrice - data.pc).toFixed(2), changePct: +((meta.preMarketPrice - data.pc) / data.pc * 100).toFixed(2) };
          if (meta.postMarketPrice > 0) afterHours = { price: meta.postMarketPrice, change: +(meta.postMarketPrice - data.c).toFixed(2), changePct: +((meta.postMarketPrice - data.c) / data.c * 100).toFixed(2) };
        }
      }
    } catch (_) {}

    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      price: data.c,
      change: data.d,
      changePercent: data.dp,
      high: data.h, low: data.l, open: data.o, prevClose: data.pc,
      marketState, preMarket, afterHours,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch price data" });
  }
}
