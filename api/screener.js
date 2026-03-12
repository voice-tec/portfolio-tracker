// api/screener.js — Fama-French screener con lista curata + FMP fundamentals
const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = "https://financialmodelingprep.com/api/v3";

// Lista curata di ~60 titoli value/small-mid cap — stile DFA/Dimensional
// Aggiornabile manualmente. Mix di settori, bias su value e small cap USA.
const UNIVERSE = {
  "NASDAQ,NYSE": [
    // Value large cap
    "BRK-B","JPM","BAC","C","WFC","USB","TFC","RF","FITB","HBAN",
    // Small cap value
    "AROW","BANF","BRKL","CBTX","CFFI","CHCO","CIVB","CZWI","DCOM","EBMT",
    // Industrials value
    "AAON","AIT","APOG","AWI","BCPC","BLDR","BMI","CBT","CFX","CNX",
    // Consumer value
    "BIG","CATO","DDS","GES","JWN","KSS","M","PIR","PSMT","ROST",
    // Energy value
    "AR","CIVI","CTRA","DVN","FANG","MRO","OVV","PXD","RRC","SM",
    // Healthcare value
    "ABC","CAH","MCK","MOH","CNC","CVS","HUM","UNH","CI","ELV",
  ],
  "NASDAQ": [
    "AAPL","MSFT","GOOG","META","AMZN","NVDA","INTC","CSCO","QCOM","TXN",
    "AMAT","LRCX","KLAC","MCHP","ADI","SWKS","MRVL","XLNX","MPWR","WOLF",
  ],
  "NYSE": [
    "JPM","BAC","WFC","C","GS","MS","BLK","AXP","COF","DFS",
    "XOM","CVX","COP","SLB","HAL","BKR","VLO","MPC","PSX","EOG",
  ],
  "EURONEXT": [
    "AI.PA","AIR.PA","BNP.PA","CA.PA","DG.PA","EN.PA","GLE.PA",
    "HO.PA","MC.PA","OR.PA","ORA.PA","RI.PA","SAF.PA","SAN.PA","SGO.PA",
  ],
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { exchange = "NASDAQ,NYSE", limit = 40 } = req.query;

  if (!FMP_KEY) return res.status(500).json({ error: "FMP_API_KEY non configurata", results: [] });

  try {
    // Scegli universe
    const tickers = (UNIVERSE[exchange] || UNIVERSE["NASDAQ,NYSE"])
      .slice(0, parseInt(limit));

    // Fetch quote + key-metrics in parallelo (endpoint gratuiti FMP)
    const batch = tickers.join(",");
    const [quoteRes, profileRes] = await Promise.all([
      fetch(`${FMP_BASE}/quote/${batch}?apikey=${FMP_KEY}`),
      fetch(`${FMP_BASE}/profile/${batch}?apikey=${FMP_KEY}`),
    ]);

    const quotes   = quoteRes.ok   ? await quoteRes.json()   : [];
    const profiles = profileRes.ok ? await profileRes.json() : [];

    if (!Array.isArray(quotes) || quotes.length === 0) {
      throw new Error("Nessun dato ricevuto da FMP. Verifica la chiave API.");
    }

    const profileMap = {};
    (Array.isArray(profiles) ? profiles : []).forEach(p => { profileMap[p.symbol] = p; });

    const results = quotes.map(q => {
      const p = profileMap[q.symbol] || {};

      const pe  = parseFloat(q.pe || 0);
      const pb  = parseFloat(p.priceToBookRatio || 0);
      const roe = parseFloat(p.returnOnEquity || 0) * 100;
      const roa = parseFloat(p.returnOnAssets  || 0) * 100;
      const mktCap = parseFloat(q.marketCap || 0);
      const price  = parseFloat(q.price || 0);
      const low52  = parseFloat(q.yearLow  || 0);
      const high52 = parseFloat(q.yearHigh || 0);

      // ── VALUE score ──────────────────────────────────────────────────
      const peScore = pe > 0 && pe < 100 ? Math.max(0, Math.min(100, Math.round(((30 - pe) / 30) * 100))) : null;
      const pbScore = pb > 0             ? Math.max(0, Math.min(100, Math.round(((3  - pb) / 3)  * 100))) : null;
      const valueScore = peScore != null && pbScore != null ? Math.round((peScore + pbScore) / 2)
                       : peScore ?? pbScore ?? null;

      // ── SIZE score ────────────────────────────────────────────────────
      const sizeScore = mktCap > 0
        ? Math.round(Math.max(0, Math.min(100, ((50e9 - mktCap) / 50e9) * 100)))
        : null;

      // ── PROFITABILITY score ───────────────────────────────────────────
      const roeScore = Math.max(0, Math.min(100, (roe / 25) * 100));
      const roaScore = Math.max(0, Math.min(100, (roa / 10) * 100));
      const profScore = (roe !== 0 || roa !== 0) ? Math.round((roeScore + roaScore) / 2) : null;

      // ── MOMENTUM score ────────────────────────────────────────────────
      const momentumScore = high52 > low52 && price > 0
        ? Math.round(((price - low52) / (high52 - low52)) * 100)
        : null;

      const scores = [valueScore, sizeScore, profScore, momentumScore].filter(s => s != null);
      const composite = scores.length >= 2
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

      return {
        symbol:   q.symbol,
        name:     q.name || p.companyName || q.symbol,
        sector:   p.sector || q.sector || "—",
        price,
        mktCapM:  Math.round(mktCap / 1e6),
        pe:       pe  > 0 ? parseFloat(pe.toFixed(1))  : null,
        pb:       pb  > 0 ? parseFloat(pb.toFixed(2))  : null,
        roe:      roe !== 0 ? parseFloat(roe.toFixed(1)) : null,
        roa:      roa !== 0 ? parseFloat(roa.toFixed(1)) : null,
        change1d: parseFloat(q.changesPercentage || 0).toFixed(2),
        scores: { value: valueScore, size: sizeScore, profitability: profScore, momentum: momentumScore, composite },
      };
    })
    .filter(r => r.composite > 0 && r.price > 0)
    .sort((a, b) => b.scores.composite - a.scores.composite);

    return res.status(200).json({ results, count: results.length });

  } catch (err) {
    console.error("Screener error:", err);
    return res.status(500).json({ error: err.message, results: [] });
  }
}
