// api/forecast.js — Analisi storica + proiezione 12 mesi
// GET /api/forecast?symbol=AAPL&price=185.50

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol, price } = req.query;
  if (!symbol || !price) return res.status(400).json({ error: "Missing symbol or price" });

  try {
    const s = symbol.toUpperCase();
    const currentPrice = parseFloat(price);
    const now = Math.floor(Date.now() / 1000);
    const from5y = now - 10 * 365 * 86400;
    const from3y = now - 3 * 365 * 86400;

    // Fetch 5 anni dati settimanali da Yahoo Finance
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1wk&period1=${from5y}&period2=${now}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!r.ok) return res.status(404).json({ error: "No data from Yahoo Finance" });

    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No result" });

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    // Pulisci dati nulli
    const prices = timestamps
      .map((ts, i) => ({ ts, price: closes[i] }))
      .filter(p => p.price != null && p.price > 0);

    if (prices.length < 104) return res.status(400).json({ error: "Not enough historical data" });

    // ── 1. ANALISI STORICA A QUESTO PREZZO ──────────────────────────────────
    const band = 0.07; // ±7% del prezzo attuale
    const lo = currentPrice * (1 - band);
    const hi = currentPrice * (1 + band);
    const historicalOutcomes = [];

    for (let i = 0; i < prices.length - 52; i++) {
      const p = prices[i].price;
      if (p >= lo && p <= hi) {
        // Trova prezzo ~52 settimane dopo
        const futureIdx = Math.min(i + 52, prices.length - 1);
        const futurePrice = prices[futureIdx].price;
        const pct = ((futurePrice - p) / p) * 100;
        historicalOutcomes.push({
          date: new Date(prices[i].ts * 1000).toLocaleDateString("it-IT", { month: "short", year: "numeric" }),
          entryPrice: parseFloat(p.toFixed(2)),
          exitPrice: parseFloat(futurePrice.toFixed(2)),
          pct: parseFloat(pct.toFixed(2)),
        });
      }
    }

    const positiveCount = historicalOutcomes.filter(o => o.pct > 0).length;
    const winRate = historicalOutcomes.length > 0
      ? Math.round((positiveCount / historicalOutcomes.length) * 100) : null;
    const avgOutcome = historicalOutcomes.length > 0
      ? parseFloat((historicalOutcomes.reduce((s, o) => s + o.pct, 0) / historicalOutcomes.length).toFixed(2)) : null;
    const maxGain = historicalOutcomes.length > 0
      ? parseFloat(Math.max(...historicalOutcomes.map(o => o.pct)).toFixed(2)) : null;
    const maxLoss = historicalOutcomes.length > 0
      ? parseFloat(Math.min(...historicalOutcomes.map(o => o.pct)).toFixed(2)) : null;

    // ── 2. TREND STORICO 3 ANNI ──────────────────────────────────────────────
    const prices3y = prices.filter(p => p.ts >= from3y);
    let annualizedReturn = null;
    if (prices3y.length >= 2) {
      const first = prices3y[0].price;
      const last = prices3y[prices3y.length - 1].price;
      const years = (prices3y[prices3y.length - 1].ts - prices3y[0].ts) / (365 * 86400);
      annualizedReturn = parseFloat((((last / first) ** (1 / years) - 1) * 100).toFixed(2));
    }

    // ── 3. VOLATILITÀ (deviazione standard rendimenti settimanali) ───────────
    const weeklyReturns = [];
    for (let i = 1; i < prices.length; i++) {
      weeklyReturns.push((prices[i].price - prices[i-1].price) / prices[i-1].price);
    }
    const meanR = weeklyReturns.reduce((s, r) => s + r, 0) / weeklyReturns.length;
    const variance = weeklyReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / weeklyReturns.length;
    const weeklyVol = Math.sqrt(variance);
    const annualVol = parseFloat((weeklyVol * Math.sqrt(52) * 100).toFixed(2));

    // ── 4. STAGIONALITÀ MENSILE ──────────────────────────────────────────────
    const monthlyAvg = Array(12).fill(null).map(() => ({ sum: 0, count: 0 }));
    for (let i = 1; i < prices.length; i++) {
      const month = new Date(prices[i].ts * 1000).getMonth();
      const ret = (prices[i].price - prices[i-1].price) / prices[i-1].price * 100;
      monthlyAvg[month].sum += ret;
      monthlyAvg[month].count++;
    }
    const seasonality = monthlyAvg.map((m, i) => ({
      month: ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"][i],
      avgReturn: m.count > 0 ? parseFloat((m.sum / m.count).toFixed(2)) : 0,
    }));

    // ── 5. PROIEZIONE 12 MESI ────────────────────────────────────────────────
    // Percentili reali su rendimenti annuali rolling (10 anni)
    // Più conservativi di base±1.5σ che gonfiava i numeri
    const annualReturns = [];
    for (let i = 0; i + 52 < prices.length; i++) {
      annualReturns.push(((prices[i + 52].price - prices[i].price) / prices[i].price) * 100);
    }
    annualReturns.sort((a, b) => a - b);

    const percentile = (arr, p) => {
      if (!arr.length) return 0;
      const idx = Math.max(0, Math.min(arr.length - 1, Math.floor((p / 100) * arr.length)));
      return arr[idx];
    };

    // Trend aggiustato /1.5 per non proiettare bull market infinito
    const rawTrend = annualizedReturn !== null ? annualizedReturn : (percentile(annualReturns, 50) || 0);
    const rawBase  = rawTrend / 1.5;
    const rawPess  = annualReturns.length >= 20 ? percentile(annualReturns, 20) : rawBase - annualVol * 0.6;
    const rawOpt   = annualReturns.length >= 20 ? percentile(annualReturns, 80) : rawBase + annualVol * 0.6;

    const cap = (v, min, max) => Math.max(min, Math.min(max, v));
    const base = parseFloat(cap(rawBase, -25, 25).toFixed(2));
    const pess = parseFloat(cap(rawPess, -30, 15).toFixed(2));
    const opt  = parseFloat(cap(rawOpt,   -5, 30).toFixed(2));

    const projection = {
      base,
      pessimistic: pess,
      optimistic:  opt,
      basePriceTarget:        parseFloat((currentPrice * (1 + base / 100)).toFixed(2)),
      pessimisticPriceTarget: parseFloat((currentPrice * (1 + pess / 100)).toFixed(2)),
      optimisticPriceTarget:  parseFloat((currentPrice * (1 + opt  / 100)).toFixed(2)),
    };

    // ── 6. GRAFICO PROIEZIONE MESE PER MESE ─────────────────────────────────
    const projectionChart = [];
    const now2 = new Date();
    for (let m = 1; m <= 12; m++) {
      const d = new Date(now2); d.setMonth(d.getMonth() + m);
      const monthIdx = d.getMonth();
      const seasonBoost = seasonality[monthIdx].avgReturn;
      const factor = m / 12;
      projectionChart.push({
        month: d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" }),
        base: parseFloat((currentPrice * (1 + (base * factor) / 100)).toFixed(2)),
        pessimistic: parseFloat((currentPrice * (1 + ((base - 1.5 * sigma) * factor) / 100)).toFixed(2)),
        optimistic: parseFloat((currentPrice * (1 + ((base + 1.5 * sigma) * factor) / 100)).toFixed(2)),
        seasonBoost: parseFloat(seasonBoost.toFixed(2)),
      });
    }

    return res.status(200).json({
      symbol: s,
      currentPrice,
      // Analisi storica
      historicalOutcomes: historicalOutcomes.slice(-10), // ultimi 10 casi
      winRate,
      avgOutcome,
      maxGain,
      maxLoss,
      occurrences: historicalOutcomes.length,
      // Statistiche
      annualizedReturn,
      annualVol,
      // Stagionalità
      seasonality,
      // Proiezione
      projection,
      projectionChart,
    });

  } catch (err) {
    console.error("Forecast error:", err);
    return res.status(500).json({ error: "Failed to compute forecast" });
  }
}
