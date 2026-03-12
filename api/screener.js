// api/screener.js — Fama-French screener, FMP free tier compatible
const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/api/v3";

const UNIVERSE = [
  "JPM","BAC","C","WFC","USB","BRK-B","GS","MS","AXP","COF",
  "XOM","CVX","COP","SLB","HAL","VLO","MPC","EOG","DVN","MRO",
  "AAON","AIT","BMI","CBT","CNX","BLDR","AWI","APOG","BCO","GFF",
  "BIG","DDS","KSS","M","ROST","TJX","GPC","LKQ","AN","KMX",
  "ABC","CAH","MCK","CVS","CI","HUM","MOH","UNH","ELV","CNC",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!FMP_KEY) return res.status(500).json({ error: "FMP_API_KEY non configurata", results: [] });

  try {
    // Test con un singolo ticker prima per verificare la chiave
    const testRes = await fetch(`${FMP_BASE}/quote/AAPL?apikey=${FMP_KEY}`);
    const testData = await testRes.json();

    if (!testRes.ok || !Array.isArray(testData) || testData.length === 0) {
      const msg = testData?.["Error Message"] || testData?.message || JSON.stringify(testData).slice(0,200);
      throw new Error(`FMP API error: ${msg}`);
    }

    // Fetch a batch di 10 ticker alla volta (limite free tier)
    const { exchange = "NYSE" } = req.query;
    const tickers = UNIVERSE.slice(0, 30);
    const BATCH = 10;
    const batches = [];
    for (let i = 0; i < tickers.length; i += BATCH) {
      batches.push(tickers.slice(i, i + BATCH));
    }

    const allQuotes = [];
    for (const batch of batches) {
      const r = await fetch(`${FMP_BASE}/quote/${batch.join(",")}?apikey=${FMP_KEY}`);
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) allQuotes.push(...data);
      }
    }

    if (allQuotes.length === 0) throw new Error("Nessun dato ricevuto. Piano FMP potrebbe non supportare questo endpoint.");

    // Calcola score Fama-French dai dati disponibili in /quote
    const results = allQuotes
      .filter(q => q.price > 0)
      .map(q => {
        const pe       = parseFloat(q.pe || 0);
        const price    = parseFloat(q.price || 0);
        const low52    = parseFloat(q.yearLow  || 0);
        const high52   = parseFloat(q.yearHigh || 0);
        const mktCap   = parseFloat(q.marketCap || 0);
        const eps      = parseFloat(q.eps || 0);
        const change1y = high52 > 0 ? ((price - low52) / low52) * 100 : 0;

        // VALUE: P/E basso
        const peScore = pe > 0 && pe < 80
          ? Math.max(0, Math.min(100, Math.round(((40 - pe) / 40) * 100)))
          : null;

        // SIZE: cap piccola = score alto
        const sizeScore = mktCap > 0
          ? Math.round(Math.max(0, Math.min(100, ((100e9 - mktCap) / 100e9) * 100)))
          : null;

        // MOMENTUM: posizione nel range 52w
        const momentumScore = high52 > low52 && price > 0
          ? Math.round(((price - low52) / (high52 - low52)) * 100)
          : null;

        // PROFITABILITY: EPS positivo e crescita come proxy
        const profScore = eps > 0
          ? Math.min(100, Math.round((eps / price) * 1000)) // earnings yield proxy
          : null;

        const scores = [peScore, sizeScore, momentumScore, profScore].filter(s => s != null);
        const composite = scores.length >= 2
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;

        return {
          symbol:   q.symbol,
          name:     q.name || q.symbol,
          sector:   "—",
          price,
          mktCapM:  Math.round(mktCap / 1e6),
          pe:       pe > 0 ? parseFloat(pe.toFixed(1)) : null,
          pb:       null,
          roe:      null,
          roa:      null,
          change1d: parseFloat(q.changesPercentage || 0).toFixed(2),
          scores: {
            value:         peScore,
            size:          sizeScore,
            profitability: profScore,
            momentum:      momentumScore,
            composite,
          },
        };
      })
      .filter(r => r.scores.composite > 10)
      .sort((a, b) => b.scores.composite - a.scores.composite);

    return res.status(200).json({ results, count: results.length });

  } catch (err) {
    console.error("Screener error:", err.message);
    return res.status(500).json({ error: err.message, results: [] });
  }
}
