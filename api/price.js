// api/price.js — Vercel Serverless Function
// GET /api/price?symbol=AAPL
// Proxies Finnhub /quote endpoint, keeping the API key server-side.

export default async function handler(req, res) {
  // CORS headers — restrict to your domain in production
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

    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }

    const data = await response.json();

    // Finnhub quote response:
    // c  = current price
    // d  = change
    // dp = percent change
    // h  = high of the day
    // l  = low of the day
    // o  = open price
    // pc = previous close

    if (!data.c || data.c === 0) {
      return res.status(404).json({ error: `No price data found for ${symbol}` });
    }

    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      price: data.c,
      change: data.d,
      changePercent: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      prevClose: data.pc,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("Finnhub fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch price data" });
  }
}
