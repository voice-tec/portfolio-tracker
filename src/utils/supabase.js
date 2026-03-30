// src/utils/supabase.js
import { createClient } from '@supabase/supabase-js'
import { displayToISO } from './dates'

function normalizeBuyDate(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return displayToISO(d);
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ─── AUTH ─────────────────────────────────────────────────────────────────────
export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { name } }
  })
  if (error) throw error
  return data.user
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.user
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://www.trackfolio.eu',
      queryParams: { access_type: 'offline', prompt: 'consent' },
    }
  })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user || null
}

export async function updateProfile(name) {
  const { data, error } = await supabase.auth.updateUser({
    data: { name }
  })
  if (error) throw error
  return data.user
}

export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword
  })
  if (error) throw error
  return data.user
}

export async function deleteAccount(userId) {
  // Elimina tutti i dati utente prima
  await supabase.from('stocks').delete().eq('user_id', userId)
  await supabase.from('notes').delete().eq('user_id', userId)
  await supabase.from('alerts').delete().eq('user_id', userId)
  // Poi esci — la cancellazione account richiede service_role key (lato server)
  await supabase.auth.signOut()
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '?reset=true',
  })
  if (error) throw error
}

// ─── STOCKS ───────────────────────────────────────────────────────────────────
export async function loadStocks(userId) {
  const { data, error } = await supabase
    .from('stocks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function saveStock(userId, stock) {
  const row = {
    user_id:       userId,
    ticker:        stock.ticker,
    qty:           stock.qty,
    buy_price:     stock.buyPrice,
    current_price: stock.currentPrice,
    sector:        stock.sector || 'Altro',
    buy_date:      normalizeBuyDate(stock.buyDate),
    price_real:    stock.priceReal || false,
    target_price:  stock.targetPrice || null,
    stop_loss:     stock.stopLoss || null,
  }
  const { data, error } = await supabase
    .from('stocks')
    .upsert({ ...row, id: stock.dbId || undefined }, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteStock(dbId) {
  const { error } = await supabase.from('stocks').delete().eq('id', dbId)
  if (error) throw error
}

// ─── NOTES ────────────────────────────────────────────────────────────────────
export async function loadNotes(userId) {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
  if (error) throw error
  return Object.fromEntries((data || []).map(n => [n.stock_id, n.content]))
}

export async function saveNote(userId, stockDbId, content) {
  const { error } = await supabase
    .from('notes')
    .upsert({ user_id: userId, stock_id: stockDbId, content, updated_at: new Date().toISOString() }, { onConflict: 'stock_id' })
  if (error) throw error
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────
export async function loadAlerts(userId) {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
  if (error) throw error
  return Object.fromEntries((data || []).map(a => [a.stock_id, { above: a.above, below: a.below, dbId: a.id }]))
}

export async function saveAlert(userId, stockDbId, above, below) {
  const { error } = await supabase
    .from('alerts')
    .upsert({ user_id: userId, stock_id: stockDbId, above: above || null, below: below || null }, { onConflict: 'stock_id' })
  if (error) throw error
}

export async function deleteAlert(stockDbId) {
  const { error } = await supabase.from('alerts').delete().eq('stock_id', stockDbId)
  if (error) throw error
}
