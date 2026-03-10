// api/analyst.js — Finnhub consensus + FMP target price + ETF weights hardcoded

const SECTOR_MAP = {
  "Technology": "Tech", "Financial Services": "Finanza", "Healthcare": "Salute",
  "Energy": "Energia", "Consumer Cyclical": "Consumer", "Consumer Defensive": "Consumer",
  "Industrials": "Industriali", "Real Estate": "Real Estate", "Utilities": "Utility",
  "Basic Materials": "Materiali", "Communication Services": "Telecom",
};

// Pesi settoriali hardcoded per ETF principali (fonte: iShares/Invesco factsheets, aggiornati 2024)
const ETF_SECTORS = {
  "QQQ":  [{ sector:"Tech", weight:58.2 },{ sector:"Telecom", weight:17.1 },{ sector:"Consumer", weight:12.3 },{ sector:"Salute", weight:6.8 },{ sector:"Industriali", weight:3.9 },{ sector:"Utility", weight:0.8 },{ sector:"Materiali", weight:0.9 }],
  "SPY":  [{ sector:"Tech", weight:31.5 },{ sector:"Finanza", weight:13.2 },{ sector:"Salute", weight:11.8 },{ sector:"Consumer", weight:10.9 },{ sector:"Industriali", weight:8.7 },{ sector:"Telecom", weight:8.9 },{ sector:"Energia", weight:3.8 },{ sector:"Real Estate", weight:2.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.4 },{ sector:"Altro", weight:3.8 }],
  "IVV":  [{ sector:"Tech", weight:31.5 },{ sector:"Finanza", weight:13.2 },{ sector:"Salute", weight:11.8 },{ sector:"Consumer", weight:10.9 },{ sector:"Industriali", weight:8.7 },{ sector:"Telecom", weight:8.9 },{ sector:"Energia", weight:3.8 },{ sector:"Real Estate", weight:2.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.4 },{ sector:"Altro", weight:3.8 }],
  "VOO":  [{ sector:"Tech", weight:31.5 },{ sector:"Finanza", weight:13.2 },{ sector:"Salute", weight:11.8 },{ sector:"Consumer", weight:10.9 },{ sector:"Industriali", weight:8.7 },{ sector:"Telecom", weight:8.9 },{ sector:"Energia", weight:3.8 },{ sector:"Real Estate", weight:2.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.4 },{ sector:"Altro", weight:3.8 }],
  "VTI":  [{ sector:"Tech", weight:29.8 },{ sector:"Finanza", weight:13.5 },{ sector:"Salute", weight:12.1 },{ sector:"Consumer", weight:11.2 },{ sector:"Industriali", weight:10.4 },{ sector:"Telecom", weight:8.2 },{ sector:"Energia", weight:4.1 },{ sector:"Real Estate", weight:3.8 },{ sector:"Materiali", weight:2.6 },{ sector:"Utility", weight:2.6 },{ sector:"Altro", weight:1.7 }],
  "VEA":  [{ sector:"Finanza", weight:20.1 },{ sector:"Industriali", weight:16.3 },{ sector:"Salute", weight:13.2 },{ sector:"Consumer", weight:12.8 },{ sector:"Tech", weight:10.9 },{ sector:"Materiali", weight:7.8 },{ sector:"Telecom", weight:5.6 },{ sector:"Energia", weight:5.1 },{ sector:"Utility", weight:4.2 },{ sector:"Real Estate", weight:3.0 },{ sector:"Altro", weight:1.0 }],
  "VWO":  [{ sector:"Finanza", weight:22.3 },{ sector:"Tech", weight:21.5 },{ sector:"Consumer", weight:13.8 },{ sector:"Energia", weight:7.2 },{ sector:"Materiali", weight:7.0 },{ sector:"Industriali", weight:6.8 },{ sector:"Telecom", weight:6.5 },{ sector:"Salute", weight:4.9 },{ sector:"Utility", weight:3.5 },{ sector:"Real Estate", weight:3.0 },{ sector:"Altro", weight:3.5 }],
  "XLE":  [{ sector:"Energia", weight:100 }],
  "XLF":  [{ sector:"Finanza", weight:100 }],
  "XLK":  [{ sector:"Tech", weight:100 }],
  "XLV":  [{ sector:"Salute", weight:100 }],
  "XLI":  [{ sector:"Industriali", weight:100 }],
  "XLP":  [{ sector:"Consumer", weight:100 }],
  "XLY":  [{ sector:"Consumer", weight:100 }],
  "XLB":  [{ sector:"Materiali", weight:100 }],
  "XLU":  [{ sector:"Utility", weight:100 }],
  "XLRE": [{ sector:"Real Estate", weight:100 }],
  "XLC":  [{ sector:"Telecom", weight:100 }],
  "GLD":  [{ sector:"Materie Prime", weight:100 }],
  "SLV":  [{ sector:"Materie Prime", weight:100 }],
  "TLT":  [{ sector:"Bond Gov.", weight:100 }],
  "IEF":  [{ sector:"Bond Gov.", weight:100 }],
  "HYG":  [{ sector:"Bond Corp.", weight:100 }],
  "LQD":  [{ sector:"Bond Corp.", weight:100 }],
  "ARKK": [{ sector:"Tech", weight:60 },{ sector:"Salute", weight:25 },{ sector:"Consumer", weight:15 }],
  "ARKG": [{ sector:"Salute", weight:100 }],
  "IWM":  [{ sector:"Industriali", weight:18 },{ sector:"Finanza", weight:17 },{ sector:"Salute", weight:16 },{ sector:"Tech", weight:15 },{ sector:"Consumer", weight:13 },{ sector:"Energia", weight:7 },{ sector:"Materiali", weight:5 },{ sector:"Altro", weight:9 }],
  "EEM":  [{ sector:"Tech", weight:20 },{ sector:"Finanza", weight:20 },{ sector:"Consumer", weight:14 },{ sector:"Energia", weight:8 },{ sector:"Materiali", weight:7 },{ sector:"Industriali", weight:7 },{ sector:"Telecom", weight:6 },{ sector:"Salute", weight:5 },{ sector:"Altro", weight:13 }],
  "UUP":  [{ sector:"Valute", weight:100 }],
  "CQQQ": [{ sector:"Tech", weight:55 },{ sector:"Consumer", weight:25 },{ sector:"Telecom", weight:15 },{ sector:"Altro", weight:5 }],
};

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
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey     = process.env.FMP_API_KEY;
  const sym        = symbol.toUpperCase();

  // ETF sectors: usa hardcoded se disponibile
  const sectorWeights = ETF_SECTORS[sym] || [];

  try {
    const [recRes, fmpTargetRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${sym}&token=${finnhubKey}`),
      fetch(`https://financialmodelingprep.com/stable/price-target-consensus?symbol=${sym}&apikey=${fmpKey}`),
    ]);

    const recData   = await recRes.json();
    const fmpTarget = await fmpTargetRes.json();
    const rec0      = recData?.[0] || {};
    const tgt       = Array.isArray(fmpTarget) ? fmpTarget[0] : fmpTarget;

    console.log(`[analyst] ${sym} target:${tgt?.targetConsensus} rec:${rec0.buy}/${rec0.hold}/${rec0.sell} etfSectors:${sectorWeights.length}`);

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

    return res.status(200).json({ analyst, sectorWeights, topHoldings: [] });

  } catch (err) {
    console.error(`[analyst] ${sym} error:`, err.message);
    // Anche in caso di errore API, ritorna i sector weights hardcoded
    return res.status(200).json({ analyst: { targetMean:null, recommendation:null, strongBuy:0, buy:0, hold:0, sell:0, strongSell:0 }, sectorWeights, topHoldings: [] });
  }
}
