// api/dividends.js — Vercel Serverless Function
// GET /api/dividends?symbol=AAPL
// Restituisce storico dividendi, yield, prossima data da Yahoo Finance

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=3600"); // cache 1h

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  try {
    const s = symbol.toUpperCase();
    const now = Math.floor(Date.now() / 1000);
    const from = now - 5 * 365 * 86400; // ultimi 5 anni

    // Yahoo Finance v8 — storico dividendi
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&period1=${from}&period2=${now}&events=dividends`;
    const res2 = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!res2.ok) return res.status(404).json({ error: "No data" });

    const data = await res2.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No result" });

    const meta = result.meta || {};
    const divEvents = result.events?.dividends || {};

    // Storico dividendi — ordina per data
    const history = Object.values(divEvents)
      .map(d => ({
        date: new Date(d.date * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }),
        dateTs: d.date,
        amount: parseFloat(d.amount.toFixed(4)),
      }))
      .sort((a, b) => a.dateTs - b.dateTs);

    // Calcola frequenza e yield annuale
    let frequency = null;
    let annualDividend = 0;
    if (history.length >= 2) {
      const recent = history.slice(-8);
      const gaps = [];
      for (let i = 1; i < recent.length; i++) {
        gaps.push((recent[i].dateTs - recent[i-1].dateTs) / 86400);
      }
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (avgGap < 40)       { frequency = "Mensile";     annualDividend = history.slice(-1)[0].amount * 12; }
      else if (avgGap < 100) { frequency = "Trimestrale"; annualDividend = history.slice(-1)[0].amount * 4; }
      else if (avgGap < 200) { frequency = "Semestrale";  annualDividend = history.slice(-1)[0].amount * 2; }
      else                   { frequency = "Annuale";     annualDividend = history.slice(-1)[0].amount; }
    }

    const currentPrice = meta.regularMarketPrice || meta.previousClose || 0;
    const yieldPct = currentPrice > 0 ? (annualDividend / currentPrice) * 100 : 0;

    // Prossima data stimata
    let nextDate = null;
    if (history.length > 0) {
      const lastTs = history[history.length - 1].dateTs;
      const freqDays = frequency === "Mensile" ? 30 : frequency === "Trimestrale" ? 91 : frequency === "Semestrale" ? 182 : 365;
      const nextTs = lastTs + freqDays * 86400;
      if (nextTs > now) {
        nextDate = new Date(nextTs * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
      }
    }

    return res.status(200).json({
      symbol: s,
      currentPrice,
      annualDividend: parseFloat(annualDividend.toFixed(4)),
      yieldPct: parseFloat(yieldPct.toFixed(2)),
      frequency,
      nextDate,
      lastAmount: history.length > 0 ? history[history.length - 1].amount : null,
      history, // ultimi 5 anni
    });

  } catch (err) {
    console.error("Dividends error:", err);
    return res.status(500).json({ error: "Failed to fetch dividend data" });
  }
}
