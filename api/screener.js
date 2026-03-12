// api/screener.js — Fama-French factor screener via Financial Modeling Prep
const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const enc = encodeURIComponent;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { exchange = "NASDAQ", limit = 50 } = req.query;

  if (!FMP_KEY) return res.status(500).json({ error: "FMP_API_KEY non configurata su Vercel", results: [] });

  try {
    // 1. Stock screener — filtri base Fama-French
    // FMP vuole un solo exchange per chiamata
    const exc = exchange.split(",")[0].trim(); // prendi il primo se multipli
    const url = `${FMP_BASE}/stock-screener?marketCapMoreThan=100000000&marketCapLowerThan=10000000000&betaLowerThan=2&volumeMoreThan=100000&exchange=${enc(exc)}&limit=${Math.min(limit, 100)}&apikey=${FMP_KEY}`;
    const screenRes = await fetch(url);
    const screenText = await screenRes.text();
    let candidates;
    try { candidates = JSON.parse(screenText); } catch(e) { throw new Error(`FMP parse error: ${screenText.slice(0,200)}`); }
    if (!screenRes.ok) throw new Error(`FMP screener ${screenRes.status}: ${screenText.slice(0,200)}`);
    if (!Array.isArray(candidates)) throw new Error(`Risposta inattesa FMP: ${screenText.slice(0,200)}`);

    if (candidates.length === 0) return res.status(200).json({ results: [], error: "Nessun risultato per questo mercato" });

    // 2. Per ogni candidato, fetch key metrics (P/B, P/E, ROE, ROA)
    const tickers = candidates.slice(0, 30).map(c => c.symbol).join(",");
    const [metricsRes, pricesRes] = await Promise.all([
      fetch(`${FMP_BASE}/key-metrics/${tickers}?period=annual&limit=1&apikey=${FMP_KEY}`),
      fetch(`${FMP_BASE}/quote/${tickers}?apikey=${FMP_KEY}`),
    ]);

    const metricsRaw = metricsRes.ok ? await metricsRes.json() : [];
    const quotesRaw  = pricesRes.ok  ? await pricesRes.json() : [];

    // Index per ticker
    const metricsMap = {};
    (Array.isArray(metricsRaw) ? metricsRaw : []).forEach(m => {
      if (!metricsMap[m.symbol]) metricsMap[m.symbol] = m;
    });
    const quotesMap = {};
    (Array.isArray(quotesRaw) ? quotesRaw : []).forEach(q => {
      quotesMap[q.symbol] = q;
    });

    // 3. Calcola score Fama-French per ogni titolo
    const results = candidates.slice(0, 30).map(c => {
      const m = metricsMap[c.symbol] || {};
      const q = quotesMap[c.symbol]  || {};

      // ── VALUE score (basso P/E e P/B = meglio) ─────────────────────────
      const pe  = parseFloat(m.peRatioTTM || q.pe || 0);
      const pb  = parseFloat(m.pbRatioTTM || 0);
      // Score 0-100: P/E < 15 = ottimo, > 30 = scarso
      const peScore = pe > 0 ? Math.max(0, Math.min(100, ((30 - pe) / 30) * 100)) : null;
      const pbScore = pb > 0 ? Math.max(0, Math.min(100, ((3  - pb) / 3)  * 100)) : null;
      const valueScore = (peScore != null && pbScore != null)
        ? Math.round((peScore + pbScore) / 2)
        : (peScore ?? pbScore ?? null);

      // ── SIZE score (small cap < 2B = meglio) ───────────────────────────
      const mktCap = parseFloat(c.marketCap || 0);
      const sizeScore = mktCap > 0
        ? Math.round(Math.max(0, Math.min(100, ((10e9 - mktCap) / 10e9) * 100)))
        : null;

      // ── PROFITABILITY score (ROE + ROA) ────────────────────────────────
      const roe = parseFloat(m.roeTTM || 0) * 100; // converti in %
      const roa = parseFloat(m.roaTTM || 0) * 100;
      const roeScore = Math.max(0, Math.min(100, (roe / 25) * 100));
      const roaScore = Math.max(0, Math.min(100, (roa / 10) * 100));
      const profScore = roe !== 0 || roa !== 0
        ? Math.round((roeScore + roaScore) / 2)
        : null;

      // ── MOMENTUM score (price vs 52w range) ────────────────────────────
      const price  = parseFloat(q.price || 0);
      const low52  = parseFloat(q.yearLow  || 0);
      const high52 = parseFloat(q.yearHigh || 0);
      const momentumScore = (high52 > low52 && price > 0)
        ? Math.round(((price - low52) / (high52 - low52)) * 100)
        : null;

      // ── Score composito ────────────────────────────────────────────────
      const scores = [valueScore, sizeScore, profScore, momentumScore].filter(s => s != null);
      const composite = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

      return {
        symbol:    c.symbol,
        name:      c.companyName || c.name || c.symbol,
        sector:    c.sector || "—",
        price:     price || parseFloat(c.price || 0),
        mktCapM:   Math.round(mktCap / 1e6),   // in milioni
        pe:        pe  > 0 ? parseFloat(pe.toFixed(1))  : null,
        pb:        pb  > 0 ? parseFloat(pb.toFixed(2))  : null,
        roe:       roe !== 0 ? parseFloat(roe.toFixed(1)) : null,
        roa:       roa !== 0 ? parseFloat(roa.toFixed(1)) : null,
        change1d:  parseFloat(q.changesPercentage || 0).toFixed(2),
        scores: {
          value:       valueScore,
          size:        sizeScore,
          profitability: profScore,
          momentum:    momentumScore,
          composite,
        },
      };
    })
    .filter(r => r.scores.composite > 20)           // filtra titoli senza dati sufficienti
    .sort((a, b) => b.scores.composite - a.scores.composite);

    return res.status(200).json({ results, count: results.length });

  } catch (err) {
    console.error("Screener error:", err);
    return res.status(500).json({ error: err.message, results: [] });
  }
}
