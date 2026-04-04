// api/history.js
// ── CORS helper ───────────────────────────────────────────────────────────────
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

  const { symbol, days, from } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });
  const s = symbol.toUpperCase();

  const toTs = Math.floor(Date.now() / 1000);
  let fromTs;
  if (from) {
    fromTs = Math.floor(new Date(from).getTime() / 1000);
    if (isNaN(fromTs) || fromTs >= toTs) return res.status(400).json({ error: "Data non valida" });
  } else {
    fromTs = toTs - parseInt(days || "1000") * 86400;
  }

  async function tryYahoo(sym) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${fromTs}&period2=${toTs}&includeAdjustedClose=true&events=div%2Csplit`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
      if (!r.ok) return null;
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result?.timestamp) return null;
      const closes = result.indicators?.quote?.[0]?.close || [];
      const adjCloses = result.indicators?.adjclose?.[0]?.adjclose || [];
      const candles = result.timestamp
        .map((ts, i) => ({ ts, price: adjCloses[i] ?? closes[i] }))
        .filter(c => c.price != null && c.price > 0)
        .map(c => ({ date: new Date(c.ts * 1000).toISOString().slice(0, 10), price: parseFloat(c.price.toFixed(4)) }));
      return candles.length ? candles : null;
    } catch { return null; }
  }

  async function tryTwelveData(sym) {
    try {
      const tdKey = process.env.TWELVE_DATA_API_KEY;
      if (!tdKey) return null;
      const startDate = new Date(fromTs * 1000).toISOString().slice(0, 10);
      const endDate = new Date(toTs * 1000).toISOString().slice(0, 10);
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&start_date=${startDate}&end_date=${endDate}&outputsize=5000&apikey=${tdKey}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      if (d.code || !d.values?.length) return null;
      const candles = d.values.reverse()
        .map(v => ({ date: v.datetime.slice(0, 10), price: parseFloat(parseFloat(v.close).toFixed(4)) }))
        .filter(c => c.price > 0);
      return candles.length ? candles : null;
    } catch { return null; }
  }

  try {
    let candles = await tryYahoo(s);
    if (!candles) candles = await tryTwelveData(s);
    if (!candles || candles.length === 0) return res.status(404).json({ error: `Nessun dato storico per "${s}"` });
    return res.status(200).json({ symbol: s, candles, count: candles.length });
  } catch (err) {
    console.error("History error:", err);
    return res.status(500).json({ error: "Errore nel recupero dati storici" });
  }
}
