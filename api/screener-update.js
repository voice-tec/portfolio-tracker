// api/screener-update.js — Aggiorna cache screener su Supabase
// Analizza l'S&P 500 in batch via Finnhub e salva i risultati
// Chiamato manualmente o da Vercel Cron 1x/giorno

const FINNHUB_KEY  = process.env.FINNHUB_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const FH = "https://finnhub.io/api/v1";

// S&P 500 completo suddiviso per settore
const SP500 = [
  // Technology
  "AAPL","MSFT","NVDA","AVGO","AMD","CSCO","ADBE","CRM","ORCL","IBM",
  "INTC","QCOM","TXN","AMAT","KLAC","LRCX","ADI","SNPS","CDNS","FTNT",
  "PANW","NOW","PAYC","CTSH","IT","EPAM","VRSN","FFIV","JNPR","NTAP",
  "STX","WDC","HPQ","HPE","GLW","ZBRA","CDW","LDOS","SAIC","CACI",
  // Healthcare
  "UNH","LLY","JNJ","ABBV","MRK","TMO","ABT","DHR","BMY","AMGN",
  "PFE","ISRG","SYK","MDT","ELV","CI","HUM","CVS","MCK","CAH",
  "ABC","MOH","CNC","IDXX","BIO","BIIB","ILMN","HOLX","BAX","BDX",
  "ZBH","RMD","EW","IQV","A","HSIC","TECH","PODD","BSX","RVTY",
  // Financials
  "JPM","BAC","WFC","GS","MS","BLK","BX","SPGI","MCO","ICE",
  "CME","CBOE","C","AXP","COF","DFS","SYF","USB","TFC","PNC",
  "MTB","RF","FITB","HBAN","CFG","KEY","ZION","BRK.B","CB","AIG",
  "MET","PRU","AFL","ALL","PGR","TRV","HIG","AJG","MMC","AON",
  "WTW","TROW","NTRS","STT","BEN","IVZ","CMA","RJF","ACGL","AIZ",
  // Consumer Discretionary
  "AMZN","TSLA","HD","MCD","NKE","SBUX","LOW","TJX","ROST","CMG",
  "YUM","DRI","BKNG","EXPE","ABNB","LVS","MGM","WYNN","RCL","CCL",
  "NCLH","F","GM","AN","KMX","APTV","RL","TPR","PVH","HAS",
  "BBY","ULTA","CPRT","ORLY","AZO","GPC","LKQ","POOL","NVR","TOL",
  // Consumer Staples
  "PG","KO","PEP","PM","MO","COST","WMT","KR","SYY","TSN",
  "CAG","HRL","CPB","SJM","KHC","MDLZ","MKC","K","GIS","STZ",
  "BG","TAP","CLX","CHD","CL","EL","KVUE","PRGO",
  // Energy
  "XOM","CVX","COP","DVN","MRO","OVV","EOG","FANG","PXD","HES",
  "APA","PSX","MPC","VLO","SLB","HAL","BKR","OKE","KMI","WMB",
  "TRGP","CVI","CIVI","RRC","AR","SM","NOG","VTLE",
  // Industrials
  "GE","HON","UPS","RTX","LMT","NOC","GD","BA","CAT","DE",
  "EMR","ETN","ROK","PH","ITW","CMI","PCAR","WAB","TT","IR",
  "CARR","OTIS","GWW","FAST","CHRW","EXPD","JBHT","NSC","UNP","CSX",
  "FDX","LHX","TDY","HII","L3","TER","GNRC","AXON","MTZ","PWR",
  "EME","STLD","NUE","X","CLF","MLM","VMC","AWI","BLDR","MAS",
  // Materials
  "LIN","APD","ECL","NEM","FCX","AA","DD","DOW","LYB","PPG",
  "SHW","RPM","ALB","CF","MOS","FMC","IFF","CE","EMN","TREX",
  // Real Estate
  "AMT","PLD","CCI","EQIX","PSA","SPG","EQR","AVB","WY","VTR",
  "ARE","DLR","O","WELL","EXR","INVH","MAA","ESS","CPT","BXP",
  // Utilities
  "NEE","SO","DUK","SRE","AEP","EXC","XEL","WEC","ED","AEE",
  "ETR","CNP","PPL","NI","EVRG","PNW","AVA","ATO","LNT","ES",
  // Communication Services
  "META","GOOGL","GOOG","NFLX","DIS","CMCSA","T","VZ","TMUS","CHTR",
  "NWSA","NWS","FOXA","FOX","WBD","MTCH","LYV","EA","TTWO","OMC","IPG",
];

async function finnhubGet(path) {
  const res = await fetch(`${FH}${path}&token=${FINNHUB_KEY}`, {
    headers: { "Accept": "application/json" }
  });
  if (!res.ok) return null;
  return res.json();
}

async function supabaseGetScores(symbols) {
  // Legge gli score attuali prima di aggiornarli
  const url = `${SUPABASE_URL}/rest/v1/screener_cache?select=symbol,score_composite&symbol=in.(${symbols.map(s => `"${s}"`).join(',')})`;
  const res = await fetch(url, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    }
  });
  if (!res.ok) return {};
  const data = await res.json();
  return Object.fromEntries((data || []).map(r => [r.symbol, r.score_composite]));
}

async function supabaseUpsert(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/screener_cache`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer":        "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  return res.ok;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!FINNHUB_KEY)  return res.status(500).json({ error: "Missing FINNHUB_API_KEY" });
  if (!SUPABASE_URL) return res.status(500).json({ error: "Missing SUPABASE_URL" });
  if (!SUPABASE_KEY) return res.status(500).json({ error: "Missing SUPABASE_ANON_KEY" });

  // Semplice auth: richiede secret param per evitare chiamate accidentali
  const secret = req.query.secret || req.headers["x-update-secret"];
  if (secret !== process.env.SCREENER_UPDATE_SECRET && process.env.SCREENER_UPDATE_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const unique = [...new Set(SP500)];
  const BATCH  = 5;
  const saved  = [];
  const errors = [];

  console.log(`[screener-update] Starting update for ${unique.length} tickers`);

  // Leggi score precedenti prima di aggiornare
  const prevScores = await supabaseGetScores(unique).catch(() => ({}));

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);

    const fetches = batch.flatMap(sym => [
      finnhubGet(`/quote?symbol=${sym}`),
      finnhubGet(`/stock/metric?symbol=${sym}&metric=all`),
      finnhubGet(`/stock/profile2?symbol=${sym}`),
    ]);

    const data = await Promise.all(fetches);
    const rows = [];

    for (let j = 0; j < batch.length; j++) {
      const sym     = batch[j];
      const quote   = data[j * 3];
      const fund    = data[j * 3 + 1];
      const profile = data[j * 3 + 2];

      if (!quote?.c || quote.c === 0) { errors.push(sym); continue; }

      const price  = quote.c;
      const m      = fund?.metric || {};
      const high52 = m["52WeekHigh"] || 0;
      const low52  = m["52WeekLow"]  || 0;
      const pe     = parseFloat(m.peNormalizedAnnual || m.peTTM || 0);
      const pb     = parseFloat(m.pbAnnual || m.pbQuarterly || 0);
      const roe    = parseFloat(m.roeTTM || m.roeAnnual || 0);
      const roa    = parseFloat(m.roaTTM || m.roaAnnual || 0);
      const mktCap = parseFloat(m.marketCapitalization || 0) * 1e6;
      const sector = profile?.finnhubIndustry || "—";
      const name   = profile?.name || sym;

      // Score Fama-French
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
      if (scores.length < 2) { errors.push(sym); continue; }

      const composite = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);
      const change1d  = quote.pc > 0 ? parseFloat(((quote.c - quote.pc) / quote.pc * 100).toFixed(2)) : 0;

      rows.push({
        symbol:              sym,
        name,
        sector,
        price:               parseFloat(price.toFixed(2)),
        mkt_cap_m:           Math.round(mktCap / 1e6),
        pe:                  pe  > 0   ? parseFloat(pe.toFixed(1))  : null,
        pb:                  pb  > 0   ? parseFloat(pb.toFixed(2))  : null,
        roe:                 roe !== 0 ? parseFloat(roe.toFixed(1)) : null,
        roa:                 roa !== 0 ? parseFloat(roa.toFixed(1)) : null,
        score_value:         valueScore,
        score_size:          sizeScore,
        score_profitability: profScore,
        score_momentum:      momentumScore,
        score_composite:     composite,
        score_composite_prev: prevScores[sym] ?? null,
        score_updated_week:  (() => { const n = new Date(); const w = Math.ceil((((n - new Date(n.getFullYear(),0,1))/86400000)+1)/7); return `${n.getFullYear()}-W${String(w).padStart(2,'0')}`; })(),
        change_1d:           change1d,
        updated_at:          new Date().toISOString(),
      });
      saved.push(sym);
    }

    if (rows.length > 0) await supabaseUpsert(rows);

    // Pausa tra batch per rispettare rate limit Finnhub
    if (i + BATCH < unique.length) await new Promise(r => setTimeout(r, 350));
  }

  console.log(`[screener-update] Done: ${saved.length} saved, ${errors.length} errors`);
  return res.status(200).json({
    success: true,
    saved:   saved.length,
    errors:  errors.length,
    tickers: saved,
  });
}
