// api/earnings.js — Storico earnings e impatto sul prezzo
// GET /api/earnings?symbol=AAPL
// Ritorna: date earnings storiche, EPS actual vs estimate, movimento prezzo ±2 settimane

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  try {
    const s = symbol.toUpperCase();

    // Fetch earnings history da Yahoo Finance quoteSummary
    const summaryUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=earningsHistory,earnings,calendarEvents`;
    const r = await fetch(summaryUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });

    if (!r.ok) return res.status(404).json({ error: "No data" });
    const data = await r.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return res.status(404).json({ error: "No result" });

    const earningsHistory = result.earningsHistory?.history || [];
    const calendarEvents  = result.calendarEvents;
    const nextEarnings    = calendarEvents?.earnings?.earningsDate?.[0]?.raw;

    // Fetch prezzi giornalieri ultimi 3 anni per calcolare impatto
    const now    = Math.floor(Date.now() / 1000);
    const from3y = now - 3 * 365 * 86400;
    const priceUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&period1=${from3y}&period2=${now}`;
    const pr = await fetch(priceUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });

    let priceMap = {};
    if (pr.ok) {
      const pd = await pr.json();
      const presult = pd?.chart?.result?.[0];
      if (presult) {
        const ts     = presult.timestamp || [];
        const closes = presult.indicators?.quote?.[0]?.close || [];
        ts.forEach((t, i) => {
          if (closes[i] != null) {
            const date = new Date(t * 1000).toISOString().slice(0, 10);
            priceMap[date] = closes[i];
          }
        });
      }
    }

    // Helper: trova prezzo più vicino a una data
    const getPriceNear = (dateStr, offsetDays) => {
      const d = new Date(dateStr);
      for (let delta = 0; delta <= 5; delta++) {
        const try1 = new Date(d); try1.setDate(d.getDate() + offsetDays + delta);
        const try2 = new Date(d); try2.setDate(d.getDate() + offsetDays - delta);
        const k1 = try1.toISOString().slice(0, 10);
        const k2 = try2.toISOString().slice(0, 10);
        if (priceMap[k1]) return priceMap[k1];
        if (priceMap[k2]) return priceMap[k2];
      }
      return null;
    };

    // Costruisci array earnings con impatto prezzo
    const earnings = earningsHistory
      .filter(e => e.quarter?.raw)
      .map(e => {
        const dateStr  = e.quarter?.fmt || new Date(e.quarter.raw * 1000).toISOString().slice(0, 10);
        const epsActual   = e.epsActual?.raw ?? null;
        const epsEstimate = e.epsEstimate?.raw ?? null;
        const surprise    = e.surprisePercent?.raw ?? null;

        // Prezzi: giorno prima, giorno earnings, 2 settimane dopo
        const priceBefore  = getPriceNear(dateStr, -1);
        const priceDay     = getPriceNear(dateStr, 0);
        const priceAfter1w = getPriceNear(dateStr, +5);
        const priceAfter2w = getPriceNear(dateStr, +10);

        const moveDay = priceBefore && priceDay
          ? parseFloat(((priceDay - priceBefore) / priceBefore * 100).toFixed(2)) : null;
        const move1w  = priceBefore && priceAfter1w
          ? parseFloat(((priceAfter1w - priceBefore) / priceBefore * 100).toFixed(2)) : null;
        const move2w  = priceBefore && priceAfter2w
          ? parseFloat(((priceAfter2w - priceBefore) / priceBefore * 100).toFixed(2)) : null;

        // Periodo quarter (es. "Q1 2024")
        const qDate  = new Date(e.quarter.raw * 1000);
        const qMonth = qDate.getMonth();
        const qYear  = qDate.getFullYear();
        const qNum   = Math.floor(qMonth / 3) + 1;

        return {
          date:        dateStr,
          quarter:     `Q${qNum} ${qYear}`,
          epsActual,
          epsEstimate,
          surprise,
          beat:        surprise != null ? surprise > 0 : null,
          priceBefore: priceBefore ? parseFloat(priceBefore.toFixed(2)) : null,
          priceDay:    priceDay    ? parseFloat(priceDay.toFixed(2))    : null,
          moveDay,
          move1w,
          move2w,
        };
      })
      .filter(e => e.epsActual !== null)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12); // ultimi 12 trimestri

    // Statistiche aggregate
    const withMove = earnings.filter(e => e.moveDay !== null);
    const beats    = earnings.filter(e => e.beat === true);
    const misses   = earnings.filter(e => e.beat === false);
    const avgMoveOnBeat  = beats.filter(e => e.moveDay !== null).length
      ? parseFloat((beats.filter(e => e.moveDay !== null).reduce((s, e) => s + e.moveDay, 0) / beats.filter(e => e.moveDay !== null).length).toFixed(2)) : null;
    const avgMoveOnMiss  = misses.filter(e => e.moveDay !== null).length
      ? parseFloat((misses.filter(e => e.moveDay !== null).reduce((s, e) => s + e.moveDay, 0) / misses.filter(e => e.moveDay !== null).length).toFixed(2)) : null;
    const avgMove2w = withMove.filter(e => e.move2w !== null).length
      ? parseFloat((withMove.filter(e => e.move2w !== null).reduce((s, e) => s + e.move2w, 0) / withMove.filter(e => e.move2w !== null).length).toFixed(2)) : null;

    return res.status(200).json({
      symbol: s,
      nextEarnings: nextEarnings ? new Date(nextEarnings * 1000).toISOString().slice(0, 10) : null,
      earnings,
      stats: {
        totalReported: earnings.length,
        beatRate:      earnings.length ? Math.round(beats.length / earnings.length * 100) : null,
        avgMoveOnBeat,
        avgMoveOnMiss,
        avgMove2w,
      },
    });

  } catch (err) {
    console.error("Earnings error:", err);
    return res.status(500).json({ error: "Failed to fetch earnings" });
  }
}
