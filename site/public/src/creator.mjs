// LeaseRun Creator Partner: Bewerbung (einmaliges Onboarding), Prüfstatus und Creator-Portal.
// Gemeinsame Anmeldung mit dem Kundenbereich (Supabase). Alle Prüfungen passieren zusätzlich auf dem Server.
// Sicherheitstexte beschreiben nur Maßnahmen, die tatsächlich umgesetzt sind (siehe lib/creator/*).
import { api, dt, esc, loginForm, logout, setSession, token } from './sess.mjs?v=892f3666';

const root = document.getElementById('creator');
const $ = (s, el = document) => el.querySelector(s);
let me = null;
let step = null;
let view = 'home';
// Die Landingpage steht fertig im HTML (sofort sichtbar, ohne auf Skript und Anmeldung zu warten). Hier nur einmal merken.
const LANDING = document.getElementById('crLanding')?.outerHTML || '';

const STEPS = [['account', 'Konto'], ['profile', 'Profil'], ['social', 'Social Media'], ['business', 'Rechnungsdaten'], ['payout', 'Auszahlung'], ['agreement', 'Vereinbarung'], ['review', 'Prüfen']];
const CATS = [['immobilien', 'Immobilien'], ['finanzen', 'Finanzen'], ['business', 'Business'], ['entrepreneurship', 'Entrepreneurship'], ['lifestyle', 'Lifestyle'], ['technology', 'Technology'], ['education', 'Education'], ['other', 'Sonstiges']];
const RANGES = [['', 'keine Angabe'], ['lt_1k', 'unter 1.000'], ['1k_10k', '1.000 – 10.000'], ['10k_50k', '10.000 – 50.000'], ['50k_100k', '50.000 – 100.000'], ['100k_500k', '100.000 – 500.000'], ['500k_1m', '500.000 – 1 Mio.'], ['gt_1m', 'über 1 Mio.']];
const PLATFORMS = [
  ['youtube', 'YouTube', { channel: true, handle: 'Handle (z. B. @kanal)', range: 'Abonnenten' }],
  ['tiktok', 'TikTok', { handle: 'Username', range: 'Follower' }],
  ['instagram', 'Instagram', { handle: 'Username', range: 'Follower' }],
  ['x', 'X', { handle: 'Username', range: 'Follower' }],
  ['linkedin', 'LinkedIn', {}],
  ['other', 'Andere Plattform', { label: true, handle: 'Username' }],
];
const COUNTRIES = [['DE', 'Deutschland'], ['AT', 'Österreich'], ['CH', 'Schweiz'], ['NL', 'Niederlande'], ['BE', 'Belgien'], ['LU', 'Luxemburg'], ['FR', 'Frankreich'], ['IT', 'Italien'], ['ES', 'Spanien'], ['PT', 'Portugal'], ['PL', 'Polen'], ['CZ', 'Tschechien'], ['DK', 'Dänemark'], ['SE', 'Schweden'], ['NO', 'Norwegen'], ['FI', 'Finnland'], ['IE', 'Irland'], ['GB', 'Vereinigtes Königreich'], ['GR', 'Griechenland'], ['HR', 'Kroatien'], ['HU', 'Ungarn'], ['RO', 'Rumänien'], ['BG', 'Bulgarien'], ['SI', 'Slowenien'], ['SK', 'Slowakei'], ['EE', 'Estland'], ['LV', 'Lettland'], ['LT', 'Litauen'], ['CY', 'Zypern'], ['MT', 'Malta'], ['TR', 'Türkei'], ['AE', 'Vereinigte Arabische Emirate'], ['US', 'USA']];
const VAT = [['small_business', 'Kleinunternehmer (§ 19 UStG) – ohne Umsatzsteuer'], ['vat_registered', 'Umsatzsteuerpflichtig'], ['not_applicable', 'Nicht anwendbar / Sitz im Ausland']];
const PAY_STATUS = { PROVIDED: ['ok', 'Hinterlegt'], VERIFIED: ['ok', 'Geprüft'], VERIFICATION_REQUIRED: ['warn', 'In Prüfung'], SUPERSEDED: ['', 'Abgelöst'] };

// ---------- Hilfen ----------
const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === (cur ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
const toast = (t, bad = false) => {
  let el = $('#crToast');
  if (!el) { el = document.createElement('div'); el.id = 'crToast'; el.className = 'pt-toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = t; el.classList.toggle('bad', bad); el.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600);
};
function formMsg(form, text, field) {
  form.querySelectorAll('.bad').forEach((x) => x.classList.remove('bad'));
  const m = form.querySelector('.cr-msg');
  if (m) { m.hidden = !text; m.className = 'cr-msg pt-alert bad'; m.textContent = text || ''; }
  if (field) { const f = form.querySelector(`[name="${CSS.escape(field.split('.').pop())}"]`); if (f) { f.classList.add('bad'); f.focus(); } }
}
async function save(form, body, url = '/api/creator/me', method = 'PATCH') {
  const btn = form.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    const r = await api(url, { method, body: JSON.stringify(body) });
    if (!r.ok) { formMsg(form, r.data?.error || 'Speichern fehlgeschlagen.', r.data?.field); return null; }
    formMsg(form, '');
    return r.data;
  } finally { if (btn) btn.disabled = false; }
}
const val = (f, n) => (f.elements[n]?.value ?? '').trim();

// IBAN: gleiche Prüfung wie auf dem Server (lib/creator/iban.ts), nur als Komfort vor dem Absenden.
const IBAN_LEN = { AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30 };
const SEPA = new Set(['AD', 'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GI', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'SM', 'VA']);
const normIban = (s) => String(s || '').toUpperCase().replace(/[\s\-.]/g, '');
function ibanOk(raw) {
  const i = normIban(raw);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$/.test(i) || IBAN_LEN[i.slice(0, 2)] !== i.length) return null;
  let rest = 0;
  for (const ch of i.slice(4) + i.slice(0, 4)) { const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch; for (const d of v) rest = (rest * 10 + (d.charCodeAt(0) - 48)) % 97; }
  return rest === 1 ? { country: i.slice(0, 2), last4: i.slice(-4), sepa: SEPA.has(i.slice(0, 2)) } : null;
}
const mask = (c, l4) => `${c}${'•'.repeat(10)}${l4}`;

// ---------- Start ----------
const DIRECT_LOGIN = new URLSearchParams(location.search).has('anmelden') || location.hash === '#anmelden';
async function boot() {
  root.dataset.booted = '1';
  if (!token()) { if (DIRECT_LOGIN && !AUTH_HASH[location.hash.slice(1)]) { history.replaceState(null, '', '/creators'); landing(false); authForm('login'); } else route(); return; }
  const r = await api('/api/creator/me');
  if (r.status === 401) {
    // Keine gültige Creator-Sitzung (z. B. Konto aus einem anderen Portal): verwerfen und zur Creator-Anmeldung.
    setSession(null); me = null;
    if (r.data?.code === 'wrong_account') { history.replaceState(null, '', '/creators'); landing(false); authForm('login', 'Bitte melde dich mit deinem Creator-Konto an. Konten aus Kundenbereich oder Unternehmensportal gelten hier nicht.'); } else route();
    return;
  }
  if (r.data?.code === 'setup') { root.innerHTML = `<div class="cr-wrap"><section class="pt-card cr-setup"><h1>Gleich geht's los</h1><p>${esc(r.data.error)}</p><p class="form-note">Deine Anmeldung bleibt bestehen. Fragen? <a href="mailto:support@leaserun.com">support@leaserun.com</a></p></section></div>`; return; }
  if (!r.ok) { root.innerHTML = `<div class="cr-wrap"><div class="pt-alert bad">${esc(r.data?.error || 'Der Creator-Bereich konnte nicht geladen werden.')} <button type="button" class="btn btn-outline" id="crRetry">Erneut versuchen</button></div></div>`; $('#crRetry').onclick = boot; return; }
  me = r.data;
  route();
}

function routeByStatus() {
  if (!me.creator) { landing(true); return; }
  const s = me.creator.status;
  if (s === 'DRAFT' || s === 'INFO_REQUESTED') wizard();
  else if (s === 'SUBMITTED' || s === 'UNDER_REVIEW') pending();
  else if (s === 'ACTIVE') portal();
  else closed(s);
}

async function refresh() {
  const r = await api('/api/creator/me');
  if (r.ok) me = r.data;
  return r.ok;
}

// ---------- Landingpage ----------
function landing(loggedIn) {
  document.title = 'Creator werden | LeaseRun Creator Partner';
  document.documentElement.classList.remove('cr-auth');
  if (loggedIn && AUTH_HASH[location.hash.slice(1)]) history.replaceState(null, '', location.pathname);
  if (!$('#crLanding', root)) root.innerHTML = LANDING;
  $('.cr-ld', root)?.remove();
  const b2b = loggedIn && me?.b2b;
  if (loggedIn) {
    // Wer angemeldet ist, sieht mit welchem Konto – und kann wechseln (eigene Creator-Sitzung, getrennt von Kundenbereich und Unternehmensportal).
    $('#crLogin').outerHTML = `<div class="cr-who"><span>Angemeldet als <strong>${esc(me?.email || '')}</strong></span><button type="button" class="btn btn-outline btn-sm" id="crSwitch">Abmelden</button></div>`;
    for (const b of root.querySelectorAll('#crStart button[type=submit], #crStart2, #crStart3')) b.textContent = b2b ? 'Mit anderem Konto anmelden' : 'Bewerbung starten';
    $('#crLogin2')?.closest('p')?.remove();
    $('#crLogin3')?.remove();
    if (b2b) {
      const m = $('.cr-msg'); m.hidden = false; m.className = 'cr-msg pt-alert warn';
      m.innerHTML = `Du bist mit <strong>${esc(me.email)}</strong> angemeldet – diese E-Mail-Adresse gehört zu einem Unternehmenszugang. Für den Creator-Bereich brauchst du ein eigenes Konto mit einer anderen E-Mail-Adresse.`;
      m.style.margin = '0 0 16px'; $('#crStart').before(m);
    }
  }
  const ts = Date.now();
  const apply = async (mode = 'signup') => {
    if (!loggedIn) { authForm(mode); return; }
    if (b2b) { switchAccount(); return; }
    const btn = $('#crStart button[type=submit]'); btn.disabled = true;
    // Der Spam-Schutz des Servers lehnt Anfragen unter 1,5 s nach dem Laden ab – sehr schnelle Klicks kurz abwarten.
    const wait = 1700 - (Date.now() - ts); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await api('/api/creator/me', { method: 'POST', body: JSON.stringify({ website: $('#crStart').elements.website.value, ts }) });
    btn.disabled = false;
    if (!r.ok) { const m = $('.cr-msg'); m.hidden = false; m.textContent = r.data?.error || 'Das hat nicht geklappt. Bitte erneut versuchen.'; $('.cr-hero').scrollIntoView(); return; }
    me = r.data; step = 'account'; go('bewerbung-account'); window.scrollTo({ top: 0 });
  };
  $('#crStart').onsubmit = (e) => { e.preventDefault(); apply(); };
  for (const id of ['#crStart2', '#crStart3']) $(id)?.addEventListener('click', () => apply());
  for (const id of ['#crLogin', '#crLogin2', '#crLogin3']) $(id)?.addEventListener('click', () => apply('login'));
  $('#crSwitch')?.addEventListener('click', () => { setSession(null); location.href = '/creators'; });
  $('.cr-hero-link')?.addEventListener('click', (e) => { e.preventDefault(); $('#so-gehts')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
  // Mobile: Bewerben-Knopf bleibt unten sichtbar, sobald der Knopf im Kopfbereich aus dem Bild ist und bevor der Schluss-Knopf erscheint.
  const sticky = $('#crSticky');
  if ('IntersectionObserver' in window) {
    const seen = new Map();
    const io = new IntersectionObserver((es) => { es.forEach((e) => seen.set(e.target, e.isIntersecting)); sticky.hidden = [...seen.values()].some(Boolean); });
    [$('.cr-hero'), $('.cr-end'), $('footer.ia-legal')].filter(Boolean).forEach((el) => { seen.set(el, true); io.observe(el); });
  }
}

// Konto wechseln: Sitzung auf diesem Gerät beenden und die Anmeldung zeigen (gilt für die ganze Website).
function switchAccount() {
  setSession(null);
  me = null;
  authForm('login', 'Bitte melde dich mit deinem Creator-Konto an oder lege ein neues an.');
}

// ---------- Navigation ----------
// Jede Ansicht hat eine eigene Adresse: Start (ohne #), #anmelden, #registrieren, #bewerbung-<schritt>, Portal-Reiter (#home …).
// So funktionieren Zurück und Vorwärts des Browsers (und die Wischgeste auf dem Handy) überall im Creator-Bereich.
const AUTH_HASH = { anmelden: 'login', registrieren: 'signup' };
let pendingNotice = '';
let authFromStart = false;
function go(hash) {
  const h = hash ? '#' + hash : '';
  if (location.hash === h) { route(); return; }
  if (h) location.hash = h; else { history.pushState(null, '', location.pathname + location.search); route(); }
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!token() || !me) { if (h === 'passwort') renderForgot(); else if (AUTH_HASH[h]) renderAuth(AUTH_HASH[h]); else landing(false); return; }
  if (!me.creator) { landing(true); return; }
  const s = me.creator.status;
  if ((s === 'DRAFT' || s === 'INFO_REQUESTED') && h.startsWith('bewerbung-') && STEPS.some(([k]) => k === h.slice(10))) step = h.slice(10);
  routeByStatus();
}
window.addEventListener('hashchange', () => { if (root.dataset.booted) { route(); window.scrollTo({ top: 0 }); } });

function authForm(mode = 'signup', notice = '') {
  pendingNotice = notice;
  authFromStart = !AUTH_HASH[location.hash.slice(1)];
  go(mode === 'signup' ? 'registrieren' : 'anmelden');
}

// Passwort vergessen (eigene Creator-Konten): Link zum Zurücksetzen an die E-Mail-Adresse.
function renderForgot() {
  document.title = 'Passwort vergessen | LeaseRun Creator';
  root.innerHTML = `<div class="area-login"><button type="button" class="area-back" id="aBack">← Zurück zur Anmeldung</button>
    <h1>Passwort vergessen</h1><p class="form-note">Gib die E-Mail-Adresse deines Creator-Kontos ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.</p>
    <form id="crPw" novalidate><label>E-Mail<input id="aEmail" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <div class="auth-message" id="aMsg" role="alert" hidden></div><button class="btn btn-dark btn-lg" type="submit">Link senden</button></form>
    <p class="form-note">Der Creator-Bereich hat eigene Konten. Für Kundenbereich oder Unternehmensportal setzt du das Passwort dort zurück.</p></div>`;
  $('#aBack').onclick = () => go('anmelden');
  const f = $('#crPw'), m = $('#aMsg');
  $('#aEmail').focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const email = f.elements.email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { m.hidden = false; m.className = 'auth-message error'; m.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.'; return; }
    const btn = f.querySelector('button'); btn.disabled = true;
    const r = await fetch('/api/creator/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'recover', email }) }).catch(() => null);
    btn.disabled = false; m.hidden = false;
    if (r?.ok) { m.className = 'auth-message success'; m.textContent = 'Falls es zu dieser Adresse ein Creator-Konto gibt, haben wir dir einen Link geschickt. Bitte schau in dein Postfach.'; }
    else { const d = await r?.json().catch(() => ({})); m.className = 'auth-message error'; m.textContent = d?.error || 'Das hat nicht geklappt. Bitte später erneut versuchen.'; }
  };
}

function renderAuth(mode) {
  const notice = pendingNotice; pendingNotice = '';
  document.title = mode === 'signup' ? 'Konto anlegen | LeaseRun Creator' : 'Anmelden | LeaseRun Creator';
  loginForm(root, {
    back: { label: 'Zurück zur Übersicht', go: () => { if (authFromStart) history.back(); else go(''); } },
    title: 'Creator-Konto',
    lead: 'Melde dich mit deinem Creator-Konto an, um deine Bewerbung zu beginnen oder fortzusetzen. Der Creator-Bereich hat eine eigene Anmeldung.',
    signupLead: 'Lege dein Creator-Konto an. Danach bestätigst du deine E-Mail-Adresse und kannst deine Bewerbung ausfüllen.',
    note: 'Nach der Registrierung erhältst du eine E-Mail zur Bestätigung deiner Adresse.',
    signup: { next: '/creators' },
  });
  if (mode === 'signup') $('[data-mode="signup"]', root)?.click();
  if (notice) { const n = document.createElement('p'); n.className = 'pt-alert ok cr-notice'; n.textContent = notice; $('.area-login h1', root)?.after(n); }
  window.scrollTo({ top: 0 });
}

// ---------- Onboarding-Assistent ----------
function wizard() {
  document.title = 'Bewerbung | LeaseRun Creator';
  const st = me.steps;
  if (!step) step = me.creator.status === 'INFO_REQUESTED' ? 'review' : (STEPS.find(([k]) => k !== 'review' && !st[k].done)?.[0] || 'review');
  const idx = STEPS.findIndex(([k]) => k === step);
  if (location.hash !== '#bewerbung-' + step) history.replaceState(null, '', '#bewerbung-' + step);
  root.innerHTML = `<div class="cr-wrap">
    <div class="wa-h-row" style="margin-bottom:12px"><a class="pt-brand dark" href="/"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a><button type="button" class="btn btn-outline btn-sm" id="crOut">Abmelden</button></div>
    ${me.creator.status === 'INFO_REQUESTED' ? `<div class="pt-alert warn"><strong>LeaseRun benötigt noch eine Information von dir.</strong>${me.creator.info_request ? `<p style="margin:6px 0 0;white-space:pre-wrap">${esc(me.creator.info_request)}</p>` : ''}${step === 'review' ? '<p style="margin:10px 0 0"><button type="button" class="btn btn-dark btn-sm" data-step="account">Angabe ergänzen</button></p>' : ''}</div>` : ''}
    <ol class="cr-steps" aria-label="Schritte der Bewerbung">${STEPS.map(([k, l], i) => `<li><button type="button" data-step="${k}" class="${k !== 'review' && st[k].done ? 'done' : ''}"${k === step ? ' aria-current="step"' : ''}><i>${k !== 'review' && st[k].done ? '' : i + 1}</i>${esc(l)}</button></li>`).join('')}</ol>
    <section class="pt-card cr-form" id="crStep"></section>
    <p class="form-note">Schritt ${idx + 1} von ${STEPS.length} · Deine Angaben werden mit jedem Schritt gespeichert.</p></div>`;
  $('#crOut').onclick = logout;
  root.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => go('bewerbung-' + b.dataset.step));
  const next = async () => { await refresh(); const i = STEPS.findIndex(([k]) => k === step); const nx = STEPS[Math.min(i + 1, STEPS.length - 1)][0]; if (['DRAFT', 'INFO_REQUESTED'].includes(me.creator?.status)) go('bewerbung-' + nx); else { step = nx; routeByStatus(); } window.scrollTo({ top: 0 }); };
  const back = idx > 0 ? () => go('bewerbung-' + STEPS[idx - 1][0]) : null;
  renderSection(step, $('#crStep'), { onSaved: next, back, wizard: true });
  $('#crStep').querySelector('input:not([readonly]),select,textarea')?.focus({ preventScroll: true });
}

const navRow = (o, label = 'Speichern und weiter') => `<p class="cr-msg pt-alert bad" hidden></p><div class="wiz-nav">${o.back ? '<button type="button" class="btn btn-outline" data-back>Zurück</button>' : '<span></span>'}<button type="submit" class="btn btn-dark">${esc(o.wizard ? label : 'Speichern')}</button></div>`;
const bindBack = (el, o) => { const b = el.querySelector('[data-back]'); if (b && o.back) b.onclick = o.back; };
const lockNote = '<div class="pt-alert">Deine Angaben werden gerade geprüft und können in diesem Moment nicht geändert werden.</div>';

function renderSection(key, el, o) {
  ({ account: secAccount, profile: secProfile, social: secSocial, business: secBusiness, payout: secPayout, agreement: secAgreement, review: secReview })[key](el, o);
}

function secAccount(el, o) {
  const c = me.creator;
  el.innerHTML = `<h2>Dein Konto</h2><form novalidate>
    <div class="wa-grid2">
      <label>Vorname*<input name="first_name" autocomplete="given-name" required maxlength="80" value="${esc(c.first_name || '')}"></label>
      <label>Nachname*<input name="last_name" autocomplete="family-name" required maxlength="80" value="${esc(c.last_name || '')}"></label>
      <label>E-Mail<input value="${esc(me.email)}" readonly aria-describedby="crMailSt"><small class="hint" id="crMailSt">${me.email_confirmed ? '<span class="st ok">✓ bestätigt</span>' : '<span class="st warn">noch nicht bestätigt – bitte den Link in unserer E-Mail öffnen</span>'}</small></label>
      <label>Land*<select name="country" required autocomplete="country"><option value="">Bitte wählen</option>${opts(COUNTRIES, c.country)}</select></label>
      <label>Telefon <small class="hint">optional</small><input name="phone" type="tel" autocomplete="tel" maxlength="40" value="${esc(c.phone || '')}"></label>
    </div>${navRow(o)}</form>`;
  const f = el.querySelector('form');
  bindBack(el, o);
  if (!me.steps.account.editable) { f.querySelectorAll('input,select').forEach((x) => { x.disabled = true; }); f.querySelector('.wiz-nav').remove(); return; }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = await save(f, { section: 'account', data: { first_name: val(f, 'first_name'), last_name: val(f, 'last_name'), country: val(f, 'country'), phone: val(f, 'phone') || null } });
    if (d) { me = d; o.onSaved?.(); }
  };
}

function secProfile(el, o) {
  const c = me.creator;
  el.innerHTML = `<h2>Dein Creator-Profil</h2><p class="form-note">So stellst du dich LeaseRun vor. Dein Profil ist nicht öffentlich.</p><form novalidate>
    <div class="wa-grid2">
      <label>Creator-Name / Anzeigename*<input name="display_name" required maxlength="80" value="${esc(c.display_name || '')}"></label>
      <label>Unternehmen <small class="hint">optional</small><input name="company" maxlength="120" autocomplete="organization" value="${esc(c.company || '')}"></label>
      <label class="full">Website <small class="hint">optional</small><input name="website" type="url" inputmode="url" maxlength="200" placeholder="https://" value="${esc(c.website || '')}"></label>
      <label class="full">Kurzbeschreibung <small class="hint">optional, max. 600 Zeichen</small><textarea name="bio" maxlength="600" rows="4">${esc(c.bio || '')}</textarea></label>
      <fieldset class="cr-cats full"><legend>Content-Kategorien*</legend>${CATS.map(([v, l]) => `<label><input type="checkbox" name="categories" value="${v}"${(c.categories || []).includes(v) ? ' checked' : ''}>${esc(l)}</label>`).join('')}</fieldset>
    </div>${navRow(o)}</form>`;
  const f = el.querySelector('form');
  bindBack(el, o);
  if (!me.steps.profile.editable) { f.querySelectorAll('input,select,textarea').forEach((x) => { x.disabled = true; }); f.querySelector('.wiz-nav').remove(); return; }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const cats = [...f.querySelectorAll('[name=categories]:checked')].map((x) => x.value);
    if (!cats.length) { formMsg(f, 'Bitte mindestens eine Kategorie wählen.'); return; }
    const d = await save(f, { section: 'profile', data: { display_name: val(f, 'display_name'), company: val(f, 'company') || null, website: val(f, 'website') || null, bio: val(f, 'bio') || null, categories: cats } });
    if (d) { me = d; o.onSaved?.(); }
  };
}

function secSocial(el, o) {
  const have = (p) => me.socials.find((s) => s.platform === p) || null;
  el.innerHTML = `<h2>Social Media</h2>
    <div class="cr-note"><strong>Keine Verbindung deiner Social-Media-Konten.</strong> Du musst nichts verbinden – kein Login, keine Passwörter, kein API-Zugriff. LeaseRun benötigt nur die öffentlichen Angaben deines Profils. Gib die Plattformen an, auf denen du aktiv bist (mindestens eine).</div>
    <form novalidate>${PLATFORMS.map(([p, name, cfg]) => { const s = have(p); return `<details class="cr-plat" data-p="${p}"${s ? ' open' : ''}><summary>${esc(name)}${s ? '<span class="st ok">angegeben</span>' : ''}</summary><div class="wa-grid2">
      ${cfg.label ? `<label>Plattform<input name="platform_label" maxlength="40" value="${esc(s?.platform_label || '')}"></label>` : ''}
      ${cfg.channel ? `<label>Kanalname<input name="channel_name" maxlength="100" value="${esc(s?.channel_name || '')}"></label>` : ''}
      ${cfg.handle ? `<label>${esc(cfg.handle)}<input name="handle" maxlength="100" autocapitalize="none" spellcheck="false" value="${esc(s?.handle || '')}"></label>` : ''}
      <label class="${cfg.handle || cfg.channel ? '' : 'full'}">Profil-URL<input name="url" type="url" inputmode="url" maxlength="300" placeholder="https://" autocapitalize="none" spellcheck="false" value="${esc(s?.url || '')}"></label>
      ${cfg.range ? `<label>${esc(cfg.range)} <small class="hint">optional, ungefähr</small><select name="follower_range">${opts(RANGES, s?.follower_range || '')}</select></label>` : ''}
    </div></details>`; }).join('')}${navRow(o)}</form>`;
  const f = el.querySelector('form');
  bindBack(el, o);
  if (!me.steps.social.editable) { f.querySelectorAll('input,select').forEach((x) => { x.disabled = true; }); f.querySelector('.wiz-nav').remove(); return; }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const list = [];
    for (const d of f.querySelectorAll('.cr-plat')) {
      const g = (n) => (d.querySelector(`[name=${n}]`)?.value || '').trim();
      if (!g('url')) continue;
      list.push({ platform: d.dataset.p, platform_label: g('platform_label') || null, channel_name: g('channel_name') || null, handle: g('handle') || null, url: g('url'), follower_range: g('follower_range') || null });
    }
    if (!list.length) { formMsg(f, 'Bitte mindestens ein öffentliches Profil mit URL angeben.'); return; }
    const d = await save(f, { section: 'social', data: { socials: list } });
    if (d) { me = d; o.onSaved?.(); }
  };
}

function secBusiness(el, o) {
  const b = me.business || {};
  const company = b.entity_type === 'company';
  el.innerHTML = `<h2>Business- und Rechnungsdaten</h2><p class="form-note">Wir fragen nur, was für Gutschriften und Rechnungen nötig ist.</p><form novalidate>
    <div class="seg" role="radiogroup" aria-label="Art" style="margin-bottom:12px"><button type="button" role="radio" data-et="individual" aria-selected="${!company}">Privatperson / Einzelunternehmen</button><button type="button" role="radio" data-et="company" aria-selected="${company}">Unternehmen</button></div>
    <input type="hidden" name="entity_type" value="${company ? 'company' : 'individual'}">
    <div class="wa-grid2">
      <label class="full" id="crLn">${company ? 'Firma*' : 'Vollständiger Name*'}<input name="legal_name" required maxlength="160" value="${esc(b.legal_name || [me.creator.first_name, me.creator.last_name].filter(Boolean).join(' '))}"></label>
      <label id="crLf"${company ? '' : ' hidden'}>Rechtsform<input name="legal_form" maxlength="60" placeholder="z. B. GmbH, UG, GbR" value="${esc(b.legal_form || '')}"></label>
      <label class="full">Straße und Hausnummer*<input name="street" required maxlength="160" autocomplete="street-address" value="${esc(b.street || '')}"></label>
      <label>PLZ*<input name="postal_code" required maxlength="12" autocomplete="postal-code" inputmode="numeric" value="${esc(b.postal_code || '')}"></label>
      <label>Ort*<input name="city" required maxlength="80" autocomplete="address-level2" value="${esc(b.city || '')}"></label>
      <label>Land*<select name="country" required><option value="">Bitte wählen</option>${opts(COUNTRIES, b.country || me.creator.country)}</select></label>
      <label>Rechnungs-E-Mail*<input name="billing_email" type="email" required maxlength="200" value="${esc(b.billing_email || me.email)}"></label>
      <label class="full">Umsatzsteuer*<select name="vat_status" required><option value="">Bitte wählen</option>${opts(VAT, b.vat_status)}</select></label>
      <label>Steuernummer <small class="hint">falls vorhanden</small><input name="tax_number" maxlength="30" value="${esc(b.tax_number || '')}"></label>
      <label>USt-IdNr. <small class="hint">falls vorhanden</small><input name="vat_id" maxlength="15" autocapitalize="characters" value="${esc(b.vat_id || '')}"></label>
    </div><p class="form-note">Hinweis: LeaseRun leistet keine Steuerberatung. Bitte wähle die Umsatzsteuer-Angabe so, wie sie für dich gilt.</p>${navRow(o)}</form>`;
  const f = el.querySelector('form');
  bindBack(el, o);
  el.querySelectorAll('[data-et]').forEach((x) => x.onclick = () => {
    const co = x.dataset.et === 'company';
    el.querySelectorAll('[data-et]').forEach((y) => y.setAttribute('aria-selected', String(y === x)));
    f.elements.entity_type.value = x.dataset.et;
    $('#crLn', el).firstChild.textContent = co ? 'Firma*' : 'Vollständiger Name*';
    $('#crLf', el).hidden = !co;
  });
  if (!me.steps.business.editable) { f.querySelectorAll('input,select,button').forEach((x) => { x.disabled = true; }); f.querySelector('.wiz-nav').remove(); return; }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = await save(f, { section: 'business', data: {
      entity_type: f.elements.entity_type.value, legal_name: val(f, 'legal_name'), legal_form: f.elements.entity_type.value === 'company' ? val(f, 'legal_form') || null : null,
      street: val(f, 'street'), postal_code: val(f, 'postal_code'), city: val(f, 'city'), country: val(f, 'country'),
      tax_number: val(f, 'tax_number') || null, vat_id: val(f, 'vat_id') || null, vat_status: val(f, 'vat_status'), billing_email: val(f, 'billing_email'),
    } });
    if (d) { me = d; o.onSaved?.(); }
  };
}

// ---------- Zahlungsdaten ----------
const SECURITY_BOX = `<div class="cr-sec" role="note"><h3><span aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span> Deine Zahlungsdaten sind geschützt</h3>
  <p>Deine IBAN wird ausschließlich für die Abwicklung deiner vereinbarten Auszahlungen verwendet. Sie wird nicht öffentlich in deinem Creator-Profil angezeigt und nicht für Marketingzwecke verwendet.</p>
  <p>Der Zugriff auf Zahlungsdaten ist rollen- und berechtigungsabhängig. Sensible Zahlungsinformationen werden besonders geschützt und Zugriffe auf besonders geschützte Daten werden aus Sicherheits- und Auditgründen protokolliert.</p>
  <p>Im Creator-Portal und im Admin-Bereich werden sensible Zahlungsdaten grundsätzlich nur angezeigt, soweit sie für die jeweilige Aufgabe erforderlich sind.</p>
  <button type="button" class="link-btn" data-sec>Mehr über Sicherheit erfahren</button></div>`;

const SECURITY_ITEMS = [
  ['transfer', 'Verschlüsselte Übertragung', 'Deine Daten werden ausschließlich über geschützte Verbindungen (HTTPS/TLS) übertragen.'],
  ['key', 'Zugriffskontrolle', 'Nur autorisierte Benutzer und Systeme erhalten Zugriff entsprechend ihrer Berechtigung. Administratoren melden sich mit zweitem Faktor an.'],
  ['lock', 'Geschützte Speicherung', 'Deine IBAN wird verschlüsselt gespeichert und ist an dein Creator-Konto gebunden. Sie ist nie öffentlich zugänglich.'],
  ['eye', 'Maskierte Darstellung', 'Im normalen Portal wird deine IBAN beispielsweise so dargestellt: DE••••••••••4821'],
  ['log', 'Protokoll', 'Sicherheitsrelevante Zugriffe und Änderungen werden nachvollziehbar protokolliert – zum Beispiel jedes Anzeigen der vollständigen Zahlungsdaten im Admin-Bereich.'],
  ['nolink', 'Keine Social-Media-Verbindung', 'Deine Social-Media-Accounts werden nicht benötigt, um deine Auszahlung zu verwalten.'],
];
const securityList = () => `<ul class="cr-sec-list">${SECURITY_ITEMS.map(([i, t, d]) => `<li><span aria-hidden="true">${svg(i)}</span><div><strong>${esc(t)}</strong><p>${esc(d)}</p></div></li>`).join('')}</ul>`;

function securityModal() {
  const d = document.createElement('dialog');
  d.className = 'wa-dlg';
  d.setAttribute('aria-labelledby', 'crSecT');
  d.innerHTML = `<div class="wa-dlg-in"><div class="wa-h-row"><h2 id="crSecT" style="margin:0;color:#0F2C59">Wie schützt LeaseRun deine Zahlungsdaten?</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>${securityList()}<p class="form-note">Wir schützen deine Daten nach aktuellen Sicherheitsstandards und mehrstufig. Einen absoluten Schutz kann kein Anbieter versprechen – deshalb kombinieren wir mehrere Maßnahmen.</p><div class="wiz-nav"><span></span><button type="button" class="btn btn-dark" data-x>Verstanden</button></div></div>`;
  document.body.append(d);
  d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

function secPayout(el, o) {
  const p = me.payout;
  const editable = me.steps.payout.editable;
  const current = p ? `<div class="pt-card" style="background:#F8FAFC"><h3 style="margin-top:0">Aktuelle Zahlungsdaten</h3><dl class="cr-review"><dt>Kontoinhaber</dt><dd>${esc(p.holder_name)}</dd><dt>IBAN</dt><dd class="cr-mask">${esc(p.iban_masked)}</dd>${p.bic ? `<dt>BIC</dt><dd>${esc(p.bic)}</dd>` : ''}<dt>Status</dt><dd><span class="st ${PAY_STATUS[p.status]?.[0] || ''}">${esc(PAY_STATUS[p.status]?.[1] || p.status)}</span></dd><dt>Hinterlegt am</dt><dd>${dt(p.created_at)}</dd></dl>
    ${p.status === 'VERIFICATION_REQUIRED' ? '<p class="form-note">Deine geänderten Zahlungsdaten werden geprüft, bevor wir darauf auszahlen.</p>' : ''}
    ${editable ? '<button type="button" class="btn btn-outline" id="crPayChange">Zahlungsdaten ändern</button>' : ''}</div>` : '';
  el.innerHTML = `<h2>Deine Auszahlung</h2><p>Damit wir dir deine vereinbarte Vergütung auszahlen können, benötigen wir deine Zahlungsdaten.</p>${current}<div id="crPayForm"></div>
    ${o.wizard && p ? `<div class="wiz-nav" id="crPayNav">${o.back ? '<button type="button" class="btn btn-outline" data-back>Zurück</button>' : '<span></span>'}<button type="button" class="btn btn-dark" data-next>Weiter</button></div>` : ''}`;
  bindBack(el, o);
  el.querySelector('[data-next]')?.addEventListener('click', () => o.onSaved?.());
  if (!editable) { if (!p) el.querySelector('#crPayForm').innerHTML = lockNote; return; }
  if (!p) payoutForm(el.querySelector('#crPayForm'), o, false);
  else $('#crPayChange', el).onclick = () => {
    $('#crPayChange', el).remove();
    $('#crPayNav', el)?.remove();
    payoutForm(el.querySelector('#crPayForm'), o, true);
  };
}

function payoutForm(box, o, change) {
  box.innerHTML = `<form novalidate autocomplete="off">
    ${change ? '<h3>Zahlungsdaten ändern</h3><div class="pt-alert warn">Eine Änderung deiner Zahlungsdaten kann Auswirkungen auf bevorstehende Auszahlungen haben. Aus Sicherheitsgründen erhältst du eine Bestätigung per E-Mail.</div>' : '<h3>Bankkonto</h3>'}
    <div class="wa-grid2">
      <label class="full">Kontoinhaber*<input name="holder_name" required maxlength="140" autocomplete="off" value="${esc(change ? '' : (me.business?.legal_name || [me.creator.first_name, me.creator.last_name].filter(Boolean).join(' ')))}"></label>
    </div>
    ${SECURITY_BOX}
    <div class="wa-grid2">
      <label class="full">IBAN*<input name="iban" class="cr-iban" required maxlength="42" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="DE89 3704 0044 0532 0130 00" aria-describedby="crIbanHint"><small class="hint" id="crIbanHint">Leerzeichen sind erlaubt.</small></label>
      <label class="full" id="crBic">BIC <small class="hint" id="crBicHint">nur nötig für Konten außerhalb des SEPA-Raums</small><input name="bic" maxlength="11" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    </div>
    <p class="cr-msg pt-alert bad" hidden></p>
    <div class="wiz-nav">${change ? '<button type="button" class="btn btn-outline" data-cancel>Abbrechen</button>' : o.back ? '<button type="button" class="btn btn-outline" data-back>Zurück</button>' : '<span></span>'}<button type="submit" class="btn btn-dark">Weiter zur Überprüfung</button></div></form>`;
  const f = box.querySelector('form');
  box.querySelector('[data-sec]').onclick = securityModal;
  box.querySelector('[data-cancel]')?.addEventListener('click', () => { me.payout && renderAgain(o); });
  box.querySelector('[data-back]')?.addEventListener('click', () => o.back?.());
  const iban = f.elements.iban;
  // Live-Gruppierung in Viererblöcken, Cursor bleibt am Ende
  iban.addEventListener('input', () => {
    const n = normIban(iban.value).slice(0, 34);
    iban.value = n.replace(/(.{4})/g, '$1 ').trim();
    iban.classList.remove('bad');
    const ok = ibanOk(n);
    $('#crBicHint', box).textContent = ok && !ok.sepa ? 'erforderlich für dieses Land' : 'nur nötig für Konten außerhalb des SEPA-Raums';
  });
  f.onsubmit = (e) => {
    e.preventDefault();
    const holder = val(f, 'holder_name');
    if (holder.length < 2) { formMsg(f, 'Bitte den Kontoinhaber angeben.', 'holder_name'); return; }
    const ok = ibanOk(iban.value);
    if (!ok) { formMsg(f, 'Bitte überprüfe deine IBAN.', 'iban'); return; }
    const bic = val(f, 'bic').toUpperCase().replace(/\s/g, '');
    if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) { formMsg(f, 'Bitte überprüfe die BIC.', 'bic'); return; }
    if (!bic && !ok.sepa) { formMsg(f, 'Für Konten außerhalb des SEPA-Raums wird die BIC benötigt.', 'bic'); return; }
    confirmPayout(box, o, { holder_name: holder, iban: normIban(iban.value), bic: bic || null }, ok, change);
  };
}

function confirmPayout(box, o, data, ok, change) {
  box.innerHTML = `<form novalidate><h3>Zahlungsdaten überprüfen</h3>
    <dl class="cr-review"><dt>Kontoinhaber</dt><dd>${esc(data.holder_name)}</dd><dt>IBAN</dt><dd class="cr-mask">${esc(mask(ok.country, ok.last4))}</dd>${data.bic ? `<dt>BIC</dt><dd>${esc(data.bic)}</dd>` : ''}</dl>
    <label class="consent"><input type="checkbox" name="ok" required> Ich bestätige, dass die angegebenen Zahlungsdaten korrekt sind.</label>
    <p class="cr-msg pt-alert bad" hidden></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-edit>Korrigieren</button><button type="submit" class="btn btn-dark">Zahlungsdaten bestätigen</button></div></form>`;
  const f = box.querySelector('form');
  f.querySelector('[data-edit]').onclick = () => payoutForm(box, o, change);
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.elements.ok.checked) { formMsg(f, 'Bitte bestätige, dass die Zahlungsdaten korrekt sind.'); return; }
    const d = await save(f, { ...data, confirmed: true }, '/api/creator/payout', 'POST');
    data.iban = ''; // Klartext nicht länger als nötig im Speicher halten
    if (!d) return;
    await refresh();
    box.innerHTML = `<div class="pt-alert"><strong>${change ? 'Zahlungsdaten aktualisiert' : 'Zahlungsdaten gespeichert'}</strong><p style="margin:6px 0 0">${change ? 'Die neue Zahlungsinformation wurde gespeichert.' : 'Deine Zahlungsdaten sind hinterlegt.'}${d.review_required ? ' Status: <span class="st warn">Prüfung erforderlich</span> – wir prüfen die Änderung, bevor wir darauf auszahlen.' : ''}</p></div>`;
    toast(change ? 'Zahlungsdaten aktualisiert' : 'Zahlungsdaten gespeichert');
    if (o.wizard) setTimeout(() => o.onSaved?.(), 900); else setTimeout(() => renderAgain(o), 1600);
  };
}
const renderAgain = (o) => { if (o.wizard) wizard(); else portal(); };

function secAgreement(el, o) {
  const a = me.agreement;
  if (!a) { el.innerHTML = '<h2>Vereinbarung</h2><div class="pt-alert warn">Die Vereinbarung wird gerade vorbereitet. Bitte schau später noch einmal vorbei.</div>'; return; }
  el.innerHTML = `<h2>${esc(a.title)}</h2><p class="form-note">Fassung ${esc(a.version)}${a.accepted ? ' · <span class="st ok">von dir bestätigt</span>' : ''}</p>
    ${a.is_draft ? '<div class="pt-alert warn"><strong>Entwurf.</strong> Diese Fassung ist noch nicht final. Vor dem Start erhältst du die geprüfte Fassung zur Bestätigung.</div>' : ''}
    <div class="cr-agree" tabindex="0" aria-label="Text der Vereinbarung">${esc(a.body)}</div>
    <p class="pt-row" style="margin:8px 0 12px"><button type="button" class="btn btn-outline btn-sm" data-agree-dl>Als Textdatei speichern</button><button type="button" class="btn btn-outline btn-sm" data-agree-print>Drucken</button></p>
    <div data-comm></div>
    <form novalidate>${a.accepted ? '' : '<label class="consent"><input type="checkbox" name="ok" required> Ich habe die Vereinbarung gelesen und stimme ihr zu.</label>'}
    <p class="cr-msg pt-alert bad" hidden></p><div class="wiz-nav">${o.back ? '<button type="button" class="btn btn-outline" data-back>Zurück</button>' : '<span></span>'}<button type="submit" class="btn btn-dark">${a.accepted ? (o.wizard ? 'Weiter' : 'OK') : 'Vereinbarung bestätigen'}</button></div></form>`;
  bindBack(el, o);
  el.querySelector('[data-agree-dl]').onclick = () => {
    const blob = new Blob([`${a.title}\nFassung ${a.version}\n\n${a.body}\n`], { type: 'text/plain;charset=utf-8' });
    const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = `LeaseRun-Creator-Partnervereinbarung-${a.version}.txt`; document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  el.querySelector('[data-agree-print]').onclick = () => {
    const w = window.open('', '_blank'); if (!w) { toast('Bitte Pop-ups erlauben.', true); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(a.title)}</title><body style="font:14px/1.6 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;white-space:pre-wrap"><h1 style="font-size:20px">${esc(a.title)}</h1><p>Fassung ${esc(a.version)}</p>${esc(a.body)}</body>`);
    w.document.close(); w.focus(); w.print();
  };
  if (me.creator?.status === 'ACTIVE') api('/api/creator/billing').then((r) => { const c = r.ok ? r.data.commission : null; const box = el.querySelector('[data-comm]'); if (box && c) box.innerHTML = commissionCard(c).replace('pt-card cr-comm', 'cr-comm cr-comm-in'); });
  const f = el.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (a.accepted) { o.onSaved?.(); return; }
    if (!f.elements.ok.checked) { formMsg(f, 'Bitte bestätige, dass du die Vereinbarung gelesen hast und ihr zustimmst.'); return; }
    const d = await save(f, { agreement_id: a.id, sha256: a.sha256, accept: true }, '/api/creator/agreement', 'POST');
    if (d) { toast('Vereinbarung bestätigt'); await refresh(); if (o.onSaved) o.onSaved(); else renderAgain(o); }
  };
}

function secReview(el, o) {
  const labels = { account: 'Konto', profile: 'Profil', social: 'Social Media', business: 'Business- und Rechnungsdaten', payout: 'Zahlungsdaten', agreement: 'Vereinbarung' };
  const all = Object.keys(labels).every((k) => me.steps[k].done);
  el.innerHTML = `<h2>${all ? 'Deine Bewerbung ist bereit' : 'Fast geschafft'}</h2>
    <ul class="cr-done">${Object.entries(labels).map(([k, l]) => `<li class="${me.steps[k].done ? '' : 'miss'}"><span aria-hidden="true">${me.steps[k].done ? '✓' : '!'}</span>${esc(l)}${me.steps[k].done ? '' : ` <button type="button" class="btn btn-outline btn-sm" data-go="${k}">Ergänzen</button>`}</li>`).join('')}</ul>
    ${me.email_confirmed ? '' : '<div class="pt-alert warn">Bitte bestätige zuerst deine E-Mail-Adresse über den Link in unserer E-Mail.</div>'}
    <form><p class="cr-msg pt-alert bad" hidden></p><div class="wiz-nav">${o.back ? '<button type="button" class="btn btn-outline" data-back>Zurück</button>' : '<span></span>'}<button type="submit" class="btn btn-dark btn-lg"${me.can_submit ? '' : ' disabled'}>${me.creator.status === 'INFO_REQUESTED' ? 'Erneut einreichen' : 'Bewerbung einreichen'}</button></div></form>`;
  bindBack(el, o);
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go('bewerbung-' + b.dataset.go));
  const f = el.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = await save(f, {}, '/api/creator/submit', 'POST');
    if (d) { await refresh(); step = null; routeByStatus(); window.scrollTo({ top: 0 }); }
  };
}

// ---------- Prüfstatus ----------
function pending() {
  document.title = 'Bewerbung in Prüfung | LeaseRun Creator';
  root.innerHTML = `<div class="cr-wrap"><div class="wa-h-row" style="margin-bottom:12px"><a class="pt-brand dark" href="/"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a><button type="button" class="btn btn-outline btn-sm" id="crOut">Abmelden</button></div>
    <section class="pt-card"><span class="st warn" style="margin:0">${me.creator.status === 'UNDER_REVIEW' ? 'In Prüfung' : 'Eingereicht'}</span>
      <h1 style="color:#0F2C59;font-size:26px;margin:10px 0 6px">Danke, deine Bewerbung ist eingegangen</h1>
      <p>Wir prüfen deine Angaben und melden uns per E-Mail an <strong>${esc(me.email)}</strong>. Eingereicht am ${dt(me.creator.submitted_at)}.</p>
      <ul class="cr-done"><li><span>✓</span>Profil</li><li><span>✓</span>Social Media</li><li><span>✓</span>Business- und Rechnungsdaten</li><li><span>✓</span>Zahlungsdaten <span class="cr-mask" style="margin-left:6px">${esc(me.payout?.iban_masked || '')}</span></li><li><span>✓</span>Vereinbarung</li></ul>
      <p class="form-note">Während der Prüfung sind deine Angaben gesperrt, damit wir genau das freigeben, was du eingereicht hast.</p></section></div>`;
  $('#crOut').onclick = logout;
}

function closed(s) {
  const last = (me.messages || [])[0];
  root.innerHTML = `<div class="cr-wrap"><section class="pt-card"><h1 style="color:#0F2C59;font-size:24px;margin:0 0 8px">${s === 'SUSPENDED' ? 'Dein Creator-Zugang ist pausiert' : 'Deine Bewerbung wurde nicht freigegeben'}</h1>
    ${last?.message ? `<p style="white-space:pre-wrap">${esc(last.message)}</p>` : ''}<p>Bei Fragen erreichst du uns unter <a href="mailto:support@leaserun.com">support@leaserun.com</a>.</p>
    <button type="button" class="btn btn-outline" id="crOut">Abmelden</button></section></div>`;
  $('#crOut').onclick = logout;
}

// ---------- Creator-Portal (nach Freigabe) ----------
// Hauptbereiche (Handy: untere Leiste) Start · Kampagnen · Statistik · Material · Mehr; Tablet/Desktop: Seitenleiste mit allen Bereichen.
// Provision, Abrechnung und Auszahlungen folgen mit der nächsten Ausbaustufe.
const IC = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  studio: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  performance: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  assets: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  profil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  auszahlung: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  vereinbarung: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
  sicherheit: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  abrechnung: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  guide: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>',
  support: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  log: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/>',
  nolink: '<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1"/><path d="M3 3l18 18"/>',
  transfer: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};
// [Schlüssel, Menüname, Kurzname für die untere Leiste am Handy]
const MAIN = [['home', 'Übersicht', 'Start'], ['studio', 'Kampagnen', 'Kampagnen'], ['performance', 'Statistik', 'Statistik'], ['assets', 'Material', 'Material']];
const MORE = [['abrechnung', 'Abrechnung'], ['profil', 'Profil'], ['auszahlung', 'Zahlungsdaten'], ['vereinbarung', 'Vereinbarung'], ['sicherheit', 'Sicherheit'], ['guide', 'Leitfaden']];
// Seitentitel, wo der kurze Menüname allein zu knapp wäre
const TITLE = { studio: 'Kampagnen & Beiträge', guide: 'Leitfaden für Creator', sicherheit: 'Sicherheit & Datenschutz', vereinbarung: 'Partnervereinbarung' };
const GROUPS = [['Arbeiten', ['home', 'studio', 'performance', 'assets', 'abrechnung']], ['Konto', ['profil', 'auszahlung', 'vereinbarung', 'sicherheit']], ['Hilfe', ['guide']]];
const ALL = [...MAIN.map(([k, l]) => [k, l]), ...MORE];
const svg = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
const PLAT = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', other: 'Andere' };
const CST = { SUBMITTED: ['warn', 'In Prüfung'], APPROVED: ['ok', 'Freigegeben'], CHANGES_REQUESTED: ['bad', 'Änderung erbeten'] };
const KIND = { image: 'Bild', video: 'Video', document: 'Dokument', logo: 'Logo', text: 'Text' };
const eurC = (c) => (Number(c || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const num = (n) => Number(n || 0).toLocaleString('de-DE');
const mb = (b) => (b ? `${(b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : '');
let hub = null;
let perfRange = '30d';

async function loadHub(force = false) {
  if (hub && !force) return hub;
  const r = await api('/api/creator/hub');
  hub = r.ok ? r.data : { error: r.data?.error || 'Konnte nicht geladen werden.' };
  return hub;
}
async function copy(btn, text) {
  try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = 'Kopiert ✓'; setTimeout(() => { btn.textContent = o; }, 1600); } catch { toast('Bitte markieren und kopieren.', true); }
}
const bindCopy = (el) => el.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(b, b.dataset.copy));

function portal() {
  view = (location.hash.slice(1) || 'home');
  if (!ALL.some(([k]) => k === view)) view = 'home';
  const name = me.creator.display_name || me.creator.first_name || '';
  const inMore = MORE.some(([k]) => k === view);
  root.innerHTML = `<div class="pt">
    <aside class="pt-side"><a class="pt-brand" href="/"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a><small class="pt-tag">Creator Portal</small>
      <nav class="cr-side-nav" aria-label="Creator Portal">${GROUPS.map(([g, ks]) => `<span class="cr-side-h">${g}</span>${ks.map((k) => `<a href="#${k}"${k === view ? ' class="on" aria-current="page"' : ''}>${svg(k)}<span>${esc(ALL.find(([x]) => x === k)[1])}</span></a>`).join('')}`).join('')}
        <a href="mailto:support@leaserun.com">${svg('support')}<span>Support</span></a></nav>
      <div class="pt-foot cr-foot"><span class="cr-avatar" aria-hidden="true">${esc((name || '?').trim().charAt(0).toUpperCase())}</span><div class="cr-foot-t"><strong>${esc(name)}</strong><small>Creator Partner seit ${dt(me.creator.approved_at)}</small></div><button type="button" class="pt-logout" id="crOut">${svg('logout')}<span>Abmelden</span></button></div></aside>
    <section class="pt-main"><header class="pt-top"><a class="pt-top-brand" href="/" aria-label="LeaseRun – zur Startseite"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a><div class="pt-top-t"><small class="pt-top-k">Creator Portal</small><h1>${esc(TITLE[view] || ALL.find(([k]) => k === view)[1])}</h1></div><button type="button" class="pt-logout pt-logout-m" id="crOutM" aria-label="Abmelden" title="Abmelden"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg><span>Abmelden</span></button></header>
      <div id="crView"><div class="wa-skel" aria-busy="true"><div class="wa-skel-kpis"><span></span><span></span><span></span><span></span></div></div></div></section>
    <nav class="pt-tabs" aria-label="Bereiche">${MAIN.map(([k, , s]) => `<a href="#${k}"${k === view ? ' class="on" aria-current="page"' : ''}>${svg(k)}<span>${esc(s)}</span></a>`).join('')}<button type="button" id="crMore" aria-expanded="false" aria-controls="crSheet"${inMore ? ' class="on"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg><span>Mehr</span></button></nav>
    <div class="pt-sheet" id="crSheet" hidden><div class="pt-sheet-bg" data-close></div><div class="pt-sheet-in" role="dialog" aria-label="Weitere Bereiche"><div class="pt-sheet-h"><span class="pt-sheet-t"><strong>Mehr</strong></span><button type="button" class="stage-x" data-close aria-label="Schließen">×</button></div>
      <nav class="cr-sheet-nav">${MORE.map(([k, l]) => `<a href="#${k}"${k === view ? ' class="on"' : ''}>${svg(k)}<span>${esc(l)}</span></a>`).join('')}<a href="mailto:support@leaserun.com">${svg('support')}<span>Support kontaktieren</span></a><button type="button" class="pt-logout" id="crOutS">${svg('logout')}<span>Abmelden</span></button></nav></div></div></div>`;
  ['#crOut', '#crOutM', '#crOutS'].forEach((s) => { const b = $(s); if (b) b.onclick = logout; });
  const sheet = $('#crSheet'), more = $('#crMore');
  more.onclick = () => { sheet.hidden = false; more.setAttribute('aria-expanded', 'true'); };
  sheet.querySelectorAll('[data-close], nav a').forEach((x) => x.addEventListener('click', () => { sheet.hidden = true; more.setAttribute('aria-expanded', 'false'); }));
  document.title = `${TITLE[view] || ALL.find(([k]) => k === view)[1]} | LeaseRun Creator`;
  const v = $('#crView');
  const o = { wizard: false };
  if (view === 'home') home(v);
  else if (view === 'studio') studio(v);
  else if (view === 'performance') performance(v);
  else if (view === 'assets') assetsView(v);
  else if (view === 'abrechnung') billingView(v);
  else if (view === 'guide') guideView(v);
  else if (view === 'profil') { v.innerHTML = '<section class="pt-card cr-form" id="p1"></section><section class="pt-card cr-form" id="p2"></section><section class="pt-card cr-form" id="p3"></section>'; const ok = { ...o, onSaved: () => toast('Gespeichert') }; secProfile($('#p1'), ok); secSocial($('#p2'), ok); secBusiness($('#p3'), ok); }
  else if (view === 'auszahlung') { v.innerHTML = '<section class="pt-card cr-form" id="p1"></section>'; secPayout($('#p1'), o); }
  else if (view === 'vereinbarung') { v.innerHTML = '<section class="pt-card cr-form" id="p1"></section>'; secAgreement($('#p1'), { ...o, onSaved: () => portal() }); }
  else if (view === 'sicherheit') v.innerHTML = `<section class="pt-card"><h2>Sind meine Daten geschützt?</h2><p>So schützen wir deine Angaben – insbesondere deine Zahlungsdaten:</p>${securityList()}</section>
    <section class="pt-card"><h2>Was wir nicht tun</h2><ul class="pt-check"><li>Wir verbinden keine Social-Media-Konten und fragen nie nach deinen Social-Media-Passwörtern.</li><li>Wir verwenden deine Zahlungsdaten nicht für Marketing.</li><li>Wir zeigen deine vollständige IBAN weder im Portal noch in E-Mails an.</li><li>Wir zeigen dir nie, welche Personen sich über deinen Link registriert oder gekauft haben – nur Summen.</li></ul>
    <p class="form-note">Verdächtige E-Mail oder unerwartete Änderung bemerkt? Schreibe sofort an <a href="mailto:support@leaserun.com">support@leaserun.com</a>.</p></section>`;
}

const linkCard = (h) => h.link ? `<section class="pt-card"><h2>Dein persönlicher Link</h2><p class="form-note" style="margin-top:0">Besuche, Registrierungen und Käufe über diesen Link werden dir zugeordnet. Der Link enthält keine persönlichen Daten.</p>
  <div class="cr-copy"><code>${esc(h.link)}</code><button type="button" class="btn btn-dark btn-sm" data-copy="${esc(h.link)}">Link kopieren</button></div></section>` : '';
const benefitCard = (h) => (h.benefits || []).map((b) => `<section class="pt-card cr-benefit"><small class="pt-top-k">Dein Community-Vorteil</small><h2 style="margin:4px 0 6px">${esc(b.benefit)}</h2>
  <div class="cr-copy"><span>Code: <strong class="cr-code">${esc(b.code)}</strong></span><button type="button" class="btn btn-outline btn-sm" data-copy="${esc(b.code)}">Code kopieren</button></div>
  ${b.ends_at ? `<p class="form-note">Gültig bis ${dt(b.ends_at)}</p>` : ''}${b.terms ? `<details><summary class="form-note">Bedingungen</summary><p class="form-note" style="white-space:pre-wrap">${esc(b.terms)}</p></details>` : ''}</section>`).join('');

async function home(v) {
  const [h, pr, br] = await Promise.all([loadHub(), api('/api/creator/performance?range=30d'), api('/api/creator/billing')]);
  const p = me.payout, perf = pr.ok ? pr.data : null, bill = br.ok ? br.data : null;
  const invoiceDue = bill?.statements?.find((x) => x.status === 'READY' && x.billing_mode === 'INVOICE' && x.payout_cents > 0);
  const n = me.next || (invoiceDue ? { key: 'invoice', title: 'Rechnung erstellen', text: `Deine Abrechnung ${invoiceDue.label} ist fertig: ${eurC(invoiceDue.payout_cents)}.`, target: 'abrechnung' } : null) || h.next || (bill?.next_payout ? { key: 'payout-view', title: 'Auszahlung ansehen', text: `${eurC(bill.next_payout.amount_cents)} sind freigegeben.`, target: 'abrechnung' } : null);
  const target = n ? ({ payout: '#auszahlung', 'payout-review': '#auszahlung', agreement: '#vereinbarung' })[n.key] || (n.target === 'studio' ? '#studio' : n.target === 'abrechnung' ? '#abrechnung' : null) : null;
  v.innerHTML = `<div class="pt-hello"><h2>Willkommen bei LeaseRun${me.creator.first_name ? `, ${esc(me.creator.first_name)}` : ''}</h2><p>Deine Übersicht</p></div>
    <section class="pt-card cr-next"><small class="pt-top-k">Nächste Aufgabe</small>${n ? `<h2 style="margin:4px 0">${esc(n.title)}</h2><p style="margin:0">${esc(n.text)}</p>${target ? `<a class="btn btn-dark" href="${target}">Ansehen</a>` : ''}` : '<h2 style="margin:4px 0">Alles erledigt</h2><p style="margin:0">Teile deinen Link oder schau in die Kampagnen.</p>'}</section>
    <div class="pt-kpis cr-kpis6">
      <div class="pt-kpi"><small>Provision (ausstehend)</small><strong>${bill ? eurC(bill.totals.pending_cents) : '–'}</strong><small>${bill ? `${eurC(bill.totals.paid_cents)} bereits ausgezahlt` : ''}</small></div>
      <div class="pt-kpi"><small>Nächste Auszahlung</small><strong>${bill?.next_payout ? eurC(bill.next_payout.amount_cents) : '–'}</strong><small>${bill?.next_payout ? esc(PO_TEXT[bill.next_payout.status] || '') : bill ? `Abschluss ${esc(bill.next_close.label)} ab ${dt(bill.next_close.from)}` : ''}</small></div>
      <div class="pt-kpi"><small>Umsatz (30 Tage, netto)</small><strong>${perf ? eurC(perf.revenue_net_cents) : '–'}</strong><small>über dich zugeordnet</small></div>
      <div class="pt-kpi"><small>Käufe (30 Tage)</small><strong>${perf ? num(perf.conversions) : '–'}</strong><small>${perf ? `${num(perf.registrations)} Registrierungen` : ''}</small></div>
      <div class="pt-kpi"><small>Aktive Kampagnen</small><strong>${num((h.campaigns || []).length)}</strong><small>für dich freigegeben</small></div>
      <div class="pt-kpi"><small>Auszahlungskonto</small>${p?.iban_masked ? `<strong class="cr-mask">${esc(p.iban_masked)}</strong>` : '<strong class="cr-kpi-txt">Noch nicht hinterlegt</strong><a class="ck-link" href="#auszahlung">Jetzt hinterlegen</a>'}<small>${p ? `<span class="st ${PAY_STATUS[p.status]?.[0] || ''}" style="margin:0">${esc(PAY_STATUS[p.status]?.[1] || '')}</span>` : ''}</small></div>
    </div>
    ${benefitCard(h)}${linkCard(h)}
    <section class="pt-card"><div class="wa-h-row"><h2 style="margin:0">Abrechnung</h2><a class="btn btn-outline btn-sm" href="#abrechnung">Alle Abrechnungen</a></div><p class="form-note">Abgerechnet wird monatlich, sobald die 14-tägige Widerrufsfrist aller Käufe abgelaufen ist. <a class="ck-link" href="#guide">So funktioniert die Kooperation</a></p></section>`;
  bindCopy(v);
}

async function studio(v) {
  const h = await loadHub(true);
  if (h.error) { v.innerHTML = `<div class="pt-alert bad">${esc(h.error)}</div>`; return; }
  const camps = h.campaigns || [];
  v.innerHTML = `${linkCard(h)}${benefitCard(h)}
    <section class="pt-card"><h2>Kampagnen</h2>${camps.length ? camps.map((k) => `<details class="cr-plat"${camps.length === 1 ? ' open' : ''}><summary>${esc(k.name)}${k.my_content ? `<span class="st ok">${k.my_content} Beitrag${k.my_content > 1 ? 'e' : ''}</span>` : '<span class="st warn">noch kein Beitrag</span>'}</summary>
        ${k.summary ? `<p>${esc(k.summary)}</p>` : ''}${k.starts_on || k.ends_on ? `<p class="form-note">Zeitraum: ${k.starts_on ? dt(k.starts_on) : 'ab sofort'} – ${k.ends_on ? dt(k.ends_on) : 'offen'}</p>` : ''}
        ${k.brief ? `<h3>Briefing</h3><p style="white-space:pre-wrap">${esc(k.brief)}</p>` : ''}
        <div class="pt-grid2">${k.dos ? `<div><h3>Bitte so</h3><p style="white-space:pre-wrap">${esc(k.dos)}</p></div>` : ''}${k.donts ? `<div><h3>Bitte nicht</h3><p style="white-space:pre-wrap">${esc(k.donts)}</p></div>` : ''}</div>
        ${k.link ? `<div class="cr-copy"><code>${esc(k.link)}</code><button type="button" class="btn btn-outline btn-sm" data-copy="${esc(k.link)}">Kampagnen-Link kopieren</button></div>` : ''}
        <p class="pt-row" style="margin-top:10px">${k.assets ? `<a class="btn btn-outline btn-sm" href="#assets" data-camp="${esc(k.id)}">Material ansehen (${k.assets})</a>` : ''}<button type="button" class="btn btn-dark btn-sm" data-add="${esc(k.id)}">Beitrag eintragen</button></p></details>`).join('') : '<div class="pt-empty">Gerade ist keine Kampagne für dich freigegeben. Du kannst trotzdem Inhalte mit deinem persönlichen Link veröffentlichen.</div>'}</section>
    <section class="pt-card cr-form" id="crContentForm"></section>
    <section class="pt-card"><h2>Deine Beiträge</h2>${(h.content || []).length ? `<ul class="co-social">${h.content.map((c) => `<li class="cr-content"><div><strong>${esc(PLAT[c.platform] || c.platform)}</strong> · ${dt(c.published_on)} <span class="st ${CST[c.status]?.[0]}" style="margin-left:6px">${esc(CST[c.status]?.[1] || c.status)}</span><br><a href="${/^https:\/\//.test(c.url) ? esc(c.url) : '#'}" target="_blank" rel="noopener noreferrer">${esc(c.title || c.url)}</a>${c.review_note ? `<p class="pt-alert warn" style="margin:8px 0 0"><strong>Anmerkung von LeaseRun:</strong> ${esc(c.review_note)}</p>` : ''}</div>${c.status === 'CHANGES_REQUESTED' ? `<button type="button" class="btn btn-outline btn-sm" data-fix="${esc(c.id)}">Überarbeitet einreichen</button>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Noch keine Beiträge eingetragen.</p>'}</section>`;
  bindCopy(v);
  contentForm($('#crContentForm'), camps, null);
  v.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => contentForm($('#crContentForm'), camps, b.dataset.add, true));
  v.querySelectorAll('[data-camp]').forEach((a) => a.addEventListener('click', () => { assetCamp = a.dataset.camp; }));
  v.querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => fixContent(b, h.content.find((c) => c.id === b.dataset.fix)));
}

function contentForm(el, camps, campId, focus = false) {
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `<h2>Beitrag eintragen</h2><p class="form-note" style="margin-top:0">Trage veröffentlichte Beiträge mit Link ein. LeaseRun prüft unter anderem die Werbekennzeichnung.</p><form novalidate><div class="wa-grid2">
    <label>Plattform*<select name="platform" required>${Object.entries(PLAT).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
    <label>Kampagne<select name="campaign_id"><option value="">ohne Kampagne</option>${camps.map((k) => `<option value="${esc(k.id)}"${k.id === campId ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
    <label class="full">Link zum Beitrag*<input name="url" type="url" inputmode="url" required maxlength="300" placeholder="https://"></label>
    <label>Titel (optional)<input name="title" maxlength="160"></label>
    <label>Veröffentlicht am*<input name="published_on" type="date" required max="${today}" value="${today}"></label></div>
    <label class="consent"><input type="checkbox" name="ad" required> Der Beitrag ist als Werbung bzw. Kooperation mit LeaseRun gekennzeichnet.</label>
    <p class="cr-msg pt-alert bad" hidden></p><div class="wiz-nav"><span></span><button type="submit" class="btn btn-dark">Beitrag eintragen</button></div></form>`;
  const f = el.querySelector('form');
  if (focus) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.elements.url.focus({ preventScroll: true }); }
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.elements.ad.checked) { formMsg(f, 'Bitte bestätige die Werbekennzeichnung.'); return; }
    const d = await save(f, { platform: val(f, 'platform'), campaign_id: val(f, 'campaign_id') || null, url: val(f, 'url'), title: val(f, 'title') || null, published_on: val(f, 'published_on'), ad_disclosure: true }, '/api/creator/content', 'POST');
    if (d) { toast('Beitrag eingetragen'); studio($('#crView')); }
  };
}

function fixContent(btn, c) {
  const li = btn.closest('li');
  li.insertAdjacentHTML('beforeend', `<form class="cr-form" style="width:100%;margin-top:10px" novalidate><div class="wa-grid2"><label class="full">Link zum überarbeiteten Beitrag*<input name="url" type="url" required maxlength="300" value="${esc(c.url)}"></label><label class="full">Titel<input name="title" maxlength="160" value="${esc(c.title || '')}"></label></div>
    <label class="consent"><input type="checkbox" name="ad" required> Der Beitrag ist als Werbung bzw. Kooperation mit LeaseRun gekennzeichnet.</label><p class="cr-msg pt-alert bad" hidden></p><div class="wiz-nav"><span></span><button type="submit" class="btn btn-dark btn-sm">Erneut einreichen</button></div></form>`);
  btn.remove();
  const f = li.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.elements.ad.checked) { formMsg(f, 'Bitte bestätige die Werbekennzeichnung.'); return; }
    const d = await save(f, { id: c.id, url: val(f, 'url'), title: val(f, 'title') || null, ad_disclosure: true }, '/api/creator/content', 'PATCH');
    if (d) { toast('Erneut eingereicht'); studio($('#crView')); }
  };
}

async function performance(v) {
  const RANGES = [['30d', '30 Tage'], ['90d', '90 Tage'], ['month', 'Dieser Monat'], ['last_month', 'Vormonat'], ['all', 'Gesamt']];
  const [r, h, br] = await Promise.all([api(`/api/creator/performance?range=${perfRange}`), loadHub(), api('/api/creator/billing')]);
  const p = r.ok ? r.data : null, bill = br.ok ? br.data : null;
  const names = new Map((h.campaigns || []).map((k) => [k.slug, k.name]));
  v.innerHTML = `<div class="pc-chips" role="group" aria-label="Zeitraum" style="margin-bottom:12px">${RANGES.map(([k, l]) => `<button type="button" data-r="${k}" aria-pressed="${k === perfRange}">${l}</button>`).join('')}</div>
    ${p ? `<div class="pt-kpis">
      <div class="pt-kpi"><small>Besuche</small><strong>${num(p.visits)}</strong><small>${num(p.visitors)} Besucher</small></div>
      <div class="pt-kpi"><small>Registrierungen</small><strong>${num(p.registrations)}</strong><small>über deinen Link</small></div>
      <div class="pt-kpi"><small>Käufe</small><strong>${num(p.conversions)}</strong><small>${num(p.via_code)} über deinen Code</small></div>
      <div class="pt-kpi"><small>Umsatz (netto)</small><strong>${eurC(p.revenue_net_cents)}</strong><small>${p.reversed ? `${num(p.reversed)} erstattet (nicht gezählt)` : 'ohne Erstattungen'}</small></div></div>
    <section class="pt-card"><h2>Nach Kampagne</h2>${(p.by_campaign || []).length ? `<div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Kampagne</th><th>Besuche</th><th>Registr.</th><th>Conversions</th><th>Umsatz</th></tr></thead><tbody>${p.by_campaign.map((x) => `<tr><td>${esc(x.campaign ? names.get(x.campaign) || x.campaign : 'Ohne Kampagne')}</td><td>${num(x.visits)}</td><td>${num(x.registrations)}</td><td>${num(x.conversions)}</td><td>${eurC(x.revenue_net_cents)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">In diesem Zeitraum noch keine Daten.</p>'}</section>
    <section class="pt-card"><h2>Provision</h2><dl class="pt-dl"><div><dt>Ausstehend</dt><dd>${bill ? eurC(bill.totals.pending_cents) : '–'}</dd></div><div><dt>Freigegeben</dt><dd>${bill ? eurC(bill.totals.approved_cents) : '–'}</dd></div><div><dt>Ausgezahlt</dt><dd>${bill ? eurC(bill.totals.paid_cents) : '–'}</dd></div></dl><p class="form-note">Ausstehend enthält vorläufige Beträge noch nicht abgeschlossener Monate. <a class="ck-link" href="#abrechnung">Zur Abrechnung</a></p></section>
    <p class="form-note">So zählen wir: Besuche über deinen Link (ohne Cookies, bei „Do Not Track“ nicht gezählt) · Registrierungen über deinen Link · bezahlte Käufe von Kunden, die über deinen Link oder Code kamen (innerhalb von 90 Tagen nach Registrierung). Eigene Käufe zählen nicht. Du siehst nur Summen, keine Personen.</p>`
    : `<div class="pt-alert bad">${esc(r.data?.error || 'Kennzahlen konnten nicht geladen werden.')}</div>`}`;
  v.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { perfRange = b.dataset.r; performance(v); });
}

const PO_TEXT = { READY: 'wird zur Zahlung vorbereitet', APPROVED: 'zur Zahlung freigegeben', EXPORTED: 'Überweisung beauftragt', PAID: 'überwiesen', FAILED: 'Zahlung fehlgeschlagen – wir melden uns', RETURNED: 'von der Bank zurückgegeben – bitte Zahlungsdaten prüfen' };
const ST_TEXT = { READY: ['warn', 'Bereit'], INVOICED: ['warn', 'Rechnung eingereicht'], APPROVED: ['ok', 'Freigegeben'], PAID: ['ok', 'Ausgezahlt'], ZERO: ['', 'Kein Betrag'] };
const DOC_TEXT = { STATEMENT: 'Abrechnung', INVOICE: 'Rechnung', CREDIT_NOTE: 'Gutschrift', CANCELLATION: 'Storno' };

async function openDoc(btn, body) {
  btn.disabled = true;
  const r = await api('/api/creator/billing/document', { method: 'POST', body: JSON.stringify(body) });
  btn.disabled = false;
  if (!r.ok) { toast(r.data?.error || 'Download nicht möglich.', true); return; }
  location.href = r.data.url;
}

// Provisionsregel (Anlage zu § 8 der Partnervereinbarung) – verständlich formuliert, mit Abweichungen je Kampagne.
const commissionCard = (c) => c ? `<section class="pt-card cr-comm"><small class="pt-top-k">Deine Provision</small><h2 style="margin:4px 0 6px">${esc(c.text)}</h2>
  <p class="form-note" style="margin:0">Gilt seit ${dt(c.since)}${c.own ? ' · individuell für dich vereinbart' : ''}. Netto-Umsatz = gezahlter Betrag ohne Umsatzsteuer, abzüglich Rabatten und Erstattungen (§ 8 der Partnervereinbarung).</p>
  ${c.campaigns?.length ? `<ul class="pt-check" style="margin:10px 0 0">${c.campaigns.map((x) => `<li>Kampagne „${esc(x.campaign)}“: ${esc(x.text)}</li>`).join('')}</ul>` : ''}</section>` : '';

async function billingView(v) {
  const r = await api('/api/creator/billing');
  if (!r.ok) { v.innerHTML = `<div class="pt-alert bad">${esc(r.data?.error || 'Abrechnung konnte nicht geladen werden.')}</div>`; return; }
  const b = r.data;
  v.innerHTML = `${commissionCard(b.commission)}<div class="pt-kpis">
      <div class="pt-kpi"><small>Ausstehend</small><strong>${eurC(b.totals.pending_cents)}</strong><small>inkl. vorläufiger Monate</small></div>
      <div class="pt-kpi"><small>Freigegeben</small><strong>${eurC(b.totals.approved_cents)}</strong><small>zur Auszahlung</small></div>
      <div class="pt-kpi"><small>Ausgezahlt</small><strong>${eurC(b.totals.paid_cents)}</strong><small>gesamt</small></div>
      <div class="pt-kpi"><small>Nächste Auszahlung</small><strong>${b.next_payout ? eurC(b.next_payout.amount_cents) : '–'}</strong><small>${b.next_payout ? `${esc(PO_TEXT[b.next_payout.status] || '')} · ${esc(b.next_payout.iban_masked)}` : `Abschluss ${esc(b.next_close.label)} ab ${dt(b.next_close.from)}`}</small></div></div>
    ${b.open.length ? `<section class="pt-card"><h2>Laufende Monate <small class="form-note">(vorläufig)</small></h2><div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Monat</th><th>Conversions</th><th>Umsatz netto</th><th>Provision voraussichtlich</th><th>Abschluss ab</th></tr></thead><tbody>${b.open.map((o) => `<tr><td>${esc(o.label)}</td><td>${num(o.conversions)}</td><td>${eurC(o.revenue_net_cents)}</td><td>${eurC(o.commission_cents)}</td><td>${dt(o.close_from)}</td></tr>`).join('')}</tbody></table></div><p class="form-note">Vorläufig, weil Käufe innerhalb der Widerrufsfrist noch erstattet werden können.</p></section>` : ''}
    <section class="pt-card"><h2>Deine Abrechnungen</h2><p class="form-note" style="margin-top:0">Verfahren: ${b.mode === 'CREDIT_NOTE' ? 'LeaseRun erstellt für dich eine Gutschrift – du musst keine Rechnung schreiben.' : 'Du erstellst je Monat eine Rechnung an LeaseRun – mit einem Klick, alle Angaben sind vorausgefüllt.'}</p>
    ${b.statements.length ? b.statements.map((s) => `<article class="cr-stmt" id="st-${esc(s.id)}"><div class="wa-h-row"><h3 style="margin:0">${esc(s.label)}</h3><span class="st ${ST_TEXT[s.status]?.[0] || ''}" style="margin:0">${esc(ST_TEXT[s.status]?.[1] || s.status)}</span></div>
        <dl class="pt-dl"><div><dt>Käufe</dt><dd>${num(s.conversions)}</dd></div><div><dt>Umsatz netto</dt><dd>${eurC(s.revenue_net_cents)}</dd></div><div><dt>Provision</dt><dd>${eurC(s.commission_cents)}</dd></div>${s.adjustments_cents ? `<div><dt>Anpassungen</dt><dd>${eurC(s.adjustments_cents)}</dd></div>` : ''}${s.vat_cents ? `<div><dt>USt</dt><dd>${eurC(s.vat_cents)}</dd></div>` : ''}<div><dt>Auszahlung</dt><dd>${eurC(s.payout_cents)}</dd></div></dl>
        ${s.payout ? `<p class="form-note" style="margin:0 0 6px">Auszahlung: <strong>${esc(PO_TEXT[s.payout.status] || s.payout.status)}</strong>${s.payout.paid_at ? ` am ${dt(s.payout.paid_at)}` : ''} · ${esc(s.payout.iban_masked)}</p>` : ''}
        ${s.blockers.length ? `<div class="pt-alert warn"><strong>Vor der Auszahlung offen:</strong> ${s.blockers.map(esc).join(' · ')}</div>` : ''}
        <p class="pt-row"><button type="button" class="btn btn-outline btn-sm" data-stmt="${esc(s.id)}">Abrechnung herunterladen</button>${s.documents.filter((d) => d.doc_type !== 'STATEMENT').map((d) => `<button type="button" class="btn btn-outline btn-sm" data-doc="${esc(d.id)}">${esc(DOC_TEXT[d.doc_type] || d.doc_type)} ${esc(d.number)}</button>`).join('')}${s.status === 'READY' && s.billing_mode === 'INVOICE' && s.payout_cents > 0 ? `<button type="button" class="btn btn-dark btn-sm" data-inv="${esc(s.id)}">Rechnung erstellen</button>` : ''}</p>
        <div data-invbox></div></article>`).join('') : '<div class="pt-empty">Noch keine abgeschlossenen Monate. Die erste Abrechnung erscheint nach dem Monatsabschluss.</div>'}</section>`;
  v.querySelectorAll('[data-stmt]').forEach((x) => x.onclick = () => openDoc(x, { statement_id: x.dataset.stmt, doc_type: 'STATEMENT' }));
  v.querySelectorAll('[data-doc]').forEach((x) => x.onclick = () => openDoc(x, { document_id: x.dataset.doc }));
  v.querySelectorAll('[data-inv]').forEach((x) => x.onclick = () => invoiceForm(v, b, b.statements.find((s) => s.id === x.dataset.inv), x));
}

function invoiceForm(v, b, s, btn) {
  const box = btn.closest('article').querySelector('[data-invbox]');
  btn.remove();
  const bz = me.business || {};
  const ids = [bz.tax_number ? `Steuernummer ${bz.tax_number}` : null, bz.vat_id ? `USt-IdNr. ${bz.vat_id}` : null].filter(Boolean);
  box.innerHTML = `<form class="cr-form cr-invoice" novalidate><h3>Rechnung erstellen</h3><p class="form-note" style="margin-top:0">Alle Angaben sind aus deiner Abrechnung und deinen Rechnungsdaten übernommen. Bitte prüfen und bestätigen.</p>
    <dl class="cr-review">
      <dt>Von (du)</dt><dd>${esc([bz.legal_name, bz.legal_form].filter(Boolean).join(' '))}<br><small>${esc([bz.street, [bz.postal_code, bz.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</small>${ids.length ? `<br><small>${esc(ids.join(' · '))}</small>` : '<br><span class="st bad" style="margin:0">Steuernummer oder USt-IdNr. fehlt</span>'}</dd>
      <dt>An</dt><dd>LeaseRun, Inh. Feray Korkmaz<br><small>Georg-August-Zinn-Str. 25, 64354 Reinheim · USt-IdNr. DE348036700</small></dd>
      <dt>Leistung</dt><dd>Werbeleistung im LeaseRun Creator-Partnerprogramm: Provision ${esc(s.label)} (${num(s.conversions)} Käufe)</dd>
      <dt>Netto</dt><dd>${eurC(s.net_cents)}</dd>${s.vat_cents ? `<dt>Umsatzsteuer</dt><dd>${eurC(s.vat_cents)}</dd>` : ''}<dt>Rechnungsbetrag</dt><dd>${eurC(s.gross_cents)}</dd>
      <dt>Steuerhinweis</dt><dd>${esc(s.tax_note)}</dd><dt>Zahlung an</dt><dd class="cr-mask">${esc(me.payout?.iban_masked || '–')}</dd>
    </dl>
    <div class="wa-grid2"><label>Rechnungsnummer*<input name="number" required maxlength="40" value="${esc(b.invoice_suggestion)}"><small class="hint">Deine eigene, fortlaufende Nummer. Vorschlag kannst du ändern.</small></label><label>Rechnungsdatum<input value="${dt(new Date())}" readonly></label></div>
    <label class="consent"><input type="checkbox" name="ok" required> Ich habe die Angaben geprüft. Die Rechnung wird in meinem Namen erstellt und an LeaseRun übermittelt.</label>
    <p class="cr-msg pt-alert bad" hidden></p><div class="wiz-nav"><button type="button" class="btn btn-outline" data-cancel>Abbrechen</button><button type="submit" class="btn btn-dark">Rechnung erstellen</button></div></form>`;
  const f = box.querySelector('form');
  f.querySelector('[data-cancel]').onclick = () => billingView(v);
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.elements.ok.checked) { formMsg(f, 'Bitte bestätige, dass du die Angaben geprüft hast.'); return; }
    const d = await save(f, { statement_id: s.id, number: val(f, 'number'), confirm: true }, '/api/creator/billing/invoice', 'POST');
    if (d) { toast(`Rechnung ${d.number} erstellt`); billingView(v); }
  };
}

function guideView(v) {
  const steps = [
    ['Link oder Code teilen', 'Verwende deinen persönlichen Link (unter „Übersicht“ oder „Kampagnen“) oder deinen Vorteilscode. Für Kampagnen gibt es eigene Links, damit wir sehen, was funktioniert.'],
    ['Werbung kennzeichnen', 'Jeder Beitrag über LeaseRun ist Werbung und wird als solche gekennzeichnet. Trage veröffentlichte Beiträge unter „Kampagnen“ ein – wir prüfen sie.'],
    ['Was gezählt wird', 'Bezahlte Käufe von Kunden, die über deinen Link kamen (bis 90 Tage nach ihrer Registrierung) oder deinen Code eingelöst haben. Eigene Käufe und erstattete Käufe zählen nicht; bei einer Teilerstattung zählt der verbleibende Betrag.'],
    ['Provision', 'Je Kauf nach der für dich hinterlegten Regel (z. B. Prozent vom Netto-Umsatz). Ausstehende Beträge siehst du laufend unter „Statistik“ und „Abrechnung“.'],
    ['Monatsabschluss', 'Ein Monat wird abgerechnet, wenn die 14-tägige Widerrufsfrist aller Käufe vorbei ist – in der Regel ab dem 15. des Folgemonats. Spätere Erstattungen werden im nächsten Monat anteilig verrechnet. Sobald deine Abrechnung bereit ist, bekommst du eine E-Mail.'],
    ['Rechnung oder Gutschrift', 'Je nach Vereinbarung erstellst du mit einem Klick eine vorausgefüllte Rechnung, oder LeaseRun stellt dir eine Gutschrift aus.'],
    ['Auszahlung', 'Nach der Freigabe überweisen wir auf dein hinterlegtes, geprüftes Konto. Du bekommst eine E-Mail, sobald die Überweisung raus ist.'],
  ];
  v.innerHTML = `<section class="pt-card"><h2>Wie funktioniert die Kooperation?</h2><ol class="cr-guide">${steps.map(([t, d]) => `<li><strong>${esc(t)}</strong><p>${esc(d)}</p></li>`).join('')}</ol></section>
    <div class="pt-grid2"><section class="pt-card"><h2>Bitte so</h2><ul class="pt-check"><li>In deinem eigenen Stil erklären, was LeaseRun kann</li><li>Eigene Beispiele und echte Erfahrungen zeigen</li><li>Werbung deutlich kennzeichnen</li><li>Freigegebene Assets unverändert verwenden</li></ul></section>
    <section class="pt-card"><h2>Bitte nicht</h2><ul class="pt-check"><li>Keine Renditeversprechen oder garantierten Ergebnisse</li><li>Keine Kredit-, Anlage-, Steuer- oder Rechtsberatung</li><li>Keine Aussagen, LeaseRun vermittle Kredite</li><li>Keine Eigenkäufe über den eigenen Link</li></ul></section></div>
    <section class="pt-card"><h2>Fragen?</h2><p>Schreib uns an <strong>support@leaserun.com</strong>. Die verbindlichen Regeln stehen in deiner <a class="ck-link" href="#vereinbarung">Vereinbarung</a>.</p></section>`;
}

let assetCamp = '';
async function assetsView(v) {
  const h = await loadHub();
  if (h.error) { v.innerHTML = `<div class="pt-alert bad">${esc(h.error)}</div>`; return; }
  const camps = h.campaigns || [];
  const list = (h.assets || []).filter((a) => !assetCamp || (assetCamp === 'general' ? !a.campaign_id : a.campaign_id === assetCamp));
  v.innerHTML = `<p class="form-note" style="margin-top:0">Was darf ich verwenden? Alles hier ist für deine Inhalte freigegeben – bitte die Nutzungshinweise beachten.</p>
    <div class="pc-chips" role="group" aria-label="Filter" style="margin-bottom:12px"><button type="button" data-f="" aria-pressed="${!assetCamp}">Alle</button><button type="button" data-f="general" aria-pressed="${assetCamp === 'general'}">Allgemein</button>${camps.map((k) => `<button type="button" data-f="${esc(k.id)}" aria-pressed="${assetCamp === k.id}">${esc(k.name)}</button>`).join('')}</div>
    ${list.length ? `<div class="cr-assets">${list.map((a) => `<article class="pt-card"><small class="pt-top-k">${esc(KIND[a.kind] || a.kind)}${a.size_bytes ? ` · ${mb(a.size_bytes)}` : ''}</small><h3 style="margin:4px 0">${esc(a.title)}</h3>${a.description ? `<p class="form-note" style="margin:0 0 6px">${esc(a.description)}</p>` : ''}
        ${a.kind === 'text' ? `<div class="cr-agree" style="max-height:180px">${esc(a.text_body)}</div><p><button type="button" class="btn btn-outline btn-sm" data-copy="${esc(a.text_body)}">Text kopieren</button></p>` : `<p><button type="button" class="btn btn-dark btn-sm" data-dl="${esc(a.id)}">Herunterladen</button></p>`}
        ${a.usage_notes ? `<p class="form-note"><strong>Nutzung:</strong> ${esc(a.usage_notes)}</p>` : ''}</article>`).join('')}</div>` : '<div class="pt-empty">Hier ist noch kein Material freigegeben.</div>'}`;
  bindCopy(v);
  v.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { assetCamp = b.dataset.f; assetsView(v); });
  v.querySelectorAll('[data-dl]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const r = await api('/api/creator/assets', { method: 'POST', body: JSON.stringify({ id: b.dataset.dl }) });
    b.disabled = false;
    if (!r.ok) { toast(r.data?.error || 'Download nicht möglich.', true); return; }
    location.href = r.data.url;
  });
}

boot();
