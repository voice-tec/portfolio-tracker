// ─── CURRENCY UTILS ───────────────────────────────────────────────────────────

/**
 * Converte un prezzo nella valuta originale in USD.
 * @param {number} price - Prezzo nella valuta originale
 * @param {string} currency - "USD" | "EUR" | "GBp"
 * @param {number} eurRate - Tasso EUR/USD (es. 0.92 significa 1 USD = 0.92 EUR)
 * @returns {number} Prezzo in USD
 */
export function toUSD(price, currency, eurRate = 0.92) {
  if (!price || price === 0) return 0;
  if (!currency || currency === "USD") return price;
  if (currency === "EUR") return eurRate > 0 ? price / eurRate : price;
  if (currency === "GBp") return eurRate > 0 ? (price / 100) / (eurRate * 0.85) : price; // pence → £ → $
  return price;
}

/**
 * Rileva la valuta dal suffisso del ticker.
 * @param {string} ticker
 * @returns {"USD"|"EUR"|"GBp"}
 */
export function detectCurrency(ticker) {
  if (!ticker) return "USD";
  const t = ticker.toUpperCase();
  if (t.endsWith(".MI") || t.endsWith(".AS") || t.endsWith(".PA") ||
      t.endsWith(".DE") || t.endsWith(".SW") || t.endsWith(".BR") ||
      t.endsWith(".MA")) return "EUR";
  if (t.endsWith(".L")) return "GBp";
  return "USD";
}

/**
 * Ritorna il simbolo della valuta.
 */
export function currencySymbol(currency) {
  if (currency === "EUR") return "€";
  if (currency === "GBp") return "p";
  return "$";
}

/**
 * Formatta un prezzo nella sua valuta originale (per visualizzazione).
 * @param {number} price
 * @param {string} currency
 * @returns {string} es. "€112.78" oppure "286p"
 */
export function formatNative(price, currency, fmt) {
  if (currency === "EUR") return `€${fmt(price)}`;
  if (currency === "GBp") return `${fmt(price)}p`;
  return `$${fmt(price)}`;
}
