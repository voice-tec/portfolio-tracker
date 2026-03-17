import { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, ScatterChart, Scatter } from "recharts";
import { API_BASE } from "../utils/api";

const col  = v => v == null ? "#8A9AB0" : v >= 0 ? "#16A34A" : "#DC2626";
const sign = v => v != null && v >= 0 ? "+" : "";
const fmtPct = (v, d = 1) => v != null ? `${sign(v)}${Math.abs(v).toFixed(d)}%` : "—";

// ── 1. CONCENTRAZIONE DI RISCHIO ─────────────────────────────────────────────
export function RiskConcentration({ stocks }) {
  const [histories, setHistories] = useState({});
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (stocks.length < 2) return;
    setLoading(true);
    Promise.all(
      stocks.map(s =>
        fetch(`${API_BASE}/api/history?symbol=${encodeURIComponent(s.ticker)}&days=252`)
          .then(r => r.json())
          .then(d => ({ ticker: s.ticker, candles: d.candles || [] }))
          .catch(() => ({ ticker: s.ticker, candles: [] }))
      )
    ).then(results => {
      const map = {};
      results.forEach(({ ticker, candles }) => { map[ticker] = candles; });
      setHistories(map);
      setLoading(false);
    });
  }, [stocks.map(s => s.ticker).join(",")]);

  // Calcola correlazioni tra tutti i titoli
  const correlations = useMemo(() => {
    const tickers = Object.keys(histories).filter(t => histories[t].length > 20);
    if (tickers.length < 2) return [];

    // Rendimenti giornalieri per ticker
    const returns = {};
    tickers.forEach(t => {
      const c = histories[t];
      returns[t] = c.slice(1).map((p, i) => (p.price - c[i].price) / c[i].price);
    });

    // Correlazione di Pearson tra ogni coppia
    const result = [];
    for (let i = 0; i < tickers.length; i++) {
      for (let j = i + 1; j < tickers.length; j++) {
        const a = returns[tickers[i]];
        const b = returns[tickers[j]];
        const n = Math.min(a.length, b.length);
        if (n < 10) continue;

        const meanA = a.slice(-n).reduce((s, r) => s + r, 0) / n;
        const meanB = b.slice(-n).reduce((s, r) => s + r, 0) / n;
        let num = 0, da = 0, db = 0;
        for (let k = 0; k < n; k++) {
          num += (a[a.length - n + k] - meanA) * (b[b.length - n + k] - meanB);
          da  += (a[a.length - n + k] - meanA) ** 2;
          db  += (b[b.length - n + k] - meanB) ** 2;
        }
        const corr = da * db > 0 ? num / Math.sqrt(da * db) : 0;
        result.push({
          pair:  `${tickers[i]} / ${tickers[j]}`,
          a:     tickers[i],
          b:     tickers[j],
          corr:  parseFloat(corr.toFixed(2)),
        });
      }
    }
    return result.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));
  }, [histories]);

  // Volatilità portafoglio vs singoli titoli
  const volData = useMemo(() => {
    return Object.entries(histories).map(([ticker, candles]) => {
      if (candles.length < 20) return null;
      const rets = candles.slice(1).map((p, i) => (p.price - candles[i].price) / candles[i].price);
      const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
      const vol  = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length) * Math.sqrt(252) * 100;
      return { ticker, vol: parseFloat(vol.toFixed(1)) };
    }).filter(Boolean).sort((a, b) => b.vol - a.vol);
  }, [histories]);

  const avgCorr = correlations.length
    ? parseFloat((correlations.reduce((s, c) => s + Math.abs(c.corr), 0) / correlations.length).toFixed(2))
    : null;

  const riskLevel = avgCorr == null ? null
    : avgCorr > 0.7 ? { label: "Alto", color: "#DC2626", desc: "I tuoi titoli si muovono quasi insieme — poca diversificazione reale" }
    : avgCorr > 0.4 ? { label: "Medio", color: "#F97316", desc: "Correlazione moderata — diversificazione parziale" }
    : { label: "Basso", color: "#16A34A", desc: "Buona diversificazione — i titoli si muovono in modo indipendente" };

  if (stocks.length < 2) return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
        🔗 Concentrazione di Rischio
      </div>
      <div style={{ fontSize: 11, color: "#8A9AB0", textAlign: "center", padding: "20px 0" }}>
        Aggiungi almeno 2 titoli per vedere la correlazione
      </div>
    </div>
  );

  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
        🔗 Concentrazione di Rischio
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: "#8A9AB0" }}>Calcolo correlazioni…</div>
      ) : (
        <>
          {/* Livello rischio */}
          {riskLevel && (
            <div style={{ padding: "10px 14px", borderRadius: 10, background: riskLevel.color + "10", border: `1px solid ${riskLevel.color}25`, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: riskLevel.color, minWidth: 60 }}>{riskLevel.label}</div>
              <div style={{ fontSize: 10, color: "#5A6A7E", lineHeight: 1.5 }}>{riskLevel.desc}</div>
            </div>
          )}

          {/* Correlazioni per coppia */}
          {correlations.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 8 }}>Correlazione tra titoli (ultimi 12 mesi)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {correlations.slice(0, 6).map(c => {
                  const corrColor = Math.abs(c.corr) > 0.7 ? "#DC2626" : Math.abs(c.corr) > 0.4 ? "#F97316" : "#16A34A";
                  return (
                    <div key={c.pair} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#0A1628", width: 100, flexShrink: 0 }}>{c.pair}</span>
                      <div style={{ flex: 1, height: 6, background: "#F0F2F7", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.abs(c.corr) * 100}%`, background: corrColor, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: corrColor, width: 36, textAlign: "right", flexShrink: 0 }}>{c.corr}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Volatilità per titolo */}
          {volData.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 8 }}>Volatilità annualizzata per titolo</div>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={volData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barSize={20}>
                  <XAxis dataKey="ticker" tick={{ fontSize: 9, fill: "#8A9AB0" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 10 }}
                    formatter={v => [`${v}%`, "Volatilità"]} />
                  <Bar dataKey="vol" radius={[3, 3, 0, 0]}>
                    {volData.map((d, i) => (
                      <Cell key={i} fill={d.vol > 40 ? "#DC2626" : d.vol > 25 ? "#F97316" : "#16A34A"} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 2. EARNINGS IMPACT ───────────────────────────────────────────────────────
export function EarningsImpact({ ticker }) {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    fetch(`${API_BASE}/api/analyst?symbol=${encodeURIComponent(ticker)}&earnings=true`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!ticker) return null;

  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          📊 Earnings Impact — {ticker}
        </div>
        {data?.nextEarnings && (
          <div style={{ fontSize: 9, background: "#EEF4FF", color: "#4361ee", padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>
            Prossimi: {new Date(data.nextEarnings + "T12:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: "#8A9AB0" }}>Caricamento dati earnings…</div>
      ) : !data?.earnings?.length ? (
        <div style={{ fontSize: 11, color: "#8A9AB0", textAlign: "center", padding: "20px 0" }}>
          Dati earnings non disponibili
        </div>
      ) : (
        <>
          {/* KPI stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
            {[
              { l: "Beat Rate", v: data.stats.beatRate != null ? `${data.stats.beatRate}%` : "—", c: data.stats.beatRate > 60 ? "#16A34A" : "#F97316" },
              { l: "Mossa su beat", v: fmtPct(data.stats.avgMoveOnBeat), c: col(data.stats.avgMoveOnBeat) },
              { l: "Mossa su miss", v: fmtPct(data.stats.avgMoveOnMiss), c: col(data.stats.avgMoveOnMiss) },
              { l: "Media 2 sett.", v: fmtPct(data.stats.avgMove2w), c: col(data.stats.avgMove2w) },
            ].map(k => (
              <div key={k.l} style={{ textAlign: "center", background: "#F8FAFF", borderRadius: 8, padding: "8px 4px" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: k.c }}>{k.v}</div>
                <div style={{ fontSize: 8, color: "#8A9AB0", marginTop: 2 }}>{k.l}</div>
              </div>
            ))}
          </div>

          {/* Grafico movimenti per earnings */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 8 }}>Movimento prezzo il giorno degli earnings</div>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart
                data={data.earnings.slice(0, 8).reverse()}
                margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
              >
                <XAxis dataKey="quarter" tick={{ fontSize: 8, fill: "#8A9AB0" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: "#8A9AB0" }} axisLine={false} tickLine={false} width={28} tickFormatter={v => `${v}%`} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8EBF4", borderRadius: 8, fontSize: 10, padding: "4px 8px" }}
                  formatter={(v, n, p) => [`${v >= 0 ? "+" : ""}${v}%`, p.payload.beat ? "✅ Beat" : "❌ Miss"]} />
                <ReferenceLine y={0} stroke="#E0E4EF" />
                <Bar dataKey="moveDay" radius={[3, 3, 0, 0]}>
                  {data.earnings.slice(0, 8).reverse().map((e, i) => (
                    <Cell key={i} fill={e.moveDay >= 0 ? "#16A34A" : "#DC2626"} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Lista dettaglio earnings */}
          <div>
            <div style={{ fontSize: 9, color: "#8A9AB0", marginBottom: 8 }}>Dettaglio ultimi trimestri</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "70px 50px 50px 60px 55px 55px", gap: 8, fontSize: 8, color: "#C0C8D8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <span>Trimestre</span><span>EPS est.</span><span>EPS att.</span><span>Sorpresa</span><span>Giorno</span><span>2 sett.</span>
              </div>
              {data.earnings.slice(0, 8).map((e, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "70px 50px 50px 60px 55px 55px",
                  gap: 8, alignItems: "center", padding: "4px 0",
                  borderBottom: "1px solid #F8FAFF",
                }}>
                  <span style={{ fontSize: 10, color: "#0A1628", fontWeight: 600 }}>{e.quarter}</span>
                  <span style={{ fontSize: 10, color: "#8A9AB0" }}>{e.epsEstimate != null ? `$${e.epsEstimate.toFixed(2)}` : "—"}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: e.beat ? "#16A34A" : "#DC2626" }}>
                    {e.epsActual != null ? `$${e.epsActual.toFixed(2)}` : "—"}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: e.beat ? "#16A34A" : "#DC2626" }}>
                    {e.beat ? "✅" : "❌"} {e.surprise != null ? `${e.surprise > 0 ? "+" : ""}${e.surprise.toFixed(1)}%` : ""}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: col(e.moveDay) }}>
                    {fmtPct(e.moveDay)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: col(e.move2w) }}>
                    {fmtPct(e.move2w)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
