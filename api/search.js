// api/search.js
const SECTOR_MAP = {
  "Technology": "Tecnologia", "Software": "Tecnologia", "Semiconductors": "Tecnologia",
  "Financial Services": "Finanza", "Financial": "Finanza", "Banks": "Finanza", "Insurance": "Finanza",
  "Healthcare": "Salute", "Pharmaceuticals": "Salute", "Biotechnology": "Salute",
  "Energy": "Energia", "Oil": "Energia",
  "Consumer Cyclical": "Consumo", "Consumer Defensive": "Consumo", "Retail": "Consumo",
  "Industrials": "Industriale", "Aerospace": "Industriale", "Machinery": "Industriale",
  "Real Estate": "Immobiliare",
  "Utilities": "Utilities",
  "Basic Materials": "Materiali", "Materials": "Materiali",
  "Communication Services": "Comunicazione", "Media": "Comunicazione",
};

function mapSector(raw) {
  if (!raw) return null;
  const entry = Object.entries(SECTOR_MAP).find(([k]) => raw.includes(k));
  return entry ? entry[1] : null;
}

async function fetchSectorFinnhub(ticker, apiKey) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`);
    if (!r.ok) return null;
    const d = await r.json();
    return mapSector(d.finnhubIndustry || d.sector);
  } catch { return null; }
}

async function fetchSectorYahoo(ticker) {
  try {
    const r = await fetch(
      `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const raw = d?.quoteSummary?.result?.[0]?.assetProfile?.sector;
    return mapSector(raw);
  } catch { return null; }
}

// ── CORS helper ──────────────────────────────────────────────────────────────
function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ["https://www.trackfolio.eu", "https://trackfolio.eu"];
  const allowedOrigin = allowed.includes(origin) ? origin : "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing q parameter" });

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });

  try {
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return res.status(response.status).json({ error: `Finnhub error` });

    const data = await response.json();
    const filtered = (data.result || [])
      .filter(r => r.type === "Common Stock" || r.type === "ETP")
      .slice(0, 8);

    const results = await Promise.all(filtered.map(async r => {
      const isETF = r.type === "ETP";
      if (isETF) return { ticker: r.symbol, name: r.description, exchange: "US", type: r.type, sector: "ETF" };

      // Prova Yahoo prima, poi Finnhub come fallback
      const sector = (await fetchSectorYahoo(r.symbol)) || (await fetchSectorFinnhub(r.symbol, apiKey)) || "Altro";
      return { ticker: r.symbol, name: r.description, exchange: "US", type: r.type, sector };
    }));

    return res.status(200).json({ results });
  } catch (err) {
    console.error("Search error:", err);
    return res.status(500).json({ error: "Failed to search symbols" });
  }
}
