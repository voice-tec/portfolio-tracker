// api/analyst.js — Analyst ratings da Finnhub + ETF holdings da FMP stable

const SECTOR_MAP = {
  "Technology": "Tech", "Financial Services": "Finanza", "Healthcare": "Salute",
  "Energy": "Energia", "Consumer Cyclical": "Consumer", "Consumer Defensive": "Consumer",
  "Industrials": "Industriali", "Real Estate": "Real Estate", "Utilities": "Utility",
  "Basic Materials": "Materiali", "Communication Services": "Telecom",
};

function normalizeSector(s) {
  return SECTOR_MAP[s] || s || "Altro";
}

function getConsensus(rec) {
  if (!rec) return null;
  const total = rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell;
  if (!total) return null;
  const score = (rec.strongBuy * 5 + rec.buy * 4 + rec.hold * 3 + rec.sell * 2 + rec.strongSell * 1) / total;
  if (score >= 4.5) return "strongBuy";
  if (score >= 3.5) return "buy";
  if (score >= 2.5) return "hold";
  if (score >= 1.5) return "sell";
  return "strongSell";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey     = process.env.FMP_API_KEY;

  try {
    // Finnhub: price target + recommendation (funziona da server)
    const [targetRes, recRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${symbol}&token=${finnhubKey}`),
      fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${finnhubKey}`),
    ]);
    const targetData = await targetRes.json();
    const recData    = await recRes.json();
    const rec0       = recData[0] || {};

    console.log(`[analyst] ${symbol} target:`, targetData.targetMean, "rec:", rec0.buy, rec0.hold, rec0.sell);

    const analyst = {
      targetMean:       targetData.targetMean  || null,
      targetHigh:       targetData.targetHigh  || null,
      targetLow:        targetData.targetLow   || null,
      currentPrice:     null,
      recommendation:   getConsensus(rec0),
      numberOfAnalysts: (rec0.buy||0) + (rec0.hold||0) + (rec0.sell||0) + (rec0.strongBuy||0) + (rec0.strongSell||0) || null,
      strongBuy:  rec0.strongBuy  || 0,
      buy:        rec0.buy        || 0,
      hold:       rec0.hold       || 0,
      sell:       rec0.sell       || 0,
      strongSell: rec0.strongSell || 0,
      forwardPE:  null,
      beta:       null,
    };

    // FMP: ETF sector weights — endpoint stable
    let sectorWeights = [];
    if (fmpKey) {
      try {
        const etfRes  = await fetch(`https://financialmodelingprep.com/stable/etf-sector-weightings?symbol=${symbol}&apikey=${fmpKey}`);
        const etfData = await etfRes.json();
        console.log(`[analyst] ${symbol} ETF sectors raw:`, JSON.stringify(etfData).slice(0,150));
        if (Array.isArray(etfData) && etfData.length > 0) {
          sectorWeights = etfData.map(s => ({
            sector: normalizeSector(s.sector),
            weight: parseFloat((parseFloat(s.weightPercentage || s.weight || 0)).toFixed(1)),
          })).filter(s => s.weight > 0.1).sort((a, b) => b.weight - a.weight);
        }
      } catch(e) {
        console.warn(`[analyst] ETF fetch failed:`, e.message);
      }
    }

    return res.status(200).json({ analyst, sectorWeights, topHoldings: [] });

  } catch (err) {
    console.error(`[analyst] ${symbol} error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}
