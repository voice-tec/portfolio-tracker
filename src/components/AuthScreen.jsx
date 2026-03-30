import { useState, useEffect, useRef } from "react";
import { signIn, signUp, signInWithGoogle, sendPasswordReset } from "../utils/supabase";

function Spinner({ size = 14, color = "#fff" }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />;
}

// Mini grafico animato demo
function DemoChart() {
  const points = [40, 45, 42, 55, 52, 60, 58, 72, 68, 75, 80, 78, 88, 85, 92];
  const max = Math.max(...points), min = Math.min(...points);
  const norm = points.map(p => 100 - ((p - min) / (max - min)) * 80 - 10);
  const w = 280, h = 80;
  const step = w / (points.length - 1);
  const path = norm.map((y, i) => `${i === 0 ? "M" : "L"} ${i * step} ${y * h / 100}`).join(" ");
  const area = path + ` L ${(points.length - 1) * step} ${h} L 0 ${h} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ADE80" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#4ADE80" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#chartGrad)" />
      <path d={path} fill="none" stroke="#4ADE80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(points.length - 1) * step} cy={norm[norm.length - 1] * h / 100} r="4" fill="#4ADE80" />
    </svg>
  );
}

export function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("register");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [showPw, setShowPw] = useState(false);

  async function submit() {
    if (!email || !pw) return setErr("Compila tutti i campi.");
    if (mode === "register") {
      if (!name) return setErr("Inserisci il tuo nome.");
      if (pw.length < 6) return setErr("La password deve avere almeno 6 caratteri.");
      if (pw !== pw2) return setErr("Le password non coincidono.");
    }
    setLoading(true); setErr("");
    try {
      let user;
      if (mode === "register") {
        user = await signUp(email, pw, name);
        if (!user) {
          setMsg("Controlla la tua email per confermare la registrazione.");
          setLoading(false); return;
        }
      } else {
        user = await signIn(email, pw);
      }
      onAuth({ id: user.id, email: user.email, name: user.user_metadata?.name || email.split("@")[0] });
    } catch (e) {
      setErr(e.message === "Invalid login credentials" ? "Email o password errati." : e.message);
    }
    setLoading(false);
  }

  async function handleGoogle() {
    setLoadingGoogle(true); setErr("");
    try { await signInWithGoogle(); }
    catch (e) { setErr("Errore Google: " + e.message); setLoadingGoogle(false); }
  }

  async function handleReset() {
    if (!resetEmail) return setErr("Inserisci la tua email.");
    setLoading(true); setErr("");
    try {
      await sendPasswordReset(resetEmail);
      setMsg("Email di reset inviata! Controlla la tua casella.");
      setShowReset(false);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  const features = [
    { icon: "📈", title: "Performance live", desc: "Prezzi real-time e confronto S&P 500" },
    { icon: "🔮", title: "Simulazioni macro", desc: "Stress test su scenari storici reali" },
    { icon: "🔬", title: "Factor Screener", desc: "S&P 500 filtrato per Value, Momentum e Profitability" },
    { icon: "🎯", title: "Previsioni AI", desc: "Analisi statistica e target price analisti" },
    { icon: "🔔", title: "Alert prezzi", desc: "Notifiche su target e stop-loss" },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", fontFamily: "'Geist', sans-serif", background: "#fff" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;overflow-x:hidden}
        .auth-input{background:#F8FAFF;border:1.5px solid #E0E8F4;color:#0A1628;font-family:inherit;font-size:14px;padding:13px 14px;border-radius:10px;outline:none;width:100%;transition:all 0.15s}
        .auth-input:focus{border-color:#4361ee;background:#fff;box-shadow:0 0 0 3px rgba(67,97,238,0.08)}
        .auth-input::placeholder{color:#A0AABF}
        .auth-left{display:flex!important}
        @media(max-width:767px){.auth-left{display:none!important}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes floatIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}
        .google-btn:hover{background:#f0f0f0!important}
        .google-btn:active{transform:scale(0.98)}
      `}</style>

      {/* ── SINISTRA ── */}
      <div className="auth-left" style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between",
        background: "linear-gradient(160deg, #0A1628 0%, #0f2050 45%, #0d3d62 100%)",
        padding: "52px 56px", position: "relative", overflow: "hidden",
      }}>
        {/* Cerchi decorativi */}
        <div style={{ position: "absolute", top: -100, right: -100, width: 400, height: 400, borderRadius: "50%", background: "rgba(67,97,238,0.1)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 80, left: -80, width: 280, height: 280, borderRadius: "50%", background: "rgba(74,222,128,0.07)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "40%", right: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(99,130,255,0.08)", pointerEvents: "none" }} />

        {/* Logo */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, background: "linear-gradient(135deg, #4361ee, #4ADE80)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📊</div>
          <span style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>Trackfolio</span>
          <span style={{ fontSize: 10, background: "rgba(74,222,128,0.2)", color: "#4ADE80", padding: "2px 8px", borderRadius: 20, fontWeight: 600, marginLeft: 4 }}>PRO</span>
        </div>

        {/* Hero */}
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 11, color: "rgba(99,130,255,0.9)", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>
            Il tuo portafoglio, sotto controllo
          </div>
          <h2 style={{ fontSize: "clamp(28px, 3vw, 42px)", fontWeight: 800, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.02em", marginBottom: 16 }}>
            Investi con<br />
            <span style={{ background: "linear-gradient(90deg, #6382ff, #4ADE80)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              dati reali
            </span>
          </h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.8, marginBottom: 32, maxWidth: 360 }}>
            Trackfolio aggrega prezzi live, storico e analisi in un'unica dashboard professionale.
          </p>

          {/* Mini dashboard demo */}
          <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "16px 18px", marginBottom: 28, maxWidth: 360 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 3 }}>Portafoglio totale</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>$32,847</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#4ADE80" }}>+12.4%</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>YTD</div>
              </div>
            </div>
            <DemoChart />
          </div>

          {/* Features */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {features.map(({ icon, title, desc }, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, animation: `floatIn 0.4s ease ${i * 0.06}s both` }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{icon}</div>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{title}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 6 }}>— {desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: "relative", fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.7 }}>
          ⚠️ Strumento informativo. Non costituisce consulenza finanziaria ai sensi MiFID II.
        </div>
      </div>

      {/* ── DESTRA ── */}
      <div style={{ width: "100%", maxWidth: 500, background: "#fff", display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px 44px", overflowY: "auto" }}>
        <div style={{ animation: "fadeUp 0.35s ease", width: "100%", maxWidth: 380, margin: "0 auto" }}>

          {showReset ? (
            // ── RESET PASSWORD ──
            <>
              <button onClick={() => { setShowReset(false); setErr(""); }} style={{ background: "none", border: "none", color: "#8A9AB0", cursor: "pointer", fontSize: 12, padding: "0 0 20px 0", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}>
                ← Torna al login
              </button>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.02em", marginBottom: 6 }}>Reset password</h1>
              <p style={{ fontSize: 13, color: "#8A9AB0", marginBottom: 24 }}>Ti invieremo un link per reimpostare la password.</p>
              <input className="auth-input" placeholder="La tua email" type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} style={{ marginBottom: 12 }} />
              {err && <div style={{ fontSize: 11, color: "#ef4444", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>{err}</div>}
              {msg && <div style={{ fontSize: 11, color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>{msg}</div>}
              <button onClick={handleReset} disabled={loading} style={{ width: "100%", background: "#0A1628", border: "none", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, padding: "14px", borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {loading ? <Spinner /> : "Invia email di reset →"}
              </button>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.02em", marginBottom: 6 }}>
                  {mode === "register" ? "Crea il tuo account" : "Bentornato"}
                </h1>
                <p style={{ fontSize: 13, color: "#8A9AB0" }}>
                  {mode === "register" ? "Inizia a tracciare il tuo portafoglio gratuitamente." : "Accedi per vedere il tuo portafoglio."}
                </p>
              </div>

              {/* Tab toggle */}
              <div style={{ display: "flex", background: "#F4F6FB", borderRadius: 10, padding: 4, marginBottom: 24, gap: 4 }}>
                {[["register", "Registrati"], ["login", "Accedi"]].map(([m, label]) => (
                  <button key={m} onClick={() => { setMode(m); setErr(""); setMsg(""); }} style={{
                    flex: 1, background: mode === m ? "#fff" : "transparent",
                    border: "none", color: mode === m ? "#0A1628" : "#8A9AB0",
                    fontFamily: "inherit", fontSize: 12, padding: "9px", borderRadius: 7,
                    cursor: "pointer", fontWeight: mode === m ? 700 : 400,
                    boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                    transition: "all 0.15s",
                  }}>{label}</button>
                ))}
              </div>

              {/* Google */}
              <button className="google-btn" onClick={handleGoogle} disabled={loadingGoogle} style={{
                width: "100%", background: "#fff", border: "1.5px solid #E0E8F4",
                borderRadius: 10, padding: "12px", marginBottom: 16,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                color: "#0A1628", transition: "background 0.15s",
              }}>
                {loadingGoogle ? <Spinner color="#0A1628" size={16} /> : (
                  <svg width="18" height="18" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                )}
                {loadingGoogle ? "Connessione..." : "Continua con Google"}
              </button>

              {/* Divisore */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1, height: 1, background: "#F0F2F7" }} />
                <span style={{ fontSize: 11, color: "#C0C8D8" }}>oppure con email</span>
                <div style={{ flex: 1, height: 1, background: "#F0F2F7" }} />
              </div>

              {/* Form */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
                {mode === "register" && (
                  <input className="auth-input" placeholder="Il tuo nome" value={name} onChange={e => setName(e.target.value)} />
                )}
                <input className="auth-input" placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
                <div style={{ position: "relative" }}>
                  <input className="auth-input" placeholder="Password" type={showPw ? "text" : "password"} value={pw} onChange={e => setPw(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !pw2 && submit()} style={{ paddingRight: 40 }} />
                  <button onClick={() => setShowPw(v => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#8A9AB0", fontSize: 14, padding: 0 }}>
                    {showPw ? "🙈" : "👁"}
                  </button>
                </div>
                {mode === "register" && (
                  <input className="auth-input" placeholder="Conferma password" type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && submit()} />
                )}
              </div>

              {mode === "login" && (
                <div style={{ textAlign: "right", marginBottom: 12 }}>
                  <button onClick={() => { setShowReset(true); setResetEmail(email); setErr(""); }} style={{ background: "none", border: "none", color: "#4361ee", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                    Password dimenticata?
                  </button>
                </div>
              )}

              {err && <div style={{ fontSize: 11, color: "#ef4444", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>{err}</div>}
              {msg && <div style={{ fontSize: 11, color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>{msg}</div>}

              <button onClick={submit} disabled={loading} style={{
                width: "100%",
                background: "linear-gradient(135deg, #4361ee, #3a0ca3)",
                border: "none", color: "#fff", fontFamily: "inherit",
                fontSize: 14, fontWeight: 700, padding: "14px", borderRadius: 10,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: loading ? 0.75 : 1,
                boxShadow: "0 4px 16px rgba(67,97,238,0.3)",
              }}>
                {loading && <Spinner />}
                {mode === "register" ? "Crea account gratuito →" : "Entra nel portafoglio →"}
              </button>

              <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#8A9AB0" }}>
                {mode === "register" ? "Hai già un account? " : "Non hai un account? "}
                <button onClick={() => { setMode(mode === "register" ? "login" : "register"); setErr(""); setMsg(""); }} style={{ background: "none", border: "none", color: "#4361ee", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: 0 }}>
                  {mode === "register" ? "Accedi" : "Registrati gratis"}
                </button>
              </div>

              {mode === "register" && (
                <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 24, paddingTop: 20, borderTop: "1px solid #F0F2F7" }}>
                  {[["Gratis", "Per sempre"], ["100%", "Privacy"], ["Live", "Prezzi reali"]].map(([v, l]) => (
                    <div key={l} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#0A1628" }}>{v}</div>
                      <div style={{ fontSize: 10, color: "#A0AABF", marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
