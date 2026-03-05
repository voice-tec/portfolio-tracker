// api/history.js — Vercel Serverless Function
// GET /api/history?symbol=AAPL&days=30
// Returns daily OHLCV candles from Finnhub for the last N days.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, days = "30" } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol parameter" });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });

  const to = Math.floor(Date.now() / 1000);
  const from = to - parseInt(days) * 24 * 60 * 60;

  try {
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol.toUpperCase())}&resolution=D&from=${from}&to=${to}&token=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }

    const data = await response.json();

    // data.s === "no_data" means no candles returned
    if (data.s === "no_data" || !data.t || data.t.length === 0) {
      return res.status(404).json({ error: `No historical data for ${symbol}` });
    }

    // Transform into [{date, price}] array
    const candles = data.t.map((timestamp, i) => ({
      date: new Date(timestamp * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
      price: parseFloat(data.c[i].toFixed(2)),   // closing price
      open:  parseFloat(data.o[i].toFixed(2)),
      high:  parseFloat(data.h[i].toFixed(2)),
      low:   parseFloat(data.l[i].toFixed(2)),
      volume: data.v[i],
    }));

    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      candles,
      count: candles.length,
    });

  } catch (err) {
    console.error("Finnhub history error:", err);
    return res.status(500).json({ error: "Failed to fetch historical data" });
  }
}
