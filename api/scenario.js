// api/scenario.js — Vercel Serverless Function
// GET /api/scenario?symbol=AAPL&from=2020-02-19&to=2020-03-23
// Returns daily candles for a specific date range from Finnhub.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, from, to } = req.query;
  if (!symbol || !from || !to) return res.status(400).json({ error: "Missing symbol, from, or to" });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });

  const fromTs = Math.floor(new Date(from).getTime() / 1000);
  const toTs   = Math.floor(new Date(to).getTime() / 1000);

  try {
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol.toUpperCase())}&resolution=W&from=${fromTs}&to=${toTs}&token=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });

    const data = await response.json();

    if (data.s === "no_data" || !data.t || data.t.length === 0) {
      return res.status(404).json({ error: `No data for ${symbol} in this period` });
    }

    const candles = data.t.map((ts, i) => ({
      date:  new Date(ts * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }),
      price: parseFloat(data.c[i].toFixed(2)),
      open:  parseFloat(data.o[i].toFixed(2)),
      high:  parseFloat(data.h[i].toFixed(2)),
      low:   parseFloat(data.l[i].toFixed(2)),
    }));

    // Normalize to percentage change from first candle
    const base = candles[0].price;
    const normalized = candles.map(c => ({
      ...c,
      pct: parseFloat(((c.price - base) / base * 100).toFixed(2)),
    }));

    return res.status(200).json({ symbol: symbol.toUpperCase(), candles: normalized, base });

  } catch (err) {
    console.error("Finnhub scenario error:", err);
    return res.status(500).json({ error: "Failed to fetch scenario data" });
  }
}
