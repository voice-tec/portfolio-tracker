// ─── DATE UTILS ───────────────────────────────────────────────────────────────

/**
 * Parsa una data nei formati:
 *   "dd/mm/yy", "dd/mm/yyyy", "YYYY-MM-DD"
 * @returns {Date|null}
 */
export function parseBuyDate(s) {
  if (!s) return null;
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T12:00:00");
  // dd/mm/yy or dd/mm/yyyy
  const p = s.split("/");
  if (p.length === 3) {
    const yr = p[2].length === 2 ? "20" + p[2] : p[2];
    const d = new Date(`${yr}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}T12:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Converte YYYY-MM-DD → dd/mm/yy
 */
export function isoToDisplay(iso) {
  if (!iso) return "";
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  return `${p[2]}/${p[1]}/${p[0].slice(2)}`;
}

/**
 * Converte dd/mm/yy → YYYY-MM-DD (per input type=date)
 */
export function displayToISO(s) {
  if (!s) return new Date().toISOString().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const p = s.split("/");
  if (p.length === 3) {
    const yr = p[2].length === 2 ? "20" + p[2] : p[2];
    return `${yr}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;
  }
  return new Date().toISOString().split("T")[0];
}
