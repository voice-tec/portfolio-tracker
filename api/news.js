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
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const fmt = d => d.toISOString().split("T")[0];

  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${process.env.FINNHUB_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    // Return max 5 news, with only needed fields
    const news = (Array.isArray(data) ? data : []).slice(0, 5).map(n => ({
      id: n.id,
      headline: n.headline,
      summary: n.summary?.slice(0, 180),
      source: n.source,
      url: n.url,
      datetime: n.datetime,
    }));
    res.json(news);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
