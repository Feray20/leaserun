import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { secretFor, verifySecrets } from '@/lib/security/secrets';

// Microsoft Graph for the booking portal: read busy times, create/cancel Teams meetings in the Outlook calendar.
// Default: "Sign in with Microsoft" in the Web-Admin (device-code sign-in, delegated access to the owner's own calendar).
// No Azure setup needed – it uses Microsoft's public app "Microsoft Graph Command Line Tools".
// The refresh token is stored encrypted in lr_settings (ms_graph_auth).
// Alternative (advanced): your own app with MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_CALENDAR_USER (app access).
const env = (k: string) => String(process.env[k] || '').trim();
const PUBLIC_CLIENT = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
// Calendar access (for token refresh) and sign-in scope incl. OneDrive (file exchange via /files).
// Kept separate so a missing OneDrive consent on older sign-ins never breaks the calendar.
const SCOPE_CAL = 'offline_access openid profile User.Read Calendars.ReadWrite';
const SCOPE_FILES = 'offline_access Files.ReadWrite';
const SCOPE = `${SCOPE_CAL} Files.ReadWrite`;
const AUTH_KEY = 'ms_graph_auth', PENDING_KEY = 'ms_graph_pending', PKCE_KEY = 'ms_graph_pkce', ERR_KEY = 'ms_graph_last_error';
// Sign-in via link (alternative if the organization blocks device-code sign-in): after sign-in Microsoft redirects
// to http://localhost – the address from the address bar is pasted into the Web-Admin.
const LINK_REDIRECT = 'http://localhost';
const appMode = () => Boolean(env('MS_TENANT_ID') && env('MS_CLIENT_ID') && env('MS_CLIENT_SECRET') && env('MS_CALENDAR_USER'));
const clientId = () => (!env('MS_CLIENT_SECRET') && env('MS_CLIENT_ID')) || PUBLIC_CLIENT;
// "common" instead of "organizations": work AND personal Microsoft accounts (outlook.com, hotmail, live) can sign in.
// With "organizations", Microsoft rejected personal accounts with "no access".
const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';

// ---------- Encryption of the stored token ----------
// Dedicated key (lib/security/secrets.ts); data encrypted with the previous key stays readable.
const keyOf = (secret: string) => createHash('sha256').update(secret).digest();
function seal(s: string): string { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keyOf(secretFor('ms-graph')), iv); const e = Buffer.concat([c.update(s, 'utf8'), c.final()]); return [iv, c.getAuthTag(), e].map((b) => b.toString('base64url')).join('.'); }
function open(s: string): string | null {
  for (const k of verifySecrets('ms-graph')) { try { const [iv, tag, e] = s.split('.').map((x) => Buffer.from(x, 'base64url')); const d = createDecipheriv('aes-256-gcm', keyOf(k), iv); d.setAuthTag(tag); return Buffer.concat([d.update(e), d.final()]).toString('utf8'); } catch { /* next key */ } }
  return null;
}

type Stored = { rt: string; account: string; name: string; at: string };
async function getSetting<T>(k: string): Promise<T | null> { const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', k).maybeSingle(); return (data?.value as T) ?? null; }
const setSetting = (k: string, value: unknown) => supabaseAdmin().from('lr_settings').upsert({ key: k, value });
const delSetting = (k: string) => supabaseAdmin().from('lr_settings').delete().eq('key', k);

let stored: { v: Stored | null; t: number } | null = null;
async function loadStored(): Promise<Stored | null> {
  if (stored && Date.now() - stored.t < 60_000) return stored.v;
  const raw = await getSetting<{ sealed: string }>(AUTH_KEY).catch(() => null);
  const v = raw?.sealed ? (JSON.parse(open(raw.sealed) || 'null') as Stored | null) : null;
  stored = { v, t: Date.now() }; return v;
}
async function saveStored(v: Stored) { await setSetting(AUTH_KEY, { sealed: seal(JSON.stringify(v)), account: v.account, at: v.at }); stored = { v, t: Date.now() }; }

// ---------- Status ----------
let delegatedKnown = false;
// Synchronous for slot calculation: true if app access is configured or a sign-in was stored (after first load).
export const graphConfigured = () => appMode() || delegatedKnown;
export async function graphReady(): Promise<boolean> { if (appMode()) return true; const s = await loadStored(); delegatedKnown = Boolean(s); return delegatedKnown; }
export async function graphAccount(): Promise<{ mode: 'app' | 'login' | null; account: string | null; name?: string | null; since?: string | null }> {
  if (appMode()) return { mode: 'app', account: env('MS_CALENDAR_USER') };
  const s = await loadStored(); delegatedKnown = Boolean(s);
  return s ? { mode: 'login', account: s.account, name: s.name, since: s.at } : { mode: null, account: null };
}

// ---------- Device-code sign-in ----------
export async function loginStart(): Promise<{ userCode: string; url: string; expiresIn: number; interval: number }> {
  const r = await fetch(`${LOGIN}/devicecode`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId(), scope: SCOPE }), signal: AbortSignal.timeout(10000) });
  const j = (await r.json().catch(() => ({}))) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number; error_description?: string };
  if (!r.ok || !j.device_code || !j.user_code) throw new Error(`Microsoft sign-in isn't possible right now${j.error_description ? `: ${j.error_description.split('\r')[0].slice(0, 160)}` : ''}`);
  const out = { userCode: j.user_code, url: `${j.verification_uri || 'https://microsoft.com/devicelogin'}?mkt=en-US`, expiresIn: j.expires_in || 900, interval: Math.max(3, j.interval || 5) };
  await setSetting(PENDING_KEY, { sealed: seal(j.device_code), until: Date.now() + out.expiresIn * 1000, userCode: out.userCode, url: out.url, interval: out.interval });
  await delSetting(ERR_KEY);
  return out;
}

// Make Microsoft errors understandable (most common reasons for "no access").
function msError(d?: string): string {
  const t = String(d || '');
  if (/AADSTS(65001|90094|90095)/.test(t)) return 'Your Microsoft account needs approval from an administrator of your organization for this sign-in. Sign in with a personal Microsoft account (outlook.com, hotmail.com) or with the administrator account.';
  if (/AADSTS(50020|500200|50034)/.test(t)) return 'Microsoft doesn’t recognize this account or it isn’t enabled. Please use the Microsoft account that owns the Outlook calendar.';
  if (/AADSTS50105/.test(t)) return 'Your account isn’t enabled for this application. In the Microsoft Entra admin center, go to Enterprise applications → "Microsoft Graph Command Line Tools" → Properties and set "Assignment required?" to "No" (or assign your account), then sign in again.';
  if (/AADSTS50097|AADSTS50131|AADSTS50158/.test(t)) return 'Microsoft requires an approved device for this sign-in. Please use "Connect with Microsoft" (sign-in via link) in your regular browser.';
  if (/AADSTS53003|AADSTS530/.test(t)) return 'Microsoft blocks this sign-in method through a policy (Conditional Access, e.g. "Block device code flow"). Please use "Connect with Microsoft" (sign-in via link); if that doesn’t help, check the policy for this account in the Microsoft Entra admin center under Protection → Conditional Access.';
  return (t || 'Sign-in failed.').split('\r')[0].slice(0, 200);
}

export async function loginPoll(): Promise<{ status: 'pending' | 'done' | 'expired' | 'error'; message?: string; account?: string }> {
  const p = await getSetting<{ sealed: string; until: number }>(PENDING_KEY);
  if (!p || Date.now() > p.until) { await delSetting(PENDING_KEY); return { status: 'expired', message: 'The sign-in code has expired. Please start again.' }; }
  const dc = open(p.sealed); if (!dc) return { status: 'error', message: 'Please start the sign-in again.' };
  const r = await fetch(`${LOGIN}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId(), device_code: dc }), signal: AbortSignal.timeout(10000) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return { status: 'pending' };
  if (!r.ok || !j.access_token || !j.refresh_token) {
    await delSetting(PENDING_KEY);
    const message = j.error === 'authorization_declined' ? 'Sign-in canceled.' : j.error === 'expired_token' ? 'The sign-in code has expired.' : msError(j.error_description);
    await noteError(`Code sign-in: ${message}`, j.error_description);
    return { status: j.error === 'expired_token' ? 'expired' : 'error', message };
  }
  const account = await finishLogin(j as { access_token: string; refresh_token: string; expires_in?: number });
  await delSetting(PENDING_KEY);
  return { status: 'done', account };
}

async function finishLogin(j: { access_token: string; refresh_token: string; expires_in?: number }): Promise<string> {
  const me = (await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', { headers: { Authorization: `Bearer ${j.access_token}` }, signal: AbortSignal.timeout(10000) }).then((x) => x.json()).catch(() => ({}))) as { mail?: string; userPrincipalName?: string; displayName?: string };
  const account = (me.mail || me.userPrincipalName || '').toLowerCase();
  await saveStored({ rt: j.refresh_token, account, name: me.displayName || '', at: new Date().toISOString() });
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
  delegatedKnown = true; await delSetting(ERR_KEY);
  return account;
}

// Remember the last error so "Check" can show the reason (without tokens or codes).
async function noteError(message: string, raw?: string) {
  const code = /AADSTS\d+/.exec(String(raw || ''))?.[0] || null;
  await setSetting(ERR_KEY, { message: message.slice(0, 300), code, at: new Date().toISOString() }).then(() => null, () => null);
}

// ---------- Sign-in via link (authorization code with PKCE) ----------
export async function linkStart(): Promise<{ url: string }> {
  const verifier = randomBytes(48).toString('base64url'), state = randomBytes(16).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await setSetting(PKCE_KEY, { sealed: seal(JSON.stringify({ verifier, state })), until: Date.now() + 15 * 60_000 });
  const q = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: LINK_REDIRECT, response_mode: 'query', scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  return { url: `${LOGIN}/authorize?${q}` };
}

export async function linkFinish(pasted: string): Promise<{ ok: boolean; message: string; account?: string }> {
  const p = await getSetting<{ sealed: string; until: number }>(PKCE_KEY);
  if (!p || Date.now() > p.until) return { ok: false, message: 'The sign-in has expired. Please start "Sign in via link" again.' };
  const st = JSON.parse(open(p.sealed) || 'null') as { verifier: string; state: string } | null;
  if (!st) return { ok: false, message: 'Please start again.' };
  const raw = pasted.trim();
  // Microsoft rejected the sign-in and the error text ("More details") was pasted instead of the address.
  if (/AADSTS\d+/.test(raw) && !/[?&]code=/.test(raw)) { const m = msError(raw); await noteError(`Link sign-in: ${m}`, raw); return { ok: false, message: m }; }
  let params: URLSearchParams;
  try { params = /^https?:\/\//i.test(raw) ? new URL(raw).searchParams : new URLSearchParams(raw.includes('=') ? raw.replace(/^[?#]/, '') : `code=${raw}`); } catch { return { ok: false, message: 'Please paste the complete address from the address bar (it starts with http://localhost).' }; }
  if (params.get('error')) { const m = msError(params.get('error_description') || params.get('error') || ''); await noteError(`Link sign-in: ${m}`, params.get('error_description') || ''); return { ok: false, message: m }; }
  const code = params.get('code');
  if (!code) return { ok: false, message: 'The pasted address doesn’t contain a sign-in code. Please copy the complete address from the address bar.' };
  if (params.get('state') && params.get('state') !== st.state) return { ok: false, message: 'This address belongs to an older sign-in. Please start again.' };
  const r = await fetch(`${LOGIN}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId(), code, redirect_uri: LINK_REDIRECT, code_verifier: st.verifier, scope: SCOPE }), signal: AbortSignal.timeout(10000) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token || !j.refresh_token) { const m = msError(j.error_description); await noteError(`Link sign-in: ${m}`, j.error_description); return { ok: false, message: m }; }
  const account = await finishLogin(j as { access_token: string; refresh_token: string; expires_in?: number });
  await delSetting(PKCE_KEY); await delSetting(PENDING_KEY);
  return { ok: true, message: `Connected to ${account}.`, account };
}

// Is a code sign-in still running? (e.g. keep waiting automatically after a page reload)
export async function loginPending(): Promise<{ userCode: string; url: string; expiresIn: number; interval: number } | null> {
  const p = await getSetting<{ until: number; userCode?: string; url?: string; interval?: number }>(PENDING_KEY).catch(() => null);
  if (!p || !p.userCode || Date.now() > p.until - 20_000) return null;
  return { userCode: p.userCode, url: p.url || 'https://microsoft.com/devicelogin', expiresIn: Math.round((p.until - Date.now()) / 1000), interval: p.interval || 5 };
}

export async function logout() { await delSetting(AUTH_KEY); await delSetting(PENDING_KEY); stored = null; tok = null; ftok = null; delegatedKnown = false; }

// ---------- Access token ----------
let tok: { v: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (tok && tok.exp > Date.now() + 60_000) return tok.v;
  if (appMode()) {
    const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env('MS_TENANT_ID'))}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }), signal: AbortSignal.timeout(10000) });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!r.ok || !j.access_token) throw new Error(`Microsoft sign-in failed${j.error_description ? `: ${j.error_description.split('\r')[0].slice(0, 160)}` : ''}`);
    tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }; return tok.v;
  }
  const s = await loadStored();
  if (!s) throw new Error('Not signed in with Microsoft.');
  const r = await fetch(`${LOGIN}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId(), refresh_token: s.rt, scope: SCOPE_CAL }), signal: AbortSignal.timeout(10000) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    if (j.error === 'invalid_grant') { await logout(); await noteError('Microsoft sign-in expired or was revoked – please sign in again.', j.error_description); throw new Error('Microsoft sign-in expired – please sign in again in the Web-Admin under Appointments.'); }
    await noteError(`Token refresh: ${msError(j.error_description)}`, j.error_description);
    throw new Error(`Microsoft sign-in failed${j.error_description ? `: ${j.error_description.split('\r')[0].slice(0, 160)}` : ''}`);
  }
  if (j.refresh_token && j.refresh_token !== s.rt) await saveStored({ ...s, rt: j.refresh_token });
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }; return tok.v;
}

const base = async () => (appMode() ? `/users/${encodeURIComponent(env('MS_CALENDAR_USER'))}` : '/me');
const mailbox = async () => (appMode() ? env('MS_CALENDAR_USER') : (await loadStored())?.account || '');
async function g(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"', ...(init.headers || {}) }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Microsoft ${r.status}: ${String((j as { error?: { message?: string } }).error?.message || '').slice(0, 200)}`);
  return j;
}

// Busy times (free/busy) in the range as [start, end] in ms.
export async function graphBusy(from: Date, to: Date): Promise<[number, number][]> {
  // Personal Microsoft accounts don't support getSchedule – there, treat the calendar events themselves as busy.
  try { return await graphBusySchedule(from, to); } catch (e) {
    const ev = await graphEvents(from, to).catch(() => { throw e; });
    return ev.filter((x) => x.showAs !== 'free').map((x): [number, number] => [Date.parse(x.start), Date.parse(x.end)]);
  }
}
async function graphBusySchedule(from: Date, to: Date): Promise<[number, number][]> {
  const j = (await g(`${await base()}/calendar/getSchedule`, { method: 'POST', body: JSON.stringify({ schedules: [await mailbox()], startTime: { dateTime: from.toISOString().slice(0, 19), timeZone: 'UTC' }, endTime: { dateTime: to.toISOString().slice(0, 19), timeZone: 'UTC' }, availabilityViewInterval: 15 }) })) as { value?: { scheduleItems?: { status: string; start: { dateTime: string }; end: { dateTime: string } }[] }[] };
  return (j.value?.[0]?.scheduleItems || []).filter((x) => x.status !== 'free').map((x) => [Date.parse(x.start.dateTime + 'Z'), Date.parse(x.end.dateTime + 'Z')]);
}

// Create a Teams meeting as a calendar event.
// Only in the owner's own Outlook calendar – without attendees, so Microsoft doesn't send the guest its own invitation.
// The guest receives the Teams link and calendar entry exclusively by LeaseRun email from support@leaserun.com.
export async function graphCreateMeeting(o: { subject: string; start: Date; end: Date; html: string }): Promise<{ id: string; joinUrl: string | null }> {
  const b = await base();
  const ev = (online: boolean) => g(`${b}/events`, { method: 'POST', body: JSON.stringify({
    subject: o.subject, body: { contentType: 'HTML', content: o.html },
    start: { dateTime: o.start.toISOString().slice(0, 19), timeZone: 'UTC' }, end: { dateTime: o.end.toISOString().slice(0, 19), timeZone: 'UTC' },
    ...(online ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}), allowNewTimeProposals: false, reminderMinutesBeforeStart: 15,
  }) }) as Promise<{ id: string; onlineMeeting?: { joinUrl?: string } }>;
  // Teams links only exist for work accounts; for personal accounts, create the event without a Teams link instead of failing.
  let j: { id: string; onlineMeeting?: { joinUrl?: string } };
  try { j = await ev(true); } catch (e) { if (!/Microsoft 4\d\d/.test((e as Error).message)) throw e; j = await ev(false); }
  return { id: j.id, joinUrl: j.onlineMeeting?.joinUrl || null };
}

export async function graphCancelMeeting(id: string, comment: string): Promise<void> {
  await g(`${await base()}/events/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ comment: comment.slice(0, 500) }) });
}

export async function graphSelfTest(): Promise<{ ok: boolean; message: string }> {
  if (!(await graphReady())) return { ok: false, message: 'Not connected to Microsoft.' };
  try { await graphBusy(new Date(), new Date(Date.now() + 864e5)); return { ok: true, message: `Connected to the calendar of ${await mailbox()}.` }; } catch (e) { return { ok: false, message: (e as Error).message }; }
}

export type CalEvent = { id: string; subject: string; start: string; end: string; allDay: boolean; showAs: string; location: string; teams: string | null; link: string | null };
// Events from the Outlook calendar in the range (for the calendar view in the Web-Admin).
export async function graphEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const q = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: 'subject,start,end,isAllDay,showAs,location,onlineMeeting,webLink,isCancelled', $orderby: 'start/dateTime', $top: '250' });
  const j = (await g(`${await base()}/calendarView?${q}`)) as { value?: { id: string; subject?: string; start: { dateTime: string }; end: { dateTime: string }; isAllDay?: boolean; showAs?: string; location?: { displayName?: string }; onlineMeeting?: { joinUrl?: string } | null; webLink?: string; isCancelled?: boolean }[] };
  const z = (s: string) => new Date(/Z|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z').toISOString();
  return (j.value || []).filter((e) => !e.isCancelled).map((e) => ({ id: e.id, subject: e.subject || '(no title)', start: z(e.start.dateTime), end: z(e.end.dateTime), allDay: Boolean(e.isAllDay), showAs: e.showAs || 'busy', location: e.location?.displayName || '', teams: e.onlineMeeting?.joinUrl || null, link: e.webLink || null }));
}

// ---------- Check & fix (Web-Admin → Appointments) ----------
export type MsCheck = { id: string; label: string; ok: boolean; warn?: boolean; detail: string; fix?: string; how?: string };
export async function graphDiagnose(): Promise<MsCheck[]> {
  const out: MsCheck[] = [];
  const acc = await graphAccount();
  const [pend, pkce, last] = await Promise.all([
    getSetting<{ until: number }>(PENDING_KEY).catch(() => null), getSetting<{ until: number }>(PKCE_KEY).catch(() => null),
    getSetting<{ message: string; code: string | null; at: string }>(ERR_KEY).catch(() => null),
  ]);
  out.push(acc.mode
    ? { id: 'ms:conn', label: 'Microsoft connected', ok: true, detail: `${acc.account}${acc.mode === 'app' ? ' (app access)' : ''}` }
    : { id: 'ms:conn', label: 'Microsoft connected', ok: false, detail: 'Not signed in yet.', how: 'Choose "Connect with Microsoft" above. If your organization blocks code sign-in, use "Sign in via link".' });
  const stale = [pend && Date.now() > pend.until ? 'code' : '', pkce && Date.now() > pkce.until ? 'link' : ''].filter(Boolean);
  if (stale.length) out.push({ id: 'ms:stale', label: 'Abandoned sign-in', ok: false, detail: `Leftover ${stale.join(' and ')} sign-in from earlier.`, fix: 'Clean up' });
  if (acc.mode) {
    try { await token(); out.push({ id: 'ms:token', label: 'Access can be renewed', ok: true, detail: 'Microsoft grants access.' }); }
    catch (e) { out.push({ id: 'ms:token', label: 'Access can be renewed', ok: false, detail: (e as Error).message, fix: 'Clear cache and retry', how: 'If that doesn’t help: sign out and sign in again.' }); }
    try { const ev = await graphEvents(new Date(), new Date(Date.now() + 7 * 864e5)); out.push({ id: 'ms:cal', label: 'Outlook calendar readable', ok: true, detail: `${ev.length} event(s) in the next 7 days.` }); }
    catch (e) { out.push({ id: 'ms:cal', label: 'Outlook calendar readable', ok: false, detail: (e as Error).message, how: 'The account needs an Exchange Online mailbox (Microsoft 365 Business Basic or higher). Without a license there is no calendar.' }); }
    try { await graphBusySchedule(new Date(), new Date(Date.now() + 864e5)); out.push({ id: 'ms:busy', label: 'Busy times', ok: true, detail: 'Hidden on leaserun.com/book.' }); }
    catch { out.push({ id: 'ms:busy', label: 'Busy times', ok: true, warn: true, detail: 'Free/busy lookup isn’t available – calendar events are used instead.' }); }
  }
  if (last && !acc.mode) {
    const hint = last.code === 'AADSTS53003' || /Conditional Access|policy/i.test(last.message) ? 'Your organization blocks code sign-in. Use "Sign in via link".'
      : /AADSTS(65001|90094|90095)/.test(last.code || '') ? 'Sign in as an administrator and check "Consent on behalf of your organization" at Microsoft.' : 'Sign in again; otherwise use "Sign in via link".';
    out.push({ id: 'ms:last', label: 'Last error', ok: false, detail: `${last.message}${last.code ? ` (${last.code})` : ''} – ${new Date(last.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`, how: hint, fix: 'Dismiss notice' });
  }
  return out;
}

export async function graphFix(ids: string[]): Promise<string[]> {
  const done: string[] = [];
  if (ids.includes('ms:stale')) { await delSetting(PENDING_KEY); await delSetting(PKCE_KEY); done.push('Abandoned sign-in cleaned up'); }
  if (ids.includes('ms:token')) { tok = null; stored = null; done.push('Cache cleared'); }
  if (ids.includes('ms:last')) { await delSetting(ERR_KEY); done.push('Error notice dismissed'); }
  return done;
}

// ---------- OneDrive (file exchange) ----------
// Separate access token just for files. If consent is missing (sign-in from before the OneDrive feature), we do NOT
// sign out – the calendar keeps working and the Web-Admin shows "Reconnect Microsoft".
export class DriveConsentError extends Error {}
let ftok: { v: string; exp: number } | null = null;
async function filesToken(): Promise<string> {
  if (appMode()) return token();
  if (ftok && ftok.exp > Date.now() + 60_000) return ftok.v;
  const s = await loadStored();
  if (!s) throw new DriveConsentError('Not connected to Microsoft.');
  const r = await fetch(`${LOGIN}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId(), refresh_token: s.rt, scope: SCOPE_FILES }), signal: AbortSignal.timeout(10000) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !j.access_token) {
    if (/AADSTS(65001|70000|65004)|consent/i.test(j.error_description || '')) throw new DriveConsentError('OneDrive access not granted yet – reconnect Microsoft once.');
    throw new Error(`Microsoft: ${msError(j.error_description)}`);
  }
  if (j.refresh_token && j.refresh_token !== s.rt) await saveStored({ ...s, rt: j.refresh_token });
  ftok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }; return ftok.v;
}
// Graph call on the connected account's OneDrive (path relative to …/drive).
export async function drive<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`https://graph.microsoft.com/v1.0${await base()}/drive${path}`, { ...init, headers: { Authorization: `Bearer ${await filesToken()}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (r.status === 204) return {} as T;
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) { const e = new Error('not found'); (e as Error & { status?: number }).status = 404; throw e; }
  if (!r.ok) throw new Error(`Microsoft ${r.status}: ${String((j as { error?: { message?: string } }).error?.message || '').slice(0, 200)}`);
  return j as T;
}
