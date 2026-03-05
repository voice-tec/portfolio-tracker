// api/search.js — Vercel Serverless Function
// GET /api/search?q=apple
// Returns matching ticker symbols from Finnhub symbol search.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing q parameter" });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });

  try {
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });
    }

    const data = await response.json();

    // Map to a clean format, limit to 8 results, filter out noise
    const results = (data.result || [])
      .filter(r => r.type === "Common Stock" || r.type === "ETP")
      .slice(0, 8)
      .map(r => ({
        ticker:   r.symbol,
        name:     r.description,
        exchange: r.displaySymbol?.includes(".") ? r.displaySymbol.split(".")[1] : "US",
        type:     r.type,
      }));

    return res.status(200).json({ results });

  } catch (err) {
    console.error("Finnhub search error:", err);
    return res.status(500).json({ error: "Failed to search symbols" });
  }
}
