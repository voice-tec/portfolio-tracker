// api/screener.js — Fama-French screener via Finnhub (gratuito)
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const FH = "https://finnhub.io/api/v1";

// Universe curato — value/small-mid cap USA stile DFA
const UNIVERSE = [
  // Financials value
  "JPM","BAC","C","WFC","USB","TFC","RF","FITB","HBAN","CFG",
  // Energy value  
  "XOM","CVX","COP","DVN","MRO","OVV","AR","RRC","SM","CIVI",
  // Industrials value
  "GFF","AIT","BMI","CBT","APOG","AWI","BLDR","BCO","CNX","AAON",
  // Consumer value
  "DDS","KSS","M","ROST","TJX","GPC","AN","KMX","BBY","PRGO",
  // Healthcare value
  "CVS","CI","HUM","MCK","CAH","ABC","MOH","CNC","ELV","UNH",
];

async function finnhubGet(path) {
  const res = await fetch(`${FH}${path}&token=${FINNHUB_KEY}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!FINNHUB_KEY) return res.status(500).json({ error: "FINNHUB_API_KEY non configurata", results: [] });

  try {
    // Finnhub free: ~30 req/sec — prendiamo 20 titoli
    const tickers = UNIVERSE.slice(0, 20);

    // Fetch quote + basic financials in parallelo a coppie
    const results = [];
    const BATCH = 5;

    for (let i = 0; i < tickers.length; i += BATCH) {
      const batch = tickers.slice(i, i + BATCH);
      const fetches = batch.flatMap(sym => [
        finnhubGet(`/quote?symbol=${sym}`).catch(() => null),
        finnhubGet(`/stock/metric?symbol=${sym}&metric=all`).catch(() => null),
      ]);
      const data = await Promise.all(fetches);

      for (let j = 0; j < batch.length; j++) {
        const sym   = batch[j];
        const quote = data[j * 2];
        const fund  = data[j * 2 + 1];

        if (!quote || !quote.c || quote.c === 0) continue;

        const price   = quote.c;
        const high52  = quote["52WeekHigh"] || fund?.metric?.["52WeekHigh"] || 0;
        const low52   = quote["52WeekLow"]  || fund?.metric?.["52WeekLow"]  || 0;
        const m       = fund?.metric || {};

        const pe   = parseFloat(m.peNormalizedAnnual || m.peTTM || 0);
        const pb   = parseFloat(m.pbAnnual || m.pbQuarterly || 0);
        const roe  = parseFloat(m.roeTTM || m.roeAnnual || 0);
        const roa  = parseFloat(m.roaTTM || m.roaAnnual || 0);
        const mktCap = parseFloat(m.marketCapitalization || 0) * 1e6; // Finnhub in milioni

        // ── Scores ──────────────────────────────────────────────────────
        const peScore = pe > 0 && pe < 80
          ? Math.max(0, Math.min(100, Math.round(((40 - pe) / 40) * 100))) : null;
        const pbScore = pb > 0
          ? Math.max(0, Math.min(100, Math.round(((3 - pb) / 3) * 100))) : null;
        const valueScore = peScore != null && pbScore != null
          ? Math.round((peScore + pbScore) / 2) : (peScore ?? pbScore ?? null);

        const sizeScore = mktCap > 0
          ? Math.round(Math.max(0, Math.min(100, ((100e9 - mktCap) / 100e9) * 100))) : null;

        const roeScore = roe !== 0 ? Math.max(0, Math.min(100, Math.round((roe / 25) * 100))) : null;
        const roaScore = roa !== 0 ? Math.max(0, Math.min(100, Math.round((roa / 10) * 100))) : null;
        const profScore = roeScore != null || roaScore != null
          ? Math.round(((roeScore ?? 0) + (roaScore ?? 0)) / ((roeScore != null ? 1 : 0) + (roaScore != null ? 1 : 0))) : null;

        const momentumScore = high52 > low52 && price > 0
          ? Math.round(((price - low52) / (high52 - low52)) * 100) : null;

        const scores = [valueScore, sizeScore, profScore, momentumScore].filter(s => s != null);
        if (scores.length < 2) continue;

        const composite = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

        results.push({
          symbol: sym,
          name:   sym,
          sector: "—",
          price,
          mktCapM: Math.round(mktCap / 1e6),
          pe: pe > 0 ? parseFloat(pe.toFixed(1)) : null,
          pb: pb > 0 ? parseFloat(pb.toFixed(2)) : null,
          roe: roe !== 0 ? parseFloat(roe.toFixed(1)) : null,
          roa: roa !== 0 ? parseFloat(roa.toFixed(1)) : null,
          change1d: (((quote.c - quote.pc) / quote.pc) * 100).toFixed(2),
          scores: { value: valueScore, size: sizeScore, profitability: profScore, momentum: momentumScore, composite },
        });
      }

      // Pausa tra batch per non superare rate limit
      if (i + BATCH < tickers.length) await new Promise(r => setTimeout(r, 300));
    }

    results.sort((a, b) => b.scores.composite - a.scores.composite);
    return res.status(200).json({ results, count: results.length });

  } catch (err) {
    console.error("Screener error:", err.message);
    return res.status(500).json({ error: err.message, results: [] });
  }
}
