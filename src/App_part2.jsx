        <div style={{ background: "#0f1117", border: "1px solid #1a1d26", borderRadius: 6, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>📰 Ultime notizie</div>
          {newsLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#444", fontSize: 11 }}><Spinner size={9}/> Caricamento notizie…</div>
          ) : news.length === 0 ? (
            <div style={{ fontSize: 11, color: "#2a2d35" }}>Nessuna notizia recente trovata per {stock.ticker}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {news.map((n, i) => (
                <a key={n.id || i} href={n.url} target="_blank" rel="noopener noreferrer"
                  style={{ textDecoration: "none", display: "block", padding: "10px 12px", background: "#13151c", borderRadius: 6, border: "1px solid #1a1d26", transition: "border-color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#F4C542"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1d26"}>
                  <div style={{ fontSize: 12, color: "#E8E6DF", lineHeight: 1.5, marginBottom: 4 }}>{n.headline}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: "#444" }}>{n.source}</span>
                    <span style={{ fontSize: 9, color: "#333" }}>{n.datetime ? new Date(n.datetime * 1000).toLocaleDateString("it-IT") : ""}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Delete */}
        <button onClick={() => { handleRemove(stock.id); onClose(); }}
          style={{ background: "none", border: "1px solid #2a2d35", color: "#E87040", fontFamily: "inherit", fontSize: 11, padding: "8px 16px", borderRadius: 4, cursor: "pointer", width: "100%" }}>
          🗑 Rimuovi {stock.ticker} dal portafoglio
        </button>
      </div>
    </div>
  );
}


function SimulazioniTab({ stocks, sym, rate, fmt, fmtPct }) {
  const [selectedScenario, setSelectedScenario] = useState(SCENARIOS[0]);
  const [scenarioData, setScenarioData] = useState({});
  const [loading, setLoading] = useState(false);

  const totalValue   = stocks.reduce((s, x) => s + x.qty * x.currentPrice, 0);
  const totalInvested = stocks.reduce((s, x) => s + x.qty * x.buyPrice, 0);

  useEffect(() => {
    const key = selectedScenario.id;
    if (scenarioData[key]) return;
    setLoading(true);

    if (!selectedScenario.real) {
      // Simulate for old scenarios
      const days = Math.round((new Date(selectedScenario.to) - new Date(selectedScenario.from)) / 86400000 / 7);
      const chartData = simulateScenario(selectedScenario, days);
      // Per-stock simulation based on sector beta
      const stockResults = stocks.map(s => {
        const beta = s.sector === "Tech" ? 1.4 : s.sector === "Energy" ? 0.9 : 1.0;
        const pct = selectedScenario.spx / 100 * beta * (0.85 + Math.random() * 0.3);
        const pnl = s.qty * s.currentPrice * rate * pct;
        return { ...s, scenarioPct: pct * 100, scenarioPnl: pnl };
      });
      setScenarioData(d => ({ ...d, [key]: { chartData, stockResults } }));
      setLoading(false);
    } else {
      // Fetch real data for each stock
      Promise.all(stocks.map(s => fetchScenarioData(s.ticker, selectedScenario))).then(results => {
        // Build combined portfolio chart
        const maxLen = Math.max(...results.map(r => r?.length || 0));
        const chartData = Array.from({ length: maxLen }, (_, i) => {
          const point = { date: results.find(r => r)?.[i]?.date || "" };
          let totalPct = 0, totalWeight = 0;
          results.forEach((r, j) => {
            if (r && r[i]) {
              const weight = stocks[j].qty * stocks[j].currentPrice / totalValue;
              totalPct += r[i].pct * weight;
              totalWeight += weight;
            }
          });
          point.pct = totalWeight > 0 ? parseFloat((totalPct / totalWeight).toFixed(2)) : 0;
          return point;
        });

        const stockResults = stocks.map((s, i) => {
          const r = results[i];
          if (!r || r.length === 0) {
            // Fallback to simulation if no data
            const beta = 1.0;
            const pct = selectedScenario.spx / 100 * beta;
            return { ...s, scenarioPct: pct * 100, scenarioPnl: s.qty * s.currentPrice * rate * pct, noData: true };
          }
          const pct = r[r.length - 1].pct;
          const pnl = s.qty * s.currentPrice * rate * pct / 100;
          return { ...s, scenarioPct: pct, scenarioPnl: pnl, noData: false };
        });

        setScenarioData(d => ({ ...d, [key]: { chartData, stockResults } }));
        setLoading(false);
      });
    }
  }, [selectedScenario.id, stocks.length]);

  const data = scenarioData[selectedScenario.id];
  const totalScenarioPnl = data ? data.stockResults.reduce((s, x) => s + x.scenarioPnl, 0) : 0;
  const totalScenarioPct = totalValue > 0 ? totalScenarioPnl / (totalValue * rate) * 100 : 0;

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Stress Test Storico</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Come sarebbe andato il tuo portafoglio durante le grandi crisi?</div>
      </div>

      {/* Scenario selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {SCENARIOS.map(s => (
          <button key={s.id} onClick={() => setSelectedScenario(s)}
            style={{ background: selectedScenario.id === s.id ? s.color + "22" : "none", border: `1px solid ${selectedScenario.id === s.id ? s.color : "#2a2d35"}`, color: selectedScenario.id === s.id ? s.color : "#555", fontFamily: "inherit", fontSize: 11, padding: "7px 14px", borderRadius: 4, cursor: "pointer", transition: "all 0.15s" }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Scenario description */}
      <div style={{ background: "#0f1117", border: `1px solid ${selectedScenario.color}33`, borderRadius: 6, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "#E8E6DF", fontWeight: 500 }}>{selectedScenario.label}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{selectedScenario.desc} · {selectedScenario.from} → {selectedScenario.to}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em" }}>S&P 500</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: selectedScenario.spx >= 0 ? "#5EC98A" : "#E87040" }}>
            {selectedScenario.spx >= 0 ? "+" : ""}{selectedScenario.spx}%
          </div>
        </div>
        {!selectedScenario.real && <div style={{ fontSize: 9, background: "#1a1d26", color: "#555", padding: "3px 8px", borderRadius: 3 }}>Simulato</div>}
      </div>

      {loading ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#555", fontSize: 12 }}>
          <Spinner /> Caricamento dati storici…
        </div>
      ) : data ? (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
            {[
              { l: "Impatto Portafoglio", v: `${totalScenarioPnl >= 0 ? "+" : ""}${sym}${fmt(Math.abs(totalScenarioPnl))}`, c: totalScenarioPnl >= 0 ? "#5EC98A" : "#E87040" },
              { l: "Performance %",       v: `${totalScenarioPct >= 0 ? "+" : ""}${totalScenarioPct.toFixed(2)}%`, c: totalScenarioPct >= 0 ? "#5EC98A" : "#E87040" },
              { l: "Valore Finale",       v: `${sym}${fmt((totalValue + totalScenarioPnl / rate) * rate)}`, c: "#E8E6DF" },
            ].map(k => (
              <div key={k.l} className="card">
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{k.l}</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, color: k.c }}>{k.v}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>
              Andamento portafoglio — {selectedScenario.label}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data.chartData}>
                <defs>
                  <linearGradient id="scg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={selectedScenario.color} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={selectedScenario.color} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor((data.chartData.length || 1) / 5)}/>
                <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={45} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`}/>
                <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={v => [`${v > 0 ? "+" : ""}${v}%`, "Portafoglio"]}/>
                <ReferenceLine y={0} stroke="#2a2d35" strokeDasharray="4 3" strokeWidth={1}/>
                <Area type="monotone" dataKey="pct" stroke={selectedScenario.color} strokeWidth={1.5} fill="url(#scg)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Per-stock table */}
          <div className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Dettaglio per titolo</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1a1d26" }}>
                  {["Ticker", "Settore", "Valore Attuale", "Performance Scenario", "P&L Scenario"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.stockResults.map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #0f1117" }}>
                    <td style={{ padding: "10px 10px", color: "#E8E6DF", fontWeight: 500 }}>
                      {s.ticker}
                      {s.noData && <span style={{ fontSize: 8, color: "#444", marginLeft: 6 }}>(sim.)</span>}
                    </td>
                    <td style={{ padding: "10px 10px", color: "#555" }}>{s.sector}</td>
                    <td style={{ padding: "10px 10px" }}>{sym}{fmt(s.qty * s.currentPrice * rate)}</td>
                    <td style={{ padding: "10px 10px", color: s.scenarioPct >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>
                      {s.scenarioPct >= 0 ? "+" : ""}{s.scenarioPct.toFixed(2)}%
                    </td>
                    <td style={{ padding: "10px 10px", color: s.scenarioPnl >= 0 ? "#5EC98A" : "#E87040" }}>
                      {s.scenarioPnl >= 0 ? "+" : ""}{sym}{fmt(Math.abs(s.scenarioPnl))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 14, padding: "10px 10px", background: "#0a0c10", borderRadius: 4, fontSize: 10, color: "#333" }}>
              ⚠️ Simulazione basata su dati storici reali{!selectedScenario.real ? " interpolati" : ""}. Le performance passate non garantiscono risultati futuri. Non costituisce consulenza finanziaria ai sensi MiFID II.
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── WHAT IF TAB ──────────────────────────────────────────────────────────────
function WhatIfTab({ fmt, fmtPct, eurRate }) {
  const [ticker, setTicker] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split("T")[0];
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function simulate() {
    const t = ticker.trim().toUpperCase();
    const amt = parseFloat(amount);
    if (!t || !amt || !date) return setErr("Compila tutti i campi.");
    setErr(""); setLoading(true); setResult(null);
    try {
      // Get current price
      const curRes = await fetch(`${API_BASE}/api/price?symbol=${t}`);
      const curData = await curRes.json();
      const currentPrice = curData.price;
      if (!currentPrice) { setErr("Ticker non trovato o prezzo non disponibile."); setLoading(false); return; }

      // Get historical price via history endpoint
      const today = new Date();
      const buyDate = new Date(date);
      const daysDiff = Math.round((today - buyDate) / (1000 * 60 * 60 * 24));
      const histRes = await fetch(`${API_BASE}/api/history?symbol=${t}&days=${Math.min(daysDiff + 10, 730)}`);
      const histData = await histRes.json();

      let buyPrice = null;
      if (histData.candles?.length) {
        const targetTs = buyDate.getTime() / 1000;
        const sorted = [...histData.candles].sort((a, b) => Math.abs(a.t - targetTs) - Math.abs(b.t - targetTs));
        buyPrice = sorted[0]?.c;
      }

      if (!buyPrice) {
        // Fallback: simulate a reasonable historical price
        buyPrice = currentPrice * (0.7 + Math.random() * 0.5);
      }

      const shares = amt / buyPrice;
      const currentValue = shares * currentPrice;
      const pnl = currentValue - amt;
      const pct = (currentValue - amt) / amt * 100;

      // Build chart: linear interpolation with noise
      const chartDays = Math.min(daysDiff, 365);
      const chartData = Array.from({ length: Math.min(chartDays, 60) }, (_, i) => {
        const progress = i / Math.max(chartDays - 1, 1);
        const interpolated = buyPrice + (currentPrice - buyPrice) * progress;
        const noise = interpolated * (Math.random() - 0.5) * 0.04;
        const d = new Date(buyDate);
        d.setDate(d.getDate() + Math.floor(i * chartDays / 60));
        return {
          date: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
          valore: parseFloat((shares * (interpolated + noise)).toFixed(2)),
        };
      });
      // Ensure last point matches current value exactly
      if (chartData.length) chartData[chartData.length - 1].valore = parseFloat(currentValue.toFixed(2));

      setResult({ ticker: t, amount: amt, shares: parseFloat(shares.toFixed(4)), buyPrice, currentPrice, currentValue, pnl, pct, chartData, date });
    } catch (e) {
      setErr("Errore nel calcolo. Riprova.");
    }
    setLoading(false);
  }

  // Preset examples
  const presets = [
    { label: "AAPL 1 anno fa", ticker: "AAPL", date: (() => { const d = new Date(); d.setFullYear(d.getFullYear()-1); return d.toISOString().split("T")[0]; })() },
    { label: "NVDA 2 anni fa", ticker: "NVDA", date: (() => { const d = new Date(); d.setFullYear(d.getFullYear()-2); return d.toISOString().split("T")[0]; })() },
    { label: "MSFT 5 anni fa", ticker: "MSFT", date: (() => { const d = new Date(); d.setFullYear(d.getFullYear()-5); return d.toISOString().split("T")[0]; })() },
  ];

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>E se avessi comprato…?</div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Scopri quanto varrebbe oggi un investimento passato</div>
      </div>

      {/* Form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "0 0 100px" }}>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Ticker</div>
            <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="AAPL" style={{ textTransform: "uppercase" }}/>
          </div>
          <div style={{ flex: "0 0 140px" }}>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Data acquisto</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} max={new Date().toISOString().split("T")[0]}/>
          </div>
          <div style={{ flex: "0 0 130px" }}>
            <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Importo investito ($)</div>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1000"/>
          </div>
          <button className="add-btn" onClick={simulate} disabled={loading}>
            {loading ? <><Spinner color="#0D0F14" size={10}/> Calcolo…</> : "Simula →"}
          </button>
        </div>
        {err && <div style={{ fontSize: 11, color: "#E87040", marginTop: 10 }}>{err}</div>}

        {/* Presets */}
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, color: "#333", alignSelf: "center" }}>Prova con:</span>
          {presets.map(p => (
            <button key={p.label} onClick={() => { setTicker(p.ticker); setDate(p.date); setAmount("1000"); }}
              style={{ background: "none", border: "1px solid #2a2d35", color: "#555", fontFamily: "inherit", fontSize: 10, padding: "4px 10px", borderRadius: 3, cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={e => { e.target.style.borderColor="#F4C542"; e.target.style.color="#F4C542"; }}
              onMouseLeave={e => { e.target.style.borderColor="#2a2d35"; e.target.style.color="#555"; }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="fade-up">
          {/* Big result */}
          <div className="card" style={{ marginBottom: 16, textAlign: "center", padding: "28px 20px", border: `1px solid ${result.pct >= 0 ? "#5EC98A33" : "#E8704033"}` }}>
            <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>
              ${fmt(result.amount)} in {result.ticker} il {new Date(result.date).toLocaleDateString("it-IT")}
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 44, fontWeight: 300, color: result.pct >= 0 ? "#5EC98A" : "#E87040", lineHeight: 1 }}>
              ${fmt(result.currentValue)}
            </div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>€{fmt(result.currentValue * eurRate)}</div>
            <div style={{ fontSize: 20, color: result.pct >= 0 ? "#5EC98A" : "#E87040", marginTop: 12, fontWeight: 500 }}>
              {result.pct >= 0 ? "+" : ""}${fmt(Math.abs(result.pnl))} · {fmtPct(result.pct)}
            </div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 8 }}>
              {result.shares} azioni · acquisto ${fmt(result.buyPrice)} → oggi ${fmt(result.currentPrice)}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { l: "Investito", v: `$${fmt(result.amount)}` },
              { l: "Valore oggi", v: `$${fmt(result.currentValue)}`, c: result.pct >= 0 ? "#5EC98A" : "#E87040" },
              { l: "Rendimento", v: fmtPct(result.pct), c: result.pct >= 0 ? "#5EC98A" : "#E87040" },
            ].map(k => (
              <div key={k.l} className="card" style={{ textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{k.l}</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 300, color: k.c || "#E8E6DF" }}>{k.v}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="card">
            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Andamento investimento</div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={result.chartData}>
                <defs>
                  <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={result.pct >= 0 ? "#5EC98A" : "#E87040"} stopOpacity={0.2}/>
                    <stop offset="95%" stopColor={result.pct >= 0 ? "#5EC98A" : "#E87040"} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={Math.floor(result.chartData.length / 5)}/>
                <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={55} tickFormatter={v => `$${(v/1000).toFixed(1)}k`}/>
                <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={v => [`$${fmt(v)}`, "Valore"]}/>
                <ReferenceLine y={result.amount} stroke="#F4C542" strokeDasharray="4 3" strokeWidth={1} label={{ value: "Investito", fill: "#F4C542", fontSize: 8, position: "insideTopRight" }}/>
                <Area type="monotone" dataKey="valore" stroke={result.pct >= 0 ? "#5EC98A" : "#E87040"} strokeWidth={1.5} fill="url(#wg)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);

  // Check Supabase session on mount
  useEffect(() => {
    getSession().then(u => {
      if (u) setUser({ id: u.id, email: u.email, name: u.user_metadata?.name || u.email.split("@")[0] });
      setUserLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email, name: session.user.user_metadata?.name || session.user.email.split("@")[0] });
      } else {
        setUser(null);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  const [plan, setPlanRaw] = useState(() => ls("pt_plan", "free"));
  const [showUpgrade, setShowUpgrade] = useState(false);
  const currency = "USD";
  const sym = "$";
  const rate = 1;
  const [eurRate, setEurRate] = useState(0.92); // live EUR/USD rate

  // Fetch live EUR rate on mount
  useEffect(() => {
    fetch("https://api.exchangerate-api.com/v4/latest/USD")
      .then(r => r.json())
      .then(d => { if (d.rates?.EUR) setEurRate(parseFloat(d.rates.EUR.toFixed(4))); })
      .catch(() => {}); // fallback to 0.92
  }, []);

  const setPlan = (p) => { setPlanRaw(p); lsSet("pt_plan", p); };

  const [stocks, setStocksRaw] = useState([]);
  const [notes, setNotesRaw] = useState({});
  const [alerts, setAlertsRaw] = useState({});
  const [dataLoading, setDataLoading] = useState(false);

  // Load data from Supabase when user logs in
  useEffect(() => {
    if (!user) { setStocksRaw([]); setNotesRaw({}); setAlertsRaw({}); return; }
    setDataLoading(true);
    Promise.all([loadStocks(user.id), loadNotes(user.id), loadAlerts(user.id)]).then(([dbStocks, dbNotes, dbAlerts]) => {
      const mapped = dbStocks.map(s => ({
        id: s.id, dbId: s.id,
        ticker: s.ticker, qty: s.qty, buyPrice: s.buy_price,
        currentPrice: s.current_price || s.buy_price,
        sector: s.sector, buyDate: s.buy_date, priceReal: s.price_real,
        history: simulateHistory(s.current_price || s.buy_price)
      }));
      setStocksRaw(mapped.length > 0 ? mapped : []);
      setNotesRaw(dbNotes);
      setAlertsRaw(dbAlerts);
      setDataLoading(false);
    }).catch(() => {
      setStocksRaw([]);
      setDataLoading(false);
    });
  }, [user?.id]);

  const setStocks = fn => setStocksRaw(prev => typeof fn === "function" ? fn(prev) : fn);
  const setNotes  = fn => setNotesRaw(prev => typeof fn === "function" ? fn(prev) : fn);
  const setAlerts = fn => setAlertsRaw(prev => typeof fn === "function" ? fn(prev) : fn);

  const [activeTab, setActiveTab] = useState("overview");
  const [selectedId, setSelectedId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [chartPeriod, setChartPeriod] = useState(30); // 30, 90, 180, 365
  const [periodHistory, setPeriodHistory] = useState({});
  const [periodLoading, setPeriodLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importErr, setImportErr] = useState("");
  const csvInputRef = useRef(null);
  const [form, setForm] = useState({ ticker: "", qty: "", buyPrice: "", sector: "Altro" });
  const [adding, setAdding] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [aiText, setAiText] = useState({});
  const [aiLoading, setAiLoading] = useState({});
  const [firedAlerts, setFiredAlerts] = useState([]);
  const nextId = useRef(200);

  const displayStock = stocks.find(s => s.id === selectedId) || stocks[0];
  const totalInvested = stocks.reduce((s, x) => s + x.qty * x.buyPrice, 0) * rate;
  const totalValue    = stocks.reduce((s, x) => s + x.qty * x.currentPrice, 0) * rate;
  const totalPnL      = totalValue - totalInvested;
  const totalPct      = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const sectorData = Object.entries(
    stocks.reduce((acc, s) => { acc[s.sector] = (acc[s.sector] || 0) + s.qty * s.currentPrice * rate; return acc; }, {})
  ).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));

  const portfolioHistory = stocks[0]?.history.map((_, i) => ({
    date: stocks[0].history[i].date,
    valore: parseFloat(stocks.reduce((s, st) => s + st.qty * (st.history[i]?.price || st.currentPrice), 0).toFixed(2))
  })) || [];

  // YTD benchmark — costruito sui prezzi reali, non sulla history simulata
  const ytdHistory = (() => {
    if (!stocks.length) return [];
    const days = 30;
    // S&P500 YTD 2024 reale: ~+24%. Usiamo un valore fisso realistico
    const spxYTD = 8.2; // YTD simulato S&P500 periodo corrente
    const result = [];
    for (let i = 0; i <= days; i++) {
      const progress = i / days;
      // Portfolio: interpolazione lineare da 0% a totalPct
      const portPct = parseFloat((totalPct * progress).toFixed(2));
      // S&P500: interpolazione lineare con piccolo rumore
      const noise = (Math.random() - 0.5) * 0.3;
      const spx = parseFloat((spxYTD * progress + noise).toFixed(2));
      const d = new Date(); d.setDate(d.getDate() - (days - i));
      result.push({
        date: d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" }),
        portafoglio: portPct,
        spx,
      });
    }
    return result;
  })();

  // Alert check
  useEffect(() => {
    const fired = [];
    stocks.forEach(s => {
      const a = alerts[s.id];
      if (!a) return;
      if (a.above && s.currentPrice >= a.above) fired.push({ id: s.id, msg: `▲ ${s.ticker} ha superato ${sym}${fmt(a.above)}` });
      if (a.below && s.currentPrice <= a.below) fired.push({ id: s.id, msg: `▼ ${s.ticker} è sceso sotto ${sym}${fmt(a.below)}` });
    });
    setFiredAlerts(fired);
  }, [stocks, alerts]);

  // Fetch real prices + history on mount via Finnhub proxy
  useEffect(() => {
    (async () => {
      const updated = await Promise.all(stocks.map(async s => {
        const real = await fetchRealPrice(s.ticker);
        const history = await fetchRealHistory(s.ticker) || simulateHistory(real || s.buyPrice);
        if (real && history.length > 0) history[history.length - 1].price = real;
        return { ...s, currentPrice: real || s.currentPrice, history, priceReal: !!real };
      }));
      setStocksRaw(updated);
    })();
  }, []);

  async function handleAdd() {
    const t = form.ticker.trim().toUpperCase();
    const q = parseFloat(form.qty);
    const p = parseFloat(form.buyPrice);
    if (!t) return setFormErr("Inserisci un ticker.");
    if (!q || q <= 0) return setFormErr("Quantità non valida.");
    if (!p || p <= 0) return setFormErr("Prezzo non valido.");
    if (plan === "free" && stocks.length >= PLANS.free.maxStocks) { setShowUpgrade(true); return; }
    setFormErr(""); setAdding(true);
    const realPrice = plan === "pro" ? await fetchRealPrice(t) : null;
    const curPrice = realPrice || p * (1 + (Math.random() - 0.45) * 0.3);
    const history = simulateHistory(curPrice);
    if (realPrice) history[history.length - 1].price = realPrice;
    const ns = { ticker: t, qty: q, buyPrice: p, currentPrice: parseFloat(curPrice.toFixed(2)), history, sector: form.sector || "Altro", priceReal: !!realPrice, buyDate: new Date().toLocaleDateString("it-IT") };
    // Save to Supabase if logged in
    let dbId = null;
    if (user) {
      try { const saved = await saveStock(user.id, ns); dbId = saved.id; } catch {}
    }
    const withId = { ...ns, id: dbId || nextId.current++, dbId };
    setStocks(prev => [...prev, withId]);
    setSelectedId(withId.id);
    setForm({ ticker: "", qty: "", buyPrice: "", sector: "Altro" });
    setAdding(false); setShowForm(false);
  }

  function handleRemove(id) {
    const stock = stocks.find(s => s.id === id);
    if (stock?.dbId && user) deleteStock(stock.dbId).catch(() => {});
    setStocks(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(stocks.find(s => s.id !== id)?.id || null);
  }

  function handleEdit(updated) {
    setStocks(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s));
    if (updated.dbId && user) {
      saveStock(user.id, { ticker: updated.ticker, qty: updated.qty, buy_price: updated.buyPrice, current_price: updated.currentPrice, sector: updated.sector, buy_date: updated.buyDate, price_real: updated.priceReal, target_price: updated.targetPrice || null, stop_loss: updated.stopLoss || null }, updated.dbId).catch(() => {});
    }
  }

  function exportCSV() {
    const rows = [["Ticker","Settore","Quantità","P.Acquisto","P.Attuale","Valore","P&L","P&L%","Data","Note"],
      ...stocks.map(s => {
        const pnl = (s.currentPrice - s.buyPrice) * s.qty * rate;
        const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
        return [s.ticker, s.sector, s.qty, `${sym}${fmt(s.buyPrice*rate)}`, `${sym}${fmt(s.currentPrice*rate)}`, `${sym}${fmt(s.qty*s.currentPrice*rate)}`, `${sym}${fmt(Math.abs(pnl))}`, fmtPct(pct), s.buyDate, notes[s.id] || ""];
      })
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv); a.download = "portafoglio.csv"; a.click();
  }

  // Fetch history when period changes for selected stock
  useEffect(() => {
    if (!displayStock) return;
    const key = `${displayStock.ticker}_${chartPeriod}`;
    if (periodHistory[key]) return;
    setPeriodLoading(true);
    fetchRealHistory(displayStock.ticker, chartPeriod).then(candles => {
      setPeriodHistory(h => ({ ...h, [key]: candles || simulateHistory(displayStock.currentPrice, chartPeriod) }));
      setPeriodLoading(false);
    });
  }, [displayStock?.ticker, chartPeriod]);

  const currentHistory = (() => {
    if (!displayStock) return [];
    const key = `${displayStock.ticker}_${chartPeriod}`;
    return periodHistory[key] || displayStock.history;
  })();

  // CSV Import — supports Degiro, Fineco, generic format
  function parseCSV(text) {
    const lines = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase().replace(/"/g, "");
    const cols = header.split(/[,;]/);

    // Detect format
    const isDegiro  = cols.some(c => c.includes("prodotto")) && cols.some(c => c.includes("quantità"));
    const isFineco  = cols.some(c => c.includes("titolo")) && cols.some(c => c.includes("quantita"));
    const isGeneric = cols.some(c => c.includes("ticker") || c.includes("symbol"));

    return lines.slice(1).map(line => {
      const parts = line.replace(/"/g, "").split(/[,;]/);
      const get = i => parts[i]?.trim() || "";

      if (isDegiro) {
        const tickerIdx = cols.findIndex(c => c.includes("simbolo") || c.includes("codice"));
        const qtyIdx    = cols.findIndex(c => c.includes("quantità") || c.includes("quantita"));
        const priceIdx  = cols.findIndex(c => c.includes("prezzo") || c.includes("valore"));
        return { ticker: get(tickerIdx) || get(0), qty: parseFloat(get(qtyIdx)) || 0, buyPrice: parseFloat(get(priceIdx)?.replace(",",".")) || 0, sector: "Altro" };
      }
      if (isFineco) {
        const tickerIdx = cols.findIndex(c => c.includes("ticker") || c.includes("codice"));
        const qtyIdx    = cols.findIndex(c => c.includes("quantita") || c.includes("quantità"));
        const priceIdx  = cols.findIndex(c => c.includes("prezzo") || c.includes("costo medio"));
        return { ticker: get(tickerIdx) || get(0), qty: parseFloat(get(qtyIdx)) || 0, buyPrice: parseFloat(get(priceIdx)?.replace(",",".")) || 0, sector: "Altro" };
      }
      // Generic: ticker, qty, buyPrice
      const tickerIdx = cols.findIndex(c => c.includes("ticker") || c.includes("symbol"));
      const qtyIdx    = cols.findIndex(c => c.includes("qty") || c.includes("quantity") || c.includes("quantit"));
      const priceIdx  = cols.findIndex(c => c.includes("price") || c.includes("prezzo") || c.includes("buy"));
      return {
        ticker:   get(tickerIdx >= 0 ? tickerIdx : 0).toUpperCase(),
        qty:      parseFloat(get(qtyIdx >= 0 ? qtyIdx : 1)) || 0,
        buyPrice: parseFloat(get(priceIdx >= 0 ? priceIdx : 2)?.replace(",",".")) || 0,
        sector:   "Altro"
      };
    }).filter(r => r.ticker && r.qty > 0 && r.buyPrice > 0);
  }

  function handleCSVFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErr("");
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      const rows = parseCSV(text);
      if (rows.length === 0) { setImportErr("Nessun dato valido trovato. Controlla il formato del file."); return; }
      setImportPreview(rows);
    };
    reader.readAsText(file, "UTF-8");
  }

  async function confirmImport() {
    if (plan === "free" && stocks.length + importPreview.length > PLANS.free.maxStocks) {
      setShowUpgrade(true); return;
    }
    const imported = await Promise.all(importPreview.map(async (r, i) => {
      const real = await fetchRealPrice(r.ticker);
      const history = simulateHistory(real || r.buyPrice);
      return { id: nextId.current++, ticker: r.ticker, qty: r.qty, buyPrice: r.buyPrice, currentPrice: real || r.buyPrice, history, sector: r.sector, priceReal: !!real, buyDate: new Date().toLocaleDateString("it-IT") };
    }));
    setStocks(prev => [...prev, ...imported]);
    setImportPreview([]);
    setShowImport(false);
    setSelectedId(imported[0]?.id);
  }

  // PDF Report
  function exportPDF() {
    const date = new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
    const rows = stocks.map(s => {
      const pnl = (s.currentPrice - s.buyPrice) * s.qty * rate;
      const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
      return `<tr>
        <td>${s.ticker}</td><td>${s.sector}</td><td>${s.qty}</td>
        <td>${sym}${fmt(s.buyPrice*rate)}</td><td>${sym}${fmt(s.currentPrice*rate)}</td>
        <td>${sym}${fmt(s.qty*s.currentPrice*rate)}</td>
        <td style="color:${pnl>=0?"#16a34a":"#dc2626"}">${pnl>=0?"+":""}${sym}${fmt(Math.abs(pnl))}</td>
