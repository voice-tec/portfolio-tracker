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

// ─── ALERT SUGGERIMENTI (label + dettaglio espandibile) ───────────────────────
const TIPS = {
  "Tech": [
    { label: "Bilancia con XLV o XLP", detail: "XLV (Salute) e XLP (Beni primari) sono settori difensivi che reagiscono meglio nei momenti di ribasso tech." },
    { label: "Esposizione internazionale con VEA", detail: "VEA diversifica su Europa, Asia e mercati sviluppati, riducendo la dipendenza dalle mega-cap USA." },
    { label: "Obbligazioni TLT per ridurre volatilità", detail: "I Treasury a lungo termine tendono a salire quando il tech scende, offrendo un bilanciamento naturale." },
  ],
  "Finanza": [
    { label: "Settori difensivi XLU o XLV", detail: "Utility e Salute hanno bassa correlazione col settore finanziario e reggono meglio in fasi di stress bancario." },
    { label: "Esposizione emergenti con VWO", detail: "Diversifica su mercati emergenti che hanno cicli diversi rispetto alle banche occidentali." },
    { label: "Attenzione ai tassi d'interesse", detail: "I titoli finanziari beneficiano dei tassi alti ma soffrono in caso di inversione rapida." },
  ],
  "Energia": [
    { label: "Diversifica con XLK o XLV", detail: "Tech e Salute hanno bassa correlazione con l'energia e riducono l'esposizione al ciclo delle commodity." },
    { label: "XLP come cuscinetto difensivo", detail: "I beni primari (cibo, igiene) mantengono valore nei periodi di contrazione economica." },
    { label: "GLD per bilanciare il rischio commodity", detail: "L'oro ha correlazione parziale con l'energia ma agisce da riserva di valore in scenari estremi." },
  ],
  "Real Estate": [
    { label: "REIT sensibili ai tassi: diversifica con Tech", detail: "Quando i tassi salgono i REIT soffrono; il tech (specialmente software) è meno dipendente dal costo del debito." },
    { label: "Bond a breve SHY come bilanciamento", detail: "I Treasury a breve scadenza offrono rendimento senza il rischio duration legato ai tassi." },
    { label: "Settori meno correlati ai tassi", detail: "Consumer discretionary o healthcare hanno driver di crescita indipendenti dalla politica monetaria." },
  ],
};
const DEFAULT_TIPS = [
  { label: "Diversifica su altri settori", detail: "Distribuire il capitale su 5-8 settori riduce il rischio specifico senza sacrificare il rendimento atteso." },
  { label: "ETF globali come VTI o VEA", detail: "VTI copre l'intero mercato USA, VEA i mercati sviluppati internazionali: insieme offrono esposizione globale." },
  { label: "Obbligazioni per ridurre volatilità", detail: "Un'allocazione del 10-20% in bond riduce la volatilità complessiva del portafoglio nelle fasi di ribasso." },
];

// ─── TIP PILL INTERATTIVA ─────────────────────────────────────────────────────
function TipItem({ tip }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen(v => !v)}
      style={{
        borderRadius: 6,
        background: open ? "rgba(220,38,38,0.14)" : "rgba(220,38,38,0.06)",
        border: `1px solid ${open ? "rgba(220,38,38,0.35)" : "rgba(220,38,38,0.14)"}`,
        padding: "8px 10px",
        cursor: "pointer",
        transition: "all 0.18s",
        marginBottom: 6,
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#FECACA", fontWeight: 500, lineHeight: 1.3 }}>
          {tip.label}
        </span>
        <span style={{
          fontSize: 10, color: "rgba(254,202,202,0.45)", flexShrink: 0,
          display: "inline-block", transition: "transform 0.18s",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
        }}>▾</span>
      </div>
      {open && (
        <div style={{
          marginTop: 7, fontSize: 10, color: "rgba(254,202,202,0.65)",
          lineHeight: 1.6, borderTop: "1px solid rgba(220,38,38,0.18)",
          paddingTop: 7,
        }}>
          {tip.detail}
        </div>
      )}
    </div>
  );
}

// ─── PANNELLO ALERT ───────────────────────────────────────────────────────────
function AlertPanel({ alerts, onClose }) {
  return (
    <div style={{
      flex: 1, minWidth: 230, maxWidth: 320,
      background: "rgba(127,29,29,0.20)",
      border: "1px solid rgba(220,38,38,0.28)",
      borderRadius: 10,
      padding: "14px 16px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 15 }}>⚠️</span>
          <span style={{ fontSize: 10, color: "#FCA5A5", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
            Concentrazione elevata
          </span>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none",
          color: "rgba(252,165,165,0.35)", cursor: "pointer",
          fontSize: 15, padding: 0, lineHeight: 1,
        }}>✕</button>
      </div>

      {alerts.map(a => {
        const pct = parseFloat(a.pct);
        const barColor = pct > 50 ? "#EF4444" : pct > 35 ? "#F97316" : "#FBBF24";
        return (
          <div key={a.sector} style={{ marginBottom: 16 }}>
            {/* Nome + % */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
              <span style={{ fontSize: 13, color: "#FECACA", fontWeight: 600 }}>{a.sector}</span>
              <span style={{ fontSize: 16, color: barColor, fontWeight: 700 }}>{a.pct}%</span>
            </div>

            {/* Barra */}
            <div style={{ height: 6, background: "rgba(220,38,38,0.15)", borderRadius: 3, marginBottom: 12, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min(pct, 100)}%`,
                background: `linear-gradient(90deg, ${barColor}88, ${barColor})`,
                borderRadius: 3,
              }} />
            </div>

            {/* Etichetta */}
            <div style={{ fontSize: 9, color: "rgba(252,165,165,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Suggerimenti — tocca per espandere
            </div>

            {/* Tips interattive */}
            {a.tips.map((tip, j) => (
              <TipItem key={j} tip={tip} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── COMPONENTE PRINCIPALE ────────────────────────────────────────────────────
export function AllocationCard({ stocks, eurRate }) {
  const [tab, setTab] = useState("settori");
  const [activeIdx, setActiveIdx] = useState(null);
  const [showAlerts, setShowAlerts] = useState(true);

  const { holdings, loading: etfLoading } = useETFHoldings(stocks);

  const totalValue = useMemo(
    () => stocks.reduce((s, x) => s + x.qty * toUSD(x.currentPrice, x.currency, eurRate), 0),
    [stocks, eurRate]
  );

  const pieData = useMemo(() => {
    const map = {};
    stocks.forEach(s => {
      const posVal = s.qty * toUSD(s.currentPrice, s.currency, eurRate);
      const etfData = holdings[s.ticker];
      const hasSectorWeights = etfData?.sectorWeights?.length > 0;
      const isETF = s.sector === "ETF" || isKnownETF(s.ticker);

      if (tab === "settori") {
        if (isETF && hasSectorWeights) {
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
                <div style={{ fontSize: 16, fontWeight: 700, color: "#E8E6DF", letterSpacing: "-0.5px" }}>${fmt(centerItem.value)}</div>
                <div style={{ fontSize: 13, color: "#F4C542", fontWeight: 600, marginTop: 1 }}>
                  {totalValue > 0 ? ((centerItem.value / totalValue) * 100).toFixed(1) : 0}%
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 3 }}>Patrimonio</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#E8E6DF", letterSpacing: "-0.5px" }}>${fmt(totalValue)}</div>
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
          <AlertPanel alerts={alerts} onClose={() => setShowAlerts(false)} />
        )}
      </div>
    </div>
  );
}
