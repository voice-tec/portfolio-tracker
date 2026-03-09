// api/history.js — SEMPRE Yahoo Finance, niente Finnhub
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, days, from } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const toTs = Math.floor(Date.now() / 1000);
  let fromTs;

  if (from) {
    fromTs = Math.floor(new Date(from).getTime() / 1000);
    if (isNaN(fromTs)) return res.status(400).json({ error: "Data non valida" });
    if (fromTs >= toTs) return res.status(400).json({ error: "La data deve essere nel passato" });
  } else {
    fromTs = toTs - parseInt(days || "30") * 86400;
  }

  try {
    const s = symbol.toUpperCase();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&period1=${fromTs}&period2=${toTs}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!r.ok) return res.status(404).json({ error: `Ticker "${s}" non trovato` });

    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp) return res.status(404).json({ error: "Nessun dato storico disponibile" });

    const closes = result.indicators?.quote?.[0]?.close || [];
    const candles = result.timestamp
      .map((ts, i) => ({ ts, price: closes[i] }))
      .filter(c => c.price != null && c.price > 0)
      .map(c => ({
        date: new Date(c.ts * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }),
        price: parseFloat(c.price.toFixed(4)),
      }));

    if (!candles.length) return res.status(404).json({ error: "Nessun dato per questa data e questo titolo" });

    return res.status(200).json({ symbol: s, candles, count: candles.length });
  } catch (err) {
    console.error("History error:", err);
    return res.status(500).json({ error: "Errore nel recupero dati storici" });
  }
}
