// api/history.js — Vercel Serverless Function
// GET /api/history?symbol=AAPL&days=30
// GET /api/history?symbol=AAPL&from=2019-01-01  (data specifica)
// Usa Yahoo Finance per date > 365 giorni fa, Finnhub per dati recenti

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, days, from } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol parameter" });

  const toTs = Math.floor(Date.now() / 1000);
  let fromTs;
  let useYahoo = false;

  if (from) {
    fromTs = Math.floor(new Date(from).getTime() / 1000);
    const daysBack = (toTs - fromTs) / 86400;
    useYahoo = daysBack > 365; // Yahoo per date lontane
  } else {
    const d = parseInt(days || "30");
    fromTs = toTs - d * 86400;
    useYahoo = d > 365;
  }

  try {
    let candles = [];

    if (useYahoo) {
      // Yahoo Finance — dati storici illimitati
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?interval=1d&period1=${fromTs}&period2=${toTs}`;
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!response.ok) return res.status(404).json({ error: "No data available" });

      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (!result?.timestamp) return res.status(404).json({ error: "No historical data" });

      const closes = result.indicators?.quote?.[0]?.close;
      candles = result.timestamp
        .map((ts, i) => ({ ts, price: closes?.[i] }))
        .filter(c => c.price != null)
        .map(c => ({
          date: new Date(c.ts * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }),
          price: parseFloat(c.price.toFixed(2)),
        }));
    } else {
      // Finnhub — dati recenti (< 1 anno)
      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });

      const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol.toUpperCase())}&resolution=D&from=${fromTs}&to=${toTs}&token=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) return res.status(response.status).json({ error: "Finnhub error" });

      const data = await response.json();
      if (data.s === "no_data" || !data.t) {
        // Fallback a Yahoo anche per dati recenti
        const yhUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?interval=1d&period1=${fromTs}&period2=${toTs}`;
        const yhRes = await fetch(yhUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (yhRes.ok) {
          const yh = await yhRes.json();
          const r = yh?.chart?.result?.[0];
          const closes = r?.indicators?.quote?.[0]?.close;
          if (r?.timestamp) {
            candles = r.timestamp
              .map((ts, i) => ({ ts, price: closes?.[i] }))
              .filter(c => c.price != null)
              .map(c => ({
                date: new Date(c.ts * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }),
                price: parseFloat(c.price.toFixed(2)),
              }));
          }
        }
      } else {
        candles = data.t.map((ts, i) => ({
          date: new Date(ts * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }),
          price: parseFloat(data.c[i].toFixed(2)),
        }));
      }
    }

    if (!candles.length) return res.status(404).json({ error: "No historical data found" });

    return res.status(200).json({ symbol: symbol.toUpperCase(), candles, count: candles.length });

  } catch (err) {
    console.error("History fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch historical data" });
  }
}
