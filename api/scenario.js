// api/scenario.js — Vercel Serverless Function
// GET /api/scenario?symbol=AAPL&from=2020-02-19&to=2020-03-23
// Usa Yahoo Finance per dati storici illimitati (Finnhub free è limitato a 1 anno)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=86400"); // cache 24h — dati storici non cambiano

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, from, to } = req.query;
  if (!symbol || !from || !to) return res.status(400).json({ error: "Missing symbol, from, or to" });

  const fromTs = Math.floor(new Date(from).getTime() / 1000);
  const toTs   = Math.floor(new Date(to).getTime() / 1000) + 86400;

  try {
    // Yahoo Finance v8 — dati storici illimitati, gratuiti
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?interval=1wk&period1=${fromTs}&period2=${toTs}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });

    if (!response.ok) return res.status(200).json({ candles: [], spy: [], error: "No data available" });

    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result || !result.timestamp || result.timestamp.length === 0) {
      return res.status(200).json({ candles: [], spy: [], error: `No data for ${symbol} in this period` });
    }

    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close;

    if (!closes || closes.length === 0) {
      return res.status(200).json({ candles: [], spy: [] });
    }

    // Build candles, skip null values
    const candles = timestamps
      .map((ts, i) => ({ ts, price: closes[i] }))
      .filter(c => c.price != null)
      .map(c => ({
        date: new Date(c.ts * 1000).toISOString().slice(0, 10),
        price: parseFloat(c.price.toFixed(2)),
      }));

    if (candles.length === 0) return res.status(200).json({ candles: [], spy: [] });

    // Rimuovi ultimo punto se anomalo (>15% dal penultimo) — common con dividend adjustments Yahoo
    const trimmed = candles.length > 2 && Math.abs((candles[candles.length-1].price - candles[candles.length-2].price) / candles[candles.length-2].price) > 0.15
      ? candles.slice(0, -1) : candles;

    // Normalize to % change from first candle
    const base = trimmed[0].price;
    const normalized = trimmed.map(c => ({
      ...c,
      pct: parseFloat(((c.price - base) / base * 100).toFixed(2)),
    }));

    // Also fetch SPY (S&P500 ETF) for the same period as benchmark
    let spyCandles = null;
    try {
      const spyUrl = `https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1wk&period1=${fromTs}&period2=${toTs}`;
      const spyRes = await fetch(spyUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (spyRes.ok) {
        const spyData = await spyRes.json();
        const spyResult = spyData?.chart?.result?.[0];
        if (spyResult?.timestamp) {
          const spyCloses = spyResult.indicators?.quote?.[0]?.close;
          const spyBase = spyCloses?.find(c => c != null);
          if (spyBase) {
            spyCandles = spyResult.timestamp
              .map((ts, i) => ({ ts, price: spyCloses[i] }))
              .filter(c => c.price != null)
              .map(c => ({
                date: new Date(c.ts * 1000).toISOString().slice(0, 10),
                pct: parseFloat(((c.price - spyBase) / spyBase * 100).toFixed(2)),
              }));
          }
        }
      }
    } catch (_) {}

    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      candles: normalized,
      spy: spyCandles,
      base,
      source: "yahoo",
    });

  } catch (err) {
    console.error("Scenario fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch scenario data" });
  }
}
