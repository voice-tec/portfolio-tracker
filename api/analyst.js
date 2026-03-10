// api/analyst.js — Finnhub consensus + FMP target price + ETF holdings

const SECTOR_MAP = {
  "Technology": "Tech", "Financial Services": "Finanza", "Healthcare": "Salute",
  "Energy": "Energia", "Consumer Cyclical": "Consumer", "Consumer Defensive": "Consumer",
  "Industrials": "Industriali", "Real Estate": "Real Estate", "Utilities": "Utility",
  "Basic Materials": "Materiali", "Communication Services": "Telecom",
};

function normalizeSector(s) { return SECTOR_MAP[s] || s || "Altro"; }

function getConsensus(rec) {
  if (!rec) return null;
  const total = (rec.strongBuy||0) + (rec.buy||0) + (rec.hold||0) + (rec.sell||0) + (rec.strongSell||0);
  if (!total) return null;
  const score = ((rec.strongBuy||0)*5 + (rec.buy||0)*4 + (rec.hold||0)*3 + (rec.sell||0)*2 + (rec.strongSell||0)*1) / total;
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
    // Fetch tutto in parallelo
    const [recRes, fmpTargetRes, fmpEtfRes] = await Promise.all([
      // Finnhub: recommendation trend (funziona gratis)
      fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${finnhubKey}`),
      // FMP: price target (funziona gratis)
      fetch(`https://financialmodelingprep.com/stable/price-target-consensus?symbol=${symbol}&apikey=${fmpKey}`),
      // FMP: ETF sector weights
      fetch(`https://financialmodelingprep.com/stable/etf-sector-weightings?symbol=${symbol}&apikey=${fmpKey}`),
    ]);

    const recData    = await recRes.json();
    const fmpTarget  = await fmpTargetRes.json();
    const etfData    = await fmpEtfRes.json();

    console.log(`[analyst] ${symbol} fmpTarget:`, JSON.stringify(fmpTarget).slice(0,150));
    console.log(`[analyst] ${symbol} rec:`, JSON.stringify(recData?.[0]));

    const rec0 = recData?.[0] || {};
    const tgt  = Array.isArray(fmpTarget) ? fmpTarget[0] : fmpTarget;

    const analyst = {
      targetMean:       tgt?.targetConsensus  || tgt?.priceTarget || null,
      targetHigh:       tgt?.targetHigh       || null,
      targetLow:        tgt?.targetLow        || null,
      currentPrice:     tgt?.lastPrice        || null,
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

    // ETF sector weights
    const sectorWeights = Array.isArray(etfData) && etfData.length > 0
      ? etfData.map(s => ({
          sector: normalizeSector(s.sector),
          weight: parseFloat((parseFloat(s.weightPercentage || s.weight || 0)).toFixed(1)),
        })).filter(s => s.weight > 0.1).sort((a, b) => b.weight - a.weight)
      : [];

    console.log(`[analyst] ${symbol} result: targetMean=${analyst.targetMean} sectors=${sectorWeights.length}`);

    return res.status(200).json({ analyst, sectorWeights, topHoldings: [] });

  } catch (err) {
    console.error(`[analyst] ${symbol} error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}
