// ─── MARKET STATE UTILS ───────────────────────────────────────────────────────

/**
 * Calcola lo stato del mercato in base all'orario locale del mercato.
 * Supporta mercati EU (CET) e US (ET).
 *
 * @param {"USD"|"EUR"|"GBp"} currency
 * @returns {"REGULAR"|"PRE"|"POST"|"CLOSED"}
 */
export function getMarketStateByTime(currency) {
  const now = new Date();

  if (currency === "EUR" || currency === "GBp") {
    // Mercati europei: 09:00–17:30 CET, post-market 17:30–20:00 CET
    const cet = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const h = cet.getHours(), m = cet.getMinutes(), d = cet.getDay();
    const mins = h * 60 + m;
    if (d === 0 || d === 6) return "CLOSED";
    if (mins >= 540 && mins < 1050) return "REGULAR";  // 09:00–17:30
    if (mins >= 1050 && mins < 1200) return "POST";    // 17:30–20:00
    return "CLOSED";
  }

  // Mercati US (default): pre 04:00–09:30, regular 09:30–16:00, post 16:00–20:00 ET
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = ny.getHours(), m = ny.getMinutes(), d = ny.getDay();
  const mins = h * 60 + m;
  if (d === 0 || d === 6) return "CLOSED";
  if (mins >= 240 && mins < 570) return "PRE";
  if (mins >= 570 && mins < 960) return "REGULAR";
  if (mins >= 960 && mins < 1200) return "POST";
  return "CLOSED";
}

/**
 * Risolve il market state definitivo:
 * usa quello dell'API se disponibile e non è CLOSED,
 * altrimenti calcola in base all'orario.
 */
export function resolveMarketState(apiState, currency) {
  if (apiState && apiState !== "CLOSED" && apiState !== "POSTPOST") return apiState;
  if (apiState === "POSTPOST") return "POST";
  return getMarketStateByTime(currency);
}
