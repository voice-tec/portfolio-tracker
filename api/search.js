// api/search.js — Vercel Serverless Function
// GET /api/search?q=apple
// Returns matching ticker symbols from Finnhub + sector from Yahoo Finance

const SECTOR_MAP = {
  "Technology":              "Tech",
  "Financial Services":      "Finanza",
  "Healthcare":              "Salute",
  "Energy":                  "Energia",
  "Consumer Cyclical":       "Consumer",
  "Consumer Defensive":      "Consumer",
  "Industrials":             "Industriali",
  "Real Estate":             "Real Estate",
  "Utilities":               "Utility",
  "Basic Materials":         "Materiali",
  "Communication Services":  "Telecom",
  "Financial":               "Finanza",
};

async function fetchSector(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const profile = d?.quoteSummary?.result?.[0]?.assetProfile;
    const raw = profile?.sector;
    if (!raw) return null;
    return SECTOR_MAP[raw] || "Altro";
  } catch {
    return null;
  }
}

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
    if (!response.ok) return res.status(response.status).json({ error: `Finnhub error: ${response.statusText}` });

    const data = await response.json();
    const filtered = (data.result || [])
      .filter(r => r.type === "Common Stock" || r.type === "ETP")
      .slice(0, 8);

    const results = await Promise.all(filtered.map(async r => {
      const sector = await fetchSector(r.symbol);
      return {
        ticker:   r.symbol,
        name:     r.description,
        exchange: r.displaySymbol?.includes(".") ? r.displaySymbol.split(".")[1] : "US",
        type:     r.type,
        sector:   sector || (r.type === "ETP" ? "ETF" : "Altro"),
      };
    }));

    return res.status(200).json({ results });

  } catch (err) {
    console.error("Search error:", err);
    return res.status(500).json({ error: "Failed to search symbols" });
  }
}
