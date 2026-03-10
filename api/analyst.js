// api/analyst.js — Analyst ratings + target price da Finnhub
// ETF holdings da FMP (Financial Modeling Prep) con chiave gratuita

const SECTOR_MAP = {
  "Technology": "Tech", "Financial Services": "Finanza", "Healthcare": "Salute",
  "Energy": "Energia", "Consumer Cyclical": "Consumer", "Consumer Defensive": "Consumer",
  "Industrials": "Industriali", "Real Estate": "Real Estate", "Utilities": "Utility",
  "Basic Materials": "Materiali", "Communication Services": "Telecom",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey = process.env.FMP_API_KEY || "demo";

  try {
    // Finnhub: price target + recommendation trends (funziona da server)
    const [targetRes, recRes, etfRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${symbol}&token=${finnhubKey}`),
      fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${finnhubKey}`),
      // FMP: ETF sector holdings (piano gratuito)
      fetch(`https://financialmodelingprep.com/api/v3/etf-sector-weightings/${symbol}?apikey=${fmpKey}`),
    ]);

    const targetData = await targetRes.json();
    const recData    = await recRes.json();
    const etfData    = await etfRes.json();

    console.log(`[analyst] ${symbol} target:`, JSON.stringify(targetData).slice(0,100));
    console.log(`[analyst] ${symbol} etf sectors:`, JSON.stringify(etfData).slice(0,100));

    // Analyst target price
    const analyst = {
      targetMean:       targetData.targetMean   || null,
      targetHigh:       targetData.targetHigh   || null,
      targetLow:        targetData.targetLow    || null,
      currentPrice:     targetData.lastUpdated  ? null : null,
      recommendation:   recData[0] ? getConsensus(recData[0]) : null,
      numberOfAnalysts: targetData.targetMean   ? (recData[0]?.buy + recData[0]?.hold + recData[0]?.sell || null) : null,
      strongBuy:  recData[0]?.strongBuy  || 0,
      buy:        recData[0]?.buy        || 0,
      hold:       recData[0]?.hold       || 0,
      sell:       recData[0]?.sell       || 0,
      strongSell: recData[0]?.strongSell || 0,
      forwardPE:  null,
      beta:       null,
    };

    // ETF sector weights da FMP
    const sectorWeights = Array.isArray(etfData)
      ? etfData.map(s => ({
          sector: SECTOR_MAP[s.sector] || s.sector || "Altro",
          weight: parseFloat((parseFloat(s.weightPercentage) || 0).toFixed(1)),
        })).filter(s => s.weight > 0.1).sort((a, b) => b.weight - a.weight)
      : [];

    return res.status(200).json({ analyst, sectorWeights, topHoldings: [] });

  } catch (err) {
    console.error(`[analyst] ${symbol} error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
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
