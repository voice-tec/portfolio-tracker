// api/analyst.js — Analyst ratings + target price + ETF holdings da Yahoo Finance

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
  };

  try {
    // Fetch analyst data + ETF holdings in parallel
    const [summaryRes, holdingsRes] = await Promise.all([
      fetch(`https://query2.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,recommendationTrend,defaultKeyStatistics`, { headers }),
      fetch(`https://query2.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=topHoldings`, { headers }),
    ]);

    const summaryData = await summaryRes.json();
    const holdingsData = await holdingsRes.json();

    const result = summaryData?.quoteSummary?.result?.[0];
    const fin = result?.financialData || {};
    const rec = result?.recommendationTrend?.trend?.[0] || {};
    const stats = result?.defaultKeyStatistics || {};
    const holdings = holdingsData?.quoteSummary?.result?.[0]?.topHoldings || {};

    // Analyst ratings
    const analyst = {
      targetMean:   fin.targetMeanPrice?.raw || null,
      targetHigh:   fin.targetHighPrice?.raw || null,
      targetLow:    fin.targetLowPrice?.raw || null,
      currentPrice: fin.currentPrice?.raw || null,
      recommendation: fin.recommendationKey || null, // "buy", "hold", "sell", "strongBuy"
      numberOfAnalysts: fin.numberOfAnalystOpinions?.raw || null,
      // Consensus breakdown
      strongBuy: rec.strongBuy || 0,
      buy:       rec.buy || 0,
      hold:      rec.hold || 0,
      sell:      rec.sell || 0,
      strongSell: rec.strongSell || 0,
      // Key stats
      forwardPE:  stats.forwardPE?.raw || null,
      beta:       stats.beta?.raw || null,
      shortRatio: stats.shortRatio?.raw || null,
    };

    // ETF sector breakdown (se disponibile)
    const sectorWeights = (holdings.sectorWeightings || []).map(sw => {
      const [sector, weight] = Object.entries(sw)[0];
      return { sector: normalizeSector(sector), weight: parseFloat((weight * 100).toFixed(1)) };
    }).filter(s => s.weight > 0).sort((a, b) => b.weight - a.weight);

    const topHoldings = (holdings.holdings || []).slice(0, 10).map(h => ({
      ticker: h.symbol,
      name: h.holdingName,
      weight: parseFloat(((h.holdingPercent?.raw || 0) * 100).toFixed(2)),
    }));

    return res.status(200).json({ analyst, sectorWeights, topHoldings });

  } catch (err) {
    console.error("Analyst API error:", err);
    return res.status(500).json({ error: "Failed to fetch analyst data" });
  }
}

function normalizeSector(raw) {
  const map = {
    "technology": "Tech",
    "financial_services": "Finanza",
    "healthcare": "Salute",
    "energy": "Energia",
    "consumer_cyclical": "Consumer",
    "consumer_defensive": "Consumer",
    "industrials": "Industriali",
    "real_estate": "Real Estate",
    "utilities": "Utility",
    "basic_materials": "Materiali",
    "communication_services": "Telecom",
    "realestate": "Real Estate",
  };
  return map[raw?.toLowerCase()] || raw;
}
