// Web-Admin (nur ADMIN_EMAILS, mit zweitem Faktor): Finanz-Cockpit, System, Nutzer, Sicherheit, Partner, Rechnungsarchiv,
// Steuer-Export, Anfragen und Codes, Protokoll und Betreiber-Kennzahlen.
import { api, download, dt, dtt, esc, eur, loginForm, logout, session, setSession, supa, token } from './sess.mjs';

const root = document.getElementById('intern');
const $ = (s, el = document) => el.querySelector(s);
const TIER = { BASIC: 'Basic', PRO: 'Pro', ENTERPRISE: 'Enterprise' };
const PAY = { PAID: 'bezahlt', PENDING: 'offen', OVERDUE: 'überfällig', CANCELLED: 'storniert' };
const msg = (t, bad = false) => { const el = $('#adMsg'); if (el) { el.textContent = t; el.className = 'form-note ' + (bad ? 'st bad' : ''); } };

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
    const m = await import('./mfa.mjs');
    const { factors } = await m.factorsOf(token());
    if (factors.length) { root.innerHTML = '<div class="pt-card ad-mfa" id="adMfa"></div>'; await m.challengeUI($('#adMfa'), session(), () => location.reload()); return; }
  } catch { /* weiter mit Einrichtung */ }
  const auth = { Authorization: 'Bearer ' + token() };
  const u = await supa('/auth/v1/user', { headers: auth }).then((x) => x.json()).catch(() => ({}));
  const verified = (u.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
  let factorId = verified?.id;
  let enrollHtml = '';
  if (!factorId) {
    // Unbestätigte Altfaktoren entfernen, dann neu einrichten.
    for (const f of (u.factors || []).filter((x) => x.status !== 'verified')) await supa(`/auth/v1/factors/${f.id}`, { method: 'DELETE', headers: auth });
    const e = await supa('/auth/v1/factors', { method: 'POST', headers: auth, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'ImmoAdv Admin ' + new Date().toISOString().slice(0, 10) }) });
    const ej = await e.json().catch(() => ({}));
    if (!e.ok) { root.innerHTML = `<h1>Zweiter Faktor</h1><p>Einrichtung nicht möglich: ${esc(ej.msg || ej.error_description || e.status)}. In Supabase unter Authentication → Multi-Factor muss TOTP aktiviert sein.</p>`; return; }
    factorId = ej.id;
    enrollHtml = `<p>1. Diesen Code mit einer Authenticator-App scannen (Google Authenticator, 1Password, Authy):</p>
      <img src="${esc(ej.totp.qr_code)}" alt="QR-Code für die Authenticator-App" width="200" height="200">
      <p class="form-note">Oder Schlüssel manuell eingeben: <code>${esc(ej.totp.secret)}</code></p><p>2. Den 6-stelligen Code aus der App eingeben:</p>`;
  }
  root.innerHTML = `<div class="ad-mfa pt-card"><h1>Zweiter Faktor</h1>${enrollHtml || '<p>Bitte den 6-stelligen Code aus Ihrer Authenticator-App eingeben.</p>'}
    <form id="mfaF" class="pt-row"><input id="mfaC" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Code" style="font-size:22px;letter-spacing:.2em;width:9ch;padding:8px 10px;border:1px solid #CBD5E1;border-radius:6px"><button class="btn btn-dark" type="submit">Bestätigen</button></form>
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
const SEGS = { b2c: 'Privatkunden (B2C)', b2b: 'Unternehmen (B2B)' };
const getSeg = () => { try { return localStorage.getItem('ia-admin-seg') === 'b2b' ? 'b2b' : 'b2c'; } catch { return 'b2c'; } };
const setSeg = (x) => { try { localStorage.setItem('ia-admin-seg', x); } catch { /* nur Komfort */ } };
const TABS = [['uebersicht', 'Übersicht'], ['einrichtung', 'Einrichtung'], ['analyse', 'Analyse'], ['cockpit', 'Finanz-Cockpit'], ['system', 'System'], ['testkauf', 'Testkauf'], ['nutzer', 'Nutzer'], ['sicherheit', 'Sicherheit'], ['partner', 'Partner'], ['rechnungen', 'Rechnungen'], ['steuer', 'Rechnungen-ZIP'], ['anfragen', 'Anfragen & Codes'], ['akquise', 'Akquise'], ['werbung', 'Werbung'], ['protokoll', 'Protokoll'], ['kennzahlen', 'Kennzahlen']];

function paintSeg() {
  const chip = $('#adSeg'); if (!chip) return;
  const g = getSeg();
  chip.innerHTML = `${g === 'b2b' ? 'B2B · Unternehmen' : 'B2C · Privatkunden'} <span aria-hidden="true">⇄</span>`;
  chip.dataset.seg = g; document.body.dataset.adSeg = g;
}

function frame() {
  root.innerHTML = `<div class="ad-head"><h1>Admin-Zentrale</h1><div class="ad-head-act"><button type="button" class="mode-chip ad-seg-chip" id="adSeg" aria-label="Bereich wechseln: Privatkunden oder Unternehmen"></button><button type="button" class="btn btn-outline" id="adLogout">Abmelden</button></div></div><p class="form-note">Nur für Administratoren · angemeldet mit zweitem Faktor · alle Aktionen werden protokolliert · automatische Abmeldung nach 15 Minuten ohne Aktivität.</p>
    <div class="ad-shell"><div class="ad-tabs" role="tablist" aria-label="Bereiche">${TABS.map(([k, l]) => `<button type="button" role="tab" data-t="${k}">${l}</button>`).join('')}</div>
    <div class="ad-main"><p id="adMsg" class="form-note" role="status"></p><div id="adView"></div></div></div>`;
  root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { location.hash = b.dataset.t; });
  $('#adLogout').onclick = logout;
  const chip = $('#adSeg');
  paintSeg();
  chip.onclick = () => {
    setSeg(getSeg() === 'b2b' ? 'b2c' : 'b2b'); paintSeg();
    // Weicher Wechsel wie beim Modus-Umschalter: kurz ausblenden, neu laden, einblenden.
    const v = $('#adView'); v.classList.add('ad-switching');
    setTimeout(() => { show(); requestAnimationFrame(() => v.classList.remove('ad-switching')); }, 140);
  };
}

function show() {
  const h = location.hash.slice(1).split('-')[0];
  const t = TABS.find(([k]) => k === h)?.[0] || 'uebersicht';
  root.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
  root.querySelector(`[data-t="${t}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  const v = $('#adView');
  v.innerHTML = '<p class="form-note">Wird geladen …</p>';
  msg('');
  ({ uebersicht, einrichtung, analyse, testkauf, cockpit, system: (x) => system(x, location.hash.includes('-mail')), nutzer: (x) => nutzer(x, 1, '', getSeg()), sicherheit, partner, rechnungen, steuer, anfragen, protokoll, kennzahlen, akquise: (x) => import('./intern-marketing.mjs').then((m) => m.akquise(x)), werbung: (x) => import('./intern-marketing.mjs').then((m) => m.werbung(x)) })[t](v);
}

// ---------- Nutzer: Konten im Überblick, sperren/entsperren, Passwort-Reset ----------
async function nutzer(v, page = 1, q = '', seg = 'b2c') {
  const r = await api(`/api/admin/users?page=${page}&seg=${seg}&q=${encodeURIComponent(q)}`);
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  const us = r.data.users || [];
  const ago = (x) => (x ? dtt(x) : 'nie');
  v.innerHTML = `<section class="pt-card"><h2>Nutzer</h2>
    <div class="seg us-seg" role="tablist" aria-label="Bereich">${[['b2c', 'Privatkunden (B2C)'], ['b2b', 'Unternehmen (B2B)'], ['admin', 'Administratoren']].map(([k, l]) => `<button type="button" data-seg="${k}" aria-selected="${k === seg}">${l}</button>`).join('')}</div>
    <form class="ad-search" id="usF"><input id="usQ" type="search" placeholder="E-Mail suchen" value="${esc(q)}" aria-label="E-Mail suchen" autocomplete="off"><button class="btn btn-dark" type="submit">Suchen</button></form>
    <p class="form-note">${us.length} Konten auf dieser Seite. Angezeigt werden nur Kontodaten – keine Inhalte. Jede Aktion wird protokolliert.</p>
    <div class="us-list">${us.map((u) => `<article class="us-card${u.banned ? ' banned' : ''}">
      <div class="us-top"><strong>${esc(u.email || '(ohne E-Mail)')}</strong><span class="us-tags">${u.admin ? '<span class="st ok">Admin</span>' : ''}${u.banned ? '<span class="st bad">gesperrt</span>' : ''}${u.confirmed ? '' : '<span class="st warn">unbestätigt</span>'}${u.mfa ? '<span class="st ok">2FA</span>' : '<span class="st">ohne 2FA</span>'}</span></div>
      ${u.company ? `<p class="us-co"><strong>${esc(u.company.name)}</strong> · ${esc(u.company.number || '')} · ${u.company.role === 'owner' ? 'Inhaber' : 'Berater'} · ${u.company.verified ? '<span class="st ok">verifiziert</span>' : `<span class="st warn">${esc(u.company.status || 'offen')}</span>`}</p>` : ''}
      <dl class="us-meta"><div><dt>Registriert</dt><dd>${dt(u.createdAt)}</dd></div><div><dt>Letzte Anmeldung</dt><dd>${ago(u.lastSignIn)}</dd></div></dl>
      <div class="us-act">${u.confirmed ? '' : `<button type="button" class="btn btn-dark" data-us="confirm" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">Bestätigung erneut senden</button>`}<button type="button" class="btn btn-outline" data-us="reset" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">Passwort-Reset senden</button>${u.admin ? '' : `<button type="button" class="btn ${u.banned ? 'btn-outline' : 'btn-danger'}" data-us="${u.banned ? 'unban' : 'ban'}" data-id="${esc(u.id)}" data-mail="${esc(u.email)}">${u.banned ? 'Entsperren' : 'Sperren'}</button>`}</div>
    </article>`).join('') || '<p class="form-note">Keine Konten gefunden.</p>'}</div>
    <div class="pt-row">${page > 1 ? '<button class="btn btn-ghost" id="usPrev" type="button">← Zurück</button>' : ''}${r.data.more ? '<button class="btn btn-ghost" id="usNext" type="button">Weiter →</button>' : ''}</div></section>`;
  $('#usF').onsubmit = (e) => { e.preventDefault(); nutzer(v, 1, $('#usQ').value.trim(), seg); };
  v.querySelectorAll('[data-seg]').forEach((b) => b.onclick = () => { if (b.dataset.seg !== 'admin') { setSeg(b.dataset.seg); paintSeg(); } nutzer(v, 1, '', b.dataset.seg); });
  $('#usPrev')?.addEventListener('click', () => nutzer(v, page - 1, q, seg));
  $('#usNext')?.addEventListener('click', () => nutzer(v, page + 1, q, seg));
  v.querySelectorAll('[data-us]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.us, m = b.dataset.mail;
    const ask = { ban: `Konto ${m} sperren? Anmelden ist dann nicht mehr möglich; offene Sitzungen laufen spätestens nach einer Stunde aus.`, unban: `Konto ${m} wieder freigeben?`, confirm: `Bestätigungs-E-Mail erneut an ${m} senden?`, reset: `E-Mail zum Zurücksetzen des Passworts an ${m} senden?` }[a];
    if (!confirm(ask)) return;
    b.disabled = true;
    const x = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ action: a, id: b.dataset.id }) });
    if (!x.ok) { msg(x.data?.error || 'Aktion fehlgeschlagen.', true); b.disabled = false; return; }
    msg({ ban: 'Konto gesperrt.', unban: 'Konto freigegeben.', confirm: 'Bestätigungs-E-Mail gesendet.', reset: 'E-Mail zum Zurücksetzen gesendet.' }[a]);
    nutzer(v, page, q, seg);
  });
}

// ---------- Übersicht: Kacheln je Bereich (B2C | B2B) ----------
const MAILS = {
  b2c: [
    ['Registrierung bestätigen', 'immoadv'], ['Passwort zurücksetzen', 'immoadv'], ['Bestätigung erneut / Anmeldelink', 'immoadv'],
    ['Kündigungsbestätigung', 'resend'], ['Erinnerungen & Datenraum-Freigaben', 'resend'], ['Zahlungsbelege & Rechnungen', 'stripe'],
  ],
  b2b: [
    ['Registrierung bestätigen (Portal)', 'immoadv'], ['Registrierungsnachweis (PDF) an Kunde und Geschäftsadresse', 'b2bmail'],
    ['Einladungen ins Team', 'resend'], ['Neue Kundenanfragen und Einreichungen', 'resend'], ['Prüfung der Unterlagen (Ergebnis)', 'resend'], ['Rechnungen auf Rechnung (PDF)', 'resend'],
  ],
};
function mailState(kind, m) {
  if (kind === 'stripe') return ['gelb', 'über Stripe – Logo/Name in Stripe → Branding'];
  if (kind === 'b2bmail') return m.ready ? (m.b2bNotify ? ['gruen', 'ImmoAdv · an Ihre Geschäftsadresse'] : ['gelb', 'ImmoAdv · Kopie an ADMIN_EMAILS (B2B_NOTIFY_EMAIL fehlt)']) : ['rot', 'wird nicht gesendet'];
  if (kind === 'immoadv') return m.ready ? ['gruen', 'ImmoAdv-Absender'] : ['gelb', 'übergangsweise Supabase-Absender'];
  return m.ready ? ['gruen', 'ImmoAdv-Absender'] : ['rot', 'wird nicht gesendet'];
}

async function uebersicht(v) {
  const seg = getSeg();
  const [r, sys] = await Promise.all([api('/api/admin/system?segment=' + seg), api('/api/admin/system')]);
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  const d = r.data, x = d[seg] || {}, m = sys.data?.mail || {};
  const n = (k) => Number(k || 0).toLocaleString('de-DE');
  const pct = (a, b) => (b ? ` · ${Math.round((a / b) * 100)} %` : '');
  const tile = (label, val, sub = '', go = '', tone = '') => `<${go ? `a href="#${go}"` : 'div'} class="ad-tile${tone ? ' ' + tone : ''}"><span class="ad-tile-l">${label}</span><strong>${val}</strong>${sub ? `<small>${sub}</small>` : ''}</${go ? 'a' : 'div'}>`;
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
  const funnelBox = '<h3 class="ad-sub">Funnel: wo Nutzer abspringen</h3><div class="ad-period fn-period" role="group" aria-label="Zeitraum">' + [['30', '30 Tage'], ['90', '90 Tage'], ['', 'Gesamt']].map(([k, l]) => `<button type="button" data-fn="${k}" aria-pressed="${k === ''}">${l}</button>`).join('') + '</div><div id="funnel" class="fn"><p class="form-note">Wird geladen …</p></div>';
  const mails = MAILS[seg].map(([l, k]) => { const [a, t] = mailState(k, m); return `<li><span class="ad-amp ${a}"></span><span>${l}</span><small>${t}</small></li>`; }).join('');
  v.innerHTML = `<section class="ad-over">
    <div class="ad-over-h"><h2>${SEGS[seg]}</h2><p class="form-note">Gleiche Kennzahlen, getrennt nach Bereich. Umschalten oben rechts (${seg === 'b2b' ? 'B2B' : 'B2C'} ⇄). Administratoren zählen nicht mit. Nur Zahlen, keine Inhalte.</p></div>
    <h3 class="ad-sub">Konten & Nutzung</h3><div class="ad-tiles">${common.join('')}</div>
    <h3 class="ad-sub">${seg === 'b2b' ? 'Unternehmen, Anfragen & Abrechnung' : 'Kunden & Umsatz'}</h3><div class="ad-tiles">${spec.join('')}</div>
    ${funnelBox}
    <h3 class="ad-sub">E-Mails an ${seg === 'b2b' ? 'Unternehmen' : 'Privatkunden'}</h3>
    <div class="ad-tiles ad-tiles-wide"><div class="ad-tile ad-mailtile${m.ready ? '' : ' warn'}"><span class="ad-tile-l">Absender</span><strong>${m.ready ? esc(m.from) : 'noch nicht eingerichtet'}</strong>
      <ul class="ad-mails">${mails}</ul>
      <a class="btn ${m.ready ? 'btn-outline' : 'btn-dark'}" href="#system-mail">${m.ready ? 'E-Mail-Einstellungen' : 'Jetzt einrichten – Schritt für Schritt'}</a></div></div>
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
  const domOk = m.fromDomain === 'immoadv.de';
  const steps = [
    ['Resend-Konto und Domain', `Auf <a href="https://resend.com/domains" target="_blank" rel="noopener">resend.com → Domains</a> „Add Domain“ → <code>immoadv.de</code>, Region <strong>Frankfurt (eu-central-1)</strong>.`, st(m.ready ? true : null, m.ready ? 'erledigt' : 'manuell')],
    ['DNS bei Hostinger eintragen', 'Hostinger → Domains → immoadv.de → DNS. Die drei Einträge, die Resend anzeigt, genau übernehmen (MX und TXT für „send“, TXT „resend._domainkey“). Zusätzlich empfohlen: TXT <code>_dmarc</code> mit <code>v=DMARC1; p=none;</code>. Danach bei Resend „Verify DNS Records“ (dauert einige Minuten).', st(m.ready ? true : null, m.ready ? 'erledigt' : 'manuell')],
    ['API-Schlüssel in Vercel', `Resend → API Keys → „Create“ (Sending access, Domain immoadv.de). In <a href="https://vercel.com/klk19/immoadv/settings/environment-variables" target="_blank" rel="noopener">Vercel → Environment Variables</a> eintragen: <code>RESEND_API_KEY</code> (Schlüssel), <code>NOTIFY_FROM_EMAIL</code> = <code>noreply@immoadv.de</code>, <code>B2B_NOTIFY_EMAIL</code> = Ihre Geschäftsadresse. Danach neu deployen. Schlüssel nie per Chat oder E-Mail weitergeben.`,
      `${st(m.resendKey, m.resendKey ? 'Schlüssel gesetzt' : 'Schlüssel fehlt')} ${st(m.fromSet ? (domOk ? true : null) : false, m.fromSet ? (domOk ? 'Absender @immoadv.de' : 'Absender nicht @immoadv.de') : 'Absender fehlt')} ${st(m.b2bNotify ? true : null, m.b2bNotify ? 'Geschäftsadresse gesetzt' : 'Geschäftsadresse optional')}`],
    ['Supabase: eigener Absender (SMTP)', `<a href="${SB}/auth/smtp" target="_blank" rel="noopener">Supabase → Authentication → Emails → SMTP Settings</a> → „Enable custom SMTP“. Sender email <code>noreply@immoadv.de</code>, Sender name <code>ImmoAdv</code>, Host <code>smtp.resend.com</code>, Port <code>465</code>, Username <code>resend</code>, Password = Resend-API-Schlüssel. Ersetzt den Absender „Supabase Auth“ in allen übrigen Konto-E-Mails.`, st(null, 'manuell – mit Test 2 prüfen')],
    ['Supabase: ImmoAdv-Vorlagen', `<a href="${SB}/auth/templates" target="_blank" rel="noopener">Supabase → Authentication → Emails → Templates</a>: je Vorlage Betreff und HTML aus der Liste unten einfügen.`, st(null, 'manuell')],
    ['Supabase: Adressen', `<a href="${SB}/auth/url-configuration" target="_blank" rel="noopener">URL Configuration</a>: Site URL <code>https://immoadv.de</code>; Redirect URLs <code>https://immoadv.de/auth/login</code>, <code>/auth/reset</code>, <code>/auth/callback</code>, <code>/auth/confirm</code>, <code>/b2b-portal</code>.`, st(null, 'manuell')],
  ];
  if (m.ready) steps.splice(0, 3); // Resend-Konto, DNS und Schlüssel erledigt → ausblenden
  return `<section class="pt-card ad-mailsetup" id="mailSetup"><h2>E-Mail-Versand (Absender „ImmoAdv“)</h2>
    <p class="form-note">${m.ready ? `Eigener Versand aktiv: <strong>${esc(m.from)}</strong>. Alle E-Mails von ImmoAdv kommen im ImmoAdv-Design mit Logo.` : 'Noch nicht eingerichtet – Konto-E-Mails kommen übergangsweise vom Absender „Supabase Auth“, andere E-Mails (Nachweise, Rechnungen, Kündigungen) werden nicht gesendet.'}</p>
    ${steps.length ? '' : ''}<ol class="ad-steps">${steps.map(([t, b, s2]) => `<li><div class="ad-step-h"><strong>${t}</strong><span class="ad-step-st">${s2}</span></div><p>${b}</p></li>`).join('')}</ol>
    <h3 class="ad-sub">Testen</h3>
    <div class="pt-row"><button class="btn btn-dark" id="sysMail" type="button">Test 1: ImmoAdv-E-Mail an mich</button><button class="btn btn-outline" id="sysAuthMail" type="button">Test 2: Konto-E-Mail über Supabase an mich</button></div>
    <p class="form-note">Test 1 prüft Resend und Ihren Absender. Test 2 schickt einen Passwort-Link über Supabase – kommt er als „ImmoAdv“ mit Logo an, sind SMTP und Vorlagen richtig (Link einfach ignorieren, wenn Sie das Passwort nicht ändern möchten).</p>
    <h3 class="ad-sub">Vorlagen für Supabase</h3>
    <div class="ad-wrap"><table class="ad-table ad-tpl"><thead><tr><th>Vorlage in Supabase</th><th>Betreff</th><th></th></tr></thead><tbody>
    ${(m.templates || []).map((t) => `<tr><td><strong>${esc(t.supabase)}</strong><br><small>${esc(t.label)}</small></td><td><code class="ad-subj">${esc(t.subject)}</code></td><td class="ad-tpl-act"><button type="button" class="btn btn-ghost" data-copy-subj="${esc(t.subject)}">Betreff kopieren</button><button type="button" class="btn btn-outline" data-tpl="${esc(t.id)}" data-act="copy">HTML kopieren</button><button type="button" class="btn btn-ghost" data-tpl="${esc(t.id)}" data-act="dl">Herunterladen</button></td></tr>`).join('')}
    </tbody></table></div></section>`;
}
function bindMailSetup(root2) {
  const done = (t, bad = false) => msg(t, bad);
  $('#sysMail', root2).onclick = async (e) => {
    e.target.disabled = true;
    const x = await api('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'testmail' }) });
    done(x.ok ? `Test-E-Mail an ${x.data.to} gesendet – bitte Posteingang (und Spam) prüfen.` : x.data?.error || 'Fehler', !x.ok); e.target.disabled = false;
  };
  $('#sysAuthMail', root2).onclick = async (e) => {
    if (!confirm('Passwort-Link über Supabase an Ihre Admin-Adresse senden? Ihr Passwort bleibt unverändert, solange Sie den Link nicht verwenden.')) return;
    e.target.disabled = true;
    const x = await api('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'testauth' }) });
    done(x.ok ? `Konto-E-Mail an ${x.data.to} angestoßen – Absender und Design prüfen.` : x.data?.error || 'Fehler', !x.ok); e.target.disabled = false;
  };
  const copy = async (text, b) => {
    try { await navigator.clipboard.writeText(text); const o = b.textContent; b.textContent = 'Kopiert ✓'; setTimeout(() => { b.textContent = o; }, 1600); }
    catch { done('Kopieren nicht möglich – bitte „Herunterladen“ verwenden.', true); }
  };
  root2.querySelectorAll('[data-copy-subj]').forEach((b) => b.onclick = () => copy(b.dataset.copySubj, b));
  root2.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = async () => {
    const path = '/api/admin/system?template=' + encodeURIComponent(b.dataset.tpl);
    if (b.dataset.act === 'dl') { try { await download(path, {}, `immoadv-${b.dataset.tpl}.html`); } catch (e) { done(e.message, true); } return; }
    const r = await api(path);
    if (!r.ok) { done('Vorlage nicht verfügbar.', true); return; }
    copy(await r.res.text(), b);
  });
}

// ---------- Unternehmenskonto anlegen (Zugang mit Startpasswort) ----------
const TYPES = [['BROKER', 'Finanzierungsvermittler (§ 34i GewO)'], ['REALTOR', 'Immobilienmakler (§ 34c GewO)'], ['BANK', 'Kreditinstitut'], ['OTHER', 'Sonstiges Unternehmen']];
// Nachweis einer Kontoanfrage öffnen (signierter Link, 5 Minuten gültig).
async function openProof(id) {
  const w = window.open('', '_blank', 'noopener');
  const r = await api('/api/admin/misc?proof=' + encodeURIComponent(id));
  if (r.ok && r.data.url) { if (w) w.location.href = r.data.url; else location.href = r.data.url; } else { w?.close(); msg(r.data?.error || 'Nachweis nicht verfügbar.', true); }
}

// Privatkonto (B2C) mit Startpasswort anlegen.
function openCreatePrivate(done) {
  let d = document.getElementById('mkPDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'mkPDlg'; d.className = 'ad-dlg'; document.body.append(d); }
  d.innerHTML = `<form class="ad-dlg-in" id="mkPF"><div class="ad-dlg-h"><h2>Privatkonto anlegen (B2C)</h2><button type="button" class="stage-x" id="mkPX" aria-label="Schließen">×</button></div>
    <p class="form-note">Für Privatkunden, z. B. nach telefonischer Beratung. Es wird ein Zugang mit Startpasswort erzeugt; bei der ersten Anmeldung legt der Kunde ein eigenes Passwort fest. Ein Tarif wird nicht freigeschaltet – gebucht wird über die Bezahlseite.</p>
    <div class="ad-grid2"><label>Name*<input name="name" required minlength="2" maxlength="120"></label><label>E-Mail (Benutzername)*<input name="email" type="email" required></label></div>
    <label class="chk"><input type="checkbox" name="sendMail"> Zugangsdaten zusätzlich per E-Mail senden</label>
    <p class="auth-message error" id="mkPMsg" hidden></p><div id="mkPOut"></div>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" id="mkPCancel">Abbrechen</button><button type="submit" class="btn btn-dark">Konto anlegen</button></div></form>`;
  const close = () => d.close();
  d.querySelector('#mkPX').onclick = close; d.querySelector('#mkPCancel').onclick = close;
  d.querySelector('#mkPF').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target)), btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const x = await api('/api/admin/user-create', { method: 'POST', body: JSON.stringify({ name: fd.name, email: fd.email, sendMail: fd.sendMail === 'on' }) });
    btn.disabled = false;
    const m = d.querySelector('#mkPMsg');
    if (!x.ok) { m.textContent = x.data?.error || 'Anlegen fehlgeschlagen.'; m.hidden = false; return; }
    m.hidden = true;
    const txt = `Anmeldung: https://immoadv.de/auth/login\nBenutzername: ${x.data.email}\nStartpasswort: ${x.data.password}`;
    d.querySelector('#mkPOut').innerHTML = `<div class="pt-alert ok"><strong>Privatkonto angelegt${x.data.mailed ? ' und Zugangsdaten per E-Mail gesendet' : ''}.</strong> Diese Daten werden nur jetzt angezeigt:<pre class="pt-code">${esc(txt)}</pre><button type="button" class="btn btn-outline" id="mkPCopy">Zugangsdaten kopieren</button></div>`;
    d.querySelector('#mkPCopy').onclick = async (ev) => { try { await navigator.clipboard.writeText(txt); ev.target.textContent = 'Kopiert ✓'; } catch { msg('Bitte markieren und kopieren.', true); } };
    e.target.querySelector('.wiz-nav').innerHTML = '<span></span><button type="button" class="btn btn-dark" id="mkPFin">Fertig</button>';
    d.querySelector('#mkPFin').onclick = () => { close(); done?.(); };
    e.target.querySelectorAll('input').forEach((i) => { i.disabled = true; });
  };
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}

function openCreateAccount(c, done) {
  let d = document.getElementById('mkDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'mkDlg'; d.className = 'ad-dlg'; document.body.append(d); }
  const f = (n, l, val = '', extra = '') => `<label>${l}<input name="${n}" value="${esc(val || '')}" ${extra}></label>`;
  d.innerHTML = `<form class="ad-dlg-in" id="mkF"><div class="ad-dlg-h"><h2>Unternehmen anlegen (B2B)</h2><button type="button" class="stage-x" id="mkX" aria-label="Schließen">×</button></div>
    <p class="form-note">Es wird ein Zugang mit Startpasswort erzeugt. Bei der ersten Anmeldung legt der Inhaber ein eigenes Passwort fest und bestätigt § 14 BGB und den AVV.</p>
    <div class="ad-grid2">${f('companyName', 'Firmenname*', c?.company, 'required minlength="2"')}${f('legalForm', 'Rechtsform*', c?.legal_form, 'required placeholder="GmbH, e. K., …"')}
      <label>Art*<select name="institutionType">${TYPES.map(([k, l]) => `<option value="${k}"${c?.institution_type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${f('advisorName', 'Ansprechpartner*', c?.name, 'required minlength="2"')}${f('email', 'E-Mail (Benutzername)*', c?.email, 'type="email" required')}${f('phone', 'Telefon', c?.phone)}
      ${f('street', 'Straße und Hausnummer*', '', 'required')}${f('postalCode', 'PLZ*', '', 'required pattern="[0-9]{5}" inputmode="numeric"')}${f('city', 'Ort*', c?.city, 'required')}
      ${f('registerNumber', 'Handelsregister- oder Vermittlerregister-Nr.', c?.register_number, 'placeholder="HRB … / D-…"')}${f('taxId', 'USt-IdNr. / Steuernummer', c?.tax_id)}</div>
    <p class="form-note">Register-Nr. oder USt-IdNr./Steuernummer: eines von beiden ist Pflicht.</p>
    ${c?.proof_name ? `<p class="pt-alert">Nachweis aus der Anfrage: <strong>${esc(c.proof_name)}</strong> <button type="button" class="text-btn" data-proof="${c.id}">ansehen</button> – wird beim Anlegen in die Verifizierungsunterlagen des Kontos übernommen.</p>` : ''}
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
    const x = await api('/api/admin/b2b-create', { method: 'POST', body: JSON.stringify({ ...fd, verified: fd.verified === 'on', sendMail: fd.sendMail === 'on', requestId: c?.id }) });
    btn.disabled = false;
    const m = d.querySelector('#mkMsg');
    if (!x.ok) { m.textContent = x.data?.error || 'Anlegen fehlgeschlagen.'; m.hidden = false; return; }
    m.hidden = true;
    const txt = `Portal: https://partner.immoadv.de\nBenutzername: ${x.data.email}\nStartpasswort: ${x.data.password}`;
    d.querySelector('#mkOut').innerHTML = `<div class="pt-alert ok"><strong>Konto angelegt (Kundennummer ${esc(String(x.data.customerNumber))})${x.data.mailed ? ' und Zugangsdaten per E-Mail gesendet' : ''}.</strong> Diese Daten werden nur jetzt angezeigt:<pre class="pt-code">${esc(txt)}</pre><button type="button" class="btn btn-outline" id="mkCopy">Zugangsdaten kopieren</button></div>`;
    d.querySelector('#mkCopy').onclick = async (ev) => { try { await navigator.clipboard.writeText(txt); ev.target.textContent = 'Kopiert ✓'; } catch { msg('Bitte markieren und kopieren.', true); } };
    e.target.querySelector('.wiz-nav').innerHTML = '<span></span><button type="button" class="btn btn-dark" id="mkFin">Fertig</button>';
    d.querySelector('#mkFin').onclick = () => { close(); done?.(); };
    e.target.querySelectorAll('input,select').forEach((i) => { i.disabled = true; });
  };
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}

// ---------- Testkauf: echte Bezahlseite im Stripe-Testmodus ----------
async function testkauf(v) {
  const q = new URLSearchParams(location.search);
  const back = q.get('testkauf');
  const r = await api('/api/admin/testkauf');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  const d = r.data;
  const PN = Object.fromEntries((d.plans || []).map((p) => [p.id, p.name]));
  const PS = { paid: 'bezahlt', unpaid: 'offen', no_payment_required: 'ohne Zahlung' };
  const row = (x) => `<tr><td>${dtt(x.created)}</td><td>${esc(PN[x.plan] || x.plan || '–')}</td><td>${eur(x.amount)}</td><td>${esc(x.method || '–')}</td><td>${x.paymentStatus === 'paid' ? '<span class="st ok">bezahlt</span>' : x.status === 'expired' ? '<span class="st">abgelaufen</span>' : `<span class="st warn">${esc(x.paymentStatus || x.status)}</span>`}</td><td>${x.invoicePdf ? `<a class="ck-link" href="${esc(x.invoicePdf)}" target="_blank" rel="noopener">Rechnung (PDF)</a>` : '–'}</td></tr>`;
  const setup = `<section class="pt-card"><h2>So wird der Testkauf eingerichtet</h2><ol class="ad-steps">
    <li><div class="ad-step-h"><strong>Testschlüssel erzeugen</strong></div><p><a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener">Stripe → Entwickler → API-Schlüssel (Testmodus)</a> → „Secret key“ neu erzeugen (der alte Testschlüssel wurde im Chat gezeigt und sollte ohnehin ersetzt werden).</p></li>
    <li><div class="ad-step-h"><strong>In Vercel eintragen</strong></div><p><a href="https://vercel.com/klk19/immoadv/settings/environment-variables" target="_blank" rel="noopener">Vercel → Environment Variables</a>: <code>STRIPE_TEST_SECRET_KEY</code> = <code>sk_test_…</code>, Umgebung <strong>Production</strong>. Danach neu deployen. Der Schlüssel funktioniert nur im Testmodus – es kann kein echtes Geld fließen.</p></li>
    <li><div class="ad-step-h"><strong>PayPal im Testmodus aktivieren</strong></div><p><a href="https://dashboard.stripe.com/test/settings/payment_methods" target="_blank" rel="noopener">Stripe → Einstellungen → Zahlungsmethoden (Testmodus)</a> → PayPal einschalten. Für den Live-Betrieb dasselbe im Live-Modus (dort PayPal-Geschäftskonto verbinden).</p></li>
    <li><div class="ad-step-h"><strong>Logo und Farben</strong></div><p><a href="https://dashboard.stripe.com/settings/branding" target="_blank" rel="noopener">Stripe → Einstellungen → Branding</a>: Logo <a class="ck-link" href="/brand/immoadv-stripe-logo.png" download>immoadv-stripe-logo.png</a> und Symbol <a class="ck-link" href="/brand/immoadv-stripe-icon.png" download>immoadv-stripe-icon.png</a> hochladen, Markenfarbe <code>#0F2C59</code>, Akzent-/Buttonfarbe <code>#000000</code> (schwarz wie Apple Pay). Gilt für Bezahlseite, Rechnungen, Belege und Kundenportal.</p></li>
  </ol></section>`;
  if (!d.available) { v.innerHTML = `<section class="pt-card"><h2>Testkauf</h2><p class="form-note">Noch nicht eingerichtet: Es fehlt ein Stripe-Testschlüssel. Nach den Schritten unten können Sie hier jeden Tarif mit Testkarte oder PayPal-Testkonto kaufen – genau wie ein Kunde, aber ohne echtes Geld.</p></section>${setup}`; return; }
  let res = '';
  if (back === 'abbruch') res = '<p class="auth-message">Testkauf abgebrochen – es wurde nichts berechnet.</p>';
  else if (back) {
    const x = await api('/api/admin/testkauf?sid=' + encodeURIComponent(back));
    const t = x.data?.session;
    res = t ? `<section class="pt-card tk-result ${t.paymentStatus === 'paid' ? 'ok' : 'warn'}"><h2>${t.paymentStatus === 'paid' ? '✓ Testkauf erfolgreich' : 'Testkauf noch offen'}</h2>
      <dl class="pt-dl">${[['Tarif', PN[t.plan] || t.plan], ['Betrag (brutto)', eur(t.amount)], ['darin USt', eur(t.tax)], ['Zahlart', t.method], ['Zahlstatus', PS[t.paymentStatus] || t.paymentStatus], ['Abo', t.subscription ? t.subscription.status : 'kein Abo (Einmalkauf)'], ['Rechnungsnummer', t.invoiceNumber || '–'], ['E-Mail auf der Bezahlseite', t.email || '–']].map(([k, val]) => `<div><dt>${k}</dt><dd>${esc(String(val ?? '–'))}</dd></div>`).join('')}</dl>
      <div class="pt-row">${t.invoicePdf ? `<a class="btn btn-dark" href="${esc(t.invoicePdf)}" target="_blank" rel="noopener">Rechnung als PDF</a>` : ''}${t.invoiceUrl ? `<a class="btn btn-outline" href="${esc(t.invoiceUrl)}" target="_blank" rel="noopener">Rechnungsseite</a>` : ''}</div>
      <p class="form-note">Geprüft: Bezahlseite, Zahlart, Steuer, Rechnung. Im Testmodus wird nichts freigeschaltet und nichts berechnet.</p></section>` : '<p class="form-note">Ergebnis nicht abrufbar.</p>';
  }
  v.innerHTML = `${res}<section class="pt-card"><h2>Testkauf</h2>
    <p class="form-note">Startet die <strong>echte Bezahlseite</strong> (gleiche Texte, Steuer, Rechnung, Zahlarten) im Stripe-Testmodus. Es fließt kein Geld. Testkarte <code>4242 4242 4242 4242</code>, Datum in der Zukunft, beliebige Prüfziffer. PayPal: auf der Testseite „Authorize“ wählen.</p>
    <h3 class="ad-sub">Aktive Zahlarten (Testmodus)</h3>
    <div class="tk-pm">${(d.methods || []).map((m) => `<span class="st ${m.on ? 'ok' : ''}">${m.on ? '✓' : '○'} ${esc(m.label)}</span>`).join('')}</div>
    ${(d.methods || []).some((m) => m.key === 'paypal' && m.on) ? '' : '<p class="form-note">PayPal ist im Testmodus noch nicht eingeschaltet – siehe Schritt 3 unten.</p>'}
    <h3 class="ad-sub">Tarif wählen</h3>
    <div class="tk-plans">${d.plans.map((p) => `<button type="button" class="tk-plan btn-pay" data-tk="${esc(p.id)}"><strong>${esc(p.name)}</strong><span>${eur(p.cents)}${p.mode === 'subscription' ? ' / Monat' : ''}</span><small>Testkauf starten →</small></button>`).join('')}</div>
  </section>
  <section class="pt-card"><h2>Letzte Testkäufe</h2>${d.recent?.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Zeit</th><th>Tarif</th><th>Betrag</th><th>Zahlart</th><th>Status</th><th>Rechnung</th></tr></thead><tbody>${d.recent.map(row).join('')}</tbody></table></div>` : '<p class="form-note">Noch keine Testkäufe.</p>'}</section>${setup}`;
  if (back) history.replaceState(null, '', location.pathname + '#testkauf');
  v.querySelectorAll('[data-tk]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.querySelector('small').textContent = 'Bezahlseite wird geöffnet …';
    const x = await api('/api/admin/testkauf', { method: 'POST', body: JSON.stringify({ plan: b.dataset.tk }) });
    if (!x.ok || !x.data?.url) { msg(x.data?.error || 'Testkauf konnte nicht gestartet werden.', true); b.disabled = false; b.querySelector('small').textContent = 'Testkauf starten →'; return; }
    location.href = x.data.url;
  });
}

// ---------- System: Einrichtung, Test-E-Mail, Nutzer-Suche ----------
async function system(v, focusMail = false) {
  const r = await api('/api/admin/system');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const c = r.data.checks, need = c.filter((x) => !x.ok && !x.optional);
  v.innerHTML = `<h2>Einrichtung</h2>
    <p class="form-note">${need.length ? `<strong>${need.length} Punkt(e) offen.</strong> Die Werte werden in Vercel unter Settings → Environment Variables eingetragen (nie per Chat oder E-Mail weitergeben), danach neu deployen.` : 'Alle Pflichtpunkte eingerichtet.'} Umgebung: ${esc(r.data.env)}${r.data.commit ? ` · Version ${esc(r.data.commit)}` : ''}</p>
    <div class="ad-wrap"><table class="ad-table"><thead><tr><th></th><th>Bereich</th><th>Stand</th><th>Was tun?</th></tr></thead><tbody>
    ${c.filter((x) => !x.ok).map((x) => `<tr><td><span class="ad-amp ${x.ok ? 'gruen' : x.optional ? 'gelb' : 'rot'}"></span></td><td>${esc(x.label)}${x.optional ? ' <small>(optional)</small>' : ''}</td><td>${x.ok ? 'eingerichtet' : 'fehlt'}${x.info ? ` · ${esc(x.info)}` : ''}</td><td><small>${x.ok ? '–' : esc(x.fix)}</small></td></tr>`).join('')}
    </tbody></table></div>
    <p class="form-note">${c.filter((x) => x.ok).length} Punkte sind eingerichtet und ausgeblendet. Die vollständige Liste mit Anleitung steht im Reiter <a href="#einrichtung">Einrichtung</a>.</p>
    ${mailSetup(r.data.mail || {})}
    <h2>Nutzer suchen</h2><p class="form-note">Zeigt nur Kennzahlen (Anmeldung, Anzahl Objekte, Dokumente, Kreditmappen) – keine Inhalte. Jede Suche wird protokolliert.</p>
    <div class="pt-row"><input id="sysQ" type="email" placeholder="E-Mail-Adresse" style="flex:1;min-width:220px;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px"><button class="btn btn-dark" id="sysFind" type="button">Suchen</button></div>
    <div id="sysUser"></div>`;
  bindMailSetup(v);
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
function ckResults(d) {
  const tile = (l, x, s = '') => `<div class="pt-kpi"><small>${l}</small><strong>${x}</strong>${s ? `<span class="form-note">${s}</span>` : ''}</div>`;
  return `
    <h2>${esc(d.range.label)}</h2>
    <div class="pt-kpis">${tile('Umsatz netto', eur(d.revenue.net), `${d.revenue.count} Rechnungen${d.revenue.stornos ? `, ${d.revenue.stornos} Korrekturen` : ''}`)}${tile('Umsatzsteuer 19 %', eur(d.revenue.vat))}${tile('Umsatz brutto', eur(d.revenue.gross))}${tile('Offene Posten', String(d.openItems.length), eur(d.openItems.reduce((s, x) => s + Number(x.gross_cents), 0)))}</div>
    <div class="pt-kpis">${tile('MRR netto', eur(d.recurring.mrrNet), 'aus Stripe-Abos zum Listenpreis')}${tile('ARR netto', eur(d.recurring.arrNet))}${tile('Aktive Tarife', String(d.recurring.activeAccounts), `Basic ${d.recurring.byTier.BASIC} · Pro ${d.recurring.byTier.PRO} · Enterprise ${d.recurring.byTier.ENTERPRISE}${d.recurring.manualWithoutPrice ? ` · ${d.recurring.manualWithoutPrice} manuell` : ''}`)}${tile('Abgelaufen im Zeitraum', String(d.recurring.expiredInRange))}</div>
    <h2>Netto-Umsatz der letzten 12 Monate</h2>${monthsChart(d.months || [])}
    <h2>Weiterempfehlung über Kreditmappen</h2>
    <div class="pt-kpis">${tile('Kreditmappen von Unternehmen', String(d.viral.partnerDossiers))}${tile('Aufrufe der Prüfseite', String(d.viral.verifyViews))}${tile('Neue Unternehmenskonten', String(d.viral.newAccounts), `davon über Prüfseite: ${d.viral.viaVerify}`)}${tile('Endkunden-Anfragen', String(d.viral.leads))}</div>
    <h2>Offene Posten</h2>${d.openItems.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Ampel</th><th>Nummer</th><th>Kunde</th><th>Fällig</th><th>Brutto</th><th></th></tr></thead><tbody>
      ${d.openItems.map((x) => `<tr><td><span class="ad-amp ${x.ampel}"></span>${x.daysOverdue > 0 ? `${x.daysOverdue} Tage` : 'fristgerecht'}</td><td>${esc(x.invoice_number)}</td><td>${esc(x.buyer?.company)}</td><td>${dt(x.due_date)}</td><td>${eur(x.gross_cents)}</td><td class="ad-actions"><button data-paid="${x.id}" type="button">Als bezahlt markieren</button><button data-remind="${x.id}" type="button">Zahlungserinnerung senden</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine offenen Posten.</p>'}
    <h2>Rechnungen im Zeitraum</h2>${invTable(d.invoices)}`;
}
async function cockpit(v, zeitraum = 'monat', von = '', bis = '') {
  const today = isoD(new Date());
  // Rahmen nur einmal aufbauen
  if (!v.querySelector('#ckRes')) {
    const [dv, db] = rangeOf(zeitraum);
    v.innerHTML = `<div class="ad-period"><div class="seg" role="tablist" aria-label="Zeitraum">${[['heute', 'Heute'], ['woche', 'Woche'], ['monat', 'Monat'], ['jahr', 'Jahr'], ['gesamt', 'Gesamt']].map(([k, l]) => `<button type="button" role="tab" data-z="${k}" aria-selected="${k === zeitraum}">${l}</button>`).join('')}</div>
      <div class="ad-range"><label>Von<span class="de-date"><span class="de-txt" data-for="zv"></span><input type="date" id="zv" value="${esc(von || dv)}" max="${today}"></span></label><label>Bis<span class="de-date"><span class="de-txt" data-for="zb"></span><input type="date" id="zb" value="${esc(bis || db)}" max="${today}"></span></label><button class="btn btn-outline" id="zf" type="button">Eigener Zeitraum</button></div></div>
      <div id="ckRes" class="ck-res" aria-live="polite"><p class="form-note">Wird geladen …</p></div>`;
    v.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => {
      v.querySelectorAll('[data-z]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      const [a1, b1] = rangeOf(b.dataset.z); $('#zv').value = a1; $('#zb').value = b1; v.__deTxt?.();
      ckLoad(v, b.dataset.z, '', '');
    });
    // Deutsche Datumsanzeige über dem nativen Feld (iPhone zeigt sonst die Gerätesprache).
    const deTxt = () => v.querySelectorAll('.de-txt').forEach((t) => { const val = $('#' + t.dataset.for).value; t.textContent = val ? new Date(val + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'seit Beginn'; });
    ['#zv', '#zb'].forEach((id) => $(id).addEventListener('change', deTxt)); deTxt(); v.__deTxt = deTxt;
    $('#zf').onclick = () => { v.querySelectorAll('[data-z]').forEach((x) => x.setAttribute('aria-selected', 'false')); ckLoad(v, 'frei', $('#zv').value, $('#zb').value); };
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
  return `<div class="ad-chart">${empty ? '<p class="ad-chart-empty">Noch keine Umsätze in den letzten 12 Monaten.</p>' : ''}<div class="ad-bars" role="list">${months.map((x, i) => `<div class="ad-bar" role="listitem" aria-label="${full(x.m)}: ${eur(x.net, 0)}"><span class="ad-bar-v">${x.net ? eur(x.net, 0) : ''}</span><span class="ad-bar-f" style="height:${Math.max(x.net > 0 ? 3 : 0, Math.round((x.net / max) * 100))}%"></span><span class="ad-bar-l">${mon(x.m)}${x.m.endsWith('-01') || i === 0 ? `<em>${yr(x.m)}</em>` : ''}</span></div>`).join('')}</div></div>`;
}

const invTable = (rows) => rows.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Nummer</th><th>Art</th><th>Datum</th><th>Kunde</th><th>Netto</th><th>USt</th><th>Brutto</th><th>Status</th><th></th></tr></thead><tbody>
  ${rows.map((x) => `<tr><td>${esc(x.invoice_number)}</td><td>${{ invoice: 'Rechnung', storno: 'Storno', credit: 'Gutschrift' }[x.kind]}${x.source === 'stripe' ? ' · Stripe' : ''}</td><td>${dt(x.issue_date)}</td><td>${esc(x.buyer?.company)}</td><td>${eur(x.net_cents)}</td><td>${eur(x.vat_cents)}</td><td>${eur(x.gross_cents)}</td><td>${PAY[x.payment_status]}</td>
  <td class="ad-actions"><button data-pdf="${x.id}" type="button">PDF</button>${x.kind === 'invoice' && x.source === 'manual' && x.payment_status !== 'CANCELLED' ? `<button data-storno="${x.id}" type="button">Stornieren</button>` : ''}${['PENDING', 'OVERDUE'].includes(x.payment_status) ? `<button data-paid="${x.id}" type="button">Bezahlt</button><button data-remind="${x.id}" type="button">Erinnern</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine Rechnungen.</p>';

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
  v.innerHTML = `<section class="pt-card"><h2>Not-Aus</h2>
    ${p.active ? `<div class="pt-alert bad"><strong>Aktiv seit ${dtt(p.since)}</strong> (${esc(p.by || '')}${p.reason ? ': ' + esc(p.reason) : ''}). Alle Nutzer außer Administratoren sind abgemeldet; Partnerseiten, Widget und Anfragen sind abgeschaltet.</div><button class="btn btn-dark" id="pOff" type="button">Not-Aus beenden</button>`
      : `<p>Schaltet sofort alle angemeldeten Zugänge außer Administratoren ab (Anfragen an die Schnittstellen werden abgewiesen, Sitzungen wirken beendet) und stoppt Partnerseiten, Widget und Anfrage-Eingang. Für den Fall eines Sicherheitsvorfalls.</p><button class="btn btn-dark" id="pOn" type="button" style="background:#991B1B;border-color:#991B1B">Not-Aus auslösen</button>`}
    <p class="form-note">Die Anmelde-Tokens selbst laufen nach spätestens einer Stunde ab. Für einen vollständigen Schlüsseltausch zusätzlich in Supabase den JWT-Schlüssel rotieren.</p></section>
    <section class="pt-card"><h2>Zugangsschutz Admin</h2><ul class="plain-list">
      <li>Zweiter Faktor: ${r.data?.mfaRequired ? '<span class="st ok">Pflicht</span>' : '<span class="st bad">abgeschaltet (ADMIN_MFA=off)</span>'}</li>
      <li>Keine IP-Sperre für den Admin: Sie können von überall (auch mobil) zugreifen. Schutz durch Anmeldung, Admin-Liste, Zwei-Faktor, Zeitlimit und Not-Aus.</li>
      <li>Anmeldeversuche: Supabase begrenzt fehlgeschlagene Anmeldungen automatisch; zusätzlich sind alle Schnittstellen je Nutzer und IP gedrosselt.</li>
      <li>Alle Admin-Aktionen stehen im Reiter Protokoll.</li></ul></section>
    <section class="pt-card"><h2>Sicherheitsprotokoll</h2><p class="form-note">Gedrosselte Zugriffe (zu viele Anfragen je Nutzer oder IP) und abgewiesene Zugriffe auf den Admin-Bereich. Gespeichert werden nur Bereich und ein gekürzter Hash, keine IP-Adressen; Löschung nach 30 Tagen. Die Zählung erfolgt je Serverinstanz, Spitzen können sich verteilen.</p><div id="secLog"><p class="form-note">Wird geladen …</p></div><button class="btn btn-ghost" id="secRe" type="button">Aktualisieren</button></section>`;
  // Vorfälle: Angriffe und Bot-Wellen der letzten 7 Tage mit Sperren / Erledigt.
  v.insertAdjacentHTML('afterbegin', '<section class="pt-card sec-inc" id="secInc"><p class="form-note">Vorfälle werden geladen …</p></section>');
  const loadInc = async () => {
    const box = $('#secInc'); const x = await api('/api/admin/sec');
    if (!x.ok) { box.innerHTML = `<p class="form-note">${esc(x.data?.error || 'Nicht verfügbar.')}</p>`; return; }
    const d = x.data, act = d.blocks.filter((b) => b.active);
    const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : dt(t); };
    box.innerHTML = `<div class="sec-inc-h"><h2>Vorfälle (7 Tage)</h2>${d.open ? `<span class="st bad">${d.open} offen</span>` : '<span class="st ok">alles erledigt</span>'}</div>
      <p class="form-note"><button class="text-btn" id="secTest" type="button">Testalarm an mich senden</button> · Bei Angriffen und Bot-Wellen bekommen Sie automatisch eine E-Mail (höchstens alle 15 Minuten je Art). Hier können Sie Quellen sperren – gesperrte Quellen erhalten keinen Zugriff mehr auf die Schnittstellen. Gespeichert wird nur eine gekürzte Kennung, keine IP-Adresse.</p>
      ${d.groups.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Art</th><th>Quelle</th><th>Anzahl</th><th>Zuletzt</th><th>Details</th><th></th></tr></thead><tbody>${d.groups.map((g) => `<tr class="${g.open ? 'sec-open' : ''}"><td><strong>${esc(g.label)}</strong>${g.open ? `<br><small>${g.open} offen</small>` : ''}</td><td>${g.ip ? `<code>${esc(g.ip.slice(0, 8))}</code>${g.blocked ? ' <span class="st">gesperrt</span>' : ''}` : '–'}</td><td>${g.n}</td><td>${esc(ago(g.last))}</td><td><small>${g.details.map(esc).join('<br>')}</small></td><td class="sec-act">${g.ip && !g.blocked ? `<button class="btn btn-dark btn-sm" data-blk="${g.ip}" data-days="1">24 h sperren</button><button class="text-btn" data-blk="${g.ip}" data-days="30">30 Tage</button><button class="text-btn" data-blk="${g.ip}" data-days="0">dauerhaft</button>` : ''}${g.open ? `<button class="text-btn" data-ack="${esc(g.kind)}" data-ip="${g.ip || ''}">erledigt</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${d.open ? '<p><button class="btn btn-outline" id="ackAll" type="button">Alle als erledigt markieren</button></p>' : ''}` : '<p class="pt-alert ok">Keine Vorfälle in den letzten 7 Tagen.</p>'}
      ${act.length ? `<h3 class="ad-sub">Gesperrte Quellen (${act.length})</h3><ul class="sec-blocks">${act.map((b) => `<li><code>${esc(b.ip_hash.slice(0, 8))}</code><span>${b.until ? 'bis ' + dtt(b.until) : 'dauerhaft'}${b.reason ? ' · ' + esc(b.reason) : ''}</span><button class="text-btn" data-unblk="${b.ip_hash}">entsperren</button></li>`).join('')}</ul>` : ''}`;
    box.querySelectorAll('[data-blk]').forEach((b) => b.onclick = async () => { const days = Number(b.dataset.days) || null; const reason = prompt('Grund (optional, für das Protokoll):', 'Angriffsversuch') ?? null; if (reason === null) return; const y = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'block', ip: b.dataset.blk, days, reason }) }); if (y.ok) { msg('Quelle gesperrt.'); loadInc(); } else msg(y.data?.error || 'Fehler', true); });
    box.querySelectorAll('[data-unblk]').forEach((b) => b.onclick = async () => { if (!confirm('Sperre aufheben?')) return; await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'unblock', ip: b.dataset.unblk }) }); loadInc(); });
    box.querySelectorAll('[data-ack]').forEach((b) => b.onclick = async () => { await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'ack', kind: b.dataset.ack, ip: b.dataset.ip || null }) }); loadInc(); });
    $('#secTest')?.addEventListener('click', async () => { const y = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'testalert' }) }); msg(y.ok ? 'Testalarm gesendet – bitte Postfach prüfen.' : (y.data?.error || 'Fehler'), !y.ok); });
    $('#ackAll')?.addEventListener('click', async () => { await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'ack' }) }); loadInc(); });
  };
  loadInc();
  const KIND = { rate_limit: 'Gedrosselt', admin_denied: 'Admin verweigert', admin_ip_blocked: 'IP nicht freigegeben', admin_mfa_missing: 'Zweiter Faktor fehlt', panic: 'Not-Aus', honeypot: 'Bot (Honigtopf)', too_fast: 'Bot (zu schnell)', disposable_email: 'Wegwerf-Adresse', email_no_mx: 'Domain ohne Mailempfang', content_flagged: 'Spam-Verdacht' };
  const loadLog = async () => {
    const l = await api('/api/admin/support?log=1');
    if (!l.ok) { $('#secLog').innerHTML = `<p class="form-note">${esc(l.data?.error)}</p>`; return; }
    const top = Object.entries(l.data.counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    $('#secLog').innerHTML = `${top.length ? `<p><strong>Letzte 24 Stunden:</strong> ${top.map(([k, n]) => { const [kind, bucket] = k.split(':'); return `${esc(KIND[kind] || kind)} (${esc(bucket)}): ${n}`; }).join(' · ')}</p>` : '<p class="form-note">Keine Auffälligkeiten in den letzten 24 Stunden.</p>'}
      ${l.data.events.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Zeit</th><th>Ereignis</th><th>Bereich</th><th>Kennung</th></tr></thead><tbody>${l.data.events.slice(0, 60).map((e) => `<tr><td>${dtt(e.created_at)}</td><td>${esc(KIND[e.kind] || e.kind)}</td><td>${esc(e.bucket || '')}</td><td><code>${esc(e.subject || '')}</code></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  };
  loadLog();
  $('#secRe').onclick = loadLog;
  const go = async (on) => {
    const reason = on ? prompt('Grund (für das Protokoll):', 'Sicherheitsvorfall') : '';
    if (on && reason === null) return;
    if (!confirm(on ? 'Not-Aus jetzt auslösen?' : 'Not-Aus beenden?')) return;
    const x = await api('/api/admin/support', { method: 'POST', body: JSON.stringify({ panic: on, reason }) });
    if (x.ok) { msg(on ? 'Not-Aus aktiv (wirkt binnen 15 Sekunden überall).' : 'Not-Aus beendet.'); sicherheit(v); } else msg(x.data?.error || 'Fehler', true);
  };
  if ($('#pOn')) $('#pOn').onclick = () => go(true);
  if ($('#pOff')) $('#pOff').onclick = () => go(false);
}

// ---------- Partner ----------
async function partner(v) {
  const r = await api('/api/admin/b2b');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const list = r.data.accounts;
  const pend = list.filter((a) => a.verification_status === 'eingereicht').length;
  v.innerHTML = `<div class="ad-mk-tiles"><button class="ad-mk" type="button" id="mkPriv"><b>+ Privatkonto anlegen</b><span>B2C · Privatkunde mit Startpasswort</span></button><button class="ad-mk b2b" type="button" id="mkNew"><b>+ Unternehmen anlegen</b><span>B2B · Firmenzugang zum Unternehmensportal</span></button></div>${pend ? `<p class="auth-message" style="margin-bottom:10px"><strong>${pend} Unternehmen</strong> ${pend === 1 ? 'wartet' : 'warten'} auf Prüfung und Freischaltung. Filter „Zur Prüfung eingereicht“ wählen und „Prüfen“ öffnen.</p>` : ''}<div class="pt-row" style="margin-bottom:10px"><input id="pq" aria-label="Unternehmen suchen" placeholder="Suchen (Firma, Ort, Kundennummer)" style="flex:1;min-width:220px;border:1px solid #CBD5E1;border-radius:6px;padding:8px 10px"><select id="ps" aria-label="Status filtern" style="border:1px solid #CBD5E1;border-radius:6px;padding:8px"><option value="">Alle</option><option value="active">Aktiv</option><option value="locked">Gesperrt</option><option value="unverified">Ungeprüft</option><option value="pruefen">Zur Prüfung eingereicht</option></select><button class="btn btn-ghost" id="pCsv" type="button">CSV</button></div>
    ${list.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Unternehmen</th><th>Art</th><th>Register / Steuer</th><th>Tarif</th><th>Status</th><th>Anfragen</th><th>Aktionen</th></tr></thead><tbody>
    ${list.map((a) => `<tr data-row="${a.id}" data-s="${a.status}${a.verified_at ? '' : ' unverified'}${a.verification_status === 'eingereicht' ? ' pruefen' : ''}" data-q="${esc((a.company_name + ' ' + a.city + ' ' + a.customer_number + ' ' + a.email).toLowerCase())}">
      <td><strong>${esc(a.company_name)}</strong> ${esc(a.legal_form)}<br><small>${esc(a.customer_number)} · ${esc(a.postal_code)} ${esc(a.city)} · ${esc(a.email)}</small></td>
      <td>${esc(a.institution_type)}</td><td><small>${esc(a.register_number || '–')}<br>${esc(a.tax_id || '–')}</small></td>
      <td>${a.tier ? TIER[a.tier] : '–'}${a.plan_source === 'manual' ? ' (manuell)' : ''}${a.plan_until ? `<br><small>bis ${dt(a.plan_until)}</small>` : ''}${a.dossier_bonus ? `<br><small>+${a.dossier_bonus} Mappen</small>` : ''}</td>
      <td>${a.status === 'locked' ? `<span class="st bad">gesperrt</span><br><small>${esc(a.lock_reason)}</small>` : '<span class="st ok">aktiv</span>'}<br>${a.verified_at ? '<small>geprüft</small>' : a.verification_status === 'eingereicht' ? '<small class="st warn">zur Prüfung eingereicht</small>' : a.verification_status === 'abgelehnt' ? '<small class="st bad">abgelehnt – wartet auf Unterlagen</small>' : '<small class="st warn">noch keine Unterlagen</small>'}${a.has_whitelabel ? '<br><small>Whitelabel frei</small>' : ''}${a.allow_invoice_payment ? '<br><small>Kauf auf Rechnung</small>' : ''}</td>
      <td>${a.leads}</td>
      <td class="ad-actions">
        ${a.verified_at ? `<button data-a="verify" data-on="false" data-id="${a.id}" type="button">Freischaltung zurücknehmen</button>` : `<button data-a="details" data-id="${a.id}" type="button"${a.verification_status === 'eingereicht' ? ' class="ad-primary"' : ''}>Prüfen</button>`}
        ${a.status === 'locked' ? `<button data-a="unlock" data-id="${a.id}" type="button">Entsperren</button>` : `<button data-a="lock" data-id="${a.id}" type="button">Sperren</button>`}
        <button data-a="plan" data-id="${a.id}" type="button">Tarif setzen</button>
        <button data-a="whitelabel" data-on="${!a.has_whitelabel}" data-id="${a.id}" type="button">${a.has_whitelabel ? 'Whitelabel entziehen' : 'Whitelabel freischalten'}</button>
        <button data-a="invoicePayment" data-on="${!a.allow_invoice_payment}" data-id="${a.id}" type="button">${a.allow_invoice_payment ? 'Rechnungskauf aus' : 'Rechnungskauf an'}</button>
        <button data-a="credits" data-id="${a.id}" type="button">Kontingent +</button>
        <button data-a="invoice" data-id="${a.id}" data-name="${esc(a.company_name)}" type="button">Rechnung</button>
        <button data-a="details" data-id="${a.id}" type="button">Details</button>
      </td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Noch keine Unternehmenskonten.</p>'}
    <div id="invForm"></div>`;
  const filter = () => {
    const q = $('#pq').value.toLowerCase(), s = $('#ps').value;
    v.querySelectorAll('[data-row]').forEach((tr) => { tr.hidden = (q && !tr.dataset.q.includes(q)) || (s && !tr.dataset.s.split(' ').includes(s)); });
  };
  $('#pq').oninput = filter; $('#ps').onchange = filter;
  $('#pCsv').onclick = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const head = ['Kundennummer', 'Firma', 'Rechtsform', 'Art', 'Registernummer', 'Steuernummer', 'Ansprechpartner', 'E-Mail', 'PLZ', 'Ort', 'Tarif', 'Quelle', 'Status', 'Geprüft', 'Anfragen', 'Angelegt'];
    const rows = list.map((a) => [a.customer_number, a.company_name, a.legal_form, a.institution_type, a.register_number, a.tax_id, a.advisor_name, a.email, a.postal_code, a.city, a.tier || '', a.plan_source || '', a.status, a.verified_at ? 'ja' : 'nein', a.leads, a.created_at.slice(0, 10)]);
    const blob = new Blob(['\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = 'ImmoAdv_Unternehmen.csv'; document.body.append(el); el.click(); el.remove();
  };
  v.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id, a = b.dataset.a;
    let body = { action: a, id };
    if (a === 'invoice') return invoiceForm(id, b.dataset.name);
    if (a === 'details') return details(id);
    if (a === 'verify' || a === 'whitelabel') body.on = b.dataset.on === 'true';
    if (a === 'lock') { const reason = prompt('Grund der Sperre (wird dem Unternehmen angezeigt):'); if (!reason) return; body.reason = reason; }
    if (a === 'unlock' && !confirm('Konto entsperren?')) return;
    if (a === 'invoicePayment') {
      body.on = b.dataset.on === 'true';
      if (body.on) { const lim = prompt('Kreditlimit in Euro (leer = ohne Limit):', ''); const days = prompt('Zahlungsziel in Tagen:', '14'); if (days === null) return; body.limitCents = lim ? Math.round(Number(lim.replace(',', '.')) * 100) : null; body.termsDays = Number(days) || 14; }
    }
    if (a === 'credits') { const n = prompt('Zusätzliche Kreditmappen pro Monat (negativ zum Abziehen):', '10'); if (!n) return; body.add = Math.trunc(Number(n)); }
    if (a === 'plan') {
      const t = prompt('Tarif: BASIC, PRO, ENTERPRISE oder leer zum Entfernen', 'PRO'); if (t === null) return;
      const until = t ? prompt('Gültig bis (JJJJ-MM-TT, leer = unbefristet):', '') : '';
      body.tier = t ? t.trim().toUpperCase() : null; body.until = until || null;
    }
    const r = await api('/api/admin/b2b', { method: 'POST', body: JSON.stringify(body) });
    if (r.ok) { msg('Gespeichert.'); partner(v); } else msg(r.data?.error || 'Fehler', true);
  });
  $('#mkNew')?.addEventListener('click', () => openCreateAccount(null, () => partner(v)));
  $('#mkPriv')?.addEventListener('click', () => openCreatePrivate());
}

// Nur lesende Detailansicht eines Unternehmens (kein Einloggen als Partner).
async function details(id) {
  const box = $('#invForm');
  box.innerHTML = '<p class="form-note">Wird geladen …</p>';
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
    <h3>Rechnungen</h3>${invoices.length ? `<table class="ad-table"><tbody>${invoices.map((i) => `<tr><td>${esc(i.invoice_number)}</td><td>${dt(i.issue_date)}</td><td>${eur(i.gross_cents)}</td><td>${PAY[i.payment_status]}</td></tr>`).join('')}</tbody></table>` : '<p class="form-note">Keine.</p>'}
    <h3>Support-Ansicht</h3><p class="form-note">${a.support_access_until && new Date(a.support_access_until) > new Date() ? `Vom Unternehmen freigegeben bis ${dtt(a.support_access_until)}.` : 'Nicht freigegeben. Das Unternehmen kann den lesenden Support-Zugriff im Portal unter Profil erteilen.'}</p>
    ${a.support_access_until && new Date(a.support_access_until) > new Date() ? '<button class="btn btn-ghost" id="supView" type="button">Portal lesend ansehen (wird protokolliert)</button><div id="supOut"></div>' : ''}
    <button class="text-btn" id="detClose" type="button">Schließen</button></section>`;
  if ($('#supView')) $('#supView').onclick = async () => {
    const s = await api('/api/admin/support?id=' + id);
    if (!s.ok) { $('#supOut').innerHTML = `<p class="form-note">${esc(s.data?.error)}</p>`; return; }
    const d = s.data;
    $('#supOut').innerHTML = `<p class="form-note">Tarif ${d.account.tier ? TIER[d.account.tier] : '–'} · Widget ${d.account.widgetActive ? 'aktiv' : 'aus'} · Domains: ${esc((d.account.allowedDomains || []).join(', ') || 'alle')}</p>
      <div class="ad-wrap"><table class="ad-table"><thead><tr><th>Eingang</th><th>Quelle</th><th>Status</th><th>Kontakt</th><th>Objekt</th></tr></thead><tbody>${d.leads.map((l) => `<tr><td>${dtt(l.created_at)}</td><td>${esc(l.source)}</td><td>${esc(l.status)}</td><td>${esc(l.client_name)}<br><small>${esc(l.client_email)}</small></td><td>${esc(l.property_data?.address || l.property_data?.ref || '–')}</td></tr>`).join('') || '<tr><td colspan="5">Keine Anfragen.</td></tr>'}</tbody></table></div>`;
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
    <div class="ad-items" id="items">${row()}</div><button class="text-btn" id="addRow" type="button">+ Position</button>
    <div class="pt-row ad-form" style="margin-top:10px"><label class="form-note">Zahlungsart <select id="pm"><option value="INVOICE_BANK_TRANSFER">Überweisung (mit GiroCode)</option><option value="SEPA_B2B">SEPA-Firmenlastschrift</option><option value="STRIPE_CARD">Karte (bereits bezahlt)</option></select></label>
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
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
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
  v.innerHTML = `<section class="pt-card"><h2>Rechnungen für die Steuerkanzlei (ZIP)</h2>
    <p>Alle Rechnungen eines Zeitraums als ZIP zum Herunterladen und Weitergeben. Jede Datei beginnt mit dem Rechnungsdatum – <code>2026-10-14_IMMO-2026-0042_Kunde.pdf</code> –, damit die Kanzlei sie sofort zuordnen kann. Stornos und Gutschriften liegen im Ordner <code>Korrekturen</code>.</p>
    <div class="pt-row ad-form"><label class="form-note">Zeitraum <select id="per"><option value="m">Monat</option><option value="q">Quartal</option><option value="y">Jahr</option></select></label>
      <label class="form-note" id="perM">Monat <input type="month" id="mon" value="${m}"></label>
      <label class="form-note" id="perQ" hidden>Quartal <select id="qq">${[1, 2, 3, 4].map((x) => `<option value="${x}"${x === q ? ' selected' : ''}>Q${x}</option>`).join('')}</select> <input type="number" id="qy" value="${prev.getFullYear()}" min="2024" max="2100" style="width:90px"></label>
      <label class="form-note" id="perY" hidden>Jahr <input type="number" id="yy" value="${prev.getFullYear()}" min="2024" max="2100" style="width:90px"></label>
      <label class="chk form-note"><input type="checkbox" id="dv"> zusätzlich DATEV-Datei und USt-Journal</label>
      <label class="form-note" id="skrL" hidden>Kontenrahmen <select id="skr"><option value="SKR03">SKR03 – am häufigsten</option><option value="SKR04">SKR04</option></select></label>
      <button class="btn btn-dark" id="zip" type="button">ZIP herunterladen</button></div>
    <details class="ad-help"><summary>Was ist der Kontenrahmen (SKR03 / SKR04)?</summary><p>Nur relevant, wenn Sie die DATEV-Datei mitgeben: Der Kontenrahmen bestimmt die Kontonummern (z. B. Erlöse 19 % auf 8400 bei SKR03 bzw. 4400 bei SKR04). Fragen Sie Ihre Kanzlei, welchen sie führt – im Zweifel SKR03.</p></details>
    <p class="form-note">Es wird nichts automatisch versendet – Sie laden das ZIP herunter und geben es Ihrer Kanzlei (z. B. per DATEV Unternehmen online, Upload-Portal oder E-Mail).</p></section>`;
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
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const { contacts, codes } = r.data;
  v.innerHTML = `<section class="pt-card"><h2>B2B-Anfragen</h2><p class="form-note">Kontoanfragen prüfen und mit „Konto anlegen“ den Zugang erzeugen – Firmendaten werden übernommen.</p>${contacts.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Eingang</th><th>Anliegen</th><th>Kontakt</th><th>Nachricht</th><th></th></tr></thead><tbody>
    ${contacts.map((c) => `<tr><td>${dtt(c.created_at)}</td><td>${({ konto: '<span class="st warn">Kontoanfrage</span>', demo: 'Demo', enterprise: 'Enterprise', kooperation: 'Kooperation' })[c.kind] || esc(c.kind)}${c.city ? `<br><small>${esc(c.city)}</small>` : ''}</td><td><strong>${esc(c.company)}</strong><br>${esc(c.name)}<br><a href="mailto:${esc(c.email)}">${esc(c.email)}</a> ${esc(c.phone || '')}</td><td>${esc(c.message || '')}${c.register_number || c.tax_id ? `<br><small>${esc([c.legal_form, c.register_number, c.tax_id].filter(Boolean).join(' · '))}</small>` : ''}${c.proof_name ? `<br><button class="text-btn" data-proof="${c.id}" type="button">📎 Nachweis: ${esc(c.proof_name)}</button>` : ''}</td><td>${c.kind === 'konto' && !c.account_id ? `<button class="btn btn-dark btn-sm" data-mk="${c.id}" type="button">Konto anlegen</button> ` : c.account_id ? '<span class="st ok">Konto angelegt</span> ' : ''}${c.status === 'offen' ? `<button class="text-btn" data-done="${c.id}" type="button">Erledigt</button>` : 'erledigt'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine Anfragen.</p>'}</section>
    <section class="pt-card"><h2>Partnercodes</h2><p class="form-note">Kampagnen-Codes für die Registrierung von Unternehmen. Der Code wird am Konto gespeichert; Rabatte vergibt Stripe über Aktionscodes im Bezahlvorgang.</p>
    <div class="pt-row ad-form"><input id="cc" aria-label="Code" placeholder="CODE-2026" style="text-transform:uppercase"><input id="cd" aria-label="Beschreibung" placeholder="Beschreibung"><input id="cm" aria-label="Maximale Einlösungen" placeholder="max. Einlösungen" inputmode="numeric" style="width:150px"><button class="btn btn-dark" id="cAdd" type="button">Anlegen</button></div>
    ${codes.length ? `<table class="ad-table" style="margin-top:10px"><thead><tr><th>Code</th><th>Beschreibung</th><th>Eingelöst</th><th>Quote</th><th></th></tr></thead><tbody>${codes.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.description || '')}</td><td>${c.redeemed}${c.max_redemptions ? ' / ' + c.max_redemptions : ''}</td><td>${c.max_redemptions ? Math.round((c.redeemed / c.max_redemptions) * 100) + ' %' : '–'}</td><td><button class="text-btn" data-code="${esc(c.code)}" data-on="${!c.active}" type="button">${c.active ? 'Deaktivieren' : 'Aktivieren'}</button></td></tr>`).join('')}</tbody></table>` : ''}</section>`;
  v.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => { await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'contactDone', id: b.dataset.done }) }); anfragen(v); });
  v.querySelectorAll('[data-proof]').forEach((b) => b.onclick = () => openProof(b.dataset.proof));
  v.querySelectorAll('[data-mk]').forEach((b) => b.onclick = () => { const c = contacts.find((x) => x.id === b.dataset.mk); openCreateAccount(c, () => anfragen(v)); });
  v.querySelectorAll('[data-code]').forEach((b) => b.onclick = async () => { await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'codeActive', code: b.dataset.code, on: b.dataset.on === 'true' }) }); anfragen(v); });
  $('#cAdd').onclick = async () => {
    const r2 = await api('/api/admin/misc', { method: 'POST', body: JSON.stringify({ action: 'codeCreate', code: $('#cc').value, description: $('#cd').value, maxRedemptions: $('#cm').value ? Number($('#cm').value) : null }) });
    if (r2.ok) anfragen(v); else msg(r2.data?.error || 'Fehler', true);
  };
}

async function protokoll(v, reveal = false) {
  const r = await api('/api/admin/misc' + (reveal ? '?reveal=1' : ''));
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const head = `<p class="form-note">Personen-Kennungen sind pseudonymisiert (SHA-256 mit geheimem Salz). Einträge werden nach 90 Tagen automatisch gelöscht – ausgenommen Rechnungs- und Vertragsvorgänge (Aufbewahrungspflicht). ${r.data.pseudonymized ? '<button type="button" class="btn btn-outline btn-sm" id="pvReveal">Klartext anzeigen (wird protokolliert)</button>' : '<strong>Klartext angezeigt – dieser Abruf wurde protokolliert.</strong>'}</p>`;
  v.innerHTML = head + (r.data.audit.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Ziel</th><th>Details</th></tr></thead><tbody>${r.data.audit.map((a) => `<tr><td>${dtt(a.created_at)}</td><td>${esc(a.actor_email)}</td><td>${esc(a.action)}</td><td><small>${esc(a.target || '')}</small></td><td><small>${esc(JSON.stringify(a.meta))}</small></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Noch keine Einträge.</p>');
  $('#pvReveal')?.addEventListener('click', () => protokoll(v, true));
}

async function kennzahlen(v) {
  const r = await api('/api/admin/stats');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const j = r.data;
  const n = (x) => (x == null ? '–' : x.toLocaleString('de-DE'));
  const tile = (l, x) => `<div class="an-chip"><small>${l}</small><strong>${x}</strong></div>`;
  const on = (b) => (b ? '<span class="st ok">aktiv</span>' : '<span class="st bad">fehlt</span>');
  v.innerHTML = `<div class="an-chips">${tile('Konten', n(j.users))}${tile('Neu (7 Tage)', n(j.users7))}${tile('Objekte', n(j.objects))}${tile('Dokumente', n(j.docs))}${tile('Freigaben aktiv', `${n(j.sharesActive)} / ${n(j.shares)}`)}${tile('Kreditmappen', n(j.versions))}${tile('Erinnerungen an', n(j.reminders))}${tile('Offene Unterlagen-Anforderungen', n(j.requestsOpen))}${tile('Unternehmenskonten', `${n(j.b2bActive)} aktiv / ${n(j.b2b)}`)}${tile('Endkunden-Anfragen', n(j.leads))}${tile('Offene B2B-Anfragen', n(j.contactsOpen))}</div>
    <p class="form-note">Einstellungen: Bezahlung ${on(j.config.billing)} · E-Mail-Versand ${on(j.config.mail)} · Täglicher Lauf ${on(j.config.cron)} · Aktive Co-Branding-Partner (alt): ${n(j.partners)}</p>`;
}


(async () => {
  if (!(await gate())) return;
  frame();
  show();
  window.addEventListener('hashchange', show);
})();

// ---------- Analyse: Besucher, Herkunft, Geräte, Weg zum Kauf (cookielos, nur Zahlen) ----------
let AN_DAYS = 30;
async function analyse(v) {
  const seg = getSeg(), nf = (x) => Number(x || 0).toLocaleString('de-DE');
  v.innerHTML = `<section class="ad-over an"><div class="ad-over-h"><h2>Analyse · ${seg === 'b2b' ? 'B2B (Unternehmen)' : 'B2C (Privatkunden)'}</h2>
    <p class="form-note">Reichweitenmessung ohne Cookies und ohne gespeicherte IP-Adressen. Bereich oben rechts umschalten (B2C ⇄ B2B).</p></div>
    <div class="ad-period"><div class="seg" role="group" aria-label="Zeitraum">${[[1, 'Heute'], [7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage'], [365, '12 Monate']].map(([k, l]) => `<button type="button" data-ad="${k}" aria-pressed="${k === AN_DAYS}">${l}</button>`).join('')}</div></div>
    <div id="anBody"><p class="form-note">Wird geladen …</p></div></section>`;
  v.querySelectorAll('[data-ad]').forEach((b) => b.onclick = () => { AN_DAYS = Number(b.dataset.ad); v.querySelectorAll('[data-ad]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); });
  const load = async () => {
    const box = $('#anBody'); box.style.opacity = '.55';
    const r = await api(`/api/admin/system?analytics=${seg}&days=${AN_DAYS}`);
    box.style.opacity = '';
    if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
    const d = r.data, ev = d.events || {}, evv = d.eventVisitors || {};
    const delta = (a, b) => { if (!b) return a ? '<small class="an-d up">neu</small>' : ''; const p = Math.round(((a - b) / b) * 100); return `<small class="an-d ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)} % zum Vorzeitraum</small>`; };
    const tile = (l, val, sub = '') => `<div class="ad-tile"><span class="ad-tile-l">${l}</span><strong>${val}</strong>${sub}</div>`;
    const ppv = d.visitors ? (d.pageviews / d.visitors).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–';
    const tiles = seg === 'b2b' ? [
      tile('Besucher', nf(d.visitors), delta(d.visitors, d.prevVisitors)), tile('Seitenaufrufe', nf(d.pageviews), delta(d.pageviews, d.prevPageviews)), tile('Seiten je Besuch', ppv),
      tile('Kontoanfragen', nf(ev.b2b_request), '<small>über Formular / Portal</small>'), tile('Demo & Kontakt', nf(ev.b2b_contact)), tile('Portal-Anmeldungen', nf(ev.b2b_login)),
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
    box.innerHTML = `<div class="ad-tiles">${tiles.join('')}</div>
      <section class="pt-card"><h3>Besucher und Seitenaufrufe je Tag</h3>${chart(d.series || [])}</section>
      <section class="pt-card"><h3>Weg zum ${seg === 'b2b' ? 'Unternehmenskonto' : 'Kauf'}</h3><div class="fn">${funnel}</div><p class="form-note">Besucherzahlen je Schritt im gewählten Zeitraum. Registrierungen und Käufe kommen aus Datenbank bzw. Stripe und sind deshalb auch bei aktivem „Do Not Track“ vollständig.</p></section>
      <div class="an-grid">${list('Beliebteste Seiten', (d.pages || []).map((p) => [p[0], p[1]]), (x) => x, 'Seitenaufrufe')}${list('Herkunft', d.refs || [])}${list('Kampagnen (utm)', d.campaigns || [])}${list('Geräte', d.devices || [], (x) => DEV[x] || x)}${list('Browser', d.browsers || [])}${list('Betriebssystem', d.os || [])}${list('Länder', d.countries || [], (x) => (x === '??' ? 'Unbekannt' : (cn ? cn.of(x) : x)))}</div>
      <div class="an-grid an-geo">${list('Städte', (d.cities || []).map(([c, r, k, n]) => [`${c}${r ? ' · ' + (k === 'DE' && BL[r] ? BL[r] : r) : ''}${k && k !== 'DE' ? ' (' + k + ')' : ''}`, n]))}${list('Bundesländer / Regionen', (d.regions || []).map(([r, k, n]) => [k === 'DE' && BL[r] ? BL[r] : `${r} (${k})`, n]))}</div>
      <p class="form-note">Besucher = eindeutige Besucher je Tag, über den Zeitraum summiert (ohne Cookies ist ein Wiedererkennen über Tage bewusst nicht möglich). Nicht gezählt: Administratoren-Bereich, Bots, Besucher mit „Do Not Track“ bzw. Global Privacy Control. Ort: ungefähr, aus der IP-Adresse abgeleitet (IP wird nicht gespeichert); Städte erst ab dem 17.10.2026. Erfassung seit Oktober 2026.</p>`;
  };
  load();
}

const BL = { BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen' };

// Kleines Liniendiagramm (SVG) für die Tageswerte.
function chart(series) {
  if (!series.length) return '<p class="form-note">Noch keine Daten.</p>';
  const sm = innerWidth < 600, W = sm ? 360 : 720, H = sm ? 200 : 220, P = { l: 40, r: 12, t: 12, b: 28 }, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxV = Math.max(4, ...series.map((x) => Math.max(x[1], x[2])));
  const step = Math.pow(10, Math.floor(Math.log10(maxV))) * (maxV / Math.pow(10, Math.floor(Math.log10(maxV))) > 5 ? 2 : 1), top = Math.ceil(maxV / step) * step;
  const X = (i) => P.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw), Y = (v) => P.t + ih - (v / top) * ih;
  const line = (k) => series.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join('');
  const grid = []; for (let v = 0; v <= top; v += step) grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="an-g"/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="an-t">${v.toLocaleString('de-DE')}</text>`);
  const every = Math.max(1, Math.ceil(series.length / (sm ? 4 : 8)));
  const lab = series.map((x, i) => ((i % every === 0 && series.length - 1 - i >= every / 2) || i === series.length - 1) ? `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="an-t">${new Date(x[0]).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</text>` : '').join('');
  const dots = series.length <= 31 ? series.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x[1])}" r="3" class="an-dv"><title>${new Date(x[0]).toLocaleDateString('de-DE')}: ${x[1]} Besucher, ${x[2]} Aufrufe</title></circle>`).join('') : '';
  return `<div class="an-legend"><span class="an-lv">Besucher</span><span class="an-lp">Seitenaufrufe</span></div><svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Besucher und Seitenaufrufe je Tag">${grid.join('')}<path d="${line(2)}" class="an-p"/><path d="${line(1)}" class="an-v"/>${dots}${lab}</svg>`;
}

// ---------- Einrichtung: offene Punkte mit Anleitung, Erledigtes eingeklappt ----------
async function einrichtung(v) {
  const r = await api('/api/admin/setup');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  const all = r.data.items || [];
  const open = all.filter((x) => !x.ok), done = all.filter((x) => x.ok);
  const must = open.filter((x) => !x.optional);
  const pct = all.length ? Math.round((done.length / all.length) * 100) : 0;
  const groups = [...new Set(all.map((x) => x.group))];
  const card = (x) => `<li><button type="button" class="su-item su-row${x.optional ? ' opt' : ''}" data-open="${x.id}"><span class="su-h"><strong>${esc(x.title)}</strong>${x.optional ? '<span class="su-tag">optional</span>' : ''}<span class="su-tag ${x.auto ? 'auto' : 'man'}">${x.auto ? 'wird automatisch erkannt' : 'selbst abhaken'}</span></span>
      <span class="su-sub">${esc(x.why)}</span><span class="su-go">${x.time ? `ca. ${esc(x.time)} · ` : ''}Anleitung öffnen ›</span></button></li>`;
  v.innerHTML = `<section class="ad-over"><div class="ad-over-h"><h2>Einrichtung</h2><p class="form-note">${must.length ? `<strong>${must.length} Pflichtpunkt${must.length === 1 ? '' : 'e'} offen</strong>${open.length > must.length ? `, ${open.length - must.length} optional` : ''}.` : '<strong>Alle Pflichtpunkte erledigt.</strong>'} Tippen Sie auf einen Punkt – dann kommt die genaue Schritt-für-Schritt-Anleitung. Werte nie per Chat oder E-Mail weitergeben, immer direkt in Vercel eintragen.</p></div>
    <div class="su-bar" role="img" aria-label="${pct} Prozent erledigt"><i style="width:${pct}%"></i></div><p class="form-note">${done.length} von ${all.length} erledigt</p>
    ${groups.map((g) => { const o = open.filter((x) => x.group === g); return o.length ? `<h3 class="ad-sub">${esc(g)}</h3><ol class="su-list">${o.map(card).join('')}</ol>` : ''; }).join('') || '<p class="pt-alert ok">Alles eingerichtet.</p>'}
    ${done.length ? `<details class="ad-help"><summary>Erledigt (${done.length})</summary><ul class="su-done-list">${done.map((x) => `<li><button type="button" class="text-btn" data-open="${x.id}">✓ ${esc(x.title)}</button>${x.auto ? '<small>automatisch erkannt</small>' : `<button type="button" class="text-btn" data-undo="${x.id}">wieder öffnen</button>`}</li>`).join('')}</ul></details>` : ''}</section>`;
  const mark = async (id, val) => { const x = await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ id, done: val }) }); if (!x.ok) msg(x.data?.error || 'Fehler', true); einrichtung(v); };
  const guide = (x) => {
    let d = document.getElementById('suDlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'suDlg'; d.className = 'ad-dlg'; document.body.append(d); }
    const n = x.steps.length;
    d.innerHTML = `<div class="ad-dlg-in su-guide"><div class="ad-dlg-h"><h2>${esc(x.title)}</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
      <p class="su-state ${x.ok ? 'ok' : 'open'}">${x.ok ? '✓ Erledigt' : 'Offen'}${x.time ? ` · Dauer ca. ${esc(x.time)}` : ''} · ${n} Schritt${n === 1 ? '' : 'e'}${x.info ? ` · ${esc(x.info)}` : ''}</p>
      <div class="su-why"><strong>Wozu?</strong> ${esc(x.why)}</div>
      ${x.need ? `<div class="su-need"><strong>Vorher bereitlegen:</strong> ${esc(x.need)}</div>` : ''}
      <ol class="su-gsteps">${x.steps.map((st, i) => `<li><label><input type="checkbox" data-st="${i}"><span class="su-num">${i + 1}</span><span class="su-txt">${st}</span></label></li>`).join('')}</ol>
      ${x.check ? `<div class="su-check"><strong>So prüfen Sie, ob es geklappt hat:</strong> ${x.check}</div>` : ''}
      <p class="form-note">Die Häkchen an den Schritten sind nur Ihre Merkhilfe und werden in diesem Browser gespeichert.</p>
      <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Schließen</button>${x.auto ? `<button type="button" class="btn btn-dark" data-re>Erneut prüfen</button>` : x.ok ? `<button type="button" class="btn btn-outline" data-un>Wieder öffnen</button>` : `<button type="button" class="btn btn-dark" data-ok>Fertig – als erledigt markieren</button>`}</div></div>`;
    const K = 'su_' + x.id; let st = {}; try { st = JSON.parse(localStorage.getItem(K) || '{}'); } catch { /* privat */ }
    d.querySelectorAll('[data-st]').forEach((c) => { c.checked = Boolean(st[c.dataset.st]); c.onchange = () => { st[c.dataset.st] = c.checked; try { localStorage.setItem(K, JSON.stringify(st)); } catch { /* privat */ } }; });
    d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
    d.querySelector('[data-re]')?.addEventListener('click', () => { d.close(); einrichtung(v); });
    d.querySelector('[data-ok]')?.addEventListener('click', () => { d.close(); mark(x.id, true); });
    d.querySelector('[data-un]')?.addEventListener('click', () => { d.close(); mark(x.id, false); });
    d.showModal();
  };
  v.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => guide(all.find((x) => x.id === b.dataset.open)));
  v.querySelectorAll('[data-undo]').forEach((b) => b.onclick = () => mark(b.dataset.undo, false));
}
