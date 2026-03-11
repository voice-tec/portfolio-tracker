export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const s = (req.query.symbol || "SWDA.MI").toUpperCase();
  const results = {};

  // Test 1: Yahoo query1 v7
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(s)}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }
    });
    results.yahoo_q1_v7 = { status: r.status, ok: r.ok };
    if (r.ok) {
      const d = await r.json();
      results.yahoo_q1_v7.price = d?.quoteResponse?.result?.[0]?.regularMarketPrice || null;
    }
  } catch(e) { results.yahoo_q1_v7 = { error: e.message }; }

  // Test 2: Yahoo query2 v7
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(s)}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }
    });
    results.yahoo_q2_v7 = { status: r.status, ok: r.ok };
    if (r.ok) {
      const d = await r.json();
      results.yahoo_q2_v7.price = d?.quoteResponse?.result?.[0]?.regularMarketPrice || null;
    }
  } catch(e) { results.yahoo_q2_v7 = { error: e.message }; }

  // Test 3: Yahoo v8 chart
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1d`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    results.yahoo_v8 = { status: r.status, ok: r.ok };
    if (r.ok) {
      const d = await r.json();
      results.yahoo_v8.price = d?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
    }
  } catch(e) { results.yahoo_v8 = { error: e.message }; }

  // Test 4: Twelve Data con exchange separato
  try {
    const tdKey = process.env.TWELVE_DATA_API_KEY;
    const sym = s.replace(".MI","").replace(".AS","").replace(".DE","").replace(".L","");
    const exMap = { ".MI":"MIL", ".AS":"AMS", ".DE":"XETR", ".L":"LSE", ".PA":"EPA", ".SW":"SWX" };
    const ex = Object.entries(exMap).find(([k]) => s.endsWith(k))?.[1] || "";
    const url = ex
      ? `https://api.twelvedata.com/quote?symbol=${sym}&exchange=${ex}&apikey=${tdKey}`
      : `https://api.twelvedata.com/quote?symbol=${sym}&apikey=${tdKey}`;
    results.twelve_data_url = url.replace(tdKey, "***");
    const r = await fetch(url);
    results.twelve_data = { status: r.status };
    const d = await r.json();
    results.twelve_data.response = d;
  } catch(e) { results.twelve_data = { error: e.message }; }

  return res.status(200).json({ symbol: s, results });
}
