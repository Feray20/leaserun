// Web-Admin (ADMIN_EMAILS only, with a second factor): Finance Cockpit, System, Users, Security, Partners, invoice archive,
// CPA export, requests and codes, audit log and operator metrics.
import { logoLoader } from './loader.mjs?v=892f3666';
import { api, download, dt, dtt, esc, eur, loginForm, logout, session, setSession, supa, token } from './sess.mjs?v=892f3666';

// Two-factor code: autofill from the keyboard (iOS/Android), clean the input and submit automatically at 6 digits.
if (!window.__iaOtp) {
  window.__iaOtp = true;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.autocomplete !== 'one-time-code') return;
    const d = el.value.replace(/\D/g, '').slice(0, 6);
    if (d !== el.value) el.value = d;
    if (d.length === 6 && el.form && !el.form.dataset.otpSent) { el.form.dataset.otpSent = '1'; setTimeout(() => { delete el.form.dataset.otpSent; }, 4000); el.form.requestSubmit(); }
  });
}


const root = document.getElementById('intern');
const $ = (s, el = document) => el.querySelector(s);
const TIER = { BASIC: 'Basic', PRO: 'Pro', ENTERPRISE: 'Enterprise' };
const PAY = { PAID: 'paid', PENDING: 'open', OVERDUE: 'overdue', CANCELLED: 'voided' };
// Owner's timezone for all Web-Admin times; formatting is always en-US.
const TZ = 'Europe/Berlin';
const fmtDate = (d, o = {}) => new Date(d).toLocaleDateString('en-US', { timeZone: TZ, ...o });
const fmtTime = (d, o = {}) => new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', ...o });
const num = (x, o) => Number(x || 0).toLocaleString('en-US', o);
// Server-side confirmation token for deleting business accounts (the admin types DELETE; the b2b route still expects the legacy token).
const DEL_TOKEN = 'L\u00D6SCHEN';
// Feedback always visible: in the header and as a toast at the bottom of the screen (even when scrolled far down).
const msg = (t, bad = false) => {
  const el = $('#adMsg'); if (el) { el.textContent = t; el.className = 'form-note ' + (bad ? 'st bad' : ''); }
  if (!t) return;
  let x = document.getElementById('adToast');
  if (!x) { x = document.createElement('div'); x.id = 'adToast'; x.setAttribute('role', 'status'); x.setAttribute('aria-live', 'polite'); document.body.append(x); }
  x.textContent = t; x.className = 'wa-toast show' + (bad ? ' bad' : '');
  clearTimeout(x._t); x._t = setTimeout(() => { x.className = 'wa-toast' + (bad ? ' bad' : ''); }, bad ? 6000 : 3500);
};
// Consistent states: skeleton while loading, a clear error with "Try again", an empty state with an explanation.
const skel = () => `<div class="wa-skel" aria-busy="true" aria-label="Loading data"><div class="wa-skel-kpis">${'<span></span>'.repeat(4)}</div><div class="wa-skel-card"><i class="w40"></i>${'<i></i>'.repeat(5)}</div></div>`;
function errState(v, text) {
  v.innerHTML = `<div class="wa-state err" role="alert"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg><strong>The data couldn't be loaded.</strong>${text ? `<span>${esc(text)}</span>` : ''}<button type="button" class="btn btn-outline" data-retry>Try again</button></div>`;
  v.querySelector('[data-retry]').onclick = () => show();
}
const emptyState = (title, text) => `<div class="wa-state"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg><strong>${title}</strong>${text ? `<span>${text}</span>` : ''}</div>`;

// Every dialog in the Web-Admin also closes on a click outside – not only via "×" or "Close".
// Only when both press and release are outside (selecting text inside the dialog closes nothing).
{
  let downOut = false;
  const outside = (d, e) => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  document.addEventListener('pointerdown', (e) => { const d = e.target instanceof HTMLDialogElement && e.target.open ? e.target : null; downOut = Boolean(d && outside(d, e)); }, true);
  document.addEventListener('click', (e) => { const d = e.target instanceof HTMLDialogElement && e.target.open ? e.target : null; if (d && downOut && outside(d, e) && !d.dataset.keep) d.close(); downOut = false; }, true);
}

// ---------- Access ----------
async function gate() {
  const adminLogin = () => loginForm(root, {
    title: 'Web-Admin', lead: 'Sign-in for administrators only. Separate from customer accounts and the business portal.',
    note: 'After your password you will be asked for the code from Google Authenticator.',
    check: async (d) => { const r = await fetch('/api/admin/check', { headers: { Authorization: 'Bearer ' + d.access_token }, cache: 'no-store' }); const j = await r.json().catch(() => ({})); return j.admin ? null : (j.ipBlocked ? 'No access from this IP address.' : 'Wrong credentials or no access to the Web-Admin.'); },
  });
  if (!token()) { adminLogin(); return false; }
  const r = await api('/api/admin/check');
  if (r.status === 401) { setSession(null); adminLogin(); return false; }
  if (r.data?.ipBlocked) { root.innerHTML = '<h1>No access</h1><p>Access from this IP address is not allowed (ADMIN_IP_ALLOWLIST in Vercel).</p>'; return false; }
  if (!r.data?.admin) {
    root.innerHTML = `<h1>No access</h1><p>This area is for administrators only.${r.data?.configured === false ? ' (No administrator address is set in Vercel yet: variable ADMIN_EMAILS.)' : ''}</p>`;
    return false;
  }
  if (!r.data.mfaOk) { await mfa(); return false; }
  return true;
}

// Second factor via Supabase MFA (TOTP app such as Google Authenticator, 1Password).
async function mfa() {
  // Second factor already set up (app or SMS): just ask for the code.
  try {
    const m = await import('./mfa.mjs?v=892f3666');
    const { factors } = await m.factorsOf(token());
    if (factors.length) { root.innerHTML = '<div class="pt-card wa-mfa" id="adMfa"></div>'; await m.challengeUI($('#adMfa'), session(), () => location.reload()); return; }
  } catch { /* continue with setup */ }
  const auth = { Authorization: 'Bearer ' + token() };
  const u = await supa('/auth/v1/user', { headers: auth }).then((x) => x.json()).catch(() => ({}));
  const verified = (u.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
  let factorId = verified?.id;
  let enrollHtml = '';
  if (!factorId) {
    // Remove unverified old factors, then enroll again.
    for (const f of (u.factors || []).filter((x) => x.status !== 'verified')) await supa(`/auth/v1/factors/${f.id}`, { method: 'DELETE', headers: auth });
    const e = await supa('/auth/v1/factors', { method: 'POST', headers: auth, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'LeaseRun Admin ' + new Date().toISOString().slice(0, 10) }) });
    const ej = await e.json().catch(() => ({}));
    if (!e.ok) { root.innerHTML = `<h1>Second factor</h1><p>Setup isn't possible: ${esc(ej.msg || ej.error_description || e.status)}. TOTP must be enabled in Supabase under Authentication → Multi-Factor.</p>`; return; }
    factorId = ej.id;
    enrollHtml = `<p>1. Scan this code with an authenticator app (Google Authenticator, 1Password, Authy):</p>
      <img src="${esc(ej.totp.qr_code)}" alt="QR code for the authenticator app" width="200" height="200">
      <p class="form-note">Or enter the key manually: <code>${esc(ej.totp.secret)}</code></p><p>2. Enter the 6-digit code from the app:</p>`;
  }
  root.innerHTML = `<div class="wa-mfa pt-card"><h1>Second factor</h1>${enrollHtml || '<p>Please enter the 6-digit code from your authenticator app.</p>'}
    <form id="mfaF" class="pt-row"><input id="mfaC" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus enterkeyhint="done" aria-label="Code" style="font-size:22px;letter-spacing:.2em;width:9ch;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px"><button class="btn btn-dark" type="submit">Verify</button></form>
    <p class="form-note" id="mfaMsg" role="status"></p></div>`;
  $('#mfaF').onsubmit = async (ev) => {
    ev.preventDefault();
    const c = await supa(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', headers: auth });
    const cj = await c.json().catch(() => ({}));
    if (!c.ok) { $('#mfaMsg').textContent = cj.msg || 'Request failed.'; return; }
    const v = await supa(`/auth/v1/factors/${factorId}/verify`, { method: 'POST', headers: auth, body: JSON.stringify({ challenge_id: cj.id, code: $('#mfaC').value.trim() }) });
    const vj = await v.json().catch(() => ({}));
    if (!v.ok || !vj.access_token) { $('#mfaMsg').textContent = vj.msg || 'Wrong or expired code.'; return; }
    setSession({ ...session(), ...vj });
    location.reload();
  };
}

// ---------- Frame ----------
// Data area like "Beginner ⇄ Pro": B2C (consumers) or B2B (businesses) – controls overview and user list.
// Strict separation: every view shows data of the selected area only. "System" is the only area with
// cross-area operational data (setup, servers, webhooks, security, audit log).
const SEGS = { b2c: 'Consumers (B2C)', b2b: 'Businesses (B2B)', system: 'System (all)' };
const getSeg = () => { try { const x = localStorage.getItem('lr-admin-seg'); return x === 'b2b' || x === 'system' ? x : 'b2c'; } catch { return 'b2c'; } };
// Which tabs exist in which area (everything else is hidden in that area).
const TAB_SCOPES = {
  uebersicht: ['b2c', 'b2b'], nutzer: ['b2c', 'b2b', 'system'], freischaltung: ['b2c'], probleme: ['b2c', 'b2b'], vorschlaege: ['b2c', 'b2b'], werbung: ['b2c', 'b2b'], cockpit: ['b2c', 'b2b'],
  // Invoices and the neutral CPA export live with the finance tabs, strictly per area (B2C or B2B).
  rechnungen: ['b2c', 'b2b'], steuer: ['b2c', 'b2b'],
  analyse: ['b2c', 'b2b'], kennzahlen: ['b2c', 'b2b'], partner: ['b2b'], api: ['system'], creator: ['b2b'], anfragen: ['b2b'], akquise: ['b2b'], postfach: ['system'], termine: ['system'],
  einrichtung: ['system'], system: ['system'], sicherheit: ['system'], protokoll: ['system'], hq: ['system'], os: ['system'],
};
const inScope = (t, g = getSeg()) => (TAB_SCOPES[t] || ['system']).includes(g);
// Starting point: Headquarters desktop in System, the area overview in B2C/B2B.
const firstTab = (g = getSeg()) => (g === 'system' ? 'os' : 'uebersicht');
const setSeg = (x) => { try { localStorage.setItem('lr-admin-seg', x); } catch { /* convenience only */ } };
// Jump from Headquarters into a tab – switch to the matching data area if needed (never leave foreign data on screen).
function goTab(t, sg) {
  if (sg && SEGS[sg] && sg !== getSeg()) { setSeg(sg); CK_CACHE.clear(); frame(); }
  if (location.hash.slice(1) === t) show(); else location.hash = t;
}
const TABS = [['os', 'Desktop'], ['hq', 'Command Center'], ['freischaltung', 'Paywall & Previews'], ['postfach', 'Inbox'], ['termine', 'Appointments'], ['uebersicht', 'Overview'], ['einrichtung', 'Setup'], ['analyse', 'Analytics'], ['cockpit', 'Finance Cockpit'], ['system', 'System'], ['nutzer', 'Users'], ['sicherheit', 'Security'], ['partner', 'Partners'], ['creator', 'Creator Operations'], ['rechnungen', 'Invoices'], ['steuer', 'CPA export'], ['anfragen', 'Requests & Codes'], ['akquise', 'Outreach'], ['werbung', 'Marketing'], ['protokoll', 'Audit log'], ['kennzahlen', 'Metrics'], ['probleme', 'Technical issues'], ['vorschlaege', 'Suggestions'], ['api', 'API Management']];
// Main areas (phone: bottom bar + sub-tabs; desktop: sidebar with groups).
const GROUPS = [
  ['hq', 'Headquarters', 'HQ', '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01"/>', ['os', 'hq']],
  ['mail', 'Inbox & Appointments', 'Inbox', '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>', ['postfach', 'termine']],
  ['ops', 'Operations & CRM', 'CRM', '<path d="M16 11a4 4 0 1 0-8 0"/><circle cx="12" cy="7" r="3"/><path d="M4 21v-2a6 6 0 0 1 16 0v2"/>', ['uebersicht', 'nutzer', 'freischaltung', 'anfragen', 'partner', 'creator', 'vorschlaege']],
  ['fin', 'Finance & Compliance', 'Finance', '<path d="M4 7h16v12H4z"/><path d="M4 11h16M8 15h3"/>', ['cockpit', 'rechnungen', 'steuer']],
  ['ana', 'Analytics & Monitoring', 'Analytics', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', ['analyse', 'kennzahlen', 'probleme', 'protokoll', 'sicherheit']],
  ['api', 'API Management', 'API', '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/>', ['api']],
  ['sys', 'System & Setup', 'System', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', ['einrichtung', 'system']],
];
// Groups and tabs of the active area only; empty groups are dropped.
const groupsIn = (sc = getSeg()) => GROUPS.map(([a, b, c, d, ts]) => [a, b, c, d, ts.filter((t) => inScope(t, sc))]).filter((g) => g[4].length);
const groupOf = (t) => groupsIn().find((g) => g[4].includes(t)) || groupsIn()[0];
const tabLabel = (t) => TABS.find(([k]) => k === t)?.[1] || t;

function paintSeg() {
  const g = getSeg();
  document.querySelectorAll('[data-segset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.segset === g)));
  document.body.dataset.adSeg = g;
}

function frame() {
  const ic = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  root.innerHTML = `<header class="wa-head wa-sticky"><a class="wa-brand" href="/" aria-label="LeaseRun – go to home page"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Lease<span>Run</span></span></a><div class="wa-title"><small class="wa-kicker" id="adKicker">Web-Admin</small><h1 id="adTitle">Admin</h1></div>
      <div class="wa-segctl wa-segctl3" role="group" aria-label="Data area"><button type="button" data-segset="b2c">B2C<span> · Consumers</span></button><button type="button" data-segset="b2b">B2B<span> · Businesses</span></button><button type="button" data-segset="system">System</button></div>
      <button type="button" class="btn btn-outline wa-out" id="adLogout" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg><span>Sign out</span></button></header>
    <p class="form-note wa-note">Administrators only · second factor · every action is logged · automatic sign-out after 2 hours of inactivity.</p>
    <div class="wa-shell"><nav class="wa-tabs" aria-label="Sections">${groupsIn().map(([g, l, , , ts]) => `<div class="wa-grp"><span class="wa-grp-h">${l}</span>${ts.map((k) => `<button type="button" data-t="${k}">${tabLabel(k)}</button>`).join('')}</div>`).join('')}</nav>
    <div class="wa-main"><div class="wa-scope-band" id="adBand"></div><div class="wa-subtabs" id="adSub" role="tablist"></div><p id="adMsg" class="form-note" role="status"></p><div id="adView"></div></div></div>
    <nav class="wa-bottom" aria-label="Main sections">${groupsIn().map(([g, , sh, d]) => `<button type="button" data-g="${g}">${ic(d)}<span>${sh}</span></button>`).join('')}</nav>`;
  root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { location.hash = b.dataset.t; });
  root.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => {
    const g = groupsIn().find((x) => x[0] === b.dataset.g);
    let last = null; try { last = sessionStorage.getItem(`lr-admin-last-${getSeg()}-${g[0]}`); } catch { /* ignore */ }
    location.hash = g[4].includes(last) ? last : g[4][0];
  });
  $('#adLogout').onclick = logout;
  paintSeg();
  root.querySelectorAll('[data-segset]').forEach((b) => b.onclick = () => {
    if (b.dataset.segset === getSeg()) return;
    setSeg(b.dataset.segset);
    CK_CACHE.clear();
    // Area switch: rebuild navigation (only this area's tabs) and – if the current tab doesn't exist here –
    // jump to the area's start. Never leave data of the previous area on screen.
    const cur = location.hash.slice(1).split('-')[0];
    frame();
    if (!inScope(cur)) location.hash = firstTab(); else show();
  });
}

const asOf = () => { const d = new Date(); return `As of today, ${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${fmtTime(d)}`; };
function show() {
  const h = location.hash.slice(1).split('-')[0];
  let t = TABS.find(([k]) => k === h)?.[0] || firstTab();
  // Tab doesn't belong to the active area → area start (never show foreign data).
  // Direct link to a tab that exists in one area only (e.g. #postfach, #termine from notifications) → switch to that area.
  if (!inScope(t) && t === h && (TAB_SCOPES[t] || []).length === 1) { setSeg(TAB_SCOPES[t][0]); CK_CACHE.clear(); frame(); }
  if (!inScope(t)) { t = firstTab(); history.replaceState(null, '', '#' + t); }
  { const band = $('#adBand'), sg = getSeg(); if (band) { band.dataset.seg = sg; band.innerHTML = t === 'hq' ? `<span class="wa-scope-dot"></span><strong>Headquarters · entire company</strong><small class="wa-asof">${asOf()}</small><span>Consumer and business revenue shown separately.</span>` : `<span class="wa-scope-dot"></span><strong>${SEGS[sg]}</strong><small class="wa-asof">${asOf()}</small><span>${sg === 'system' ? 'Operations overall: setup, servers, webhooks, security, audit log' : sg === 'b2b' ? 'Only business data is shown.' : 'Only consumer data is shown.'}</span>`; } }
  // New tab: don't carry an old message (e.g. "Working on it." from HQ) into the next tab.
  if (show.last !== t) { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); if (show.last) msg(''); show.last = t; }
  const g = groupOf(t);
  { const tt = $('#adTitle'), kk = $('#adKicker'); if (tt) tt.textContent = tabLabel(t); if (kk) kk.textContent = `Web-Admin · ${({ b2c: 'B2C Consumers', b2b: 'B2B Businesses', system: 'System' })[getSeg()]}`; }
  try { sessionStorage.setItem(`lr-admin-last-${getSeg()}-${g[0]}`, t); } catch { /* ignore */ }
  // Only one sub-item (e.g. Headquarters): no duplicate bar "Headquarters | Headquarters".
  $('#adSub').hidden = g[4].length < 2;
  $('#adSub').innerHTML = g[4].length < 2 ? '' : `<span class="wa-sub-h">${g[1]}</span>${g[4].map((k) => `<button type="button" role="tab" data-t="${k}">${tabLabel(k)}</button>`).join('')}`;
  $('#adSub').querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { location.hash = b.dataset.t; });
  root.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
  root.querySelectorAll('[data-g]').forEach((b) => b.setAttribute('aria-current', b.dataset.g === g[0] ? 'page' : 'false'));
  $('#adSub').querySelector(`[data-t="${t}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  // Fresh container per switch: an old tab that is still loading can't overwrite the new one.
  const vOld = $('#adView'); const v = vOld.cloneNode(false); vOld.replaceWith(v);
  v.innerHTML = skel();
  msg('');
  const view = ({ os: (x) => import('./intern-os.mjs?v=892f3666').then((m) => m.osDesk(x, { goTab, msg })), hq: (x) => import('./intern-hq.mjs?v=892f3666').then((m) => m.hq(x, { goTab, msg })), uebersicht, einrichtung, analyse, cockpit, system: (x) => system(x, location.hash.includes('-mail')).then(() => import('./intern-feedback.mjs?v=892f3666')).then((m) => m.reviewsAdmin(x)).catch(() => {}), nutzer: (x) => nutzer(x, 1, '', getSeg() === 'system' ? 'admin' : getSeg()), vorschlaege: (x) => import('./intern-feedback.mjs?v=892f3666').then((m) => m.vorschlaege(x, getSeg())), probleme: (x) => import('./intern-support.mjs?v=892f3666').then((m) => m.probleme(x, getSeg(), msg)), sicherheit, partner, rechnungen: (x) => rechnungen(x), steuer: (x) => Promise.resolve(steuer(x)), anfragen, protokoll, kennzahlen, akquise: (x) => import('./intern-marketing.mjs?v=892f3666').then((m) => m.akquise(x)), postfach: (x) => import('./intern-mail.mjs?v=892f3666').then((m) => m.postfach(x)), termine: (x) => import('./intern-termine.mjs?v=892f3666').then((m) => m.termine(x)), werbung: (x) => import('./intern-marketing.mjs?v=892f3666').then((m) => m.werbung(x)), creator: (x) => import('./intern-creator.mjs?v=892f3666').then((m) => m.creatorOps(x)), api: (x) => import('./intern-api.mjs?v=892f3666').then((m) => m.apiOps(x)),
    freischaltung: (x) => import('./intern-freischaltung.mjs?v=892f3666').then((m) => m.freischaltung(x, { msg })) })[t](v);
  Promise.resolve(view).catch((e) => { console.warn('[admin]', e); errState(v, ''); });
}

// ---------- Users: accounts at a glance, suspend/unsuspend, password reset, delete ----------
// Filters for the user list (on the loaded page): active = signed in within 30 days, new = signed up within 14 days.
const US_F = [['alle', 'All'], ['aktiv', 'Active'], ['inaktiv', 'Inactive'], ['neu', 'New'], ['bestaetigt', 'Confirmed'], ['gesperrt', 'Suspended']];
function usTags(u) {
  const now = Date.now(), d = (x) => (x ? (now - new Date(x).getTime()) / 864e5 : Infinity);
  const t = ['alle'];
  t.push(d(u.lastSignIn) <= 30 ? 'aktiv' : 'inaktiv');
  if (d(u.createdAt) <= 14) t.push('neu');
  if (u.confirmed) t.push('bestaetigt');
  if (u.banned) t.push('gesperrt');
  return t;
}
async function nutzer(v, page = 1, q = '', seg = 'b2c') {
  const r = await api(`/api/admin/users?page=${page}&seg=${seg}&q=${encodeURIComponent(q)}`);
  if (!r.ok) { errState(v, r.data?.error); return; }
  const us = r.data.users || [];
  const ago = (x) => (x ? dtt(x) : 'never');
  const mk = seg === 'b2c' ? '<button type="button" class="btn btn-dark wa-mk-one" id="usMk">+ Create consumer account</button>' : seg === 'b2b' ? '<button type="button" class="btn btn-dark wa-mk-one" id="usMk">+ Create business</button>' : '';
  const segLabel = { b2c: 'Consumers', b2b: 'Businesses', admin: 'Administrators' }[seg] || '';
  v.innerHTML = `<section class="pt-card"><div class="wa-h-row"><h2>${segLabel}</h2>${mk}</div>
    <form class="wa-search" id="usF"><input id="usQ" type="search" placeholder="Search users by email …" value="${esc(q)}" aria-label="Search users by email" autocomplete="off"><button class="btn btn-dark" type="submit">Search</button></form>
    <p class="form-note">${us.length} accounts on this page. Only account data is shown – no content. Every action is logged.</p>
    <div class="us-tools"><div class="pc-chips" role="group" aria-label="Filter">${US_F.map(([k, l]) => `<button type="button" data-usf="${k}" aria-pressed="${k === 'alle'}">${l} <b>${us.filter((u) => usTags(u).includes(k)).length}</b></button>`).join('')}</div>
      <label class="us-sort">Sort<select id="usSort"><option value="created">Sign-up (newest)</option><option value="last">Last sign-in</option><option value="mail">Email A–Z</option></select></label></div>
    <div class="us-list">${us.map((u) => `<article class="us-card${u.banned ? ' banned' : ''}" data-tags="${usTags(u).join(' ')}" data-created="${esc(u.createdAt || '')}" data-last="${esc(u.lastSignIn || '')}" data-mail="${esc(u.email || '')}">
      <div class="us-top"><strong>${esc(u.email || '(no email)')}</strong><span class="us-tags">${u.admin ? '<span class="st ok">Admin</span>' : ''}${u.banned ? '<span class="st bad">suspended</span>' : ''}${u.confirmed ? '' : '<span class="st warn">unconfirmed</span>'}${u.mfa ? '<span class="st ok">2FA</span>' : '<span class="st">no 2FA</span>'}</span></div>
      ${u.company ? `<div class="us-co"><strong>${esc(u.company.name)}</strong><span class="us-co-m"><span>${esc(u.company.number || '')}</span><span>${u.company.role === 'owner' ? 'Owner' : 'Advisor'}</span>${u.company.verified ? '<span class="st ok">verified</span>' : `<span class="st warn">${esc(u.company.status || 'pending')}</span>`}</span></div>` : ''}
      <dl class="us-meta"><div><dt>Signed up</dt><dd>${dt(u.createdAt)}</dd></div><div><dt>Last sign-in</dt><dd>${ago(u.lastSignIn)}</dd></div></dl>
      <div class="us-act">${seg === 'b2c' && !u.admin && !u.company ? `<button type="button" class="btn btn-dark" data-acc="${esc(u.id)}" data-mail="${esc(u.email)}">Grant access</button>` : ''}${u.company && u.company.role === 'owner' && !u.company.verified ? `<button type="button" class="btn btn-dark" data-coapprove="${esc(u.company.id)}" data-name="${esc(u.company.name)}">Approve business</button>` : ''}${u.company && u.company.role === 'owner' ? `<button type="button" class="btn btn-dark" data-b2bacc="${esc(u.company.id)}" data-name="${esc(u.company.name)}">Grant access</button>` : ''}${u.company ? `<button type="button" class="btn btn-outline" data-coopen="${esc(u.company.id)}">Open business</button>` : ''}${u.confirmed ? '' : `<button type="button" class="btn btn-dark" data-us="confirm" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">Resend confirmation</button>`}<button type="button" class="btn btn-outline" data-us="reset" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">Send password reset</button>${u.admin ? '' : `<div class="us-danger"><button type="button" class="btn ${u.banned ? 'btn-outline' : 'btn-danger'}" data-us="${u.banned ? 'unban' : 'ban'}" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">${u.banned ? 'Unsuspend' : 'Suspend'}</button><button type="button" class="btn btn-danger" data-us="delete" data-id="${esc(u.id)}" data-mail="${esc(u.email)}" data-co="${u.company ? esc(u.company.role) : ''}">Delete account</button></div>`}</div>
    </article>`).join('') || emptyState('No accounts found', q ? 'Nothing matches this search. Please check the email address.' : 'As soon as someone signs up, the account appears here.')}</div>
    <div class="pt-row">${page > 1 ? '<button class="btn btn-ghost" id="usPrev" type="button">← Back</button>' : ''}${r.data.more ? '<button class="btn btn-ghost" id="usNext" type="button">Next →</button>' : ''}</div></section>`;
  $('#usMk')?.addEventListener('click', () => (seg === 'b2c' ? openCreatePrivate(() => nutzer(v, 1, '', seg)) : openCreateAccount(null, () => nutzer(v, 1, '', seg))));
  const list = v.querySelector('.us-list');
  const applyUs = () => {
    const f = v.querySelector('[data-usf][aria-pressed=true]')?.dataset.usf || 'alle', so = $('#usSort')?.value || 'created';
    const cards = [...list.querySelectorAll('.us-card')];
    cards.sort((a, b) => so === 'mail' ? a.dataset.mail.localeCompare(b.dataset.mail, 'en') : (b.dataset[so] || '').localeCompare(a.dataset[so] || ''));
    cards.forEach((c) => { c.hidden = !c.dataset.tags.split(' ').includes(f); list.append(c); });
    let em = list.querySelector('.us-none'); const none = cards.length && cards.every((c) => c.hidden);
    if (none && !em) { list.insertAdjacentHTML('beforeend', `<div class="us-none">${emptyState('No accounts in this selection', 'Choose a different filter.')}</div>`); } else if (!none && em) em.remove();
  };
  v.querySelectorAll('[data-usf]').forEach((b) => b.onclick = () => { v.querySelectorAll('[data-usf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); applyUs(); });
  $('#usSort')?.addEventListener('change', applyUs);
  $('#usF').onsubmit = (e) => { e.preventDefault(); nutzer(v, 1, $('#usQ').value.trim(), seg); };
  v.querySelectorAll('[data-seg]').forEach((b) => b.onclick = () => { if (b.dataset.seg !== 'admin') { setSeg(b.dataset.seg); paintSeg(); } nutzer(v, 1, '', b.dataset.seg); });
  $('#usPrev')?.addEventListener('click', () => nutzer(v, page - 1, q, seg));
  $('#usNext')?.addEventListener('click', () => nutzer(v, page + 1, q, seg));
  v.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => import('./intern-feedback.mjs?v=892f3666').then((m) => m.accessDialog(b.dataset.acc, b.dataset.mail, (t, bad) => { msg(t, bad); if (!bad) nutzer(v, page, q, seg); })).catch(() => msg("The dialog couldn't be loaded. Please reload the page.", true)));
  v.querySelectorAll('[data-b2bacc]').forEach((b) => b.onclick = () => b2bAccessDialog(b.dataset.b2bacc, b.dataset.name, () => nutzer(v, page, q, seg)));
  v.querySelectorAll('[data-coapprove]').forEach((b) => b.onclick = async () => {
    if (!confirm(`Approve ${b.dataset.name}? The business will get an email.`)) return;
    b.disabled = true;
    const x = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'approve', id: b.dataset.coapprove }) });
    if (!x.ok) { msg(x.data?.error || 'Approval failed.', true); b.disabled = false; return; }
    msg('Business approved.'); nutzer(v, page, q, seg);
  });
  v.querySelectorAll('[data-coopen]').forEach((b) => b.onclick = () => { try { sessionStorage.setItem('lr-admin-open-partner', b.dataset.coopen); } catch { /* ignore */ } location.hash = 'partner'; });
  v.querySelectorAll('[data-us]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.us, m = b.dataset.mail;
    const ask = { ban: `Suspend account ${m}? Signing in will no longer be possible; open sessions expire within an hour.`, unban: `Reactivate account ${m}?`, confirm: `Resend the confirmation email to ${m}?`, reset: `Send a password reset email to ${m}?` }[a];
    let confirmEmail;
    if (a === 'delete') {
      const warn = b.dataset.co === 'owner' ? ' The business account is deleted together with all advisors, requests and documents; invoices stay archived as required by law.' : '';
      confirmEmail = prompt(`Permanently delete account ${m}?${warn} Profile, properties, documents and access will be removed – this can't be undone.\n\nType the email address to confirm:`);
      if (confirmEmail === null) return;
      if (confirmEmail.trim().toLowerCase() !== m.toLowerCase()) { msg("The email address doesn't match – nothing was deleted.", true); return; }
    } else if (!confirm(ask)) return;
    b.disabled = true;
    const x = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ action: a, id: b.dataset.id, ...(confirmEmail ? { confirmEmail } : {}) }) });
    if (!x.ok) { msg(x.data?.error || 'Action failed.', true); b.disabled = false; return; }
    msg({ ban: 'Account suspended.', unban: 'Account reactivated.', confirm: 'Confirmation email sent.', reset: 'Password reset email sent.', delete: 'Account deleted.' }[a]);
    nutzer(v, page, q, seg);
  });
}

// ---------- Overview: tiles per area (B2C | B2B) ----------
const MAILS = {
  b2c: [
    ['Confirm sign-up', 'leaserun'], ['Reset password', 'leaserun'], ['Resend confirmation / sign-in link', 'leaserun'],
    ['Cancellation confirmation', 'resend'], ['Reminders & data room shares', 'resend'], ['Payment receipts & invoices', 'stripe'],
  ],
  b2b: [
    ['Confirm sign-up (portal)', 'leaserun'], ['Registration record (PDF) to customer and business address', 'b2bmail'],
    ['Team invitations', 'resend'], ['New customer requests and submissions', 'resend'], ['Document review (result)', 'resend'], ['Invoices for pay-by-invoice (PDF)', 'resend'],
  ],
};
function mailState(kind, m) {
  if (kind === 'stripe') return ['gelb', 'via Stripe – logo/name under Stripe → Branding'];
  if (kind === 'b2bmail') return m.ready ? (m.b2bNotify ? ['gruen', 'LeaseRun · to support@leaserun.com'] : ['gelb', 'LeaseRun · copy to ADMIN_EMAILS (B2B_NOTIFY_EMAIL missing)']) : ['rot', 'not being sent'];
  if (kind === 'leaserun') return m.ready ? ['gruen', 'LeaseRun sender'] : ['gelb', 'temporarily Supabase sender'];
  return m.ready ? ['gruen', 'LeaseRun sender'] : ['rot', 'not being sent'];
}

async function uebersicht(v) {
  const seg = getSeg();
  const r = await api('/api/admin/system?segment=' + seg);
  if (!r.ok) { errState(v, r.data?.error); return; }
  const d = r.data, x = d[seg] || {};
  const n = (k) => num(k);
  const pct = (a, b) => (b ? ` · ${Math.round((a / b) * 100)}%` : '');
  const tile = (label, val, sub = '', go = '', tone = '') => `<${go ? `a href="#${go}"` : 'div'} class="wa-tile${tone ? ' ' + tone : ''}"><span class="wa-tile-l">${label}</span><strong>${val}</strong>${sub ? `<small>${sub}</small>` : ''}</${go ? 'a' : 'div'}>`;
  const common = [
    tile(seg === 'b2b' ? 'User accounts (owners & advisors)' : 'Accounts', n(d.accounts), `${n(d.new7d)} new in 7 days · ${n(d.new30d)} in 30 days`, 'nutzer'),
    tile('Email confirmed', n(d.confirmed), pct(d.confirmed, d.accounts).replace(' · ', '') || '–', 'nutzer', d.accounts && d.confirmed < d.accounts ? 'warn' : ''),
    tile('Two-factor on', n(d.mfa), pct(d.mfa, d.accounts).replace(' · ', '') || '–', 'sicherheit'),
    tile('Active (7 days)', n(d.active7d), `${n(d.sessions)} open sessions`, 'sicherheit'),
    tile('Suspended', n(d.banned), 'accounts without sign-in', 'nutzer', d.banned ? 'bad' : ''),
    tile('Lender Packages (30 days)', n(d.kreditmappen30d), `${n(d.documents)} documents stored`),
  ];
  const spec = seg === 'b2b' ? [
    tile('Businesses', n(x.companies), `${n(x.verified)} verified · ${n(x.paidPlans)} with a plan`, 'partner'),
    tile('Review pending', n(x.reviewPending), 'submitted documents', 'partner', x.reviewPending ? 'warn' : ''),
    tile('Suspended / inactive', n(x.locked), 'business accounts', 'partner', x.locked ? 'warn' : ''),
    tile('Customer requests (30 days)', n(x.leads30d), `${n(x.leadsNew)} still new`, 'anfragen'),
    tile('Submissions (30 days)', n(x.submissions30d), 'Lender Packages to partners'),
    tile('Open contact requests', n(x.contactOpen), 'via the business form', 'anfragen', x.contactOpen ? 'warn' : ''),
    tile('Revenue this month', eur(x.revenueMonthCents), 'paid business invoices (total)', 'cockpit'),
    tile('Open invoices', n(x.openInvoices), eur(x.openCents), 'rechnungen', x.openInvoices ? 'warn' : ''),
  ] : [
    tile('Paying customers', n(x.paying), 'active plan or pass', 'cockpit'),
    tile('Properties created', n(x.objects), 'across all accounts'),
    tile('Purchases (30 days)', n(x.purchases30d), eur(x.purchasesCents30d), 'cockpit'),
    tile('Revenue this month', eur(x.revenueMonthCents), 'paid invoices (total)', 'cockpit'),
    tile('Open invoices', n(x.openInvoices), 'consumers', 'rechnungen', x.openInvoices ? 'warn' : ''),
  ];
  const funnelBox = '<h3 class="wa-sub">Funnel: where users drop off</h3><div class="wa-period fn-period" role="group" aria-label="Period">' + [['30', '30 days'], ['90', '90 days'], ['', 'All time']].map(([k, l]) => `<button type="button" data-fn="${k}" aria-pressed="${k === ''}">${l}</button>`).join('') + '</div><div id="funnel" class="fn"><p class="lr-ld" role="status">Loading …</p></div>';
  v.innerHTML = `<section class="wa-over">
    <div class="wa-over-h"><h2>${SEGS[seg]}</h2><p class="form-note">Same metrics, separated by area. Switch at the top right (${seg === 'b2b' ? 'B2B' : 'B2C'} ⇄). Administrators are not counted. Numbers only, no content.</p></div>
    <h3 class="wa-sub">Accounts & usage</h3><div class="wa-tiles">${common.join('')}</div>
    <h3 class="wa-sub">${seg === 'b2b' ? 'Businesses, requests & billing' : 'Customers & revenue'}</h3><div class="wa-tiles">${spec.join('')}</div>
    ${funnelBox}
  </section>`;
  loadFunnel(seg);
  v.querySelectorAll('[data-fn]').forEach((b) => b.onclick = () => { v.querySelectorAll('[data-fn]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadFunnel(seg, b.dataset.fn); });
}

async function loadFunnel(seg, days = '') {
  const box = $('#funnel'); if (!box) return;
  const r = await api(`/api/admin/system?funnel=${seg}${days ? `&days=${days}` : ''}`);
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Not available.')}</p>`; return; }
  const steps = r.data.steps || [], first = Number(steps[0]?.[1] || 0);
  box.innerHTML = steps.map(([l, n], i) => {
    const prev = i ? Number(steps[i - 1][1]) : n, pct = first ? Math.round((n / first) * 100) : 0, conv = prev ? Math.round((n / prev) * 100) : 0;
    return `<div class="fn-row"><span class="fn-l">${esc(l)}</span><span class="fn-bar"><i style="width:${first ? Math.max(2, pct) : 0}%"></i></span><strong class="fn-n">${num(n)}</strong><small class="fn-c">${i ? (prev ? `${conv}% of previous step` : '–') : 'Start'}</small></div>`;
  }).join('') + (first ? '' : '<p class="form-note">No data in this period yet.</p>') + '<p class="form-note">Numbers only, no people. Administrators are not counted. The biggest drop between two steps shows where help matters most.</p>';
}

// ---------- Email delivery setup (System) ----------
// Supabase dashboard: "_" opens the project picker – choose the "leaserun" project (us-east-1).
const SB = 'https://supabase.com/dashboard/project/_';
function mailSetup(m) {
  const st = (ok, t) => `<span class="st ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}">${t}</span>`;
  const domOk = m.fromDomain === 'leaserun.com';
  const steps = [
    ['Resend account and domain', `On <a href="https://resend.com/domains" target="_blank" rel="noopener">resend.com → Domains</a> click "Add Domain" → <code>leaserun.com</code>, region <strong>North Virginia (us-east-1)</strong>.`, st(m.ready ? true : null, m.ready ? 'done' : 'manual')],
    ['Add DNS records', 'At your DNS provider for leaserun.com, copy the three records Resend shows exactly (MX and TXT for "send", TXT "resend._domainkey"). Also recommended: TXT <code>_dmarc</code> with <code>v=DMARC1; p=none;</code>. Then click "Verify DNS Records" in Resend (takes a few minutes).', st(m.ready ? true : null, m.ready ? 'done' : 'manual')],
    ['API key in Vercel', `Resend → API Keys → "Create" (sending access, domain leaserun.com). Add it in <a href="https://vercel.com/feray20/leaserun/settings/environment-variables" target="_blank" rel="noopener">Vercel → Environment Variables</a>: <code>RESEND_API_KEY</code> (the key), <code>NOTIFY_FROM_EMAIL</code> = <code>noreply@leaserun.com</code>, <code>B2B_NOTIFY_EMAIL</code> = <code>support@leaserun.com</code>. Then redeploy. Never share keys by chat or email.`,
      `${st(m.resendKey, m.resendKey ? 'key set' : 'key missing')} ${st(m.fromSet ? (domOk ? true : null) : false, m.fromSet ? (domOk ? 'sender @leaserun.com' : 'sender not @leaserun.com') : 'sender missing')} ${st(m.b2bNotify ? true : null, m.b2bNotify ? 'business address set' : 'business address optional')}`],
    ['Supabase: custom sender (SMTP)', `<a href="${SB}/auth/smtp" target="_blank" rel="noopener">Supabase → Authentication → Emails → SMTP Settings</a> → "Enable custom SMTP". Sender email <code>noreply@leaserun.com</code>, sender name <code>LeaseRun</code>, host <code>smtp.resend.com</code>, port <code>465</code>, username <code>resend</code>, password = Resend API key. Replaces the "Supabase Auth" sender in all remaining account emails.`, st(null, 'manual – verify with test 2')],
    ['Supabase: LeaseRun templates', `<a href="${SB}/auth/templates" target="_blank" rel="noopener">Supabase → Authentication → Emails → Templates</a>: paste subject and HTML from the list below into each template.`, st(null, 'manual')],
    ['Supabase: URLs', `<a href="${SB}/auth/url-configuration" target="_blank" rel="noopener">URL Configuration</a>: Site URL <code>https://leaserun.com</code>; Redirect URLs <code>https://leaserun.com/auth/login</code>, <code>/auth/reset</code>, <code>/auth/callback</code>, <code>/auth/confirm</code>, <code>/business-portal</code>.`, st(null, 'manual')],
  ];
  // Delivery set up: LeaseRun sends all account emails itself (Resend). The Supabase steps (SMTP, templates,
  // URLs) were only the fallback without own delivery – they and the template list disappear entirely.
  if (m.ready) steps.length = 0;
  return `<section class="pt-card wa-mailsetup" id="mailSetup"><h2>Email delivery (sender "LeaseRun")</h2>
    <p class="form-note">${m.ready ? `Own delivery active: <strong>${esc(m.from)}</strong>. All LeaseRun emails use the LeaseRun design with logo.` : 'Not set up yet – account emails temporarily come from the "Supabase Auth" sender; other emails (records, invoices, cancellations) are not sent.'}</p>
    <ol class="wa-steps">${steps.map(([t, b, s2]) => `<li><div class="wa-step-h"><strong>${t}</strong><span class="wa-step-st">${s2}</span></div><p>${b}</p></li>`).join('')}</ol>
    <h3 class="wa-sub">Testing</h3>
    <div class="pt-row"><button class="btn btn-dark" id="sysMail" type="button">Test 1: LeaseRun email to me</button><button class="btn btn-outline" id="sysAllMail" type="button">Test 2: All emails to me</button>${m.ready ? '' : '<button class="btn btn-outline" id="sysAuthMail" type="button">Account email via Supabase to me</button>'}</div>
    <p class="form-note">Test 1 checks delivery and sender. Test 2 sends every email LeaseRun can send (consumers, businesses, creators and notifications to you) once with sample data to your admin address. Subjects start with "[Test 1/…]"; links inside are examples. Takes about a minute.</p>
    ${m.ready ? '' : `<h3 class="wa-sub">Templates for Supabase</h3>
    <div class="wa-wrap"><table class="wa-table wa-tpl"><thead><tr><th>Template in Supabase</th><th>Subject</th><th></th></tr></thead><tbody>
    ${(m.templates || []).map((t) => `<tr><td><strong>${esc(t.supabase)}</strong><br><small>${esc(t.label)}</small></td><td><code class="wa-subj">${esc(t.subject)}</code></td><td class="wa-tpl-act"><button type="button" class="btn btn-ghost" data-copy-subj="${esc(t.subject)}">Copy subject</button><button type="button" class="btn btn-outline" data-tpl="${esc(t.id)}" data-act="copy">Copy HTML</button></td></tr>`).join('')}
    </tbody></table></div>`}</section>`;
}
function bindMailSetup(root2) {
  const done = (t, bad = false) => msg(t, bad);
  $('#sysMail', root2).onclick = async (e) => {
    e.target.disabled = true;
    const x = await api('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'testmail' }) });
    done(x.ok ? `Test email sent to ${x.data.to} – please check your inbox (and spam).` : x.data?.error || 'Error', !x.ok); e.target.disabled = false;
  };
  if ($('#sysAuthMail', root2)) $('#sysAuthMail', root2).onclick = async (e) => {
    if (!confirm('Send a password link via Supabase to your admin address? Your password stays unchanged as long as you don\'t use the link.')) return;
    e.target.disabled = true;
    const x = await api('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'testauth' }) });
    done(x.ok ? `Account email to ${x.data.to} triggered – check sender and design.` : x.data?.error || 'Error', !x.ok); e.target.disabled = false;
  };
  $('#sysAllMail', root2).onclick = async (e) => {
    if (!confirm('Send all email templates (about 60 emails) as a test to your admin address?')) return;
    const b = e.target, label = b.textContent; b.disabled = true;
    let from = 0, sent = 0, total = 0, to = ''; const failed = [];
    try {
      while (from !== null) {
        b.textContent = total ? `Sending … ${from}/${total}` : 'Sending …';
        const x = await api('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'testall', from }) });
        if (!x.ok) { done(x.data?.error || 'Sending failed', true); break; }
        ({ total, to } = x.data); sent += x.data.sent; failed.push(...(x.data.failed || [])); from = x.data.next;
        if (from === null) done(`${sent} of ${total} test emails sent to ${to}${failed.length ? ` – not sent: ${failed.join(', ')}` : ''}. Please check your inbox (and spam).`, failed.length > 0);
      }
    } finally { b.disabled = false; b.textContent = label; }
  };
  const copy = async (text, b) => {
    try { await navigator.clipboard.writeText(text); const o = b.textContent; b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = o; }, 1600); }
    catch { done('Copying isn\'t possible – please use "Download".', true); }
  };
  root2.querySelectorAll('[data-copy-subj]').forEach((b) => b.onclick = () => copy(b.dataset.copySubj, b));
  root2.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = async () => {
    const path = '/api/admin/system?template=' + encodeURIComponent(b.dataset.tpl);
    if (b.dataset.act === 'dl') { try { await download(path, {}, `leaserun-${b.dataset.tpl}.html`); } catch (e) { done(e.message, true); } return; }
    const r = await api(path);
    if (!r.ok) { done('Template not available.', true); return; }
    copy(await r.res.text(), b);
  });
}

// ---------- Create a business account (access with a starting password) ----------
const TYPES = [['BROKER', 'Mortgage broker (NMLS-licensed)'], ['REALTOR', 'Real estate brokerage / agent'], ['ADVISOR', 'Financial advisor / planner'], ['BANK', 'Bank / lender'], ['OTHER', 'Other business']];
// Open the proof of an account request (signed link, valid for 5 minutes).
async function openProof(id) {
  const w = window.open('', '_blank', 'noopener');
  const r = await api('/api/admin/misc?proof=' + encodeURIComponent(id));
  if (r.ok && r.data.url) { if (w) w.location.href = r.data.url; else location.href = r.data.url; } else { w?.close(); msg(r.data?.error || 'Proof not available.', true); }
}

// Create a consumer account (B2C) with a starting password.
function openCreatePrivate(done) {
  let d = document.getElementById('mkPDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'mkPDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<form class="wa-dlg-in" id="mkPF"><div class="wa-dlg-h"><h2>Create consumer account (B2C)</h2><button type="button" class="stage-x" id="mkPX" aria-label="Close">×</button></div>
    <p class="form-note">For consumers, e.g. after a phone consultation. Set the password yourself or have one generated. Optionally grant access right away.</p>
    <div class="wa-grid2"><label>Name*<input name="name" required minlength="2" maxlength="120"></label><label>Email (username)*<input name="email" type="email" required></label></div>
    <fieldset class="wa-fs"><legend>Password</legend><label class="wa-pw">Password<input name="password" type="text" autocomplete="new-password" minlength="10" maxlength="72" spellcheck="false" placeholder="at least 10 characters, letters + a number"></label>
      <span class="wa-hint">Leave empty to generate a secure password automatically.</span>
      <label class="chk"><input type="checkbox" name="mustChange" checked> <span>Require a new password at first sign-in</span></label></fieldset>
    <fieldset class="wa-fs"><legend>Access</legend><div class="wa-grid2"><label>Plan<select name="tier"><option value="free">Free (3 basic tools)</option><option value="starter">Buyer Pass – all buying tools</option><option value="pro">Investor Pro – all tools</option></select></label>
      <label>Valid until (empty = no end date)<input name="validUntil" type="date"></label>
      <label>Lender Packages (count)<input name="creditMaps" type="number" min="0" max="1000" value="0" inputmode="numeric"></label>
      </div><label class="chk"><input type="checkbox" name="leitfaden"> <span>Unlock the Pro Guide</span></label></fieldset>
    <label class="chk"><input type="checkbox" name="sendMail"> Also email the sign-in details</label>
    <p class="auth-message error" id="mkPMsg" hidden></p><div id="mkPOut"></div>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" id="mkPCancel">Cancel</button><button type="submit" class="btn btn-dark">Create account</button></div></form>`;
  const close = () => d.close();
  d.querySelector('#mkPX').onclick = close; d.querySelector('#mkPCancel').onclick = close;
  d.querySelector('#mkPF').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target)), btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const x = await api('/api/admin/user-create', { method: 'POST', body: JSON.stringify({ name: fd.name, email: fd.email, sendMail: fd.sendMail === 'on', password: fd.password || null, mustChange: fd.mustChange === 'on', access: { tier: fd.tier, creditMaps: Number(fd.creditMaps) || 0, leitfaden: fd.leitfaden === 'on', validUntil: fd.validUntil || null } }) });
    btn.disabled = false;
    const m = d.querySelector('#mkPMsg');
    if (!x.ok) { m.textContent = x.data?.error || 'Creating the account failed.'; m.hidden = false; return; }
    m.hidden = true;
    const txt = `Sign in: https://leaserun.com/auth/login\nUsername: ${x.data.email}\nPassword: ${x.data.password}${x.data.access && x.data.access !== 'free' ? `\nAccess: ${x.data.access === 'pro' ? 'Investor Pro' : 'Buyer Pass'}` : ''}`;
    d.querySelector('#mkPOut').innerHTML = `<div class="pt-alert ok"><strong>Consumer account created${x.data.mailed ? ' and sign-in details emailed' : ''}.</strong> These details are shown only now:<pre class="pt-code">${esc(txt)}</pre><button type="button" class="btn btn-outline" id="mkPCopy">Copy sign-in details</button></div>`;
    d.querySelector('#mkPCopy').onclick = async (ev) => { try { await navigator.clipboard.writeText(txt); ev.target.textContent = 'Copied ✓'; } catch { msg('Please select and copy manually.', true); } };
    e.target.querySelector('.wiz-nav').innerHTML = '<span></span><button type="button" class="btn btn-dark" id="mkPFin">Done</button>';
    d.querySelector('#mkPFin').onclick = () => { close(); done?.(); };
    e.target.querySelectorAll('input,select').forEach((i) => { i.disabled = true; });
  };
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}

function openCreateAccount(c, done) {
  let d = document.getElementById('mkDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'mkDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const f = (n, l, val = '', extra = '') => `<label>${l}<input name="${n}" value="${esc(val || '')}" ${extra}></label>`;
  d.innerHTML = `<form class="wa-dlg-in" id="mkF"><div class="wa-dlg-h"><h2>Create business (B2B)</h2><button type="button" class="stage-x" id="mkX" aria-label="Close">×</button></div>
    <p class="form-note">Set the password yourself or have one generated. At first sign-in the owner confirms business use and accepts the Data Processing Agreement (DPA).</p>
    <div class="wa-grid2">${f('companyName', 'Company name*', c?.company, 'required minlength="2"')}${f('legalForm', 'Entity type*', c?.legal_form, 'required placeholder="LLC, Inc., sole proprietor, …"')}
      <label>Type*<select name="institutionType">${TYPES.map(([k, l]) => `<option value="${k}"${c?.institution_type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${f('advisorName', 'Contact person*', c?.name, 'required minlength="2"')}${f('email', 'Email (username)*', c?.email, 'type="email" required')}${f('phone', 'Phone', c?.phone, 'type="tel" placeholder="(555) 123-4567"')}
      ${f('street', 'Street address*', '', 'required')}${f('postalCode', 'ZIP code*', '', 'required pattern="[0-9]{5}" inputmode="numeric"')}${f('city', 'City*', c?.city, 'required')}
      ${f('registerNumber', 'License number / NMLS ID', c?.register_number, 'placeholder="NMLS #… / state license #…"')}${f('taxId', 'EIN', c?.tax_id, 'placeholder="12-3456789"')}</div>
    <p class="form-note">License number / NMLS ID or EIN: one of the two is required.</p>
    ${c?.proof_name ? `<p class="pt-alert">Proof from the request: <strong>${esc(c.proof_name)}</strong> <button type="button" class="text-btn" data-proof="${c.id}">view</button> – will be added to the account's verification documents.</p>` : ''}
<fieldset class="wa-fs"><legend>Password</legend><label class="wa-pw">Password<input name="password" type="text" autocomplete="new-password" minlength="10" maxlength="72" spellcheck="false" placeholder="at least 10 characters, letters + a number"></label>
      <span class="wa-hint">Leave empty to generate a secure password automatically.</span>
      <label class="chk"><input type="checkbox" name="mustChange" checked> <span>Require a new password at first sign-in</span></label></fieldset>
    <fieldset class="wa-fs"><legend>Access</legend><div class="wa-grid2"><label>Plan<select name="plan"><option value="">no plan (books one itself)</option><option value="BASIC">Basic</option><option value="PRO">Pro</option><option value="ENTERPRISE">Enterprise</option></select></label>
      <label>Plan valid until (empty = no end date)<input name="planUntil" type="date"></label></div>
      <p class="form-note" style="margin:8px 0 6px">Modules</p><div class="wa-grid3"><label>Quick calculators<select name="mod_schnellrechner"><option value="auto">per plan</option><option value="on">on</option><option value="off">off</option></select></label><label>Lender Package<select name="mod_kreditmappe"><option value="auto">per plan</option><option value="on">on</option><option value="off">off</option></select></label><label>Stress test<select name="mod_stresstest"><option value="auto">per plan</option><option value="on">on</option><option value="off">off</option></select></label><label>White label<select name="mod_whitelabel"><option value="auto">per plan</option><option value="on">on</option><option value="off">off</option></select></label><label>CRM<select name="mod_crm"><option value="auto">per plan</option><option value="on">on</option><option value="off">off</option></select></label></div></fieldset>
    <label class="chk"><input type="checkbox" name="verified"> Business already verified – approve right away</label>
    <label class="chk"><input type="checkbox" name="sendMail"> Also email the sign-in details</label>
    <p class="auth-message error" id="mkMsg" hidden></p><div id="mkOut"></div>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" id="mkCancel">Cancel</button><button type="submit" class="btn btn-dark">Create account</button></div></form>`;
  const close = () => { d.close(); };
  d.querySelector('[data-proof]')?.addEventListener('click', (e) => openProof(e.target.dataset.proof));
  d.querySelector('#mkX').onclick = close; d.querySelector('#mkCancel').onclick = close;
  d.querySelector('#mkF').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const mods = Object.fromEntries(Object.entries(fd).filter(([k]) => k.startsWith('mod_')).map(([k, v]) => [k.slice(4), v]));
    const base = Object.fromEntries(Object.entries(fd).filter(([k]) => !k.startsWith('mod_') && !['password', 'mustChange', 'plan', 'planUntil'].includes(k)));
    const x = await api('/api/admin/b2b-create', { method: 'POST', body: JSON.stringify({ ...base, verified: fd.verified === 'on', sendMail: fd.sendMail === 'on', requestId: c?.id, password: fd.password || null, mustChange: fd.mustChange === 'on', plan: fd.plan || null, planUntil: fd.planUntil || null, modules: mods }) });
    btn.disabled = false;
    const m = d.querySelector('#mkMsg');
    if (!x.ok) { m.textContent = x.data?.error || 'Creating the account failed.'; m.hidden = false; return; }
    m.hidden = true;
    const txt = `Portal: https://partner.leaserun.com\nUsername: ${x.data.email}\nPassword: ${x.data.password}`;
    d.querySelector('#mkOut').innerHTML = `<div class="pt-alert ok"><strong>Account created (customer number ${esc(String(x.data.customerNumber))})${x.data.mailed ? ' and sign-in details emailed' : ''}.</strong> These details are shown only now:<pre class="pt-code">${esc(txt)}</pre><button type="button" class="btn btn-outline" id="mkCopy">Copy sign-in details</button></div>`;
    d.querySelector('#mkCopy').onclick = async (ev) => { try { await navigator.clipboard.writeText(txt); ev.target.textContent = 'Copied ✓'; } catch { msg('Please select and copy manually.', true); } };
    e.target.querySelector('.wiz-nav').innerHTML = '<span></span><button type="button" class="btn btn-dark" id="mkFin">Done</button>';
    d.querySelector('#mkFin').onclick = () => { close(); done?.(); };
    e.target.querySelectorAll('input,select').forEach((i) => { i.disabled = true; });
  };
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

// ---------- System: setup, test email, user lookup ----------
async function system(v, focusMail = false) {
  const r = await api('/api/admin/system');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const c = r.data.checks, need = c.filter((x) => !x.ok && !x.optional);
  v.innerHTML = `<div id="sysFiles"></div><h2>Setup</h2>
    <p class="form-note">${need.length ? `<strong>${need.length} item(s) open.</strong> Values are entered in Vercel under Settings → Environment Variables (never share them by chat or email), then redeploy.` : 'All required items are set up.'} Environment: ${esc(r.data.env)}${r.data.commit ? ` · version ${esc(r.data.commit)}` : ''}</p>
    <div class="wa-wrap"><table class="wa-table"><thead><tr><th></th><th>Area</th><th>Status</th><th>What to do</th></tr></thead><tbody>
    ${c.filter((x) => !x.ok).map((x) => `<tr><td><span class="wa-amp ${x.ok ? 'gruen' : x.optional ? 'gelb' : 'rot'}"></span></td><td>${esc(x.label)}${x.optional ? ' <small>(optional)</small>' : ''}</td><td>${x.ok ? 'set up' : 'missing'}${x.info ? ` · ${esc(x.info)}` : ''}</td><td><small>${x.ok ? '–' : esc(x.fix)}</small></td></tr>`).join('')}
    </tbody></table></div>
    <p class="form-note">${c.filter((x) => x.ok).length} items are set up and hidden. The full list with instructions is in the <a href="#einrichtung">Setup</a> tab.</p>
    <section class="pt-card tk-switch" id="tkSwitch"><h2>Test purchase</h2><p class="form-note">Loading …</p></section>
    ${mailSetup(r.data.mail || {})}
    <h2>Look up a user</h2><p class="form-note">Shows metrics only (sign-in, number of properties, documents, Lender Packages) – no content. Every lookup is logged.</p>
    <div class="pt-row"><input id="sysQ" type="email" placeholder="Email address" style="flex:1;min-width:220px;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px"><button class="btn btn-dark" id="sysFind" type="button">Search</button></div>
    <div id="sysUser"></div>`;
  bindMailSetup(v);
  // Send & receive files (OneDrive in the background)
  import('./intern-cloud.mjs?v=892f3666').then((m) => m.cloudCard(v.querySelector('#sysFiles'), { goTab, msg })).catch(() => {});
  testSwitch($('#tkSwitch'));
  if (focusMail) requestAnimationFrame(() => $('#mailSetup')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  const find = async () => {
    const q = $('#sysQ').value.trim(); if (!q) return;
    const x = await api('/api/admin/system?user=' + encodeURIComponent(q));
    const box = $('#sysUser');
    if (!x.ok) { box.innerHTML = `<p class="form-note">${esc(x.data?.error)}</p>`; return; }
    if (!x.data.found) { box.innerHTML = '<p class="form-note">No account with this email address.</p>'; return; }
    const u = x.data.user;
    box.innerHTML = `<dl class="pt-dl">${[['Account since', dtt(u.createdAt)], ['Last signed in', dtt(u.lastSignIn)], ['Email confirmed', u.confirmed ? 'yes' : 'no'], ['Second factor', u.mfa ? 'yes' : 'no'], ['Mode / phase', `${u.mode || '–'} / ${u.phase == null ? 'automatic' : u.phase + 1}`], ['Properties', u.objects], ['Documents', u.documents], ['Lender Packages', u.kreditmappen], ['Business account', u.b2b ? (u.b2b.role === 'owner' ? 'Owner' : 'Advisor') : 'no'], ['Last saved', dtt(u.updatedAt)]].map(([k, val]) => `<div><dt>${k}</dt><dd>${esc(String(val))}</dd></div>`).join('')}</dl>`;
  };
  $('#sysFind').onclick = find;
  $('#sysQ').onkeydown = (e) => { if (e.key === 'Enter') find(); };
}


// Test purchase switch: On = your own purchases (as administrator) run in Stripe test mode with a test card; customers always buy for real.
async function testSwitch(box) {
  if (!box) return;
  const r = await api('/api/admin/testkauf');
  if (!r.ok) { box.innerHTML = `<h2>Test purchase</h2><p class="form-note">${esc(r.data?.error || 'Not available.')}</p>`; return; }
  const d = r.data;
  box.innerHTML = `<div class="tk-sw-h"><div><h2>Test purchases</h2><p class="form-note">${d.on ? '<span class="st ok">On</span> Your purchases as administrator run in Stripe test mode: on the payment page enter test card <code>4242 4242 4242 4242</code>, any future date and any CVC. No money moves and nothing is unlocked.' : '<span class="st">Off</span> Everything runs live: Stripe checks card, address and payment like for any customer.'} Customers always buy for real – the switch applies to administrators only.</p>${d.at ? `<p class="form-note">Last turned ${d.on ? 'on' : 'off'} ${dtt(d.at)} by ${esc(d.by || '')}</p>` : ''}${d.available ? '' : '<p class="pt-alert warn">Test mode needs the Stripe test key in Vercel (STRIPE_TEST_SECRET_KEY = sk_test_…).</p>'}</div>
    <label class="tk-toggle"><input type="checkbox" id="tkOn"${d.on ? ' checked' : ''}${d.available ? '' : ' disabled'}><span aria-hidden="true"></span><b class="sr-only">Test purchases on or off</b></label></div>`;
  box.querySelector('#tkOn')?.addEventListener('change', async (e) => {
    const on = e.target.checked; e.target.disabled = true;
    const x = await api('/api/admin/testkauf', { method: 'POST', body: JSON.stringify({ on }) });
    if (!x.ok) { msg(x.data?.error || 'Saving failed.', true); e.target.checked = !on; e.target.disabled = false; return; }
    msg(on ? 'Test purchases are on – your purchases run in test mode.' : 'Test purchases are off – everything runs live.');
    testSwitch(box);
  });
}

// ---------- Finance Cockpit ----------
// The period bar stays in place; only the results are swapped (smoothly). Results are cached per period.
const CK_CACHE = new Map();
const isoD = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
function rangeOf(z) {
  const now = new Date(), t = isoD(now);
  if (z === 'heute') return [t, t];
  if (z === 'woche') { const m = new Date(now); m.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return [isoD(m), t]; }
  if (z === 'monat') return [isoD(new Date(now.getFullYear(), now.getMonth(), 1)), t];
  if (z === 'jahr') return [isoD(new Date(now.getFullYear(), 0, 1)), t];
  return ['', t];
}
// Money input: accepts "1,234.56", "1234.56" and "$1,234".
const parseMoney = (s) => Number(String(s ?? '').replace(/[$,\s]/g, ''));
// Billing status per active subscription/business account: shows whether every running contract was billed and paid.
const ABR_ST = { paid: 'ok', open: 'warn', overdue: 'bad', trial: '', '100% discount': '', 'no invoice': 'bad' };
function abrTable(b) {
  if (!b) return '';
  const rows = b.zeilen || [];
  return `<h2>Billing status per subscription and business account</h2>${(b.fehler || []).length ? `<p class="pt-alert">${b.fehler.map(esc).join(' ')}</p>` : ''}${rows.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Customer/account</th><th>Plan</th><th>Interval</th><th>Price</th><th>Last payment</th><th>Next billing</th><th>Open</th><th>Oldest open invoice</th><th>Status</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.kunde)}${x.quelle === 'rechnung' ? ' <span class="form-note">· pay by invoice</span>' : ''}</td><td>${esc(x.tarif)}</td><td>${esc(x.intervall)}</td><td>${eur(x.preisBrutto)}</td><td>${x.letzteZahlung ? `${dt(x.letzteZahlung.datum)} · ${eur(x.letzteZahlung.betrag)}` : '–'}</td><td>${x.naechsteAbrechnung ? dt(x.naechsteAbrechnung) : '–'}</td><td>${x.offen ? eur(x.offen) : '–'}</td><td>${x.aeltesteOffene ? `${esc(x.aeltesteOffene.nummer)}${x.aeltesteOffene.faellig ? ` · due ${dt(x.aeltesteOffene.faellig)}` : ''}` : '–'}</td><td><span class="st ${ABR_ST[x.status] ?? ''}">${esc(x.status)}</span>${x.hinweis ? `<span class="form-note"> ${esc(x.hinweis)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">No active subscription and no active business account.</p>'}
    <p class="form-note">Source: Stripe subscriptions (active, trial, past due) and the invoice archive. "No invoice": monthly plans without an invoice in the last 35 days, or no invoice since the contract started. Display only, nothing is changed.</p>`;
}
function ckResultsB2C(d) {
  const tile = (l, x, s = '') => `<div class="pt-kpi"><small>${l}</small><strong>${x}</strong>${s ? `<span class="form-note">${s}</span>` : ''}</div>`;
  const P = d.byPlan || {}, pl = (k) => P[k] || { count: 0, gross: 0, name: k };
  return `
    <h2>${esc(d.range.label)} · Consumers</h2>
    ${d.billingLive ? '' : '<p class="pt-alert">Payments are still in test mode (BILLING_ENABLED ≠ true) – values come from Stripe test mode.</p>'}
    <div class="pt-kpis">${tile('Gross revenue', eur(d.revenue.gross), `${d.revenue.count} payments${d.revenue.refunds ? ` · ${d.revenue.refunds} refunded` : ''}`)}${tile('Net revenue', eur(d.revenue.net))}${tile('Sales tax', eur(d.revenue.vat), 'only if Stripe Tax is on')}${tile('Lender Packages issued', String(d.downloads.kreditmappen), 'PDFs in this period')}</div>
    <div class="pt-kpis">${tile('Lender Package · $39', String(pl('credit-map').count), eur(pl('credit-map').gross))}${tile('Buyer Pass · $49', String(pl('buyer-pass').count), eur(pl('buyer-pass').gross))}${tile('Investor Pro · $29/month', String(pl('pro-monthly').count), `${eur(pl('pro-monthly').gross)} incl. renewals`)}${tile('Active Pro subscriptions', String(d.recurring.activeSubs), `MRR net ${eur(d.recurring.mrrNet)} · ARR ${eur(d.recurring.arrNet)}`)}</div>
    <h2>Net revenue, last 12 months</h2>${monthsChart(d.months || [])}
    ${abrTable(d.billing)}
    <h2>Payments in this period</h2>${(d.payments || []).length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Date</th><th>Plan</th><th>Type</th><th>Gross</th><th>Net</th><th>Status</th></tr></thead><tbody>${d.payments.map((x) => `<tr><td>${dt(x.date)}</td><td>${esc(x.planName)}</td><td>${x.kind === 'kauf' ? 'Purchase' : 'Subscription renewal'}</td><td>${eur(x.gross)}</td><td>${eur(x.net)}</td><td>${x.refunded ? '<span class="st warn">refunded</span>' : '<span class="st ok">paid</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">No payments in this period.</p>'}
    <p class="form-note">Source: Stripe (consumer plans only, excluding businesses and test purchases). Stripe issues consumer receipts; export for your CPA: Stripe → Reports.</p>`;
}
function ckResults(d) {
  if (d.scope === 'b2c') return ckResultsB2C(d);
  const tile = (l, x, s = '') => `<div class="pt-kpi"><small>${l}</small><strong>${x}</strong>${s ? `<span class="form-note">${s}</span>` : ''}</div>`;
  return `
    <h2>${esc(d.range.label)} · Businesses</h2>
    <div class="pt-kpis">${tile('Net revenue', eur(d.revenue.net), `${d.revenue.count} invoices${d.revenue.stornos ? `, ${d.revenue.stornos} corrections` : ''}`)}${tile('Sales tax', eur(d.revenue.vat), 'only if collected')}${tile('Gross revenue', eur(d.revenue.gross))}${tile('Open items', String(d.openItems.length), eur(d.openItems.reduce((s, x) => s + Number(x.gross_cents), 0)))}</div>
    <div class="pt-kpis">${tile('MRR net', eur(d.recurring.mrrNet), 'prices per industry from the business catalog')}${tile('ARR net', eur(d.recurring.arrNet))}${tile('Active plans', String(d.recurring.activeAccounts), `Basic ${d.recurring.byTier.BASIC} · Pro ${d.recurring.byTier.PRO} · Enterprise ${d.recurring.byTier.ENTERPRISE}${d.recurring.manualWithoutPrice ? ` · ${d.recurring.manualWithoutPrice} manual` : ''}`)}${tile('Expired in period', String(d.recurring.expiredInRange))}</div>
    <h2>Net revenue, last 12 months</h2>${monthsChart(d.months || [])}
    <h2>Referrals through Lender Packages</h2>
    <div class="pt-kpis">${tile('Lender Packages from businesses', String(d.viral.partnerDossiers))}${tile('Verification page views', String(d.viral.verifyViews))}${tile('New business accounts', String(d.viral.newAccounts), `via verification page: ${d.viral.viaVerify}`)}${tile('End-customer requests', String(d.viral.leads))}</div>
    ${abrTable(d.billing)}
    <h2>Open items</h2>${d.openItems.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Status</th><th>Number</th><th>Customer</th><th>Due</th><th>Total</th><th></th></tr></thead><tbody>
      ${d.openItems.map((x) => `<tr><td><span class="wa-amp ${x.ampel}"></span>${x.daysOverdue > 0 ? `${x.daysOverdue} days` : 'on time'}</td><td>${esc(x.invoice_number)}</td><td>${esc(x.buyer?.company)}</td><td>${dt(x.due_date)}</td><td>${eur(x.gross_cents)}</td><td class="wa-actions"><button data-paid="${x.id}" type="button">Mark as paid</button><button data-remind="${x.id}" type="button">Send payment reminder</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">No open items.</p>'}
    <h2>Invoices in this period</h2>${invTable(d.invoices)}`;
}
async function cockpit(v, zeitraum = 'heute', von = '', bis = '') {
  const today = isoD(new Date());
  // Build the frame only once
  if (!v.querySelector('#ckRes')) {
    const [dv, db] = rangeOf(zeitraum);
    v.innerHTML = `<div class="wa-period"><div class="seg" role="tablist" aria-label="Period">${[['heute', 'Today'], ['woche', 'Week'], ['monat', 'Month'], ['jahr', 'Year'], ['gesamt', 'All time']].map(([k, l]) => `<button type="button" role="tab" data-z="${k}" aria-selected="${k === zeitraum}">${l}</button>`).join('')}</div>
      <div class="wa-range"><label>From<span class="de-date"><span class="de-txt" data-for="zv"></span><input type="date" id="zv" value="${esc(von || dv)}" max="${today}"></span></label><label>To<span class="de-date"><span class="de-txt" data-for="zb"></span><input type="date" id="zb" value="${esc(bis || db)}" max="${today}"></span></label><button class="btn btn-outline" id="zf" type="button">Custom range</button></div></div>
      <div id="ckRes" class="ck-res" aria-live="polite"><p class="lr-ld" role="status">Loading …</p></div>`;
    v.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => {
      v.querySelectorAll('[data-z]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      const [a1, b1] = rangeOf(b.dataset.z); $('#zv').value = a1; $('#zb').value = b1; v.__deTxt?.();
      ckLoad(v, b.dataset.z, '', '');
    });
    // US date display above the native field (iPhone would otherwise show the device language).
    const deTxt = () => v.querySelectorAll('.de-txt').forEach((t) => { const val = $('#' + t.dataset.for).value; t.textContent = val ? new Date(val + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : 'since start'; });
    ['#zv', '#zb'].forEach((id) => $(id).addEventListener('change', deTxt)); deTxt(); v.__deTxt = deTxt;
    $('#zf').onclick = () => { v.querySelectorAll('[data-z]').forEach((x) => x.setAttribute('aria-selected', 'false')); ckLoad(v, 'frei', $('#zv').value, $('#zb').value); };
  } else if (!von && !bis) {
    // Reopened: reset the bar to the requested period (default: today).
    const [dv, db] = rangeOf(zeitraum);
    v.querySelectorAll('[data-z]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.z === zeitraum)));
    if ($('#zv')) { $('#zv').value = dv; $('#zb').value = db; v.__deTxt?.(); }
  }
  await ckLoad(v, zeitraum, von, bis);
}
let ckSeq = 0;
async function ckLoad(v, zeitraum, von, bis, fresh = false) {
  const box = v.querySelector('#ckRes'); if (!box) return;
  const key = `${zeitraum}|${von}|${bis}`, my = ++ckSeq;
  const paint = (d) => {
    box.innerHTML = ckResults(d);
    box.classList.remove('ck-busy');
    bindInv(box, () => { CK_CACHE.clear(); ckLoad(v, zeitraum, von, bis, true); });
  };
  if (!fresh && CK_CACHE.has(key)) { paint(CK_CACHE.get(key)); return; }
  box.classList.add('ck-busy');
  const r = await api(`/api/admin/finance?zeitraum=${zeitraum}&von=${von}&bis=${bis}`);
  if (my !== ckSeq) return; // stale response (a different period was chosen meanwhile)
  if (!r.ok) { box.classList.remove('ck-busy'); box.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Not available.')}</p>`; return; }
  CK_CACHE.set(key, r.data);
  paint(r.data);
}

// Simple bars with value labels; months without revenue stay visible ($0). Short month names, year only in January.
function monthsChart(months) {
  const max = Math.max(1, ...months.map((x) => x.net));
  const empty = !months.some((x) => x.net > 0);
  const mon = (m) => new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(m + '-01T12:00:00Z'));
  const yr = (m) => "'" + m.slice(2, 4);
  const full = (m) => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-01T12:00:00Z'));
  return `<div class="wa-chart">${empty ? '<p class="wa-chart-empty">No revenue in the last 12 months yet.</p>' : ''}<div class="wa-bars" role="list">${months.map((x, i) => `<div class="wa-bar" role="listitem" aria-label="${full(x.m)}: ${eur(x.net, 0)}"><span class="wa-bar-v">${x.net ? eur(x.net, 0) : ''}</span><span class="wa-bar-f" style="height:${Math.max(x.net > 0 ? 3 : 0, Math.round((x.net / max) * 100))}%"></span><span class="wa-bar-l">${mon(x.m)}${x.m.endsWith('-01') || i === 0 ? `<em>${yr(x.m)}</em>` : ''}</span></div>`).join('')}</div></div>`;
}

const invTable = (rows) => rows.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Number</th><th>Type</th><th>Date</th><th>Customer</th><th>Net</th><th>Tax</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
  ${rows.map((x) => `<tr><td>${esc(x.invoice_number)}</td><td>${{ invoice: 'Invoice', storno: 'Void', credit: 'Credit memo' }[x.kind]}${x.source === 'stripe' ? ' · Stripe' : ''}</td><td>${dt(x.issue_date)}</td><td>${esc(x.buyer?.company)}</td><td>${eur(x.net_cents)}</td><td>${eur(x.vat_cents)}</td><td>${eur(x.gross_cents)}</td><td>${PAY[x.payment_status]}</td>
  <td class="wa-actions"><button data-pdf="${x.id}" type="button">PDF</button>${x.kind === 'invoice' && x.source === 'manual' && x.payment_status !== 'CANCELLED' ? `<button data-storno="${x.id}" type="button">Void</button>` : ''}${['PENDING', 'OVERDUE'].includes(x.payment_status) ? `<button data-paid="${x.id}" type="button">Paid</button><button data-remind="${x.id}" type="button">Remind</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">No invoices.</p>';

function bindInv(v, reload) {
  v.querySelectorAll('[data-pdf]').forEach((b) => b.onclick = async () => {
    try { const res = await download('/api/admin/invoices?id=' + b.dataset.pdf, {}, 'Invoice.pdf'); if (res.headers.get('x-integrity') === 'mismatch') msg('Warning: the PDF checksum does not match!', true); else msg('PDF downloaded, checksum OK.'); } catch (e) { msg(e.message, true); }
  });
  v.querySelectorAll('[data-storno]').forEach((b) => b.onclick = async () => {
    if (!confirm('Issue a void invoice? The original invoice stays unchanged in the archive.')) return;
    const r = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'storno', invoiceId: b.dataset.storno }) });
    if (r.ok) { msg(`Void ${r.data.invoice.invoice_number} issued.`); reload(); } else msg(r.data?.error || 'Error', true);
  });
  v.querySelectorAll('[data-remind]').forEach((b) => b.onclick = async () => {
    if (!confirm('Send a payment reminder with the invoice PDF to the business?')) return;
    b.disabled = true;
    const r = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'remind', invoiceId: b.dataset.remind }) });
    b.disabled = false;
    if (r.ok) msg(`Reminder sent (reminder no. ${r.data.stufe}).`); else msg(r.data?.error || 'Error', true);
  });
  v.querySelectorAll('[data-paid]').forEach((b) => b.onclick = async () => {
    const r = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'paid', invoiceId: b.dataset.paid }) });
    if (r.ok) { msg('Marked as paid.'); reload(); } else msg(r.data?.error || 'Error', true);
  });
}

// ---------- Security ----------
async function sicherheit(v) {
  const r = await api('/api/admin/check');
  // Security overview at the top (loads in parallel).
  api('/api/admin/system?security=1').then((o) => {
    const x = o.data || {}; if (!o.ok) return;
    const ACT = { login: 'Sign-in', logout: 'Sign-out', user_signedup: 'Sign-up', user_confirmation_requested: 'Confirmation requested', user_recovery_requested: 'Password reset requested', user_modified: 'Account changed', user_deleted: 'Account deleted', factor_in_progress: '2FA setup started', mfa_code_login: 'Sign-in with 2FA code', verification_attempted: 'Code checked' };
    const box = document.createElement('section'); box.className = 'pt-card sec-ov';
    const pct = x.users ? Math.round((x.mfaUsers / x.users) * 100) : 0;
    box.innerHTML = `<h2>Security status</h2><div class="sec-kpis">
      <div><small>Accounts</small><strong>${x.users ?? '–'}</strong><span>${x.confirmed ?? 0} confirmed</span></div>
      <div><small>Two-factor on</small><strong>${x.mfaUsers ?? 0}</strong><span>${pct}% · app ${x.mfaTotp ?? 0} · SMS ${x.mfaPhone ?? 0}</span></div>
      <div><small>Active sessions (30 d)</small><strong>${x.activeSessions ?? 0}</strong><span>with 2FA ${x.aal2Sessions ?? 0}</span></div>
      <div><small>Sign-ins</small><strong>${x.signIns24h ?? 0}</strong><span>24 h · ${x.signIns7d ?? 0} in 7 days</span></div>
      <div><small>Password resets (7 d)</small><strong>${x.recovery7d ?? 0}</strong><span>suspicious if many at once</span></div>
      <div><small>Blocked (7 d)</small><strong>${Object.values(x.blocked7d || {}).reduce((a, b) => a + Number(b || 0), 0)}</strong><span>${Object.entries(x.blocked7d || {}).map(([k, n]) => `${esc(k)} ${n}`).join(' · ') || 'none'}</span></div>
    </div>
    <h3>Recent account events</h3>${(x.events || []).length ? `<table class="bill-table"><thead><tr><th>Time</th><th>Event</th><th>Account</th><th>IP</th></tr></thead><tbody>${x.events.map((e) => `<tr><td>${dtt(e.at)}</td><td>${esc(ACT[e.action] || e.action)}</td><td>${esc(e.who)}</td><td>${esc(e.ip || '–')}</td></tr>`).join('')}</tbody></table>` : '<p class="form-note">No events logged yet.</p>'}
    <p class="form-note">Email and IP addresses are shown truncated. Recommendation: two-factor protection for all administrators and business accounts.</p>`;
    const inc = v.querySelector('#secInc'); if (inc) inc.after(box); else v.prepend(box);
  }).catch(() => {});
  const p = r.data?.panic || { active: false };
  const lv = p.active ? (p.level === 1 ? 1 : 2) : 0;
  v.innerHTML = `<section class="pt-card"><h2>Emergency stop</h2>
    ${lv ? `<div class="pt-alert bad"><strong>Level ${lv} active since ${dtt(p.since)}</strong> (${esc(p.by || '')}${p.reason ? ': ' + esc(p.reason) : ''}). ${lv === 1 ? 'No new sign-ups, purchases, requests or business APIs; signed-in users can only read.' : `All users except administrators are rejected${p.revoked != null ? ` (${p.revoked} sessions ended)` : ''}; the daily run is paused.`}</div>
      <div class="panic-act">${lv === 1 ? '<button class="btn btn-dark panic-2" id="p2" type="button">Escalate to level 2</button>' : ''}<button class="btn btn-dark" id="pOff" type="button">End emergency stop</button></div>`
      : `<div class="panic-grid"><div class="panic-card"><strong>Level 1 · Soft lock</strong><p>Sign-ups, purchases, requests, partner pages, widget and business APIs off. Signed-in users can keep reading but can't change anything. Admins work normally.</p><button class="btn btn-dark panic-1" id="p1" type="button">Trigger level 1</button></div>
        <div class="panic-card hard"><strong>Level 2 · Hard lock</strong><p>Additionally: all sessions except admins are ended, all APIs reject non-admins, the daily run pauses.</p><button class="btn btn-dark panic-2" id="p2" type="button">Trigger level 2</button></div></div>`}
    <p class="form-note">Takes effect everywhere within 15 seconds. When triggered you get a notification in the LeaseRun Admin app. For a full key rotation, also rotate the JWT secret in Supabase.</p></section>
    <section class="pt-card"><h2>Admin access protection</h2><ul class="plain-list">
      <li>Second factor: ${r.data?.mfaRequired ? '<span class="st ok">required</span>' : '<span class="st bad">disabled (ADMIN_MFA=off)</span>'}</li>
      <li>No IP lock for the admin: you can sign in from anywhere (including mobile). Protection through sign-in, admin list, second factor, timeout and emergency stop.</li>
      <li>Sign-in attempts: Supabase limits failed sign-ins; in addition LeaseRun automatically blocks a source for 24 hours after 10 failed attempts in 15 minutes (likewise for repeated admin access attempts; scanners for 7 days).</li>
      <li>All admin actions are listed in the Audit log tab.</li></ul></section>
    <section class="pt-card"><h2>Security log</h2><p class="form-note">Throttled requests (too many per user or IP) and rejected attempts to access the admin area. Only the area and a shortened hash are stored, no IP addresses; deleted after 30 days. Counting is per server instance, so peaks may be split.</p><div id="secLog"><p class="lr-ld" role="status">Loading …</p></div><button class="btn btn-ghost" id="secRe" type="button">Refresh</button></section>`;
  // Incidents: attacks and bot waves of the last 7 days with Block / Done.
  v.insertAdjacentHTML('afterbegin', '<section class="pt-card sec-inc" id="secInc"><p class="lr-ld" role="status">Loading incidents …</p></section>');
  // Top: the security check lives in Headquarters ("Check now", "Fix all"). The emergency stop stays visible; incidents, logs and
  // settings are collapsed below – all information stays reachable.
  {
    const det = document.createElement('details'); det.className = 'sec-more';
    det.innerHTML = '<summary>Incidents, logs and settings</summary>';
    [...v.children].filter((el) => !el.querySelector('#p1, #p2, #pOff')).forEach((el) => det.append(el));
    v.append(det);
    const top = document.createElement('div'); v.prepend(top);
    top.innerHTML = '<section class="pt-card ck-ref"><div><h2>Check &amp; fix</h2><p class="form-note">All checks (security, email, tech, operations) plus the "Check now" and "Fix all" buttons are in Headquarters.</p></div><button type="button" class="btn btn-dark" data-tohq>Go to Headquarters</button></section>';
    top.querySelector('[data-tohq]').onclick = () => goTab('hq');
  }
  const loadInc = async () => {
    const box = $('#secInc'); const x = await api('/api/admin/sec');
    if (!x.ok) { box.innerHTML = `<p class="form-note">${esc(x.data?.error || 'Not available.')}</p>`; return; }
    const d = x.data, act = d.blocks.filter((b) => b.active);
    const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : dt(t); };
    box.innerHTML = `<div class="sec-inc-h"><h2>Incidents (7 days)</h2>${d.open ? `<span class="st bad">${d.open} open</span>` : '<span class="st ok">all handled</span>'}</div>
      <p class="form-note"><button class="text-btn" id="secTest" type="button">Send me a test alert</button> · For attacks and bot waves you automatically get an email (at most every 15 minutes per type). Here you can block sources – blocked sources lose access to the APIs. Only a shortened ID is stored, no IP address.</p>
      ${d.groups.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Type</th><th>Source</th><th>Count</th><th>Last</th><th>Details</th><th></th></tr></thead><tbody>${d.groups.map((g) => `<tr class="${g.open ? 'sec-open' : ''}"><td><strong>${esc(g.label)}</strong>${g.open ? `<br><small>${g.open} open</small>` : ''}</td><td>${g.ip ? `<code>${esc(g.ip.slice(0, 8))}</code>${g.blocked ? ' <span class="st">blocked</span>' : ''}` : '–'}</td><td>${g.n}</td><td>${esc(ago(g.last))}</td><td><small>${g.details.map(esc).join('<br>')}</small></td><td class="sec-act">${g.ip && !g.blocked ? `<button class="btn btn-dark btn-sm" data-blk="${g.ip}" data-days="1">Block 24 h</button><button class="text-btn" data-blk="${g.ip}" data-days="30">30 days</button><button class="text-btn" data-blk="${g.ip}" data-days="0">permanently</button>` : ''}${g.open ? `<button class="text-btn" data-ack="${esc(g.kind)}" data-ip="${g.ip || ''}">done</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${d.open ? '<p><button class="btn btn-outline" id="ackAll" type="button">Mark all as done</button></p>' : ''}` : '<p class="pt-alert ok">No incidents in the last 7 days.</p>'}
      <h3 class="wa-sub">Your own devices – never logged or blocked</h3>
      <p class="form-note">Devices you signed in to the Web-Admin with, and their networks, are recognized automatically. ${d.here?.trusted || d.here?.cookie ? '<span class="st ok">This device is marked as yours</span>' : '<button class="btn btn-outline btn-sm" id="secTrust" type="button">Mark this device as mine</button>'}</p>
      ${d.trusted?.length ? `<ul class="sec-blocks">${d.trusted.map((t) => `<li><code>${esc(t.ip.slice(0, 8))}</code><span>${esc(t.label)}${t.here ? ' · <strong>current network</strong>' : ''} · last seen ${esc(dtt(t.seen))}</span><button class="text-btn" data-untrust="${t.ip}">remove</button></li>`).join('')}</ul>` : ''}
      ${act.length ? `<h3 class="wa-sub">Blocked sources (${act.length})</h3><ul class="sec-blocks">${act.map((b) => `<li><code>${esc(b.ip_hash.slice(0, 8))}</code><span>${b.until ? 'until ' + dtt(b.until) : 'permanent'}${b.reason ? ' · ' + esc(b.reason) : ''}</span><button class="text-btn" data-unblk="${b.ip_hash}">unblock</button></li>`).join('')}</ul>` : ''}`;
    box.querySelectorAll('[data-blk]').forEach((b) => b.onclick = async () => { const days = Number(b.dataset.days) || null; const reason = prompt('Reason (optional, for the log):', 'Attack attempt') ?? null; if (reason === null) return; const y = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'block', ip: b.dataset.blk, days, reason }) }); if (y.ok) { msg('Source blocked.'); loadInc(); } else msg(y.data?.error || 'Error', true); });
    $('#secTrust')?.addEventListener('click', async () => { const y = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'trust', label: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone/iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computer' }) }); msg(y.ok ? 'This device will no longer be logged.' : (y.data?.error || 'Error'), !y.ok); loadInc(); });
    box.querySelectorAll('[data-untrust]').forEach((b) => b.onclick = async () => { if (!confirm('Stop treating this network as yours?')) return; await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'untrust', ip: b.dataset.untrust }) }); loadInc(); });
    box.querySelectorAll('[data-unblk]').forEach((b) => b.onclick = async () => { if (!confirm('Lift the block?')) return; await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'unblock', ip: b.dataset.unblk }) }); loadInc(); });
    box.querySelectorAll('[data-ack]').forEach((b) => b.onclick = async () => { await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'ack', kind: b.dataset.ack, ip: b.dataset.ip || null }) }); loadInc(); });
    $('#secTest')?.addEventListener('click', async () => { const y = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'testalert' }) }); msg(y.ok ? 'Test alert sent – please check your inbox.' : (y.data?.error || 'Error'), !y.ok); });
    $('#ackAll')?.addEventListener('click', async () => { await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'ack' }) }); loadInc(); });
  };
  loadInc();
  const KIND = { rate_limit: 'Throttled', admin_denied: 'Admin denied', admin_ip_blocked: 'IP not allowed', admin_mfa_missing: 'Second factor missing', panic: 'Emergency stop', honeypot: 'Bot (honeypot)', too_fast: 'Bot (too fast)', disposable_email: 'Disposable address', email_no_mx: 'Domain without mail server', content_flagged: 'Suspected spam' };
  const loadLog = async () => {
    const l = await api('/api/admin/support?log=1');
    if (!$('#secLog')) return; // view changed in the meantime
    if (!l.ok) { $('#secLog').innerHTML = `<p class="form-note">${esc(l.data?.error)}</p>`; return; }
    const top = Object.entries(l.data.counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    $('#secLog').innerHTML = `${top.length ? `<p><strong>Last 24 hours:</strong> ${top.map(([k, n]) => { const [kind, bucket] = k.split(':'); return `${esc(KIND[kind] || kind)} (${esc(bucket)}): ${n}`; }).join(' · ')}</p>` : '<p class="form-note">Nothing unusual in the last 24 hours.</p>'}
      ${l.data.events.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Time</th><th>Event</th><th>Area</th><th>ID</th></tr></thead><tbody>${l.data.events.slice(0, 60).map((e) => `<tr><td>${dtt(e.created_at)}</td><td>${esc(KIND[e.kind] || e.kind)}</td><td>${esc(e.bucket || '')}</td><td><code>${esc(e.subject || '')}</code></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  };
  loadLog();
  $('#secRe').onclick = loadLog;
  const go = async (on, level = 2) => {
    const reason = on ? prompt('Reason (for the log):', 'Security incident') : '';
    if (on && reason === null) return;
    if (!confirm(on ? `Trigger emergency stop level ${level} now?${level === 2 ? ' All users except administrators will be signed out.' : ''}` : 'End the emergency stop?')) return;
    const x = await api('/api/admin/support', { method: 'POST', body: JSON.stringify({ panic: on, reason, level }) });
    if (x.ok) { msg(on ? `Emergency stop level ${level} active (takes effect everywhere within 15 seconds).${level === 2 ? (x.data.revoked != null ? ` ${x.data.revoked} sessions ended.` : ' Note: sessions could not be ended – database function lr_revoke_sessions is missing.') : ''}` : 'Emergency stop ended.'); sicherheit(v); } else msg(x.data?.error || 'Error', true);
  };
  if ($('#p1')) $('#p1').onclick = () => go(true, 1);
  if ($('#p2')) $('#p2').onclick = () => go(true, 2);
  if ($('#pOff')) $('#pOff').onclick = () => go(false);
}

// ---------- Partners ----------
const BR_LABEL = { bank: 'Bank / lender', vermittler: 'Mortgage broker', makler: 'Real estate agent / brokerage', finanzberater: 'Financial advisor', allgemein: 'Other business' };
// Industry of the account (determines packages and tools) and added industries – changed only here by support.
function brancheDialog(id, cur, extras, done) {
  let d = document.getElementById('brAdm'); if (!d) { d = document.createElement('dialog'); d.id = 'brAdm'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<form class="wa-dlg-in" method="dialog" id="brAdmF"><div class="wa-dlg-h"><h2>Set industry</h2><button class="stage-x" type="button" data-x aria-label="Close">×</button></div>
    <label>Main industry<select name="branche">${Object.entries(BR_LABEL).map(([k, l]) => `<option value="${k}"${k === (cur || 'allgemein') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <fieldset><legend>Add-on industries (billing: Stripe subscription or invoice)</legend>${Object.entries(BR_LABEL).filter(([k]) => k !== 'bank').map(([k, l]) => `<label class="consent"><input type="checkbox" name="ex" value="${k}"${extras.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
    <p class="form-note">Takes effect right away on packages and software tools in the portal. For Stripe subscriptions, the next subscription sync aligns the add-on industries with the subscription.</p>
    <div class="pt-row"><button class="btn btn-dark" type="submit">Save</button></div></form>`;
  d.showModal();
  d.querySelector('[data-x]').onclick = () => d.close();
  d.querySelector('#brAdmF').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, branche = f.branche.value, ex = [...f.querySelectorAll('[name=ex]:checked')].map((x) => x.value).filter((x) => x !== branche);
    const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'branche', id, branche, extras: ex }) });
    if (r.ok) { d.close(); msg('Industry saved.'); done?.(); } else msg(r.data?.error || 'Error', true);
  };
}

async function partner(v) {
  const r = await api('/api/admin/b2b');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const list = r.data.accounts;
  const pend = list.filter((a) => a.verification_status === 'eingereicht').length;
  v.innerHTML = `<div class="wa-mk-tiles"><button class="wa-mk b2b" type="button" id="mkNew"><b>+ Create business</b><span>B2B · company access to the business portal</span></button><button class="wa-mk" type="button" id="mkCat"><b>Packages &amp; pricing</b><span>Industries, prices, features, tools, add-on industry</span></button></div>${pend ? `<p class="auth-message" style="margin-bottom:10px"><strong>${pend} ${pend === 1 ? 'business is' : 'businesses are'}</strong> waiting for review and approval. Choose the filter "Waiting for review" and open "Review".</p>` : ''}<div class="pt-row" style="margin-bottom:10px"><input id="pq" aria-label="Search businesses" placeholder="Search (company, city, customer number)" style="flex:1;min-width:220px;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px"><button class="btn btn-ghost" id="pCsv" type="button">CSV</button></div>
    <div class="pc-bar"><div class="pc-chips" role="group" aria-label="Status">${[['', 'All'], ['pruefen', 'Waiting for review'], ['active', 'Active'], ['locked', 'Suspended']].map(([k, l]) => `<button type="button" data-pf="${k}" aria-pressed="${k === '' ? 'true' : 'false'}">${l} <b>${k === '' ? list.length : list.filter((a) => (a.status + (a.verified_at ? '' : ' unverified') + (a.verification_status === 'eingereicht' ? ' pruefen' : '')).split(' ').includes(k)).length}</b></button>`).join('')}</div>
      <div class="pc-batch" id="pcBatch" hidden><span id="pcN">0 selected</span><button type="button" class="btn btn-outline btn-sm" id="pcAll">All visible</button><button type="button" class="btn btn-sm pc-del" id="pcDel">Delete selected</button></div></div>
    ${list.length ? `<div class="pc-list">${list.map((a) => { const st = a.status === 'locked' ? ['bad', 'Suspended'] : a.verification_status === 'eingereicht' ? ['warn', 'Waiting for review'] : !a.verified_at ? ['warn', a.verification_status === 'abgelehnt' ? 'Rejected' : 'Unverified'] : ['ok', 'Active']; return `<article class="pc" data-row="${a.id}" data-s="${a.status}${a.verified_at ? '' : ' unverified'}${a.verification_status === 'eingereicht' ? ' pruefen' : ''}" data-q="${esc((a.company_name + ' ' + a.city + ' ' + a.customer_number + ' ' + a.email + ' ' + (a.register_number || '') + ' ' + (a.tax_id || '')).toLowerCase())}">
      <header class="pc-h"><label class="pc-sel"><input type="checkbox" data-sel="${a.id}" data-owner="${esc(a.owner_id || '')}" data-mail="${esc(a.email)}" aria-label="Select ${esc(a.company_name)}"></label><div><strong>${esc(a.company_name)}</strong><small>${esc(a.customer_number)} · ${esc(a.city)} ${esc(a.postal_code)}</small></div><span class="st ${st[0]}">${st[1]}</span></header>
      <dl class="pc-meta"><div><dt>Entity type</dt><dd>${esc(a.legal_form)} · ${esc(a.institution_type)}</dd></div><div><dt>Industry</dt><dd>${esc(BR_LABEL[a.branche] || a.branche || '–')}${(a.extra_branches || []).length ? ` + ${a.extra_branches.map((x) => esc(BR_LABEL[x] || x)).join(', ')}` : ''}</dd></div><div><dt>License / NMLS</dt><dd>${esc(a.register_number || '–')}</dd></div><div><dt>EIN</dt><dd>${esc(a.tax_id || '–')}</dd></div><div><dt>Advisor</dt><dd>${esc(a.advisor_name || '–')}<br><small>${esc(a.email)}</small></dd></div><div><dt>Plan</dt><dd>${a.tier ? TIER[a.tier] : '–'}${a.plan_source === 'manual' ? ' (manual)' : ''}${a.plan_until ? ` · until ${dt(a.plan_until)}` : ''}${a.dossier_bonus ? ` · +${a.dossier_bonus} packages` : ''}</dd></div><div><dt>Requests</dt><dd>${a.leads}${a.has_whitelabel ? ' · white label' : ''}${a.allow_invoice_payment ? ' · pay by invoice' : ''}</dd></div></dl>
      ${a.status === 'locked' && a.lock_reason ? `<p class="pc-lock">Suspended: ${esc(a.lock_reason)}</p>` : ''}
      <footer class="pc-act">${a.verified_at ? `<button class="btn btn-outline btn-sm" data-a="details" data-id="${a.id}" type="button">Details</button>` : `<button class="btn btn-dark btn-sm" data-a="details" data-id="${a.id}" type="button">Review &amp; approve</button>`}
        <details class="pc-menu"><summary class="btn btn-outline btn-sm">Actions ▾</summary><div class="pc-menu-in">
          ${a.verified_at ? `<button data-a="verify" data-on="false" data-id="${a.id}" type="button">Revoke approval</button>` : ''}
          <button data-a="branche" data-id="${a.id}" data-br="${esc(a.branche || '')}" data-ex="${esc((a.extra_branches || []).join(','))}" type="button">Set industry</button>
          <button data-a="plan" data-id="${a.id}" type="button">Assign plan</button>
          <button data-a="karten" data-id="${a.id}" data-name="${esc(a.company_name)}" type="button">Company cards (LeaseRun Card)</button>
          <button data-a="modules" data-id="${a.id}" data-name="${esc(a.company_name)}" data-mod="${esc(JSON.stringify(a.modules || {}))}" type="button">Unlock modules</button>
          <button data-a="whitelabel" data-on="${!a.has_whitelabel}" data-id="${a.id}" type="button">${a.has_whitelabel ? 'Remove white label' : 'Enable white label'}</button>
          <button data-a="invoicePayment" data-on="${!a.allow_invoice_payment}" data-id="${a.id}" type="button">${a.allow_invoice_payment ? 'Pay by invoice off' : 'Pay by invoice on'}</button>
          <button data-a="credits" data-id="${a.id}" type="button">Quota +</button>
          <button data-a="invoice" data-id="${a.id}" data-name="${esc(a.company_name)}" type="button">Write invoice</button>
          ${a.status === 'locked' ? `<button data-a="unlock" data-id="${a.id}" type="button">Unsuspend</button>` : `<button data-a="lock" data-id="${a.id}" type="button" class="pc-danger">Suspend</button>`}
          <button data-a="delete" data-id="${a.id}" data-name="${esc(a.company_name)}" type="button" class="pc-danger">Delete business</button>
        </div></details></footer></article>`; }).join('')}</div>` : emptyState('No business accounts yet', 'Create a business or take over an account request under "Requests".')}
    <div id="invForm"></div>`;
  let pf = '';
  const filter = () => {
    const q = $('#pq').value.toLowerCase();
    v.querySelectorAll('[data-row]').forEach((tr) => { tr.hidden = (q && !tr.dataset.q.includes(q)) || (pf && !tr.dataset.s.split(' ').includes(pf)); });
  };
  { let open = null; try { open = sessionStorage.getItem('lr-admin-open-partner'); sessionStorage.removeItem('lr-admin-open-partner'); } catch { /* ignore */ }
    if (open) setTimeout(() => { details(open); $('#invForm')?.scrollIntoView({ block: 'start' }); }, 0); }
  $('#pq').oninput = filter;
  if ($('#ps')) $('#ps').onchange = () => { pf = $('#ps').value; filter(); };
  v.querySelectorAll('[data-pf]').forEach((b) => b.onclick = () => { pf = b.dataset.pf; v.querySelectorAll('[data-pf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); filter(); });
  // Multi-select: delete QA and test accounts in bulk (confirm by typing DELETE).
  const sel = () => [...v.querySelectorAll('[data-sel]:checked')];
  const syncSel = () => { const n = sel().length; $('#pcBatch').hidden = !n; $('#pcN').textContent = `${n} selected`; v.querySelectorAll('.pc').forEach((c) => c.classList.toggle('on', Boolean(c.querySelector('[data-sel]:checked')))); };
  v.querySelectorAll('[data-sel]').forEach((c) => c.onchange = syncSel);
  $('#pcAll').onclick = () => { v.querySelectorAll('.pc:not([hidden]) [data-sel]').forEach((c) => { c.checked = true; }); syncSel(); };
  $('#pcDel').onclick = async () => {
    const xs = sel(); if (!xs.length) return;
    const t = prompt(`Permanently delete ${xs.length} business account(s) (including owner access)? Running subscriptions must be canceled first; invoices stay archived.\n\nType DELETE to confirm:`);
    if ((t || '').trim().toUpperCase() !== 'DELETE') return;
    let ok = 0; const err = [];
    for (const c of xs) {
      const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'delete', id: c.dataset.sel, confirm: DEL_TOKEN }) });
      if (r.ok) ok++; else err.push(`${c.dataset.mail}: ${r.data?.error || 'Error'}`);
    }
    msg(`${ok} deleted.${err.length ? ' Not deleted: ' + err.join(' · ') : ''}`, err.length > 0);
    partner(v);
  };
  $('#pCsv').onclick = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const head = ['Customer number', 'Company', 'Entity type', 'Type', 'License / NMLS', 'EIN', 'Contact', 'Email', 'ZIP', 'City', 'Plan', 'Source', 'Status', 'Verified', 'Requests', 'Created'];
    const rows = list.map((a) => [a.customer_number, a.company_name, a.legal_form, a.institution_type, a.register_number, a.tax_id, a.advisor_name, a.email, a.postal_code, a.city, a.tier || '', a.plan_source || '', a.status, a.verified_at ? 'yes' : 'no', a.leads, a.created_at.slice(0, 10)]);
    const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = 'LeaseRun_Businesses.csv'; document.body.append(el); el.click(); el.remove();
  };
  v.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id, a = b.dataset.a;
    let body = { action: a, id };
    if (a === 'invoice') return invoiceForm(id, b.dataset.name);
    if (a === 'details') return details(id);
    if (a === 'karten') return cardsDialog(id, b.dataset.name);
    if (a === 'branche') return brancheDialog(id, b.dataset.br, (b.dataset.ex || '').split(',').filter(Boolean), () => partner(v));
    if (a === 'modules') return modulesDialog(id, b.dataset.name, JSON.parse(b.dataset.mod || '{}'), () => partner(v));
    if (a === 'verify' || a === 'whitelabel') body.on = b.dataset.on === 'true';
    if (a === 'lock') { const reason = prompt('Reason for the suspension (shown to the business):'); if (!reason) return; body.reason = reason; }
    if (a === 'unlock' && !confirm('Unsuspend this account?')) return;
    if (a === 'invoicePayment') {
      body.on = b.dataset.on === 'true';
      if (body.on) { const lim = prompt('Credit limit in USD (empty = no limit):', ''); const days = prompt('Payment terms in days (e.g. Net 30):', '30'); if (days === null) return; body.limitCents = lim ? Math.round(parseMoney(lim) * 100) : null; body.termsDays = Number(days) || 30; }
    }
    if (a === 'credits') { const n = prompt('Additional Lender Packages per month (negative to subtract):', '10'); if (!n) return; body.add = Math.trunc(Number(n)); }
    if (a === 'delete') {
      const t = prompt(`Permanently delete "${b.dataset.name}"?\n\nCases, clients, requests, advisor assignments and API keys will be removed. Owner access is deleted too (except for administrators). Invoices stay archived.\n\nType DELETE to confirm:`);
      if ((t || '').trim().toUpperCase() !== 'DELETE') return;
      const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'delete', id, confirm: DEL_TOKEN }) });
      if (r.ok) { msg('Business deleted.'); partner(v); } else msg(r.data?.error || 'Deleting failed.', true);
      return;
    }
    if (a === 'plan') return b2bAccessDialog(id, b.closest('.pc')?.querySelector('.pc-h strong')?.textContent || 'Business', () => partner(v));
    const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify(body) });
    if (r.ok) { msg('Saved.'); partner(v); } else msg(r.data?.error || 'Error', true);
  });
  $('#mkNew')?.addEventListener('click', () => openCreateAccount(null, () => partner(v)));
  $('#mkCat')?.addEventListener('click', () => import('./intern-b2bcat.mjs?v=892f3666').then((m) => m.catalogEditor()));
  $('#mkPriv')?.addEventListener('click', () => openCreatePrivate());
}

// Read-only detail view of a business (no signing in as the partner).
// Module rights per business account: per plan, additionally unlocked or blocked. Takes effect immediately in the portal and the APIs.
const MODS = [['schnellrechner', 'Quick calculators & case analyses', 'Quick checks of document packages, presentations'], ['kreditmappe', 'Lender Package', 'Lender Packages without a monthly quota when unlocked'], ['stresstest', 'Stress test generator', 'Rate, vacancy and cost scenarios'], ['whitelabel', 'White-label export', 'Documents and invitations in your own branding'], ['crm', 'CRM & client management', 'Invite clients, progress and existing-client radar']];
// B2B "Grant access": assign a plan manually and optionally unlock all modules – in one step, no prompts.
async function b2bAccessDialog(id, name, done) {
  let d = document.getElementById('b2bAccDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'b2bAccDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<div class="wa-dlg-in">${skel()}</div>`;
  d.showModal ? d.showModal() : d.setAttribute('open', '');
  const r = await api('/api/admin/b2b?id=' + encodeURIComponent(id));
  if (!r.ok) { d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>Grant access</h2><button type="button" class="stage-x" data-x aria-label="Close">×</button></div><p class="auth-message error">${esc(r.data?.error || 'Account not found.')}</p></div>`; d.querySelector('[data-x]').onclick = () => d.close(); return; }
  const a = r.data.account, cur = a.tier || a.plan_tier || '', stripeSub = a.plan_source === 'stripe' && a.stripe_subscription_id && a.plan_tier;
  const mods = a.modules || {}, allOn = MODS.every(([k]) => mods[k] === 'on');
  const until = a.plan_until ? String(a.plan_until).slice(0, 10) : '';
  const opt = (v, t, x) => `<label><input type="radio" name="tier" value="${v}"${cur === v || (!cur && v === 'ENTERPRISE') ? ' checked' : ''}><span><b>${t}</b><small>${x}</small></span></label>`;
  d.innerHTML = `<form class="wa-dlg-in acc-b2b" id="b2bAccF"><div class="wa-dlg-h"><h2>Grant access</h2><button type="button" class="stage-x" data-x aria-label="Close">×</button></div>
    <p class="form-note"><strong>${esc(name)}</strong> · current: <b>${cur ? esc(TIER[cur] || cur) : 'no plan'}</b>${a.plan_source === 'manual' ? ' (manual)' : stripeSub ? ' (Stripe subscription)' : ''}${a.verified_at ? '' : ' · <span class="st warn">not verified yet</span>'}${a.status === 'locked' ? ' · <span class="st bad">suspended</span>' : ''}</p>
    ${stripeSub ? '<p class="auth-message">This account has a running Stripe subscription. Change the plan there; you can still unlock modules here.</p>' : `<fieldset class="acc-tiers"><legend class="form-note">Plan</legend>
      ${opt('ENTERPRISE', 'Unlock everything (Enterprise)', 'All tools, team, white label, API – the highest tier')}${opt('PRO', 'Pro', 'Unlimited packages and presentations, partner page, audit log')}${opt('BASIC', 'Basic', '1 seat, 20 Lender Packages per month')}${cur ? opt('', 'Remove manual plan', 'Only a paid plan applies then') : ''}</fieldset>
      <label>Valid until (empty = no end date)<input type="date" name="until" value="${esc(until)}"></label>`}
    <label class="chk"><input type="checkbox" name="allmods"${allOn || !Object.keys(mods).length ? ' checked' : ''}> Unlock all modules (quick calculators, Lender Package without quota, stress test, white label, CRM)</label>
    ${!a.verified_at ? '<label class="chk"><input type="checkbox" name="verify" checked> Also approve the business as verified (otherwise the plan has no effect)</label>' : ''}
    ${a.status === 'locked' ? '<label class="chk"><input type="checkbox" name="unlock" checked> Lift suspension</label>' : ''}
    <p class="form-note">Takes effect immediately – the business sees the change after the next portal reload. Every change is logged.</p>
    <p class="form-note" id="b2bAccMsg" role="status" aria-live="polite"></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Cancel</button><button type="submit" class="btn btn-dark">Grant access</button></div></form>`;
  d.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => d.close(); });
  const f = d.querySelector('#b2bAccF');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f), out = d.querySelector('#b2bAccMsg'), btn = f.querySelector('[type=submit]');
    const say = (t, bad) => { out.textContent = t; out.className = 'form-note ' + (bad ? 'err' : 'ok'); };
    f.classList.add('acc-busy'); btn.disabled = true; say('Saving …');
    const post = (body) => api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ id, ...body }) });
    const errs = [];
    if (fd.get('verify') === 'on') { const x = await post({ action: 'approve' }); if (!x.ok) errs.push(x.data?.error || 'Verification failed'); }
    if (fd.get('unlock') === 'on') { const x = await post({ action: 'unlock' }); if (!x.ok) errs.push(x.data?.error || 'Unsuspending failed'); }
    if (!stripeSub && fd.has('tier')) { const t = String(fd.get('tier') || ''); const x = await post({ action: 'plan', tier: t || null, until: t ? (String(fd.get('until') || '') || null) : null }); if (!x.ok) errs.push(x.data?.error || 'Plan not saved'); }
    const want = fd.get('allmods') === 'on';
    if (want || allOn) { const x = await post({ action: 'modules', modules: Object.fromEntries(MODS.map(([k]) => [k, want ? 'on' : 'auto'])) }); if (!x.ok) errs.push(x.data?.error || 'Modules not saved'); }
    f.classList.remove('acc-busy'); btn.disabled = false;
    if (errs.length) { say(errs.join(' · '), true); return; }
    say('Access granted.');
    msg(`Access for ${name} saved.`);
    setTimeout(() => { d.close(); done?.(); }, 700);
  };
}

function modulesDialog(id, name, cur, done) {
  let d = document.getElementById('modDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'modDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const opt = (k, val, label) => `<label class="mod-opt"><input type="radio" name="m-${k}" value="${val}"${(cur[k] || 'auto') === val ? ' checked' : ''}><span>${label}</span></label>`;
  d.innerHTML = `<form class="wa-dlg-in" id="modF"><div class="wa-dlg-h"><h2>Unlock modules</h2><button type="button" class="stage-x" data-x aria-label="Close">×</button></div>
    <p class="form-note"><strong>${esc(name)}</strong> · "Per plan" follows the booked plan. "On" unlocks regardless of plan, "Blocked" blocks the module.</p>
    <div class="mod-list">${MODS.map(([k, t, x]) => `<fieldset class="mod-row"><legend><strong>${t}</strong><small>${x}</small></legend><div class="mod-seg">${opt(k, 'auto', 'Per plan')}${opt(k, 'on', 'On')}${opt(k, 'off', 'Blocked')}</div></fieldset>`).join('')}</div>
    <p class="form-note" id="modMsg" role="status"></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Cancel</button><button type="button" class="btn btn-outline" id="modAll">All on</button><button type="submit" class="btn btn-dark">Save</button></div></form>`;
  d.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => d.close(); });
  d.querySelector('#modAll').onclick = () => { d.querySelectorAll('input[value="on"]').forEach((i) => { i.checked = true; }); d.querySelector('#modMsg').textContent = 'All modules set to "On" – now save.'; };
  d.querySelector('#modF').onsubmit = async (e) => {
    e.preventDefault();
    const modules = Object.fromEntries(MODS.map(([k]) => [k, d.querySelector(`input[name="m-${k}"]:checked`)?.value || 'auto']));
    const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'modules', id, modules }) });
    if (!r.ok) { d.querySelector('#modMsg').textContent = r.data?.error || 'Saving failed.'; return; }
    d.close(); msg('Modules saved.'); done?.();
  };
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}

// Company cards (Stripe Issuing) per business account: view, issue, change the monthly limit.
async function cardsDialog(id, name) {
  let d = document.getElementById('cardDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'cardDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const e2 = (c) => (c == null ? '–' : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
  d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>Company cards · ${esc(name)}</h2><button type="button" class="stage-x" data-x aria-label="Close">×</button></div><div id="cdBody">${skel()}</div></div>`;
  d.querySelector('[data-x]').onclick = () => d.close();
  d.showModal ? d.showModal() : d.setAttribute('open', '');
  const r = await api(`/api/admin/karten?account=${encodeURIComponent(id)}`);
  const box = d.querySelector('#cdBody');
  if (!r.ok) { box.innerHTML = emptyState('Not available', esc(r.data?.error || '')); return; }
  const x = r.data, live = ['LIVE', 'SANDBOX'].includes(x.program);
  const stat = live ? `<span class="st ${x.program === 'LIVE' ? 'ok' : 'warn'}">${x.program === 'LIVE' ? 'Live' : 'Test mode (Stripe test mode)'}</span>` : '<span class="st">Not set up</span>';
  box.innerHTML = `<p class="form-note">Card partner: <strong>${x.provider === 'stripe' ? 'Stripe Issuing' : 'none'}</strong> · ${stat}. Company cards for business expenses only; every payment is checked against the monthly limit first.</p>
    ${x.tablesReady === false ? '<p class="auth-message">The card tables are not set up in the database yet (docs/sql/2026-10-18_cards.sql).</p>' : ''}
    ${(x.cards || []).length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Card</th><th>Status</th><th>Limit</th><th>Used</th><th></th></tr></thead><tbody>${x.cards.map((c) => { const l = (c.lr_card_limits && (c.lr_card_limits[0] || c.lr_card_limits)) || {}; const used = (l.settled_cents || 0) + (l.reserved_cents || 0) - (l.refunded_cents || 0); return `<tr><td>•••• ${esc(c.last4 || '––––')}</td><td>${esc(c.status)}</td><td>${e2(l.monthly_limit_cents)}</td><td>${e2(Math.max(0, used))}</td><td><button type="button" class="btn btn-outline btn-sm" data-lim="${c.id}">Change limit</button></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No company cards yet', 'Issue the first card for a member of this business below.')}
    <form id="cdForm" class="mod-list" style="margin-top:14px"${live ? '' : ' hidden'}><h3 style="margin:0">New company card</h3>
      <label>Member's email<input name="memberEmail" type="email" required></label>
      <label>Name on card (max. 24 characters)<input name="holderName" maxlength="24" required></label>
      <label>Street address (billing address)<input name="line1" required></label>
      <div class="pt-row"><label>ZIP code<input name="postalCode" inputmode="numeric" pattern="[0-9]{5}" required></label><label>City<input name="city" required></label></div>
      <label>Monthly limit in USD<input name="limit" inputmode="decimal" required placeholder="e.g. 1,000"></label>
      <label>Business's Stripe account (optional, acct_…)<input name="stripeAccount" pattern="acct_[A-Za-z0-9]+"></label>
      <p class="form-note" id="cdMsg" role="status"></p><button class="btn btn-dark" type="submit">Issue card</button></form>
    ${live ? '' : '<p class="form-note">To issue cards, set in Vercel: CARD_PROVIDER=stripe, CARD_PROGRAM_STATUS=SANDBOX (test mode) or LIVE with CARD_COMPLIANCE_APPROVED=true, STRIPE_ISSUING_WEBHOOK_SECRET; Stripe Issuing must be enabled for the account.</p>'}`;
  box.querySelectorAll('[data-lim]').forEach((b) => b.onclick = async () => {
    const v = prompt('New monthly limit in USD:'); if (v == null) return;
    const c = Math.round(parseMoney(v) * 100); if (!Number.isFinite(c) || c < 0) return;
    const rr = await api('/api/admin/karten', { method: 'POST', body: JSON.stringify({ action: 'limit', account: id, cardId: b.dataset.lim, limitCents: c }) });
    if (rr.ok) cardsDialog(id, name); else alert(rr.data?.error || 'Error');
  });
  const f = box.querySelector('#cdForm');
  if (f) f.onsubmit = async (ev) => {
    ev.preventDefault(); if (!f.checkValidity()) { f.reportValidity(); return; }
    const fd = Object.fromEntries(new FormData(f));
    const lc = Math.round(parseMoney(fd.limit) * 100);
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    const rr = await api('/api/admin/karten', { method: 'POST', body: JSON.stringify({ action: 'issue', account: id, memberEmail: fd.memberEmail, holderName: fd.holderName, line1: fd.line1, postalCode: fd.postalCode, city: fd.city, limitCents: lc, stripeAccount: fd.stripeAccount || '' }) });
    btn.disabled = false;
    if (rr.ok) cardsDialog(id, name); else f.querySelector('#cdMsg').textContent = rr.data?.error || "The card couldn't be issued.";
  };
}

async function details(id) {
  const box = $('#invForm');
  box.innerHTML = logoLoader();
  const r = await api('/api/admin/b2b?id=' + id);
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const { account: a, members, leads, invoices, verificationDocs: vd = [] } = r.data;
  const rows = [['Customer number', a.customer_number], ['Business', `${a.company_name} (${a.legal_form})`], ['Type', a.institution_type], ['License / NMLS', a.register_number || '–'], ['EIN', a.tax_id || '–'],
    ['Contact', a.advisor_name], ['Email', a.email], ['Phone', a.phone || '–'], ['Address', `${a.street || ''}, ${a.city} ${a.postal_code}`], ['Partner page', a.slug ? `/p/${a.slug}` : '–'],
    ['Plan', `${a.tier ? TIER[a.tier] : '–'}${a.plan_source ? ` (${a.plan_source === 'manual' ? 'manual' : 'Stripe'})` : ''}`], ['Lender Packages this month', String(a.dossiersThisMonth)],
    ['Business use confirmed', dtt(a.unternehmer_confirmed_at)], ['DPA', `${a.avv_version || '–'} on ${dtt(a.avv_accepted_at)}`], ['Source', a.referral || '–'], ['Allowed domains', (a.allowed_domains || []).join(', ') || 'all'], ['Created', dtt(a.created_at)]];
  box.innerHTML = `<section class="pt-card" style="margin-top:16px"><h2>${esc(a.company_name)}</h2>
    <dl class="pt-dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3>Verification</h3>
    <p>Status: <strong>${{ offen: 'no documents submitted yet', eingereicht: 'submitted for review', geprueft: 'verified and approved', abgelehnt: 'rejected' }[a.verification_status] || (a.verified_at ? 'verified' : 'pending')}</strong>${a.verification_submitted_at ? ` · submitted ${dtt(a.verification_submitted_at)}` : ''}${a.verification_note ? `<br><small>Reason: ${esc(a.verification_note)}</small>` : ''}</p>
    ${vd.length ? `<ul class="plain-list">${vd.map((d) => `<li>${d.url ? `<a class="ck-link" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc({ gewerbe: 'Business registration / license', handelsregister: 'Secretary of State filing', erlaubnis: 'Real estate / NMLS license', sonstiges: 'Other proof' }[d.kind] || d.kind)}: ${esc(d.file_name)}</a>` : esc(d.file_name)} <small>(${Math.max(1, Math.round(d.byte_size / 1024))} KB · ${dtt(d.created_at)} · SHA ${esc(d.sha256.slice(0, 10))}…)</small></li>`).join('')}</ul><p class="form-note">Links are valid for 5 minutes (each access is logged). Check: company name, address and license number / EIN match the details; for agents and mortgage brokers also the state license / NMLS record.</p>` : '<p class="form-note">No proof uploaded yet.</p>'}
    ${a.verified_at ? '' : `<p><button class="btn btn-dark" id="vApprove" type="button"${vd.length ? '' : ' disabled'}>Approve</button> <button class="btn btn-outline" id="vReject" type="button">Reject with reason</button></p>`}
    <h3>Team</h3><p>${members.map((m) => `${esc(m.email)} (${m.role === 'owner' ? 'Owner' : 'Advisor'})`).join(' · ') || '–'}</p>
    <h3>Requests (count and status only – the content belongs to the business)</h3><p>${leads.length} total · ${[['neu', 'new'], ['in_bearbeitung', 'in progress'], ['abgeschlossen', 'closed'], ['abgelehnt', 'declined']].map(([s, l]) => `${l}: ${leads.filter((x) => x.status === s).length}`).join(' · ')}</p>
    <h3>Invoices</h3>${invoices.length ? `<div class="wa-wrap"><table class="wa-table"><tbody>${invoices.map((i) => `<tr><td>${esc(i.invoice_number)}</td><td>${dt(i.issue_date)}</td><td>${eur(i.gross_cents)}</td><td>${PAY[i.payment_status]}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">None.</p>'}
    <h3>Support view</h3><p class="form-note">${a.support_access_until && new Date(a.support_access_until) > new Date() ? `Granted by the business until ${dtt(a.support_access_until)}.` : 'Not granted. The business can grant read-only support access in the portal under Profile.'}</p>
    ${a.support_access_until && new Date(a.support_access_until) > new Date() ? '<button class="btn btn-ghost" id="supView" type="button">View portal read-only (logged)</button><div id="supOut"></div>' : ''}
    <button class="text-btn" id="detClose" type="button">Close</button></section>`;
  if ($('#supView')) $('#supView').onclick = async () => {
    const s = await api('/api/admin/support?id=' + id);
    if (!s.ok) { $('#supOut').innerHTML = `<p class="form-note">${esc(s.data?.error)}</p>`; return; }
    const d = s.data;
    $('#supOut').innerHTML = `<p class="form-note">Plan ${d.account.tier ? TIER[d.account.tier] : '–'} · widget ${d.account.widgetActive ? 'active' : 'off'} · domains: ${esc((d.account.allowedDomains || []).join(', ') || 'all')}</p>
      <div class="wa-wrap"><table class="wa-table"><thead><tr><th>Received</th><th>Source</th><th>Status</th><th>Contact</th><th>Property</th></tr></thead><tbody>${d.leads.map((l) => `<tr><td>${dtt(l.created_at)}</td><td>${esc(l.source)}</td><td>${esc(l.status)}</td><td>${esc(l.client_name)}<br><small>${esc(l.client_email)}</small></td><td>${esc(l.property_data?.address || l.property_data?.ref || '–')}</td></tr>`).join('') || '<tr><td colspan="5">No requests.</td></tr>'}</tbody></table></div>`;
  };
  if ($('#vApprove')) $('#vApprove').onclick = async () => {
    if (!confirm(`Approve ${a.company_name}? The business will get an email.`)) return;
    const x = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'approve', id }) });
    if (x.ok) { await partner($('#adView')); msg('Approved.'); details(id); } else msg(x.data?.error || 'Error', true);
  };
  if ($('#vReject')) $('#vReject').onclick = async () => {
    const reason = prompt('Reason (sent to the business by email), e.g. "License copy is unreadable":');
    if (!reason || reason.trim().length < 5) return;
    const x = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'reject', id, reason: reason.trim() }) });
    if (x.ok) { await partner($('#adView')); msg('Rejected, business notified.'); details(id); } else msg(x.data?.error || 'Error', true);
  };
  $('#detClose').onclick = () => { box.innerHTML = ''; };
  box.scrollIntoView({ behavior: 'smooth' });
}

function invoiceForm(accountId, name) {
  const box = $('#invForm');
  const row = () => '<div class="row"><input placeholder="Service" class="d"><input placeholder="Qty" class="q" value="1" inputmode="decimal"><input placeholder="Unit price (USD)" class="p" inputmode="decimal"><button type="button" class="text-btn del x" aria-label="Remove line">×</button></div>';
  box.innerHTML = `<section class="pt-card" style="margin-top:16px"><h2>Invoice to ${esc(name)}</h2>
    <div class="wa-items" id="items">${row()}</div><button class="text-btn" id="addRow" type="button">+ Line item</button>
    <div class="pt-row wa-form" style="margin-top:10px"><label class="form-note">Payment method <select id="pm"><option value="INVOICE_BANK_TRANSFER">Bank transfer (ACH / wire)</option><option value="SEPA_B2B">ACH debit (business)</option><option value="STRIPE_CARD">Card (already paid)</option></select></label>
    <label class="form-note">Service period <input id="sp" placeholder="e.g. 10/01/2026–10/31/2026"></label><label class="form-note"><input type="checkbox" id="paid"> already paid</label></div>
    <p id="sum" class="form-note"></p><button class="btn btn-dark" id="issue" type="button">Issue invoice (final)</button></section>`;
  const items = () => [...box.querySelectorAll('.row')].map((r) => ({ description: r.querySelector('.d').value.trim(), quantity: Number(r.querySelector('.q').value.replace(/,/g, '')), unitNetCents: Math.round(parseMoney(r.querySelector('.p').value) * 100) })).filter((i) => i.description && i.quantity > 0 && i.unitNetCents >= 0);
  const sum = () => { const n = items().reduce((s, i) => s + Math.round(i.quantity * i.unitNetCents), 0); $('#sum').textContent = `Subtotal ${eur(n)} · sales tax is added only if configured for this invoice`; };
  box.oninput = sum;
  box.onclick = (e) => { if (e.target.classList.contains('x') && box.querySelectorAll('.row').length > 1) { e.target.parentElement.remove(); sum(); } };
  $('#addRow').onclick = () => { $('#items').insertAdjacentHTML('beforeend', row()); };
  $('#issue').onclick = async () => {
    const it = items();
    if (!it.length) return msg('Please add at least one line item with a price.', true);
    if (!confirm('Issue the invoice now? It gets the next sequential number and can only be voided afterward.')) return;
    const r = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'create', accountId, items: it, paymentMethod: $('#pm').value, servicePeriod: $('#sp').value || undefined, paid: $('#paid').checked }) });
    if (!r.ok) return msg(r.data?.error || 'Error', true);
    msg(`Invoice ${r.data.invoice.invoice_number} issued and archived.${r.data.mailed ? ' PDF emailed to the business.' : ' (Email delivery not set up: please send the PDF yourself; it is available in the portal.)'}`);
    box.innerHTML = '';
  };
  box.scrollIntoView({ behavior: 'smooth' });
}

// ---------- Invoice archive ----------
async function rechnungen(v, q = '') {
  const r = await api('/api/admin/invoices' + (q ? '?q=' + encodeURIComponent(q) : ''));
  if (!r.ok) { errState(v, r.data?.error); return; }
  v.innerHTML = `<p class="form-note">Invoice archive: invoices are locked against changes and deletion in the database; every PDF is checked against its SHA-256 checksum when downloaded. Corrections only via void.${r.data.bankConfigured ? '' : ' <strong>Bank details missing:</strong> set the bank details for invoices in Vercel (INVOICE_IBAN / INVOICE_BIC / INVOICE_BANK_NAME – account and routing number for ACH), otherwise bank-transfer invoices are blocked.'}</p>
    <div class="pt-row" style="margin-bottom:10px"><input id="iq" aria-label="Search invoice number" value="${esc(q)}" placeholder="Invoice number" style="border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px"><button class="btn btn-ghost" id="is" type="button">Search</button><button class="btn btn-outline" id="iv" type="button">Verify all checksums</button></div><p class="form-note" id="ivMsg" role="status"></p>${invTable(r.data.invoices)}
    <p class="form-note">New invoice: under "Partners", click "Write invoice" for the business.</p>`;
  $('#is').onclick = () => rechnungen(v, $('#iq').value.trim());
  $('#iv').onclick = async (e) => {
    e.target.disabled = true; $('#ivMsg').textContent = 'Checking all invoice PDFs …';
    const x = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'verify' }) });
    e.target.disabled = false;
    if (!x.ok) { $('#ivMsg').textContent = x.data?.error || 'Check failed.'; return; }
    $('#ivMsg').innerHTML = x.data.bad.length ? `<strong style="color:#B91C1C">${x.data.bad.length} invoice(s) don't match their checksum and are considered invalid: ${x.data.bad.map(esc).join(', ')}.</strong> A security alert was triggered.` : `✓ ${x.data.ok} invoice(s) unchanged.${x.data.missing.length ? ` ${x.data.missing.length} file(s) not found: ${x.data.missing.map(esc).join(', ')}.` : ''}`;
  };
  bindInv(v, () => rechnungen(v, q));
}

// ---------- CPA export (invoices as ZIP with a CSV journal) ----------
function steuer(v) {
  const seg = getSeg();
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const m = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const q = Math.floor(prev.getMonth() / 3) + 1;
  v.innerHTML = `<section class="pt-card"><h2>${seg === 'b2b' ? 'Business invoices' : 'Consumer invoices'} for your CPA (ZIP)</h2>${seg === 'b2c' ? '<p class="pt-alert">Consumer purchases (Lender Package, Buyer Pass, Investor Pro) are billed through Stripe; export their receipts in Stripe under Reports. Only manually issued consumer invoices appear here.</p>' : ''}
    <p>All invoices of a period as a ZIP to download and hand over. Each file starts with the invoice date – <code>2026-10-14_LR-2026-0042_Customer.pdf</code> – so your CPA can match it right away. Voids and credit memos are in the <code>Corrections</code> folder.</p>
    <div class="pt-row wa-form"><label class="form-note">Period <select id="per"><option value="m">Month</option><option value="q">Quarter</option><option value="y">Year</option></select></label>
      <label class="form-note" id="perM">Month <input type="month" id="mon" value="${m}"></label>
      <label class="form-note" id="perQ" hidden>Quarter <select id="qq">${[1, 2, 3, 4].map((x) => `<option value="${x}"${x === q ? ' selected' : ''}>Q${x}</option>`).join('')}</select> <input type="number" id="qy" value="${prev.getFullYear()}" min="2024" max="2100" style="width:90px" aria-label="Year"></label>
      <label class="form-note" id="perY" hidden>Year <input type="number" id="yy" value="${prev.getFullYear()}" min="2024" max="2100" style="width:90px"></label>
      <label class="chk form-note"><input type="checkbox" id="dv" checked> include CSV journal (invoices.csv)</label>
      <button class="btn btn-dark" id="zip" type="button">Download ZIP</button></div>
    <details class="wa-help"><summary>What's in the CSV?</summary><p>One row per invoice: number, type, date, customer, subtotal, sales tax, total, payment status and source – comma-separated, amounts in USD with a decimal point. It imports into QuickBooks, Xero or Excel. Ask your CPA which chart of accounts they use; LeaseRun does not prepare tax returns.</p></details>
    <p class="form-note">Download only. Nothing is sent to anyone automatically.</p></section>`;
  const per = $('#per');
  const sync = () => { $('#perM').hidden = per.value !== 'm'; $('#perQ').hidden = per.value !== 'q'; $('#perY').hidden = per.value !== 'y'; };
  per.onchange = sync;
  $('#zip').onclick = async (e) => {
    const p = per.value === 'm' ? $('#mon').value : per.value === 'q' ? `${$('#qy').value}-Q${$('#qq').value}` : $('#yy').value;
    e.target.disabled = true;
    const r = await api(`/api/admin/datev?monat=${encodeURIComponent(p)}&datev=${$('#dv').checked ? 1 : 0}`);
    if (r.ok) { location.href = r.data.url; msg(`ZIP with ${r.data.count} invoices created.${r.data.problems.length ? ' Notes: ' + r.data.problems.join(' · ') : ''}`, r.data.problems.length > 0); } else msg(r.data?.error || 'Error', true);
    e.target.disabled = false;
  };
}

// ---------- Requests & codes ----------
async function anfragen(v) {
  const r = await api('/api/admin/misc');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const { contacts, codes } = r.data;
  v.innerHTML = `<section class="pt-card"><h2>Business requests</h2><p class="form-note">Review account requests and create access with "Create account" – company details are carried over.</p>${contacts.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Received</th><th>Topic</th><th>Contact</th><th>Message</th><th></th></tr></thead><tbody>
    ${contacts.map((c) => `<tr><td>${dtt(c.created_at)}</td><td>${({ konto: '<span class="st warn">Account request</span>', demo: 'Demo', enterprise: 'Enterprise', kooperation: 'Partnership' })[c.kind] || esc(c.kind)}${c.city ? `<br><small>${esc(c.city)}</small>` : ''}</td><td><strong>${esc(c.company)}</strong><br>${esc(c.name)}<br><a href="mailto:${esc(c.email)}">${esc(c.email)}</a> ${esc(c.phone || '')}</td><td>${esc(c.message || '')}${c.register_number || c.tax_id ? `<br><small>${esc([c.legal_form, c.register_number, c.tax_id].filter(Boolean).join(' · '))}</small>` : ''}${c.proof_name ? `<br><button class="text-btn" data-proof="${c.id}" type="button"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg> Proof: ${esc(c.proof_name)}</button>` : ''}</td><td>${c.kind === 'konto' && !c.account_id ? `<button class="btn btn-dark btn-sm" data-mk="${c.id}" type="button">Create account</button> ` : c.account_id ? '<span class="st ok">Account created</span> ' : ''}${c.status === 'offen' ? `<button class="text-btn" data-done="${c.id}" type="button">Done</button>` : 'done'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">No requests.</p>'}</section>
    <section class="pt-card"><h2>Partner codes</h2><p class="form-note">Campaign codes for business sign-ups. The code is stored on the account; discounts are handled by Stripe promotion codes at checkout.</p>
    <div class="pt-row wa-form"><input id="cc" aria-label="Code" placeholder="CODE-2026" style="text-transform:uppercase"><input id="cd" aria-label="Description" placeholder="Description"><input id="cm" aria-label="Maximum redemptions" placeholder="max. redemptions" inputmode="numeric" style="width:150px"><button class="btn btn-dark" id="cAdd" type="button">Create</button></div>
    ${codes.length ? `<div class="wa-wrap"><table class="wa-table" style="margin-top:10px"><thead><tr><th>Code</th><th>Description</th><th>Redeemed</th><th>Rate</th><th></th></tr></thead><tbody>${codes.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.description || '')}</td><td>${c.redeemed}${c.max_redemptions ? ' / ' + c.max_redemptions : ''}</td><td>${c.max_redemptions ? Math.round((c.redeemed / c.max_redemptions) * 100) + '%' : '–'}</td><td><button class="text-btn" data-code="${esc(c.code)}" data-on="${!c.active}" type="button">${c.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')}</tbody></table></div>` : ''}</section>`;
  v.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => { await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'contactDone', id: b.dataset.done }) }); anfragen(v); });
  v.querySelectorAll('[data-proof]').forEach((b) => b.onclick = () => openProof(b.dataset.proof));
  v.querySelectorAll('[data-mk]').forEach((b) => b.onclick = () => { const c = contacts.find((x) => x.id === b.dataset.mk); openCreateAccount(c, () => anfragen(v)); });
  v.querySelectorAll('[data-code]').forEach((b) => b.onclick = async () => { await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'codeActive', code: b.dataset.code, on: b.dataset.on === 'true' }) }); anfragen(v); });
  $('#cAdd').onclick = async () => {
    const r2 = await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'codeCreate', code: $('#cc').value, description: $('#cd').value, maxRedemptions: $('#cm').value ? Number($('#cm').value) : null }) });
    if (r2.ok) anfragen(v); else msg(r2.data?.error || 'Error', true);
  };
}

// Readable audit log: Time | Actor | Event | Target | Details – instead of raw keys and IDs.
const AUD = {
  b2b_verify: 'Approval changed', b2b_approve: 'Business approved', b2b_reject: 'Review rejected', b2b_lock: 'Business suspended', b2b_unlock: 'Business unsuspended',
  b2b_whitelabel: 'White label changed', b2b_invoicePayment: 'Pay by invoice changed', b2b_credits: 'Quota adjusted', b2b_plan: 'Plan assigned', b2b_request_proof_view: 'Proof viewed',
  user_create: 'Account created', user_delete: 'Account deleted', user_ban: 'Account suspended', user_unban: 'Account unsuspended', user_lookup: 'Account looked up', users_list: 'Account list opened',
  user_reset_password: 'Password reset sent', user_resend_confirmation: 'Confirmation resent',
  invoice_create: 'Invoice created', invoice_paid: 'Invoice marked as paid', invoice_remind: 'Payment reminder sent', invoice_storno: 'Invoice voided', invoice_verify: 'Invoice verified (SHA-256)',
  datev_export: 'CPA export (ZIP)', panic_on: 'Emergency stop triggered', panic_off: 'Emergency stop ended', sec_block: 'Source blocked', sec_unblock: 'Source unblocked', sec_ack: 'Incidents marked done', security_overview: 'Security status opened',
  support_view: 'Support view', setup_mark: 'Setup item checked off', setup_livecheck: 'Live check', testkauf_start: 'Test purchase started', testkauf_selftest: 'Test transaction',
  testmail: 'Test email sent', testmail_all: 'All email templates tested', testmail_auth: 'Test account email', audit_reveal: 'Plain text shown in audit log',
  campaign_create: 'Campaign created', newsletter_send: 'Newsletter sent', newsletter_unsub: 'Newsletter unsubscribed', crm_create: 'Outreach contact created', crm_delete: 'Outreach contact deleted', crm_import: 'Outreach import', crm_letters: 'Outreach letters created',
};
const AUD_CAT = (a) => /^panic|^sec_|security/.test(a) ? 'sec' : /^invoice|datev/.test(a) ? 'fin' : /^b2b_/.test(a) ? 'b2b' : /^user|users_list/.test(a) ? 'user' : 'sys';
// Audit log grouped by day and collapsed – the page stays short, everything stays reachable.
function audDays(rows, li) {
  const day = (t) => fmtDate(t, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  const today = day(Date.now()), groups = new Map();
  for (const a of rows) { const k = day(a.created_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  // Logs are always collapsed (owner's wish): only day + count; the list opens on click.
  return [...groups].map(([k, list]) => `<details class="aud-day"><summary><strong>${k === today ? 'Today' : esc(k)}</strong><span>${list.length} entr${list.length === 1 ? 'y' : 'ies'}</span></summary><ol class="aud-list">${list.map(li).join('')}</ol></details>`).join('');
}

async function protokoll(v, reveal = false) {
  const [r, pr] = await Promise.all([api('/api/admin/misc' + (reveal ? '?reveal=1' : '')), api('/api/admin/b2b')]);
  if (!r.ok) { errState(v, r.data?.error); return; }
  const firms = new Map((pr.ok ? pr.data.accounts : []).map((a) => [a.id, a.company_name]));
  const who = (x) => { const t = String(x || ''); if (!t || t === 'system') return ['Sys', 'System']; if (/@/.test(t)) return ['Admin', t]; return ['Admin', 'Admin ' + t.replace(/^ps:/, '').slice(0, 6)]; };
  const target = (a) => { const t = String(a.target || ''); if (!t) return '–'; if (firms.has(t)) return `Business · ${esc(firms.get(t))}`; if (/@/.test(t)) return esc(t); if (/^[0-9a-f-]{36}$/.test(t)) return `${/^invoice/.test(a.action) ? 'Invoice' : /^user/.test(a.action) ? 'Account' : 'Record'} · ${t.slice(0, 8)}`; return esc(t.replace(/^ps:/, 'Person ').slice(0, 24)); };
  const det = (m) => { if (!m || typeof m !== 'object') return ''; return Object.entries(m).filter(([, x]) => x != null && x !== '' && !(Array.isArray(x) && !x.length)).slice(0, 6).map(([k, x]) => `<span class="aud-kv"><b>${esc(k)}</b> ${esc(typeof x === 'object' ? JSON.stringify(x) : String(x)).slice(0, 80)}</span>`).join(''); };
  const rows = r.data.audit;
  const cats = [['', 'All'], ['sec', 'Security'], ['b2b', 'Businesses'], ['user', 'Accounts'], ['fin', 'Finance'], ['sys', 'System']];
  v.innerHTML = `<section class="pt-card"><div class="aud-h"><h2>Audit log</h2>${r.data.pseudonymized ? '<button type="button" class="btn btn-outline btn-sm" id="pvReveal">Show plain text (logged)</button>' : '<strong class="st warn">Plain text – this view was logged</strong>'}</div>
    <p class="form-note">Personal identifiers are pseudonymized. Entries are deleted after 90 days – except invoice and contract records (retention requirement).</p>
    <div class="pc-chips" role="group" aria-label="Category">${cats.map(([k, l]) => `<button type="button" data-ac="${k}" aria-pressed="${k === '' ? 'true' : 'false'}">${l} <b>${k ? rows.filter((a) => AUD_CAT(a.action) === k).length : rows.length}</b></button>`).join('')}</div>
    ${rows.length ? audDays(rows, (a) => { const [kind, name] = who(a.actor_email); return `<li data-cat="${AUD_CAT(a.action)}" class="aud-${AUD_CAT(a.action)}"><time>${dtt(a.created_at)}</time><div class="aud-main"><strong>${esc(AUD[a.action] || a.action.replace(/_/g, ' '))}</strong><span class="aud-who"><i>${kind}</i>${esc(name)}</span>${target(a) !== '–' || det(a.meta) ? `<details class="aud-more"><summary>Details</summary>${target(a) !== '–' ? `<span class="aud-tgt">${target(a)}</span>` : ''}${det(a.meta) ? `<div class="aud-det">${det(a.meta)}</div>` : ''}</details>` : ''}</div></li>`; }) : '<p class="form-note">No entries yet.</p>'}</section>`;
  $('#pvReveal')?.addEventListener('click', () => protokoll(v, true));
  v.querySelectorAll('[data-ac]').forEach((b) => b.onclick = () => { v.querySelectorAll('[data-ac]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); v.querySelectorAll('.aud-list li').forEach((li) => { li.hidden = Boolean(b.dataset.ac) && li.dataset.cat !== b.dataset.ac; }); });
}

async function kennzahlen(v) {
  const r = await api('/api/admin/stats');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const j = r.data;
  const n = (x) => (x == null ? '–' : num(x));
  const tile = (l, x) => `<div class="an-chip"><small>${l}</small><strong>${x}</strong></div>`;
  const on = (b) => (b ? '<span class="st ok">active</span>' : '<span class="st bad">missing</span>');
  const chips = j.scope === 'b2b'
    ? [['Business accounts', n(j.b2b)], ['with an active plan', n(j.b2bActive)], ['Customer requests total', n(j.leads)], ['Open contact requests', n(j.contactsOpen)], ['Client packages', n(j.versions)], ['Submissions', n(j.submissions)], ['Co-branding partners (legacy)', n(j.partners)]]
    : [['Consumer accounts', n(j.users)], ['New (7 days)', n(j.users7)], ['Properties', n(j.objects)], ['Documents', n(j.docs)], ['Active shares', `${n(j.sharesActive)} / ${n(j.shares)}`], ['Lender Packages', n(j.versions)], ['Reminders on', n(j.reminders)], ['Open document requests', n(j.requestsOpen)]];
  v.innerHTML = `<div class="an-chips">${chips.map(([l, x]) => tile(l, x)).join('')}</div>
    <p class="form-note">Only ${j.scope === 'b2b' ? 'businesses' : 'consumers'} · Settings: payments ${on(j.config.billing)} · email delivery ${on(j.config.mail)} · daily run ${on(j.config.cron)}</p>`;
}


// New version: NO automatic reload anymore (owner's wish – the page should stay exactly as she left it).
// Checked every 2 minutes; if there's a new version, a small notice with "Reload" appears at the bottom. She decides.
const MY_V = new URL(import.meta.url).searchParams.get('v') || '';
function watchVersion() {
  if (!MY_V) return;
  let shown = false;
  const show = () => {
    if (shown) return; shown = true;
    const b = document.createElement('div');
    b.className = 'lr-upd'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>New version available</span><button type="button">Reload</button><button type="button" aria-label="Later">×</button>';
    // Phone: above the bottom bar, single line (no wrapping, doesn't cover buttons); desktop: bottom center.
    const phone = matchMedia('(max-width:900px)').matches;
    b.style.cssText = `position:fixed;left:50%;bottom:${phone ? 'calc(76px + env(safe-area-inset-bottom))' : '16px'};transform:translateX(-50%);z-index:9999;display:flex;gap:8px;align-items:center;white-space:nowrap;max-width:calc(100vw - 24px);background:#0F2C59;color:#fff;padding:6px 6px 6px 14px;border-radius:999px;box-shadow:0 10px 30px rgba(15,44,89,.35);font-size:14px;line-height:1.2`;
    const [go, x] = b.querySelectorAll('button');
    go.style.cssText = 'background:#fff;color:#0F2C59;border:0;border-radius:999px;padding:0 14px;font-weight:700;cursor:pointer;min-height:36px;white-space:nowrap;font-size:14px';
    x.style.cssText = 'background:transparent;color:#fff;border:0;font-size:20px;line-height:1;cursor:pointer;min-width:36px;min-height:36px;padding:0';
    go.onclick = () => location.reload();
    x.onclick = () => b.remove();
    document.body.append(b);
  };
  const check = async () => {
    if (document.hidden || shown) return;
    try {
      const html = await (await fetch('/internal/web-admin/index.html', { cache: 'no-store' })).text();
      const v = /intern\.mjs\?v=([A-Za-z0-9]+)/.exec(html)?.[1];
      if (v && v !== MY_V) show();
    } catch { /* offline – try again later */ }
  };
  setInterval(check, 120_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}

(async () => {
  if (!(await gate())) return;
  frame();
  show();
  window.addEventListener('hashchange', show);
  watchVersion();
})();

// ---------- Analytics: visitors, sources, devices, path to purchase (cookieless, numbers only) ----------
let AN_DAYS = 1; // always "Today" first when opened
async function analyse(v) {
  if (!v.querySelector('#anBody')) AN_DAYS = 1; // freshly opened: "Today" first
  const seg = getSeg(), nf = (x) => num(x);
  v.innerHTML = `<section class="wa-over an"><div class="wa-over-h"><h2>Analytics · ${seg === 'b2b' ? 'B2B (businesses)' : 'B2C (consumers)'}</h2>
    <p class="form-note">Audience measurement without cookies and without stored IP addresses. Switch area at the top right (B2C ⇄ B2B).</p></div>
    <div class="wa-period"><div class="seg" role="group" aria-label="Period">${[[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']].map(([k, l]) => `<button type="button" data-ad="${k}" aria-pressed="${k === AN_DAYS}">${l}</button>`).join('')}</div></div>
    <details class="pt-card an-ga" id="anGa"><summary><strong>Google Analytics 4</strong> <span class="form-note" id="anGaSt">checking …</span></summary>
      <form id="anGaF" class="an-ga-f"><label>Measurement ID<input name="gid" placeholder="G-XXXXXXXXXX" autocomplete="off" spellcheck="false" maxlength="16"></label>
      <label class="chk"><input type="checkbox" name="on"> Turn on (visitors are asked for consent first)</label>
      <button class="btn btn-dark btn-sm" type="submit">Save</button><p class="form-note" id="anGaMsg" role="status">Measurement ID: Google Analytics → Admin → Data streams → Web. The cookieless measurement below keeps running independently.</p></form></details>
    <div id="anBody"><p class="lr-ld" role="status">Loading …</p></div></section>`;
  api('/api/admin/ga').then((g) => {
    const f = $('#anGaF'); if (!f || !g.ok) { const st = $('#anGaSt'); if (st) st.textContent = 'owner only'; return; }
    f.gid.value = g.data.id; f.on.checked = g.data.on;
    $('#anGaSt').textContent = g.data.on ? `active · ${g.data.id}` : g.data.id ? 'turned off' : 'not set up';
    f.onsubmit = async (e) => { e.preventDefault(); const r = await api('/api/admin/ga', { method: 'POST', body: JSON.stringify({ id: f.gid.value.trim().toUpperCase(), on: f.on.checked }) }); $('#anGaMsg').textContent = r.ok ? r.data.message : r.data?.error || 'Error'; if (r.ok) $('#anGaSt').textContent = r.data.on ? `active · ${r.data.id}` : 'turned off'; };
  });
  v.querySelectorAll('[data-ad]').forEach((b) => b.onclick = () => { AN_DAYS = Number(b.dataset.ad); v.querySelectorAll('[data-ad]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); });
  const load = async () => {
    const box = $('#anBody'); box.style.opacity = '.55';
    const r = await api(`/api/admin/system?analytics=${seg}&days=${AN_DAYS}`);
    box.style.opacity = '';
    if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Not available.')}</p>`; return; }
    const d = r.data, ev = d.events || {}, evv = d.eventVisitors || {};
    const delta = (a, b) => { if (!b) return a ? '<small class="an-d up">new</small>' : ''; const p = Math.round(((a - b) / b) * 100); return `<small class="an-d ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs. previous period</small>`; };
    const tile = (l, val, sub = '') => `<div class="wa-tile"><span class="wa-tile-l">${l}</span><strong>${val}</strong>${sub}</div>`;
    const ppv = d.visitors ? num(d.pageviews / d.visitors, { maximumFractionDigits: 1 }) : '–';
    const tiles = seg === 'b2b' ? [
      tile('Visitors', nf(d.visitors), delta(d.visitors, d.prevVisitors)), tile('Page views', nf(d.pageviews), delta(d.pageviews, d.prevPageviews)), tile('Pages per visit', ppv),
      tile('Account requests', nf(ev.b2b_request), '<small>via form / portal</small>'), tile('Demo & contact', nf(ev.b2b_contact)), tile('Portal sign-ins', nf(ev.b2b_login)),
      tile('Clicks "Request a demo"', nf(ev.b2b_demo_klick), '<small>/business and /business-portal</small>'), tile('Clicks "Email me the info"', nf(ev.b2b_unterlagen_klick)),
      tile('Plan checkout opened', nf(ev.checkout_start)), tile('Plans booked', nf(d.purchases)),
    ] : [
      tile('Visitors', nf(d.visitors), delta(d.visitors, d.prevVisitors)), tile('Page views', nf(d.pageviews), delta(d.pageviews, d.prevPageviews)), tile('Pages per visit', ppv),
      tile('Sign-ups', nf(d.registrations), '<small>new accounts (from the database)</small>'), tile('Sign-ins', nf(ev.login)),
      tile('Purchase dialog opened', nf(ev.checkout_open)), tile('To checkout', nf(ev.checkout_start)), tile('Purchases', nf(d.purchases), '<small>confirmed by Stripe</small>'),
    ];
    const steps = seg === 'b2b'
      ? [['Visitors', d.visitors], ['Saw the "For businesses" page', d.offerVisitors], ['Requested an account', ev.b2b_request], ['Signed in to the portal', evv.b2b_login], ['Booked a plan', d.purchases]]
      : [['Visitors', d.visitors], ['Viewed pricing', d.offerVisitors], ['Signed up', d.registrations], ['Opened purchase dialog', evv.checkout_open], ['To checkout', evv.checkout_start], ['Purchased', d.purchases]];
    const first = Number(steps[0][1] || 0);
    const funnel = steps.map(([l, n], i) => { n = Number(n || 0); const prev = i ? Number(steps[i - 1][1] || 0) : n, pct = first ? Math.round((n / first) * 100) : 0; return `<div class="fn-row"><span class="fn-l">${esc(l)}</span><span class="fn-bar"><i style="width:${first ? Math.max(n ? 2 : 0, Math.min(100, pct)) : 0}%"></i></span><strong class="fn-n">${nf(n)}</strong><small class="fn-c">${i ? (prev ? `${Math.round((n / prev) * 100)}% of previous step` : '–') : 'Start'}</small></div>`; }).join('');
    const list = (title, rows, lab = (x) => x, unit = 'Visitors') => { const max = Math.max(1, ...rows.map((r) => Number(r[1]))); return `<section class="pt-card an-list"><h3>${title}</h3>${rows.length ? `<ol>${rows.map((r) => `<li><span class="an-bar" style="--w:${Math.round((Number(r[1]) / max) * 100)}%"></span><span class="an-k">${esc(lab(r[0]))}</span><b>${nf(r[1])}</b></li>`).join('')}</ol><p class="form-note">${unit}</p>` : '<p class="form-note">No data yet.</p>'}</section>`; };
    const DEV = { mobile: 'Smartphone', tablet: 'Tablet', desktop: 'Computer', '?': 'Unknown' };
    let cn; try { cn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { cn = null; }
    const reg = (r, k) => (k === 'US' && US_ST[r] ? US_ST[r] : `${r} (${k})`);
    box.innerHTML = `<div class="wa-tiles">${tiles.join('')}</div>
      <section class="pt-card"><h3>Visitors and page views per day</h3>${chart(d.series || [], AN_DAYS)}</section>
      <section class="pt-card"><h3>Path to ${seg === 'b2b' ? 'a business account' : 'purchase'}</h3><div class="fn">${funnel}</div><p class="form-note">Visitors per step in the selected period. Sign-ups and purchases come from the database and Stripe, so they're complete even with "Do Not Track" on.</p></section>
      <div class="an-grid">${list('Top pages', (d.pages || []).map((p) => [p[0], p[1]]), (x) => x, 'Page views')}${list('Sources', d.refs || [])}${list('Campaigns (utm)', d.campaigns || [])}${list('Devices', d.devices || [], (x) => DEV[x] || x)}${list('Browsers', d.browsers || [])}${list('Operating systems', d.os || [])}${list('Countries', d.countries || [], (x) => (x === '??' ? 'Unknown' : (cn ? cn.of(x) : x)))}</div>
      <div class="an-grid an-geo">${list('Cities', (d.cities || []).map(([c, r, k, n]) => [`${c}${r ? ', ' + r : ''}${k && k !== 'US' ? ' (' + k + ')' : ''}`, n]))}${list('States / regions', (d.regions || []).map(([r, k, n]) => [reg(r, k), n]))}</div>
      <p class="form-note">Visitors = unique visitors per day, summed over the period (without cookies, recognizing someone across days is intentionally impossible). Not counted: the admin area, bots, visitors with "Do Not Track" or Global Privacy Control. Location: approximate, derived from the IP address (the IP is not stored).</p>`;
  };
  load();
}

const US_ST = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico' };

// Small line chart (SVG) for the daily values.
// Fill the daily series up to and including today: days without numbers show as 0, today is always visible.
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function fillToToday(series, days) {
  const by = new Map(series.map((x) => [dayKey(x[0]), x]));
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const n = Math.max(1, Math.min(400, days || (series.length ? Math.round((today - new Date(series[0][0])) / 864e5) + 1 : 1)));
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); const k = dayKey(d); const hit = by.get(k); out.push([k + 'T12:00:00', hit ? Number(hit[1]) || 0 : 0, hit ? Number(hit[2]) || 0 : 0]); }
  return out;
}
function chart(series, days) {
  series = fillToToday(series || [], days);
  const sm = innerWidth < 600, W = sm ? 360 : 720, H = sm ? 200 : 220, P = { l: 40, r: 12, t: 12, b: 28 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxV = Math.max(4, ...series.map((x) => Math.max(x[1], x[2])));
  const step = Math.pow(10, Math.floor(Math.log10(maxV))) * (maxV / Math.pow(10, Math.floor(Math.log10(maxV))) > 5 ? 2 : 1), top = Math.ceil(maxV / step) * step;
  const X = (i) => P.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw), Y = (v) => P.t + ih - (v / top) * ih;
  const line = (k) => series.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join('');
  const grid = []; for (let v = 0; v <= top; v += step) grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="an-g"/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="an-t">${num(v)}</text>`);
  const every = Math.max(1, Math.ceil(series.length / (sm ? 4 : 8)));
  const lab = series.map((x, i) => ((i % every === 0 && series.length - 1 - i >= every / 2) || i === series.length - 1) ? `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === series.length - 1 && series.length > 1 ? 'end' : 'middle'}" class="an-t">${i === series.length - 1 ? 'Today' : new Date(x[0]).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</text>` : '').join('');
  const dots = series.length <= 31 ? series.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x[1])}" r="3" class="an-dv"><title>${new Date(x[0]).toLocaleDateString('en-US')}: ${x[1]} visitors, ${x[2]} views</title></circle>`).join('') : '';
  return `<div class="an-legend"><span class="an-lv">Visitors</span><span class="an-lp">Page views</span></div><svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitors and page views per day">${grid.join('')}<path d="${line(2)}" class="an-p"/><path d="${line(1)}" class="an-v"/>${dots}${lab}</svg>`;
}

// ---------- Setup: open items with instructions, completed items collapsed ----------
async function einrichtung(v) {
  const r = await api('/api/admin/setup');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const all = r.data.items || [];
  const open = all.filter((x) => !x.ok), done = all.filter((x) => x.ok);
  const must = open.filter((x) => !x.optional);
  const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
  const groups = [...new Set(all.map((x) => x.group))];
  const card = (x) => `<li class="su-li"><button type="button" class="su-item su-row${x.optional ? ' opt' : ''}" data-open="${x.id}"><span class="su-h"><strong>${esc(x.title)}</strong>${x.optional ? '<span class="su-tag">optional</span>' : ''}<span class="su-tag ${x.auto ? 'auto' : 'man'}">${x.auto ? 'detected automatically' : 'check off yourself'}</span></span>
      <span class="su-sub">${esc(x.why)}</span><span class="su-go">${x.time ? `about ${esc(x.time)} · ` : ''}Open instructions ›</span></button><button type="button" class="btn btn-outline btn-sm su-done" data-done="${x.id}" aria-label="Mark ${esc(x.title)} as done">✓ Done</button></li>`;
  const doneRow = (x) => `<li class="su-dli"><span>✓ ${esc(x.title)}<small>${x.by === 'auto' ? 'detected automatically' : `checked off${x.doneAt ? ` on ${esc(fmtDate(x.doneAt, { month: 'short', day: 'numeric', year: 'numeric' }))}` : ''}`}</small></span>${x.by === 'manuell' ? `<button type="button" class="btn btn-ghost btn-sm" data-reopen="${x.id}">Reopen</button>` : ''}</li>`;
  v.innerHTML = `<section class="wa-over"><div class="wa-over-h"><h2>Setup</h2><p class="form-note">${must.length ? `<strong>${must.length} required item${must.length === 1 ? '' : 's'} open</strong>${open.length > must.length ? `, ${open.length - must.length} optional` : ''}.` : '<strong>All required items done.</strong>'} Tap an item to get exact step-by-step instructions. Everything here is something only you can do (accounts, keys, settings). Never share values by chat or email – always enter them directly in Vercel.</p></div>
    <div class="su-bar" role="img" aria-label="${pct} percent done"><i style="width:${pct}%"></i></div><p class="form-note">${done.length} of ${all.length} done</p>
    ${groups.map((g) => { const o = open.filter((x) => x.group === g); return o.length ? `<h3 class="wa-sub">${esc(g)}</h3><ol class="su-list">${o.map(card).join('')}</ol>` : ''; }).join('') || '<p class="pt-alert ok">Everything is set up.</p>'}
    ${done.length ? `<details class="su-donebox"><summary>Done (${done.length})</summary><ul class="su-dlist">${done.map(doneRow).join('')}</ul></details>` : ''}</section>`;
  const mark = async (id, val) => { const x = await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ id, done: val }) }); if (!x.ok) msg(x.data?.error || 'Error', true); einrichtung(v); };
  v.querySelectorAll('[data-done]').forEach((b) => b.onclick = () => { b.disabled = true; b.textContent = '…'; mark(b.dataset.done, true); });
  v.querySelectorAll('[data-reopen]').forEach((b) => b.onclick = () => { b.disabled = true; mark(b.dataset.reopen, false); });
  const guide = (x) => {
    let d = document.getElementById('suDlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'suDlg'; d.className = 'wa-dlg'; document.body.append(d); }
    const n = x.steps.length;
    d.innerHTML = `<div class="wa-dlg-in su-guide"><div class="wa-dlg-h"><h2>${esc(x.title)}</h2><button type="button" class="stage-x" data-x aria-label="Close">×</button></div>
      <p class="su-state ${x.ok ? 'ok' : 'open'}">${x.ok ? '✓ Done' : 'Open'}${x.time ? ` · takes about ${esc(x.time)}` : ''} · ${n} step${n === 1 ? '' : 's'}${x.info ? ` · ${esc(x.info)}` : ''}</p>
      <div class="su-why"><strong>Why?</strong> ${esc(x.why)}</div>
      ${x.need ? `<div class="su-need"><strong>Have ready:</strong> ${esc(x.need)}</div>` : ''}
      <ol class="su-gsteps">${x.steps.map((st, i) => `<li><label><input type="checkbox" data-st="${i}"><span class="su-num">${i + 1}</span><span class="su-txt">${st}</span></label></li>`).join('')}</ol>
      ${(x.copy || []).map((c, i) => `<div class="su-copy"><div class="su-copy-h"><strong>${esc(c.label.replace(/^Copy /, ''))}</strong><button type="button" class="btn btn-dark btn-sm" data-cp="${i}">${esc(c.label)}</button></div><textarea class="su-copy-t" readonly rows="8" aria-label="${esc(c.label)}">${esc(c.text)}</textarea></div>`).join('')}
      ${x.check ? `<div class="su-check"><strong>How to check it worked:</strong> ${x.check}</div>` : ''}
      <p class="form-note">The checkmarks on the steps are just your reminder and are saved in this browser.</p>
      <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Close</button>${x.ok ? (x.by === 'manuell' ? `<button type="button" class="btn btn-outline" data-un>Reopen</button>` : '') : `${x.auto ? `<button type="button" class="btn btn-outline" data-re>Check again</button>` : ''}<button type="button" class="btn btn-dark" data-ok>Finished – mark as done</button>`}</div></div>`;
    const K = 'su_' + x.id; let st = {}; try { st = JSON.parse(localStorage.getItem(K) || '{}'); } catch { /* private mode */ }
    d.querySelectorAll('[data-st]').forEach((c) => { c.checked = Boolean(st[c.dataset.st]); c.onchange = () => { st[c.dataset.st] = c.checked; try { localStorage.setItem(K, JSON.stringify(st)); } catch { /* private mode */ } }; });
    d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
    d.querySelectorAll('[data-cp]').forEach((b) => b.onclick = async () => {
      const t = (x.copy || [])[Number(b.dataset.cp)]?.text || '', o = b.textContent;
      try { await navigator.clipboard.writeText(t); b.textContent = 'Copied ✓'; } catch { const ta = b.closest('.su-copy')?.querySelector('textarea'); ta?.focus(); ta?.select(); b.textContent = 'Selected – copy now'; }
      setTimeout(() => { b.textContent = o; }, 1800);
    });
    d.querySelector('[data-re]')?.addEventListener('click', () => { d.close(); einrichtung(v); });
    d.querySelector('[data-ok]')?.addEventListener('click', () => { d.close(); mark(x.id, true); });
    d.querySelector('[data-un]')?.addEventListener('click', () => { d.close(); mark(x.id, false); });
    d.showModal();
  };
  v.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => guide(all.find((x) => x.id === b.dataset.open)));
  v.querySelectorAll('[data-undo]').forEach((b) => b.onclick = () => mark(b.dataset.undo, false));
}
