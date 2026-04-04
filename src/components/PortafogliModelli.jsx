import { useState, useMemo } from "react";

// ── Dati portafogli ───────────────────────────────────────────────────────────
const PORTFOLIOS = [
  {
    id: "p6040",
    name: "60/40 Classico",
    author: "Portafoglio istituzionale",
    category: "classici",
    color: "#185FA5",
    bg: "#E6F1FB",
    risk: "Moderato",
    riskLevel: 2,
    ytd: +8.2,
    threeY: +18.4,
    vol: "10.2%",
    sharpe: "0.92",
    desc: "Il portafoglio standard per investitori istituzionali. Bilanciamento tra crescita e stabilità.",
    longDesc: "Il portafoglio 60/40 è la strategia più utilizzata da fondi pensione e investitori istituzionali di tutto il mondo. Il 60% in azioni mondiali cattura la crescita dei mercati, mentre il 40% in obbligazioni riduce la volatilità e fornisce un cuscinetto nelle fasi di ribasso. Semplice da mantenere, richiede ribilanciamento annuale.",
    etfs: [
      { ticker: "VWCE", name: "Vanguard FTSE All-World UCITS ETF", pct: 60, color: "#185FA5" },
      { ticker: "AGGH", name: "iShares Core Glb Aggregate Bond UCITS ETF", pct: 25, color: "#378ADD" },
      { ticker: "IBCI", name: "iShares € Inflation Linked Govt Bond UCITS ETF", pct: 15, color: "#85B7EB" },
    ],
  },
  {
    id: "allweather",
    name: "All Weather",
    author: "Ray Dalio — Bridgewater",
    category: "classici",
    color: "#854F0B",
    bg: "#FAEEDA",
    risk: "Basso",
    riskLevel: 1,
    ytd: +5.1,
    threeY: +12.8,
    vol: "7.1%",
    sharpe: "0.78",
    desc: "Funziona in qualsiasi scenario macro: crescita, recessione, inflazione, deflazione.",
    longDesc: "Ray Dalio ha progettato questo portafoglio per funzionare bene in ogni contesto economico. Le quattro stagioni dell'economia (crescita, contrazione, inflazione, deflazione) sono coperte da asset che si comportano bene in ognuna. Il risultato è un portafoglio con drawdown storici molto contenuti.",
    etfs: [
      { ticker: "VWCE", name: "Vanguard FTSE All-World UCITS ETF", pct: 30, color: "#BA7517" },
      { ticker: "IBTM", name: "iShares $ Treasury Bond 20+yr UCITS ETF", pct: 40, color: "#EF9F27" },
      { ticker: "VGOV", name: "Vanguard UK Government Bond UCITS ETF", pct: 15, color: "#FAC775" },
      { ticker: "SGLD", name: "Invesco Physical Gold ETC", pct: 7.5, color: "#F4C542" },
      { ticker: "ACOM", name: "iShares Diversified Commodity Swap UCITS ETF", pct: 7.5, color: "#D3D1C7" },
    ],
  },
  {
    id: "permanent",
    name: "Permanent Portfolio",
    author: "Harry Browne",
    category: "classici",
    color: "#0F6E56",
    bg: "#E1F5EE",
    risk: "Molto basso",
    riskLevel: 1,
    ytd: +4.3,
    threeY: +11.2,
    vol: "5.8%",
    sharpe: "0.71",
    desc: "25% in quattro asset non correlati. Semplicità estrema, resilienza massima.",
    longDesc: "Harry Browne ha sviluppato il Permanent Portfolio negli anni '80 con un principio semplice: nessuno sa cosa succederà, quindi prepariamoci a tutto. Quattro asset uguali, ciascuno che brilla in uno scenario diverso. Ribilanciamento solo quando un asset supera il 35% o scende sotto il 15%.",
    etfs: [
      { ticker: "VWCE", name: "Vanguard FTSE All-World UCITS ETF", pct: 25, color: "#1D9E75" },
      { ticker: "SGLD", name: "Invesco Physical Gold ETC", pct: 25, color: "#F4C542" },
      { ticker: "IBTM", name: "iShares $ Treasury Bond 20+yr UCITS ETF", pct: 25, color: "#5DCAA5" },
      { ticker: "XEON", name: "Xtrackers EUR Overnight Rate Swap UCITS ETF", pct: 25, color: "#9FE1CB" },
    ],
  },
  {
    id: "famafrench",
    name: "Fama-French Value",
    author: "Eugene Fama & Kenneth French",
    category: "factor",
    color: "#534AB7",
    bg: "#EEEDFE",
    risk: "Alto",
    riskLevel: 4,
    ytd: +11.4,
    threeY: +28.7,
    vol: "16.3%",
    sharpe: "1.12",
    desc: "Sovrappeso su small cap e value. Premia il rischio aggiuntivo con rendimenti storicamente superiori.",
    longDesc: "Il modello Fama-French dimostra che i titoli value (basso P/B) e small cap tendono a sovraperformare il mercato nel lungo periodo. Questo portafoglio implementa questi fattori con ETF UCITS, accettando maggiore volatilità in cambio di rendimenti attesi superiori su orizzonti di 10+ anni.",
    etfs: [
      { ticker: "ZPRV", name: "SPDR MSCI USA Small Cap Value Weighted UCITS ETF", pct: 40, color: "#534AB7" },
      { ticker: "ZPRX", name: "SPDR MSCI Europe Small Cap Value Weighted UCITS ETF", pct: 20, color: "#7F77DD" },
      { ticker: "IWVL", name: "iShares Edge MSCI World Value Factor UCITS ETF", pct: 30, color: "#AFA9EC" },
      { ticker: "AGGH", name: "iShares Core Glb Aggregate Bond UCITS ETF", pct: 10, color: "#CECBF6" },
    ],
  },
  {
    id: "momentum",
    name: "Momentum Settoriale",
    author: "Strategia quantitativa",
    category: "factor",
    color: "#993C1D",
    bg: "#FAECE7",
    risk: "Molto alto",
    riskLevel: 5,
    ytd: +14.8,
    threeY: +41.2,
    vol: "22.1%",
    sharpe: "1.04",
    desc: "Investe nei 3 settori con il miglior trend degli ultimi 12 mesi. Ribilanciamento mensile.",
    longDesc: "La strategia momentum settoriale ruota ogni mese verso i settori con la migliore performance a 12 mesi. Storicamente ha battuto il mercato ma con alta volatilità e drawdown significativi. Richiede disciplina nel ribilanciamento e maggiori costi di transazione. Adatta solo a orizzonti lunghi (10+ anni).",
    etfs: [
      { ticker: "Variabile", name: "ETF settore top 1 (cambia ogni mese)", pct: 33, color: "#D85A30" },
      { ticker: "Variabile", name: "ETF settore top 2 (cambia ogni mese)", pct: 33, color: "#F0997B" },
      { ticker: "Variabile", name: "ETF settore top 3 (cambia ogni mese)", pct: 34, color: "#F5C4B3" },
    ],
  },
  {
    id: "lazy3",
    name: "Lazy 3 ETF",
    author: "John Bogle — Vanguard",
    category: "lazy",
    color: "#3B6D11",
    bg: "#EAF3DE",
    risk: "Moderato",
    riskLevel: 2,
    ytd: +9.1,
    threeY: +22.3,
    vol: "11.4%",
    sharpe: "0.98",
    desc: "Tre ETF, zero stress. Il portafoglio passivo per eccellenza.",
    longDesc: "John Bogle, fondatore di Vanguard, ha rivoluzionato gli investimenti con un concetto semplice: battere il mercato è difficile, replicarlo è facile e conveniente. Il Lazy Portfolio con 3 ETF offre diversificazione globale totale con costi minimi e manutenzione quasi zero. Ribilanciamento annuale sufficiente.",
    etfs: [
      { ticker: "VWCE", name: "Vanguard FTSE All-World UCITS ETF", pct: 40, color: "#639922" },
      { ticker: "IUSQ", name: "iShares MSCI ACWI UCITS ETF", pct: 30, color: "#97C459" },
      { ticker: "AGGH", name: "iShares Core Glb Aggregate Bond UCITS ETF", pct: 30, color: "#C0DD97" },
    ],
  },
];

const CATEGORIES = [
  { id: "tutti", label: "Tutti" },
  { id: "classici", label: "Classici" },
  { id: "factor", label: "Factor" },
  { id: "lazy", label: "Lazy" },
];


// ── Mappa settori → asset class per confronto ─────────────────────────────────
const SECTOR_TO_CLASS = {
  "Tech": "azionario", "Tecnologia": "azionario", "Finanza": "azionario",
  "Salute": "azionario", "Energia": "azionario", "Consumer": "azionario",
  "Industriali": "azionario", "Materiali": "azionario", "Utility": "azionario",
  "Telecom": "azionario", "Real Estate": "azionario", "Altro": "azionario",
  "ETF": "azionario",
};

// Calcola somiglianza portafoglio utente con ogni modello (0-100)
function calcSimilarity(stocks, portfolio) {
  if (!stocks || stocks.length === 0) return 0;
  const totalVal = stocks.reduce((s, x) => s + (parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0), 0);
  if (totalVal === 0) return 0;

  // Calcola % azionario utente
  const equityPct = stocks.reduce((s, x) => {
    const w = ((parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0)) / totalVal * 100;
    return s + w;
  }, 0);

  // % azionario target del modello
  const modelEquityPct = portfolio.etfs.reduce((s, e) => {
    const isEquity = !["AGGH","IBCI","IBTM","VGOV","XEON","BND","TLT","IEF"].includes(e.ticker);
    return s + (isEquity ? e.pct : 0);
  }, 0);

  // Distanza dal target (più vicino = più simile)
  const dist = Math.abs(equityPct - modelEquityPct);
  return Math.max(0, Math.round(100 - dist * 1.5));
}

const col = v => v >= 0 ? "#16A34A" : "#DC2626";
const sign = v => v >= 0 ? "+" : "";

function RiskDots({ level }) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[1,2,3,4,5].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: i <= level ? "#0A1628" : "#E0E4EF",
        }} />
      ))}
    </div>
  );
}

function AllocationBar({ etfs }) {
  return (
    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1 }}>
      {etfs.map((e, i) => (
        <div key={i} style={{ width: `${e.pct}%`, background: e.color }} />
      ))}
    </div>
  );
}

function PortfolioCard({ p, onClick }) {
  return (
    <div onClick={() => onClick(p)} style={{
      background: "#fff", border: "0.5px solid #E8EBF4",
      borderRadius: 12, padding: "16px 18px", cursor: "pointer",
      transition: "border-color 0.15s, box-shadow 0.15s",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#C0C8D8"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#E8EBF4"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ flex: 1, marginRight: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0A1628", marginBottom: 2 }}>{p.name}</div>
          <div style={{ fontSize: 10, color: "#8A9AB0" }}>{p.author}</div>
        </div>
        <span style={{
          fontSize: 10, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap",
          background: p.bg, color: p.color, fontWeight: 600,
        }}>{p.risk}</span>
      </div>

      <AllocationBar etfs={p.etfs} />

      <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
        {p.etfs.map((e, i) => (
          <span key={i} style={{ fontSize: 9, color: "#8A9AB0", display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: 1, background: e.color, display: "inline-block" }} />
            {e.ticker} {e.pct}%
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 14 }}>
        {[
          { l: "YTD", v: `${sign(p.ytd)}${p.ytd.toFixed(1)}%`, c: col(p.ytd) },
          { l: "3 anni", v: `${sign(p.threeY)}${p.threeY.toFixed(1)}%`, c: "#0A1628" },
          { l: "Volatilità", v: p.vol, c: "#0A1628" },
        ].map(k => (
          <div key={k.l} style={{ background: "#F8FAFF", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 3 }}>{k.l}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "#8A9AB0", lineHeight: 1.5, borderTop: "1px solid #F0F2F7", paddingTop: 10 }}>
        {p.desc}
      </div>
    </div>
  );
}

function PortfolioDetail({ p, onClose }) {
  return (
    <div className="card" style={{ marginTop: 20, padding: "20px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0A1628", marginBottom: 2 }}>{p.name}</div>
          <div style={{ fontSize: 11, color: "#8A9AB0" }}>{p.author}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#8A9AB0", lineHeight: 1 }}>×</button>
      </div>

      <div style={{ background: "#F8FAFF", borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 12, color: "#4A5568", lineHeight: 1.7 }}>
        {p.longDesc}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 18 }}>
        {[
          { l: "YTD", v: `${sign(p.ytd)}${p.ytd.toFixed(1)}%`, c: col(p.ytd) },
          { l: "3 anni", v: `${sign(p.threeY)}${p.threeY.toFixed(1)}%`, c: "#0A1628" },
          { l: "Volatilità", v: p.vol, c: "#0A1628" },
          { l: "Sharpe ratio", v: p.sharpe, c: "#0A1628" },
        ].map(k => (
          <div key={k.l} style={{ background: "#F8FAFF", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 5 }}>{k.l}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.08em" }}>Rischio</div>
        <RiskDots level={p.riskLevel} />
        <div style={{ fontSize: 11, color: "#8A9AB0" }}>{p.risk}</div>
      </div>

      <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, marginTop: 16 }}>
        Allocazione con ETF UCITS disponibili in Italia
      </div>

      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 14 }}>
        {p.etfs.map((e, i) => (
          <div key={i} style={{ width: `${e.pct}%`, background: e.color }} />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {p.etfs.map((e, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "10px 60px 1fr 60px", gap: 10, alignItems: "center" }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: e.color }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: "#0A1628" }}>{e.ticker}</div>
            <div style={{ fontSize: 11, color: "#8A9AB0" }}>{e.name}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0A1628", textAlign: "right" }}>{e.pct}%</div>
          </div>
        ))}
      </div>

      <div style={{ padding: "10px 14px", background: "#FFF8EC", borderRadius: 8, fontSize: 11, color: "#854F0B", lineHeight: 1.6 }}>
        Queste sono allocazioni indicative. Prima di investire verifica la disponibilità degli ETF sul tuo broker e valuta la fiscalità applicabile in Italia (ritenuta 26% su plusvalenze).
      </div>
    </div>
  );
}


// ── Gap Analysis ──────────────────────────────────────────────────────────────
function GapAnalysis({ stocks }) {
  const [selectedModel, setSelectedModel] = useState(null);

  const totalVal = useMemo(() =>
    stocks.reduce((s, x) => s + (parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0), 0),
    [stocks]
  );

  const similarities = useMemo(() =>
    PORTFOLIOS.map(p => ({ ...p, score: calcSimilarity(stocks, p) }))
      .sort((a, b) => b.score - a.score),
    [stocks]
  );

  const best = similarities[0];

  // Calcola % azionario utente
  const equityPct = totalVal > 0
    ? Math.round(stocks.reduce((s, x) => {
        return s + ((parseFloat(x.qty)||0) * (parseFloat(x.currentPrice)||0)) / totalVal * 100;
      }, 0))
    : 0;

  if (stocks.length === 0) return null;

  const model = selectedModel || best;
  const modelEquityPct = model.etfs.reduce((s, e) => {
    const isEquity = !["AGGH","IBCI","IBTM","VGOV","XEON","BND","TLT","IEF"].includes(e.ticker);
    return s + (isEquity ? e.pct : 0);
  }, 0);
  const modelBondPct = 100 - modelEquityPct;
  const userBondPct = 100 - equityPct;
  const diff = equityPct - modelEquityPct;

  return (
    <div className="card" style={{ marginTop: 32, padding: "20px 22px" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>Il tuo portafoglio vs i modelli</div>
      <div style={{ fontSize: 11, color: "#8A9AB0", marginBottom: 20 }}>
        Quanto assomiglia il tuo portafoglio a ciascuna strategia?
      </div>

      {/* Barre somiglianza */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {similarities.map(p => (
          <div key={p.id} onClick={() => setSelectedModel(p)}
            style={{ display: "grid", gridTemplateColumns: "140px 1fr 40px", gap: 12, alignItems: "center", cursor: "pointer", padding: "6px 8px", borderRadius: 8,
              background: (selectedModel?.id || best.id) === p.id ? "#F8FAFF" : "transparent" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#0A1628", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
            <div style={{ height: 6, background: "#F0F2F7", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${p.score}%`, background: p.score >= 70 ? "#16A34A" : p.score >= 40 ? "#F4A020" : "#DC2626", borderRadius: 3, transition: "width 0.5s" }} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: p.score >= 70 ? "#16A34A" : p.score >= 40 ? "#F4A020" : "#8A9AB0", textAlign: "right" }}>{p.score}%</div>
          </div>
        ))}
      </div>

      {/* Dettaglio modello selezionato */}
      <div style={{ borderTop: "1px solid #F0F2F7", paddingTop: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#0A1628", marginBottom: 12 }}>
          Confronto con: <span style={{ color: model.color }}>{model.name}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {/* Tuo portafoglio */}
          <div>
            <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Il tuo portafoglio</div>
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ width: `${equityPct}%`, background: "#0A1628" }} />
              <div style={{ width: `${userBondPct}%`, background: "#E0E4EF" }} />
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#8A9AB0" }}>
              <span><span style={{ color: "#0A1628", fontWeight: 700 }}>{equityPct}%</span> azionario</span>
              <span><span style={{ color: "#8A9AB0", fontWeight: 700 }}>{userBondPct}%</span> altro</span>
            </div>
          </div>
          {/* Modello */}
          <div>
            <div style={{ fontSize: 10, color: "#8A9AB0", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>{model.name}</div>
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ width: `${modelEquityPct}%`, background: model.color }} />
              <div style={{ width: `${modelBondPct}%`, background: "#E0E4EF" }} />
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#8A9AB0" }}>
              <span><span style={{ color: model.color, fontWeight: 700 }}>{Math.round(modelEquityPct)}%</span> azionario</span>
              <span><span style={{ color: "#8A9AB0", fontWeight: 700 }}>{Math.round(modelBondPct)}%</span> altro</span>
            </div>
          </div>
        </div>

        {/* Suggerimento */}
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 11, lineHeight: 1.6,
          background: Math.abs(diff) < 10 ? "#ECFDF5" : "#FFF8EC",
          color: Math.abs(diff) < 10 ? "#0F6E56" : "#854F0B" }}>
          {Math.abs(diff) < 10
            ? `Il tuo portafoglio è già molto vicino al ${model.name}. Mantieni l'allocazione attuale.`
            : diff > 0
              ? `Hai il ${diff}% in più di azionario rispetto al ${model.name}. Per avvicinarti, considera di aggiungere bond come AGGH o IBTM.`
              : `Hai il ${Math.abs(diff)}% in meno di azionario rispetto al ${model.name}. Per avvicinarti, considera di aumentare l'esposizione azionaria con VWCE.`
          }
        </div>
      </div>
    </div>
  );
}

export function PortafogliModelli({ stocks = [] }) {
  const [activeCategory, setActiveCategory] = useState("tutti");
  const [selected, setSelected] = useState(null);

  const filtered = activeCategory === "tutti"
    ? PORTFOLIOS
    : PORTFOLIOS.filter(p => p.category === activeCategory);

  return (
    <div className="fade-up" style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 40px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.01em" }}>Portafogli Modello</div>
        <div style={{ fontSize: 12, color: "#8A9AB0", marginTop: 4 }}>
          Strategie famose replicabili con ETF UCITS disponibili in Italia. Aggiornate con prezzi live.
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
        {CATEGORIES.map(cat => (
          <button key={cat.id} onClick={() => { setActiveCategory(cat.id); setSelected(null); }}
            style={{
              padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 12, fontWeight: 600, transition: "all 0.15s",
              background: activeCategory === cat.id ? "#0A1628" : "#F0F2F7",
              color: activeCategory === cat.id ? "#fff" : "#8A9AB0",
            }}>
            {cat.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {filtered.map(p => (
          <PortfolioCard key={p.id} p={p} onClick={setSelected} />
        ))}
      </div>

      {selected && (
        <PortfolioDetail p={selected} onClose={() => setSelected(null)} />
      )}

      <GapAnalysis stocks={stocks} />
    </div>
  );
}
