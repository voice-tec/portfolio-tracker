import { useState } from "react";
import { updateProfile, updatePassword, deleteAccount, signOut } from "../utils/supabase";

function Spinner({ size = 14, color = "#4361ee" }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", border: `1.5px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />;
}

const SECTIONS = ["Profilo", "Sicurezza", "Dati & Privacy"];

export function SettingsModal({ user, stocks, onClose, onSignOut }) {
  const [section, setSection] = useState("Profilo");
  const [name, setName] = useState(user?.name || "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const inputStyle = {
    background: "#F8FAFF", border: "1.5px solid #E0E8F4", color: "#0A1628",
    fontFamily: "inherit", fontSize: 13, padding: "11px 14px", borderRadius: 10,
    outline: "none", width: "100%", transition: "all 0.15s",
  };

  async function saveName() {
    if (!name.trim()) return setErr("Il nome non può essere vuoto.");
    setLoading(true); setErr(""); setMsg("");
    try {
      await updateProfile(name.trim());
      setMsg("Nome aggiornato con successo.");
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  async function savePassword() {
    if (!pw) return setErr("Inserisci la nuova password.");
    if (pw.length < 6) return setErr("La password deve avere almeno 6 caratteri.");
    if (pw !== pw2) return setErr("Le password non coincidono.");
    setLoading(true); setErr(""); setMsg("");
    try {
      await updatePassword(pw);
      setMsg("Password aggiornata con successo.");
      setPw(""); setPw2("");
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  async function handleDeleteAccount() {
    if (deleteText !== "ELIMINA") return setErr('Scrivi "ELIMINA" per confermare.');
    setLoading(true);
    try {
      await deleteAccount(user.id);
      onSignOut();
    } catch (e) { setErr(e.message); setLoading(false); }
  }

  function exportData() {
    const csv = ["ticker,qty,buyPrice,sector,buyDate",
      ...stocks.map(s => `${s.ticker},${s.qty},${s.buyPrice},${s.sector || ""},${s.buyDate || ""}`)
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `trackfolio_export_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const sectionIcon = { "Profilo": "👤", "Sicurezza": "🔒", "Piano": "⭐", "Dati & Privacy": "🛡️" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,22,40,0.5)", backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "90vh", overflow: "hidden", display: "flex", boxShadow: "0 24px 80px rgba(10,22,40,0.2)", animation: "fadeUp 0.2s ease" }}>

        {/* Sidebar */}
        <div style={{ width: 180, background: "#F8FAFF", borderRight: "1px solid #E8EBF4", padding: "24px 0", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 16px 20px", borderBottom: "1px solid #E8EBF4", marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, #4361ee, #3a0ca3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
              {user?.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0A1628", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
            <div style={{ fontSize: 10, color: "#8A9AB0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>

          </div>
          {SECTIONS.map(s => (
            <button key={s} onClick={() => { setSection(s); setMsg(""); setErr(""); }} style={{
              background: section === s ? "#fff" : "none",
              border: "none", borderLeft: `2px solid ${section === s ? "#4361ee" : "transparent"}`,
              color: section === s ? "#0A1628" : "#8A9AB0",
              fontFamily: "inherit", fontSize: 12, fontWeight: section === s ? 600 : 400,
              padding: "10px 16px", cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 14 }}>{sectionIcon[s]}</span> {s}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={() => { signOut(); onSignOut(); }} style={{
            background: "none", border: "none", color: "#E87040", fontFamily: "inherit",
            fontSize: 12, padding: "10px 16px", cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>🚪</span> Esci
          </button>
        </div>

        {/* Contenuto */}
        <div style={{ flex: 1, padding: "28px 28px", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0A1628", letterSpacing: "-0.01em" }}>{section}</h2>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8A9AB0", fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>

          {msg && <div style={{ fontSize: 12, color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>✓ {msg}</div>}
          {err && <div style={{ fontSize: 12, color: "#ef4444", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>⚠️ {err}</div>}

          {/* ── PROFILO ── */}
          {section === "Profilo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>Nome visualizzato</div>
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
                  onFocus={e => e.target.style.borderColor = "#4361ee"}
                  onBlur={e => e.target.style.borderColor = "#E0E8F4"} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>Email</div>
                <input style={{ ...inputStyle, background: "#F0F2F7", color: "#8A9AB0", cursor: "not-allowed" }} value={user?.email} disabled />
                <div style={{ fontSize: 10, color: "#A0AABF", marginTop: 4 }}>L'email non può essere modificata.</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>Statistiche account</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {[
                    { l: "Titoli", v: stocks.length },
                    { l: "Portafoglio", v: `$${stocks.reduce((s, x) => s + (x.qty || 0) * (x.currentPrice || 0), 0).toFixed(0)}` },
                  ].map(({ l, v }) => (
                    <div key={l} style={{ background: "#F8FAFF", borderRadius: 10, padding: "12px 14px", border: "1px solid #E8EBF4" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#0A1628" }}>{v}</div>
                      <div style={{ fontSize: 10, color: "#8A9AB0", marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={saveName} disabled={loading} style={{
                background: "#0A1628", border: "none", color: "#fff", fontFamily: "inherit",
                fontSize: 13, fontWeight: 700, padding: "12px 24px", borderRadius: 10,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-start",
              }}>
                {loading ? <Spinner color="#fff" /> : null} Salva modifiche
              </button>
            </div>
          )}

          {/* ── SICUREZZA ── */}
          {section === "Sicurezza" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ background: "#F8FAFF", borderRadius: 10, padding: "14px 16px", border: "1px solid #E8EBF4", fontSize: 12, color: "#5A6A7E", lineHeight: 1.6 }}>
                🔒 La password deve avere almeno 6 caratteri. Ti consigliamo di usare una combinazione di lettere, numeri e simboli.
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>Nuova password</div>
                <input style={inputStyle} type="password" placeholder="Minimo 6 caratteri" value={pw} onChange={e => setPw(e.target.value)}
                  onFocus={e => e.target.style.borderColor = "#4361ee"}
                  onBlur={e => e.target.style.borderColor = "#E0E8F4"} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#8A9AB0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>Conferma password</div>
                <input style={inputStyle} type="password" placeholder="Ripeti la password" value={pw2} onChange={e => setPw2(e.target.value)}
                  onFocus={e => e.target.style.borderColor = "#4361ee"}
                  onBlur={e => e.target.style.borderColor = "#E0E8F4"} />
              </div>
              <button onClick={savePassword} disabled={loading} style={{
                background: "#0A1628", border: "none", color: "#fff", fontFamily: "inherit",
                fontSize: 13, fontWeight: 700, padding: "12px 24px", borderRadius: 10,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 8, alignSelf: "flex-start",
              }}>
                {loading ? <Spinner color="#fff" /> : null} Aggiorna password
              </button>
            </div>
          )}

          {/* ── DATI & PRIVACY ── */}
          {section === "Dati & Privacy" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ background: "#F8FAFF", borderRadius: 10, padding: "14px 16px", border: "1px solid #E8EBF4" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0A1628", marginBottom: 4 }}>I tuoi dati</div>
                <div style={{ fontSize: 12, color: "#8A9AB0", lineHeight: 1.6, marginBottom: 12 }}>
                  Hai il diritto di esportare o eliminare tutti i tuoi dati ai sensi del GDPR (Reg. UE 2016/679).
                </div>
                <button onClick={exportData} style={{
                  background: "#0A1628", border: "none", color: "#fff", fontFamily: "inherit",
                  fontSize: 12, fontWeight: 700, padding: "10px 20px", borderRadius: 8,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                }}>
                  ↓ Esporta dati (CSV)
                </button>
              </div>

              <div style={{ background: "#FEF2F2", borderRadius: 10, padding: "14px 16px", border: "1px solid #FECACA" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626", marginBottom: 4 }}>Zona pericolosa</div>
                <div style={{ fontSize: 12, color: "#7F1D1D", lineHeight: 1.6, marginBottom: 12 }}>
                  L'eliminazione del profilo è permanente e irreversibile. Tutti i tuoi dati (portafoglio, note, alert) verranno cancellati.
                </div>
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)} style={{
                    background: "#DC2626", border: "none", color: "#fff", fontFamily: "inherit",
                    fontSize: 12, fontWeight: 700, padding: "10px 20px", borderRadius: 8, cursor: "pointer",
                  }}>
                    🗑 Elimina profilo
                  </button>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 12, color: "#7F1D1D", fontWeight: 600 }}>Scrivi "ELIMINA" per confermare:</div>
                    <input style={{ ...inputStyle, border: "1.5px solid #FECACA", background: "#fff" }}
                      value={deleteText} onChange={e => setDeleteText(e.target.value)}
                      placeholder='Scrivi ELIMINA' />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={handleDeleteAccount} disabled={loading} style={{
                        background: "#DC2626", border: "none", color: "#fff", fontFamily: "inherit",
                        fontSize: 12, fontWeight: 700, padding: "10px 16px", borderRadius: 8, cursor: "pointer",
                      }}>
                        {loading ? <Spinner color="#fff" size={12} /> : "Conferma eliminazione"}
                      </button>
                      <button onClick={() => { setConfirmDelete(false); setDeleteText(""); setErr(""); }} style={{
                        background: "none", border: "1px solid #E0E8F4", color: "#8A9AB0", fontFamily: "inherit",
                        fontSize: 12, padding: "10px 16px", borderRadius: 8, cursor: "pointer",
                      }}>Annulla</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
