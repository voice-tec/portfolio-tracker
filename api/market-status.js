// api/market-status.js — Vercel Serverless Function
// GET /api/market-status
// Returns whether US and IT markets are currently open via Finnhub

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=60"); // cache 1 min

  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing API key" });

  try {
    // Check US market (NYSE/NASDAQ)
    const [usRes, itRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${key}`),
      fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=milan&token=${key}`)
    ]);

    const us = await usRes.json();
    const it = await itRes.json();

    const isOpen = us.isOpen || it.isOpen;

    res.status(200).json({
      isOpen,
      us: us.isOpen || false,
      it: it.isOpen || false,
      session: us.session || null,
    });
  } catch (e) {
    // Fallback: calcola da orario se API fallisce
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return res.status(200).json({ isOpen: false, fallback: true });
    const h = now.getUTCHours() + 1; // UTC+1 approssimativo
    const t = h + now.getUTCMinutes() / 60;
    const isOpen = (t >= 9 && t < 17.5) || (t >= 15.5 && t < 22);
    res.status(200).json({ isOpen, fallback: true });
  }
}
