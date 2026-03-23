// api/analyst.js — Finnhub consensus + FMP target price + ETF weights hardcoded

const SECTOR_MAP = {
  "Technology": "Tech", "Financial Services": "Finanza", "Healthcare": "Salute",
  "Energy": "Energia", "Consumer Cyclical": "Consumer", "Consumer Defensive": "Consumer",
  "Industrials": "Industriali", "Real Estate": "Real Estate", "Utilities": "Utility",
  "Basic Materials": "Materiali", "Communication Services": "Telecom",
};

// Pesi settoriali hardcoded per ETF principali
// ETF US: fonte Yahoo Finance/Morningstar | ETF EU: fonte MSCI/Vanguard factsheets set-ott 2025
const ETF_SECTORS = {
  // ── ETF US ────────────────────────────────────────────────────────────────
  "QQQ":  [{ sector:"Tech", weight:58.2 },{ sector:"Telecom", weight:17.1 },{ sector:"Consumer", weight:12.3 },{ sector:"Salute", weight:6.8 },{ sector:"Industriali", weight:3.9 },{ sector:"Utility", weight:0.8 },{ sector:"Materiali", weight:0.9 }],
  "SPY":  [{ sector:"Tech", weight:31.5 },{ sector:"Finanza", weight:13.2 },{ sector:"Salute", weight:11.8 },{ sector:"Consumer", weight:10.9 },{ sector:"Industriali", weight:8.7 },{ sector:"Telecom", weight:8.9 },{ sector:"Energia", weight:3.8 },{ sector:"Real Estate", weight:2.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.4 },{ sector:"Altro", weight:3.8 }],
  "IVV":  [{ sector:"Tech", weight:31.5 },{ sector:"Finanza", weight:13.2 },{ sector:"Salute", weight:11.8 },{ sector:"Consumer", weight:10.9 },{ sector:"Industriali", weight:8.7 },{ sector:"Telecom", weight:8.9 },{ sector:"Energia", weight:3.8 },{ sector:"Real Estate", weight:2.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.4 },{ sector:"Altro", weight:3.8 }],
  "VOO":  [{ sector:"Tech", weight:31.5 },{ sector:"Finanza", weight:13.2 },{ sector:"Salute", weight:11.8 },{ sector:"Consumer", weight:10.9 },{ sector:"Industriali", weight:8.7 },{ sector:"Telecom", weight:8.9 },{ sector:"Energia", weight:3.8 },{ sector:"Real Estate", weight:2.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.4 },{ sector:"Altro", weight:3.8 }],
  "VTI":  [{ sector:"Tech", weight:29.8 },{ sector:"Finanza", weight:13.5 },{ sector:"Salute", weight:12.1 },{ sector:"Consumer", weight:11.2 },{ sector:"Industriali", weight:10.4 },{ sector:"Telecom", weight:8.2 },{ sector:"Energia", weight:4.1 },{ sector:"Real Estate", weight:3.8 },{ sector:"Materiali", weight:2.6 },{ sector:"Utility", weight:2.6 },{ sector:"Altro", weight:1.7 }],
  "VEA":  [{ sector:"Finanza", weight:20.1 },{ sector:"Industriali", weight:16.3 },{ sector:"Salute", weight:13.2 },{ sector:"Consumer", weight:12.8 },{ sector:"Tech", weight:10.9 },{ sector:"Materiali", weight:7.8 },{ sector:"Telecom", weight:5.6 },{ sector:"Energia", weight:5.1 },{ sector:"Utility", weight:4.2 },{ sector:"Real Estate", weight:3.0 },{ sector:"Altro", weight:1.0 }],
  "VWO":  [{ sector:"Finanza", weight:22.3 },{ sector:"Tech", weight:21.5 },{ sector:"Consumer", weight:13.8 },{ sector:"Energia", weight:7.2 },{ sector:"Materiali", weight:7.0 },{ sector:"Industriali", weight:6.8 },{ sector:"Telecom", weight:6.5 },{ sector:"Salute", weight:4.9 },{ sector:"Utility", weight:3.5 },{ sector:"Real Estate", weight:3.0 },{ sector:"Altro", weight:3.5 }],
  // ── ETF EU UCITS — MSCI World (SWDA/IWDA/EUNL stessa composizione) ────────
  // Fonte: MSCI World Index factsheet set 2025
  "SWDA": [{ sector:"Tech", weight:26.2 },{ sector:"Finanza", weight:16.0 },{ sector:"Consumer", weight:11.2 },{ sector:"Industriali", weight:10.6 },{ sector:"Salute", weight:10.4 },{ sector:"Telecom", weight:8.1 },{ sector:"Beni primari", weight:6.1 },{ sector:"Energia", weight:3.7 },{ sector:"Materiali", weight:3.2 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.0 }],
  "IWDA": [{ sector:"Tech", weight:26.2 },{ sector:"Finanza", weight:16.0 },{ sector:"Consumer", weight:11.2 },{ sector:"Industriali", weight:10.6 },{ sector:"Salute", weight:10.4 },{ sector:"Telecom", weight:8.1 },{ sector:"Beni primari", weight:6.1 },{ sector:"Energia", weight:3.7 },{ sector:"Materiali", weight:3.2 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.0 }],
  "EUNL": [{ sector:"Tech", weight:26.2 },{ sector:"Finanza", weight:16.0 },{ sector:"Consumer", weight:11.2 },{ sector:"Industriali", weight:10.6 },{ sector:"Salute", weight:10.4 },{ sector:"Telecom", weight:8.1 },{ sector:"Beni primari", weight:6.1 },{ sector:"Energia", weight:3.7 },{ sector:"Materiali", weight:3.2 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.0 }],
  // ── ETF EU UCITS — FTSE All-World (VWCE/VWRL stessa composizione) ─────────
  // Fonte: Yahoo Finance VWCE.AS/VWCE.DE holdings mar 2026
  "VWCE": [{ sector:"Tech", weight:27.0 },{ sector:"Finanza", weight:17.0 },{ sector:"Industriali", weight:10.8 },{ sector:"Consumer", weight:10.1 },{ sector:"Telecom", weight:9.0 },{ sector:"Salute", weight:8.8 },{ sector:"Beni primari", weight:5.1 },{ sector:"Materiali", weight:3.9 },{ sector:"Energia", weight:3.7 },{ sector:"Utility", weight:2.6 },{ sector:"Real Estate", weight:1.9 }],
  "VWRL": [{ sector:"Tech", weight:27.0 },{ sector:"Finanza", weight:17.0 },{ sector:"Industriali", weight:10.8 },{ sector:"Consumer", weight:10.1 },{ sector:"Telecom", weight:9.0 },{ sector:"Salute", weight:8.8 },{ sector:"Beni primari", weight:5.1 },{ sector:"Materiali", weight:3.9 },{ sector:"Energia", weight:3.7 },{ sector:"Utility", weight:2.6 },{ sector:"Real Estate", weight:1.9 }],
  // ── ETF EU UCITS — S&P 500 (CSPX/VUSA/SXR8/VUAA stessa composizione) ─────
  // Fonte: iShares CSPX factsheet ott 2025
  "CSPX": [{ sector:"Tech", weight:32.0 },{ sector:"Finanza", weight:14.0 },{ sector:"Salute", weight:12.0 },{ sector:"Consumer", weight:11.0 },{ sector:"Industriali", weight:9.0 },{ sector:"Telecom", weight:9.0 },{ sector:"Energia", weight:3.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.5 },{ sector:"Beni primari", weight:2.0 }],
  "VUSA": [{ sector:"Tech", weight:32.0 },{ sector:"Finanza", weight:14.0 },{ sector:"Salute", weight:12.0 },{ sector:"Consumer", weight:11.0 },{ sector:"Industriali", weight:9.0 },{ sector:"Telecom", weight:9.0 },{ sector:"Energia", weight:3.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.5 },{ sector:"Beni primari", weight:2.0 }],
  "SXR8": [{ sector:"Tech", weight:32.0 },{ sector:"Finanza", weight:14.0 },{ sector:"Salute", weight:12.0 },{ sector:"Consumer", weight:11.0 },{ sector:"Industriali", weight:9.0 },{ sector:"Telecom", weight:9.0 },{ sector:"Energia", weight:3.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.5 },{ sector:"Beni primari", weight:2.0 }],
  "VUAA": [{ sector:"Tech", weight:32.0 },{ sector:"Finanza", weight:14.0 },{ sector:"Salute", weight:12.0 },{ sector:"Consumer", weight:11.0 },{ sector:"Industriali", weight:9.0 },{ sector:"Telecom", weight:9.0 },{ sector:"Energia", weight:3.5 },{ sector:"Materiali", weight:2.5 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.5 },{ sector:"Beni primari", weight:2.0 }],
  // ── ETF EU UCITS — Emerging Markets ──────────────────────────────────────
  "IEMA": [{ sector:"Tech", weight:22.0 },{ sector:"Finanza", weight:21.0 },{ sector:"Consumer", weight:13.0 },{ sector:"Energia", weight:7.5 },{ sector:"Materiali", weight:7.0 },{ sector:"Industriali", weight:6.5 },{ sector:"Telecom", weight:6.0 },{ sector:"Salute", weight:5.0 },{ sector:"Utility", weight:4.0 },{ sector:"Real Estate", weight:3.0 },{ sector:"Altro", weight:5.0 }],
  "IUSQ": [{ sector:"Tech", weight:26.0 },{ sector:"Finanza", weight:16.5 },{ sector:"Consumer", weight:11.0 },{ sector:"Industriali", weight:10.5 },{ sector:"Salute", weight:10.0 },{ sector:"Telecom", weight:8.5 },{ sector:"Beni primari", weight:5.5 },{ sector:"Energia", weight:4.0 },{ sector:"Materiali", weight:3.5 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.0 }],
  // ── ETF EU UCITS — Europe ─────────────────────────────────────────────────
  "MEUD": [{ sector:"Finanza", weight:20.0 },{ sector:"Industriali", weight:17.0 },{ sector:"Salute", weight:15.0 },{ sector:"Consumer", weight:12.0 },{ sector:"Materiali", weight:8.0 },{ sector:"Tech", weight:8.0 },{ sector:"Telecom", weight:6.0 },{ sector:"Energia", weight:5.5 },{ sector:"Utility", weight:5.0 },{ sector:"Real Estate", weight:3.5 }],
  "XDWD": [{ sector:"Tech", weight:26.2 },{ sector:"Finanza", weight:16.0 },{ sector:"Consumer", weight:11.2 },{ sector:"Industriali", weight:10.6 },{ sector:"Salute", weight:10.4 },{ sector:"Telecom", weight:8.1 },{ sector:"Beni primari", weight:6.1 },{ sector:"Energia", weight:3.7 },{ sector:"Materiali", weight:3.2 },{ sector:"Utility", weight:2.5 },{ sector:"Real Estate", weight:2.0 }],
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

  // ── ROUTE EARNINGS: ?earnings=true ──────────────────────────────────────────
  if (req.query.earnings === "true") {
    try {
      const avKey = process.env.ALPHA_VANTAGE_KEY;
      if (!avKey) return res.status(200).json({ earnings: [], stats: {}, error: "No Alpha Vantage key" });

      const avUrl = `https://www.alphavantage.co/query?function=EARNINGS&symbol=${sym}&apikey=${avKey}`;
      const er = await fetch(avUrl, { headers: { "Accept": "application/json" } });
      if (!er.ok) return res.status(200).json({ earnings: [], stats: {}, error: `AV HTTP ${er.status}` });
      const edata = await er.json();

      // Alpha Vantage formato: { annualEarnings, quarterlyEarnings }
      // quarterlyEarnings: { fiscalDateEnding, reportedDate, reportedEPS, estimatedEPS, surprise, surprisePercentage }
      const quarterlyEarnings = edata?.quarterlyEarnings || [];
      const nextEarnings = null; // Alpha Vantage free non ha next earnings date
      const earningsHistory = quarterlyEarnings;

      const nowTs = Math.floor(Date.now() / 1000);
      const from3y = nowTs - 3 * 365 * 86400;
      let priceMap = {};
      try {
        const pr = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=${from3y}&period2=${nowTs}`,
          { headers: { "User-Agent": "Mozilla/5.0" } }
        );
        if (pr.ok) {
          const pd = await pr.json();
          const pres = pd?.chart?.result?.[0];
          if (pres) {
            const ts = pres.timestamp || [];
            const cl = pres.indicators?.quote?.[0]?.close || [];
            ts.forEach((t, i) => { if (cl[i] != null) priceMap[new Date(t * 1000).toISOString().slice(0, 10)] = cl[i]; });
          }
        }
      } catch {}

      const getNear = (dateStr, off) => {
        for (let d = 0; d <= 5; d++) {
          for (const sg of [1, -1]) {
            const dt = new Date(dateStr); dt.setDate(dt.getDate() + off + sg * d);
            const k = dt.toISOString().slice(0, 10);
            if (priceMap[k]) return priceMap[k];
          }
        }
        return null;
      };

      // FMP formato: { date, eps, epsEstimated, revenue, revenueEstimated }
      const earnings = earningsHistory
        .filter(e => e.eps != null && e.date)
        .map(e => {
          const dateStr = e.date;
          const surprise = e.eps != null && e.epsEstimated != null
            ? parseFloat(((e.eps - e.epsEstimated) / Math.abs(e.epsEstimated || 1) * 100).toFixed(2))
            : null;
          const pb = getNear(dateStr, -1), pd = getNear(dateStr, 0), p2w = getNear(dateStr, 10);
          const moveDay = pb && pd  ? parseFloat(((pd  - pb) / pb * 100).toFixed(2)) : null;
          const move2w  = pb && p2w ? parseFloat(((p2w - pb) / pb * 100).toFixed(2)) : null;
          const qd = new Date(dateStr);
          return {
            date: dateStr,
            quarter: `Q${Math.floor(qd.getMonth()/3)+1} ${qd.getFullYear()}`,
            epsActual:   actual,
            epsEstimate: estimate,
            surprise,
            beat: surprise != null ? surprise > 0 : null,
            moveDay, move2w,
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 12);

      const beats  = earnings.filter(e => e.beat === true);
      const misses = earnings.filter(e => e.beat === false);
      const avg = (arr, key) => arr.filter(e => e[key] != null).length
        ? parseFloat((arr.filter(e => e[key] != null).reduce((s, e) => s + e[key], 0) / arr.filter(e => e[key] != null).length).toFixed(2))
        : null;

      return res.status(200).json({
        symbol: sym,
        nextEarnings,
        earnings,
        stats: {
          totalReported: earnings.length,
          beatRate: earnings.length ? Math.round(beats.length / earnings.length * 100) : null,
          avgMoveOnBeat: avg(beats, "moveDay"),
          avgMoveOnMiss: avg(misses, "moveDay"),
          avgMove2w:     avg(earnings, "move2w"),
        },
      });
    } catch (err) {
      return res.status(200).json({ earnings: [], stats: {}, error: err.message });
    }
  }


  // ETF sectors: cerca ticker esatto poi senza suffisso borsa (.MI .DE .AS ecc.)
  const baseSym = sym.replace(/\.(MI|DE|AS|PA|SW|L|BR|MA)$/i, "");
  const sectorWeights = ETF_SECTORS[sym] || ETF_SECTORS[baseSym] || [];

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
