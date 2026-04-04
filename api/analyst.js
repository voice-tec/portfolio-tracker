// api/analyst.js
// ── CORS helper ───────────────────────────────────────────────────────────────
function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ["https://www.trackfolio.eu", "https://trackfolio.eu"];
  const allowedOrigin = allowed.includes(origin) ? origin : "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getConsensus(rec) {
  if (!rec) return null;
  const total = (rec.strongBuy||0)+(rec.buy||0)+(rec.hold||0)+(rec.sell||0)+(rec.strongSell||0);
  if (!total) return null;
  const score = ((rec.strongBuy||0)*5+(rec.buy||0)*4+(rec.hold||0)*3+(rec.sell||0)*2+(rec.strongSell||0)*1)/total;
  if (score >= 4.5) return "strongBuy";
  if (score >= 3.5) return "buy";
  if (score >= 2.5) return "hold";
  if (score >= 1.5) return "sell";
  return "strongSell";
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey     = process.env.FMP_API_KEY;
  const sym        = symbol.toUpperCase();

  try {
    const [recRes, fmpTargetRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${sym}&token=${finnhubKey}`),
      fetch(`https://financialmodelingprep.com/stable/price-target-consensus?symbol=${sym}&apikey=${fmpKey}`),
    ]);

    const recData   = recRes.ok ? await recRes.json() : [];
    const fmpTarget = fmpTargetRes.ok ? await fmpTargetRes.json() : null;
    const rec0      = Array.isArray(recData) ? (recData[0] || {}) : {};
    const tgt       = Array.isArray(fmpTarget) ? fmpTarget[0] : fmpTarget;

    const analyst = {
      targetMean:       tgt?.targetConsensus || tgt?.priceTarget || null,
      targetHigh:       tgt?.targetHigh      || null,
      targetLow:        tgt?.targetLow       || null,
      currentPrice:     tgt?.lastPrice       || null,
      recommendation:   getConsensus(rec0),
      numberOfAnalysts: (rec0.buy||0)+(rec0.hold||0)+(rec0.sell||0)+(rec0.strongBuy||0)+(rec0.strongSell||0) || null,
      strongBuy:  rec0.strongBuy  || 0,
      buy:        rec0.buy        || 0,
      hold:       rec0.hold       || 0,
      sell:       rec0.sell       || 0,
      strongSell: rec0.strongSell || 0,
      forwardPE:  null,
      beta:       null,
    };

    return res.status(200).json({ analyst, sectorWeights: [], topHoldings: [] });

  } catch (err) {
    console.error("Analyst error:", err.message);
    return res.status(200).json({
      analyst: { targetMean:null, recommendation:null, strongBuy:0, buy:0, hold:0, sell:0, strongSell:0 },
      sectorWeights: [],
      topHoldings: []
    });
  }
}
