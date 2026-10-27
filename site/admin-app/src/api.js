// Verbindung zu leaserun.com: dieselben Schnittstellen wie der Web-Admin (gleiche Daten, gleiche Rechte, gleiche Protokolle).
// Anmeldung über Supabase (E-Mail + Passwort + zweiter Faktor oder Apple/Google), Sitzung verschlüsselt im Schlüsselbund.
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

export const BASE = Constants.expoConfig?.extra?.api || 'https://leaserun.com';
const KEY = 'lr-admin-session-v2';
const SCOPE_KEY = 'lr-admin-scope';
let session = null;
let cfg = null;
let scope = 'b2c';
const listeners = new Set();

export const onSession = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(session); } catch { /* ignore */ } });

export async function loadSession() {
  try { session = JSON.parse((await SecureStore.getItemAsync(KEY)) || 'null'); } catch { session = null; }
  try { const s = await SecureStore.getItemAsync(SCOPE_KEY); if (s === 'b2b' || s === 'b2c') scope = s; } catch { /* ignore */ }
  return session;
}
export const getSession = () => session;
export async function setSession(s) {
  session = s;
  try { if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s)); else await SecureStore.deleteItemAsync(KEY); } catch { /* ignore */ }
  emit();
}
export const getScope = () => scope;
export async function setScope(s) { scope = s === 'b2b' ? 'b2b' : 'b2c'; try { await SecureStore.setItemAsync(SCOPE_KEY, scope); } catch { /* ignore */ } }

export async function config() {
  if (cfg) return cfg;
  const r = await fetch(`${BASE}/api/supabase-config`);
  if (!r.ok) throw new Error('Server nicht erreichbar.');
  cfg = await r.json();
  return cfg;
}

const toSession = (d) => ({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: d.user ? { id: d.user.id, email: d.user.email } : session?.user });

async function auth(path, body, token) {
  const c = await config();
  const r = await fetch(`${c.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: c.key, 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.msg || d.error_description || d.message || 'Anmeldung fehlgeschlagen.');
  return d;
}

// Schritt 1: E-Mail + Passwort. Liefert { mfa: factorId } wenn der zweite Faktor nötig ist.
export async function signIn(email, password) {
  let d;
  try { d = await auth('token?grant_type=password', { email: email.trim().toLowerCase(), password }); }
  catch (e) { throw new Error(/invalid/i.test(e.message) ? 'E-Mail oder Passwort stimmt nicht.' : e.message); }
  return afterTokens(d);
}
export async function afterTokens(d) {
  const s = toSession(d);
  const c = await config();
  const u = await fetch(`${c.url}/auth/v1/user`, { headers: { apikey: c.key, Authorization: `Bearer ${s.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  s.user = { id: u.id, email: u.email };
  const totp = (u.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
  if (totp) { session = s; return { mfa: totp.id, tmp: s }; }
  await setSession(s);
  return { ok: true };
}
// Schritt 2: 6-stelliger Code aus der Authenticator-App.
export async function verifyMfa(factorId, code, tmp) {
  const ch = await auth(`factors/${factorId}/challenge`, {}, tmp.access_token);
  const d = await auth(`factors/${factorId}/verify`, { challenge_id: ch.id, code: String(code).replace(/\D/g, '') }, tmp.access_token).catch((e) => { throw new Error(/invalid|expired/i.test(e.message) ? 'Code ungültig oder abgelaufen.' : e.message); });
  await setSession({ ...toSession(d), user: tmp.user });
  return true;
}
// Apple / Google: über die Supabase-Anmeldeseite, Rücksprung in die App (leaserun-admin://auth).
export async function oauthUrl(provider, redirect) {
  const c = await config();
  return `${c.url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirect)}`;
}
export async function providers() {
  try { const c = await config(); const r = await fetch(`${c.url}/auth/v1/settings`, { headers: { apikey: c.key } }); const d = await r.json(); return d.external || {}; } catch { return {}; }
}
export function tokensFromUrl(url) {
  const h = String(url).split('#')[1] || String(url).split('?')[1] || '';
  const q = new URLSearchParams(h);
  if (!q.get('access_token')) return null;
  return { access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: Number(q.get('expires_in') || 3600) };
}

let refreshing = null;
async function refresh() {
  if (!session?.refresh_token) return false;
  refreshing ||= auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    .then(async (d) => { await setSession({ ...toSession(d), user: session.user }); return true; })
    .catch(async () => { await setSession(null); return false; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function signOut() {
  try { if (session) { const c = await config(); await fetch(`${c.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: c.key, Authorization: `Bearer ${session.access_token}` } }); } } catch { /* ignore */ }
  await setSession(null);
}

// Schnittstellen-Aufruf mit Bereich (B2C/B2B) wie im Web-Admin. Antwort: { ok, status, data }.
export async function api(path, opts = {}, retry = true) {
  if (session && session.expires_at && session.expires_at - 60 < Date.now() / 1000) await refresh();
  const headers = { Authorization: `Bearer ${session?.access_token || ''}`, 'x-admin-scope': opts.scope || scope, accept: 'application/json', ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) };
  let r;
  try { r = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body }); }
  catch { return { ok: false, status: 0, data: { error: 'Keine Verbindung. Bitte Netz prüfen.' } }; }
  if (r.status === 401 && retry && (await refresh())) return api(path, opts, false);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
export const post = (path, body, opts = {}) => api(path, { ...opts, method: 'POST', body: JSON.stringify(body) });
