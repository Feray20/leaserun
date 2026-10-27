// Web-Admin (nur ADMIN_EMAILS, mit zweitem Faktor): Finanz-Cockpit, System, Nutzer, Sicherheit, Partner, Rechnungsarchiv,
// Steuer-Export, Anfragen und Codes, Protokoll und Betreiber-Kennzahlen.
import { logoLoader } from './loader.mjs?v=892f3666';
import { api, download, dt, dtt, esc, eur, loginForm, logout, session, setSession, supa, token } from './sess.mjs?v=892f3666';

// Zwei-Faktor-Code: Autofill aus der Tastatur (iOS/Android), Eingabe säubern und mit 6 Ziffern automatisch absenden.
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
const PAY = { PAID: 'bezahlt', PENDING: 'offen', OVERDUE: 'überfällig', CANCELLED: 'storniert' };
// Rückmeldung immer sichtbar: oben im Kopf und zusätzlich als Hinweis unten am Bildschirm (auch wenn weit gescrollt).
const msg = (t, bad = false) => {
  const el = $('#adMsg'); if (el) { el.textContent = t; el.className = 'form-note ' + (bad ? 'st bad' : ''); }
  if (!t) return;
  let x = document.getElementById('adToast');
  if (!x) { x = document.createElement('div'); x.id = 'adToast'; x.setAttribute('role', 'status'); x.setAttribute('aria-live', 'polite'); document.body.append(x); }
  x.textContent = t; x.className = 'wa-toast show' + (bad ? ' bad' : '');
  clearTimeout(x._t); x._t = setTimeout(() => { x.className = 'wa-toast' + (bad ? ' bad' : ''); }, bad ? 6000 : 3500);
};
// Einheitliche Zustände: Skelett beim Laden, verständlicher Fehler mit „Erneut versuchen“, leerer Zustand mit Erklärung.
const skel = () => `<div class="wa-skel" aria-busy="true" aria-label="Daten werden geladen"><div class="wa-skel-kpis">${'<span></span>'.repeat(4)}</div><div class="wa-skel-card"><i class="w40"></i>${'<i></i>'.repeat(5)}</div></div>`;
function errState(v, text) {
  v.innerHTML = `<div class="wa-state err" role="alert"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg><strong>Die Daten konnten nicht geladen werden.</strong>${text ? `<span>${esc(text)}</span>` : ''}<button type="button" class="btn btn-outline" data-retry>Erneut versuchen</button></div>`;
  v.querySelector('[data-retry]').onclick = () => show();
}
const emptyState = (title, text) => `<div class="wa-state"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg><strong>${title}</strong>${text ? `<span>${text}</span>` : ''}</div>`;

// Alle Fenster (dialog) im Web-Admin schließen auch per Klick daneben – nicht nur über „×“ oder „Schließen“.
// Nur wenn Drücken und Loslassen beide außerhalb liegen (Text markieren im Fenster schließt nichts).
{
  let downOut = false;
  const outside = (d, e) => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  document.addEventListener('pointerdown', (e) => { const d = e.target instanceof HTMLDialogElement && e.target.open ? e.target : null; downOut = Boolean(d && outside(d, e)); }, true);
  document.addEventListener('click', (e) => { const d = e.target instanceof HTMLDialogElement && e.target.open ? e.target : null; if (d && downOut && outside(d, e) && !d.dataset.keep) d.close(); downOut = false; }, true);
}

// ---------- Zugang ----------
async function gate() {
  const adminLogin = () => loginForm(root, {
    title: 'Web-Admin', lead: 'Anmeldung nur für Administratoren. Getrennt vom Kundenkonto und vom Unternehmensportal.',
    note: 'Nach dem Passwort folgt der Code aus Google Authenticator.',
    check: async (d) => { const r = await fetch('/api/admin/check', { headers: { Authorization: 'Bearer ' + d.access_token }, cache: 'no-store' }); const j = await r.json().catch(() => ({})); return j.admin ? null : (j.ipBlocked ? 'Kein Zugriff von dieser IP-Adresse.' : 'Falsche Anmeldedaten oder kein Zugang zum Web-Admin.'); },
  });
  if (!token()) { adminLogin(); return false; }
  const r = await api('/api/admin/check');
  if (r.status === 401) { setSession(null); adminLogin(); return false; }
  if (r.data?.ipBlocked) { root.innerHTML = '<h1>Kein Zugriff</h1><p>Zugriff von dieser IP-Adresse ist nicht freigegeben (ADMIN_IP_ALLOWLIST in Vercel).</p>'; return false; }
  if (!r.data?.admin) {
    root.innerHTML = `<h1>Kein Zugriff</h1><p>Dieser Bereich ist nur für Administratoren.${r.data?.configured === false ? ' (In Vercel ist noch keine Administrator-Adresse hinterlegt: Variable ADMIN_EMAILS.)' : ''}</p>`;
    return false;
  }
  if (!r.data.mfaOk) { await mfa(); return false; }
  return true;
}

// Zweiter Faktor über Supabase MFA (TOTP-App wie Google Authenticator, 1Password).
async function mfa() {
  // Bereits eingerichteter zweiter Faktor (App oder SMS): nur Code abfragen.
  try {
    const m = await import('./mfa.mjs?v=892f3666');
    const { factors } = await m.factorsOf(token());
    if (factors.length) { root.innerHTML = '<div class="pt-card wa-mfa" id="adMfa"></div>'; await m.challengeUI($('#adMfa'), session(), () => location.reload()); return; }
  } catch { /* weiter mit Einrichtung */ }
  const auth = { Authorization: 'Bearer ' + token() };
  const u = await supa('/auth/v1/user', { headers: auth }).then((x) => x.json()).catch(() => ({}));
  const verified = (u.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
  let factorId = verified?.id;
  let enrollHtml = '';
  if (!factorId) {
    // Unbestätigte Altfaktoren entfernen, dann neu einrichten.
    for (const f of (u.factors || []).filter((x) => x.status !== 'verified')) await supa(`/auth/v1/factors/${f.id}`, { method: 'DELETE', headers: auth });
    const e = await supa('/auth/v1/factors', { method: 'POST', headers: auth, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'LeaseRun Admin ' + new Date().toISOString().slice(0, 10) }) });
    const ej = await e.json().catch(() => ({}));
    if (!e.ok) { root.innerHTML = `<h1>Zweiter Faktor</h1><p>Einrichtung nicht möglich: ${esc(ej.msg || ej.error_description || e.status)}. In Supabase unter Authentication → Multi-Factor muss TOTP aktiviert sein.</p>`; return; }
    factorId = ej.id;
    enrollHtml = `<p>1. Diesen Code mit einer Authenticator-App scannen (Google Authenticator, 1Password, Authy):</p>
      <img src="${esc(ej.totp.qr_code)}" alt="QR-Code für die Authenticator-App" width="200" height="200">
      <p class="form-note">Oder Schlüssel manuell eingeben: <code>${esc(ej.totp.secret)}</code></p><p>2. Den 6-stelligen Code aus der App eingeben:</p>`;
  }
  root.innerHTML = `<div class="wa-mfa pt-card"><h1>Zweiter Faktor</h1>${enrollHtml || '<p>Bitte den 6-stelligen Code aus Ihrer Authenticator-App eingeben.</p>'}
    <form id="mfaF" class="pt-row"><input id="mfaC" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus enterkeyhint="done" aria-label="Code" style="font-size:22px;letter-spacing:.2em;width:9ch;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px"><button class="btn btn-dark" type="submit">Bestätigen</button></form>
    <p class="form-note" id="mfaMsg" role="status"></p></div>`;
  $('#mfaF').onsubmit = async (ev) => {
    ev.preventDefault();
    const c = await supa(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', headers: auth });
    const cj = await c.json().catch(() => ({}));
    if (!c.ok) { $('#mfaMsg').textContent = cj.msg || 'Fehler beim Anfordern.'; return; }
    const v = await supa(`/auth/v1/factors/${factorId}/verify`, { method: 'POST', headers: auth, body: JSON.stringify({ challenge_id: cj.id, code: $('#mfaC').value.trim() }) });
    const vj = await v.json().catch(() => ({}));
    if (!v.ok || !vj.access_token) { $('#mfaMsg').textContent = vj.msg || 'Code falsch oder abgelaufen.'; return; }
    setSession({ ...session(), ...vj });
    location.reload();
  };
}

// ---------- Rahmen ----------
// Bereich wie „Einsteiger ⇄ Profi“: B2C (Privatkunden) oder B2B (Unternehmen) – steuert Übersicht und Nutzer-Liste.
// Strikte Trennung: Jede Ansicht zeigt nur Daten des gewählten Bereichs. „System“ ist der einzige Bereich mit
// bereichsübergreifenden Betriebsdaten (Einrichtung, Server, Webhooks, Sicherheit, Audit-Protokoll).
const SEGS = { b2c: 'Privatkunden (B2C)', b2b: 'Unternehmen (B2B)', system: 'System (gesamt)', steuer: 'Steuersoftware' };
const getSeg = () => { try { const x = localStorage.getItem('lr-admin-seg'); return x === 'b2b' || x === 'system' || x === 'steuer' ? x : 'b2c'; } catch { return 'b2c'; } };
// Welche Reiter es in welchem Bereich gibt (alles andere ist im Bereich ausgeblendet).
const TAB_SCOPES = {
  uebersicht: ['b2c', 'b2b'], nutzer: ['b2c', 'b2b', 'system'], freischaltung: ['b2c'], probleme: ['b2c', 'b2b'], vorschlaege: ['b2c', 'b2b'], werbung: ['b2c', 'b2b'], cockpit: ['b2c', 'b2b'],
  // Steuersoftware: alles Steuerliche an einem Ort, zwei Firmen getrennt (Dropshipping | LeaseRun mit B2C/B2B-Umschalter).
  st_start: ['steuer'], st_buchungen: ['steuer'], st_abgleich: ['steuer'], st_verkaeufe: ['steuer'], st_skalierung: ['steuer'], st_konten: ['steuer'], st_angebote: ['steuer'], st_tipps: ['steuer'], st_kanzlei: ['steuer'], st_daten: ['steuer'], st_belege: ['steuer'], st_buchhaltung: ['steuer'], st_steuerplan: ['steuer'], rechnungen: ['steuer'], steuer: ['steuer'], st_immo: ['steuer'], st_ablage: ['steuer'],
  analyse: ['b2c', 'b2b'], kennzahlen: ['b2c', 'b2b'], partner: ['b2b'], api: ['system'], creator: ['b2b'], anfragen: ['b2b'], akquise: ['b2b'], postfach: ['system'], termine: ['system'],
  einrichtung: ['system'], system: ['system'], sicherheit: ['system'], protokoll: ['system'], hq: ['system'], os: ['system'],
};
const inScope = (t, g = getSeg()) => (TAB_SCOPES[t] || ['system']).includes(g);
// Startpunkt: im Bereich System das Headquarters (Lage, Prüfen & erledigen), in B2C/B2B die Übersicht des Bereichs.
const firstTab = (g = getSeg()) => (g === 'system' ? 'os' : g === 'steuer' ? 'st_start' : 'uebersicht');
const setSeg = (x) => { try { localStorage.setItem('lr-admin-seg', x); } catch { /* nur Komfort */ } };
// Sprung aus dem Headquarters in einen Reiter – bei Bedarf in den passenden Datenbereich wechseln (nie Fremddaten stehen lassen).
function goTab(t, sg) {
  if (sg && SEGS[sg] && sg !== getSeg()) { setSeg(sg); CK_CACHE.clear(); frame(); }
  if (location.hash.slice(1) === t) show(); else location.hash = t;
}
const TABS = [['os', 'Desktop'], ['hq', 'Leitstand'], ['freischaltung', 'Freischaltung'], ['postfach', 'Postfach'], ['termine', 'Termine'], ['uebersicht', 'Übersicht'], ['einrichtung', 'Einrichtung'], ['analyse', 'Analyse'], ['cockpit', 'Finanz-Cockpit'], ['system', 'System'], ['nutzer', 'Nutzer'], ['sicherheit', 'Sicherheit'], ['partner', 'Partner'], ['creator', 'Creator Operations'], ['rechnungen', 'Rechnungen'], ['steuer', 'GoBD-Export (DATEV)'], ['st_immo', 'Pakete & Versand'], ['st_start', 'Dropshipping-Übersicht'], ['st_buchungen', 'Buchungen'], ['st_verkaeufe', 'Verkäufe'], ['st_skalierung', 'Skalierung'], ['st_abgleich', 'Abgleich'], ['st_konten', 'eBay-Konten & Import'], ['st_angebote', 'eBay-Angebote'], ['st_tipps', 'Steuer-Hinweise'], ['st_kanzlei', 'Steuerberaterin'], ['st_belege', 'Belege-Eingang & Abos'], ['st_buchhaltung', 'Buchhaltung'], ['st_steuerplan', 'Steuerplan & Rechner'], ['st_daten', 'Steuerdaten'], ['st_ablage', 'Meine Cloud'], ['anfragen', 'Anfragen & Codes'], ['akquise', 'Akquise'], ['werbung', 'Werbung'], ['protokoll', 'Protokoll'], ['kennzahlen', 'Kennzahlen'], ['probleme', 'Technische Probleme'], ['vorschlaege', 'Vorschläge'], ['api', 'API Management']];
// Vier Hauptbereiche (Handy: untere Leiste + Unterreiter; Desktop: Seitenleiste mit Gruppen).
const GROUPS = [
  ['hq', 'Headquarters', 'HQ', '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01"/>', ['os', 'hq']],
  ['mail', 'Postfach & Termine', 'Postfach', '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>', ['postfach', 'termine']],
  ['ops', 'Operations & CRM', 'CRM', '<path d="M16 11a4 4 0 1 0-8 0"/><circle cx="12" cy="7" r="3"/><path d="M4 21v-2a6 6 0 0 1 16 0v2"/>', ['uebersicht', 'nutzer', 'freischaltung', 'anfragen', 'partner', 'creator', 'vorschlaege']],
  ['fin', 'Finanzen & Compliance', 'Finanzen', '<path d="M4 7h16v12H4z"/><path d="M4 11h16M8 15h3"/>', ['cockpit']],
  ['tx_drop', 'Dropshipping', 'Dropship', '<path d="M3 7h13v10H3z"/><path d="M16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>', ['st_start', 'st_verkaeufe', 'st_skalierung', 'st_buchungen', 'st_abgleich', 'st_konten', 'st_angebote']],
  ['tx_kanzlei', 'Steuern & Steuerberaterin', 'Steuern', '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6M10 16h6"/>', ['st_buchhaltung', 'st_steuerplan', 'st_belege', 'st_kanzlei', 'st_tipps', 'st_daten']],
  ['tx_immo', 'LeaseRun', 'LeaseRun', '<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M9 21v-5h6v5"/>', ['rechnungen', 'steuer', 'st_immo']],
  ['tx_cloud', 'Meine Cloud', 'Cloud', '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z"/>', ['st_ablage']],
  ['ana', 'Analytics & Monitoring', 'Analyse', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', ['analyse', 'kennzahlen', 'probleme', 'protokoll', 'sicherheit']],
  ['api', 'API Management', 'API', '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/>', ['api']],
  ['sys', 'System & Setup', 'System', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', ['einrichtung', 'system']],
];
// Gruppen und Reiter nur des aktiven Bereichs; leere Gruppen entfallen.
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
  root.innerHTML = `<header class="wa-head wa-sticky"><a class="wa-brand" href="/" aria-label="LeaseRun – zur Startseite"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a><div class="wa-title"><small class="wa-kicker" id="adKicker">Web-Admin</small><h1 id="adTitle">Admin</h1></div>
      <div class="wa-segctl wa-segctl3 wa-segctl4" role="group" aria-label="Datenbereich"><button type="button" data-segset="b2c">B2C<span> · Privat</span></button><button type="button" data-segset="b2b">B2B<span> · Unternehmen</span></button><button type="button" data-segset="system">System</button><button type="button" data-segset="steuer">Steuer<span>software</span></button></div>
      <button type="button" class="btn btn-outline wa-out" id="adLogout" aria-label="Abmelden" title="Abmelden"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg><span>Abmelden</span></button></header>
    <p class="form-note wa-note">Nur für Administratoren · zweiter Faktor · alle Aktionen werden protokolliert · Abmeldung nach 2 Stunden ohne Aktivität.</p>
    <div class="wa-shell"><nav class="wa-tabs" aria-label="Bereiche">${groupsIn().map(([g, l, , , ts]) => `<div class="wa-grp"><span class="wa-grp-h">${l}</span>${ts.map((k) => `<button type="button" data-t="${k}">${tabLabel(k)}</button>`).join('')}</div>`).join('')}</nav>
    <div class="wa-main"><div class="wa-scope-band" id="adBand"></div><div class="wa-subtabs" id="adSub" role="tablist"></div><p id="adMsg" class="form-note" role="status"></p><div id="adView"></div></div></div>
    <nav class="wa-bottom" aria-label="Hauptbereiche">${groupsIn().map(([g, , sh, d]) => `<button type="button" data-g="${g}">${ic(d)}<span>${sh}</span></button>`).join('')}</nav>`;
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
    // Bereichswechsel: Navigation neu aufbauen (nur Reiter dieses Bereichs) und – falls der aktuelle Reiter hier
    // nicht existiert – auf den Start des Bereichs springen. Nie Daten des vorigen Bereichs stehen lassen.
    const cur = location.hash.slice(1).split('-')[0];
    frame();
    if (!inScope(cur)) location.hash = firstTab(); else show();
  });
}

function show() {
  const h = location.hash.slice(1).split('-')[0];
  let t = TABS.find(([k]) => k === h)?.[0] || firstTab();
  // Reiter gehört nicht zum aktiven Bereich → Start des Bereichs (keine Fremddaten anzeigen).
  // Direktlink auf einen Reiter, den es nur in einem Bereich gibt (z. B. #postfach, #termine aus Benachrichtigungen) → in diesen Bereich wechseln.
  if (!inScope(t) && t === h && (TAB_SCOPES[t] || []).length === 1) { setSeg(TAB_SCOPES[t][0]); CK_CACHE.clear(); frame(); }
  if (!inScope(t)) { t = firstTab(); history.replaceState(null, '', '#' + t); }
  { const band = $('#adBand'), sg = getSeg(); if (band) { band.dataset.seg = sg; band.innerHTML = t === 'hq' ? `<span class="wa-scope-dot"></span><strong>Headquarters · gesamtes Unternehmen</strong><small class="wa-asof">Stand: heute, ${new Date().toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} · ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</small><span>Umsätze Privat und Unternehmen getrennt ausgewiesen.</span>` : `<span class="wa-scope-dot"></span><strong>${SEGS[sg]}</strong><small class="wa-asof">Stand: heute, ${new Date().toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} · ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</small><span>${sg === 'steuer' ? (t === 'st_ablage' ? 'Deine Cloud – wichtige Dokumente und Bilder, nur im Web-Admin sichtbar.' : ['rechnungen', 'steuer', 'st_immo'].includes(t) ? 'LeaseRun – getrennt vom Dropshipping. Privatkunden und Unternehmen weiterhin getrennt.' : 'Dropshipping – eBay-Geschäftskonten und Amazon-Einkäufe. Getrennt von LeaseRun.') : sg === 'system' ? 'Betrieb gesamt: Einrichtung, Server, Webhooks, Sicherheit, Protokoll' : sg === 'b2b' ? 'Es werden ausschließlich Unternehmensdaten angezeigt.' : 'Es werden ausschließlich Privatkunden-Daten angezeigt.'}</span>`; } }
  // Neuer Bereich: alte Rückmeldung (z. B. „Wird umgesetzt.“ aus dem HQ) nicht in den nächsten Bereich mitnehmen.
  if (show.last !== t) { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); if (show.last) msg(''); show.last = t; }
  const g = groupOf(t);
  { const tt = $('#adTitle'), kk = $('#adKicker'); if (tt) tt.textContent = tabLabel(t); if (kk) kk.textContent = `Web-Admin · ${({ b2c: 'B2C Privat', b2b: 'B2B Unternehmen', system: 'System', steuer: 'Steuersoftware' })[getSeg()]}`; }
  try { sessionStorage.setItem(`lr-admin-last-${getSeg()}-${g[0]}`, t); } catch { /* ignore */ }
  // Nur ein Unterpunkt (z. B. Headquarters): keine doppelte Leiste „Headquarters | Headquarters“.
  $('#adSub').hidden = g[4].length < 2;
  $('#adSub').innerHTML = g[4].length < 2 ? '' : `<span class="wa-sub-h">${g[1]}</span>${g[4].map((k) => `<button type="button" role="tab" data-t="${k}">${tabLabel(k)}</button>`).join('')}`;
  $('#adSub').querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { location.hash = b.dataset.t; });
  root.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
  root.querySelectorAll('[data-g]').forEach((b) => b.setAttribute('aria-current', b.dataset.g === g[0] ? 'page' : 'false'));
  $('#adSub').querySelector(`[data-t="${t}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  // Frischer Container je Wechsel: ein noch ladender alter Reiter kann den neuen nicht überschreiben.
  const vOld = $('#adView'); const v = vOld.cloneNode(false); vOld.replaceWith(v);
  v.innerHTML = skel();
  msg('');
  const view = ({ os: (x) => import('./intern-os.mjs?v=892f3666').then((m) => m.osDesk(x, { goTab, msg })), hq: (x) => import('./intern-hq.mjs?v=892f3666').then((m) => m.hq(x, { goTab, msg })), uebersicht, einrichtung, analyse, cockpit, system: (x) => system(x, location.hash.includes('-mail')).then(() => import('./intern-feedback.mjs?v=892f3666')).then((m) => m.reviewsAdmin(x)).catch(() => {}), nutzer: (x) => nutzer(x, 1, '', getSeg() === 'system' ? 'admin' : getSeg()), vorschlaege: (x) => import('./intern-feedback.mjs?v=892f3666').then((m) => m.vorschlaege(x, getSeg())), probleme: (x) => import('./intern-support.mjs?v=892f3666').then((m) => m.probleme(x, getSeg(), msg)), sicherheit, partner, rechnungen: (x) => rechnungen(x).then(() => withImmoSub(x, () => show())), steuer: (x) => Promise.resolve(steuer(x)).then(() => withImmoSub(x, () => show())), anfragen, protokoll, kennzahlen, akquise: (x) => import('./intern-marketing.mjs?v=892f3666').then((m) => m.akquise(x)), postfach: (x) => import('./intern-mail.mjs?v=892f3666').then((m) => m.postfach(x)), termine: (x) => import('./intern-termine.mjs?v=892f3666').then((m) => m.termine(x)), werbung: (x) => import('./intern-marketing.mjs?v=892f3666').then((m) => m.werbung(x)), creator: (x) => import('./intern-creator.mjs?v=892f3666').then((m) => m.creatorOps(x)), api: (x) => import('./intern-api.mjs?v=892f3666').then((m) => m.apiOps(x)),
    st_start: (x) => ST().then((m) => m.stStart(x, { msg, goTab })), st_buchungen: (x) => ST().then((m) => m.stBuchungen(x, { msg })), st_abgleich: (x) => ST().then((m) => m.stAbgleich(x, { msg })), st_verkaeufe: (x) => ST().then((m) => m.stVerkaeufe(x, { msg })), st_skalierung: (x) => ST().then((m) => m.stSkalierung(x, { msg })),
    st_konten: (x) => ST().then((m) => m.stKonten(x, { msg })), st_tipps: (x) => ST().then((m) => m.stTipps(x)), st_kanzlei: (x) => ST().then((m) => m.stKanzlei(x, { msg }, 'dropshipping')),
    st_daten: (x) => ST().then((m) => m.stDaten(x, { msg })), st_belege: (x) => ST().then((m) => m.stBelege(x, { msg })), st_buchhaltung: (x) => ST().then((m) => m.stBuchhaltung(x, { msg })), st_steuerplan: (x) => ST().then((m) => m.stSteuerplan(x, { msg })), st_immo: (x) => ST().then((m) => m.stKanzlei(x, { msg }, 'leaserun')), st_ablage: (x) => import('./intern-ablage.mjs?v=892f3666').then((m) => { x.innerHTML = '<div id="stAblage"></div>'; m.ablageCard(x.querySelector('#stAblage'), { goTab, msg }); }),
    freischaltung: (x) => import('./intern-freischaltung.mjs?v=892f3666').then((m) => m.freischaltung(x, { msg })), st_angebote: (x) => import('./intern-angebote.mjs?v=892f3666').then((m) => m.stAngebote(x, { msg })) })[t](v);
  Promise.resolve(view).catch((e) => { console.warn('[admin]', e); errState(v, ''); });
}

const ST = () => import('./intern-steuer.mjs?v=892f3666');
// Steuersoftware → LeaseRun: Umschalter B2C/B2B über Rechnungen und Export (Daten bleiben getrennt).
const withImmoSub = (v, again) => (getSeg() === 'steuer' ? ST().then((m) => { v.prepend(m.immoSubBar(() => { v.innerHTML = skel(); again(); })); }) : Promise.resolve());
const taxSeg = () => (getSeg() === 'steuer' ? (localStorage.getItem('lr-admin-steuer-sub') === 'b2b' ? 'b2b' : 'b2c') : getSeg());

// ---------- Nutzer: Konten im Überblick, sperren/entsperren, Passwort-Reset, löschen ----------
// Filter für die Nutzerliste (auf der geladenen Seite): aktiv = Anmeldung in den letzten 30 Tagen, neu = Registrierung in den letzten 14 Tagen.
const US_F = [['alle', 'Alle'], ['aktiv', 'Aktiv'], ['inaktiv', 'Inaktiv'], ['neu', 'Neu'], ['bestaetigt', 'Bestätigt'], ['gesperrt', 'Gesperrt']];
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
  const ago = (x) => (x ? dtt(x) : 'nie');
  const mk = seg === 'b2c' ? '<button type="button" class="btn btn-dark wa-mk-one" id="usMk">+ Privatkunde anlegen</button>' : seg === 'b2b' ? '<button type="button" class="btn btn-dark wa-mk-one" id="usMk">+ Unternehmen anlegen</button>' : '';
  const segLabel = { b2c: 'Privatkunden', b2b: 'Unternehmen', admin: 'Administratoren' }[seg] || '';
  v.innerHTML = `<section class="pt-card"><div class="wa-h-row"><h2>${segLabel}</h2>${mk}</div>
    <form class="wa-search" id="usF"><input id="usQ" type="search" placeholder="Nutzer per E-Mail suchen …" value="${esc(q)}" aria-label="Nutzer per E-Mail suchen" autocomplete="off"><button class="btn btn-dark" type="submit">Suchen</button></form>
    <p class="form-note">${us.length} Konten auf dieser Seite. Angezeigt werden nur Kontodaten – keine Inhalte. Jede Aktion wird protokolliert.</p>
    <div class="us-tools"><div class="pc-chips" role="group" aria-label="Filter">${US_F.map(([k, l]) => `<button type="button" data-usf="${k}" aria-pressed="${k === 'alle'}">${l} <b>${us.filter((u) => usTags(u).includes(k)).length}</b></button>`).join('')}</div>
      <label class="us-sort">Sortieren<select id="usSort"><option value="created">Registrierung (neueste)</option><option value="last">Letzte Anmeldung</option><option value="mail">E-Mail A–Z</option></select></label></div>
    <div class="us-list">${us.map((u) => `<article class="us-card${u.banned ? ' banned' : ''}" data-tags="${usTags(u).join(' ')}" data-created="${esc(u.createdAt || '')}" data-last="${esc(u.lastSignIn || '')}" data-mail="${esc(u.email || '')}">
      <div class="us-top"><strong>${esc(u.email || '(ohne E-Mail)')}</strong><span class="us-tags">${u.admin ? '<span class="st ok">Admin</span>' : ''}${u.banned ? '<span class="st bad">gesperrt</span>' : ''}${u.confirmed ? '' : '<span class="st warn">unbestätigt</span>'}${u.mfa ? '<span class="st ok">2FA</span>' : '<span class="st">ohne 2FA</span>'}</span></div>
      ${u.company ? `<div class="us-co"><strong>${esc(u.company.name)}</strong><span class="us-co-m"><span>${esc(u.company.number || '')}</span><span>${u.company.role === 'owner' ? 'Inhaber' : 'Berater'}</span>${u.company.verified ? '<span class="st ok">verifiziert</span>' : `<span class="st warn">${esc(u.company.status || 'offen')}</span>`}</span></div>` : ''}
      <dl class="us-meta"><div><dt>Registriert</dt><dd>${dt(u.createdAt)}</dd></div><div><dt>Letzte Anmeldung</dt><dd>${ago(u.lastSignIn)}</dd></div></dl>
      <div class="us-act">${seg === 'b2c' && !u.admin && !u.company ? `<button type="button" class="btn btn-dark" data-acc="${esc(u.id)}" data-mail="${esc(u.email)}">Zugriff freischalten</button>` : ''}${u.company && u.company.role === 'owner' && !u.company.verified ? `<button type="button" class="btn btn-dark" data-coapprove="${esc(u.company.id)}" data-name="${esc(u.company.name)}">Unternehmen freischalten</button>` : ''}${u.company && u.company.role === 'owner' ? `<button type="button" class="btn btn-dark" data-b2bacc="${esc(u.company.id)}" data-name="${esc(u.company.name)}">Zugriff freischalten</button>` : ''}${u.company ? `<button type="button" class="btn btn-outline" data-coopen="${esc(u.company.id)}">Unternehmen öffnen</button>` : ''}${u.confirmed ? '' : `<button type="button" class="btn btn-dark" data-us="confirm" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">Bestätigung erneut senden</button>`}<button type="button" class="btn btn-outline" data-us="reset" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">Passwort-Reset senden</button>${u.admin ? '' : `<div class="us-danger"><button type="button" class="btn ${u.banned ? 'btn-outline' : 'btn-danger'}" data-us="${u.banned ? 'unban' : 'ban'}" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">${u.banned ? 'Entsperren' : 'Sperren'}</button><button type="button" class="btn btn-danger" data-us="delete" data-id="${esc(u.id)}" data-mail="${esc(u.email)}" data-co="${u.company ? esc(u.company.role) : ''}">Konto löschen</button></div>`}</div>
    </article>`).join('') || emptyState('Keine Konten gefunden', q ? 'Für diese Suche gibt es keinen Treffer. Bitte die E-Mail-Adresse prüfen.' : 'Sobald sich jemand registriert, erscheint das Konto hier.')}</div>
    <div class="pt-row">${page > 1 ? '<button class="btn btn-ghost" id="usPrev" type="button">← Zurück</button>' : ''}${r.data.more ? '<button class="btn btn-ghost" id="usNext" type="button">Weiter →</button>' : ''}</div></section>`;
  $('#usMk')?.addEventListener('click', () => (seg === 'b2c' ? openCreatePrivate(() => nutzer(v, 1, '', seg)) : openCreateAccount(null, () => nutzer(v, 1, '', seg))));
  const list = v.querySelector('.us-list');
  const applyUs = () => {
    const f = v.querySelector('[data-usf][aria-pressed=true]')?.dataset.usf || 'alle', so = $('#usSort')?.value || 'created';
    const cards = [...list.querySelectorAll('.us-card')];
    cards.sort((a, b) => so === 'mail' ? a.dataset.mail.localeCompare(b.dataset.mail, 'de') : (b.dataset[so] || '').localeCompare(a.dataset[so] || ''));
    cards.forEach((c) => { c.hidden = !c.dataset.tags.split(' ').includes(f); list.append(c); });
    let em = list.querySelector('.us-none'); const none = cards.length && cards.every((c) => c.hidden);
    if (none && !em) { list.insertAdjacentHTML('beforeend', `<div class="us-none">${emptyState('Keine Konten in dieser Auswahl', 'Wählen Sie einen anderen Filter.')}</div>`); } else if (!none && em) em.remove();
  };
  v.querySelectorAll('[data-usf]').forEach((b) => b.onclick = () => { v.querySelectorAll('[data-usf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); applyUs(); });
  $('#usSort')?.addEventListener('change', applyUs);
  $('#usF').onsubmit = (e) => { e.preventDefault(); nutzer(v, 1, $('#usQ').value.trim(), seg); };
  v.querySelectorAll('[data-seg]').forEach((b) => b.onclick = () => { if (b.dataset.seg !== 'admin') { setSeg(b.dataset.seg); paintSeg(); } nutzer(v, 1, '', b.dataset.seg); });
  $('#usPrev')?.addEventListener('click', () => nutzer(v, page - 1, q, seg));
  $('#usNext')?.addEventListener('click', () => nutzer(v, page + 1, q, seg));
  v.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => import('./intern-feedback.mjs?v=892f3666').then((m) => m.accessDialog(b.dataset.acc, b.dataset.mail, (t, bad) => { msg(t, bad); if (!bad) nutzer(v, page, q, seg); })).catch(() => msg('Dialog konnte nicht geladen werden. Bitte Seite neu laden.', true)));
  v.querySelectorAll('[data-b2bacc]').forEach((b) => b.onclick = () => b2bAccessDialog(b.dataset.b2bacc, b.dataset.name, () => nutzer(v, page, q, seg)));
  v.querySelectorAll('[data-coapprove]').forEach((b) => b.onclick = async () => {
    if (!confirm(`${b.dataset.name} freischalten? Das Unternehmen erhält eine E-Mail.`)) return;
    b.disabled = true;
    const x = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'approve', id: b.dataset.coapprove }) });
    if (!x.ok) { msg(x.data?.error || 'Freischalten fehlgeschlagen.', true); b.disabled = false; return; }
    msg('Unternehmen freigeschaltet.'); nutzer(v, page, q, seg);
  });
  v.querySelectorAll('[data-coopen]').forEach((b) => b.onclick = () => { try { sessionStorage.setItem('lr-admin-open-partner', b.dataset.coopen); } catch { /* ignore */ } location.hash = 'partner'; });
  v.querySelectorAll('[data-us]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.us, m = b.dataset.mail;
    const ask = { ban: `Konto ${m} sperren? Anmelden ist dann nicht mehr möglich; offene Sitzungen laufen spätestens nach einer Stunde aus.`, unban: `Konto ${m} wieder freigeben?`, confirm: `Bestätigungs-E-Mail erneut an ${m} senden?`, reset: `E-Mail zum Zurücksetzen des Passworts an ${m} senden?` }[a];
    let confirmEmail;
    if (a === 'delete') {
      const warn = b.dataset.co === 'owner' ? ' Das Unternehmenskonto wird mit allen Beratern, Anfragen und Unterlagen gelöscht; Rechnungen bleiben gesetzlich archiviert.' : '';
      confirmEmail = prompt(`Konto ${m} endgültig löschen?${warn} Profil, Objekte, Dokumente und Zugang werden entfernt – das lässt sich nicht rückgängig machen.\n\nZur Bestätigung die E-Mail-Adresse eingeben:`);
      if (confirmEmail === null) return;
      if (confirmEmail.trim().toLowerCase() !== m.toLowerCase()) { msg('Die E-Mail-Adresse stimmt nicht überein – nichts gelöscht.', true); return; }
    } else if (!confirm(ask)) return;
    b.disabled = true;
    const x = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ action: a, id: b.dataset.id, ...(confirmEmail ? { confirmEmail } : {}) }) });
    if (!x.ok) { msg(x.data?.error || 'Aktion fehlgeschlagen.', true); b.disabled = false; return; }
    msg({ ban: 'Konto gesperrt.', unban: 'Konto freigegeben.', confirm: 'Bestätigungs-E-Mail gesendet.', reset: 'E-Mail zum Zurücksetzen gesendet.', delete: 'Konto gelöscht.' }[a]);
    nutzer(v, page, q, seg);
  });
}

// ---------- Übersicht: Kacheln je Bereich (B2C | B2B) ----------
const MAILS = {
  b2c: [
    ['Registrierung bestätigen', 'leaserun'], ['Passwort zurücksetzen', 'leaserun'], ['Bestätigung erneut / Anmeldelink', 'leaserun'],
    ['Kündigungsbestätigung', 'resend'], ['Erinnerungen & Datenraum-Freigaben', 'resend'], ['Zahlungsbelege & Rechnungen', 'stripe'],
  ],
  b2b: [
    ['Registrierung bestätigen (Portal)', 'leaserun'], ['Registrierungsnachweis (PDF) an Kunde und Geschäftsadresse', 'b2bmail'],
    ['Einladungen ins Team', 'resend'], ['Neue Kundenanfragen und Einreichungen', 'resend'], ['Prüfung der Unterlagen (Ergebnis)', 'resend'], ['Rechnungen auf Rechnung (PDF)', 'resend'],
  ],
};
function mailState(kind, m) {
  if (kind === 'stripe') return ['gelb', 'über Stripe – Logo/Name in Stripe → Branding'];
  if (kind === 'b2bmail') return m.ready ? (m.b2bNotify ? ['gruen', 'LeaseRun · an support@leaserun.com'] : ['gelb', 'LeaseRun · Kopie an ADMIN_EMAILS (B2B_NOTIFY_EMAIL fehlt)']) : ['rot', 'wird nicht gesendet'];
  if (kind === 'leaserun') return m.ready ? ['gruen', 'LeaseRun-Absender'] : ['gelb', 'übergangsweise Supabase-Absender'];
  return m.ready ? ['gruen', 'LeaseRun-Absender'] : ['rot', 'wird nicht gesendet'];
}

async function uebersicht(v) {
  const seg = getSeg();
  const r = await api('/api/admin/system?segment=' + seg);
  if (!r.ok) { errState(v, r.data?.error); return; }
  const d = r.data, x = d[seg] || {};
  const n = (k) => Number(k || 0).toLocaleString('de-DE');
  const pct = (a, b) => (b ? ` · ${Math.round((a / b) * 100)} %` : '');
  const tile = (label, val, sub = '', go = '', tone = '') => `<${go ? `a href="#${go}"` : 'div'} class="wa-tile${tone ? ' ' + tone : ''}"><span class="wa-tile-l">${label}</span><strong>${val}</strong>${sub ? `<small>${sub}</small>` : ''}</${go ? 'a' : 'div'}>`;
  const common = [
    tile(seg === 'b2b' ? 'Nutzerkonten (Inhaber & Berater)' : 'Konten', n(d.accounts), `${n(d.new7d)} neu in 7 Tagen · ${n(d.new30d)} in 30 Tagen`, 'nutzer'),
    tile('E-Mail bestätigt', n(d.confirmed), pct(d.confirmed, d.accounts).replace(' · ', '') || '–', 'nutzer', d.accounts && d.confirmed < d.accounts ? 'warn' : ''),
    tile('Zwei-Faktor aktiv', n(d.mfa), pct(d.mfa, d.accounts).replace(' · ', '') || '–', 'sicherheit'),
    tile('Aktiv (7 Tage)', n(d.active7d), `${n(d.sessions)} offene Sitzungen`, 'sicherheit'),
    tile('Gesperrt', n(d.banned), 'Konten ohne Anmeldung', 'nutzer', d.banned ? 'bad' : ''),
    tile('Kreditmappen (30 Tage)', n(d.kreditmappen30d), `${n(d.documents)} Dokumente gespeichert`),
  ];
  const spec = seg === 'b2b' ? [
    tile('Unternehmen', n(x.companies), `${n(x.verified)} verifiziert · ${n(x.paidPlans)} mit Tarif`, 'partner'),
    tile('Prüfung offen', n(x.reviewPending), 'eingereichte Unterlagen', 'partner', x.reviewPending ? 'warn' : ''),
    tile('Gesperrt / inaktiv', n(x.locked), 'Unternehmenskonten', 'partner', x.locked ? 'warn' : ''),
    tile('Kundenanfragen (30 Tage)', n(x.leads30d), `${n(x.leadsNew)} noch neu`, 'anfragen'),
    tile('Einreichungen (30 Tage)', n(x.submissions30d), 'Kreditmappen an Partner'),
    tile('Kontaktanfragen offen', n(x.contactOpen), 'über das B2B-Formular', 'anfragen', x.contactOpen ? 'warn' : ''),
    tile('Umsatz diesen Monat', eur(x.revenueMonthCents), 'bezahlte B2B-Rechnungen (brutto)', 'cockpit'),
    tile('Offene Rechnungen', n(x.openInvoices), eur(x.openCents), 'rechnungen', x.openInvoices ? 'warn' : ''),
  ] : [
    tile('Zahlende Kunden', n(x.paying), 'aktiver Tarif oder Pass', 'cockpit'),
    tile('Angelegte Objekte', n(x.objects), 'in allen Konten'),
    tile('Käufe (30 Tage)', n(x.purchases30d), eur(x.purchasesCents30d), 'cockpit'),
    tile('Umsatz diesen Monat', eur(x.revenueMonthCents), 'bezahlte Rechnungen (brutto)', 'cockpit'),
    tile('Offene Rechnungen', n(x.openInvoices), 'Privatkunden', 'rechnungen', x.openInvoices ? 'warn' : ''),
  ];
  const funnelBox = '<h3 class="wa-sub">Funnel: wo Nutzer abspringen</h3><div class="wa-period fn-period" role="group" aria-label="Zeitraum">' + [['30', '30 Tage'], ['90', '90 Tage'], ['', 'Gesamt']].map(([k, l]) => `<button type="button" data-fn="${k}" aria-pressed="${k === ''}">${l}</button>`).join('') + '</div><div id="funnel" class="fn"><p class="lr-ld" role="status">Wird geladen …</p></div>';
  v.innerHTML = `<section class="wa-over">
    <div class="wa-over-h"><h2>${SEGS[seg]}</h2><p class="form-note">Gleiche Kennzahlen, getrennt nach Bereich. Umschalten oben rechts (${seg === 'b2b' ? 'B2B' : 'B2C'} ⇄). Administratoren zählen nicht mit. Nur Zahlen, keine Inhalte.</p></div>
    <h3 class="wa-sub">Konten & Nutzung</h3><div class="wa-tiles">${common.join('')}</div>
    <h3 class="wa-sub">${seg === 'b2b' ? 'Unternehmen, Anfragen & Abrechnung' : 'Kunden & Umsatz'}</h3><div class="wa-tiles">${spec.join('')}</div>
    ${funnelBox}
  </section>`;
  loadFunnel(seg);
  v.querySelectorAll('[data-fn]').forEach((b) => b.onclick = () => { v.querySelectorAll('[data-fn]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadFunnel(seg, b.dataset.fn); });
}

async function loadFunnel(seg, days = '') {
  const box = $('#funnel'); if (!box) return;
  const r = await api(`/api/admin/system?funnel=${seg}${days ? `&days=${days}` : ''}`);
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  const steps = r.data.steps || [], first = Number(steps[0]?.[1] || 0);
  box.innerHTML = steps.map(([l, n], i) => {
    const prev = i ? Number(steps[i - 1][1]) : n, pct = first ? Math.round((n / first) * 100) : 0, conv = prev ? Math.round((n / prev) * 100) : 0;
    return `<div class="fn-row"><span class="fn-l">${esc(l)}</span><span class="fn-bar"><i style="width:${first ? Math.max(2, pct) : 0}%"></i></span><strong class="fn-n">${Number(n).toLocaleString('de-DE')}</strong><small class="fn-c">${i ? (prev ? `${conv} % vom Schritt davor` : '–') : 'Start'}</small></div>`;
  }).join('') + (first ? '' : '<p class="form-note">Noch keine Daten in diesem Zeitraum.</p>') + '<p class="form-note">Nur Zahlen, keine Personen. Administratoren zählen nicht mit. Der größte Abfall zwischen zwei Schritten zeigt, wo Hilfe am meisten bringt.</p>';
}

// ---------- E-Mail-Versand einrichten (System) ----------
const SB = 'https://supabase.com/dashboard/project/mieoylqhtvghcnvaxutg';
function mailSetup(m) {
  const st = (ok, t) => `<span class="st ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}">${t}</span>`;
  const domOk = m.fromDomain === 'leaserun.com';
  const steps = [
    ['Resend-Konto und Domain', `Auf <a href="https://resend.com/domains" target="_blank" rel="noopener">resend.com → Domains</a> „Add Domain“ → <code>leaserun.com</code>, Region <strong>Frankfurt (eu-central-1)</strong>.`, st(m.ready ? true : null, m.ready ? 'erledigt' : 'manuell')],
    ['DNS bei Hostinger eintragen', 'Hostinger → Domains → leaserun.com → DNS. Die drei Einträge, die Resend anzeigt, genau übernehmen (MX und TXT für „send“, TXT „resend._domainkey“). Zusätzlich empfohlen: TXT <code>_dmarc</code> mit <code>v=DMARC1; p=none;</code>. Danach bei Resend „Verify DNS Records“ (dauert einige Minuten).', st(m.ready ? true : null, m.ready ? 'erledigt' : 'manuell')],
    ['API-Schlüssel in Vercel', `Resend → API Keys → „Create“ (Sending access, Domain leaserun.com). In <a href="https://vercel.com/klk19/leaserun/settings/environment-variables" target="_blank" rel="noopener">Vercel → Environment Variables</a> eintragen: <code>RESEND_API_KEY</code> (Schlüssel), <code>NOTIFY_FROM_EMAIL</code> = <code>noreply@leaserun.com</code>, <code>B2B_NOTIFY_EMAIL</code> = Ihre Geschäftsadresse. Danach neu deployen. Schlüssel nie per Chat oder E-Mail weitergeben.`,
      `${st(m.resendKey, m.resendKey ? 'Schlüssel gesetzt' : 'Schlüssel fehlt')} ${st(m.fromSet ? (domOk ? true : null) : false, m.fromSet ? (domOk ? 'Absender @leaserun.com' : 'Absender nicht @leaserun.com') : 'Absender fehlt')} ${st(m.b2bNotify ? true : null, m.b2bNotify ? 'Geschäftsadresse gesetzt' : 'Geschäftsadresse optional')}`],
    ['Supabase: eigener Absender (SMTP)', `<a href="${SB}/auth/smtp" target="_blank" rel="noopener">Supabase → Authentication → Emails → SMTP Settings</a> → „Enable custom SMTP“. Sender email <code>noreply@leaserun.com</code>, Sender name <code>LeaseRun</code>, Host <code>smtp.resend.com</code>, Port <code>465</code>, Username <code>resend</code>, Password = Resend-API-Schlüssel. Ersetzt den Absender „Supabase Auth“ in allen übrigen Konto-E-Mails.`, st(null, 'manuell – mit Test 2 prüfen')],
    ['Supabase: LeaseRun-Vorlagen', `<a href="${SB}/auth/templates" target="_blank" rel="noopener">Supabase → Authentication → Emails → Templates</a>: je Vorlage Betreff und HTML aus der Liste unten einfügen.`, st(null, 'manuell')],
    ['Supabase: Adressen', `<a href="${SB}/auth/url-configuration" target="_blank" rel="noopener">URL Configuration</a>: Site URL <code>https://leaserun.com</code>; Redirect URLs <code>https://leaserun.com/auth/login</code>, <code>/auth/reset</code>, <code>/auth/callback</code>, <code>/auth/confirm</code>, <code>/business-portal</code>.`, st(null, 'manuell')],
  ];
  // Versand eingerichtet: LeaseRun verschickt alle Konto-E-Mails selbst (Resend). Die Supabase-Schritte (SMTP, Vorlagen,
  // Adressen) waren nur der Rückfall ohne eigenen Versand – sie und die Vorlagenliste entfallen dann ganz.
  if (m.ready) steps.length = 0;
  return `<section class="pt-card wa-mailsetup" id="mailSetup"><h2>E-Mail-Versand (Absender „LeaseRun“)</h2>
    <p class="form-note">${m.ready ? `Eigener Versand aktiv: <strong>${esc(m.from)}</strong>. Alle E-Mails von LeaseRun kommen im LeaseRun-Design mit Logo.` : 'Noch nicht eingerichtet – Konto-E-Mails kommen übergangsweise vom Absender „Supabase Auth“, andere E-Mails (Nachweise, Rechnungen, Kündigungen) werden nicht gesendet.'}</p>
    ${steps.length ? '' : ''}<ol class="wa-steps">${steps.map(([t, b, s2]) => `<li><div class="wa-step-h"><strong>${t}</strong><span class="wa-step-st">${s2}</span></div><p>${b}</p></li>`).join('')}</ol>
    <h3 class="wa-sub">Testen</h3>
    <div class="pt-row"><button class="btn btn-dark" id="sysMail" type="button">Test 1: LeaseRun-E-Mail an mich</button><button class="btn btn-outline" id="sysAllMail" type="button">Test 2: Alle E-Mails an mich</button>${m.ready ? '' : '<button class="btn btn-outline" id="sysAuthMail" type="button">Konto-E-Mail über Supabase an mich</button>'}</div>
    <p class="form-note">Test 1 prüft Versand und Absender. Test 2 schickt jede E-Mail, die LeaseRun verschicken kann (Privatkunden, Unternehmen, Creator und Benachrichtigungen an Sie), einmal mit Beispieldaten an Ihre Admin-Adresse. Betreff beginnt mit „[Test 1/…]“; Links darin sind Beispiele. Dauert etwa eine Minute.</p>
    ${m.ready ? '' : `<h3 class="wa-sub">Vorlagen für Supabase</h3>
    <div class="wa-wrap"><table class="wa-table wa-tpl"><thead><tr><th>Vorlage in Supabase</th><th>Betreff</th><th></th></tr></thead><tbody>
    ${(m.templates || []).map((t) => `<tr><td><strong>${esc(t.supabase)}</strong><br><small>${esc(t.label)}</small></td><td><code class="wa-subj">${esc(t.subject)}</code></td><td class="wa-tpl-act"><button type="button" class="btn btn-ghost" data-copy-subj="${esc(t.subject)}">Betreff kopieren</button><button type="button" class="btn btn-outline" data-tpl="${esc(t.id)}" data-act="copy">HTML kopieren</button></td></tr>`).join('')}
    </tbody></table></div>`}</section>`;
}
function bindMailSetup(root2) {
  const done = (t, bad = false) => msg(t, bad);
  $('#sysMail', root2).onclick = async (e) => {
    e.target.disabled = true;
    const x = await api('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'testmail' }) });
    done(x.ok ? `Test-E-Mail an ${x.data.to} gesendet – bitte Posteingang (und Spam) prüfen.` : x.data?.error || 'Fehler', !x.ok); e.target.disabled = false;
  };
  if ($('#sysAuthMail', root2)) $('#sysAuthMail', root2).onclick = async (e) => {
    if (!confirm('Passwort-Link über Supabase an Ihre Admin-Adresse senden? Ihr Passwort bleibt unverändert, solange Sie den Link nicht verwenden.')) return;
    e.target.disabled = true;
    const x = await api('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'testauth' }) });
    done(x.ok ? `Konto-E-Mail an ${x.data.to} angestoßen – Absender und Design prüfen.` : x.data?.error || 'Fehler', !x.ok); e.target.disabled = false;
  };
  $('#sysAllMail', root2).onclick = async (e) => {
    if (!confirm('Alle E-Mail-Vorlagen (rund 60 E-Mails) als Test an Ihre Admin-Adresse senden?')) return;
    const b = e.target, label = b.textContent; b.disabled = true;
    let from = 0, sent = 0, total = 0, to = ''; const failed = [];
    try {
      while (from !== null) {
        b.textContent = total ? `Sende … ${from}/${total}` : 'Sende …';
        const x = await api('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'testall', from }) });
        if (!x.ok) { done(x.data?.error || 'Fehler beim Senden', true); break; }
        ({ total, to } = x.data); sent += x.data.sent; failed.push(...(x.data.failed || [])); from = x.data.next;
        if (from === null) done(`${sent} von ${total} Test-E-Mails an ${to} gesendet${failed.length ? ` – nicht gesendet: ${failed.join(', ')}` : ''}. Bitte Posteingang (und Spam) prüfen.`, failed.length > 0);
      }
    } finally { b.disabled = false; b.textContent = label; }
  };
  const copy = async (text, b) => {
    try { await navigator.clipboard.writeText(text); const o = b.textContent; b.textContent = 'Kopiert ✓'; setTimeout(() => { b.textContent = o; }, 1600); }
    catch { done('Kopieren nicht möglich – bitte „Herunterladen“ verwenden.', true); }
  };
  root2.querySelectorAll('[data-copy-subj]').forEach((b) => b.onclick = () => copy(b.dataset.copySubj, b));
  root2.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = async () => {
    const path = '/api/admin/system?template=' + encodeURIComponent(b.dataset.tpl);
    if (b.dataset.act === 'dl') { try { await download(path, {}, `leaserun-${b.dataset.tpl}.html`); } catch (e) { done(e.message, true); } return; }
    const r = await api(path);
    if (!r.ok) { done('Vorlage nicht verfügbar.', true); return; }
    copy(await r.res.text(), b);
  });
}

// ---------- Unternehmenskonto anlegen (Zugang mit Startpasswort) ----------
const TYPES = [['BROKER', 'Finanzierungsvermittler (§ 34i GewO)'], ['REALTOR', 'Immobilienmakler (§ 34c GewO)'], ['ADVISOR', 'Finanz- & Vermögensberater (§ 34d/f/h GewO)'], ['BANK', 'Kreditinstitut'], ['OTHER', 'Sonstiges Unternehmen']];
// Nachweis einer Kontoanfrage öffnen (signierter Link, 5 Minuten gültig).
async function openProof(id) {
  const w = window.open('', '_blank', 'noopener');
  const r = await api('/api/admin/misc?proof=' + encodeURIComponent(id));
  if (r.ok && r.data.url) { if (w) w.location.href = r.data.url; else location.href = r.data.url; } else { w?.close(); msg(r.data?.error || 'Nachweis nicht verfügbar.', true); }
}

// Privatkonto (B2C) mit Startpasswort anlegen.
function openCreatePrivate(done) {
  let d = document.getElementById('mkPDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'mkPDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<form class="wa-dlg-in" id="mkPF"><div class="wa-dlg-h"><h2>Privatkonto anlegen (B2C)</h2><button type="button" class="stage-x" id="mkPX" aria-label="Schließen">×</button></div>
    <p class="form-note">Für Privatkunden, z. B. nach telefonischer Beratung. Passwort selbst festlegen oder automatisch erzeugen lassen. Zugriff optional sofort freischalten.</p>
    <div class="wa-grid2"><label>Name*<input name="name" required minlength="2" maxlength="120"></label><label>E-Mail (Benutzername)*<input name="email" type="email" required></label></div>
    <fieldset class="wa-fs"><legend>Passwort</legend><label class="wa-pw">Passwort<input name="password" type="text" autocomplete="new-password" minlength="10" maxlength="72" spellcheck="false" placeholder="mind. 10 Zeichen, Buchstaben + Ziffer"></label>
      <span class="wa-hint">Leer lassen, um ein sicheres Passwort automatisch zu erzeugen.</span>
      <label class="chk"><input type="checkbox" name="mustChange" checked> <span>Bei der ersten Anmeldung muss ein eigenes Passwort festgelegt werden</span></label></fieldset>
    <fieldset class="wa-fs"><legend>Zugriff</legend><div class="wa-grid2"><label>Tarif<select name="tier"><option value="free">Kostenlos (3 Basis-Tools)</option><option value="starter">Käufer-Pass – alle Kauf-Werkzeuge</option><option value="pro">Investor Pro – alle Werkzeuge</option></select></label>
      <label>Gültig bis (leer = unbefristet)<input name="validUntil" type="date"></label>
      <label>Kreditmappen (Anzahl)<input name="creditMaps" type="number" min="0" max="1000" value="0" inputmode="numeric"></label>
      </div><label class="chk"><input type="checkbox" name="leitfaden"> <span>Leitfaden freischalten</span></label></fieldset>
    <label class="chk"><input type="checkbox" name="sendMail"> Zugangsdaten zusätzlich per E-Mail senden</label>
    <p class="auth-message error" id="mkPMsg" hidden></p><div id="mkPOut"></div>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" id="mkPCancel">Abbrechen</button><button type="submit" class="btn btn-dark">Konto anlegen</button></div></form>`;
  const close = () => d.close();
  d.querySelector('#mkPX').onclick = close; d.querySelector('#mkPCancel').onclick = close;
  d.querySelector('#mkPF').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target)), btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const x = await api('/api/admin/user-create', { method: 'POST', body: JSON.stringify({ name: fd.name, email: fd.email, sendMail: fd.sendMail === 'on', password: fd.password || null, mustChange: fd.mustChange === 'on', access: { tier: fd.tier, creditMaps: Number(fd.creditMaps) || 0, leitfaden: fd.leitfaden === 'on', validUntil: fd.validUntil || null } }) });
    btn.disabled = false;
    const m = d.querySelector('#mkPMsg');
    if (!x.ok) { m.textContent = x.data?.error || 'Anlegen fehlgeschlagen.'; m.hidden = false; return; }
    m.hidden = true;
    const txt = `Anmeldung: https://leaserun.com/auth/login\nBenutzername: ${x.data.email}\nPasswort: ${x.data.password}${x.data.access && x.data.access !== 'free' ? `\nZugriff: ${x.data.access === 'pro' ? 'Investor Pro' : 'Käufer-Pass'}` : ''}`;
    d.querySelector('#mkPOut').innerHTML = `<div class="pt-alert ok"><strong>Privatkonto angelegt${x.data.mailed ? ' und Zugangsdaten per E-Mail gesendet' : ''}.</strong> Diese Daten werden nur jetzt angezeigt:<pre class="pt-code">${esc(txt)}</pre><button type="button" class="btn btn-outline" id="mkPCopy">Zugangsdaten kopieren</button></div>`;
    d.querySelector('#mkPCopy').onclick = async (ev) => { try { await navigator.clipboard.writeText(txt); ev.target.textContent = 'Kopiert ✓'; } catch { msg('Bitte markieren und kopieren.', true); } };
    e.target.querySelector('.wiz-nav').innerHTML = '<span></span><button type="button" class="btn btn-dark" id="mkPFin">Fertig</button>';
    d.querySelector('#mkPFin').onclick = () => { close(); done?.(); };
    e.target.querySelectorAll('input,select').forEach((i) => { i.disabled = true; });
  };
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}

function openCreateAccount(c, done) {
  let d = document.getElementById('mkDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'mkDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const f = (n, l, val = '', extra = '') => `<label>${l}<input name="${n}" value="${esc(val || '')}" ${extra}></label>`;
  d.innerHTML = `<form class="wa-dlg-in" id="mkF"><div class="wa-dlg-h"><h2>Unternehmen anlegen (B2B)</h2><button type="button" class="stage-x" id="mkX" aria-label="Schließen">×</button></div>
    <p class="form-note">Passwort selbst festlegen oder automatisch erzeugen lassen. Bei der ersten Anmeldung bestätigt der Inhaber § 14 BGB und den AVV.</p>
    <div class="wa-grid2">${f('companyName', 'Firmenname*', c?.company, 'required minlength="2"')}${f('legalForm', 'Rechtsform*', c?.legal_form, 'required placeholder="GmbH, e. K., …"')}
      <label>Art*<select name="institutionType">${TYPES.map(([k, l]) => `<option value="${k}"${c?.institution_type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${f('advisorName', 'Ansprechpartner*', c?.name, 'required minlength="2"')}${f('email', 'E-Mail (Benutzername)*', c?.email, 'type="email" required')}${f('phone', 'Telefon', c?.phone)}
      ${f('street', 'Straße und Hausnummer*', '', 'required')}${f('postalCode', 'PLZ*', '', 'required pattern="[0-9]{5}" inputmode="numeric"')}${f('city', 'Ort*', c?.city, 'required')}
      ${f('registerNumber', 'Handelsregister- oder Vermittlerregister-Nr.', c?.register_number, 'placeholder="HRB … / D-…"')}${f('taxId', 'USt-IdNr. / Steuernummer', c?.tax_id)}</div>
    <p class="form-note">Register-Nr. oder USt-IdNr./Steuernummer: eines von beiden ist Pflicht.</p>
    ${c?.proof_name ? `<p class="pt-alert">Nachweis aus der Anfrage: <strong>${esc(c.proof_name)}</strong> <button type="button" class="text-btn" data-proof="${c.id}">ansehen</button> – wird beim Anlegen in die Verifizierungsunterlagen des Kontos übernommen.</p>` : ''}
<fieldset class="wa-fs"><legend>Passwort</legend><label class="wa-pw">Passwort<input name="password" type="text" autocomplete="new-password" minlength="10" maxlength="72" spellcheck="false" placeholder="mind. 10 Zeichen, Buchstaben + Ziffer"></label>
      <span class="wa-hint">Leer lassen, um ein sicheres Passwort automatisch zu erzeugen.</span>
      <label class="chk"><input type="checkbox" name="mustChange" checked> <span>Bei der ersten Anmeldung muss ein eigenes Passwort festgelegt werden</span></label></fieldset>
    <fieldset class="wa-fs"><legend>Zugriff</legend><div class="wa-grid2"><label>Tarif<select name="plan"><option value="">ohne Tarif (bucht selbst)</option><option value="BASIC">Basic</option><option value="PRO">Pro</option><option value="ENTERPRISE">Enterprise</option></select></label>
      <label>Tarif gültig bis (leer = unbefristet)<input name="planUntil" type="date"></label></div>
      <p class="form-note" style="margin:8px 0 6px">Module</p><div class="wa-grid3"><label>Schnellrechner<select name="mod_schnellrechner"><option value="auto">nach Tarif</option><option value="on">an</option><option value="off">aus</option></select></label><label>Kreditmappe<select name="mod_kreditmappe"><option value="auto">nach Tarif</option><option value="on">an</option><option value="off">aus</option></select></label><label>Stresstest<select name="mod_stresstest"><option value="auto">nach Tarif</option><option value="on">an</option><option value="off">aus</option></select></label><label>White-Label<select name="mod_whitelabel"><option value="auto">nach Tarif</option><option value="on">an</option><option value="off">aus</option></select></label><label>CRM<select name="mod_crm"><option value="auto">nach Tarif</option><option value="on">an</option><option value="off">aus</option></select></label></div></fieldset>
    <label class="chk"><input type="checkbox" name="verified"> Unternehmen bereits geprüft – sofort freischalten</label>
    <label class="chk"><input type="checkbox" name="sendMail"> Zugangsdaten zusätzlich per E-Mail senden</label>
    <p class="auth-message error" id="mkMsg" hidden></p><div id="mkOut"></div>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" id="mkCancel">Abbrechen</button><button type="submit" class="btn btn-dark">Konto anlegen</button></div></form>`;
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
    if (!x.ok) { m.textContent = x.data?.error || 'Anlegen fehlgeschlagen.'; m.hidden = false; return; }
    m.hidden = true;
    const txt = `Portal: https://partner.leaserun.com\nBenutzername: ${x.data.email}\nPasswort: ${x.data.password}`;
    d.querySelector('#mkOut').innerHTML = `<div class="pt-alert ok"><strong>Konto angelegt (Kundennummer ${esc(String(x.data.customerNumber))})${x.data.mailed ? ' und Zugangsdaten per E-Mail gesendet' : ''}.</strong> Diese Daten werden nur jetzt angezeigt:<pre class="pt-code">${esc(txt)}</pre><button type="button" class="btn btn-outline" id="mkCopy">Zugangsdaten kopieren</button></div>`;
    d.querySelector('#mkCopy').onclick = async (ev) => { try { await navigator.clipboard.writeText(txt); ev.target.textContent = 'Kopiert ✓'; } catch { msg('Bitte markieren und kopieren.', true); } };
    e.target.querySelector('.wiz-nav').innerHTML = '<span></span><button type="button" class="btn btn-dark" id="mkFin">Fertig</button>';
    d.querySelector('#mkFin').onclick = () => { close(); done?.(); };
    e.target.querySelectorAll('input,select').forEach((i) => { i.disabled = true; });
  };
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

// ---------- System: Einrichtung, Test-E-Mail, Nutzer-Suche ----------
async function system(v, focusMail = false) {
  const r = await api('/api/admin/system');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const c = r.data.checks, need = c.filter((x) => !x.ok && !x.optional);
  v.innerHTML = `<div id="sysFiles"></div><h2>Einrichtung</h2>
    <p class="form-note">${need.length ? `<strong>${need.length} Punkt(e) offen.</strong> Die Werte werden in Vercel unter Settings → Environment Variables eingetragen (nie per Chat oder E-Mail weitergeben), danach neu deployen.` : 'Alle Pflichtpunkte eingerichtet.'} Umgebung: ${esc(r.data.env)}${r.data.commit ? ` · Version ${esc(r.data.commit)}` : ''}</p>
    <div class="wa-wrap"><table class="wa-table"><thead><tr><th></th><th>Bereich</th><th>Stand</th><th>Was tun?</th></tr></thead><tbody>
    ${c.filter((x) => !x.ok).map((x) => `<tr><td><span class="wa-amp ${x.ok ? 'gruen' : x.optional ? 'gelb' : 'rot'}"></span></td><td>${esc(x.label)}${x.optional ? ' <small>(optional)</small>' : ''}</td><td>${x.ok ? 'eingerichtet' : 'fehlt'}${x.info ? ` · ${esc(x.info)}` : ''}</td><td><small>${x.ok ? '–' : esc(x.fix)}</small></td></tr>`).join('')}
    </tbody></table></div>
    <p class="form-note">${c.filter((x) => x.ok).length} Punkte sind eingerichtet und ausgeblendet. Die vollständige Liste mit Anleitung steht im Reiter <a href="#einrichtung">Einrichtung</a>.</p>
    <section class="pt-card tk-switch" id="tkSwitch"><h2>Testkauf</h2><p class="form-note">Wird geladen …</p></section>
    ${mailSetup(r.data.mail || {})}
    <h2>Nutzer suchen</h2><p class="form-note">Zeigt nur Kennzahlen (Anmeldung, Anzahl Objekte, Dokumente, Kreditmappen) – keine Inhalte. Jede Suche wird protokolliert.</p>
    <div class="pt-row"><input id="sysQ" type="email" placeholder="E-Mail-Adresse" style="flex:1;min-width:220px;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px"><button class="btn btn-dark" id="sysFind" type="button">Suchen</button></div>
    <div id="sysUser"></div>`;
  bindMailSetup(v);
  // Dateien senden & abholen (OneDrive im Hintergrund)
  import('./intern-cloud.mjs?v=892f3666').then((m) => m.cloudCard(v.querySelector('#sysFiles'), { goTab, msg })).catch(() => {});
  testSwitch($('#tkSwitch'));
  if (focusMail) requestAnimationFrame(() => $('#mailSetup')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  const find = async () => {
    const q = $('#sysQ').value.trim(); if (!q) return;
    const x = await api('/api/admin/system?user=' + encodeURIComponent(q));
    const box = $('#sysUser');
    if (!x.ok) { box.innerHTML = `<p class="form-note">${esc(x.data?.error)}</p>`; return; }
    if (!x.data.found) { box.innerHTML = '<p class="form-note">Kein Konto mit dieser E-Mail-Adresse.</p>'; return; }
    const u = x.data.user;
    box.innerHTML = `<dl class="pt-dl">${[['Konto seit', dtt(u.createdAt)], ['Zuletzt angemeldet', dtt(u.lastSignIn)], ['E-Mail bestätigt', u.confirmed ? 'ja' : 'nein'], ['Zweiter Faktor', u.mfa ? 'ja' : 'nein'], ['Modus / Phase', `${u.mode || '–'} / ${u.phase == null ? 'automatisch' : u.phase + 1}`], ['Objekte', u.objects], ['Dokumente', u.documents], ['Kreditmappen', u.kreditmappen], ['Unternehmenskonto', u.b2b ? (u.b2b.role === 'owner' ? 'Inhaber' : 'Berater') : 'nein'], ['Zuletzt gespeichert', dtt(u.updatedAt)]].map(([k, val]) => `<div><dt>${k}</dt><dd>${esc(String(val))}</dd></div>`).join('')}</dl>`;
  };
  $('#sysFind').onclick = find;
  $('#sysQ').onkeydown = (e) => { if (e.key === 'Enter') find(); };
}


// Testkauf-Schalter: An = Ihre eigenen Käufe (als Administrator) laufen im Stripe-Testmodus mit Testkarte; Kunden kaufen immer echt.
async function testSwitch(box) {
  if (!box) return;
  const r = await api('/api/admin/testkauf');
  if (!r.ok) { box.innerHTML = `<h2>Testkauf</h2><p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  const d = r.data;
  box.innerHTML = `<div class="tk-sw-h"><div><h2>Testkauf jetzt möglich</h2><p class="form-note">${d.on ? '<span class="st ok">An</span> Ihre Käufe als Administrator laufen über den Stripe-Testmodus: auf der Bezahlseite Testkarte <code>4242 4242 4242 4242</code>, ein Datum in der Zukunft und eine beliebige Prüfziffer eingeben. Es fließt kein Geld und es wird nichts freigeschaltet.' : '<span class="st">Aus</span> Alles läuft live: Stripe prüft Karte, Adresse und Zahlung wie bei jedem Kunden.'} Kunden kaufen immer echt – der Schalter gilt nur für Administratoren.</p>${d.at ? `<p class="form-note">Zuletzt ${d.on ? 'eingeschaltet' : 'ausgeschaltet'} ${dtt(d.at)} von ${esc(d.by || '')}</p>` : ''}${d.available ? '' : '<p class="pt-alert warn">Für den Testmodus fehlt in Vercel der Stripe-Testschlüssel (STRIPE_TEST_SECRET_KEY = sk_test_…).</p>'}</div>
    <label class="tk-toggle"><input type="checkbox" id="tkOn"${d.on ? ' checked' : ''}${d.available ? '' : ' disabled'}><span aria-hidden="true"></span><b class="sr-only">Testkauf an oder aus</b></label></div>`;
  box.querySelector('#tkOn')?.addEventListener('change', async (e) => {
    const on = e.target.checked; e.target.disabled = true;
    const x = await api('/api/admin/testkauf', { method: 'POST', body: JSON.stringify({ on }) });
    if (!x.ok) { msg(x.data?.error || 'Speichern fehlgeschlagen.', true); e.target.checked = !on; e.target.disabled = false; return; }
    msg(on ? 'Testkauf ist an – Ihre Käufe laufen im Testmodus.' : 'Testkauf ist aus – alles läuft live.');
    testSwitch(box);
  });
}

// ---------- Finanz-Cockpit ----------
// Finanz-Cockpit: Zeitraum-Leiste bleibt stehen; nur die Ergebnisse werden (weich) ausgetauscht. Ergebnisse je Zeitraum zwischengespeichert.
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
// Abrechnungsstand je aktivem Abo/Unternehmenskonto: zeigt, ob zu jedem laufenden Vertrag abgerechnet und bezahlt wurde.
const ABR_ST = { 'bezahlt': 'ok', 'offen': 'warn', 'überfällig': 'bad', 'Testphase': '', '100-%-Rabatt': '', 'ohne Rechnung': 'bad' };
function abrTable(b) {
  if (!b) return '';
  const rows = b.zeilen || [];
  return `<h2>Abrechnungsstand je Abo und Unternehmenskonto</h2>${(b.fehler || []).length ? `<p class="pt-alert">${b.fehler.map(esc).join(' ')}</p>` : ''}${rows.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Kunde/Konto</th><th>Tarif</th><th>Intervall</th><th>Preis brutto</th><th>Letzte Zahlung</th><th>Nächste Abrechnung</th><th>Offen</th><th>Älteste offene Rechnung</th><th>Status</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.kunde)}${x.quelle === 'rechnung' ? ' <span class="form-note">· auf Rechnung</span>' : ''}</td><td>${esc(x.tarif)}</td><td>${esc(x.intervall)}</td><td>${eur(x.preisBrutto)}</td><td>${x.letzteZahlung ? `${dt(x.letzteZahlung.datum)} · ${eur(x.letzteZahlung.betrag)}` : '–'}</td><td>${x.naechsteAbrechnung ? dt(x.naechsteAbrechnung) : '–'}</td><td>${x.offen ? eur(x.offen) : '–'}</td><td>${x.aeltesteOffene ? `${esc(x.aeltesteOffene.nummer)}${x.aeltesteOffene.faellig ? ` · fällig ${dt(x.aeltesteOffene.faellig)}` : ''}` : '–'}</td><td><span class="st ${ABR_ST[x.status] ?? ''}">${esc(x.status)}</span>${x.hinweis ? `<span class="form-note"> ${esc(x.hinweis)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Kein aktives Abo und kein aktives Unternehmenskonto.</p>'}
    <p class="form-note">Quelle: Stripe-Abos (aktiv, Testphase, Zahlung überfällig) und Rechnungsarchiv. „Ohne Rechnung“: monatlich keine Rechnung in den letzten 35 Tagen bzw. keine Rechnung seit Vertragsbeginn. Nur Anzeige, nichts wird geändert.</p>`;
}
function ckResultsB2C(d) {
  const tile = (l, x, s = '') => `<div class="pt-kpi"><small>${l}</small><strong>${x}</strong>${s ? `<span class="form-note">${s}</span>` : ''}</div>`;
  const P = d.byPlan || {}, pl = (k) => P[k] || { count: 0, gross: 0, name: k };
  return `
    <h2>${esc(d.range.label)} · Privatkunden</h2>
    ${d.billingLive ? '' : '<p class="pt-alert">Zahlungen sind noch im Testbetrieb (BILLING_ENABLED ≠ true) – Werte stammen aus dem Stripe-Testmodus.</p>'}
    <div class="pt-kpis">${tile('Umsatz brutto', eur(d.revenue.gross), `${d.revenue.count} Zahlungen${d.revenue.refunds ? ` · ${d.revenue.refunds} erstattet` : ''}`)}${tile('Umsatz netto', eur(d.revenue.net))}${tile('Umsatzsteuer 19 %', eur(d.revenue.vat))}${tile('Kreditmappen vergeben', String(d.downloads.kreditmappen), 'BankReady-PDF im Zeitraum')}</div>
    <div class="pt-kpis">${tile('BankReady Kreditmappe · 39 €', String(pl('credit-map').count), eur(pl('credit-map').gross))}${tile('Käufer-Pass · 49 €', String(pl('buyer-pass').count), eur(pl('buyer-pass').gross))}${tile('Investor Pro · 29 €/Monat', String(pl('pro-monthly').count), `${eur(pl('pro-monthly').gross)} inkl. Verlängerungen`)}${tile('Laufende Pro-Abos', String(d.recurring.activeSubs), `MRR netto ${eur(d.recurring.mrrNet)} · ARR ${eur(d.recurring.arrNet)}`)}</div>
    <h2>Netto-Umsatz der letzten 12 Monate</h2>${monthsChart(d.months || [])}
    ${abrTable(d.billing)}
    <h2>Zahlungen im Zeitraum</h2>${(d.payments || []).length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Datum</th><th>Tarif</th><th>Art</th><th>Brutto</th><th>Netto</th><th>Status</th></tr></thead><tbody>${d.payments.map((x) => `<tr><td>${dt(x.date)}</td><td>${esc(x.planName)}</td><td>${x.kind === 'kauf' ? 'Kauf' : 'Abo-Verlängerung'}</td><td>${eur(x.gross)}</td><td>${eur(x.net)}</td><td>${x.refunded ? '<span class="st warn">erstattet</span>' : '<span class="st ok">bezahlt</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine Zahlungen im Zeitraum.</p>'}
    <p class="form-note">Quelle: Stripe (nur Privattarife, ohne Unternehmen und Testkäufe). Belege für Privatkunden erstellt Stripe; Export für die Kanzlei: Stripe → Berichte.</p>`;
}
function ckResults(d) {
  if (d.scope === 'b2c') return ckResultsB2C(d);
  const tile = (l, x, s = '') => `<div class="pt-kpi"><small>${l}</small><strong>${x}</strong>${s ? `<span class="form-note">${s}</span>` : ''}</div>`;
  return `
    <h2>${esc(d.range.label)} · Unternehmen</h2>
    <div class="pt-kpis">${tile('Umsatz netto', eur(d.revenue.net), `${d.revenue.count} Rechnungen${d.revenue.stornos ? `, ${d.revenue.stornos} Korrekturen` : ''}`)}${tile('Umsatzsteuer 19 %', eur(d.revenue.vat))}${tile('Umsatz brutto', eur(d.revenue.gross))}${tile('Offene Posten', String(d.openItems.length), eur(d.openItems.reduce((s, x) => s + Number(x.gross_cents), 0)))}</div>
    <div class="pt-kpis">${tile('MRR netto', eur(d.recurring.mrrNet), 'Preise je Branche laut B2B-Katalog')}${tile('ARR netto', eur(d.recurring.arrNet))}${tile('Aktive Tarife', String(d.recurring.activeAccounts), `Basic ${d.recurring.byTier.BASIC} · Pro ${d.recurring.byTier.PRO} · Enterprise ${d.recurring.byTier.ENTERPRISE}${d.recurring.manualWithoutPrice ? ` · ${d.recurring.manualWithoutPrice} manuell` : ''}`)}${tile('Abgelaufen im Zeitraum', String(d.recurring.expiredInRange))}</div>
    <h2>Netto-Umsatz der letzten 12 Monate</h2>${monthsChart(d.months || [])}
    <h2>Weiterempfehlung über Kreditmappen</h2>
    <div class="pt-kpis">${tile('Kreditmappen von Unternehmen', String(d.viral.partnerDossiers))}${tile('Aufrufe der Prüfseite', String(d.viral.verifyViews))}${tile('Neue Unternehmenskonten', String(d.viral.newAccounts), `davon über Prüfseite: ${d.viral.viaVerify}`)}${tile('Endkunden-Anfragen', String(d.viral.leads))}</div>
    ${abrTable(d.billing)}
    <h2>Offene Posten</h2>${d.openItems.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Ampel</th><th>Nummer</th><th>Kunde</th><th>Fällig</th><th>Brutto</th><th></th></tr></thead><tbody>
      ${d.openItems.map((x) => `<tr><td><span class="wa-amp ${x.ampel}"></span>${x.daysOverdue > 0 ? `${x.daysOverdue} Tage` : 'fristgerecht'}</td><td>${esc(x.invoice_number)}</td><td>${esc(x.buyer?.company)}</td><td>${dt(x.due_date)}</td><td>${eur(x.gross_cents)}</td><td class="wa-actions"><button data-paid="${x.id}" type="button">Als bezahlt markieren</button><button data-remind="${x.id}" type="button">Zahlungserinnerung senden</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine offenen Posten.</p>'}
    <h2>Rechnungen im Zeitraum</h2>${invTable(d.invoices)}`;
}
async function cockpit(v, zeitraum = 'heute', von = '', bis = '') {
  const today = isoD(new Date());
  // Rahmen nur einmal aufbauen
  if (!v.querySelector('#ckRes')) {
    const [dv, db] = rangeOf(zeitraum);
    v.innerHTML = `<div class="wa-period"><div class="seg" role="tablist" aria-label="Zeitraum">${[['heute', 'Heute'], ['woche', 'Woche'], ['monat', 'Monat'], ['jahr', 'Jahr'], ['gesamt', 'Gesamt']].map(([k, l]) => `<button type="button" role="tab" data-z="${k}" aria-selected="${k === zeitraum}">${l}</button>`).join('')}</div>
      <div class="wa-range"><label>Von<span class="de-date"><span class="de-txt" data-for="zv"></span><input type="date" id="zv" value="${esc(von || dv)}" max="${today}"></span></label><label>Bis<span class="de-date"><span class="de-txt" data-for="zb"></span><input type="date" id="zb" value="${esc(bis || db)}" max="${today}"></span></label><button class="btn btn-outline" id="zf" type="button">Eigener Zeitraum</button></div></div>
      <div id="ckRes" class="ck-res" aria-live="polite"><p class="lr-ld" role="status">Wird geladen …</p></div>`;
    v.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => {
      v.querySelectorAll('[data-z]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      const [a1, b1] = rangeOf(b.dataset.z); $('#zv').value = a1; $('#zb').value = b1; v.__deTxt?.();
      ckLoad(v, b.dataset.z, '', '');
    });
    // Deutsche Datumsanzeige über dem nativen Feld (iPhone zeigt sonst die Gerätesprache).
    const deTxt = () => v.querySelectorAll('.de-txt').forEach((t) => { const val = $('#' + t.dataset.for).value; t.textContent = val ? new Date(val + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'seit Beginn'; });
    ['#zv', '#zb'].forEach((id) => $(id).addEventListener('change', deTxt)); deTxt(); v.__deTxt = deTxt;
    $('#zf').onclick = () => { v.querySelectorAll('[data-z]').forEach((x) => x.setAttribute('aria-selected', 'false')); ckLoad(v, 'frei', $('#zv').value, $('#zb').value); };
  } else if (!von && !bis) {
    // Erneut geöffnet: Leiste wieder auf den gewünschten Zeitraum (Standard: heute) stellen.
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
  if (my !== ckSeq) return; // veraltete Antwort (inzwischen anderer Zeitraum gewählt)
  if (!r.ok) { box.classList.remove('ck-busy'); box.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  CK_CACHE.set(key, r.data);
  paint(r.data);
}

// Einfache Balken mit Wertbeschriftung; Monate ohne Umsatz bleiben sichtbar (0 €). Kurze Monatsnamen, Jahr nur im Januar.
function monthsChart(months) {
  const max = Math.max(1, ...months.map((x) => x.net));
  const empty = !months.some((x) => x.net > 0);
  const mon = (m) => new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(m + '-01T12:00:00Z')).replace('.', '').slice(0, 3);
  const yr = (m) => m.slice(2, 4);
  const full = (m) => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(m + '-01T12:00:00Z'));
  return `<div class="wa-chart">${empty ? '<p class="wa-chart-empty">Noch keine Umsätze in den letzten 12 Monaten.</p>' : ''}<div class="wa-bars" role="list">${months.map((x, i) => `<div class="wa-bar" role="listitem" aria-label="${full(x.m)}: ${eur(x.net, 0)}"><span class="wa-bar-v">${x.net ? eur(x.net, 0) : ''}</span><span class="wa-bar-f" style="height:${Math.max(x.net > 0 ? 3 : 0, Math.round((x.net / max) * 100))}%"></span><span class="wa-bar-l">${mon(x.m)}${x.m.endsWith('-01') || i === 0 ? `<em>${yr(x.m)}</em>` : ''}</span></div>`).join('')}</div></div>`;
}

const invTable = (rows) => rows.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Nummer</th><th>Art</th><th>Datum</th><th>Kunde</th><th>Netto</th><th>USt</th><th>Brutto</th><th>Status</th><th></th></tr></thead><tbody>
  ${rows.map((x) => `<tr><td>${esc(x.invoice_number)}</td><td>${{ invoice: 'Rechnung', storno: 'Storno', credit: 'Gutschrift' }[x.kind]}${x.source === 'stripe' ? ' · Stripe' : ''}</td><td>${dt(x.issue_date)}</td><td>${esc(x.buyer?.company)}</td><td>${eur(x.net_cents)}</td><td>${eur(x.vat_cents)}</td><td>${eur(x.gross_cents)}</td><td>${PAY[x.payment_status]}</td>
  <td class="wa-actions"><button data-pdf="${x.id}" type="button">PDF</button>${x.kind === 'invoice' && x.source === 'manual' && x.payment_status !== 'CANCELLED' ? `<button data-storno="${x.id}" type="button">Stornieren</button>` : ''}${['PENDING', 'OVERDUE'].includes(x.payment_status) ? `<button data-paid="${x.id}" type="button">Bezahlt</button><button data-remind="${x.id}" type="button">Erinnern</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine Rechnungen.</p>';

function bindInv(v, reload) {
  v.querySelectorAll('[data-pdf]').forEach((b) => b.onclick = async () => {
    try { const res = await download('/api/admin/invoices?id=' + b.dataset.pdf, {}, 'Rechnung.pdf'); if (res.headers.get('x-integrity') === 'mismatch') msg('Achtung: Prüfsumme des PDFs weicht ab!', true); else msg('PDF geladen, Prüfsumme in Ordnung.'); } catch (e) { msg(e.message, true); }
  });
  v.querySelectorAll('[data-storno]').forEach((b) => b.onclick = async () => {
    if (!confirm('Stornorechnung ausstellen? Die ursprüngliche Rechnung bleibt unverändert im Archiv.')) return;
    const r = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'storno', invoiceId: b.dataset.storno }) });
    if (r.ok) { msg(`Storno ${r.data.invoice.invoice_number} ausgestellt.`); reload(); } else msg(r.data?.error || 'Fehler', true);
  });
  v.querySelectorAll('[data-remind]').forEach((b) => b.onclick = async () => {
    if (!confirm('Zahlungserinnerung mit Rechnung als PDF an das Unternehmen senden?')) return;
    b.disabled = true;
    const r = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'remind', invoiceId: b.dataset.remind }) });
    b.disabled = false;
    if (r.ok) msg(`Erinnerung versendet (${r.data.stufe}. Erinnerung).`); else msg(r.data?.error || 'Fehler', true);
  });
  v.querySelectorAll('[data-paid]').forEach((b) => b.onclick = async () => {
    const r = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'paid', invoiceId: b.dataset.paid }) });
    if (r.ok) { msg('Als bezahlt markiert.'); reload(); } else msg(r.data?.error || 'Fehler', true);
  });
}

// ---------- Sicherheit ----------
async function sicherheit(v) {
  const r = await api('/api/admin/check');
  // Sicherheitsübersicht oben einblenden (lädt parallel).
  api('/api/admin/system?security=1').then((o) => {
    const x = o.data || {}; if (!o.ok) return;
    const ACT = { login: 'Anmeldung', logout: 'Abmeldung', user_signedup: 'Registrierung', user_confirmation_requested: 'Bestätigung angefordert', user_recovery_requested: 'Passwort-Reset angefordert', user_modified: 'Konto geändert', user_deleted: 'Konto gelöscht', factor_in_progress: '2FA-Einrichtung begonnen', mfa_code_login: 'Anmeldung mit 2FA-Code', verification_attempted: 'Code geprüft' };
    const box = document.createElement('section'); box.className = 'pt-card sec-ov';
    const pct = x.users ? Math.round((x.mfaUsers / x.users) * 100) : 0;
    box.innerHTML = `<h2>Sicherheitslage</h2><div class="sec-kpis">
      <div><small>Konten</small><strong>${x.users ?? '–'}</strong><span>${x.confirmed ?? 0} bestätigt</span></div>
      <div><small>Zwei-Faktor aktiv</small><strong>${x.mfaUsers ?? 0}</strong><span>${pct} % · App ${x.mfaTotp ?? 0} · SMS ${x.mfaPhone ?? 0}</span></div>
      <div><small>Aktive Sitzungen (30 T.)</small><strong>${x.activeSessions ?? 0}</strong><span>davon mit 2FA ${x.aal2Sessions ?? 0}</span></div>
      <div><small>Anmeldungen</small><strong>${x.signIns24h ?? 0}</strong><span>24 h · ${x.signIns7d ?? 0} in 7 Tagen</span></div>
      <div><small>Passwort-Resets (7 T.)</small><strong>${x.recovery7d ?? 0}</strong><span>auffällig, wenn plötzlich viele</span></div>
      <div><small>Abgewehrt (7 T.)</small><strong>${Object.values(x.blocked7d || {}).reduce((a, b) => a + Number(b || 0), 0)}</strong><span>${Object.entries(x.blocked7d || {}).map(([k, n]) => `${esc(k)} ${n}`).join(' · ') || 'keine'}</span></div>
    </div>
    <h3>Letzte Konto-Ereignisse</h3>${(x.events || []).length ? `<table class="bill-table"><thead><tr><th>Zeit</th><th>Ereignis</th><th>Konto</th><th>IP</th></tr></thead><tbody>${x.events.map((e) => `<tr><td>${dtt(e.at)}</td><td>${esc(ACT[e.action] || e.action)}</td><td>${esc(e.who)}</td><td>${esc(e.ip || '–')}</td></tr>`).join('')}</tbody></table>` : '<p class="form-note">Noch keine Ereignisse protokolliert.</p>'}
    <p class="form-note">E-Mail-Adressen und IP-Adressen werden gekürzt angezeigt. Empfehlung: Zwei-Faktor-Schutz für alle Administratoren und Unternehmenskonten.</p>`;
    const inc = v.querySelector('#secInc'); if (inc) inc.after(box); else v.prepend(box);
  }).catch(() => {});
  const p = r.data?.panic || { active: false };
  const lv = p.active ? (p.level === 1 ? 1 : 2) : 0;
  v.innerHTML = `<section class="pt-card"><h2>Not-Aus</h2>
    ${lv ? `<div class="pt-alert bad"><strong>Stufe ${lv} aktiv seit ${dtt(p.since)}</strong> (${esc(p.by || '')}${p.reason ? ': ' + esc(p.reason) : ''}). ${lv === 1 ? 'Keine Neuanmeldungen, Käufe, Anfragen und B2B-Schnittstellen; angemeldete Nutzer können nur lesen.' : `Alle Nutzer außer Administratoren sind abgewiesen${p.revoked != null ? ` (${p.revoked} Sitzungen beendet)` : ''}; täglicher Lauf pausiert.`}</div>
      <div class="panic-act">${lv === 1 ? '<button class="btn btn-dark panic-2" id="p2" type="button">Auf Stufe 2 verschärfen</button>' : ''}<button class="btn btn-dark" id="pOff" type="button">Not-Aus beenden</button></div>`
      : `<div class="panic-grid"><div class="panic-card"><strong>Stufe 1 · Soft Lock</strong><p>Neuanmeldungen, Käufe, Anfragen, Partnerseiten, Widget und B2B-Schnittstellen aus. Angemeldete Nutzer können weiter lesen, aber nichts ändern. Admins arbeiten normal.</p><button class="btn btn-dark panic-1" id="p1" type="button">Stufe 1 auslösen</button></div>
        <div class="panic-card hard"><strong>Stufe 2 · Hard Lock</strong><p>Zusätzlich: alle Sitzungen außer Admins werden beendet, alle Schnittstellen weisen Nicht-Admins ab, der tägliche Lauf pausiert.</p><button class="btn btn-dark panic-2" id="p2" type="button">Stufe 2 auslösen</button></div></div>`}
    <p class="form-note">Wirkt binnen 15 Sekunden überall. Beim Auslösen erhalten Sie eine Mitteilung in der LeaseRun-App. Für einen vollständigen Schlüsseltausch zusätzlich in Supabase den JWT-Schlüssel rotieren.</p></section>
    <section class="pt-card"><h2>Zugangsschutz Admin</h2><ul class="plain-list">
      <li>Zweiter Faktor: ${r.data?.mfaRequired ? '<span class="st ok">Pflicht</span>' : '<span class="st bad">abgeschaltet (ADMIN_MFA=off)</span>'}</li>
      <li>Keine IP-Sperre für den Admin: Sie können von überall (auch mobil) zugreifen. Schutz durch Anmeldung, Admin-Liste, Zwei-Faktor, Zeitlimit und Not-Aus.</li>
      <li>Anmeldeversuche: Supabase begrenzt fehlgeschlagene Anmeldungen; zusätzlich sperrt LeaseRun eine Quelle automatisch für 24 Stunden nach 10 Fehlversuchen in 15 Minuten (ebenso bei wiederholten Admin-Zugriffsversuchen; Scanner für 7 Tage).</li>
      <li>Alle Admin-Aktionen stehen im Reiter Protokoll.</li></ul></section>
    <section class="pt-card"><h2>Sicherheitsprotokoll</h2><p class="form-note">Gedrosselte Zugriffe (zu viele Anfragen je Nutzer oder IP) und abgewiesene Zugriffe auf den Admin-Bereich. Gespeichert werden nur Bereich und ein gekürzter Hash, keine IP-Adressen; Löschung nach 30 Tagen. Die Zählung erfolgt je Serverinstanz, Spitzen können sich verteilen.</p><div id="secLog"><p class="lr-ld" role="status">Wird geladen …</p></div><button class="btn btn-ghost" id="secRe" type="button">Aktualisieren</button></section>`;
  // Vorfälle: Angriffe und Bot-Wellen der letzten 7 Tage mit Sperren / Erledigt.
  v.insertAdjacentHTML('afterbegin', '<section class="pt-card sec-inc" id="secInc"><p class="lr-ld" role="status">Vorfälle werden geladen …</p></section>');
  // Oben: Sicherheits-Check (prüft beim Öffnen, „Alles erledigen“). Not-Aus bleibt sichtbar; Vorfälle, Protokolle und
  // Einstellungen liegen eingeklappt darunter – alle Infos bleiben erreichbar.
  {
    const det = document.createElement('details'); det.className = 'sec-more';
    det.innerHTML = '<summary>Vorfälle, Protokolle und Einstellungen</summary>';
    [...v.children].filter((el) => !el.querySelector('#p1, #p2, #pOff')).forEach((el) => det.append(el));
    v.append(det);
    const top = document.createElement('div'); v.prepend(top);
    top.innerHTML = '<section class="pt-card ck-ref"><div><h2>Prüfen &amp; erledigen</h2><p class="form-note">Alle Prüfungen (Sicherheit, E-Mail, Technik, Betrieb) und der Knopf „Alles erledigen“ liegen gesammelt im Headquarters.</p></div><button type="button" class="btn btn-dark" data-tohq>Zum Headquarters</button></section>';
    top.querySelector('[data-tohq]').onclick = () => goTab('hq');
  }
  const loadInc = async () => {
    const box = $('#secInc'); const x = await api('/api/admin/sec');
    if (!x.ok) { box.innerHTML = `<p class="form-note">${esc(x.data?.error || 'Nicht verfügbar.')}</p>`; return; }
    const d = x.data, act = d.blocks.filter((b) => b.active);
    const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : dt(t); };
    box.innerHTML = `<div class="sec-inc-h"><h2>Vorfälle (7 Tage)</h2>${d.open ? `<span class="st bad">${d.open} offen</span>` : '<span class="st ok">alles erledigt</span>'}</div>
      <p class="form-note"><button class="text-btn" id="secTest" type="button">Testalarm an mich senden</button> · Bei Angriffen und Bot-Wellen bekommen Sie automatisch eine E-Mail (höchstens alle 15 Minuten je Art). Hier können Sie Quellen sperren – gesperrte Quellen erhalten keinen Zugriff mehr auf die Schnittstellen. Gespeichert wird nur eine gekürzte Kennung, keine IP-Adresse.</p>
      ${d.groups.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Art</th><th>Quelle</th><th>Anzahl</th><th>Zuletzt</th><th>Details</th><th></th></tr></thead><tbody>${d.groups.map((g) => `<tr class="${g.open ? 'sec-open' : ''}"><td><strong>${esc(g.label)}</strong>${g.open ? `<br><small>${g.open} offen</small>` : ''}</td><td>${g.ip ? `<code>${esc(g.ip.slice(0, 8))}</code>${g.blocked ? ' <span class="st">gesperrt</span>' : ''}` : '–'}</td><td>${g.n}</td><td>${esc(ago(g.last))}</td><td><small>${g.details.map(esc).join('<br>')}</small></td><td class="sec-act">${g.ip && !g.blocked ? `<button class="btn btn-dark btn-sm" data-blk="${g.ip}" data-days="1">24 h sperren</button><button class="text-btn" data-blk="${g.ip}" data-days="30">30 Tage</button><button class="text-btn" data-blk="${g.ip}" data-days="0">dauerhaft</button>` : ''}${g.open ? `<button class="text-btn" data-ack="${esc(g.kind)}" data-ip="${g.ip || ''}">erledigt</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${d.open ? '<p><button class="btn btn-outline" id="ackAll" type="button">Alle als erledigt markieren</button></p>' : ''}` : '<p class="pt-alert ok">Keine Vorfälle in den letzten 7 Tagen.</p>'}
      <h3 class="wa-sub">Eigene Geräte – werden nie erfasst oder gesperrt</h3>
      <p class="form-note">Geräte, auf denen Sie im Web-Admin angemeldet waren, und deren Netze werden automatisch erkannt. ${d.here?.trusted || d.here?.cookie ? '<span class="st ok">Dieses Gerät ist als eigenes markiert</span>' : '<button class="btn btn-outline btn-sm" id="secTrust" type="button">Dieses Gerät als eigenes markieren</button>'}</p>
      ${d.trusted?.length ? `<ul class="sec-blocks">${d.trusted.map((t) => `<li><code>${esc(t.ip.slice(0, 8))}</code><span>${esc(t.label)}${t.here ? ' · <strong>aktuelles Netz</strong>' : ''} · zuletzt ${esc(dtt(t.seen))}</span><button class="text-btn" data-untrust="${t.ip}">entfernen</button></li>`).join('')}</ul>` : ''}
      ${act.length ? `<h3 class="wa-sub">Gesperrte Quellen (${act.length})</h3><ul class="sec-blocks">${act.map((b) => `<li><code>${esc(b.ip_hash.slice(0, 8))}</code><span>${b.until ? 'bis ' + dtt(b.until) : 'dauerhaft'}${b.reason ? ' · ' + esc(b.reason) : ''}</span><button class="text-btn" data-unblk="${b.ip_hash}">entsperren</button></li>`).join('')}</ul>` : ''}`;
    box.querySelectorAll('[data-blk]').forEach((b) => b.onclick = async () => { const days = Number(b.dataset.days) || null; const reason = prompt('Grund (optional, für das Protokoll):', 'Angriffsversuch') ?? null; if (reason === null) return; const y = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'block', ip: b.dataset.blk, days, reason }) }); if (y.ok) { msg('Quelle gesperrt.'); loadInc(); } else msg(y.data?.error || 'Fehler', true); });
    $('#secTrust')?.addEventListener('click', async () => { const y = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'trust', label: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone/iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computer' }) }); msg(y.ok ? 'Dieses Gerät wird nicht mehr erfasst.' : (y.data?.error || 'Fehler'), !y.ok); loadInc(); });
    box.querySelectorAll('[data-untrust]').forEach((b) => b.onclick = async () => { if (!confirm('Dieses Netz nicht mehr als eigenes behandeln?')) return; await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'untrust', ip: b.dataset.untrust }) }); loadInc(); });
    box.querySelectorAll('[data-unblk]').forEach((b) => b.onclick = async () => { if (!confirm('Sperre aufheben?')) return; await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'unblock', ip: b.dataset.unblk }) }); loadInc(); });
    box.querySelectorAll('[data-ack]').forEach((b) => b.onclick = async () => { await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'ack', kind: b.dataset.ack, ip: b.dataset.ip || null }) }); loadInc(); });
    $('#secTest')?.addEventListener('click', async () => { const y = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'testalert' }) }); msg(y.ok ? 'Testalarm gesendet – bitte Postfach prüfen.' : (y.data?.error || 'Fehler'), !y.ok); });
    $('#ackAll')?.addEventListener('click', async () => { await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'ack' }) }); loadInc(); });
  };
  loadInc();
  const KIND = { rate_limit: 'Gedrosselt', admin_denied: 'Admin verweigert', admin_ip_blocked: 'IP nicht freigegeben', admin_mfa_missing: 'Zweiter Faktor fehlt', panic: 'Not-Aus', honeypot: 'Bot (Honigtopf)', too_fast: 'Bot (zu schnell)', disposable_email: 'Wegwerf-Adresse', email_no_mx: 'Domain ohne Mailempfang', content_flagged: 'Spam-Verdacht' };
  const loadLog = async () => {
    const l = await api('/api/admin/support?log=1');
    if (!$('#secLog')) return; // Ansicht inzwischen gewechselt
    if (!l.ok) { $('#secLog').innerHTML = `<p class="form-note">${esc(l.data?.error)}</p>`; return; }
    const top = Object.entries(l.data.counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    $('#secLog').innerHTML = `${top.length ? `<p><strong>Letzte 24 Stunden:</strong> ${top.map(([k, n]) => { const [kind, bucket] = k.split(':'); return `${esc(KIND[kind] || kind)} (${esc(bucket)}): ${n}`; }).join(' · ')}</p>` : '<p class="form-note">Keine Auffälligkeiten in den letzten 24 Stunden.</p>'}
      ${l.data.events.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Zeit</th><th>Ereignis</th><th>Bereich</th><th>Kennung</th></tr></thead><tbody>${l.data.events.slice(0, 60).map((e) => `<tr><td>${dtt(e.created_at)}</td><td>${esc(KIND[e.kind] || e.kind)}</td><td>${esc(e.bucket || '')}</td><td><code>${esc(e.subject || '')}</code></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  };
  loadLog();
  $('#secRe').onclick = loadLog;
  const go = async (on, level = 2) => {
    const reason = on ? prompt('Grund (für das Protokoll):', 'Sicherheitsvorfall') : '';
    if (on && reason === null) return;
    if (!confirm(on ? `Not-Aus Stufe ${level} jetzt auslösen?${level === 2 ? ' Alle Nutzer außer Administratoren werden abgemeldet.' : ''}` : 'Not-Aus beenden?')) return;
    const x = await api('/api/admin/support', { method: 'POST', body: JSON.stringify({ panic: on, reason, level }) });
    if (x.ok) { msg(on ? `Not-Aus Stufe ${level} aktiv (wirkt binnen 15 Sekunden überall).${level === 2 ? (x.data.revoked != null ? ` ${x.data.revoked} Sitzungen beendet.` : ' Hinweis: Sitzungen konnten nicht beendet werden – Datenbankfunktion lr_revoke_sessions fehlt.') : ''}` : 'Not-Aus beendet.'); sicherheit(v); } else msg(x.data?.error || 'Fehler', true);
  };
  if ($('#p1')) $('#p1').onclick = () => go(true, 1);
  if ($('#p2')) $('#p2').onclick = () => go(true, 2);
  if ($('#pOff')) $('#pOff').onclick = () => go(false);
}

// ---------- Partner ----------
const BR_LABEL = { bank: 'Bank & Sparkasse', vermittler: 'Finanzierungsvermittler', makler: 'Immobilienmakler', finanzberater: 'Finanz- & Vermögensberater', allgemein: 'Sonstiges Unternehmen' };
// Branche des Kontos (bestimmt Pakete und Tools) und dazugebuchte Zusatzbranchen – Wechsel nur hier durch den Support.
function brancheDialog(id, cur, extras, done) {
  let d = document.getElementById('brAdm'); if (!d) { d = document.createElement('dialog'); d.id = 'brAdm'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<form class="wa-dlg-in" method="dialog" id="brAdmF"><div class="wa-dlg-h"><h2>Branche festlegen</h2><button class="stage-x" type="button" data-x aria-label="Schließen">×</button></div>
    <label>Hauptbranche<select name="branche">${Object.entries(BR_LABEL).map(([k, l]) => `<option value="${k}"${k === (cur || 'allgemein') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <fieldset><legend>Zusatzbranchen (Abrechnung: Stripe-Abo oder Rechnung)</legend>${Object.entries(BR_LABEL).filter(([k]) => k !== 'bank').map(([k, l]) => `<label class="consent"><input type="checkbox" name="ex" value="${k}"${extras.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
    <p class="form-note">Wirkt sofort auf Pakete und Software-Tools im Portal. Bei Stripe-Abos gleicht der nächste Abo-Abgleich die Zusatzbranchen mit dem Abo ab.</p>
    <div class="pt-row"><button class="btn btn-dark" type="submit">Speichern</button></div></form>`;
  d.showModal();
  d.querySelector('[data-x]').onclick = () => d.close();
  d.querySelector('#brAdmF').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, branche = f.branche.value, ex = [...f.querySelectorAll('[name=ex]:checked')].map((x) => x.value).filter((x) => x !== branche);
    const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'branche', id, branche, extras: ex }) });
    if (r.ok) { d.close(); msg('Branche gespeichert.'); done?.(); } else msg(r.data?.error || 'Fehler', true);
  };
}

async function partner(v) {
  const r = await api('/api/admin/b2b');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const list = r.data.accounts;
  const pend = list.filter((a) => a.verification_status === 'eingereicht').length;
  v.innerHTML = `<div class="wa-mk-tiles"><button class="wa-mk b2b" type="button" id="mkNew"><b>+ Unternehmen anlegen</b><span>B2B · Firmenzugang zum Unternehmensportal</span></button><button class="wa-mk" type="button" id="mkCat"><b>Pakete &amp; Preise</b><span>Branchen, Preise, Leistungen, Tools, Zusatzbranche</span></button></div>${pend ? `<p class="auth-message" style="margin-bottom:10px"><strong>${pend} Unternehmen</strong> ${pend === 1 ? 'wartet' : 'warten'} auf Prüfung und Freischaltung. Filter „Zur Prüfung eingereicht“ wählen und „Prüfen“ öffnen.</p>` : ''}<div class="pt-row" style="margin-bottom:10px"><input id="pq" aria-label="Unternehmen suchen" placeholder="Suchen (Firma, Ort, Kundennummer)" style="flex:1;min-width:220px;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px"><button class="btn btn-ghost" id="pCsv" type="button">CSV</button></div>
    <div class="pc-bar"><div class="pc-chips" role="group" aria-label="Status">${[['', 'Alle'], ['pruefen', 'Wartet auf Prüfung'], ['active', 'Aktiv'], ['locked', 'Gesperrt']].map(([k, l]) => `<button type="button" data-pf="${k}" aria-pressed="${k === '' ? 'true' : 'false'}">${l} <b>${k === '' ? list.length : list.filter((a) => (a.status + (a.verified_at ? '' : ' unverified') + (a.verification_status === 'eingereicht' ? ' pruefen' : '')).split(' ').includes(k)).length}</b></button>`).join('')}</div>
      <div class="pc-batch" id="pcBatch" hidden><span id="pcN">0 ausgewählt</span><button type="button" class="btn btn-outline btn-sm" id="pcAll">Alle sichtbaren</button><button type="button" class="btn btn-sm pc-del" id="pcDel">Ausgewählte löschen</button></div></div>
    ${list.length ? `<div class="pc-list">${list.map((a) => { const st = a.status === 'locked' ? ['bad', 'Gesperrt'] : a.verification_status === 'eingereicht' ? ['warn', 'Wartet auf Prüfung'] : !a.verified_at ? ['warn', a.verification_status === 'abgelehnt' ? 'Abgelehnt' : 'Ungeprüft'] : ['ok', 'Aktiv']; return `<article class="pc" data-row="${a.id}" data-s="${a.status}${a.verified_at ? '' : ' unverified'}${a.verification_status === 'eingereicht' ? ' pruefen' : ''}" data-q="${esc((a.company_name + ' ' + a.city + ' ' + a.customer_number + ' ' + a.email + ' ' + (a.register_number || '') + ' ' + (a.tax_id || '')).toLowerCase())}">
      <header class="pc-h"><label class="pc-sel"><input type="checkbox" data-sel="${a.id}" data-owner="${esc(a.owner_id || '')}" data-mail="${esc(a.email)}" aria-label="${esc(a.company_name)} auswählen"></label><div><strong>${esc(a.company_name)}</strong><small>${esc(a.customer_number)} · ${esc(a.postal_code)} ${esc(a.city)}</small></div><span class="st ${st[0]}">${st[1]}</span></header>
      <dl class="pc-meta"><div><dt>Rechtsform</dt><dd>${esc(a.legal_form)} · ${esc(a.institution_type)}</dd></div><div><dt>Branche</dt><dd>${esc(BR_LABEL[a.branche] || a.branche || '–')}${(a.extra_branches || []).length ? ` + ${a.extra_branches.map((x) => esc(BR_LABEL[x] || x)).join(', ')}` : ''}</dd></div><div><dt>Register</dt><dd>${esc(a.register_number || '–')}</dd></div><div><dt>Steuer / USt-IdNr.</dt><dd>${esc(a.tax_id || '–')}</dd></div><div><dt>Berater</dt><dd>${esc(a.advisor_name || '–')}<br><small>${esc(a.email)}</small></dd></div><div><dt>Tarif</dt><dd>${a.tier ? TIER[a.tier] : '–'}${a.plan_source === 'manual' ? ' (manuell)' : ''}${a.plan_until ? ` · bis ${dt(a.plan_until)}` : ''}${a.dossier_bonus ? ` · +${a.dossier_bonus} Mappen` : ''}</dd></div><div><dt>Anfragen</dt><dd>${a.leads}${a.has_whitelabel ? ' · White-Label' : ''}${a.allow_invoice_payment ? ' · Rechnungskauf' : ''}</dd></div></dl>
      ${a.status === 'locked' && a.lock_reason ? `<p class="pc-lock">Gesperrt: ${esc(a.lock_reason)}</p>` : ''}
      <footer class="pc-act">${a.verified_at ? `<button class="btn btn-outline btn-sm" data-a="details" data-id="${a.id}" type="button">Details</button>` : `<button class="btn btn-dark btn-sm" data-a="details" data-id="${a.id}" type="button">Prüfen &amp; freischalten</button>`}
        <details class="pc-menu"><summary class="btn btn-outline btn-sm">Aktionen ▾</summary><div class="pc-menu-in">
          ${a.verified_at ? `<button data-a="verify" data-on="false" data-id="${a.id}" type="button">Freischaltung zurücknehmen</button>` : ''}
          <button data-a="branche" data-id="${a.id}" data-br="${esc(a.branche || '')}" data-ex="${esc((a.extra_branches || []).join(','))}" type="button">Branche festlegen</button>
          <button data-a="plan" data-id="${a.id}" type="button">Tarif zuweisen</button>
          <button data-a="karten" data-id="${a.id}" data-name="${esc(a.company_name)}" type="button">Firmenkarten (LeaseRun Card)</button>
          <button data-a="modules" data-id="${a.id}" data-name="${esc(a.company_name)}" data-mod="${esc(JSON.stringify(a.modules || {}))}" type="button">Module freischalten</button>
          <button data-a="whitelabel" data-on="${!a.has_whitelabel}" data-id="${a.id}" type="button">${a.has_whitelabel ? 'White-Label entziehen' : 'White-Label aktivieren'}</button>
          <button data-a="invoicePayment" data-on="${!a.allow_invoice_payment}" data-id="${a.id}" type="button">${a.allow_invoice_payment ? 'Rechnungskauf aus' : 'Rechnungskauf an'}</button>
          <button data-a="credits" data-id="${a.id}" type="button">Kontingent +</button>
          <button data-a="invoice" data-id="${a.id}" data-name="${esc(a.company_name)}" type="button">Rechnung schreiben</button>
          ${a.status === 'locked' ? `<button data-a="unlock" data-id="${a.id}" type="button">Entsperren</button>` : `<button data-a="lock" data-id="${a.id}" type="button" class="pc-danger">Sperren</button>`}
          <button data-a="delete" data-id="${a.id}" data-name="${esc(a.company_name)}" type="button" class="pc-danger">Unternehmen löschen</button>
        </div></details></footer></article>`; }).join('')}</div>` : emptyState('Noch keine Unternehmenskonten', 'Legen Sie ein Unternehmen an oder übernehmen Sie eine Kontoanfrage unter „Anfragen“.')}
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
  // Mehrfachauswahl: QA- und Testkonten gesammelt löschen (Bestätigung durch Eingabe von LÖSCHEN).
  const sel = () => [...v.querySelectorAll('[data-sel]:checked')];
  const syncSel = () => { const n = sel().length; $('#pcBatch').hidden = !n; $('#pcN').textContent = `${n} ausgewählt`; v.querySelectorAll('.pc').forEach((c) => c.classList.toggle('on', Boolean(c.querySelector('[data-sel]:checked')))); };
  v.querySelectorAll('[data-sel]').forEach((c) => c.onchange = syncSel);
  $('#pcAll').onclick = () => { v.querySelectorAll('.pc:not([hidden]) [data-sel]').forEach((c) => { c.checked = true; }); syncSel(); };
  $('#pcDel').onclick = async () => {
    const xs = sel(); if (!xs.length) return;
    const t = prompt(`${xs.length} Unternehmenskonto/-konten endgültig löschen (inkl. Inhaber-Zugang)? Laufende Abos müssen vorher gekündigt sein; Rechnungen bleiben archiviert.\n\nZur Bestätigung LÖSCHEN eingeben:`);
    if (t !== 'LÖSCHEN') return;
    let ok = 0; const err = [];
    for (const c of xs) {
      const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'delete', id: c.dataset.sel, confirm: 'LÖSCHEN' }) });
      if (r.ok) ok++; else err.push(`${c.dataset.mail}: ${r.data?.error || 'Fehler'}`);
    }
    msg(`${ok} gelöscht.${err.length ? ' Nicht gelöscht: ' + err.join(' · ') : ''}`, err.length > 0);
    partner(v);
  };
  $('#pCsv').onclick = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const head = ['Kundennummer', 'Firma', 'Rechtsform', 'Art', 'Registernummer', 'Steuernummer', 'Ansprechpartner', 'E-Mail', 'PLZ', 'Ort', 'Tarif', 'Quelle', 'Status', 'Geprüft', 'Anfragen', 'Angelegt'];
    const rows = list.map((a) => [a.customer_number, a.company_name, a.legal_form, a.institution_type, a.register_number, a.tax_id, a.advisor_name, a.email, a.postal_code, a.city, a.tier || '', a.plan_source || '', a.status, a.verified_at ? 'ja' : 'nein', a.leads, a.created_at.slice(0, 10)]);
    const blob = new Blob(['\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = 'LeaseRun_Unternehmen.csv'; document.body.append(el); el.click(); el.remove();
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
    if (a === 'lock') { const reason = prompt('Grund der Sperre (wird dem Unternehmen angezeigt):'); if (!reason) return; body.reason = reason; }
    if (a === 'unlock' && !confirm('Konto entsperren?')) return;
    if (a === 'invoicePayment') {
      body.on = b.dataset.on === 'true';
      if (body.on) { const lim = prompt('Kreditlimit in Euro (leer = ohne Limit):', ''); const days = prompt('Zahlungsziel in Tagen:', '14'); if (days === null) return; body.limitCents = lim ? Math.round(Number(lim.replace(',', '.')) * 100) : null; body.termsDays = Number(days) || 14; }
    }
    if (a === 'credits') { const n = prompt('Zusätzliche Kreditmappen pro Monat (negativ zum Abziehen):', '10'); if (!n) return; body.add = Math.trunc(Number(n)); }
    if (a === 'delete') {
      const t = prompt(`„${b.dataset.name}“ endgültig löschen?\n\nFälle, Kunden, Anfragen, Berater-Zuordnungen und API-Schlüssel werden entfernt. Der Inhaber-Zugang wird mitgelöscht (außer bei Administratoren). Rechnungen bleiben archiviert.\n\nZur Bestätigung LÖSCHEN eingeben:`);
      if (t !== 'LÖSCHEN') return;
      const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'delete', id, confirm: 'LÖSCHEN' }) });
      if (r.ok) { msg('Unternehmen gelöscht.'); partner(v); } else msg(r.data?.error || 'Löschen fehlgeschlagen.', true);
      return;
    }
    if (a === 'plan') return b2bAccessDialog(id, b.closest('.pc')?.querySelector('.pc-h strong')?.textContent || 'Unternehmen', () => partner(v));
    const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify(body) });
    if (r.ok) { msg('Gespeichert.'); partner(v); } else msg(r.data?.error || 'Fehler', true);
  });
  $('#mkNew')?.addEventListener('click', () => openCreateAccount(null, () => partner(v)));
  $('#mkCat')?.addEventListener('click', () => import('./intern-b2bcat.mjs?v=892f3666').then((m) => m.catalogEditor()));
  $('#mkPriv')?.addEventListener('click', () => openCreatePrivate());
}

// Nur lesende Detailansicht eines Unternehmens (kein Einloggen als Partner).
// Modulrechte je Unternehmenskonto: laut Tarif, zusätzlich freigeschaltet oder gesperrt. Wirkt sofort im Portal und in den Schnittstellen.
const MODS = [['schnellrechner', 'Schnellrechner & Fall-Analysen', 'Schnell-Checks von Unterlagen-Paketen, Präsentationen'], ['kreditmappe', 'BankReady Kreditmappe', 'Kreditmappen ohne Monatskontingent, wenn freigeschaltet'], ['stresstest', 'Stresstest-Generator', 'Zins-, Leerstands- und Kostenszenarien'], ['whitelabel', 'White-Label-Export', 'Unterlagen und Einladungen im eigenen Erscheinungsbild'], ['crm', 'CRM & Mandantenverwaltung', 'Kunden einladen, Fortschritt und Bestandskunden-Radar']];
// B2B „Zugriff freischalten“: Tarif manuell vergeben und auf Wunsch alle Module frei – in einem Schritt, ohne Eingabefenster.
async function b2bAccessDialog(id, name, done) {
  let d = document.getElementById('b2bAccDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'b2bAccDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<div class="wa-dlg-in">${skel()}</div>`;
  d.showModal ? d.showModal() : d.setAttribute('open', '');
  const r = await api('/api/admin/b2b?id=' + encodeURIComponent(id));
  if (!r.ok) { d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>Zugriff freischalten</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div><p class="auth-message error">${esc(r.data?.error || 'Konto nicht gefunden.')}</p></div>`; d.querySelector('[data-x]').onclick = () => d.close(); return; }
  const a = r.data.account, cur = a.tier || a.plan_tier || '', stripeSub = a.plan_source === 'stripe' && a.stripe_subscription_id && a.plan_tier;
  const mods = a.modules || {}, allOn = MODS.every(([k]) => mods[k] === 'on');
  const until = a.plan_until ? String(a.plan_until).slice(0, 10) : '';
  const opt = (v, t, x) => `<label><input type="radio" name="tier" value="${v}"${cur === v || (!cur && v === 'ENTERPRISE') ? ' checked' : ''}><span><b>${t}</b><small>${x}</small></span></label>`;
  d.innerHTML = `<form class="wa-dlg-in acc-b2b" id="b2bAccF"><div class="wa-dlg-h"><h2>Zugriff freischalten</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
    <p class="form-note"><strong>${esc(name)}</strong> · aktuell: <b>${cur ? esc(TIER[cur] || cur) : 'kein Tarif'}</b>${a.plan_source === 'manual' ? ' (manuell)' : stripeSub ? ' (Stripe-Abo)' : ''}${a.verified_at ? '' : ' · <span class="st warn">noch nicht verifiziert</span>'}${a.status === 'locked' ? ' · <span class="st bad">gesperrt</span>' : ''}</p>
    ${stripeSub ? '<p class="auth-message">Dieses Konto hat ein laufendes Stripe-Abo. Den Tarif ändern Sie dort; Module können Sie hier trotzdem freischalten.</p>' : `<fieldset class="acc-tiers"><legend class="form-note">Tarif</legend>
      ${opt('ENTERPRISE', 'Alles freischalten (Enterprise)', 'Alle Werkzeuge, Team, White-Label, API – die höchste Stufe')}${opt('PRO', 'Pro', 'Mappen und Präsentationen unbegrenzt, Partnerseite, Protokoll')}${opt('BASIC', 'Basic', '1 Zugang, 20 Kreditmappen pro Monat')}${cur ? opt('', 'Manuellen Tarif entfernen', 'Es gilt dann nur ein bezahlter Tarif') : ''}</fieldset>
      <label>Gültig bis (leer = unbefristet)<input type="date" name="until" value="${esc(until)}"></label>`}
    <label class="chk"><input type="checkbox" name="allmods"${allOn || !Object.keys(mods).length ? ' checked' : ''}> Alle Module frei (Schnellrechner, Kreditmappe ohne Kontingent, Stresstest, White-Label, CRM)</label>
    ${!a.verified_at ? '<label class="chk"><input type="checkbox" name="verify" checked> Unternehmen gleichzeitig als geprüft freischalten (sonst greift der Tarif nicht)</label>' : ''}
    ${a.status === 'locked' ? '<label class="chk"><input type="checkbox" name="unlock" checked> Sperre aufheben</label>' : ''}
    <p class="form-note">Wirkt sofort – das Unternehmen sieht die Freischaltung nach dem nächsten Neuladen des Portals. Jede Änderung wird protokolliert.</p>
    <p class="form-note" id="b2bAccMsg" role="status" aria-live="polite"></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Abbrechen</button><button type="submit" class="btn btn-dark">Freischalten</button></div></form>`;
  d.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => d.close(); });
  const f = d.querySelector('#b2bAccF');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f), out = d.querySelector('#b2bAccMsg'), btn = f.querySelector('[type=submit]');
    const say = (t, bad) => { out.textContent = t; out.className = 'form-note ' + (bad ? 'err' : 'ok'); };
    f.classList.add('acc-busy'); btn.disabled = true; say('Wird gespeichert …');
    const post = (body) => api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ id, ...body }) });
    const errs = [];
    if (fd.get('verify') === 'on') { const x = await post({ action: 'approve' }); if (!x.ok) errs.push(x.data?.error || 'Verifizierung fehlgeschlagen'); }
    if (fd.get('unlock') === 'on') { const x = await post({ action: 'unlock' }); if (!x.ok) errs.push(x.data?.error || 'Entsperren fehlgeschlagen'); }
    if (!stripeSub && fd.has('tier')) { const t = String(fd.get('tier') || ''); const x = await post({ action: 'plan', tier: t || null, until: t ? (String(fd.get('until') || '') || null) : null }); if (!x.ok) errs.push(x.data?.error || 'Tarif nicht gespeichert'); }
    const want = fd.get('allmods') === 'on';
    if (want || allOn) { const x = await post({ action: 'modules', modules: Object.fromEntries(MODS.map(([k]) => [k, want ? 'on' : 'auto'])) }); if (!x.ok) errs.push(x.data?.error || 'Module nicht gespeichert'); }
    f.classList.remove('acc-busy'); btn.disabled = false;
    if (errs.length) { say(errs.join(' · '), true); return; }
    say('Freigeschaltet.');
    msg(`Zugriff für ${name} gespeichert.`);
    setTimeout(() => { d.close(); done?.(); }, 700);
  };
}

function modulesDialog(id, name, cur, done) {
  let d = document.getElementById('modDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'modDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const opt = (k, val, label) => `<label class="mod-opt"><input type="radio" name="m-${k}" value="${val}"${(cur[k] || 'auto') === val ? ' checked' : ''}><span>${label}</span></label>`;
  d.innerHTML = `<form class="wa-dlg-in" id="modF"><div class="wa-dlg-h"><h2>Module freischalten</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
    <p class="form-note"><strong>${esc(name)}</strong> · „Laut Tarif“ folgt dem gebuchten Tarif. „Frei“ schaltet unabhängig vom Tarif frei, „Gesperrt“ sperrt das Modul.</p>
    <div class="mod-list">${MODS.map(([k, t, x]) => `<fieldset class="mod-row"><legend><strong>${t}</strong><small>${x}</small></legend><div class="mod-seg">${opt(k, 'auto', 'Laut Tarif')}${opt(k, 'on', 'Frei')}${opt(k, 'off', 'Gesperrt')}</div></fieldset>`).join('')}</div>
    <p class="form-note" id="modMsg" role="status"></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Abbrechen</button><button type="button" class="btn btn-outline" id="modAll">Alle frei</button><button type="submit" class="btn btn-dark">Speichern</button></div></form>`;
  d.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => d.close(); });
  d.querySelector('#modAll').onclick = () => { d.querySelectorAll('input[value="on"]').forEach((i) => { i.checked = true; }); d.querySelector('#modMsg').textContent = 'Alle Module auf „Frei“ gesetzt – jetzt speichern.'; };
  d.querySelector('#modF').onsubmit = async (e) => {
    e.preventDefault();
    const modules = Object.fromEntries(MODS.map(([k]) => [k, d.querySelector(`input[name="m-${k}"]:checked`)?.value || 'auto']));
    const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'modules', id, modules }) });
    if (!r.ok) { d.querySelector('#modMsg').textContent = r.data?.error || 'Speichern fehlgeschlagen.'; return; }
    d.close(); msg('Module gespeichert.'); done?.();
  };
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}

// Firmenkarten (Stripe Issuing) je Unternehmenskonto: ansehen, ausgeben, Monatslimit ändern.
async function cardsDialog(id, name) {
  let d = document.getElementById('cardDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'cardDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const e2 = (c) => (c == null ? '–' : (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
  d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>Firmenkarten · ${esc(name)}</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div><div id="cdBody">${skel()}</div></div>`;
  d.querySelector('[data-x]').onclick = () => d.close();
  d.showModal ? d.showModal() : d.setAttribute('open', '');
  const r = await api(`/api/admin/karten?account=${encodeURIComponent(id)}`);
  const box = d.querySelector('#cdBody');
  if (!r.ok) { box.innerHTML = emptyState('Nicht verfügbar', esc(r.data?.error || '')); return; }
  const x = r.data, live = ['LIVE', 'SANDBOX'].includes(x.program);
  const stat = live ? `<span class="st ${x.program === 'LIVE' ? 'ok' : 'warn'}">${x.program === 'LIVE' ? 'Live' : 'Testbetrieb (Stripe-Testmodus)'}</span>` : '<span class="st">Nicht eingerichtet</span>';
  box.innerHTML = `<p class="form-note">Kartenpartner: <strong>${x.provider === 'stripe' ? 'Stripe Issuing' : 'keiner'}</strong> · ${stat}. Firmenkarten nur für geschäftliche Ausgaben; jede Zahlung wird vorab gegen das Monatslimit geprüft.</p>
    ${x.tablesReady === false ? '<p class="auth-message">Die Karten-Tabellen sind in der Datenbank noch nicht eingerichtet (docs/sql/2026-10-18_cards.sql).</p>' : ''}
    ${(x.cards || []).length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Karte</th><th>Status</th><th>Limit</th><th>Verbraucht</th><th></th></tr></thead><tbody>${x.cards.map((c) => { const l = (c.lr_card_limits && (c.lr_card_limits[0] || c.lr_card_limits)) || {}; const used = (l.settled_cents || 0) + (l.reserved_cents || 0) - (l.refunded_cents || 0); return `<tr><td>•••• ${esc(c.last4 || '––––')}</td><td>${esc(c.status)}</td><td>${e2(l.monthly_limit_cents)}</td><td>${e2(Math.max(0, used))}</td><td><button type="button" class="btn btn-outline btn-sm" data-lim="${c.id}">Limit ändern</button></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('Noch keine Firmenkarten', 'Geben Sie unten die erste Karte für ein Mitglied dieses Unternehmens aus.')}
    <form id="cdForm" class="mod-list" style="margin-top:14px"${live ? '' : ' hidden'}><h3 style="margin:0">Neue Firmenkarte</h3>
      <label>E-Mail des Mitglieds<input name="memberEmail" type="email" required></label>
      <label>Name auf der Karte (max. 24 Zeichen)<input name="holderName" maxlength="24" required></label>
      <label>Straße und Hausnummer (Rechnungsadresse)<input name="line1" required></label>
      <div class="pt-row"><label>PLZ<input name="postalCode" inputmode="numeric" pattern="[0-9]{5}" required></label><label>Ort<input name="city" required></label></div>
      <label>Monatslimit in €<input name="limit" inputmode="decimal" required placeholder="z. B. 1000"></label>
      <label>Stripe-Konto des Unternehmens (optional, acct_…)<input name="stripeAccount" pattern="acct_[A-Za-z0-9]+"></label>
      <p class="form-note" id="cdMsg" role="status"></p><button class="btn btn-dark" type="submit">Karte ausgeben</button></form>
    ${live ? '' : '<p class="form-note">Zum Ausgeben in Vercel setzen: CARD_PROVIDER=stripe, CARD_PROGRAM_STATUS=SANDBOX (Testmodus) bzw. LIVE mit CARD_COMPLIANCE_APPROVED=true, STRIPE_ISSUING_WEBHOOK_SECRET; Stripe Issuing muss freigeschaltet sein.</p>'}`;
  box.querySelectorAll('[data-lim]').forEach((b) => b.onclick = async () => {
    const v = prompt('Neues Monatslimit in Euro:'); if (v == null) return;
    const c = Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100); if (!Number.isFinite(c) || c < 0) return;
    const rr = await api('/api/admin/karten', { method: 'POST', body: JSON.stringify({ action: 'limit', account: id, cardId: b.dataset.lim, limitCents: c }) });
    if (rr.ok) cardsDialog(id, name); else alert(rr.data?.error || 'Fehler');
  });
  const f = box.querySelector('#cdForm');
  if (f) f.onsubmit = async (ev) => {
    ev.preventDefault(); if (!f.checkValidity()) { f.reportValidity(); return; }
    const fd = Object.fromEntries(new FormData(f));
    const lc = Math.round(Number(String(fd.limit).replace(/\./g, '').replace(',', '.')) * 100);
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    const rr = await api('/api/admin/karten', { method: 'POST', body: JSON.stringify({ action: 'issue', account: id, memberEmail: fd.memberEmail, holderName: fd.holderName, line1: fd.line1, postalCode: fd.postalCode, city: fd.city, limitCents: lc, stripeAccount: fd.stripeAccount || '' }) });
    btn.disabled = false;
    if (rr.ok) cardsDialog(id, name); else f.querySelector('#cdMsg').textContent = rr.data?.error || 'Die Karte konnte nicht ausgegeben werden.';
  };
}

async function details(id) {
  const box = $('#invForm');
  box.innerHTML = logoLoader();
  const r = await api('/api/admin/b2b?id=' + id);
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const { account: a, members, leads, invoices, verificationDocs: vd = [] } = r.data;
  const rows = [['Kundennummer', a.customer_number], ['Unternehmen', `${a.company_name} (${a.legal_form})`], ['Art', a.institution_type], ['Registernummer', a.register_number || '–'], ['Steuer-/USt-IdNr.', a.tax_id || '–'],
    ['Ansprechpartner', a.advisor_name], ['E-Mail', a.email], ['Telefon', a.phone || '–'], ['Anschrift', `${a.street || ''}, ${a.postal_code} ${a.city}`], ['Partnerseite', a.slug ? `/p/${a.slug}` : '–'],
    ['Tarif', `${a.tier ? TIER[a.tier] : '–'}${a.plan_source ? ` (${a.plan_source === 'manual' ? 'manuell' : 'Stripe'})` : ''}`], ['Kreditmappen diesen Monat', String(a.dossiersThisMonth)],
    ['§ 14 BGB bestätigt', dtt(a.unternehmer_confirmed_at)], ['AVV', `${a.avv_version || '–'} am ${dtt(a.avv_accepted_at)}`], ['Herkunft', a.referral || '–'], ['Erlaubte Domains', (a.allowed_domains || []).join(', ') || 'alle'], ['Angelegt', dtt(a.created_at)]];
  box.innerHTML = `<section class="pt-card" style="margin-top:16px"><h2>${esc(a.company_name)}</h2>
    <dl class="pt-dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3>Verifizierung</h3>
    <p>Status: <strong>${{ offen: 'noch keine Unterlagen eingereicht', eingereicht: 'zur Prüfung eingereicht', geprueft: 'geprüft und freigeschaltet', abgelehnt: 'abgelehnt' }[a.verification_status] || (a.verified_at ? 'geprüft' : 'offen')}</strong>${a.verification_submitted_at ? ` · eingereicht ${dtt(a.verification_submitted_at)}` : ''}${a.verification_note ? `<br><small>Begründung: ${esc(a.verification_note)}</small>` : ''}</p>
    ${vd.length ? `<ul class="plain-list">${vd.map((d) => `<li>${d.url ? `<a class="ck-link" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc({ gewerbe: 'Gewerbeanmeldung', handelsregister: 'Handelsregisterauszug', erlaubnis: 'Erlaubnis § 34c/§ 34i', sonstiges: 'Sonstiger Nachweis' }[d.kind] || d.kind)}: ${esc(d.file_name)}</a>` : esc(d.file_name)} <small>(${Math.max(1, Math.round(d.byte_size / 1024))} KB · ${dtt(d.created_at)} · SHA ${esc(d.sha256.slice(0, 10))}…)</small></li>`).join('')}</ul><p class="form-note">Links sind 5 Minuten gültig (Abruf wird protokolliert). Prüfen: Firmenname, Anschrift und Register-/Steuernummer stimmen mit den Angaben überein; bei Maklern/Vermittlern ggf. Erlaubnis.</p>` : '<p class="form-note">Noch keine Nachweise hochgeladen.</p>'}
    ${a.verified_at ? '' : `<p><button class="btn btn-dark" id="vApprove" type="button"${vd.length ? '' : ' disabled'}>Freischalten</button> <button class="btn btn-outline" id="vReject" type="button">Ablehnen mit Begründung</button></p>`}
    <h3>Team</h3><p>${members.map((m) => `${esc(m.email)} (${m.role === 'owner' ? 'Inhaber' : 'Berater'})`).join(' · ') || '–'}</p>
    <h3>Anfragen (nur Anzahl und Status, Inhalte gehören dem Unternehmen)</h3><p>${leads.length} insgesamt · ${['neu', 'in_bearbeitung', 'abgeschlossen', 'abgelehnt'].map((s) => `${s.replace('_', ' ')}: ${leads.filter((l) => l.status === s).length}`).join(' · ')}</p>
    <h3>Rechnungen</h3>${invoices.length ? `<div class="wa-wrap"><table class="wa-table"><tbody>${invoices.map((i) => `<tr><td>${esc(i.invoice_number)}</td><td>${dt(i.issue_date)}</td><td>${eur(i.gross_cents)}</td><td>${PAY[i.payment_status]}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine.</p>'}
    <h3>Support-Ansicht</h3><p class="form-note">${a.support_access_until && new Date(a.support_access_until) > new Date() ? `Vom Unternehmen freigegeben bis ${dtt(a.support_access_until)}.` : 'Nicht freigegeben. Das Unternehmen kann den lesenden Support-Zugriff im Portal unter Profil erteilen.'}</p>
    ${a.support_access_until && new Date(a.support_access_until) > new Date() ? '<button class="btn btn-ghost" id="supView" type="button">Portal lesend ansehen (wird protokolliert)</button><div id="supOut"></div>' : ''}
    <button class="text-btn" id="detClose" type="button">Schließen</button></section>`;
  if ($('#supView')) $('#supView').onclick = async () => {
    const s = await api('/api/admin/support?id=' + id);
    if (!s.ok) { $('#supOut').innerHTML = `<p class="form-note">${esc(s.data?.error)}</p>`; return; }
    const d = s.data;
    $('#supOut').innerHTML = `<p class="form-note">Tarif ${d.account.tier ? TIER[d.account.tier] : '–'} · Widget ${d.account.widgetActive ? 'aktiv' : 'aus'} · Domains: ${esc((d.account.allowedDomains || []).join(', ') || 'alle')}</p>
      <div class="wa-wrap"><table class="wa-table"><thead><tr><th>Eingang</th><th>Quelle</th><th>Status</th><th>Kontakt</th><th>Objekt</th></tr></thead><tbody>${d.leads.map((l) => `<tr><td>${dtt(l.created_at)}</td><td>${esc(l.source)}</td><td>${esc(l.status)}</td><td>${esc(l.client_name)}<br><small>${esc(l.client_email)}</small></td><td>${esc(l.property_data?.address || l.property_data?.ref || '–')}</td></tr>`).join('') || '<tr><td colspan="5">Keine Anfragen.</td></tr>'}</tbody></table></div>`;
  };
  if ($('#vApprove')) $('#vApprove').onclick = async () => {
    if (!confirm(`${a.company_name} freischalten? Das Unternehmen erhält eine E-Mail.`)) return;
    const x = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'approve', id }) });
    if (x.ok) { await partner($('#adView')); msg('Freigeschaltet.'); details(id); } else msg(x.data?.error || 'Fehler', true);
  };
  if ($('#vReject')) $('#vReject').onclick = async () => {
    const reason = prompt('Begründung (wird dem Unternehmen per E-Mail mitgeteilt), z. B. „Gewerbeanmeldung unleserlich“:');
    if (!reason || reason.trim().length < 5) return;
    const x = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify({ action: 'reject', id, reason: reason.trim() }) });
    if (x.ok) { await partner($('#adView')); msg('Abgelehnt, Unternehmen informiert.'); details(id); } else msg(x.data?.error || 'Fehler', true);
  };
  $('#detClose').onclick = () => { box.innerHTML = ''; };
  box.scrollIntoView({ behavior: 'smooth' });
}

function invoiceForm(accountId, name) {
  const box = $('#invForm');
  const row = () => '<div class="row"><input placeholder="Leistung" class="d"><input placeholder="Menge" class="q" value="1" inputmode="decimal"><input placeholder="Einzelpreis netto €" class="p" inputmode="decimal"><button type="button" class="text-btn del x">×</button></div>';
  box.innerHTML = `<section class="pt-card" style="margin-top:16px"><h2>Rechnung an ${esc(name)}</h2>
    <div class="wa-items" id="items">${row()}</div><button class="text-btn" id="addRow" type="button">+ Position</button>
    <div class="pt-row wa-form" style="margin-top:10px"><label class="form-note">Zahlungsart <select id="pm"><option value="INVOICE_BANK_TRANSFER">Überweisung (mit GiroCode)</option><option value="SEPA_B2B">SEPA-Firmenlastschrift</option><option value="STRIPE_CARD">Karte (bereits bezahlt)</option></select></label>
    <label class="form-note">Leistungszeitraum <input id="sp" placeholder="z. B. 01.10.2026–31.10.2026"></label><label class="form-note"><input type="checkbox" id="paid"> bereits bezahlt</label></div>
    <p id="sum" class="form-note"></p><button class="btn btn-dark" id="issue" type="button">Rechnung ausstellen (unveränderbar)</button></section>`;
  const items = () => [...box.querySelectorAll('.row')].map((r) => ({ description: r.querySelector('.d').value.trim(), quantity: Number(r.querySelector('.q').value.replace(',', '.')), unitNetCents: Math.round(Number(r.querySelector('.p').value.replace(/\./g, '').replace(',', '.')) * 100) })).filter((i) => i.description && i.quantity > 0 && i.unitNetCents >= 0);
  const sum = () => { const n = items().reduce((s, i) => s + Math.round(i.quantity * i.unitNetCents), 0); const vat = Math.round(n * 0.19); $('#sum').textContent = `Netto ${eur(n)} · USt 19 % ${eur(vat)} · Brutto ${eur(n + vat)}`; };
  box.oninput = sum;
  box.onclick = (e) => { if (e.target.classList.contains('x') && box.querySelectorAll('.row').length > 1) { e.target.parentElement.remove(); sum(); } };
  $('#addRow').onclick = () => { $('#items').insertAdjacentHTML('beforeend', row()); };
  $('#issue').onclick = async () => {
    const it = items();
    if (!it.length) return msg('Bitte mindestens eine Position mit Preis angeben.', true);
    if (!confirm('Rechnung jetzt ausstellen? Sie erhält die nächste fortlaufende Nummer und kann danach nur storniert werden.')) return;
    const r = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'create', accountId, items: it, paymentMethod: $('#pm').value, servicePeriod: $('#sp').value || undefined, paid: $('#paid').checked }) });
    if (!r.ok) return msg(r.data?.error || 'Fehler', true);
    msg(`Rechnung ${r.data.invoice.invoice_number} ausgestellt und archiviert.${r.data.mailed ? ' PDF per E-Mail an das Unternehmen gesendet.' : ' (Kein E-Mail-Versand eingerichtet: PDF bitte selbst senden; im Portal ist sie abrufbar.)'}`);
    box.innerHTML = '';
  };
  box.scrollIntoView({ behavior: 'smooth' });
}

// ---------- Rechnungsarchiv ----------
async function rechnungen(v, q = '') {
  const r = await api('/api/admin/invoices' + (q ? '?q=' + encodeURIComponent(q) : ''));
  if (!r.ok) { errState(v, r.data?.error); return; }
  v.innerHTML = `<p class="form-note">GoBD-Archiv: Rechnungen sind in der Datenbank gegen Ändern und Löschen gesperrt; jede PDF-Datei wird beim Abruf gegen ihre SHA-256-Prüfsumme geprüft. Korrekturen nur per Storno.${r.data.bankConfigured ? '' : ' <strong>Bankverbindung fehlt:</strong> INVOICE_IBAN, INVOICE_BIC, INVOICE_BANK_NAME in Vercel setzen, sonst sind Überweisungsrechnungen gesperrt.'}</p>
    <div class="pt-row" style="margin-bottom:10px"><input id="iq" aria-label="Rechnungsnummer suchen" value="${esc(q)}" placeholder="Rechnungsnummer" style="border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px"><button class="btn btn-ghost" id="is" type="button">Suchen</button><button class="btn btn-outline" id="iv" type="button">Alle Prüfsummen prüfen</button></div><p class="form-note" id="ivMsg" role="status"></p>${invTable(r.data.invoices)}
    <p class="form-note">Neue Rechnung: unter „Partner“ beim Unternehmen auf „Rechnung“ klicken.</p>`;
  $('#is').onclick = () => rechnungen(v, $('#iq').value.trim());
  $('#iv').onclick = async (e) => {
    e.target.disabled = true; $('#ivMsg').textContent = 'Prüfe alle Rechnungs-PDFs …';
    const x = await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({ action: 'verify' }) });
    e.target.disabled = false;
    if (!x.ok) { $('#ivMsg').textContent = x.data?.error || 'Prüfung fehlgeschlagen.'; return; }
    $('#ivMsg').innerHTML = x.data.bad.length ? `<strong style="color:#B91C1C">${x.data.bad.length} Rechnung(en) weichen von der Prüfsumme ab und gelten als ungültig: ${x.data.bad.map(esc).join(', ')}.</strong> Ein Sicherheitsalarm wurde ausgelöst.` : `✓ ${x.data.ok} Rechnung(en) unverändert.${x.data.missing.length ? ` ${x.data.missing.length} Datei(en) nicht gefunden: ${x.data.missing.map(esc).join(', ')}.` : ''}`;
  };
  bindInv(v, () => rechnungen(v, q));
}

// ---------- Steuer-Export ----------
function steuer(v) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const m = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const q = Math.floor(prev.getMonth() / 3) + 1;
  v.innerHTML = `<section class="pt-card"><h2>${taxSeg() === 'b2b' ? 'Unternehmensrechnungen' : 'Privatkunden-Rechnungen'} für die Steuerkanzlei (ZIP)</h2>${taxSeg() === 'b2c' ? '<p class="pt-alert">Privatkäufe (Kreditmappe, Käufer-Pass, Investor Pro) werden über Stripe abgerechnet; deren Belege exportieren Sie in Stripe unter Berichte. Hier erscheinen nur manuell gestellte Privatkunden-Rechnungen.</p>' : ''}
    <p>Alle Rechnungen eines Zeitraums als ZIP zum Herunterladen und Weitergeben. Jede Datei beginnt mit dem Rechnungsdatum – <code>2026-10-14_IMMO-2026-0042_Kunde.pdf</code> –, damit die Kanzlei sie sofort zuordnen kann. Stornos und Gutschriften liegen im Ordner <code>Korrekturen</code>.</p>
    <div class="pt-row wa-form"><label class="form-note">Zeitraum <select id="per"><option value="m">Monat</option><option value="q">Quartal</option><option value="y">Jahr</option></select></label>
      <label class="form-note" id="perM">Monat <input type="month" id="mon" value="${m}"></label>
      <label class="form-note" id="perQ" hidden>Quartal <select id="qq">${[1, 2, 3, 4].map((x) => `<option value="${x}"${x === q ? ' selected' : ''}>Q${x}</option>`).join('')}</select> <input type="number" id="qy" value="${prev.getFullYear()}" min="2024" max="2100" style="width:90px"></label>
      <label class="form-note" id="perY" hidden>Jahr <input type="number" id="yy" value="${prev.getFullYear()}" min="2024" max="2100" style="width:90px"></label>
      <label class="chk form-note"><input type="checkbox" id="dv"> zusätzlich DATEV-Datei und USt-Journal</label>
      <label class="form-note" id="skrL" hidden>Kontenrahmen <select id="skr"><option value="SKR03">SKR03 – am häufigsten</option><option value="SKR04">SKR04</option></select></label>
      <button class="btn btn-dark" id="zip" type="button">ZIP herunterladen</button></div>
    <details class="wa-help"><summary>Was ist der Kontenrahmen (SKR03 / SKR04)?</summary><p>Nur relevant, wenn Sie die DATEV-Datei mitgeben: Der Kontenrahmen bestimmt die Kontonummern (z. B. Erlöse 19 % auf 8400 bei SKR03 bzw. 4400 bei SKR04). Fragen Sie Ihre Kanzlei, welchen sie führt – im Zweifel SKR03.</p></details>
    <p class="form-note">Hier nur Download. Automatischen Monatsversand an die Steuerberaterin (beide Bereiche in einem Paket) steuern Sie unter <a href="#st_immo">Pakete &amp; Versand</a>.</p></section>`;
  const per = $('#per');
  const sync = () => { $('#perM').hidden = per.value !== 'm'; $('#perQ').hidden = per.value !== 'q'; $('#perY').hidden = per.value !== 'y'; $('#skrL').hidden = !$('#dv').checked; };
  per.onchange = sync; $('#dv').onchange = sync;
  $('#zip').onclick = async (e) => {
    const p = per.value === 'm' ? $('#mon').value : per.value === 'q' ? `${$('#qy').value}-Q${$('#qq').value}` : $('#yy').value;
    e.target.disabled = true;
    const r = await api(`/api/admin/datev?monat=${encodeURIComponent(p)}&skr=${$('#skr').value}&datev=${$('#dv').checked ? 1 : 0}`);
    if (r.ok) { location.href = r.data.url; msg(`ZIP mit ${r.data.count} Rechnungen erstellt.${r.data.problems.length ? ' Hinweise: ' + r.data.problems.join(' · ') : ''}`, r.data.problems.length > 0); } else msg(r.data?.error || 'Fehler', true);
    e.target.disabled = false;
  };
}

// ---------- Anfragen & Codes ----------
async function anfragen(v) {
  const r = await api('/api/admin/misc');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const { contacts, codes } = r.data;
  v.innerHTML = `<section class="pt-card"><h2>B2B-Anfragen</h2><p class="form-note">Kontoanfragen prüfen und mit „Konto anlegen“ den Zugang erzeugen – Firmendaten werden übernommen.</p>${contacts.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Eingang</th><th>Anliegen</th><th>Kontakt</th><th>Nachricht</th><th></th></tr></thead><tbody>
    ${contacts.map((c) => `<tr><td>${dtt(c.created_at)}</td><td>${({ konto: '<span class="st warn">Kontoanfrage</span>', demo: 'Demo', enterprise: 'Enterprise', kooperation: 'Kooperation' })[c.kind] || esc(c.kind)}${c.city ? `<br><small>${esc(c.city)}</small>` : ''}</td><td><strong>${esc(c.company)}</strong><br>${esc(c.name)}<br><a href="mailto:${esc(c.email)}">${esc(c.email)}</a> ${esc(c.phone || '')}</td><td>${esc(c.message || '')}${c.register_number || c.tax_id ? `<br><small>${esc([c.legal_form, c.register_number, c.tax_id].filter(Boolean).join(' · '))}</small>` : ''}${c.proof_name ? `<br><button class="text-btn" data-proof="${c.id}" type="button"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg> Nachweis: ${esc(c.proof_name)}</button>` : ''}</td><td>${c.kind === 'konto' && !c.account_id ? `<button class="btn btn-dark btn-sm" data-mk="${c.id}" type="button">Konto anlegen</button> ` : c.account_id ? '<span class="st ok">Konto angelegt</span> ' : ''}${c.status === 'offen' ? `<button class="text-btn" data-done="${c.id}" type="button">Erledigt</button>` : 'erledigt'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine Anfragen.</p>'}</section>
    <section class="pt-card"><h2>Partnercodes</h2><p class="form-note">Kampagnen-Codes für die Registrierung von Unternehmen. Der Code wird am Konto gespeichert; Rabatte vergibt Stripe über Aktionscodes im Bezahlvorgang.</p>
    <div class="pt-row wa-form"><input id="cc" aria-label="Code" placeholder="CODE-2026" style="text-transform:uppercase"><input id="cd" aria-label="Beschreibung" placeholder="Beschreibung"><input id="cm" aria-label="Maximale Einlösungen" placeholder="max. Einlösungen" inputmode="numeric" style="width:150px"><button class="btn btn-dark" id="cAdd" type="button">Anlegen</button></div>
    ${codes.length ? `<div class="wa-wrap"><table class="wa-table" style="margin-top:10px"><thead><tr><th>Code</th><th>Beschreibung</th><th>Eingelöst</th><th>Quote</th><th></th></tr></thead><tbody>${codes.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.description || '')}</td><td>${c.redeemed}${c.max_redemptions ? ' / ' + c.max_redemptions : ''}</td><td>${c.max_redemptions ? Math.round((c.redeemed / c.max_redemptions) * 100) + ' %' : '–'}</td><td><button class="text-btn" data-code="${esc(c.code)}" data-on="${!c.active}" type="button">${c.active ? 'Deaktivieren' : 'Aktivieren'}</button></td></tr>`).join('')}</tbody></table></div>` : ''}</section>`;
  v.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => { await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'contactDone', id: b.dataset.done }) }); anfragen(v); });
  v.querySelectorAll('[data-proof]').forEach((b) => b.onclick = () => openProof(b.dataset.proof));
  v.querySelectorAll('[data-mk]').forEach((b) => b.onclick = () => { const c = contacts.find((x) => x.id === b.dataset.mk); openCreateAccount(c, () => anfragen(v)); });
  v.querySelectorAll('[data-code]').forEach((b) => b.onclick = async () => { await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'codeActive', code: b.dataset.code, on: b.dataset.on === 'true' }) }); anfragen(v); });
  $('#cAdd').onclick = async () => {
    const r2 = await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'codeCreate', code: $('#cc').value, description: $('#cd').value, maxRedemptions: $('#cm').value ? Number($('#cm').value) : null }) });
    if (r2.ok) anfragen(v); else msg(r2.data?.error || 'Fehler', true);
  };
}

// Protokoll lesbar: Zeit | Akteur | Ereignis | Ziel | Details – statt roher Schlüssel und Kennungen.
const AUD = {
  b2b_verify: 'Freischaltung geändert', b2b_approve: 'Unternehmen freigeschaltet', b2b_reject: 'Prüfung abgelehnt', b2b_lock: 'Unternehmen gesperrt', b2b_unlock: 'Unternehmen entsperrt',
  b2b_whitelabel: 'White-Label geändert', b2b_invoicePayment: 'Rechnungskauf geändert', b2b_credits: 'Kontingent angepasst', b2b_plan: 'Tarif zugewiesen', b2b_request_proof_view: 'Nachweis angesehen',
  user_create: 'Konto angelegt', user_delete: 'Konto gelöscht', user_ban: 'Konto gesperrt', user_unban: 'Konto entsperrt', user_lookup: 'Konto nachgeschlagen', users_list: 'Kontenliste geöffnet',
  user_reset_password: 'Passwort-Reset gesendet', user_resend_confirmation: 'Bestätigung erneut gesendet',
  invoice_create: 'Rechnung erstellt', invoice_paid: 'Rechnung als bezahlt markiert', invoice_remind: 'Zahlungserinnerung gesendet', invoice_storno: 'Rechnung storniert', invoice_verify: 'Rechnung geprüft (SHA-256)',
  datev_export: 'DATEV-/ZIP-Export', panic_on: 'Not-Aus ausgelöst', panic_off: 'Not-Aus beendet', sec_block: 'Quelle gesperrt', sec_unblock: 'Quelle entsperrt', sec_ack: 'Vorfälle erledigt', security_overview: 'Sicherheitslage geöffnet',
  support_view: 'Support-Einsicht', setup_mark: 'Einrichtung abgehakt', setup_livecheck: 'Live-Prüfung', testkauf_start: 'Testkauf gestartet', testkauf_selftest: 'Test-Transaktion',
  testmail: 'Testmail gesendet', testmail_all: 'Alle E-Mail-Vorlagen getestet', testmail_auth: 'Test Konto-E-Mail', audit_reveal: 'Klartext im Protokoll angezeigt',
  campaign_create: 'Kampagne angelegt', newsletter_send: 'Newsletter versendet', newsletter_unsub: 'Newsletter abgemeldet', crm_create: 'Akquise-Kontakt angelegt', crm_delete: 'Akquise-Kontakt gelöscht', crm_import: 'Akquise-Import', crm_letters: 'Akquise-Briefe erstellt',
};
const AUD_CAT = (a) => /^panic|^sec_|security/.test(a) ? 'sec' : /^invoice|datev/.test(a) ? 'fin' : /^b2b_/.test(a) ? 'b2b' : /^user|users_list/.test(a) ? 'user' : 'sys';
// Protokoll nach Tagen eingeklappt: nur der neueste Tag ist offen – die Seite bleibt kurz, alles bleibt erreichbar.
function audDays(rows, li) {
  const day = (t) => new Date(t).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const today = day(Date.now()), groups = new Map();
  for (const a of rows) { const k = day(a.created_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  // Protokolle immer eingeklappt (Wunsch Feray): nur Tag + Anzahl, die Liste öffnet sich erst beim Anklicken.
  return [...groups].map(([k, list]) => `<details class="aud-day"><summary><strong>${k === today ? 'Heute' : esc(k)}</strong><span>${list.length} Eintr${list.length === 1 ? 'ag' : 'äge'}</span></summary><ol class="aud-list">${list.map(li).join('')}</ol></details>`).join('');
}

async function protokoll(v, reveal = false) {
  const [r, pr] = await Promise.all([api('/api/admin/misc' + (reveal ? '?reveal=1' : '')), api('/api/admin/b2b')]);
  if (!r.ok) { errState(v, r.data?.error); return; }
  const firms = new Map((pr.ok ? pr.data.accounts : []).map((a) => [a.id, a.company_name]));
  const who = (x) => { const t = String(x || ''); if (!t || t === 'system') return ['Sys', 'System']; if (/@/.test(t)) return ['Admin', t]; return ['Admin', 'Admin ' + t.replace(/^ps:/, '').slice(0, 6)]; };
  const target = (a) => { const t = String(a.target || ''); if (!t) return '–'; if (firms.has(t)) return `Unternehmen · ${esc(firms.get(t))}`; if (/@/.test(t)) return esc(t); if (/^[0-9a-f-]{36}$/.test(t)) return `${/^invoice/.test(a.action) ? 'Rechnung' : /^user/.test(a.action) ? 'Konto' : 'Datensatz'} · ${t.slice(0, 8)}`; return esc(t.replace(/^ps:/, 'Person ').slice(0, 24)); };
  const det = (m) => { if (!m || typeof m !== 'object') return ''; return Object.entries(m).filter(([, x]) => x != null && x !== '' && !(Array.isArray(x) && !x.length)).slice(0, 6).map(([k, x]) => `<span class="aud-kv"><b>${esc(k)}</b> ${esc(typeof x === 'object' ? JSON.stringify(x) : String(x)).slice(0, 80)}</span>`).join(''); };
  const rows = r.data.audit;
  const cats = [['', 'Alle'], ['sec', 'Sicherheit'], ['b2b', 'Unternehmen'], ['user', 'Konten'], ['fin', 'Finanzen'], ['sys', 'System']];
  v.innerHTML = `<section class="pt-card"><div class="aud-h"><h2>Audit-Protokoll</h2>${r.data.pseudonymized ? '<button type="button" class="btn btn-outline btn-sm" id="pvReveal">Klartext anzeigen (wird protokolliert)</button>' : '<strong class="st warn">Klartext – dieser Abruf wurde protokolliert</strong>'}</div>
    <p class="form-note">Personen-Kennungen sind pseudonymisiert. Einträge werden nach 90 Tagen gelöscht – außer Rechnungs- und Vertragsvorgänge (Aufbewahrungspflicht).</p>
    <div class="pc-chips" role="group" aria-label="Kategorie">${cats.map(([k, l]) => `<button type="button" data-ac="${k}" aria-pressed="${k === '' ? 'true' : 'false'}">${l} <b>${k ? rows.filter((a) => AUD_CAT(a.action) === k).length : rows.length}</b></button>`).join('')}</div>
    ${rows.length ? audDays(rows, (a) => { const [kind, name] = who(a.actor_email); return `<li data-cat="${AUD_CAT(a.action)}" class="aud-${AUD_CAT(a.action)}"><time>${dtt(a.created_at)}</time><div class="aud-main"><strong>${esc(AUD[a.action] || a.action.replace(/_/g, ' '))}</strong><span class="aud-who"><i>${kind}</i>${esc(name)}</span>${target(a) !== '–' || det(a.meta) ? `<details class="aud-more"><summary>Details</summary>${target(a) !== '–' ? `<span class="aud-tgt">${target(a)}</span>` : ''}${det(a.meta) ? `<div class="aud-det">${det(a.meta)}</div>` : ''}</details>` : ''}</div></li>`; }) : '<p class="form-note">Noch keine Einträge.</p>'}</section>`;
  $('#pvReveal')?.addEventListener('click', () => protokoll(v, true));
  v.querySelectorAll('[data-ac]').forEach((b) => b.onclick = () => { v.querySelectorAll('[data-ac]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); v.querySelectorAll('.aud-list li').forEach((li) => { li.hidden = Boolean(b.dataset.ac) && li.dataset.cat !== b.dataset.ac; }); });
}

async function kennzahlen(v) {
  const r = await api('/api/admin/stats');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const j = r.data;
  const n = (x) => (x == null ? '–' : x.toLocaleString('de-DE'));
  const tile = (l, x) => `<div class="an-chip"><small>${l}</small><strong>${x}</strong></div>`;
  const on = (b) => (b ? '<span class="st ok">aktiv</span>' : '<span class="st bad">fehlt</span>');
  const chips = j.scope === 'b2b'
    ? [['Unternehmenskonten', n(j.b2b)], ['davon mit aktivem Tarif', n(j.b2bActive)], ['Kundenanfragen gesamt', n(j.leads)], ['Kontaktanfragen offen', n(j.contactsOpen)], ['Mandanten-Mappen', n(j.versions)], ['Einreichungen', n(j.submissions)], ['Co-Branding-Partner (alt)', n(j.partners)]]
    : [['Privatkonten', n(j.users)], ['Neu (7 Tage)', n(j.users7)], ['Objekte', n(j.objects)], ['Dokumente', n(j.docs)], ['Freigaben aktiv', `${n(j.sharesActive)} / ${n(j.shares)}`], ['BankReady-Kreditmappen', n(j.versions)], ['Erinnerungen an', n(j.reminders)], ['Offene Unterlagen-Anforderungen', n(j.requestsOpen)]];
  v.innerHTML = `<div class="an-chips">${chips.map(([l, x]) => tile(l, x)).join('')}</div>
    <p class="form-note">Nur ${j.scope === 'b2b' ? 'Unternehmen' : 'Privatkunden'} · Einstellungen: Bezahlung ${on(j.config.billing)} · E-Mail-Versand ${on(j.config.mail)} · Täglicher Lauf ${on(j.config.cron)}</p>`;
}


// Neue Version: NICHT mehr von selbst neu laden (Wunsch Feray – die Seite soll so bleiben, wie sie sie verlassen hat).
// Alle 2 Minuten wird geprüft; gibt es eine neue Version, erscheint unten ein kleiner Hinweis mit „Neu laden“. Sie entscheidet.
const MY_V = new URL(import.meta.url).searchParams.get('v') || '';
function watchVersion() {
  if (!MY_V) return;
  let shown = false;
  const show = () => {
    if (shown) return; shown = true;
    const b = document.createElement('div');
    b.className = 'lr-upd'; b.setAttribute('role', 'status');
    b.innerHTML = '<span>Neue Version verfügbar</span><button type="button">Neu laden</button><button type="button" aria-label="Später">×</button>';
    // Handy: über der unteren Leiste, einzeilig (kein Umbruch, verdeckt keine Knöpfe); PC: unten mittig.
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
    } catch { /* offline – später erneut */ }
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

// ---------- Analyse: Besucher, Herkunft, Geräte, Weg zum Kauf (cookielos, nur Zahlen) ----------
let AN_DAYS = 1; // beim Öffnen immer zuerst „Heute“
async function analyse(v) {
  if (!v.querySelector('#anBody')) AN_DAYS = 1; // frisch geöffnet: zuerst „Heute“
  const seg = getSeg(), nf = (x) => Number(x || 0).toLocaleString('de-DE');
  v.innerHTML = `<section class="wa-over an"><div class="wa-over-h"><h2>Analyse · ${seg === 'b2b' ? 'B2B (Unternehmen)' : 'B2C (Privatkunden)'}</h2>
    <p class="form-note">Reichweitenmessung ohne Cookies und ohne gespeicherte IP-Adressen. Bereich oben rechts umschalten (B2C ⇄ B2B).</p></div>
    <div class="wa-period"><div class="seg" role="group" aria-label="Zeitraum">${[[1, 'Heute'], [7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage'], [365, '12 Monate']].map(([k, l]) => `<button type="button" data-ad="${k}" aria-pressed="${k === AN_DAYS}">${l}</button>`).join('')}</div></div>
    <details class="pt-card an-ga" id="anGa"><summary><strong>Google Analytics 4</strong> <span class="form-note" id="anGaSt">wird geprüft …</span></summary>
      <form id="anGaF" class="an-ga-f"><label>Mess-ID<input name="gid" placeholder="G-XXXXXXXXXX" autocomplete="off" spellcheck="false" maxlength="16"></label>
      <label class="chk"><input type="checkbox" name="on"> Einschalten (Besucher werden vorher um Einwilligung gebeten)</label>
      <button class="btn btn-dark btn-sm" type="submit">Speichern</button><p class="form-note" id="anGaMsg" role="status">Mess-ID: Google Analytics → Verwaltung → Datenstreams → Web. Die eigene cookielose Messung unten läuft unabhängig weiter.</p></form></details>
    <div id="anBody"><p class="lr-ld" role="status">Wird geladen …</p></div></section>`;
  api('/api/admin/ga').then((g) => {
    const f = $('#anGaF'); if (!f || !g.ok) { const st = $('#anGaSt'); if (st) st.textContent = 'nur für Inhaber'; return; }
    f.gid.value = g.data.id; f.on.checked = g.data.on;
    $('#anGaSt').textContent = g.data.on ? `aktiv · ${g.data.id}` : g.data.id ? 'ausgeschaltet' : 'nicht eingerichtet';
    f.onsubmit = async (e) => { e.preventDefault(); const r = await api('/api/admin/ga', { method: 'POST', body: JSON.stringify({ id: f.gid.value.trim().toUpperCase(), on: f.on.checked }) }); $('#anGaMsg').textContent = r.ok ? r.data.message : r.data?.error || 'Fehler'; if (r.ok) $('#anGaSt').textContent = r.data.on ? `aktiv · ${r.data.id}` : 'ausgeschaltet'; };
  });
  v.querySelectorAll('[data-ad]').forEach((b) => b.onclick = () => { AN_DAYS = Number(b.dataset.ad); v.querySelectorAll('[data-ad]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); });
  const load = async () => {
    const box = $('#anBody'); box.style.opacity = '.55';
    const r = await api(`/api/admin/system?analytics=${seg}&days=${AN_DAYS}`);
    box.style.opacity = '';
    if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
    const d = r.data, ev = d.events || {}, evv = d.eventVisitors || {};
    const delta = (a, b) => { if (!b) return a ? '<small class="an-d up">neu</small>' : ''; const p = Math.round(((a - b) / b) * 100); return `<small class="an-d ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)} % zum Vorzeitraum</small>`; };
    const tile = (l, val, sub = '') => `<div class="wa-tile"><span class="wa-tile-l">${l}</span><strong>${val}</strong>${sub}</div>`;
    const ppv = d.visitors ? (d.pageviews / d.visitors).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–';
    const tiles = seg === 'b2b' ? [
      tile('Besucher', nf(d.visitors), delta(d.visitors, d.prevVisitors)), tile('Seitenaufrufe', nf(d.pageviews), delta(d.pageviews, d.prevPageviews)), tile('Seiten je Besuch', ppv),
      tile('Kontoanfragen', nf(ev.b2b_request), '<small>über Formular / Portal</small>'), tile('Demo & Kontakt', nf(ev.b2b_contact)), tile('Portal-Anmeldungen', nf(ev.b2b_login)),
      tile('Klicks „Demo anfragen“', nf(ev.b2b_demo_klick), '<small>/business und /business-portal</small>'), tile('Klicks „Unterlagen per E-Mail“', nf(ev.b2b_unterlagen_klick)),
      tile('Tarif-Bezahlseite geöffnet', nf(ev.checkout_start)), tile('Tarife gebucht', nf(d.purchases)),
    ] : [
      tile('Besucher', nf(d.visitors), delta(d.visitors, d.prevVisitors)), tile('Seitenaufrufe', nf(d.pageviews), delta(d.pageviews, d.prevPageviews)), tile('Seiten je Besuch', ppv),
      tile('Registrierungen', nf(d.registrations), '<small>neue Konten (aus der Datenbank)</small>'), tile('Anmeldungen', nf(ev.login)),
      tile('Kauf-Dialog geöffnet', nf(ev.checkout_open)), tile('Zur Bezahlseite', nf(ev.checkout_start)), tile('Käufe', nf(d.purchases), '<small>bestätigt durch Stripe</small>'),
    ];
    const steps = seg === 'b2b'
      ? [['Besucher', d.visitors], ['Seite „Für Unternehmen“ gesehen', d.offerVisitors], ['Konto angefragt', ev.b2b_request], ['Im Portal angemeldet', evv.b2b_login], ['Tarif gebucht', d.purchases]]
      : [['Besucher', d.visitors], ['Preise angesehen', d.offerVisitors], ['Registriert', d.registrations], ['Kauf-Dialog geöffnet', evv.checkout_open], ['Zur Bezahlseite', evv.checkout_start], ['Gekauft', d.purchases]];
    const first = Number(steps[0][1] || 0);
    const funnel = steps.map(([l, n], i) => { n = Number(n || 0); const prev = i ? Number(steps[i - 1][1] || 0) : n, pct = first ? Math.round((n / first) * 100) : 0; return `<div class="fn-row"><span class="fn-l">${esc(l)}</span><span class="fn-bar"><i style="width:${first ? Math.max(n ? 2 : 0, Math.min(100, pct)) : 0}%"></i></span><strong class="fn-n">${nf(n)}</strong><small class="fn-c">${i ? (prev ? `${Math.round((n / prev) * 100)} % vom Schritt davor` : '–') : 'Start'}</small></div>`; }).join('');
    const list = (title, rows, lab = (x) => x, unit = 'Besucher') => { const max = Math.max(1, ...rows.map((r) => Number(r[1]))); return `<section class="pt-card an-list"><h3>${title}</h3>${rows.length ? `<ol>${rows.map((r) => `<li><span class="an-bar" style="--w:${Math.round((Number(r[1]) / max) * 100)}%"></span><span class="an-k">${esc(lab(r[0]))}</span><b>${nf(r[1])}</b></li>`).join('')}</ol><p class="form-note">${unit}</p>` : '<p class="form-note">Noch keine Daten.</p>'}</section>`; };
    const DEV = { mobile: 'Smartphone', tablet: 'Tablet', desktop: 'Computer', '?': 'Unbekannt' };
    let cn; try { cn = new Intl.DisplayNames(['de'], { type: 'region' }); } catch { cn = null; }
    box.innerHTML = `<div class="wa-tiles">${tiles.join('')}</div>
      <section class="pt-card"><h3>Besucher und Seitenaufrufe je Tag</h3>${chart(d.series || [], AN_DAYS)}</section>
      <section class="pt-card"><h3>Weg zum ${seg === 'b2b' ? 'Unternehmenskonto' : 'Kauf'}</h3><div class="fn">${funnel}</div><p class="form-note">Besucherzahlen je Schritt im gewählten Zeitraum. Registrierungen und Käufe kommen aus Datenbank bzw. Stripe und sind deshalb auch bei aktivem „Do Not Track“ vollständig.</p></section>
      <div class="an-grid">${list('Beliebteste Seiten', (d.pages || []).map((p) => [p[0], p[1]]), (x) => x, 'Seitenaufrufe')}${list('Herkunft', d.refs || [])}${list('Kampagnen (utm)', d.campaigns || [])}${list('Geräte', d.devices || [], (x) => DEV[x] || x)}${list('Browser', d.browsers || [])}${list('Betriebssystem', d.os || [])}${list('Länder', d.countries || [], (x) => (x === '??' ? 'Unbekannt' : (cn ? cn.of(x) : x)))}</div>
      <div class="an-grid an-geo">${list('Städte', (d.cities || []).map(([c, r, k, n]) => [`${c}${r ? ' · ' + (k === 'DE' && BL[r] ? BL[r] : r) : ''}${k && k !== 'DE' ? ' (' + k + ')' : ''}`, n]))}${list('Bundesländer / Regionen', (d.regions || []).map(([r, k, n]) => [k === 'DE' && BL[r] ? BL[r] : `${r} (${k})`, n]))}</div>
      <p class="form-note">Besucher = eindeutige Besucher je Tag, über den Zeitraum summiert (ohne Cookies ist ein Wiedererkennen über Tage bewusst nicht möglich). Nicht gezählt: Administratoren-Bereich, Bots, Besucher mit „Do Not Track“ bzw. Global Privacy Control. Ort: ungefähr, aus der IP-Adresse abgeleitet (IP wird nicht gespeichert); Städte erst ab dem 17.10.2026. Erfassung seit Oktober 2026.</p>`;
  };
  load();
}

const BL = { BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen' };

// Kleines Liniendiagramm (SVG) für die Tageswerte.
// Tagesreihe bis einschließlich heute auffüllen: Tage ohne Zahlen erscheinen als 0, der heutige Tag ist immer sichtbar.
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
  const grid = []; for (let v = 0; v <= top; v += step) grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="an-g"/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="an-t">${v.toLocaleString('de-DE')}</text>`);
  const every = Math.max(1, Math.ceil(series.length / (sm ? 4 : 8)));
  const lab = series.map((x, i) => ((i % every === 0 && series.length - 1 - i >= every / 2) || i === series.length - 1) ? `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === series.length - 1 && series.length > 1 ? 'end' : 'middle'}" class="an-t">${i === series.length - 1 ? 'Heute' : new Date(x[0]).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</text>` : '').join('');
  const dots = series.length <= 31 ? series.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x[1])}" r="3" class="an-dv"><title>${new Date(x[0]).toLocaleDateString('de-DE')}: ${x[1]} Besucher, ${x[2]} Aufrufe</title></circle>`).join('') : '';
  return `<div class="an-legend"><span class="an-lv">Besucher</span><span class="an-lp">Seitenaufrufe</span></div><svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Besucher und Seitenaufrufe je Tag">${grid.join('')}<path d="${line(2)}" class="an-p"/><path d="${line(1)}" class="an-v"/>${dots}${lab}</svg>`;
}

// ---------- Einrichtung: offene Punkte mit Anleitung, Erledigtes eingeklappt ----------
async function einrichtung(v) {
  const r = await api('/api/admin/setup');
  if (!r.ok) { errState(v, r.data?.error); return; }
  const all = r.data.items || [];
  const open = all.filter((x) => !x.ok), done = all.filter((x) => x.ok);
  const must = open.filter((x) => !x.optional);
  const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
  const groups = [...new Set(all.map((x) => x.group))];
  const card = (x) => `<li class="su-li"><button type="button" class="su-item su-row${x.optional ? ' opt' : ''}" data-open="${x.id}"><span class="su-h"><strong>${esc(x.title)}</strong>${x.optional ? '<span class="su-tag">optional</span>' : ''}<span class="su-tag ${x.auto ? 'auto' : 'man'}">${x.auto ? 'wird automatisch erkannt' : 'selbst abhaken'}</span></span>
      <span class="su-sub">${esc(x.why)}</span><span class="su-go">${x.time ? `ca. ${esc(x.time)} · ` : ''}Anleitung öffnen ›</span></button><button type="button" class="btn btn-outline btn-sm su-done" data-done="${x.id}" aria-label="${esc(x.title)} als erledigt markieren">✓ Erledigt</button></li>`;
  const doneRow = (x) => `<li class="su-dli"><span>✓ ${esc(x.title)}<small>${x.by === 'auto' ? 'automatisch erkannt' : `abgehakt${x.doneAt ? ` am ${esc(new Date(x.doneAt).toLocaleDateString('de-DE'))}` : ''}`}</small></span>${x.by === 'manuell' ? `<button type="button" class="btn btn-ghost btn-sm" data-reopen="${x.id}">Wieder öffnen</button>` : ''}</li>`;
  v.innerHTML = `<section class="wa-over"><div class="wa-over-h"><h2>Einrichtung</h2><p class="form-note">${must.length ? `<strong>${must.length} Pflichtpunkt${must.length === 1 ? '' : 'e'} offen</strong>${open.length > must.length ? `, ${open.length - must.length} optional` : ''}.` : '<strong>Alle Pflichtpunkte erledigt.</strong>'} Tippen Sie auf einen Punkt – dann kommt die genaue Schritt-für-Schritt-Anleitung. Werte nie per Chat oder E-Mail weitergeben, immer direkt in Vercel eintragen.</p></div>
    <div class="su-bar" role="img" aria-label="${pct} Prozent erledigt"><i style="width:${pct}%"></i></div><p class="form-note">${done.length} von ${all.length} erledigt</p>
    ${groups.map((g) => { const o = open.filter((x) => x.group === g); return o.length ? `<h3 class="wa-sub">${esc(g)}</h3><ol class="su-list">${o.map(card).join('')}</ol>` : ''; }).join('') || '<p class="pt-alert ok">Alles eingerichtet.</p>'}
    ${done.length ? `<details class="su-donebox"><summary>Erledigt (${done.length})</summary><ul class="su-dlist">${done.map(doneRow).join('')}</ul></details>` : ''}</section>`;
  const mark = async (id, val) => { const x = await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ id, done: val }) }); if (!x.ok) msg(x.data?.error || 'Fehler', true); einrichtung(v); };
  v.querySelectorAll('[data-done]').forEach((b) => b.onclick = () => { b.disabled = true; b.textContent = '…'; mark(b.dataset.done, true); });
  v.querySelectorAll('[data-reopen]').forEach((b) => b.onclick = () => { b.disabled = true; mark(b.dataset.reopen, false); });
  const guide = (x) => {
    let d = document.getElementById('suDlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'suDlg'; d.className = 'wa-dlg'; document.body.append(d); }
    const n = x.steps.length;
    d.innerHTML = `<div class="wa-dlg-in su-guide"><div class="wa-dlg-h"><h2>${esc(x.title)}</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
      <p class="su-state ${x.ok ? 'ok' : 'open'}">${x.ok ? '✓ Erledigt' : 'Offen'}${x.time ? ` · Dauer ca. ${esc(x.time)}` : ''} · ${n} Schritt${n === 1 ? '' : 'e'}${x.info ? ` · ${esc(x.info)}` : ''}</p>
      <div class="su-why"><strong>Wozu?</strong> ${esc(x.why)}</div>
      ${x.need ? `<div class="su-need"><strong>Vorher bereitlegen:</strong> ${esc(x.need)}</div>` : ''}
      <ol class="su-gsteps">${x.steps.map((st, i) => `<li><label><input type="checkbox" data-st="${i}"><span class="su-num">${i + 1}</span><span class="su-txt">${st}</span></label></li>`).join('')}</ol>
      ${(x.copy || []).map((c, i) => `<div class="su-copy"><div class="su-copy-h"><strong>${esc(c.label.replace(/ kopieren$/, ''))}</strong><button type="button" class="btn btn-dark btn-sm" data-cp="${i}">${esc(c.label)}</button></div><textarea class="su-copy-t" readonly rows="8" aria-label="${esc(c.label)}">${esc(c.text)}</textarea></div>`).join('')}
      ${x.check ? `<div class="su-check"><strong>So prüfen Sie, ob es geklappt hat:</strong> ${x.check}</div>` : ''}
      <p class="form-note">Die Häkchen an den Schritten sind nur Ihre Merkhilfe und werden in diesem Browser gespeichert.</p>
      <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Schließen</button>${x.ok ? (x.by === 'manuell' ? `<button type="button" class="btn btn-outline" data-un>Wieder öffnen</button>` : '') : `${x.auto ? `<button type="button" class="btn btn-outline" data-re>Erneut prüfen</button>` : ''}<button type="button" class="btn btn-dark" data-ok>Fertig – als erledigt markieren</button>`}</div></div>`;
    const K = 'su_' + x.id; let st = {}; try { st = JSON.parse(localStorage.getItem(K) || '{}'); } catch { /* privat */ }
    d.querySelectorAll('[data-st]').forEach((c) => { c.checked = Boolean(st[c.dataset.st]); c.onchange = () => { st[c.dataset.st] = c.checked; try { localStorage.setItem(K, JSON.stringify(st)); } catch { /* privat */ } }; });
    d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
    d.querySelectorAll('[data-cp]').forEach((b) => b.onclick = async () => {
      const t = (x.copy || [])[Number(b.dataset.cp)]?.text || '', o = b.textContent;
      try { await navigator.clipboard.writeText(t); b.textContent = 'Kopiert ✓'; } catch { const ta = b.closest('.su-copy')?.querySelector('textarea'); ta?.focus(); ta?.select(); b.textContent = 'Markiert – jetzt kopieren'; }
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
