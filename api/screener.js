// api/screener.js — Fama-French screener via FMP (universo completo)
// Usa FMP stock-screener per filtrare migliaia di titoli per fondamentali
// Poi calcola score Fama-French e arricchisce con Finnhub per momentum

const FMP_KEY     = process.env.FMP_API_KEY;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800"); // cache 30 min
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!FMP_KEY) return res.status(500).json({ error: "FMP_API_KEY non configurata", results: [] });

  const { exchange = "NASDAQ,NYSE", limit = 50 } = req.query;
  const maxResults = Math.min(parseInt(limit) || 50, 100);

  try {
    // ── 1. FMP Stock Screener — filtra titoli per fondamentali ──────────────
    // Parametri value/quality: P/E basso, P/B basso, ROE alto, mid cap
    const exchanges = exchange.split(",");
    
    const screenPromises = exchanges.map(ex =>
      fetch(
        `https://financialmodelingprep.com/api/v3/stock-screener?` +
        `exchange=${ex}&` +
        `marketCapMoreThan=100000000&` +     // min 100M cap
        `marketCapLowerThan=50000000000&` +   // max 50B cap (small/mid)
        `betaLowerThan=2&` +                  // non troppo volatile
        `volumeMoreThan=100000&` +            // liquidità minima
        `isEtf=false&isActivelyTrading=true&` +
        `limit=200&` +
        `apikey=${FMP_KEY}`,
        { headers: { "Accept": "application/json" } }
      ).then(r => r.ok ? r.json() : []).catch(() => [])
    );

    const screenResults = await Promise.all(screenPromises);
    const allStocks = screenResults.flat();

    if (!allStocks.length) {
      return res.status(200).json({ results: [], count: 0, error: "No stocks from FMP screener" });
    }

    // ── 2. Arricchisci con fondamentali dettagliati via FMP ─────────────────
    // Shuffle e prendi un campione per non eccedere i limiti
    const shuffled = allStocks.sort(() => Math.random() - 0.5).slice(0, 60);

    // Fetch profile e ratios in batch
    const BATCH = 10;
    const enriched = [];

    for (let i = 0; i < shuffled.length; i += BATCH) {
      const batch = shuffled.slice(i, i + BATCH);
      const symbols = batch.map(s => s.symbol).join(",");

      const [profilesRes, ratiosRes, quoteRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/api/v3/profile/${symbols}?apikey=${FMP_KEY}`)
          .then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`https://financialmodelingprep.com/api/v3/ratios-ttm/${symbols}?apikey=${FMP_KEY}`)
          .then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${FMP_KEY}`)
          .then(r => r.ok ? r.json() : []).catch(() => []),
      ]);

      const profileMap = {};
      const ratiosMap  = {};
      const quoteMap   = {};

      (Array.isArray(profilesRes) ? profilesRes : []).forEach(p => { profileMap[p.symbol] = p; });
      (Array.isArray(ratiosRes)   ? ratiosRes   : []).forEach(r => { ratiosMap[r.symbol]  = r; });
      (Array.isArray(quoteRes)    ? quoteRes    : []).forEach(q => { quoteMap[q.symbol]   = q; });

      for (const stock of batch) {
        const sym  = stock.symbol;
        const prof = profileMap[sym] || stock;
        const rat  = ratiosMap[sym]  || {};
        const q    = quoteMap[sym]   || stock;

        const price   = q.price || prof.price || 0;
        if (!price || price <= 0) continue;

        const pe      = rat.peRatioTTM || prof.pe || null;
        const pb      = rat.priceToBookRatioTTM || null;
        const roe     = rat.returnOnEquityTTM != null ? rat.returnOnEquityTTM * 100 : null;
        const roa     = rat.returnOnAssetsTTM  != null ? rat.returnOnAssetsTTM  * 100 : null;
        const mktCap  = prof.mktCap || stock.marketCap || 0;
        const high52  = q.yearHigh  || prof.yearHigh  || 0;
        const low52   = q.yearLow   || prof.yearLow   || 0;
        const change1d = q.changesPercentage || 0;
        const sector  = prof.sector || stock.sector || "—";
        const name    = prof.companyName || stock.companyName || sym;

        // ── Score Fama-French ──────────────────────────────────────────────
        // VALUE: P/E basso + P/B basso
        const peScore = pe > 0 && pe < 80
          ? Math.max(0, Math.min(100, Math.round(((40 - pe) / 40) * 100))) : null;
        const pbScore = pb > 0
          ? Math.max(0, Math.min(100, Math.round(((3 - pb) / 3) * 100))) : null;
        const valueScore = peScore != null && pbScore != null
          ? Math.round((peScore + pbScore) / 2) : (peScore ?? pbScore ?? null);

        // SIZE: small/mid cap (100M–10B = score alto)
        const sizeScore = mktCap > 0
          ? Math.round(Math.max(0, Math.min(100, ((10e9 - mktCap) / 10e9) * 100))) : null;

        // PROFITABILITY: ROE + ROA alti
        const roeScore = roe != null ? Math.max(0, Math.min(100, Math.round((roe / 25) * 100))) : null;
        const roaScore = roa != null ? Math.max(0, Math.min(100, Math.round((roa / 10) * 100))) : null;
        const profScore = roeScore != null || roaScore != null
          ? Math.round(((roeScore ?? 0) + (roaScore ?? 0)) / ((roeScore != null ? 1 : 0) + (roaScore != null ? 1 : 0)))
          : null;

        // MOMENTUM: posizione nel range 52 settimane
        const momentumScore = high52 > low52 && price > 0
          ? Math.round(((price - low52) / (high52 - low52)) * 100) : null;

        const scores = [valueScore, sizeScore, profScore, momentumScore].filter(s => s != null);
        if (scores.length < 2) continue;

        const composite = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

        enriched.push({
          symbol:  sym,
          name,
          sector,
          price:   parseFloat(price.toFixed(2)),
          mktCapM: Math.round(mktCap / 1e6),
          pe:      pe     > 0    ? parseFloat(pe.toFixed(1))  : null,
          pb:      pb     > 0    ? parseFloat(pb.toFixed(2))  : null,
          roe:     roe   != null ? parseFloat(roe.toFixed(1)) : null,
          roa:     roa   != null ? parseFloat(roa.toFixed(1)) : null,
          change1d: parseFloat(change1d.toFixed(2)),
          scores: {
            value:        valueScore,
            size:         sizeScore,
            profitability: profScore,
            momentum:     momentumScore,
            composite,
          },
        });
      }

      // Pausa tra batch
      if (i + BATCH < shuffled.length) await new Promise(r => setTimeout(r, 200));
    }

    // Ordina per score composito e prendi i top N
    enriched.sort((a, b) => b.scores.composite - a.scores.composite);
    const top = enriched.slice(0, maxResults);

    return res.status(200).json({ results: top, count: top.length, total: enriched.length });

  } catch (err) {
    console.error("Screener error:", err.message);
    return res.status(500).json({ error: err.message, results: [] });
  }
}
