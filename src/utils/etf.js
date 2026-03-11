// ─── ETF UTILS ────────────────────────────────────────────────────────────────

export const KNOWN_ETFS = new Set([
  // US
  "QQQ","SPY","IVV","VOO","VTI","VEA","VWO","VNQ","XLE","XLF","XLK","XLV",
  "XLI","XLP","XLY","XLB","XLU","XLRE","XLC","GLD","SLV","TLT","IEF","HYG",
  "LQD","ARKK","ARKG","IWM","EEM","UUP","CQQQ","TIPS","BIL","SHY",
  // EU UCITS
  "SWDA","VWCE","IWDA","CSPX","EUNL","IUSQ","XDWD","VUSA","MEUD","IEMA",
  "AGGH","IBCI","SGLD","IBTM","VGOV","VMID","VWRL","SXR8","VUAA","IQQQ",
  "CNDX","IUSA","IQQH","CSNDX","XNAS","EXXT","QDVE","IQQW",
]);

/**
 * Verifica se un ticker è un ETF noto (rimuove il suffisso di mercato).
 */
export function isKnownETF(ticker) {
  if (!ticker) return false;
  const base = ticker.toUpperCase().replace(/\.(MI|DE|AS|PA|SW|L|BR|MA)$/i, "");
  return KNOWN_ETFS.has(base);
}

/**
 * Ritorna il ticker base senza suffisso di mercato.
 */
export function baseTicker(ticker) {
  return ticker.toUpperCase().replace(/\.(MI|DE|AS|PA|SW|L|BR|MA)$/i, "");
}
