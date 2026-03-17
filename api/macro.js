// api/macro.js — Indicatori macro live da Yahoo Finance
// GET /api/macro
// Ritorna: Fed Rate proxy, Treasury 10Y, VIX, Yield Spread, S&P500

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=1800"); // cache 30 min

  if (req.method === "OPTIONS") return res.status(200).end();

  const tickers = {
    vix:       "^VIX",        // Volatilità / paura
    t10y:      "^TNX",        // Treasury 10 anni
    t2y:       "^TYX",        // Treasury 30 anni (proxy spread)
    t3m:       "^IRX",        // Treasury 3 mesi (proxy Fed rate)
    sp500:     "^GSPC",       // S&P 500
    dxy:       "DX-Y.NYB",    // Dollaro USA
    gold:      "GC=F",        // Oro
    oil:       "CL=F",        // Petrolio
  };

  async function fetchYahoo(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
      if (!r.ok) return null;
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const closes = result.indicators?.quote?.[0]?.close || [];
      const last = closes.filter(Boolean).pop();
      const prev = closes.filter(Boolean).slice(-2)[0];
      const changePct = last && prev ? ((last - prev) / prev * 100) : null;
      return { price: last, changePct: changePct ? parseFloat(changePct.toFixed(2)) : null };
    } catch { return null; }
  }

  try {
    const [vix, t10y, t2y, t3m, sp500, dxy, gold, oil] = await Promise.all(
      Object.values(tickers).map(fetchYahoo)
    );

    // Yield spread = 10Y - 3M (curva invertita se negativo)
    const yieldSpread = (t10y?.price && t3m?.price)
      ? parseFloat((t10y.price - t3m.price).toFixed(2))
      : null;

    // Fed Rate proxy = Treasury 3 mesi
    const fedRateProxy = t3m?.price ? parseFloat(t3m.price.toFixed(2)) : null;

    // Inflazione implicita: 10Y Treasury - media storica reale (approssimazione)
    // In realtà serve TIPS spread ma usiamo proxy semplice
    const impliedInflation = t10y?.price ? parseFloat((t10y.price - 0.5).toFixed(2)) : null;

    return res.status(200).json({
      fedRate:         fedRateProxy,
      treasury10y:     t10y?.price ? parseFloat(t10y.price.toFixed(2)) : null,
      treasury10yChange: t10y?.changePct,
      yieldSpread,
      yieldCurveInverted: yieldSpread !== null ? yieldSpread < 0 : null,
      vix:             vix?.price ? parseFloat(vix.price.toFixed(1)) : null,
      vixChange:       vix?.changePct,
      sp500:           sp500?.price ? parseFloat(sp500.price.toFixed(0)) : null,
      sp500Change:     sp500?.changePct,
      dxy:             dxy?.price ? parseFloat(dxy.price.toFixed(1)) : null,
      dxyChange:       dxy?.changePct,
      gold:            gold?.price ? parseFloat(gold.price.toFixed(0)) : null,
      goldChange:      gold?.changePct,
      oil:             oil?.price ? parseFloat(oil.price.toFixed(1)) : null,
      oilChange:       oil?.changePct,
      impliedInflation,
      timestamp:       new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
