        <td style="color:${pct>=0?"#16a34a":"#dc2626"}">${fmtPct(pct)}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Report Portafoglio — ${date}</title>
    <style>
      body{font-family:'Helvetica Neue',sans-serif;color:#1a1a1a;padding:40px;max-width:900px;margin:0 auto}
      h1{font-size:28px;font-weight:300;margin-bottom:4px}
      .sub{color:#888;font-size:13px;margin-bottom:32px}
      .kpi-row{display:flex;gap:20px;margin-bottom:32px}
      .kpi{background:#f8f8f8;border-radius:8px;padding:16px 20px;flex:1}
      .kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:6px}
      .kpi-val{font-size:22px;font-weight:300}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th{text-align:left;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;border-bottom:2px solid #eee}
      td{padding:10px 12px;border-bottom:1px solid #f0f0f0}
      tr:hover td{background:#fafafa}
      .footer{margin-top:40px;font-size:10px;color:#ccc;text-align:center;line-height:1.8}
      .positive{color:#16a34a} .negative{color:#dc2626}
    </style></head><body>
    <h1>Portfolio Report</h1>
    <div class="sub">Generato il ${date} · ${user?.name || ""}</div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Valore Totale</div><div class="kpi-val">${sym}${fmt(totalValue)}</div></div>
      <div class="kpi"><div class="kpi-label">Investito</div><div class="kpi-val">${sym}${fmt(totalInvested)}</div></div>
      <div class="kpi"><div class="kpi-label">P&L Totale</div><div class="kpi-val" style="color:${totalPnL>=0?"#16a34a":"#dc2626"}">${totalPnL>=0?"+":""}${sym}${fmt(Math.abs(totalPnL))}</div></div>
      <div class="kpi"><div class="kpi-label">Performance</div><div class="kpi-val" style="color:${totalPct>=0?"#16a34a":"#dc2626"}">${fmtPct(totalPct)}</div></div>
    </div>
    <table><thead><tr><th>Ticker</th><th>Settore</th><th>Q.tà</th><th>P.Acquisto</th><th>P.Attuale</th><th>Valore</th><th>P&L</th><th>P&L%</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer">⚠️ Documento generato da Portfolio Tracker a scopo puramente informativo.<br>Non costituisce consulenza finanziaria ai sensi della normativa MiFID II.<br>Dati con possibile ritardo di 15 minuti.</div>
    </body></html>`;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }

  async function handleAI(stock) {
    if (aiLoading[stock.id]) return;
    setAiLoading(l => ({ ...l, [stock.id]: true }));
    const text = await fetchAIAnalysis(stock, notes[stock.id], sym, currency);
    setAiText(t => ({ ...t, [stock.id]: text }));
    setAiLoading(l => ({ ...l, [stock.id]: false }));
  }

  const planCtx = { plan, setPlan, setShowUpgrade };
  const currCtx = { currency, sym, rate, eurRate };

  if (userLoading) return (
    <div style={{ minHeight: "100vh", background: "#0D0F14", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600&display=swap'); *{box-sizing:border-box;margin:0;padding:0} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 300, color: "#F4C542", marginBottom: 16 }}>Portfolio</div>
        <span style={{ display: "inline-block", width: 16, height: 16, borderRadius: "50%", border: "2px solid #F4C542", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
      </div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={u => setUser(u)} />;

  return (
    <PlanCtx.Provider value={planCtx}>
      <CurrencyCtx.Provider value={currCtx}>
        <div style={{ minHeight: "100vh", background: "#0D0F14", color: "#E8E6DF", fontFamily: "'DM Mono', 'Courier New', monospace" }}>
          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600&display=swap');
            *{box-sizing:border-box;margin:0;padding:0}
            ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0D0F14} ::-webkit-scrollbar-thumb{background:#2a2d35;border-radius:2px}
            input,textarea,select{background:#13151c;border:1px solid #2a2d35;color:#E8E6DF;font-family:inherit;font-size:13px;padding:9px 12px;border-radius:4px;outline:none;width:100%}
            input:focus,textarea:focus{border-color:#F4C542} input::placeholder,textarea::placeholder{color:#3a3d45}
            select{cursor:pointer}
            .tab-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;padding:8px 14px;color:#555;transition:color 0.2s;white-space:nowrap;border-bottom:1.5px solid transparent}
            .tab-btn:hover{color:#aaa} .tab-btn.active{color:#F4C542;border-bottom-color:#F4C542}
            .action-btn{background:none;border:1px solid #2a2d35;cursor:pointer;font-family:inherit;color:#aaa;font-size:11px;padding:6px 14px;border-radius:4px;transition:all 0.15s;letter-spacing:0.06em;white-space:nowrap}
            .action-btn:hover{border-color:#F4C542;color:#F4C542}
            .remove-btn{background:none;border:none;cursor:pointer;color:#333;font-size:13px;padding:2px 6px;transition:color 0.15s;flex-shrink:0}
            .remove-btn:hover{color:#E87040}
            .stock-row{border-bottom:1px solid #0f1117;transition:background 0.12s;cursor:pointer}
            .stock-row:hover{background:#12141b}
            .stock-row.active{background:#14171f;border-left:2px solid #F4C542}
            .add-btn{background:#F4C542;border:none;color:#0D0F14;font-family:inherit;font-size:12px;font-weight:600;padding:10px 20px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:7px;white-space:nowrap;transition:opacity 0.15s}
            .add-btn:hover{opacity:0.85} .add-btn:disabled{opacity:0.5;cursor:not-allowed}
            .card{background:#0f1117;border:1px solid #1a1d26;border-radius:6px;padding:16px 18px}
            @keyframes spin{to{transform:rotate(360deg)}}
            @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
            .fade-up{animation:fadeUp 0.3s ease forwards}

            /* ── MOBILE ── */
            @media(max-width:768px){
              .desktop-sidebar{display:none!important}
              .desktop-tabs{display:none!important}
              .mobile-nav{display:flex!important}
              .mobile-header-actions .action-btn{font-size:10px;padding:5px 8px}
              .main-content{padding:12px 12px 80px!important}
              .header-logo span:last-child{display:none}
              .kpi-grid{grid-template-columns:repeat(2,1fr)!important}
              .comparison-grid{grid-template-columns:1fr!important}
              .card{padding:12px 14px!important}
              table{font-size:11px!important}
              th,td{padding:8px 6px 8px 0!important;font-size:10px!important}
              .add-btn{font-size:12px;padding:9px 16px}
              .action-btn{font-size:10px;padding:5px 8px}
              input,select,textarea{font-size:14px!important} /* prevents iOS zoom */
              .hide-mobile{display:none!important}
            }
            @media(min-width:769px){
              .mobile-nav{display:none!important}
              .mobile-portfolio-header{display:none!important}
            }
          `}</style>

          {/* Alert toasts */}
          {firedAlerts.length > 0 && (
            <div style={{ position: "fixed", top: 16, right: 16, zIndex: 8888, display: "flex", flexDirection: "column", gap: 8 }}>
              {firedAlerts.map((a, i) => (
                <div key={i} style={{ background: "#1a1400", border: "1px solid #F4C542", borderRadius: 6, padding: "10px 16px", fontSize: 12, color: "#F4C542", display: "flex", alignItems: "center", gap: 10 }}>
                  🔔 {a.msg}
                  <button onClick={() => setFiredAlerts(x => x.filter((_,j) => j !== i))} style={{ background: "none", border: "none", color: "#F4C542", cursor: "pointer", fontSize: 14, marginLeft: 4 }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

          {/* Header */}
          <div style={{ padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #161820", height: 52, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
              <span style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 300, color: "#F4C542" }}>Portfolio</span>
              <span style={{ fontSize: 9, color: "#2a2d35", letterSpacing: "0.2em", textTransform: "uppercase" }}>Tracker</span>
              {plan === "pro" && <span style={{ fontSize: 8, background: "#F4C542", color: "#0D0F14", padding: "2px 6px", borderRadius: 2, fontWeight: 700, letterSpacing: "0.1em" }}>PRO</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", flex: 1, justifyContent: "center" }} className="desktop-tabs">
              {["overview","titoli","settori","watchlist","confronto","alert","simulazioni","whatif"].map(t => (
                <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                  {t === "whatif" ? "e se?" : t}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }} className="mobile-header-actions">
              {plan === "free" && <button className="action-btn" onClick={() => setShowUpgrade(true)} style={{ color: "#F4C542", borderColor: "#F4C542" }}>✦ Pro</button>}
              <button className="action-btn hide-mobile" onClick={() => setShowImport(v => !v)}>↑ CSV</button>
              <button className="add-btn" onClick={() => setShowForm(v => !v)}>{showForm ? "✕" : "+ Aggiungi"}</button>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {plan === "pro" && (
                  <>
                    <button onClick={exportCSV} className="action-btn hide-mobile" style={{ fontSize: 9, padding: "4px 10px" }}>↓ CSV</button>
                    <button onClick={exportPDF} className="action-btn hide-mobile" style={{ fontSize: 9, padding: "4px 10px" }}>↓ PDF</button>
                  </>
                )}
                <button className="action-btn" onClick={() => signOut().then(() => setUser(null))} style={{ color: "#333", fontSize: 10 }}>{user.name} ↩</button>
              </div>
            </div>
          </div>

          {/* Add form */}
          {showForm && (
            <div className="fade-up" style={{ padding: "14px 28px", background: "#0a0c10", borderBottom: "1px solid #1a1d26", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <TickerAutocomplete value={form.ticker} onChange={v => setForm(f => ({ ...f, ticker: v }))} onSelect={t => setForm(f => ({ ...f, ticker: t.ticker, sector: t.sector || "Altro" }))} />
              <div style={{ flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Settore</div>
                <select value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 90 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Quantità</div>
                <input type="number" placeholder="10" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 5, letterSpacing: "0.1em", textTransform: "uppercase" }}>Prezzo Acquisto</div>
                <input type="number" placeholder="175.00" value={form.buyPrice} onChange={e => setForm(f => ({ ...f, buyPrice: e.target.value }))} />
              </div>
              <button className="add-btn" onClick={handleAdd} disabled={adding}>
                {adding && <Spinner color="#0D0F14" />}
                {adding ? "Recupero prezzo…" : "Aggiungi"}
              </button>
              {plan === "free" && stocks.length >= PLANS.free.maxStocks && <span style={{ fontSize: 11, color: "#E87040", alignSelf: "center" }}>Limite Free: max {PLANS.free.maxStocks} titoli</span>}
              {formErr && <span style={{ fontSize: 11, color: "#E87040", alignSelf: "center" }}>{formErr}</span>}
            </div>
          )}

          {/* Import CSV panel */}
          {showImport && (
            <div className="fade-up" style={{ padding: "16px 28px", background: "#0a0c10", borderBottom: "1px solid #1a1d26" }}>
              <input ref={csvInputRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleCSVFile} />
              {importPreview.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: "#555" }}>Supporta file CSV di <strong style={{color:"#888"}}>Degiro</strong>, <strong style={{color:"#888"}}>Fineco</strong> e formato generico (ticker, qty, prezzo)</div>
                  <button className="add-btn" onClick={() => csvInputRef.current?.click()}>📂 Scegli file CSV</button>
                  {importErr && <span style={{ fontSize: 11, color: "#E87040" }}>{importErr}</span>}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 11, color: "#5EC98A", marginBottom: 10 }}>✓ Trovati {importPreview.length} titoli — controlla e conferma</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    {importPreview.map((r, i) => (
                      <div key={i} style={{ background: "#13151c", border: "1px solid #2a2d35", borderRadius: 4, padding: "6px 12px", fontSize: 12 }}>
                        <span style={{ color: "#E8E6DF", fontWeight: 500 }}>{r.ticker}</span>
                        <span style={{ color: "#555", marginLeft: 8 }}>{r.qty} az. @ ${r.buyPrice}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="add-btn" onClick={confirmImport}>✓ Importa tutti</button>
                    <button className="action-btn" onClick={() => { setImportPreview([]); setImportErr(""); }}>✕ Annulla</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", height: "calc(100vh - 52px)", overflow: "hidden" }}>

            {/* Main — full width, no sidebar */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }} className="main-content">

              {/* OVERVIEW */}
              {activeTab === "overview" && (
                <div className="fade-up">
                  {stocks.length === 0 ? (
                    /* Empty state */
                    <div style={{ textAlign: "center", marginTop: 80 }}>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 36, fontWeight: 300, color: "#F4C542", marginBottom: 12 }}>◈</div>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, marginBottom: 8 }}>Portafoglio vuoto</div>
                      <div style={{ fontSize: 12, color: "#444", marginBottom: 24, lineHeight: 1.8 }}>Aggiungi il tuo primo titolo per iniziare a tracciare il tuo portafoglio.</div>
                      <button className="add-btn" style={{ margin: "0 auto" }} onClick={() => setShowForm(true)}>+ Aggiungi il primo titolo</button>
                    </div>
                  ) : (
                    <>
                      {/* Portfolio KPIs */}
                      <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
                        {[
                          { l: "Valore Totale",   v: `$${fmt(totalValue)}`,                                      sub: `€${fmt(totalValue * eurRate)}`,         c: "#E8E6DF" },
                          { l: "Investito",        v: `$${fmt(totalInvested)}`,                                   sub: `€${fmt(totalInvested * eurRate)}`,       c: "#888" },
                          { l: "P&L Totale",       v: `${totalPnL>=0?"+":""}$${fmt(Math.abs(totalPnL))}`,        sub: `${totalPnL>=0?"+":""}€${fmt(Math.abs(totalPnL * eurRate))}`, c: totalPnL>=0?"#5EC98A":"#E87040" },
                          { l: "Performance",      v: fmtPct(totalPct),                                          sub: null,                                      c: totalPct>=0?"#5EC98A":"#E87040" },
                        ].map(k => (
                          <div key={k.l} className="card">
                            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{k.l}</div>
                            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300, color: k.c }}>{k.v}</div>
                            {k.sub && <div style={{ fontSize: 10, color: "#333", marginTop: 3 }}>{k.sub}</div>}
                          </div>
                        ))}
                      </div>

                      {/* Portfolio chart */}
                      <div className="card" style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Andamento Portafoglio — 30 giorni</div>
                        <ProGate feat="history" h={160}>
                          <ResponsiveContainer width="100%" height={160}>
                            <AreaChart data={portfolioHistory}>
                              <defs>
                                <linearGradient id="pg2" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#F4C542" stopOpacity={0.18}/>
                                  <stop offset="95%" stopColor="#F4C542" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={4}/>
                              <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={60} tickFormatter={v => `${sym}${(v*rate/1000).toFixed(1)}k`}/>
                              <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={v => [`${sym}${fmt(v*rate,0)}`, "Portafoglio"]}/>
                              <Area type="monotone" dataKey="valore" stroke="#F4C542" strokeWidth={1.5} fill="url(#pg2)" dot={false}/>
                            </AreaChart>
                          </ResponsiveContainer>
                        </ProGate>
                      </div>

                      {/* Positions table */}
                      <div className="card" style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 14 }}>Posizioni</div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 600 }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid #1a1d26" }}>
                                {["Ticker","Q.tà","Acquisto","Attuale (USD)","Attuale (EUR)","Valore","P&L","P&L%","Target","Stop",""].map(h => (
                                  <th key={h} style={{ textAlign: "left", padding: "0 8px 8px 0", fontSize: 8, color: "#444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 400 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {stocks.map(s => {
                                const pnl = (s.currentPrice - s.buyPrice) * s.qty;
                                const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
                                const tp = s.targetPrice;
                                const sl = s.stopLoss;
                                return (
                                  <tr key={s.id} style={{ borderBottom: "1px solid #0f1117", cursor: "pointer" }} onClick={() => setSelectedId(s.id)}>
                                    <td style={{ padding: "10px 8px 10px 0" }}>
                                      <span style={{ fontWeight: 500 }}>{s.ticker}</span>
                                      {s.priceReal && <span style={{ fontSize: 7, background: "#1a2a1a", color: "#5EC98A", padding: "1px 5px", borderRadius: 2, marginLeft: 6 }}>LIVE</span>}
                                      {alerts[s.id] && <span style={{ fontSize: 9, marginLeft: 4 }}>🔔</span>}
                                    </td>
                                    <td style={{ padding: "10px 8px 10px 0", color: "#888" }}>{s.qty}</td>
                                    <td style={{ padding: "10px 8px 10px 0", color: "#888" }}>${fmt(s.buyPrice)}</td>
                                    <td style={{ padding: "10px 8px 10px 0" }}>${fmt(s.currentPrice)}</td>
                                    <td style={{ padding: "10px 8px 10px 0", color: "#555" }}>€{fmt(s.currentPrice * eurRate)}</td>
                                    <td style={{ padding: "10px 8px 10px 0" }}>${fmt(s.qty * s.currentPrice)}</td>
                                    <td style={{ padding: "10px 8px 10px 0", color: pnl>=0?"#5EC98A":"#E87040" }}>{pnl>=0?"+":""}${fmt(Math.abs(pnl))}</td>
                                    <td style={{ padding: "10px 8px 10px 0", color: pct>=0?"#5EC98A":"#E87040", fontWeight: 500 }}>{fmtPct(pct)}</td>
                                    <td style={{ padding: "10px 8px 10px 0", color: tp ? (s.currentPrice >= tp ? "#5EC98A" : "#444") : "#2a2d35", fontSize: 11 }}>
                                      {tp ? `$${fmt(tp)}` : "—"}
                                    </td>
                                    <td style={{ padding: "10px 8px 10px 0", color: sl ? (s.currentPrice <= sl ? "#E87040" : "#444") : "#2a2d35", fontSize: 11 }}>
                                      {sl ? `$${fmt(sl)}` : "—"}
                                    </td>
                                    <td style={{ padding: "10px 0", whiteSpace: "nowrap" }}>
                                      <button onClick={e => { e.stopPropagation(); setEditId(s.id); }}
                                        style={{ background: "none", border: "1px solid #2a2d35", color: "#555", fontFamily: "inherit", fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer", marginRight: 4, transition: "all 0.15s" }}
                                        onMouseEnter={e => { e.target.style.borderColor="#F4C542"; e.target.style.color="#F4C542"; }}
                                        onMouseLeave={e => { e.target.style.borderColor="#2a2d35"; e.target.style.color="#555"; }}>
                                        ✎ Modifica
                                      </button>
                                      <button onClick={e => { e.stopPropagation(); handleRemove(s.id); }}
                                        style={{ background: "none", border: "1px solid #2a2d35", color: "#444", fontFamily: "inherit", fontSize: 9, padding: "3px 8px", borderRadius: 3, cursor: "pointer", transition: "all 0.15s" }}
                                        onMouseEnter={e => { e.target.style.borderColor="#E87040"; e.target.style.color="#E87040"; }}
                                        onMouseLeave={e => { e.target.style.borderColor="#2a2d35"; e.target.style.color="#444"; }}>
                                        ✕
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Best / Worst performers */}
                      <div className="comparison-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        {[
                          { label: "🏆 Migliore", stock: [...stocks].sort((a,b) => (b.currentPrice-b.buyPrice)/b.buyPrice - (a.currentPrice-a.buyPrice)/a.buyPrice)[0], color: "#5EC98A" },
                          { label: "📉 Peggiore", stock: [...stocks].sort((a,b) => (a.currentPrice-a.buyPrice)/a.buyPrice - (b.currentPrice-b.buyPrice)/b.buyPrice)[0], color: "#E87040" },
                        ].map(({ label, stock, color }) => stock ? (
                          <div key={label} className="card">
                            <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>{label}</div>
                            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300 }}>{stock.ticker}</div>
                            <div style={{ fontSize: 13, color, marginTop: 4, fontWeight: 500 }}>
                              {fmtPct((stock.currentPrice - stock.buyPrice) / stock.buyPrice * 100)}
                            </div>
                            <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{sym}{fmt(stock.currentPrice * rate)}</div>
                          </div>
                        ) : null)}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* STORICO */}
              {/* TITOLI */}
              {activeTab === "titoli" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>I tuoi Titoli</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Clicca per vedere dettaglio, grafico e analisi AI</div>
                  </div>
                  {stocks.length === 0 ? (
                    <div style={{ textAlign: "center", marginTop: 60, color: "#444" }}>Nessun titolo nel portafoglio.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {stocks.map(s => {
                        const pnl = (s.currentPrice - s.buyPrice) * s.qty;
                        const pct = (s.currentPrice - s.buyPrice) / s.buyPrice * 100;
                        const isUp = pct >= 0;
                        return (
                          <div key={s.id} className="card" style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", transition: "border-color 0.15s" }}
                            onClick={() => setSelectedId(s.id)}
                            onMouseEnter={e => e.currentTarget.style.borderColor = "#F4C542"}
                            onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1d26"}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                                <span style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300 }}>{s.ticker}</span>
                                <span style={{ fontSize: 9, background: "#1a1d26", color: "#555", padding: "2px 7px", borderRadius: 2 }}>{s.sector}</span>
                                {s.priceReal && <span style={{ fontSize: 7, background: "#1a2a1a", color: "#5EC98A", padding: "1px 5px", borderRadius: 2 }}>LIVE</span>}
                                {alerts[s.id] && <span style={{ fontSize: 9 }}>🔔</span>}
                              </div>
                              <div style={{ fontSize: 10, color: "#333" }}>{s.qty} az. · acquisto ${fmt(s.buyPrice)} · {s.buyDate}</div>
                              {(s.targetPrice || s.stopLoss) && (
                                <div style={{ display: "flex", gap: 12, marginTop: 5 }}>
                                  {s.targetPrice && <span style={{ fontSize: 9, color: s.currentPrice >= s.targetPrice ? "#5EC98A" : "#555" }}>🎯 Target ${fmt(s.targetPrice)}</span>}
                                  {s.stopLoss && <span style={{ fontSize: 9, color: s.currentPrice <= s.stopLoss ? "#E87040" : "#555" }}>🛑 Stop ${fmt(s.stopLoss)}</span>}
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 16, fontFamily: "'Fraunces', serif" }}>${fmt(s.currentPrice)}</div>
                              <div style={{ fontSize: 10, color: "#444" }}>€{fmt(s.currentPrice * eurRate)}</div>
                              <div style={{ fontSize: 12, color: isUp ? "#5EC98A" : "#E87040", fontWeight: 500, marginTop: 2 }}>{isUp?"+":""}${fmt(Math.abs(pnl))} · {fmtPct(pct)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* SETTORI */}
              {activeTab === "settori" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Diversificazione</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Distribuzione del capitale per settore</div>
                  </div>
                  {stocks.length === 0 ? (
                    <div style={{ textAlign: "center", marginTop: 60, color: "#444" }}>Aggiungi titoli per vedere la diversificazione.</div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 24 }}>
                        {sectorData.map((s, i) => {
                          const pct = totalValue > 0 ? (s.value / totalValue * 100) : 0;
                          const sectorStocks = stocks.filter(st => st.sector === s.name);
                          const sectorPnl = sectorStocks.reduce((acc, st) => acc + (st.currentPrice - st.buyPrice) * st.qty, 0);
                          const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
                          return (
                            <div key={s.name} style={{ background: "#0f1117", border: `1px solid ${color}33`, borderRadius: 8, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                              <div style={{ position: "absolute", top: 0, left: 0, width: `${pct}%`, height: 3, background: color }}/>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>{s.name}</div>
                                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, color }}>{pct.toFixed(1)}%</div>
                                  <div style={{ fontSize: 10, color: "#555", marginTop: 3 }}>${fmt(s.value, 0)}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: 9, color: "#333", marginBottom: 4 }}>{sectorStocks.length} titol{sectorStocks.length === 1 ? "o" : "i"}</div>
                                  <div style={{ fontSize: 12, color: sectorPnl >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>{sectorPnl>=0?"+":""}${fmt(Math.abs(sectorPnl),0)}</div>
                                </div>
                              </div>
                              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {sectorStocks.map(st => (
                                  <span key={st.id} style={{ fontSize: 9, background: color+"22", color, padding: "2px 7px", borderRadius: 3 }}>{st.ticker}</span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Concentrazione risk */}
                      <div className="card" style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Concentrazione per titolo</div>
                        {[...stocks].sort((a,b) => b.qty*b.currentPrice - a.qty*a.currentPrice).map(s => {
                          const weight = totalValue > 0 ? (s.qty * s.currentPrice / totalValue * 100) : 0;
                          return (
                            <div key={s.id} style={{ marginBottom: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ fontSize: 12, fontWeight: 500 }}>{s.ticker}</span>
                                <span style={{ fontSize: 11, color: "#888" }}>${fmt(s.qty*s.currentPrice,0)} · {weight.toFixed(1)}%</span>
                              </div>
                              <div style={{ background: "#1a1d26", borderRadius: 2, height: 2 }}>
                                <div style={{ width: `${weight}%`, height: "100%", background: weight > 30 ? "#E87040" : "#F4C542", borderRadius: 2 }}/>
                              </div>
                            </div>
                          );
                        })}
                        {stocks.some(s => s.qty*s.currentPrice/totalValue > 0.3) && (
                          <div style={{ marginTop: 10, fontSize: 10, color: "#E87040" }}>⚠️ Un titolo supera il 30% del portafoglio — considera di diversificare.</div>
                        )}
                      </div>

                      <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Benchmark vs S&P 500 (simulato)</div>
                      <ProGate feat="benchmark" h={200}>
                        <div className="card">
                          <div style={{ fontSize: 8, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Performance YTD %</div>
                          <ResponsiveContainer width="100%" height={170}>
                            <LineChart data={ytdHistory}>
                              <XAxis dataKey="date" tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} interval={6}/>
                              <YAxis tick={{ fill: "#2a2d35", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto","auto"]} width={45} tickFormatter={v => `${v>0?"+":""}${v}%`}/>
                              <Tooltip contentStyle={{ background: "#0f1117", border: "1px solid #2a2d35", borderRadius: 4, fontSize: 11, color: "#E8E6DF" }} formatter={(v, n) => [`${v>0?"+":""}${v}%`, n]}/>
                              <ReferenceLine y={0} stroke="#2a2d35" strokeDasharray="4 3" strokeWidth={1}/>
                              <Legend wrapperStyle={{ fontSize: 10, color: "#555" }}/>
                              <Line type="monotone" dataKey="portafoglio" name="Il tuo portafoglio" stroke="#F4C542" strokeWidth={1.5} dot={false}/>
                              <Line type="monotone" dataKey="spx" name="S&P 500 (sim.)" stroke="#5B8DEF" strokeWidth={1.5} dot={false} strokeDasharray="4 3"/>
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </ProGate>
                    </>
                  )}
                </div>
              )}

              {/* WATCHLIST */}
              {activeTab === "watchlist" && <WatchlistTab eurRate={eurRate} fmt={fmt} fmtPct={fmtPct} />}

              {/* CONFRONTO */}
              {activeTab === "confronto" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Confronto Titoli</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Analisi comparativa tra due posizioni</div>
                  </div>
                  <ProGate feat="comparison" h={300}>
                    <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
                      {[{label:"Titolo A",color:"#F4C542",val:compareA,set:setCompareA},{label:"Titolo B",color:"#5B8DEF",val:compareB,set:setCompareB}].map(({label,color,val,set}) => (
                        <div key={label} style={{ flex:1, minWidth:180 }}>
                          <div style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>{label}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {stocks.map(s => (
                              <button key={s.id} onClick={() => set(s)} style={{ background: val?.id===s.id?color:"#13151c", border:`1px solid ${val?.id===s.id?color:"#2a2d35"}`, color: val?.id===s.id?"#0D0F14":"#888", fontFamily:"inherit", fontSize:12, fontWeight:500, padding:"5px 13px", borderRadius:4, cursor:"pointer", transition:"all 0.15s" }}>{s.ticker}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {compareA && compareB && compareA.id !== compareB.id ? (() => {
                      const rows = [
                        { l:"Prezzo Acquisto", a:`${sym}${fmt(compareA.buyPrice*rate)}`, b:`${sym}${fmt(compareB.buyPrice*rate)}` },
                        { l:"Prezzo Attuale",  a:`${sym}${fmt(compareA.currentPrice*rate)}`, b:`${sym}${fmt(compareB.currentPrice*rate)}` },
                        { l:"Quantità",        a:compareA.qty, b:compareB.qty },
                        { l:"Valore Posizione",a:`${sym}${fmt(compareA.qty*compareA.currentPrice*rate)}`, b:`${sym}${fmt(compareB.qty*compareB.currentPrice*rate)}` },
                        { l:"P&L assoluto", a:`${(compareA.currentPrice-compareA.buyPrice)>=0?"+":""}${sym}${fmt(Math.abs((compareA.currentPrice-compareA.buyPrice)*compareA.qty*rate))}`, b:`${(compareB.currentPrice-compareB.buyPrice)>=0?"+":""}${sym}${fmt(Math.abs((compareB.currentPrice-compareB.buyPrice)*compareB.qty*rate))}`, ac:(compareA.currentPrice-compareA.buyPrice)>=0?"#5EC98A":"#E87040", bc:(compareB.currentPrice-compareB.buyPrice)>=0?"#5EC98A":"#E87040" },
                        { l:"P&L %", a:fmtPct((compareA.currentPrice-compareA.buyPrice)/compareA.buyPrice*100), b:fmtPct((compareB.currentPrice-compareB.buyPrice)/compareB.buyPrice*100), ac:(compareA.currentPrice-compareA.buyPrice)>=0?"#5EC98A":"#E87040", bc:(compareB.currentPrice-compareB.buyPrice)>=0?"#5EC98A":"#E87040" },
                        { l:"Settore", a:compareA.sector, b:compareB.sector },
                        { l:"Note", a:notes[compareA.id]||"—", b:notes[compareB.id]||"—", small:true },
                      ];
                      return (
                        <>
                          <div style={{ display:"grid", gridTemplateColumns:"130px 1fr 1fr", gap:2, marginBottom:2 }}>
                            <div/>
                            {[{t:compareA.ticker,c:"#F4C542"},{t:compareB.ticker,c:"#5B8DEF"}].map(({t,c}) => (
                              <div key={t} style={{ background:"#0f1117", border:`1px solid ${c}22`, borderRadius:"6px 6px 0 0", padding:"8px 14px", textAlign:"center" }}>
                                <span style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:c }}>{t}</span>
                              </div>
                            ))}
                          </div>
                          {rows.map(m => (
                            <div key={m.l} style={{ display:"grid", gridTemplateColumns:"130px 1fr 1fr", gap:2, marginBottom:2 }}>
                              <div style={{ background:"#0f1117", border:"1px solid #1a1d26", padding:"8px 12px", fontSize:8, color:"#555", textTransform:"uppercase", letterSpacing:"0.08em", display:"flex", alignItems:"center" }}>{m.l}</div>
                              {[{v:m.a,c:m.ac},{v:m.b,c:m.bc}].map(({v,c},j) => (
                                <div key={j} style={{ background:"#0f1117", border:"1px solid #1a1d26", padding:"8px 14px", fontSize:m.small?11:12, color:c||"#E8E6DF", display:"flex", alignItems:"center" }}>{v}</div>
                              ))}
                            </div>
                          ))}
                          <div className="card" style={{ marginTop:16 }}>
                            <div style={{ fontSize:8, color:"#444", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:12 }}>Andamento comparato</div>
                            <ResponsiveContainer width="100%" height={180}>
                              <AreaChart>
                                <defs>
                                  <linearGradient id="cA" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F4C542" stopOpacity={0.15}/><stop offset="95%" stopColor="#F4C542" stopOpacity={0}/></linearGradient>
                                  <linearGradient id="cB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#5B8DEF" stopOpacity={0.15}/><stop offset="95%" stopColor="#5B8DEF" stopOpacity={0}/></linearGradient>
                                </defs>
                                <XAxis dataKey="date" tick={{fill:"#2a2d35",fontSize:9}} axisLine={false} tickLine={false} interval={6} data={compareA.history}/>
                                <YAxis tick={{fill:"#2a2d35",fontSize:9}} axisLine={false} tickLine={false} domain={["auto","auto"]} width={50} tickFormatter={v=>`${sym}${v}`}/>
                                <Tooltip contentStyle={{background:"#0f1117",border:"1px solid #2a2d35",borderRadius:4,fontSize:11,color:"#E8E6DF"}}/>
                                <Area type="monotone" data={compareA.history} dataKey="price" name={compareA.ticker} stroke="#F4C542" strokeWidth={1.5} fill="url(#cA)" dot={false}/>
                                <Area type="monotone" data={compareB.history} dataKey="price" name={compareB.ticker} stroke="#5B8DEF" strokeWidth={1.5} fill="url(#cB)" dot={false}/>
                              </AreaChart>
                            </ResponsiveContainer>
                            <div style={{ display:"flex", gap:16, justifyContent:"center", marginTop:8 }}>
                              {[{t:compareA.ticker,c:"#F4C542"},{t:compareB.ticker,c:"#5B8DEF"}].map(({t,c}) => (
                                <div key={t} style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#666" }}>
                                  <div style={{ width:16, height:2, background:c, borderRadius:1 }}/> {t}
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      );
                    })() : <div style={{ color:"#2a2d35", textAlign:"center", marginTop:50, fontSize:13 }}>Seleziona due titoli diversi per confrontarli.</div>}
                  </ProGate>
                </div>
              )}

              {/* ALERT */}
              {activeTab === "alert" && (
                <div className="fade-up">
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300 }}>Alert Prezzi</div>
                    <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Notifica quando un titolo supera i tuoi target</div>
                  </div>
                  <ProGate feat="alerts" h={200}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {stocks.map(s => {
                        const a = alerts[s.id] || {};
                        return (
                          <div key={s.id} className="card" style={{ display:"flex", alignItems:"center", gap:18, flexWrap:"wrap" }}>
                            <div style={{ minWidth:80 }}>
                              <div style={{ fontSize:14, fontWeight:500 }}>{s.ticker}</div>
                              <div style={{ fontSize:9, color:"#555", marginTop:2 }}>Attuale: {sym}{fmt(s.currentPrice*rate)}</div>
                            </div>
                            <div style={{ display:"flex", gap:14, flex:1, flexWrap:"wrap", alignItems:"flex-end" }}>
                              <div style={{ flex:1, minWidth:110 }}>
                                <div style={{ fontSize:8, color:"#444", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:5 }}>🔼 Alert sopra</div>
                                <input type="number" placeholder={`${(s.currentPrice*1.1).toFixed(0)}`} value={a.above||""}
                                  onChange={e => setAlerts(al => ({ ...al, [s.id]: { ...(al[s.id]||{}), above: e.target.value ? parseFloat(e.target.value) : null } }))} style={{ width:"100%" }}/>
                              </div>
                              <div style={{ flex:1, minWidth:110 }}>
                                <div style={{ fontSize:8, color:"#444", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:5 }}>🔽 Alert sotto</div>
                                <input type="number" placeholder={`${(s.currentPrice*0.9).toFixed(0)}`} value={a.below||""}
                                  onChange={e => setAlerts(al => ({ ...al, [s.id]: { ...(al[s.id]||{}), below: e.target.value ? parseFloat(e.target.value) : null } }))} style={{ width:"100%" }}/>
                              </div>
                              {(a.above || a.below) && (
                                <button onClick={() => setAlerts(al => { const n={...al}; delete n[s.id]; return n; })}
                                  style={{ background:"none", border:"1px solid #2a2d35", color:"#E87040", fontFamily:"inherit", fontSize:9, padding:"5px 10px", borderRadius:3, cursor:"pointer", whiteSpace:"nowrap" }}>
                                  ✕ Rimuovi
                                </button>
                              )}
                            </div>
                            {(a.above || a.below) && <span style={{ fontSize:9, color:"#5EC98A" }}>🔔 attivo</span>}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop:16, padding:"12px 16px", background:"#0a0c10", borderRadius:6, fontSize:9, color:"#2a2d35", lineHeight:1.8 }}>
                      In produzione: notifiche via <strong style={{color:"#333"}}>email</strong> (Resend) e <strong style={{color:"#333"}}>push</strong> (Web Push API) · Alert controllati ogni 60s durante l'orario di borsa
                    </div>
                  </ProGate>
                </div>
              )}

              {/* SIMULAZIONI */}
              {activeTab === "simulazioni" && (
                <SimulazioniTab stocks={stocks} sym={sym} rate={rate} fmt={fmt} fmtPct={fmtPct} />
              )}

              {activeTab === "whatif" && (
                <WhatIfTab fmt={fmt} fmtPct={fmtPct} eurRate={eurRate} />
              )}

            </div>
          </div>

          {/* Edit modal */}
          {editId && stocks.find(s => s.id === editId) && (
            <EditModal
              stock={stocks.find(s => s.id === editId)}
              onClose={() => setEditId(null)}
              onSave={handleEdit}
            />
          )}

          {/* Stock detail modal */}
          {selectedId && stocks.find(s => s.id === selectedId) && (
            <StockModal
              stock={stocks.find(s => s.id === selectedId)}
              onClose={() => setSelectedId(null)}
              notes={notes} setNotes={setNotes}
              alerts={alerts} setAlerts={setAlerts}
              handleRemove={handleRemove}
              sym={sym} rate={rate} fmt={fmt} fmtPct={fmtPct}
              handleAI={handleAI} aiLoading={aiLoading} aiText={aiText}
              plan={plan} eurRate={eurRate}
            />
          )}

          {/* Mobile portfolio summary */}
          <div className="mobile-portfolio-header" style={{ padding: "12px 16px", borderBottom: "1px solid #161820", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 8, color: "#2a2d35", letterSpacing: "0.18em", textTransform: "uppercase" }}>Portafoglio</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, color: "#E8E6DF" }}>{sym}{fmt(totalValue)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: totalPnL >= 0 ? "#5EC98A" : "#E87040", fontWeight: 500 }}>{totalPnL >= 0 ? "+" : ""}{sym}{fmt(Math.abs(totalPnL))}</div>
              <div style={{ fontSize: 10, color: totalPct >= 0 ? "#5EC98A" : "#E87040" }}>{fmtPct(totalPct)}</div>
            </div>
          </div>

          {/* Mobile bottom navigation */}
          <div className="mobile-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0a0c10", borderTop: "1px solid #161820", zIndex: 999, justifyContent: "space-around", alignItems: "center", padding: "6px 0", paddingBottom: "env(safe-area-inset-bottom)" }}>
            {[
              { id: "overview",    icon: "◈",  label: "Overview" },
              { id: "titoli",      icon: "📋", label: "Titoli" },
              { id: "settori",     icon: "◉",  label: "Settori" },
              { id: "watchlist",   icon: "👁", label: "Watch" },
              { id: "whatif",      icon: "🔁", label: "E se?" },
              { id: "alert",       icon: "🔔", label: "Alert" },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 8px", color: activeTab === t.id ? "#F4C542" : "#444", fontFamily: "inherit", transition: "color 0.15s" }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>{t.label}</span>
              </button>
            ))}
          </div>

        </div>
      </CurrencyCtx.Provider>
    </PlanCtx.Provider>
  );
}
