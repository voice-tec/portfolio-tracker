// api/screener.js — Legge da Supabase cache (aggiornata da screener-update.js)
// Velocissimo — nessuna chiamata a API esterne, solo query Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// Fallback Finnhub se Supabase è vuota
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const FH = "https://finnhub.io/api/v1";

const FALLBACK_UNIVERSE = [
  "JPM","BAC","C","WFC","USB","XOM","CVX","COP","AAPL","MSFT",
  "NVDA","GOOGL","META","AMZN","TSLA","JNJ","ABBV","LLY","UNH","PFE",
  "GE","HON","CAT","DE","EMR","KO","PEP","PG","MO","PM",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300"); // cache 5 min
  if (req.method === "OPTIONS") return res.status(200).end();

  const { limit = 50, sector, minScore, sortBy = "score_composite" } = req.query;
  const maxResults = Math.min(parseInt(limit) || 50, 100);

  // ── Prova a leggere da Supabase ───────────────────────────────────────────
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      let url = `${SUPABASE_URL}/rest/v1/screener_cache?select=symbol,name,sector,price,mkt_cap_m,pe,pb,roe,roa,score_value,score_size,score_profitability,score_momentum,score_composite,score_composite_prev,score_updated_week,change_1d,updated_at&order=${sortBy}.desc&limit=${maxResults}`;
      if (sector && sector !== "Tutti") url += `&sector=eq.${encodeURIComponent(sector)}`;
      if (minScore) url += `&score_composite=gte.${minScore}`;

      const sbRes = await fetch(url, {
        headers: {
          "apikey":        SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Accept":        "application/json",
        }
      });

      if (sbRes.ok) {
        const rows = await sbRes.json();
        if (Array.isArray(rows) && rows.length > 0) {
          // Converti formato Supabase → formato frontend
          const results = rows.map(r => ({
            symbol:   r.symbol,
            name:     r.name,
            sector:   r.sector,
            price:    r.price,
            mktCapM:  r.mkt_cap_m,
            pe:       r.pe,
            pb:       r.pb,
            roe:      r.roe,
            roa:      r.roa,
            change1d: r.change_1d?.toString() || "0",
            updatedAt: r.updated_at,
            scorePrev:  r.score_composite_prev ?? null,
            scoreWeek:  r.score_updated_week ?? null,
            scores: {
              value:         r.score_value,
              size:          r.score_size,
              profitability: r.score_profitability,
              momentum:      r.score_momentum,
              composite:     r.score_composite,
            },
          }));

          // Ottieni data ultimo aggiornamento
          const lastUpdate = rows[0]?.updated_at
            ? new Date(rows[0].updated_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            : null;

          return res.status(200).json({
            results,
            count:      results.length,
            source:     "cache",
            lastUpdate,
          });
        }
      }
    } catch (e) {
      console.error("[screener] Supabase error:", e.message);
    }
  }

  // ── Fallback: Finnhub live se cache vuota ─────────────────────────────────
  if (!FINNHUB_KEY) {
    return res.status(200).json({ results: [], count: 0, error: "Cache vuota e nessuna API key disponibile" });
  }

  try {
    const tickers = FALLBACK_UNIVERSE;
    const results = [];
    const BATCH   = 5;

    for (let i = 0; i < tickers.length; i += BATCH) {
      const batch = tickers.slice(i, i + BATCH);
      const fetches = batch.flatMap(sym => [
        fetch(`${FH}/quote?symbol=${sym}&token=${FINNHUB_KEY}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${FH}/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${FH}/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      const data = await Promise.all(fetches);

      for (let j = 0; j < batch.length; j++) {
        const sym     = batch[j];
        const quote   = data[j * 3];
        const fund    = data[j * 3 + 1];
        const profile = data[j * 3 + 2];

        if (!quote?.c || quote.c === 0) continue;

        const price  = quote.c;
        const m      = fund?.metric || {};
        const high52 = m["52WeekHigh"] || 0;
        const low52  = m["52WeekLow"]  || 0;
        const pe     = parseFloat(m.peNormalizedAnnual || m.peTTM || 0);
        const pb     = parseFloat(m.pbAnnual || m.pbQuarterly || 0);
        const roe    = parseFloat(m.roeTTM || m.roeAnnual || 0);
        const roa    = parseFloat(m.roaTTM || m.roaAnnual || 0);
        const mktCap = parseFloat(m.marketCapitalization || 0) * 1e6;

        const peScore = pe > 0 && pe < 80 ? Math.max(0, Math.min(100, Math.round(((40-pe)/40)*100))) : null;
        const pbScore = pb > 0 ? Math.max(0, Math.min(100, Math.round(((3-pb)/3)*100))) : null;
        const valueScore = peScore != null && pbScore != null ? Math.round((peScore+pbScore)/2) : (peScore ?? pbScore ?? null);
        const sizeScore = mktCap > 0 ? Math.round(Math.max(0, Math.min(100, ((100e9-mktCap)/100e9)*100))) : null;
        const roeScore = roe !== 0 ? Math.max(0, Math.min(100, Math.round((roe/25)*100))) : null;
        const roaScore = roa !== 0 ? Math.max(0, Math.min(100, Math.round((roa/10)*100))) : null;
        const profScore = roeScore != null || roaScore != null
          ? Math.round(((roeScore??0)+(roaScore??0))/((roeScore!=null?1:0)+(roaScore!=null?1:0))) : null;
        const momentumScore = high52 > low52 && price > 0 ? Math.round(((price-low52)/(high52-low52))*100) : null;

        const scores = [valueScore, sizeScore, profScore, momentumScore].filter(s => s != null);
        if (scores.length < 2) continue;

        const composite = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);

        results.push({
          symbol: sym, name: profile?.name || sym, sector: profile?.finnhubIndustry || "—",
          price, mktCapM: Math.round(mktCap / 1e6),
          pe: pe > 0 ? parseFloat(pe.toFixed(1)) : null,
          pb: pb > 0 ? parseFloat(pb.toFixed(2)) : null,
          roe: roe !== 0 ? parseFloat(roe.toFixed(1)) : null,
          roa: roa !== 0 ? parseFloat(roa.toFixed(1)) : null,
          change1d: (((quote.c - quote.pc) / quote.pc) * 100).toFixed(2),
          scores: { value: valueScore, size: sizeScore, profitability: profScore, momentum: momentumScore, composite },
        });
      }

      if (i + BATCH < tickers.length) await new Promise(r => setTimeout(r, 300));
    }

    results.sort((a, b) => b.scores.composite - a.scores.composite);
    return res.status(200).json({ results: results.slice(0, maxResults), count: results.length, source: "live" });

  } catch (err) {
    return res.status(500).json({ error: err.message, results: [] });
  }
}
