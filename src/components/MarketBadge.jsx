// ─── MARKET BADGE ─────────────────────────────────────────────────────────────
const CFG = {
  PRE:      { label: "PRE",   bg: "#1a1f2a", color: "#7EB8F7" },
  REGULAR:  { label: "LIVE",  bg: "#1a2a1a", color: "#5EC98A" },
  POST:     { label: "AFTER", bg: "#2a1f0a", color: "#F4C542" },
  POSTPOST: { label: "AFTER", bg: "#2a1f0a", color: "#F4C542" },
  CLOSED:   { label: "CHIUS", bg: "#2a1a1a", color: "#E87040" },
};

export function MarketBadge({ state = "CLOSED", size = 8, ml = 0 }) {
  const c = CFG[state] || CFG.CLOSED;
  return (
    <span style={{
      fontSize: size, background: c.bg, color: c.color,
      padding: "2px 6px", borderRadius: 2, marginLeft: ml,
      fontFamily: "inherit",
    }}>
      {c.label}
    </span>
  );
}
