// api/analyst.js — Analyst ratings + ETF holdings da Yahoo Finance

const SECTOR_MAP = {
  "technology": "Tech", "financialservices": "Finanza", "financial_services": "Finanza",
  "healthcare": "Salute", "energy": "Energia", "consumercyclical": "Consumer",
  "consumer_cyclical": "Consumer", "consumerdefensive": "Consumer", "consumer_defensive": "Consumer",
  "industrials": "Industriali", "realestate": "Real Estate", "real_estate": "Real Estate",
  "utilities": "Utility", "basicmaterials": "Materiali", "basic_materials": "Materiali",
  "communicationservices": "Telecom", "communication_services": "Telecom",
};

function normalizeSector(raw) {
  if (!raw) return "Altro";
  return SECTOR_MAP[raw.toLowerCase().replace(/[^a-z]/g, "")] || raw;
}

async function yahooFetch(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://finance.yahoo.com/",
    }
  });
  if (!r.ok) throw new Error(`Yahoo ${r.status} for ${url}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  try {
    // v10 è l'endpoint attuale corretto
    const base = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`;

    const [summaryData, holdingsData] = await Promise.all([
      yahooFetch(`${base}?modules=financialData%2CrecommendationTrend%2CdefaultKeyStatistics`),
      yahooFetch(`${base}?modules=topHoldings`),
    ]);

    const result = summaryData?.quoteSummary?.result?.[0];
    const fin    = result?.financialData || {};
    const rec    = result?.recommendationTrend?.trend?.[0] || {};
    const stats  = result?.defaultKeyStatistics || {};
    const holdings = holdingsData?.quoteSummary?.result?.[0]?.topHoldings || {};

    console.log(`[analyst] ${symbol} sectorWeightings:`, JSON.stringify(holdings.sectorWeightings?.slice(0,2)));

    const analyst = {
      targetMean:        fin.targetMeanPrice?.raw        || null,
      targetHigh:        fin.targetHighPrice?.raw        || null,
      targetLow:         fin.targetLowPrice?.raw         || null,
      currentPrice:      fin.currentPrice?.raw           || null,
      recommendation:    fin.recommendationKey           || null,
      numberOfAnalysts:  fin.numberOfAnalystOpinions?.raw|| null,
      strongBuy:  rec.strongBuy  || 0,
      buy:        rec.buy        || 0,
      hold:       rec.hold       || 0,
      sell:       rec.sell       || 0,
      strongSell: rec.strongSell || 0,
      forwardPE:  stats.forwardPE?.raw  || null,
      beta:       stats.beta?.raw       || null,
      shortRatio: stats.shortRatio?.raw || null,
    };

    // ETF sector weights
    const sectorWeights = (holdings.sectorWeightings || []).flatMap(sw =>
      Object.entries(sw).map(([sector, weight]) => ({
        sector: normalizeSector(sector),
        weight: parseFloat(((weight?.raw ?? weight) * 100).toFixed(1)),
      }))
    ).filter(s => s.weight > 0.1).sort((a, b) => b.weight - a.weight);

    const topHoldings = (holdings.holdings || []).slice(0, 10).map(h => ({
      ticker: h.symbol,
      name:   h.holdingName,
      weight: parseFloat(((h.holdingPercent?.raw || 0) * 100).toFixed(2)),
    }));

    return res.status(200).json({ analyst, sectorWeights, topHoldings });

  } catch (err) {
    console.error(`[analyst] ${symbol} error:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}
