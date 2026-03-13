import { useState, useMemo } from "react";
import { PieChart, Pie, Cell } from "recharts";
import { useETFHoldings } from "../hooks/useETFHoldings";
import { toUSD } from "../utils/currency";
import { isKnownETF } from "../utils/etf";
import { fmt } from "../utils/format";

// ─── COLORI FISSI PER SETTORE ─────────────────────────────────────────────────
const SECTOR_COLOR_MAP = {
  "Tech":        "#5B8DEF",
  "Finanza":     "#F4C542",
  "Consumer":    "#E87040",
  "Industriali": "#5EC98A",
  "Salute":      "#BF6EEA",
  "Telecom":     "#26C6DA",
  "Beni primari":"#F06292",
  "Energia":     "#FF7043",
  "Materiali":   "#A5D6A7",
  "Utility":     "#CE93D8",
  "Real Estate": "#80DEEA",
  "ETF":         "#26C6DA",
  "Crypto":      "#FFD54F",
  "Altro":       "#555",
};
const FALLBACK_COLORS = ["#5B8DEF","#F4C542","#E87040","#5EC98A","#BF6EEA","#26C6DA","#F06292","#FF7043"];

function getPieColor(name, idx) {
  return SECTOR_COLOR_MAP[name] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

// ─── ALERT SUGGERIMENTI ───────────────────────────────────────────────────────
const TIPS = {
  "Tech":       ["Bilancia con XLV (Salute) o XLP (Beni primari)", "Aggiungi esposizione internazionale con VEA", "Considera obbligazioni TLT per ridurre volatilità"],
  "Finanza":    ["Bilancia con settori difensivi come XLU o XLV", "Considera esposizione internazionale VWO", "I tassi alti favoriscono le banche ma aumentano il rischio"],
  "Energia":    ["Diversifica con XLK (Tech) o XLV (Salute)", "Alta ciclicità: considera XLP come difensivo", "GLD può bilanciare il rischio commodity"],
  "Real Estate":["REIT sensibili ai tassi: diversifica con Tech", "Aggiungi bond a breve SHY come bilanciamento", "Considera settori meno correlati ai tassi"],
};
const DEFAULT_TIPS = ["Diversifica su altri settori", "Considera ETF globali come VTI o VEA", "Valuta obbligazioni per ridurre volatilità"];

// ─── COMPONENTE ───────────────────────────────────────────────────────────────
export function AllocationCard({ stocks, eurRate }) {
  const [tab, setTab] = useState("settori");
  const [activeIdx, setActiveIdx] = useState(null);
  const [showAlerts, setShowAlerts] = useState(true);

  const { holdings, loading: etfLoading } = useETFHoldings(stocks);

  // ── totalValue sempre in USD ───────────────────────────────────────────────
  const totalValue = useMemo(
    () => stocks.reduce((s, x) => s + x.qty * toUSD(x.currentPrice, x.currency, eurRate), 0),
    [stocks, eurRate]
  );

  // ── pieData: valori sempre in USD ─────────────────────────────────────────
  const pieData = useMemo(() => {
    const map = {};

    stocks.forEach(s => {
      // Valore posizione in USD
      const posVal = s.qty * toUSD(s.currentPrice, s.currency, eurRate);

      const etfData = holdings[s.ticker];
      const hasSectorWeights = etfData?.sectorWeights?.length > 0;
      const isETF = s.sector === "ETF" || isKnownETF(s.ticker);

      if (tab === "settori") {
        if (isETF && hasSectorWeights) {
          // Scomponi ETF per settore usando i pesi reali
          etfData.sectorWeights.forEach(sw => {
            const key = sw.sector || "Altro";
            map[key] = (map[key] || 0) + posVal * (sw.weight / 100);
          });
        } else {
          const key = (s.sector && s.sector !== "-" && s.sector !== "—") ? s.sector : "Altro";
          map[key] = (map[key] || 0) + posVal;
        }
      } else if (tab === "posizioni") {
        map[s.ticker] = (map[s.ticker] || 0) + posVal;
      } else if (tab === "tipo") {
        const tipo = (s.sector === "ETF" || isKnownETF(s.ticker)) ? "ETF" : s.sector === "Crypto" ? "Crypto" : "Azioni";
        map[tipo] = (map[tipo] || 0) + posVal;
      }
    });

    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [stocks, tab, holdings, eurRate]);

  // ── alert concentrazione >25% ─────────────────────────────────────────────
  const alerts = useMemo(() => {
    if (tab !== "settori" || totalValue === 0) return [];
    return pieData
      .filter(item => (item.value / totalValue) * 100 > 25)
      .map(item => ({
        sector: item.name,
        pct: ((item.value / totalValue) * 100).toFixed(1),
        tips: TIPS[item.name] || DEFAULT_TIPS,
      }));
  }, [pieData, totalValue, tab]);

  const etfStocksCount = stocks.filter(s => s.sector === "ETF").length;
  const centerItem = activeIdx !== null ? pieData[activeIdx] : null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, borderBottom: "1px solid #1a1d26", paddingBottom: 0 }}>
        <div style={{ display: "flex", gap: 0 }}>
          {["settori", "posizioni", "tipo"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: "none", border: "none",
              borderBottom: tab === t ? "2px solid #F4C542" : "2px solid transparent",
              color: tab === t ? "#E8E6DF" : "#444",
              fontFamily: "inherit", fontSize: 11, padding: "6px 12px",
              cursor: "pointer", textTransform: "capitalize",
              transition: "all 0.15s", marginBottom: -1,
            }}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {etfLoading && <span style={{ fontSize: 9, color: "#444" }}>caricamento ETF…</span>}
          {!etfLoading && etfStocksCount > 0 && tab === "settori" && (
            <span style={{ fontSize: 9, color: "#5EC98A" }}>✓ ETF scomposti</span>
          )}
          {alerts.length > 0 && (
            <button onClick={() => setShowAlerts(v => !v)} style={{
              background: "#E8704011", border: "1px solid #E8704033",
              color: "#E87040", fontSize: 9, padding: "3px 8px",
              borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
            }}>
              ⚠️ {alerts.length} concentrazione{alerts.length > 1 ? "i" : ""} &gt;25%
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Torta */}
        <div style={{ position: "relative", width: 200, height: 200, flexShrink: 0 }}>
          <PieChart width={200} height={200}>
            <Pie
              data={pieData} cx={100} cy={100}
              innerRadius={62} outerRadius={90}
              dataKey="value" paddingAngle={1.5}
              onMouseEnter={(_, i) => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={getPieColor(entry.name, i)}
                  opacity={activeIdx === null || activeIdx === i ? 1 : 0.3}
                  style={{ cursor: "pointer" }} />
              ))}
            </Pie>
          </PieChart>
          {/* Centro torta */}
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none", width: 100 }}>
            {centerItem ? (
              <>
                <div style={{ fontSize: 10, color: "#8A9AB0", lineHeight: 1.2, marginBottom: 2 }}>{centerItem.name}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0A1628", letterSpacing: "-0.5px" }}>${fmt(centerItem.value)}</div>
                <div style={{ fontSize: 13, color: "#F4C542", fontWeight: 600, marginTop: 1 }}>
                  {totalValue > 0 ? ((centerItem.value / totalValue) * 100).toFixed(1) : 0}%
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 3 }}>Patrimonio</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0A1628", letterSpacing: "-0.5px" }}>${fmt(totalValue)}</div>
                <div style={{ fontSize: 11, color: "#5A6A7E", marginTop: 2 }}>€{fmt(totalValue * eurRate)}</div>
              </>
            )}
          </div>
        </div>

        {/* Legenda */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 160 }}>
          {pieData.map((item, i) => {
            const pct = totalValue > 0 ? ((item.value / totalValue) * 100).toFixed(1) : "0.0";
            const isAlert = parseFloat(pct) > 25;
            const isActive = activeIdx === i;
            return (
              <div key={item.name}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
                style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", opacity: activeIdx === null || isActive ? 1 : 0.35, transition: "opacity 0.15s" }}
              >
                <div style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: getPieColor(item.name, i) }} />
                <span style={{ fontSize: 11, color: isActive ? "#E8E6DF" : "#777", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
                <span style={{ fontSize: 11, fontWeight: 600, minWidth: 36, textAlign: "right", color: isAlert ? "#E87040" : "#E8E6DF" }}>{pct}%</span>
                {isAlert && <span style={{ fontSize: 9, color: "#E87040" }}>⚠️</span>}
                <span style={{ fontSize: 10, color: "#444", minWidth: 60, textAlign: "right" }}>${fmt(item.value)}</span>
              </div>
            );
          })}
        </div>

        {/* Panel alert */}
        {alerts.length > 0 && showAlerts && (
          <div style={{ flex: 1, minWidth: 200, maxWidth: 280, background: "#0f1117", borderRadius: 8, border: "1px solid #E8704033", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#E87040", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>⚠️ Concentrazione elevata</div>
              <button onClick={() => setShowAlerts(false)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
            </div>
            {alerts.map(a => (
              <div key={a.sector} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#E8E6DF", fontWeight: 500 }}>{a.sector}</span>
                  <span style={{ fontSize: 12, color: "#E87040", fontWeight: 700 }}>{a.pct}%</span>
                </div>
                <div style={{ height: 4, background: "#1a1d26", borderRadius: 2, marginBottom: 8, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(parseFloat(a.pct), 100)}%`, background: parseFloat(a.pct) > 50 ? "#E87040" : "#F4C542", borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 9, color: "#444", marginBottom: 6 }}>Suggerimenti:</div>
                {a.tips.map((tip, j) => (
                  <div key={j} style={{ fontSize: 10, color: "#666", marginBottom: 4, paddingLeft: 8, borderLeft: "2px solid #2a2d35", lineHeight: 1.4 }}>{tip}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
