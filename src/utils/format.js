// ─── FORMAT UTILS ─────────────────────────────────────────────────────────────

export const fmt = (n, dec = 2) =>
  Math.abs(Number(n)).toLocaleString("it-IT", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

export const fmtPct = (n) =>
  `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%`;

export const fmtCompact = (n) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return fmt(n);
};
