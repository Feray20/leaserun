// Unternehmensportal (/business-portal): Registrierung mit § 14 BGB und AVV, Anfragen-Pipeline,
// Widget- und QR-Studio, Team, Profil mit Co-Branding, Tarif und Rechnungen.
import { logoLoader } from './loader.mjs?v=892f3666';
import { BRANCHEN, BRANCHE_KEYS, brancheFromType } from './b2b-branche.mjs?v=892f3666';
import { api, download, dt, dtt, esc, eur, loginForm, logout, session, setSession } from './sess.mjs?v=892f3666';

const root = document.getElementById('portal');
try { history.scrollRestoration = 'manual'; } catch { /* ältere Browser */ }
const $ = (s, el = document) => el.querySelector(s);
// Zurück von Stripe mit der Browser-Zurück-Taste: Seite frisch laden statt den alten Zwischenstand zu zeigen.
addEventListener('pageshow', (e) => { if (e.persisted && (!window.__iaNeedReload || window.__iaNeedReload())) location.reload(); });
// Bereiche in drei Gruppen: Tagesgeschäft, Werkzeuge & Wissen, Konto.
const VIEWS = [
  ['start', 'Start', 'arbeit'], ['faelle', 'Fälle', 'arbeit'], ['kunden', 'Kunden', 'arbeit'], ['fall', 'Analyse', 'arbeit'], ['anfragen', 'Anfragen', 'arbeit'], ['einreichungen', 'Einreichungen', 'arbeit'],
  ['wissen', 'Beratungskompass', 'werk'], ['tools', 'Rechner & Tools', 'werk'], ['werkzeuge', 'Widget & QR', 'werk'],
  ['team', 'Team', 'firma'], ['verifizierung', 'Verifizierung', 'firma'], ['profil', 'Profil', 'firma'], ['tarif', 'Tarif & Rechnungen', 'firma'],
  ['support', 'Hilfe & Support', 'hilfe'],
];
// Seitentitel, wo er vom kurzen Menünamen abweicht.
const VTITLE = { fall: 'Fall-Analyse', tools: 'Rechner & Software-Tools' };
const GROUPS = [['arbeit', 'Arbeit'], ['werk', 'Werkzeuge'], ['firma', 'Unternehmen'], ['hilfe', 'Hilfe']];
// Handy-Leiste: vier Hauptbereiche plus „Mehr“ (alle übrigen Bereiche als Liste).
const MAIN = [
  ['start', 'Start', '<rect x="3" y="3" width="7.5" height="9" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.5"/><rect x="3" y="15" width="7.5" height="6" rx="1.5"/>'],
  ['faelle', 'Fälle', '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
  ['kunden', 'Kunden', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.5 2.6 3.5 6"/>'],
  ['fall', 'Analyse', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><circle cx="12" cy="14" r="2.6"/><path d="M14 16l2.5 2.5"/>'],
  ['anfragen', 'Anfragen', '<path d="M4 5h16v11H8l-4 4z"/>'],
];
const TYPE = { BANK: 'Kreditinstitut', BROKER: 'Finanzierungsvermittler (§ 34i GewO)', REALTOR: 'Immobilienmakler (§ 34c GewO)', OTHER: 'Sonstiges Unternehmen' };
const TIER = { BASIC: 'Makler & Vermittler Basic', PRO: 'Kanzlei & Baufi Pro', ENTERPRISE: 'Bank & Filiale Enterprise' };
const STATUS = { neu: 'Neu', in_bearbeitung: 'In Bearbeitung', abgeschlossen: 'Abgeschlossen', abgelehnt: 'Abgelehnt' };
const LAENDER = ['baden-wuerttemberg', 'bayern', 'berlin', 'brandenburg', 'bremen', 'hamburg', 'hessen', 'mecklenburg-vorpommern', 'niedersachsen', 'nordrhein-westfalen', 'rheinland-pfalz', 'saarland', 'sachsen', 'sachsen-anhalt', 'schleswig-holstein', 'thueringen'];
const landName = (l) => l.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-').replace('Wuerttemberg', 'Württemberg').replace('Thueringen', 'Thüringen');

let me = null;
// Branche des Unternehmenskontos (bei der Anfrage festgelegt). Mit Zusatzbranchen kann zwischen den gebuchten
// Branchen umgeschaltet werden (nur Ansicht, auf diesem Gerät gespeichert).
const myBranches = () => (Array.isArray(me?.branches) && me.branches.length ? me.branches : [BRANCHEN[me?.branche] ? me.branche : brancheFromType(me?.account?.institutionType)]);
const br = () => { const l = myBranches(); let v = null; try { v = localStorage.getItem('lr-b2b-view'); } catch { /* ohne Speicher */ } return l.includes(v) ? v : l[0]; };
const B = () => BRANCHEN[br()];
const vLabel = (v, l) => (v === 'kunden' ? B().kunden : l);
let prices = null;

const toast = (t, bad = false) => {
  let el = $('#ptToast');
  if (!el) { el = document.createElement('div'); el.id = 'ptToast'; el.className = 'pt-toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = t; el.classList.toggle('bad', bad); el.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 3200);
};
const busy = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = '…'; try { await fn(); } catch (e) { toast(e.message || 'Fehler', true); } finally { btn.disabled = false; btn.textContent = t; } };

// ---------- Rahmen ----------
// Navigation gruppiert; Berater ohne Inhaberrechte sehen Tarif und Profil nicht.
const navGroups = (keep) => GROUPS.map(([g, gl]) => {
  const items = VIEWS.filter(([v, , gg]) => gg === g && keep(v) && (me.role === 'owner' || !['tarif', 'profil'].includes(v)));
  return items.length ? `<span class="pt-grp">${gl}</span>${items.map(([v, l]) => `<a href="#${v}" data-v="${v}">${vLabel(v, l)}${v === 'anfragen' && me.usage.leadsNew ? ` <b class="pt-dot">${me.usage.leadsNew}</b>` : ''}</a>`).join('')}` : '';
}).join('');
function shell() {
  const a = me.account;
  root.innerHTML = `<div class="pt">
    <aside class="pt-side"><a class="pt-brand" href="/"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a>
      <small class="pt-tag">Unternehmensportal</small>
      <nav>${navGroups((v) => v !== 'support')}</nav>
      <div class="pt-foot"><span class="pt-help"><a href="#support" data-v="support">Hilfe &amp; Support</a></span><strong>${esc(a.companyName)}</strong><small>${esc(a.customerNumber)} · ${me.role === 'owner' ? 'Inhaber' : 'Berater'}</small><button type="button" class="pt-logout" id="ptLogout">Abmelden</button></div>
    </aside>
    <section class="pt-main"><header class="pt-top"><a class="pt-top-brand" href="/" aria-label="LeaseRun – zur Startseite"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a><div class="pt-top-t"><small class="pt-top-k">Unternehmensportal</small><h1 id="ptTitle"></h1></div><button type="button" class="pt-pres-btn" id="ptPres" hidden title="Vollbild für das Kundengespräch am Tablet"><span aria-hidden="true">⛶</span> Präsentieren</button><button type="button" class="pt-brh" id="ptBr" aria-haspopup="dialog" title="Ihre Ansicht – zum Wechseln tippen"><span class="pt-brh-i" aria-hidden="true">${B().icon}</span><span class="pt-brh-t"><small>Ansicht</small><b>${esc(B().short)}</b></span><svg class="pt-brh-l" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7 10l5 5 5-5"/></svg></button><button type="button" class="pt-logout pt-logout-m" id="ptLogoutM" aria-label="Abmelden" title="Abmelden"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg><span>Abmelden</span></button>${a.status === 'locked' ? '<span class="st bad">Gesperrt</span>' : me.tier ? `<span class="st ok">${TIER[me.tier]}</span>` : '<span class="st warn">Kein Tarif</span>'}</header>
      ${a.status === 'locked' ? `<div class="pt-alert bad"><strong>Konto gesperrt.</strong> ${esc(a.lockReason || '')} Rechnungen und AVV bleiben abrufbar. Fragen an support@leaserun.com.</div>` : ''}
      <div id="ptView"></div></section>
    <nav class="pt-tabs" aria-label="Bereiche">${MAIN.map(([v, l, ic]) => `<a href="#${v}" data-v="${v}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${v === 'kunden' && B().kunden.length > 8 ? `<span class="pt-long">${B().kunden}</span><span class="pt-short">Kontakte</span>` : `<span>${v === 'kunden' ? B().kunden : l}</span>`}${v === 'anfragen' && me.usage.leadsNew ? `<b class="pt-dot">${me.usage.leadsNew}</b>` : ''}</a>`).join('')}<button type="button" id="ptMore" aria-expanded="false" aria-controls="ptSheet"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg><span>Mehr</span></button></nav>
    <div class="pt-sheet" id="ptSheet" hidden><div class="pt-sheet-bg" data-close></div><div class="pt-sheet-in" role="dialog" aria-label="Alle Bereiche"><div class="pt-sheet-h"><span class="pt-sheet-t"><strong>Hauptmenü</strong>${(a.companyName || '').trim().length >= 3 ? `<small>${esc(a.companyName)}</small>` : ''}</span><button type="button" class="stage-x" data-close aria-label="Schließen">×</button></div>
      <nav>${navGroups((v) => !MAIN.some(([m]) => m === v))}<a href="mailto:support@leaserun.com">E-Mail an den Support</a><span class="pt-grp">Konto</span><button type="button" class="pt-logout" id="ptLogoutS">Abmelden</button></nav></div></div>
  </div>`;
  // Fußzeile wie im Privatbereich: in der Inhaltsspalte neben der Seitenleiste (Original unter der Seite wird per CSS ausgeblendet).
  { const lf = document.querySelector('body > footer.lr-legal-b2b'), pm = root.querySelector('.pt-main'); if (lf && pm && !pm.querySelector('.lr-legal')) { const c = lf.cloneNode(true); c.classList.add('lr-legal-in-main'); pm.appendChild(c); } }
  root.querySelectorAll('#ptLogout,#ptLogoutM,#ptLogoutS').forEach((b) => { b.onclick = async () => { try { (await import('./b2b-tools.mjs?v=892f3666')).clearAll(); } catch { /* weiter */ } logout(); }; });
  const brb = $('#ptBr'); if (brb) brb.onclick = () => chooseBranche();
  const sheet = $('#ptSheet'), more = $('#ptMore');
  const openSheet = (on) => { sheet.hidden = !on; more.setAttribute('aria-expanded', String(on)); document.body.classList.toggle('pt-sheet-open', on); };
  more.onclick = () => openSheet(sheet.hidden);
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.closest('a')) openSheet(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) openSheet(false); });
  addEventListener('hashchange', () => openSheet(false)); addEventListener('pageshow', () => openSheet(false));
}

// Präsentationsmodus: Beratungskompass und Tools ablenkungsfrei im Vollbild (Tablet im Kundentermin).
function presentation(on) {
  const body = document.body, el = document.documentElement;
  if (on) {
    body.classList.add('pt-present');
    if (!$('#ptPresX')) { const x = document.createElement('button'); x.id = 'ptPresX'; x.type = 'button'; x.className = 'pt-pres-x'; x.textContent = 'Präsentation beenden'; x.onclick = () => presentation(false); body.append(x); }
    try { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {}); } catch { /* Vollbild nicht verfügbar – Ansicht bleibt trotzdem aufgeräumt */ }
  } else {
    if (!body.classList.contains('pt-present')) return;
    body.classList.remove('pt-present'); $('#ptPresX')?.remove();
    try { if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch { /* ignore */ }
  }
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('pt-present')) presentation(false); });
document.addEventListener('click', (e) => { if (e.target.closest?.('#ptPres') && matchMedia('(min-width:768px)').matches) presentation(true); });

function route() {
  if (/^#vorschlaege/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#support=vorschlag');
  const v = (location.hash.slice(1).split('=')[0] || 'start');
  const view = VIEWS.find(([k]) => k === v) ? v : 'start';
  document.querySelectorAll('[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === view));
  $('#ptMore')?.classList.toggle('on', !MAIN.some(([m]) => m === view));
  $('#ptTitle').textContent = VTITLE[view] || vLabel(view, VIEWS.find(([k]) => k === view)[1]);
  // Jeder Bereichswechsel bekommt einen frischen Container: Ein noch ladender alter Bereich schreibt dann ins Leere
  // und kann den neuen nicht mehr überschreiben (sonst wirkte es, als müsse man zweimal tippen).
  const old = $('#ptView'); const box = old.cloneNode(false); old.replaceWith(box); delete box.dataset.tileWatch; tileWatch();
  // Neuer Bereich: immer oben beginnen (Kapitel-Sprünge innerhalb eines Bereichs behalten ihre Position).
  if (route.last !== view) { const ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); route.last = view; }
  box.innerHTML = logoLoader();
  { const pb = $('#ptPres'); if (pb) pb.hidden = !['wissen', 'tools'].includes(view); if (!['wissen', 'tools'].includes(view)) presentation(false); }
  ({ start: vStart, faelle: vFaelle, tools: (b) => import('./b2b-tools.mjs?v=892f3666').then((m) => m.renderPrograms(b, { tier: me.tier, branche: br(), tools: me.tools, toast, brand: { color: me.limits?.cobranding && me.account.brandColor ? me.account.brandColor : '#0F2C59', logo: me.limits?.cobranding && me.account.hasLogo && me.account.slug ? `/api/b2b/logo?slug=${encodeURIComponent(me.account.slug)}` : '', sender: [me.account.companyName, me.account.advisorName].filter(Boolean).join(' · ') } })).catch(() => { b.innerHTML = '<p class="form-note">Programme konnten nicht geladen werden.</p>'; }), fall: (b) => import('./b2b-fall.mjs?v=892f3666').then((m) => m.renderFall(b, { api, toast, me })).catch(() => { b.innerHTML = '<div class="pt-alert warn">Fall-Analyse konnte nicht geladen werden. <button type="button" class="btn btn-outline btn-sm" data-reload>Erneut versuchen</button></div>'; }), kunden: vKunden, wissen: (b) => import('./b2b-wissen.mjs?v=892f3666').then((m) => { b.innerHTML = kompassHead(); m.renderWissen(b.querySelector('#bwBody'), br()); }).catch(() => { b.innerHTML = '<div class="pt-alert warn">Beratungskompass konnte nicht geladen werden. <button type="button" class="btn btn-outline btn-sm" data-reload>Erneut versuchen</button></div>'; }), verifizierung: vVerify, anfragen: vLeads, einreichungen: vSubs, werkzeuge: vTools, team: (b) => vTeam(b).then(() => addPw(b)), profil: (b) => { vProfil(b); addPw(b); addDelete(b); }, tarif: vTarif, support: (b) => { b.innerHTML = '<section class="pt-card" id="rvBox" hidden></section><section class="pt-card" id="spBox"></section>'; import('./hilfe-ui.mjs?v=892f3666').then((m) => m.mountHilfe(b.querySelector('#spBox'), { area: 'b2b', start: hilfeStart() })).catch(() => { b.innerHTML = '<p class="form-note">Konnte nicht geladen werden. Bitte Seite neu laden oder an support@leaserun.com schreiben.</p>'; }); import('./reviews.mjs?v=892f3666').then(async (m) => { const h = await m.askHtml('b2b'); const x = b.querySelector('#rvBox'); if (h && x) { x.innerHTML = h; x.hidden = false; } }).catch(() => {}); },})[view](box);
}

// ---------- Kachel-Auswahl: Arbeitsbereiche öffnen erst beim Antippen ----------
// In jedem Bereich mit mehreren Arbeitskarten steht oben eine Kachel je Karte; geöffnet ist immer nur eine.
// Ausgenommen: Übersicht, Software-Tools und Beratungskompass (eigene Struktur) sowie reine Info-/Marketing-Karten
// ohne Bedienelemente (bleiben normal sichtbar). In der Fall-Analyse bleibt die Upload-Karte immer offen.
// Alte Links #vorschlaege führen in „Hilfe & Support“ (Reiter Verbesserung).
const hilfeStart = () => (/vorschlag/.test(location.hash) ? 'vorschlag' : 'problem');
const TILE_SKIP = new Set(['start', 'faelle', 'tools', 'wissen', 'tarif', 'support']);
const TILE_IC = '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>';
const tileState = { view: null, sel: null };
function tileView() {
  const box = $('#ptView'); if (!box) return;
  const view = route.last;
  if (tileState.view !== view) { tileState.view = view; tileState.sel = null; }
  box.querySelector(':scope>.pt-tiles')?.remove();
  box.querySelectorAll(':scope>.pt-card.tl-off').forEach((c) => c.classList.remove('tl-off'));
  if (TILE_SKIP.has(view)) return;
  let cards = [...box.querySelectorAll(':scope>.pt-card:not(.pt-tiles)')].filter((c) => c.querySelector('h2') && c.querySelector('input,select,textarea,button:not(.lr-kl-btn),table,form,a.btn'));
  if (view === 'fall') cards = cards.slice(1);
  if (cards.length < 2) return;
  cards.forEach((c, i) => { if (!c.dataset.tile) c.dataset.tile = view + '-' + i + '-' + (c.querySelector('h2').textContent || '').trim().slice(0, 30); });
  if (!cards.some((c) => c.dataset.tile === tileState.sel)) tileState.sel = null;
  const desc = (c) => { const n = c.querySelector(':scope>p.form-note, :scope>p'); return (n?.textContent || '').replace(/\s+/g, ' ').trim().replace(/^(.{0,90}\S*).*$/, (m, a) => (a.length < m.length ? a + ' …' : a)); };
  const nav = document.createElement('div');
  nav.className = 'obj-pick pt-tiles'; nav.setAttribute('role', 'group'); nav.setAttribute('aria-label', 'Bereich wählen');
  nav.innerHTML = cards.map((c) => `<button type="button" class="obj-op${c.dataset.tile === tileState.sel ? ' on' : ''}" data-tile="${esc(c.dataset.tile)}" aria-expanded="${c.dataset.tile === tileState.sel}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TILE_IC}</svg><span><strong>${esc(c.querySelector('h2').textContent.trim())}</strong>${desc(c) ? `<small>${esc(desc(c))}</small>` : ''}</span><svg class="obj-op-c" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('');
  cards[0].before(nav);
  cards.forEach((c) => c.classList.toggle('tl-off', c.dataset.tile !== tileState.sel));
  nav.onclick = (e) => {
    const b = e.target.closest('[data-tile]'); if (!b) return;
    tileState.sel = tileState.sel === b.dataset.tile ? null : b.dataset.tile;
    tileView();
    const c = box.querySelector(`:scope>.pt-card[data-tile="${CSS.escape(tileState.sel || '')}"]`);
    if (c) requestAnimationFrame(() => window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - ($('.pt-top')?.offsetHeight || 0) - 10, behavior: 'smooth' }));
  };
}
// Springt anderer Code zu einem Element in einer zugeklappten Karte, diese Karte öffnen.
if (!window.__iaPtReveal) {
  window.__iaPtReveal = true;
  const reveal = (el) => { const c = el.closest?.('#ptView>.pt-card.tl-off'); if (c) { tileState.sel = c.dataset.tile; tileView(); } };
  const siv = Element.prototype.scrollIntoView, foc = HTMLElement.prototype.focus;
  Element.prototype.scrollIntoView = function (...a) { try { reveal(this); } catch { /* ignore */ } return siv.apply(this, a); };
  HTMLElement.prototype.focus = function (...a) { try { reveal(this); } catch { /* ignore */ } return foc.apply(this, a); };
}
const tileWatch = () => {
  const box = $('#ptView'); if (!box || box.dataset.tileWatch) return;
  box.dataset.tileWatch = '1';
  new MutationObserver((ms) => { if (ms.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n.classList?.contains('pt-tiles')))) return; tileView(); /* sofort (Mikrotask vor dem Zeichnen) – sonst springen Karten nach dem Laden */ }).observe(box, { childList: true });
};

// ---------- Kunden: einladen und Fortschritt sehen (nur mit Einwilligung des Kunden) ----------
const PH = ['Orientieren', 'Objekte prüfen', 'Bankgespräch', 'Bestand'];
let KD_LAST = null; // zuletzt erstellte Einladung (Link bleibt nach dem Neuladen sichtbar)
const kdLinkHtml = (x) => `<div class="pt-alert ok kd-sent"><strong>${x.mailed ? 'Einladung versendet.' : 'Einladung erstellt.'}</strong> <span class="st">Wartet auf Kunde</span> ${x.mailed ? 'Zusätzlich können Sie den Link selbst weitergeben:' : 'Bitte den Link an Ihren Kunden senden (E-Mail-Versand ist noch nicht eingerichtet):'}<div class="pt-row kd-copy"><input readonly value="${esc(x.link)}" aria-label="Einladungslink"><button type="button" class="btn btn-outline" id="kdCopy">Kopieren</button></div><small>Gültig 14 Tage, nur einmal verwendbar.</small></div>`;
async function vKunden(box) {
  if (me.modules?.crm === false) { box.innerHTML = '<div class="pt-alert warn"><strong>Die Mandantenverwaltung ist für Ihr Unternehmenskonto nicht freigeschaltet.</strong> Bitte wenden Sie sich an support@leaserun.com.</div>'; return; }
  const r = await api('/api/b2b/clients');
  if (!r.ok) { box.innerHTML = `<section class="pt-card"><h2>Fälle konnten nicht geladen werden.</h2><p class="form-note">${esc(r.data?.error || 'Bitte versuchen Sie es erneut.')}</p><button type="button" class="btn btn-dark" id="kdRetry">Erneut versuchen</button></section>`; $('#kdRetry').onclick = () => { box.innerHTML = logoLoader(); vKunden(box); }; return; }
  const all = r.data.clients || [];
  const con = all.filter((c) => c.status === 'verbunden').sort((a, b) => (b.progress?.best ?? -1) - (a.progress?.best ?? -1));
  const inv = all.filter((c) => c.status === 'eingeladen');
  const ready = con.filter((c) => (c.progress?.best ?? 0) >= 90).length;
  const card = (c) => {
    const p = c.progress || {}, best = p.best ?? 0;
    return `<article class="kd-card" id="kd-${esc(c.id)}" data-stage="${stageOf(c)}" data-q="${esc(`${c.name || ''} ${c.email || ''}`.toLowerCase())}"><div class="kd-top"><strong>${esc(c.name || c.email || 'Kunde')}</strong>${best >= 90 ? '<span class="st ok">bankreif</span>' : best >= 60 ? '<span class="st warn">fast</span>' : '<span class="st">in Vorbereitung</span>'}</div>
      ${c.name && c.email ? `<small class="kd-mail">${esc(c.email)}</small>` : ''}
      <div class="kd-bar" role="img" aria-label="Bankreife ${best} %"><span style="width:${Math.max(2, Math.min(100, best))}%"></span></div>
      <dl class="kd-dl"><div><dt>Bankreife</dt><dd>${p.best == null ? '–' : best + ' %'}</dd></div><div><dt>Stufe</dt><dd>${p.stage ? `${p.stage} · ${PH[p.stage - 1]}` : '–'}</dd></div><div><dt>Objekte</dt><dd>${p.objects ?? '–'}</dd></div><div><dt>Unterlagen</dt><dd>${p.docs ?? '–'}</dd></div><div><dt>Finanzprofil</dt><dd>${p.profile == null ? '–' : p.profile ? 'ausgefüllt' : 'offen'}</dd></div><div><dt>Zuletzt aktiv</dt><dd>${p.lastActive ? dt(p.lastActive) : '–'}</dd></div></dl>
      ${p.missing && p.missing.length ? `<div class="kd-miss"><strong>Fehlt noch:</strong> ${p.missing.map(esc).join(' · ')}</div>` : p.missing ? '<div class="kd-miss ok">Alle Unterlagen-Arten vorhanden.</div>' : ''}
      <div class="kd-btns"><button type="button" class="btn btn-dark" data-kd-req="${esc(c.id)}"${c.lastRequestAt && Date.now() - new Date(c.lastRequestAt).getTime() < 864e5 ? ' disabled title="Heute bereits erinnert"' : ''}>Unterlagen anfordern</button><button type="button" class="btn btn-outline" data-kd-pdf="${esc(c.id)}">Kurzbericht (PDF)</button></div>
      ${c.lastRequestAt ? `<small class="kd-last">Zuletzt erinnert: ${dtt(c.lastRequestAt)}</small>` : ''}
      <a class="btn btn-outline kd-open" href="#faelle=${esc(c.id)}">Fall öffnen</a><div class="kd-act"><small>verbunden seit ${c.since ? dt(c.since) : '–'}</small><button type="button" class="btn btn-ghost" data-kd-end="${esc(c.id)}">Trennen</button></div></article>`;
  };
  // Bestandskunden-Radar: Kunden, deren Zinsbindung in den nächsten 36 Monaten endet (nur mit Radar-Einwilligung, ab Pro).
  const mon = (ym) => { const [y, m] = ym.split('-').map(Number); const n = new Date(); return (y - n.getFullYear()) * 12 + (m - 1 - n.getMonth()); };
  const radarRows = con.flatMap((c) => (Array.isArray(c.radar) ? c.radar : []).map((ym) => ({ c, ym, m: mon(ym) }))).filter((x) => x.m >= -1 && x.m <= 36).sort((a, b) => a.m - b.m);
  const radarAsked = con.filter((c) => c.radar).length;
  const radar = `<section class="pt-card kd-radar"><div class="kd-head"><h2>Bestandskunden-Radar</h2><span class="form-note">${radarAsked} von ${con.length} teilen ihr Zinsbindungsende</span></div><p class="form-note">Kunden mit relevanten bevorstehenden Finanzierungsthemen.</p>
    ${!r.data.radarOn ? '<p class="kd-radar-off">Enthalten ab <a href="#tarif">Kanzlei &amp; Baufi Pro</a>: Sie sehen, bei welchen Kunden die Zinsbindung in den nächsten 36 Monaten endet.</p>'
      : radarRows.length ? `<div class="kd-rcards">${radarRows.map((x) => `<article class="kd-rcard"><strong>${esc(x.c.name || x.c.email || 'Kunde')}</strong><span>Zinsbindung endet ${x.m < 0 ? 'bereits' : x.m === 0 ? 'diesen Monat' : `in ${x.m} Monat${x.m === 1 ? '' : 'en'}`}</span><span class="st ${x.m <= 12 ? 'warn' : ''}">${x.m <= 12 ? 'Potenzial – jetzt ansprechen' : 'Potenzial'}</span><a class="btn btn-outline btn-sm" href="#faelle=${esc(x.c.id)}">Kunden ansehen</a></article>`).join('')}</div>`
      : '<p class="form-note">Aktuell endet bei keinem Ihrer Kunden die Zinsbindung in den nächsten 36 Monaten.</p>'}
    <p class="form-note kd-radar-note">Nur mit Einwilligung des Kunden: Er gibt Monat und Jahr frei – ohne Beträge – und kann die Freigabe jederzeit widerrufen. Benachrichtigung am 1. jedes Monats.</p></section>`;
  box.innerHTML = `<section class="pt-card kd-new"><div class="kd-head"><h2>Neue Kundeneinladung</h2><span class="form-note">${esc(me.account.companyName || '')}</span></div>
      <ol class="kd-flow" aria-label="Ablauf"><li><b>1</b>Einladung senden</li><li><b>2</b>Kunde ergänzt Profil, Objekt und Unterlagen</li><li><b>3</b>Daten erscheinen im Fall – Sie prüfen die Vollständigkeit</li></ol>
      <form class="kd-form2" id="kdF"><label><span>Kundenname <span class="kd-opt">(optional)</span></span><input id="kdName" type="text" maxlength="120" autocomplete="off" placeholder="z. B. Familie Muster"></label><label>E-Mail des Kunden*<input id="kdMail" type="email" required autocomplete="off" placeholder="kunde@beispiel.de"></label><label class="chk kd-consent"><input type="checkbox" id="kdOk" required> Ich bestätige, dass mir die Einwilligung des Kunden für die Zusendung dieser Einladung vorliegt (Art. 6 Abs. 1 lit. a/b DSGVO).</label><button class="btn btn-dark" type="submit">Kunden einladen</button></form>
      <p class="form-note">Ihr Kunde bereitet alles kostenlos vor. Mit seiner Zustimmung sehen Sie den Fortschritt – nicht die Dokumente. Er kann die Verbindung jederzeit trennen.</p>
      <div id="kdLink" aria-live="polite">${KD_LAST ? kdLinkHtml(KD_LAST) : ''}</div></section>
    <section class="pt-card pipe"><div class="kd-head"><h2>Pipeline</h2><span class="pipe-exp"><button type="button" class="btn btn-ghost btn-sm" data-exp="csv">CSV (Excel, CRM)</button><button type="button" class="btn btn-ghost btn-sm" data-exp="json">JSON</button></span></div>
      <div class="pipe-board">${[['inv', 'Eingeladen'], ['missing', 'Unterlagen unvollständig'], ['check', 'Prüfbereit'], ['ready', 'Bankfertig']].map(([k, l]) => { const xs = all.filter((c) => (c.status === 'verbunden' || c.status === 'eingeladen') && stageOf(c) === k); return `<div class="pipe-col ${k}"><h3>${l}<b>${xs.length}</b></h3>${xs.length ? xs.map((c) => `<a class="pipe-card" href="${c.status === 'eingeladen' ? '#kunden' : `#kd-${esc(c.id)}`}" data-jump="${c.status === 'eingeladen' ? '' : esc(c.id)}"><strong>${esc(c.name || c.email || 'Kunde')}</strong>${c.status === 'eingeladen' ? `<small>gültig bis ${dt(c.expiresAt)}</small>` : `<span class="pipe-bar"><i style="width:${Math.max(3, Math.min(100, c.progress?.best ?? 0))}%"></i></span><small>${c.progress?.best ?? 0} % Bankreife${c.progress?.missing?.length ? ` · fehlt: ${esc(c.progress.missing.slice(0, 2).join(', '))}` : ''}</small>`}</a>`).join('') : '<p class="pipe-empty">–</p>'}</div>`; }).join('')}
        <div class="pipe-col sent"><h3>Eingereicht<b id="pipeSentN">…</b></h3><div id="pipeSent"><p class="lr-ld sm" role="status">wird geladen …</p></div></div></div></section>
    <section class="pt-card"><div class="kd-head"><h2>Ihre Kunden</h2><span class="form-note">${con.length} verbunden · ${ready} bankreif · ${inv.length} Einladung${inv.length === 1 ? '' : 'en'} offen</span></div>
      ${con.length + inv.length ? `<div class="fc-tools kd-tools"><label class="fc-search"><span class="sr-only">Kunden suchen</span><input type="search" id="kdQ" placeholder="Kunden suchen" autocomplete="off"></label><div class="seg fc-seg" role="tablist" aria-label="Status">${[['alle', 'Alle'], ['aktiv', 'Aktiv'], ['inv', 'Wartet auf Kunde'], ['offen', 'Fall offen'], ['ready', 'Bankreif']].map(([k, l], i) => `<button type="button" role="tab" data-kdf="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}</div></div>` : ''}
      ${con.length ? `<p class="form-note">Sortiert nach Bankreife – die abschlussreifen Fälle stehen oben.</p><div class="kd-list">${con.map(card).join('')}</div>` : '<div class="pt-empty"><strong>Noch keine Fälle</strong><p>Erstellen Sie Ihren ersten Fall oder laden Sie einen Kunden ein.</p><div class="todo-empty-a"><a class="btn btn-dark" href="#kunden" data-focus-invite>Kunden einladen</a><a class="btn btn-outline" href="#fall">Neuen Fall anlegen</a></div></div>'}
      ${inv.length ? `<h3 class="kd-sub">Offene Einladungen</h3><ul class="kd-inv">${inv.map((c) => `<li data-stage="inv" data-q="${esc(`${c.name || ''} ${c.email || ''}`.toLowerCase())}"><span><strong>${esc(c.name || c.email)}</strong><small>${c.name ? esc(c.email) + ' · ' : ''}gültig bis ${dt(c.expiresAt)}</small></span><span class="st">Wartet auf Kunde</span><button type="button" class="btn btn-ghost" data-kd-end="${esc(c.id)}">Zurückziehen</button></li>`).join('')}</ul>` : ''}</section>`;
  box.insertAdjacentHTML('beforeend', radar); // Radar als Zusatz unten – Einladung und Kundenliste zuerst
  box.querySelectorAll('[data-jump]').forEach((l) => l.onclick = (e) => { if (!l.dataset.jump) return; e.preventDefault(); const el = document.getElementById('kd-' + l.dataset.jump); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.classList.add('kd-flash'); setTimeout(() => el?.classList.remove('kd-flash'), 1600); });
  const STG = { inv: 'Eingeladen', missing: 'Unterlagen unvollständig', check: 'Prüfbereit', ready: 'Bankfertig' };
  const rows = all.filter((c) => c.status === 'verbunden' || c.status === 'eingeladen').map((c) => ({ name: c.name || '', email: c.email || '', stufe: STG[stageOf(c)], bankreife: c.progress?.best ?? null, objekte: c.progress?.objects ?? null, unterlagen: c.progress?.docs ?? null, fehlend: (c.progress?.missing || []).join('; '), verbunden_seit: c.since || '', zinsbindung_endet: Array.isArray(c.radar) ? c.radar.join('; ') : '' }));
  box.querySelectorAll('[data-exp]').forEach((b) => b.onclick = () => {
    const csv = b.dataset.exp === 'csv';
    const q = (v) => { const t = String(v ?? ''); return /[";\n]/.test(t) || /^[=+\-@]/.test(t) ? '"' + t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : t; };
    const body = csv ? '\ufeff' + [Object.keys(rows[0] || { name: '' }).join(';'), ...rows.map((r) => Object.values(r).map(q).join(';'))].join('\r\n') : JSON.stringify({ exportiert: new Date().toISOString(), faelle: rows }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: csv ? 'text/csv;charset=utf-8' : 'application/json' }));
    const x = document.createElement('a'); x.href = url; x.download = `LeaseRun_Pipeline_${new Date().toISOString().slice(0, 10)}.${csv ? 'csv' : 'json'}`; x.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  api('/api/b2b/submissions').then((sr) => {
    const out = sr.ok ? sr.data.outbox || [] : [];
    const n = $('#pipeSentN'), bx = $('#pipeSent'); if (!n || !bx) return;
    n.textContent = out.length;
    bx.innerHTML = out.length ? out.slice(0, 8).map((x) => `<a class="pipe-card" href="#einreichungen"><strong>${esc(x.object_label)}</strong><small>${esc(x.to)} · ${SUB[x.status] || ''}</small></a>`).join('') : '<p class="pipe-empty">–</p>';
  }).catch(() => {});
  ($('#kdF') || {}).onsubmit = (e) => { e.preventDefault(); const b = e.target.querySelector('button'); busy(b, async () => {
    const x = await api('/api/b2b/clients', { method: 'POST', body: JSON.stringify({ email: $('#kdMail').value.trim(), name: $('#kdName').value.trim() || undefined, consent: $('#kdOk').checked }) });
    if (!x.ok) throw Error(x.data?.error || 'Einladung fehlgeschlagen.');
    KD_LAST = x.data;
    await vKunden(box);
  }); };
  box.querySelectorAll('[data-focus-invite]').forEach((l) => l.onclick = (e) => { e.preventDefault(); $('#kdMail')?.focus(); });
  // Suche und Filter in „Ihre Kunden“ (Status aus der Pipeline-Stufe).
  let kf = 'alle', kq = '';
  const kdFilter = () => box.querySelectorAll('.kd-card[data-stage], .kd-inv li[data-stage]').forEach((el) => {
    const st = el.dataset.stage, okF = kf === 'alle' || (kf === 'aktiv' ? st !== 'inv' : kf === 'offen' ? st === 'missing' || st === 'check' : st === kf);
    el.hidden = !(okF && (!kq || el.dataset.q.includes(kq)));
  });
  box.querySelectorAll('[data-kdf]').forEach((b) => b.onclick = () => { kf = b.dataset.kdf; box.querySelectorAll('[data-kdf]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); kdFilter(); });
  $('#kdQ')?.addEventListener('input', (e) => { kq = e.target.value.trim().toLowerCase(); kdFilter(); });
  // Aus einer Anfrage übernommen: Name und E-Mail vorbelegen; „#kunden=einladen“ springt direkt zur Einladung.
  try { const pf = JSON.parse(sessionStorage.getItem('lr-invite') || 'null'); if (pf) { sessionStorage.removeItem('lr-invite'); if (pf.email) $('#kdMail').value = pf.email; if (pf.name) $('#kdName').value = pf.name; } } catch { /* ignore */ }
  if (/=einladen/.test(location.hash) || $('#kdMail')?.value) setTimeout(() => { $('#kdName')?.focus(); $('.kd-new')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
  $('#kdCopy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(KD_LAST.link); toast('Link kopiert.'); } catch { toast('Bitte den Link markieren und kopieren.', true); } });
  box.querySelectorAll('[data-kd-req]').forEach((b) => b.onclick = () => {
    const note = prompt('Optional: kurze Nachricht an Ihren Kunden (z. B. „Bitte bis Freitag“). Leer lassen für die Standard-Erinnerung.');
    if (note === null) return;
    busy(b, async () => {
      const x = await api('/api/b2b/clients/request', { method: 'POST', body: JSON.stringify({ id: b.dataset.kdReq, note: note.trim() || undefined }) });
      if (!x.ok) throw Error(x.data?.error || 'Erinnerung fehlgeschlagen.');
      toast(x.data.mailed ? 'Erinnerung per E-Mail gesendet und in der App angezeigt.' : 'Erinnerung wird dem Kunden in der App angezeigt (E-Mail-Versand noch nicht eingerichtet).');
      vKunden(box);
    });
  });
  box.querySelectorAll('[data-kd-pdf]').forEach((b) => b.onclick = () => busy(b, async () => { await download('/api/b2b/clients/report?id=' + encodeURIComponent(b.dataset.kdPdf), {}, 'LeaseRun-Kurzbericht.pdf'); }));
  box.querySelectorAll('[data-kd-end]').forEach((b) => b.onclick = () => {
    if (!confirm(b.textContent === 'Trennen' ? 'Verbindung zu diesem Kunden trennen? Sie sehen seinen Fortschritt danach nicht mehr.' : 'Einladung zurückziehen? Der Link wird ungültig.')) return;
    busy(b, async () => { const x = await api('/api/b2b/clients', { method: 'DELETE', body: JSON.stringify({ id: b.dataset.kdEnd }) }); if (!x.ok) throw Error(x.data?.error || 'Fehlgeschlagen.'); toast('Erledigt.'); vKunden(box); });
  });
}

// ---------- Übersicht ----------
async function startStats(el) {
  const r = await api('/api/b2b/leads');
  if (!r.ok) return;
  const since = Date.now() - 30 * 864e5;
  const l = (r.data?.leads || []).filter((x) => new Date(x.created_at).getTime() >= since);
  const by = (k) => l.filter((x) => x.source === k).length;
  const done = l.filter((x) => x.status === 'abgeschlossen').length;
  el.innerHTML = `<h2>Letzte 30 Tage</h2><dl class="pt-dl"><div><dt>Anfragen gesamt</dt><dd>${l.length}</dd></div><div><dt>Website-Widget</dt><dd>${by('widget')}</dd></div><div><dt>Partnerseite</dt><dd>${by('landing')}</dd></div><div><dt>QR-Code</dt><dd>${by('qr')}</dd></div><div><dt>Abgeschlossen</dt><dd>${done}${l.length ? ` (${Math.round((done / l.length) * 100)} %)` : ''}</dd></div><div><dt>Ohne Zuständigen</dt><dd>${l.filter((x) => !x.assigned_to).length}</dd></div></dl>`;
}

// Einrichtung (AVV, Tarif, Logo, Terminlink, Widget) – steht im Profil, nicht mehr auf der Startseite.
const setupSteps = (a = me.account, u = me.usage) => [
  [Boolean(a.avvAcceptedAt), 'AVV abgeschlossen', '#profil'],
  [Boolean(me.tier), 'Tarif gebucht', '#tarif'],
  [Boolean(a.hasLogo || a.brandColor), 'Logo oder Farbe hinterlegt', '#profil'],
  [Boolean(a.bookingUrl), 'Terminlink eingetragen', '#profil'],
  [u.leadsNew > 0 || false, 'Widget oder QR-Code im Einsatz', '#werkzeuge'],
];
// Pipeline-Stufe eines Kunden: Eingeladen → Unterlagen unvollständig → Prüfbereit → Bankfertig.
const stageOf = (c) => {
  if (c.status === 'eingeladen') return 'inv';
  const p = c.progress || {}, best = p.best ?? 0;
  if (best >= 90) return 'ready';
  if ((p.missing && p.missing.length) || best < 60) return 'missing';
  return 'check';
};

// Fallstatus in Worten (nie nur Farbe): gleiche Stufen wie die Pipeline.
const CASE_ST = { inv: ['', 'Wartet auf Kunde'], missing: ['warn', 'Dokumente fehlen'], check: ['', 'Prüfung'], ready: ['ok', 'Bereit'] };
const caseName = (c) => c.name || c.email || 'Kunde';
// Status-Text je Fall: „Dokumente fehlen“ nur, wenn wirklich Unterlagen fehlen – sonst „Angaben fehlen“.
const stLabel = (c) => { const k = stageOf(c); return k === 'missing' && !c.progress?.missing?.length ? ['warn', 'Angaben fehlen'] : CASE_ST[k]; };
const greet = () => { const h = new Date().getHours(); return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend'; };
const ICO = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  invite: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  cases: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14v4"/><path d="M8 18h.01"/><path d="M12 18h.01"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
// Nächster Schritt eines Falls – nur aus dem tatsächlichen Stand abgeleitet.
const nextStep = (c) => {
  const k = stageOf(c), p = c.progress || {};
  if (k === 'inv') return { t: 'Kundenantwort steht aus', x: `Die Einladung ist noch nicht angenommen${c.expiresAt ? ` (gültig bis ${dt(c.expiresAt)})` : ''}.`, cta: 'Kunde öffnen' };
  if (p.missing?.length) return { t: `${p.missing.slice(0, 2).join(', ')} fehlt`, x: 'Fordern Sie das fehlende Dokument beim Kunden an.', cta: 'Kunde erinnern', remind: true };
  if (p.profile === false) return { t: 'Finanzprofil unvollständig', x: 'Bitten Sie den Kunden, Einkommen und Ausgaben zu ergänzen.', cta: 'Kunde erinnern', remind: true };
  if (k === 'missing') return { t: `Bankreife ${p.best ?? 0} %`, x: 'Angaben sind noch unvollständig – Kunde erinnern.', cta: 'Kunde erinnern', remind: true };
  if (k === 'check') return { t: 'Fallprüfung offen', x: 'Kennzahlen sind gerechnet – Ihr Blick als Berater fehlt noch.', cta: 'Kurzbericht öffnen', pdf: true };
  return { t: 'Bereit für den nächsten Schritt', x: 'Kreditmappe erstellen und einreichen.', cta: 'Zu den Einreichungen', href: '#einreichungen' };
};
// Fälle einmal laden und für Start, Fälle und Kunden teilen (kurz zwischengespeichert).
let CASES = null;
const loadCases = async (force = false) => {
  if (!force && CASES && Date.now() - CASES.at < 20000) return CASES.r;
  const r = await api('/api/b2b/clients').catch(() => ({ ok: false, data: {} }));
  if (r.ok) CASES = { at: Date.now(), r };
  return r;
};
const remind = (id, btn, after) => {
  const note = prompt('Optional: kurze Nachricht an Ihren Kunden (z. B. „Bitte bis Freitag“). Leer lassen für die Standard-Erinnerung.');
  if (note === null) return;
  busy(btn, async () => {
    const x = await api('/api/b2b/clients/request', { method: 'POST', body: JSON.stringify({ id, note: note.trim() || undefined }) });
    if (!x.ok) throw Error(x.data?.error || 'Erinnerung konnte nicht gesendet werden.');
    toast(x.data.mailed ? 'Erinnerung per E-Mail gesendet und in der App angezeigt.' : 'Erinnerung wird dem Kunden in der App angezeigt (E-Mail-Versand noch nicht eingerichtet).');
    CASES = null; after?.();
  });
};

// Start: Was braucht heute Aufmerksamkeit? Kennzahlen, Aufgaben nach Priorität, Schnellaktionen, letzte Fälle.
function vStart(box) {
  const a = me.account, u = me.usage, lim = me.limits;
  const quota = lim ? (lim.dossiersPerMonth == null ? 'unbegrenzt' : `${u.dossiersThisMonth} von ${lim.dossiersPerMonth + (a.dossierBonus || 0)}`) : '–';
  const done = setupSteps().filter(([ok]) => ok).length;
  const col = me.limits?.cobranding && a.brandColor ? a.brandColor : '#0F2C59';
  const first = me.role === 'owner' ? String(a.advisorName || '').trim().split(/\s+/)[0] : '';
  box.innerHTML = `<p class="pt-mobile-hint" role="note">${ICO(IC.monitor)} <span>Für umfangreiche Analysen empfehlen wir Tablet oder Computer.</span></p>${a.verified ? '' : `<div class="pt-alert warn"><strong>Ihr Konto ist noch nicht freigeschaltet.</strong> Bitte laden Sie Ihre Gewerbeanmeldung oder einen Handelsregisterauszug hoch. Nach unserer Prüfung schalten wir Partnerseite, Widget, Anfragen, Kreditmappen und Tarife frei. <a class="btn btn-dark" href="#verifizierung">Zur Verifizierung</a></div>`}
    <section class="pt-hello"><h2>${esc(greet())}${first ? ', ' + esc(first) : ''}</h2><p>Hier ist der aktuelle Stand Ihrer Fälle.</p></section>
    <div class="pt-kpis pt-case-kpis" id="caseKpis" aria-live="polite">${['Neue Anfragen', 'Offene Fälle', 'Dokumente fehlen', 'Bereit für nächsten Schritt'].map((l) => `<div class="pt-kpi pt-skel"><small>${l}</small><strong>&nbsp;</strong></div>`).join('')}</div>
    <section class="pt-card todo"><div class="todo-h"><h2>Heute zu erledigen</h2><span class="form-note" id="todoSum">wird geladen …</span></div><ul class="todo-list todo-cases" id="todoList">${'<li class="pt-skel-row" aria-hidden="true"></li>'.repeat(4)}</ul></section>
    <section class="pt-card"><h2 class="pt-h2s">Schnellaktionen</h2><div class="pt-quick">
      <a href="#kunden=einladen">${ICO(IC.invite)}<span>Kunden einladen</span></a>
      <a href="#fall">${ICO(IC.scan)}<span>Fall-Analyse starten</span></a>
      <a href="#faelle">${ICO(IC.cases)}<span>Fälle ansehen</span></a>
      <a href="#anfragen">${ICO(IC.inbox)}<span>Anfragen prüfen</span></a></div>
      <p class="pt-tools-row"><span>Rechner:</span> <a href="#tools">Haushaltsrechnung</a> · <a href="/calculators/closing-costs" target="_blank" rel="noopener">Kaufnebenkosten<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a> · <a href="/calculators/amortization" target="_blank" rel="noopener">Tilgungsplan<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a> · <a href="/calculators/budget" target="_blank" rel="noopener">Finanzierungsbudget<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a></p></section>
    <section class="pt-card last-cases"><div class="todo-h"><h2>Letzte Fälle</h2><a class="ck-link" href="#faelle">Alle Fälle →</a></div><div id="lastCases"><span class="sr-only" role="status">Fälle werden geladen …</span>${'<div class="pt-skel-row" aria-hidden="true"></div>'.repeat(3)}</div></section>
    <h2 class="pt-sec-h">Konto &amp; Nutzung</h2>
    <div class="pt-kpis">
      <div class="pt-kpi"><small>Kreditmappen diesen Monat</small><strong>${quota}</strong><a href="#einreichungen">Einreichungen</a></div>
      <div class="pt-kpi"><small>Berater-Zugänge</small><strong>${u.seats} / ${lim ? lim.seats : 1}</strong><a href="#team">Team</a></div>
      <div class="pt-kpi"><small>Einrichtung</small><strong>${done} / 5</strong><a href="#profil">${me.role === 'owner' ? 'Im Profil' : 'Beim Inhaber'}</a></div>
      <div class="pt-kpi"><small>Tarif</small><strong class="pt-kpi-sm">${me.tier ? esc(TIER[me.tier]) : 'Noch kein Tarif'}</strong><a href="#tarif">Ansehen</a></div>
    </div>
    <div class="pt-grid2">
      <section class="pt-card wl-card"><h2>So sieht Ihr Kunde die Einladung</h2>
        <div class="wl-prev" style="--wl:${esc(col)}"><div class="wl-mail"><small>Von: <b>${esc(a.companyName)} über LeaseRun</b></small><small>Antwort an: ${esc(a.email || 'Ihre E-Mail-Adresse')}</small></div>
        <div class="wl-page"><h4>Einladung von <span>${esc(a.companyName)}</span></h4><p class="wl-txt">Bereiten Sie Finanzprofil, Objekt und Unterlagen Schritt für Schritt vor – Ihr Berater sieht nur den Fortschritt.</p><span class="wl-btn">Einladung ansehen</span></div></div>
        <p class="form-note">${me.limits?.cobranding ? 'Hausfarbe und Logo pflegen Sie im <a href="#profil">Profil</a>.' : 'Mit „Kanzlei &amp; Baufi Pro“ erscheint die Einladung in Ihrer Hausfarbe, Kreditmappen mit Ihrem Logo. <a href="#tarif">Tarife</a>'}</p>
        <a class="btn btn-dark" href="#kunden=einladen">Kunden einladen</a></section>
      <section class="pt-card" id="stats30"></section>
    </div>
    `;
  startStats($('#stats30'));
  todo();
}
async function todo() {
  const list = $('#todoList'), sum = $('#todoSum'), kp = $('#caseKpis'), last = $('#lastCases');
  if (!list) return;
  const r = await loadCases(true);
  const kpi = (l, n, none, href) => `<a class="pt-kpi pt-kpi-link" href="${href}"><small>${l}</small>${n ? `<strong>${n}</strong>` : `<strong class="pt-kpi-zero">${none}</strong>`}</a>`;
  if (!r?.ok) {
    const retry = '<button type="button" class="btn btn-outline btn-sm" data-retry-start>Erneut versuchen</button>';
    kp.innerHTML = `<div class="pt-alert warn pt-kpi-err">Fälle konnten nicht geladen werden. ${retry}</div>`;
    list.innerHTML = ''; sum.textContent = '';
    last.innerHTML = `<p class="form-note">Fälle konnten nicht geladen werden. ${retry}</p>`;
    $('#ptView')?.querySelectorAll('[data-retry-start]').forEach((b) => b.onclick = () => vStart($('#ptView')));
    return;
  }
  const all = (r.data.clients || []).filter((c) => c.status === 'verbunden' || c.status === 'eingeladen');
  const by = (k) => all.filter((c) => stageOf(c) === k);
  const ready = by('ready'), miss = by('missing'), check = by('check'), inv = by('inv');
  const con = all.filter((c) => c.status === 'verbunden');
  const docMiss = con.filter((c) => c.progress?.missing?.length);
  kp.innerHTML = kpi('Neue Anfragen', me.usage.leadsNew, 'Keine neuen Anfragen', '#anfragen') + kpi('Offene Fälle', con.length - ready.length, 'Keine offenen Fälle', '#faelle')
    + kpi('Dokumente fehlen', docMiss.length, 'Keine fehlenden Dokumente', '#faelle=missing') + kpi('Bereit für nächsten Schritt', ready.length, 'Noch kein Fall bereit', '#faelle=ready');
  // Priorität: 1 fehlende Unterlagen, 2 Kundenantwort, 3 unvollständige Daten, 4 Prüfung, 5 neue Anfragen, 6 Allgemeines.
  const rows = [];
  docMiss.sort((x, y) => (y.progress?.best ?? 0) - (x.progress?.best ?? 0)).forEach((c) => rows.push(['warn', c, nextStep(c)]));
  inv.forEach((c) => rows.push(['', c, nextStep(c)]));
  miss.filter((c) => !c.progress?.missing?.length).forEach((c) => rows.push(['warn', c, nextStep(c)]));
  check.forEach((c) => rows.push(['', c, nextStep(c)]));
  const caseItems = rows.length;
  const items = rows.slice(0, 6).map(([t, c, n]) => `<li class="${t}"><div class="todo-row"><span class="todo-dot" aria-hidden="true"></span><span><strong>${esc(caseName(c))}</strong><small>${esc(n.t)}</small></span><a class="btn btn-outline btn-sm" href="#faelle=${esc(c.id)}">${c.status === 'eingeladen' ? 'Kunde öffnen' : 'Fall öffnen'}</a></div></li>`);
  if (rows.length > 6) items.push(`<li><div class="todo-row"><span class="todo-dot" aria-hidden="true"></span><span><strong>${rows.length - 6} weitere Fälle</strong><small>In der Fallübersicht ansehen.</small></span><a class="btn btn-outline btn-sm" href="#faelle">Alle Fälle</a></div></li>`);
  const gen = [];
  if (me.usage.leadsNew) gen.push(['hot', `${me.usage.leadsNew} neue Anfrage${me.usage.leadsNew === 1 ? '' : 'n'}`, 'Aus Widget, QR-Code oder Partnerseite.', '#anfragen', 'Anfragen öffnen']);
  if (!me.account.verified) gen.push(['warn', 'Konto verifizieren', 'Gewerbenachweis hochladen – danach sind alle Funktionen frei.', '#verifizierung', 'Zur Verifizierung']);
  if (ready.length) gen.push(['ok', `${ready.length} ${ready.length === 1 ? 'Fall' : 'Fälle'} bereit`, 'Kreditmappe erstellen und einreichen.', '#einreichungen', 'Einreichungen']);
  const mon = (ym) => { const [y, m] = ym.split('-').map(Number); const n = new Date(); return (y - n.getFullYear()) * 12 + (m - 1 - n.getMonth()); };
  const soon = r.data.radarOn ? con.flatMap((c) => (Array.isArray(c.radar) ? c.radar : []).map((ym) => mon(ym))).filter((m) => m >= -1 && m <= 12).length : 0;
  if (soon) gen.push(['hot', `${soon} Zinsbindung${soon === 1 ? '' : 'en'} enden in 12 Monaten`, 'Anschlussfinanzierung ansprechen (Bestandskunden-Radar).', '#kunden', 'Radar öffnen']);
  gen.forEach(([t, h, x, href, cta]) => items.push(`<li class="${t}"><div class="todo-row"><span class="todo-dot" aria-hidden="true"></span><span><strong>${esc(h)}</strong><small>${esc(x)}</small></span><a class="btn btn-outline btn-sm" href="${href}">${cta}</a></div></li>`));
  sum.textContent = caseItems ? `${caseItems} ${caseItems === 1 ? 'Fall benötigt' : 'Fälle benötigen'} Aufmerksamkeit` : items.length ? `${items.length} ${items.length === 1 ? 'Punkt' : 'Punkte'}` : '';
  const MAXV = 4;
  if (items.length > MAXV) items.splice(MAXV, 0, `<li class="todo-more-li"><button type="button" class="btn btn-ghost btn-sm" id="todoAll">Alle ${items.length} Aufgaben anzeigen</button></li>`);
  list.innerHTML = items.length ? items.map((x, i) => (i > MAXV ? x.replace('<li class="', '<li hidden class="') : x)).join('') : `<li class="empty todo-done">${ICO(IC.check)}<div><strong>Alles erledigt</strong><p>Aktuell gibt es keine offenen Aufgaben.</p></div></li>`;
  $('#todoAll')?.addEventListener('click', (e) => { list.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; }); e.currentTarget.closest('li').remove(); });
  const recent = [...con].sort((x, y) => new Date(y.progress?.lastActive || y.since || 0) - new Date(x.progress?.lastActive || x.since || 0)).slice(0, 5);
  last.innerHTML = recent.length ? `<ul class="lc-list">${recent.map((c) => { const [cls, lbl] = stLabel(c); const best = c.progress?.best ?? 0; return `<li><a href="#faelle=${esc(c.id)}"><span class="lc-n"><strong>${esc(caseName(c))}</strong><small>${c.progress?.missing?.length ? 'Fehlt: ' + esc(c.progress.missing.slice(0, 2).join(', ')) : c.progress?.lastActive ? 'zuletzt aktiv ' + dt(c.progress.lastActive) : ''}</small></span><span class="st ${cls}">${lbl}</span><span class="lc-p"><span class="pipe-bar"><i style="width:${Math.max(3, Math.min(100, best))}%"></i></span><b>${best} %</b></span><em aria-hidden="true">→</em></a></li>`; }).join('')}</ul>`
    : `<div class="pt-empty"><strong>Noch keine Fälle</strong><p>Erstellen Sie Ihren ersten Fall oder laden Sie einen Kunden ein.</p><div class="todo-empty-a"><a class="btn btn-dark" href="#kunden=einladen">Kunden einladen</a><a class="btn btn-outline" href="#fall">Fall-Analyse starten</a></div></div>`;
}

// ---------- Fälle: alle Kundenfälle mit Suche, Status-Filter und Falldetail ----------
const FILTERS = [['alle', 'Alle'], ['inv', 'Wartet auf Kunde'], ['missing', 'Dokumente fehlen'], ['check', 'Prüfung'], ['ready', 'Bereit']];
async function vFaelle(box) {
  const arg = (location.hash.split('=')[1] || '').trim();
  const r = await loadCases(true);
  if (!r.ok) { box.innerHTML = `<section class="pt-card"><h2>Fälle konnten nicht geladen werden.</h2><p class="form-note">${esc(r.data?.error || 'Bitte versuchen Sie es erneut.')}</p><button type="button" class="btn btn-dark" id="fcRetry">Erneut versuchen</button></section>`; $('#fcRetry').onclick = () => { box.innerHTML = logoLoader(); vFaelle(box); }; return; }
  const all = (r.data.clients || []).filter((c) => c.status === 'verbunden' || c.status === 'eingeladen');
  let f = FILTERS.some(([k]) => k === arg) ? arg : 'alle', q = '';
  const count = (k) => (k === 'alle' ? all.length : all.filter((c) => stageOf(c) === k).length);
  box.innerHTML = `<section class="pt-card fc"><div class="fc-top"><div><p class="form-note fc-lead">Jeder eingeladene oder verbundene ${esc(B().kunden === 'Kunden' ? 'Kunde' : B().kunden.replace(/en$/, ''))} ist ein Fall – mit Status, Vollständigkeit und nächstem Schritt.</p></div><a class="btn btn-dark" href="#kunden=einladen">Kunden einladen</a></div>
    <div class="fc-tools"><label class="fc-search"><span class="sr-only">Fälle suchen</span><input type="search" id="fcQ" placeholder="Fälle suchen (Name oder E-Mail)" autocomplete="off"></label>
    <div class="seg fc-seg" role="tablist" aria-label="Status">${FILTERS.map(([k, l]) => `<button type="button" role="tab" data-fc="${k}" aria-selected="${k === f}">${l} <b>${count(k)}</b></button>`).join('')}</div></div>
    <div id="fcList"></div></section>
    <dialog class="fc-dlg" id="fcDlg" aria-labelledby="fcDlgH"></dialog>`;
  const draw = () => {
    const xs = all.filter((c) => (f === 'alle' || stageOf(c) === f) && (!q || `${c.name || ''} ${c.email || ''}`.toLowerCase().includes(q)))
      .sort((x, y) => ['missing', 'inv', 'check', 'ready'].indexOf(stageOf(x)) - ['missing', 'inv', 'check', 'ready'].indexOf(stageOf(y)) || (y.progress?.best ?? 0) - (x.progress?.best ?? 0));
    $('#fcList').innerHTML = xs.length ? `<table class="fc-table"><thead><tr><th scope="col">Kunde</th><th scope="col">Status</th><th scope="col">Vollständigkeit</th><th scope="col">Nächster Schritt</th><th scope="col">Zuletzt aktiv</th><th scope="col"><span class="sr-only">Aktion</span></th></tr></thead><tbody>${xs.map((c) => {
      const [cls, lbl] = stLabel(c), best = c.progress?.best, n = nextStep(c);
      return `<tr><th scope="row" data-label="Kunde"><strong>${esc(caseName(c))}</strong>${c.name && c.email ? `<small>${esc(c.email)}</small>` : ''}</th><td data-label="Status"><span class="st ${cls}">${lbl}</span></td><td data-label="Vollständigkeit">${best == null ? '–' : `<span class="lc-p"><span class="pipe-bar"><i style="width:${Math.max(3, Math.min(100, best))}%"></i></span><b>${best} %</b></span>`}</td><td data-label="Nächster Schritt">${esc(n.t)}</td><td data-label="Zuletzt aktiv">${c.progress?.lastActive ? dt(c.progress.lastActive) : c.status === 'eingeladen' ? 'eingeladen' : '–'}</td><td><button type="button" class="btn btn-outline btn-sm" data-open="${esc(c.id)}">Fall öffnen</button></td></tr>`;
    }).join('')}</tbody></table>` : all.length ? '<div class="pt-empty"><strong>Keine passenden Fälle</strong><p>Filter oder Suche anpassen.</p></div>'
      : '<div class="pt-empty"><strong>Noch keine Fälle</strong><p>Erstellen Sie Ihren ersten Fall oder laden Sie einen Kunden ein.</p><div class="todo-empty-a"><a class="btn btn-dark" href="#kunden=einladen">Kunden einladen</a><a class="btn btn-outline" href="#fall">Fall-Analyse starten</a></div></div>';
    $('#fcList').querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openCase(all.find((c) => c.id === b.dataset.open), box));
  };
  box.querySelectorAll('[data-fc]').forEach((b) => b.onclick = () => { f = b.dataset.fc; box.querySelectorAll('[data-fc]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); draw(); });
  $('#fcQ').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  draw();
  const pre = all.find((c) => c.id === arg);
  if (pre) openCase(pre, box);
}
// Falldetail als Dialog: Kunde, Status, Vollständigkeit, offene Punkte, nächster Schritt – Aktionen ohne Bereichswechsel.
function openCase(c, box) {
  const dlg = $('#fcDlg'); if (!c || !dlg) return;
  const p = c.progress || {}, [cls, lbl] = stLabel(c), n = nextStep(c), best = p.best ?? 0, con = c.status === 'verbunden';
  const open = [...(p.missing || []).map((m) => ['Dokument', m]), ...(p.profile === false ? [['Finanzangabe', 'Finanzprofil (Einkommen, Ausgaben)']] : [])];
  const reminded = c.lastRequestAt && Date.now() - new Date(c.lastRequestAt).getTime() < 864e5;
  dlg.innerHTML = `<div class="fc-d"><header class="fc-dh"><div><small>Fall</small><h2 id="fcDlgH">${esc(caseName(c))}</h2><p>${c.name && c.email ? esc(c.email) + ' · ' : ''}Immobilienfinanzierung</p></div><span class="st ${cls}">${lbl}</span><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></header>
    <section class="fc-next ${n.remind ? 'warn' : ''}"><small>Nächster Schritt</small><strong>${esc(n.t)}</strong><p>${esc(n.x)}</p>
      ${n.remind && con ? `<button type="button" class="btn btn-dark" id="fcRem"${reminded ? ' disabled' : ''}>${reminded ? 'Heute bereits erinnert' : 'Kunde erinnern'}</button>` : n.pdf ? '<button type="button" class="btn btn-dark" id="fcPdf">Kurzbericht öffnen (PDF)</button>' : n.href ? `<a class="btn btn-dark" href="${n.href}" data-x>${esc(n.cta)}</a>` : `<a class="btn btn-dark" href="#kunden" data-x>Zur Kundenübersicht</a>`}</section>
    ${con ? `<section class="fc-comp"><div class="fc-comp-h"><span>Fallvollständigkeit</span><b>${best} %</b></div><div class="pipe-bar fc-bar"><i style="width:${Math.max(3, Math.min(100, best))}%"></i></div><small>Bankreife laut Kundenbereich: Finanzprofil, Objekt und Unterlagen.</small>
      ${open.length ? `<h3>Noch offen</h3><ul class="fc-open">${open.map(([k, v]) => `<li><em>${k}</em>${esc(v)}</li>`).join('')}</ul>` : '<p class="fc-ok">Alle Unterlagen-Arten vorhanden.</p>'}</section>
    <dl class="fc-kv"><div><dt>Objekte</dt><dd>${p.objects ?? '–'}</dd></div><div><dt>Unterlagen</dt><dd>${p.docs ?? '–'}</dd></div><div><dt>Finanzprofil</dt><dd>${p.profile == null ? '–' : p.profile ? 'ausgefüllt' : 'offen'}</dd></div><div><dt>Zuletzt aktiv</dt><dd>${p.lastActive ? dt(p.lastActive) : '–'}</dd></div><div><dt>Verbunden seit</dt><dd>${c.since ? dt(c.since) : '–'}</dd></div>${c.lastRequestAt ? `<div><dt>Zuletzt erinnert</dt><dd>${dtt(c.lastRequestAt)}</dd></div>` : ''}</dl>` : `<p class="form-note">Sobald der Kunde die Einladung annimmt, erscheinen hier Profil, Objekt und Unterlagen.</p>`}
    <section class="fc-acts"><h3>Weiter im Fall</h3><div class="fc-act-grid">
      ${con ? '<button type="button" class="btn btn-outline" id="fcPdf2">Kurzbericht (PDF)</button>' : ''}
      <a class="btn btn-outline" href="#fall" data-x>Unterlagen analysieren</a>
      <a class="btn btn-outline" href="#wissen" data-x data-ctx>Beratungskompass für diesen Fall</a>
      <a class="btn btn-outline" href="#einreichungen" data-x>Kreditmappe &amp; Einreichung</a></div></section>
    <p class="form-note">Orientierungswerte aus den Angaben des Kunden. Keine Kredit- oder Bonitätsentscheidung.</p></div>`;
  const close = () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } if (/^#faelle=/.test(location.hash)) history.replaceState(null, '', '#faelle'); };
  dlg.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', () => { if (x.hasAttribute('data-ctx')) try { sessionStorage.setItem('lr-ctx', JSON.stringify({ id: c.id, name: caseName(c) })); } catch { /* ignore */ } close(); }));
  dlg.onclick = (e) => { if (e.target === dlg) close(); };
  const pdf = (b) => busy(b, async () => { await download('/api/b2b/clients/report?id=' + encodeURIComponent(c.id), {}, 'LeaseRun-Kurzbericht.pdf'); });
  dlg.querySelector('#fcPdf')?.addEventListener('click', (e) => pdf(e.currentTarget));
  dlg.querySelector('#fcPdf2')?.addEventListener('click', (e) => pdf(e.currentTarget));
  dlg.querySelector('#fcRem')?.addEventListener('click', (e) => remind(c.id, e.currentTarget, () => { c.lastRequestAt = new Date().toISOString(); openCase(c, box); }));
  if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  dlg.querySelector('.stage-x')?.focus();
}
// Kopf des Beratungskompass – mit Fallkontext, wenn er aus einem Fall heraus geöffnet wurde.
function kompassHead() {
  let ctx = null; try { ctx = JSON.parse(sessionStorage.getItem('lr-ctx') || 'null'); } catch { /* ignore */ }
  return `${ctx?.name ? `<div class="bw-ctx"><span>Passend zu <strong>${esc(ctx.name)}</strong> – Beratungskompass aus dem Fall geöffnet.</span><a class="btn btn-outline btn-sm" href="#faelle=${esc(ctx.id)}">Zurück zum Fall</a><button type="button" class="btn btn-ghost btn-sm" data-ctx-off>Kontext entfernen</button></div>` : ''}<div id="bwBody"></div>`;
}

// ---------- Verifizierung (Gewerbenachweis) ----------
const VKIND = { gewerbe: 'Gewerbeanmeldung', handelsregister: 'Handelsregisterauszug', erlaubnis: 'Erlaubnis § 34c / § 34i GewO', sonstiges: 'Sonstiger Nachweis' };
async function vVerify(box) {
  const r = await api('/api/b2b/verification');
  if (!r.ok) { box.innerHTML = `<section class="pt-card"><h2>Verifizierung konnte nicht geladen werden.</h2><button type="button" class="btn btn-dark" data-reload>Erneut versuchen</button></section>`; return; }
  const v = r.data, locked = v.verified || v.status === 'eingereicht', owner = v.isOwner;
  const state = v.verified ? ['ok', 'Verifiziert'] : v.status === 'eingereicht' ? ['warn', 'In Prüfung'] : ['bad', 'Nicht verifiziert'];
  const hasProof = v.docs.some((d) => d.kind === 'gewerbe' || d.kind === 'handelsregister');
  const nextV = v.verified ? 'Nichts zu tun – alle Funktionen sind freigeschaltet.' : v.status === 'eingereicht' ? 'Wir prüfen Ihre Unterlagen, in der Regel innerhalb von zwei Werktagen.' : hasProof ? 'Nachweis zur Prüfung einreichen.' : 'Gewerbeanmeldung oder Handelsregisterauszug hochladen.';
  const stat = { offen: ['warn', 'Noch nicht eingereicht'], eingereicht: ['warn', 'Eingereicht – wird geprüft'], geprueft: ['ok', 'Geprüft und freigeschaltet'], abgelehnt: ['bad', 'Bitte Unterlagen ergänzen'] }[v.status] || ['warn', v.status];
  box.innerHTML = `<section class="pt-card vf-sum"><div class="vf-h"><h2>Unternehmensverifizierung</h2><span class="st ${state[0]}">${state[1]}</span></div>
    <dl class="vf-dl"><div><dt>Eingereicht</dt><dd>${v.docs.length ? `${v.docs.length} Nachweis${v.docs.length === 1 ? '' : 'e'}` : 'noch nichts'}</dd></div><div><dt>Was fehlt</dt><dd>${v.verified ? '–' : hasProof ? (v.status === 'eingereicht' ? '–' : 'Einreichung') : 'Gewerbe- oder Registernachweis'}</dd></div><div><dt>Nächster Schritt</dt><dd>${nextV}</dd></div></dl></section>
    <section class="pt-card"><h2>Unternehmen verifizieren</h2>
    <p>Status: <span class="st ${stat[0]}">${stat[1]}</span>${v.submittedAt ? ` <small class="form-note">eingereicht ${dtt(v.submittedAt)}</small>` : ''}</p>
    ${v.note ? `<div class="pt-alert bad"><strong>Hinweis aus der Prüfung:</strong> ${esc(v.note)}</div>` : ''}
    ${v.verified ? '<p>Ihr Konto ist freigeschaltet. Vielen Dank!</p>' : `<p class="form-note">Wir schalten ausschließlich Unternehmen frei (§ 14 BGB). Benötigt: <strong>Gewerbeanmeldung oder Handelsregisterauszug</strong> (nicht älter als 12 Monate). Für Makler und Finanzierungsvermittler zusätzlich hilfreich: Erlaubnis nach § 34c bzw. § 34i GewO. Bitte keine Ausweiskopien hochladen. Die Nachweise werden nur für die Prüfung verwendet, vertraulich gespeichert und 90 Tage nach der Entscheidung gelöscht.</p>`}
    <h3>Hochgeladene Nachweise</h3>
    ${v.docs.length ? `<ul class="pt-check">${v.docs.map((d) => `<li class="done"><span>${esc(d.label)}: ${esc(d.file_name)} <small class="form-note">(${Math.max(1, Math.round(d.byte_size / 1024))} KB · ${dtt(d.created_at)})</small></span>${!locked && owner ? ` <button class="text-btn del" type="button" data-vdel="${d.id}">Entfernen</button>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Noch keine Nachweise.</p>'}
    ${!locked && owner ? `<div class="pt-up"><label>Art des Nachweises<select id="vKind">${Object.entries(VKIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Datei (PDF, JPG oder PNG, max. 10 MB)<input id="vFile" type="file" accept="application/pdf,image/jpeg,image/png"></label>
      <button class="btn btn-outline" id="vUp" type="button">Hochladen</button></div>
      <p><button class="btn btn-dark" id="vSubmit" type="button"${v.docs.some((d) => d.kind === 'gewerbe' || d.kind === 'handelsregister') ? '' : ' disabled'}>Zur Prüfung einreichen</button></p>
      <p class="form-note">Nach dem Einreichen prüfen wir in der Regel innerhalb von 1–2 Werktagen und informieren Sie per E-Mail.</p>` : ''}
    ${!owner && !v.verified ? '<p class="form-note">Die Verifizierung kann nur der Kontoinhaber einreichen.</p>' : ''}</section>`;
  $('#vUp') && ($('#vUp').onclick = (e) => busy(e.target, async () => {
    const f = $('#vFile').files[0];
    if (!f) throw new Error('Bitte eine Datei auswählen.');
    if (f.size > 10 * 1024 * 1024) throw new Error('Die Datei ist größer als 10 MB.');
    const q = new URLSearchParams({ kind: $('#vKind').value, name: f.name.slice(0, 120) });
    const x = await api('/api/b2b/verification?' + q, { method: 'POST', body: f, headers: { 'content-type': f.type || 'application/octet-stream' } });
    if (!x.ok) throw new Error(x.data?.error || 'Hochladen fehlgeschlagen.');
    toast('Nachweis hochgeladen.'); vVerify(box);
  }));
  box.querySelectorAll('[data-vdel]').forEach((b) => b.onclick = () => busy(b, async () => {
    const x = await api('/api/b2b/verification?id=' + b.dataset.vdel, { method: 'DELETE' });
    if (!x.ok) throw new Error(x.data?.error || 'Entfernen fehlgeschlagen.');
    vVerify(box);
  }));
  $('#vSubmit') && ($('#vSubmit').onclick = (e) => busy(e.target, async () => {
    const x = await api('/api/b2b/verification', { method: 'PUT' });
    if (!x.ok) throw new Error(x.data?.error || 'Einreichen fehlgeschlagen.');
    toast('Eingereicht. Wir melden uns per E-Mail.'); vVerify(box);
  }));
}

// ---------- Anfragen ----------
async function vLeads(box) {
  const [r, t] = await Promise.all([api('/api/b2b/leads'), api('/api/b2b/team')]);
  if (!r.ok) { box.innerHTML = `<section class="pt-card"><h2>Anfragen konnten nicht geladen werden.</h2><p class="form-note">${esc(r.data?.error || 'Bitte versuchen Sie es erneut.')}</p><button type="button" class="btn btn-dark" id="ldRetry">Erneut versuchen</button></section>`; $('#ldRetry').onclick = () => { box.innerHTML = logoLoader(); vLeads(box); }; return; }
  const leads = r.data.leads;
  const members = t.ok ? t.data.members : [];
  const self = members.find((m) => m.self)?.user_id;
  const who = (id) => members.find((m) => m.user_id === id)?.email || '';
  const assignSel = (l) => members.length > 1 || me.role === 'owner'
    ? `<label class="form-note">Zuständig <select data-as="${l.id}"><option value="">– niemand –</option>${members.filter((m) => me.role === 'owner' || m.self || m.user_id === l.assigned_to).map((m) => `<option value="${m.user_id}"${m.user_id === l.assigned_to ? ' selected' : ''}>${esc(m.email)}${m.self ? ' (Sie)' : ''}</option>`).join('')}</select></label>` : '';
  const n = (v) => (v == null || v === '' ? '–' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €');
  box.innerHTML = `<div class="pt-bar"><div class="seg" role="tablist">${['alle', ...Object.keys(STATUS)].map((s, i) => `<button type="button" data-f="${s}" aria-selected="${i === 0}">${s === 'alle' ? 'Alle' : STATUS[s]} <b>${s === 'alle' ? leads.length : leads.filter((l) => l.status === s).length}</b></button>`).join('')}<button type="button" data-f="mine" aria-selected="false">Mir zugewiesen <b>${leads.filter((l) => l.assigned_to && l.assigned_to === self).length}</b></button></div>
    <button class="btn btn-ghost" id="csv" type="button">CSV exportieren</button></div>
    ${leads.length ? '' : '<div class="pt-empty"><strong>Noch keine Anfragen.</strong><p>Jede Anfrage aus Widget, QR-Code oder Partnerseite erscheint hier mit Objektdaten und Kennzahlen.</p><div class="todo-empty-a"><a class="btn btn-dark" href="#kunden">Mandanten einladen via Link</a><a class="btn btn-outline" href="#werkzeuge">QR-Code &amp; Widget</a></div></div>'}
    <div class="pt-leads">${leads.map((l) => {
      const p = l.property_data || {}, m = l.metrics || {};
      return `<article class="pt-lead" data-s="${l.status}" data-a="${l.assigned_to || ''}" data-id="${l.id}">
        <header><div><strong>${esc(l.client_name)}</strong><small>${dtt(l.created_at)} · ${{ widget: 'Website-Widget', landing: 'Partnerseite', qr: 'QR-Code' }[l.source]}</small></div>
        <select data-id="${l.id}" aria-label="Status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === l.status ? ' selected' : ''}>${v}</option>`).join('')}</select></header>
        <p><a href="mailto:${esc(l.client_email)}">${esc(l.client_email)}</a>${l.client_phone ? ` · <a href="tel:${esc(l.client_phone)}">${esc(l.client_phone)}</a>` : ''}</p>
        <dl class="pt-dl"><div><dt>Objekt</dt><dd>${esc(p.address || p.ref || '–')}</dd></div><div><dt>Kaufpreis</dt><dd>${n(p.price)}</dd></div><div><dt>Kaltmiete</dt><dd>${n(p.rent)}</dd></div><div><dt>Eigenkapital</dt><dd>${n(p.equity)}</dd></div>
        ${m.allIn ? `<div><dt>Gesamtkosten</dt><dd>${n(m.allIn)}</dd></div><div><dt>Darlehen</dt><dd>${n(m.loan)}</dd></div><div><dt>Rate</dt><dd>${n(m.rate)}</dd></div><div><dt>DSCR</dt><dd>${m.dscr ?? '–'}</dd></div>` : ''}</dl>
        ${l.message ? `<p class="pt-msg">${esc(l.message)}</p>` : ''}
        <label class="pt-field">Interne Notiz (nur Ihr Team)<textarea data-nt="${l.id}" rows="2" maxlength="4000">${esc(l.notes || '')}</textarea></label>
        ${assignSel(l)}${l.assigned_to && !assignSel(l) ? `<p class="form-note">Zuständig: ${esc(who(l.assigned_to))}</p>` : ''}
        <details><summary>Einwilligung</summary><p class="form-note">${dtt(l.consent_at)}: ${esc(l.consent_text)}</p></details>
        <div class="pt-lead-acts"><button class="btn btn-dark btn-sm" type="button" data-tocase="${l.id}">Als Kunde einladen – Fall anlegen</button><a class="btn btn-outline btn-sm" href="#fall">Unterlagen analysieren</a></div>
        ${me.role === 'owner' ? `<button class="text-btn del" data-del="${l.id}" type="button">Löschen</button>` : ''}
      </article>`;
    }).join('')}</div>`;
  box.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => {
    box.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    box.querySelectorAll('.pt-lead').forEach((el) => { el.hidden = b.dataset.f === 'mine' ? el.dataset.a !== self : b.dataset.f !== 'alle' && el.dataset.s !== b.dataset.f; });
  });
  box.querySelectorAll('textarea[data-nt]').forEach((ta) => ta.onchange = async () => {
    const x = await api('/api/b2b/leads', { method: 'PATCH', body: JSON.stringify({ id: ta.dataset.nt, notes: ta.value }) });
    toast(x.ok ? 'Notiz gespeichert.' : x.data?.error || 'Fehler', !x.ok);
  });
  box.querySelectorAll('select[data-as]').forEach((s2) => s2.onchange = async () => {
    const x = await api('/api/b2b/leads', { method: 'PATCH', body: JSON.stringify({ id: s2.dataset.as, assignedTo: s2.value || null }) });
    if (x.ok) { s2.closest('.pt-lead').dataset.a = s2.value; toast('Zuständigkeit gespeichert.'); } else toast(x.data?.error || 'Fehler', true);
  });
  box.querySelectorAll('select[data-id]').forEach((s) => s.onchange = async () => {
    const x = await api('/api/b2b/leads', { method: 'PATCH', body: JSON.stringify({ id: s.dataset.id, status: s.value }) });
    if (x.ok) { s.closest('.pt-lead').dataset.s = s.value; toast('Status gespeichert.'); } else toast(x.data?.error || 'Fehler', true);
  });
  box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Anfrage endgültig löschen?')) return;
    const x = await api('/api/b2b/leads?id=' + b.dataset.del, { method: 'DELETE' });
    if (x.ok) b.closest('.pt-lead').remove(); else toast(x.data?.error || 'Fehler', true);
  });
  $('#csv').onclick = (e) => busy(e.target, () => download('/api/b2b/leads?format=csv', {}, 'LeaseRun_Anfragen.csv'));
  // Anfrage → Fall: Einladung mit Name und E-Mail vorbelegen; die Einwilligung bestätigt der Berater selbst.
  box.querySelectorAll('[data-tocase]').forEach((b) => b.onclick = () => {
    const l = leads.find((x) => x.id === b.dataset.tocase); if (!l) return;
    try { sessionStorage.setItem('lr-invite', JSON.stringify({ email: l.client_email || '', name: l.client_name || '' })); } catch { /* ignore */ }
    location.hash = 'kunden=einladen';
  });
}

// ---------- Einreichungen (Vorprüfungs-Postkorb) ----------
const SUB = { eingegangen: 'Eingegangen', in_pruefung: 'In Prüfung', rueckfrage: 'Rückfrage', abgeschlossen: 'Abgeschlossen', abgelehnt: 'Abgelehnt' };
async function vSubs(box) {
  const [r, t, v] = await Promise.all([api('/api/b2b/submissions'), api('/api/b2b/submissions?view=targets'), api('/api/b2b/submissions?view=versions')]);
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const { inbox, outbox, acceptsSubmissions } = r.data;
  const targets = t.ok ? t.data.targets : [], versions = v.ok ? v.data.versions : [];
  const isBank = me.account.institutionType === 'BANK';
  box.innerHTML = `
    ${isBank ? `<section class="pt-card"><h2>Postkorb (Eingang)</h2>
      ${acceptsSubmissions ? '' : '<p class="form-note">Ihr Institut nimmt noch keine Einreichungen an. Einschalten unter <a href="#profil">Profil</a>.</p>'}
      ${inbox.length ? inbox.map((s) => `<article class="pt-lead"><header><div><strong>${esc(s.object_label)}</strong><small>${esc(s.from)} · ${dtt(s.created_at)}</small></div>
        <select data-ss="${s.id}" aria-label="Status">${Object.entries(SUB).map(([k, l]) => `<option value="${k}"${k === s.status ? ' selected' : ''}>${l}</option>`).join('')}</select></header>
        ${s.note ? `<p class="pt-msg">${esc(s.note)}</p>` : ''}
        <p class="pt-row"><button class="btn btn-dark" data-dl="${s.id}" type="button"${s.version_id ? '' : ' disabled'}>Kreditmappe öffnen</button>${s.sha256 ? `<a class="text-btn" href="/verify/${esc(s.version_id)}" target="_blank" rel="noopener">Echtheit prüfen</a>` : ''}</p>
        <label class="pt-field">Antwort an den Einreicher<textarea data-rp="${s.id}" rows="2" maxlength="1000">${esc(s.reply || '')}</textarea></label>
        <button class="btn btn-ghost" data-sv="${s.id}" type="button">Status und Antwort senden</button></article>`).join('') : '<div class="pt-empty"><strong>Noch keine Einreichungen.</strong><p>So sieht eine eingereichte Kreditmappe aus:</p><div class="todo-empty-a"><a class="btn btn-outline" href="/sample-loan-package" target="_blank" rel="noopener">Musterfall ansehen</a></div></div>'}</section>` : ''}
    <section class="pt-card"><h2>Kreditmappe bei einem Institut einreichen</h2>
      ${!me.tier ? '<p class="form-note">Einreichungen gibt es ab einem gebuchten Tarif.</p>' : !targets.length ? '<p class="form-note">Derzeit nimmt noch kein Institut über LeaseRun Einreichungen an.</p>' : !versions.length ? '<p class="form-note">Sie haben noch keine registrierte Kreditmappe. Erstellen Sie zuerst eine Kreditmappe zu einem Fall.</p>' : `
      <form id="subF" class="obj-grid">
        <label>Kreditmappe<select name="versionId" required>${versions.map((x) => `<option value="${x.id}">${esc(x.object_ref)} · Version ${x.version_no} · ${dt(x.created_at)}</option>`).join('')}</select></label>
        <label>Institut<select name="targetId" required>${targets.map((x) => `<option value="${x.id}">${esc(x.name)} · ${esc(x.city)}${x.verified ? ' ✓' : ''}</option>`).join('')}</select></label>
        <label>Bezeichnung (optional)<input name="label" maxlength="160" placeholder="z. B. ETW Darmstadt, Familie M."></label>
        <label>Hinweis an das Institut<input name="note" maxlength="1000"></label>
      </form>
      <label class="consent"><input type="checkbox" id="subC"> Die Einwilligung meines Kunden zur Weitergabe dieser Kreditmappe an das gewählte Institut liegt mir vor.</label>
      <button class="btn btn-dark" id="subGo" type="button">Einreichen</button>`}
      <p class="form-note">Das Institut erhält die registrierte Kreditmappe (mit Echtheits-QR) und kann Status und Rückfragen setzen. Die Kreditentscheidung trifft allein das Institut.</p></section>
    <section class="pt-card"><h2>Ihre Einreichungen</h2>${outbox.length ? `<table class="bill-table"><thead><tr><th>Objekt</th><th>Institut</th><th>Datum</th><th>Status</th><th>Antwort</th></tr></thead><tbody>${outbox.map((s) => `<tr><td>${esc(s.object_label)}</td><td>${esc(s.to)}</td><td>${dt(s.created_at)}</td><td>${SUB[s.status]}</td><td>${esc(s.reply || '–')}</td></tr>`).join('')}</tbody></table>` : '<div class="pt-empty"><strong>Noch keine Einreichungen.</strong><p>Erstellen Sie eine Kreditmappe zu einem Fall und reichen Sie sie hier ein.</p><div class="todo-empty-a"><a class="btn btn-dark" href="#fall">Fall anlegen</a><a class="btn btn-outline" href="/sample-loan-package" target="_blank" rel="noopener">Musterfall ansehen</a></div></div>'}</section>`;
  box.querySelectorAll('[data-dl]').forEach((b) => b.onclick = () => busy(b, () => download('/api/b2b/submissions?id=' + b.dataset.dl, {}, 'Kreditmappe.pdf')));
  box.querySelectorAll('[data-sv]').forEach((b) => b.onclick = () => busy(b, async () => {
    const id = b.dataset.sv;
    const x = await api('/api/b2b/submissions', { method: 'PATCH', body: JSON.stringify({ id, status: box.querySelector(`[data-ss="${id}"]`).value, reply: box.querySelector(`[data-rp="${id}"]`).value }) });
    if (!x.ok) throw Error(x.data?.error); toast('Gespeichert, Einreicher wird benachrichtigt.');
  }));
  if ($('#subGo')) $('#subGo').onclick = (e) => busy(e.target, async () => {
    if (!$('#subC').checked) throw Error('Bitte die Einwilligung des Kunden bestätigen.');
    const f = Object.fromEntries(new FormData($('#subF')));
    const x = await api('/api/b2b/submissions', { method: 'POST', body: JSON.stringify({ ...f, consent: true }) });
    if (!x.ok) throw Error(x.data?.error); toast('Eingereicht.'); vSubs(box);
  });
}

// ---------- Widget & QR ----------
function vTools(box) {
  const a = me.account;
  const page = a.slug ? `${location.origin}/p/${a.slug}` : '';
  if (!me.tier) {
    box.innerHTML = `<div class="pt-empty"><strong>Widget, QR-Codes und Partnerseite gibt es ab dem Tarif Basic.</strong><p><a href="#tarif">Tarif wählen</a></p></div>`;
    return;
  }
  const snippet = `<script src="${location.origin}/widget.js" data-leaserun="${esc(a.slug)}" async></script>`;
  box.innerHTML = `<section class="pt-card" id="ecBox"></section>
    <section class="pt-card"><h2>Ihre Partnerseite</h2>
      <p><a class="ck-link" href="${page}" target="_blank" rel="noopener">${esc(page)}</a></p>
      <p class="form-note">Finanzierungsrechner mit Anfrageformular. Anfragen gehen ausschließlich an Sie.${me.limits.landing ? '' : ' Beraterprofil und Terminlink erscheinen ab Tarif Pro.'}</p></section>
    <section class="pt-card"><h2>Website-Widget</h2>
      <p>Diesen Code dort einfügen, wo der Rechner erscheinen soll:</p>
      <pre class="pt-code" id="snip">${esc(snippet)}</pre>
      <div class="pt-row"><button class="btn btn-dark" id="copy" type="button">Code kopieren</button>
      <label class="pt-switch"><input type="checkbox" id="wAct"${a.widgetActive ? ' checked' : ''}${me.role !== 'owner' ? ' disabled' : ''}> Widget aktiv</label></div>
      <label class="pt-field">Erlaubte Websites (eine Domain je Zeile, leer = überall)<textarea id="wDom" rows="3"${me.role !== 'owner' ? ' disabled' : ''}>${esc((a.allowedDomains || []).join('\n'))}</textarea></label>
      ${me.role === 'owner' ? '<button class="btn btn-ghost" id="wSave" type="button">Speichern</button>' : ''}
      <p class="form-note">Datenschutz: Nehmen Sie LeaseRun als Auftragsverarbeiter in Ihre Datenschutzerklärung auf. Jede Anfrage enthält eine Einwilligung mit Ihrem Firmennamen als Empfänger (Zeitpunkt und Wortlaut werden gespeichert).</p></section>
    <section class="pt-card"><h2>Exposé- und Schaufenster-QR</h2>
      <p class="form-note">Der Code öffnet Ihre Partnerseite mit vorbefüllten Objektdaten. Interessenten rechnen die Finanzierung durch und senden Ihnen eine Anfrage.</p>
      <div class="obj-grid">
        <label>Objekt-ID / Bezeichnung<input id="qRef" maxlength="60" placeholder="z. B. ETW Reinheim 3 Zi."></label>
        <label>Kaufpreis (€)<input id="qPreis" inputmode="numeric"></label>
        <label>Kaltmiete (€/Monat)<input id="qMiete" inputmode="numeric"></label>
        <label>Wohnfläche (m²)<input id="qFl" inputmode="numeric"></label>
        <label>Bundesland<select id="qLand"><option value="">–</option>${LAENDER.map((l) => `<option value="${l}">${landName(l)}</option>`).join('')}</select></label>
      </div>
      <div class="pt-qr"><img id="qImg" alt="QR-Code-Vorschau" width="160" height="160"><div><p id="qUrl" class="form-note"></p>
        <div class="pt-row"><button class="btn btn-dark" data-q="pdf" type="button">PDF (A6)</button><button class="btn btn-ghost" data-q="svg" type="button">SVG</button><button class="btn btn-ghost" data-q="png" type="button">PNG</button></div></div></div>
    </section>`;
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(snippet); toast('Code kopiert.'); } catch { toast('Bitte manuell kopieren.', true); } };
  if ($('#wSave')) $('#wSave').onclick = (e) => busy(e.target, async () => {
    const domains = $('#wDom').value.split(/\s+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
    const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify({ allowedDomains: domains, widgetActive: $('#wAct').checked }) });
    if (!r.ok) throw Error(r.data?.error);
    me.account = { ...me.account, ...r.data.account }; toast('Gespeichert.');
  });
  const qs = () => new URLSearchParams({ ref: $('#qRef').value, preis: $('#qPreis').value.replace(/\D/g, ''), miete: $('#qMiete').value.replace(/\D/g, ''), flaeche: $('#qFl').value.replace(/\D/g, ''), land: $('#qLand').value });
  let pv;
  const preview = async () => {
    const r = await api('/api/b2b/qr?format=json&' + qs());
    if (r.ok) $('#qUrl').textContent = r.data.url;
    const img = await api('/api/b2b/qr?format=png&' + qs());
    if (img.ok) { if (pv) URL.revokeObjectURL(pv); pv = URL.createObjectURL(await img.res.blob()); $('#qImg').src = pv; }
  };
  let t; box.querySelectorAll('.obj-grid input, .obj-grid select').forEach((i) => i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(preview, 400); }));
  preview();
  box.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => busy(b, () => download(`/api/b2b/qr?format=${b.dataset.q}&` + qs(), {}, 'QR')));
  import('./expose-check.mjs?v=892f3666').then((m) => m.mountExposeCheck($('#ecBox'), { account: { ...a, brandColor: me.limits?.cobranding ? a.brandColor : '' }, logoUrl: me.limits?.cobranding && a.hasLogo && a.slug ? `/api/b2b/logo?slug=${encodeURIComponent(a.slug)}` : '' })).catch(() => { $('#ecBox').innerHTML = '<p class="form-note">Exposé-AutoPilot konnte nicht geladen werden.</p>'; });
}

// Zugangsdaten einmalig anzeigen (Startpasswort muss bei der ersten Anmeldung geändert werden).
const credBox = (email, pw, mailed) => `<div class="pt-alert ok cred"><strong>Zugang angelegt${mailed ? ' und per E-Mail gesendet' : ''}.</strong> Diese Daten werden nur jetzt angezeigt:
  <dl class="cred-dl"><div><dt>Portal</dt><dd>partner.leaserun.com</dd></div><div><dt>Benutzername</dt><dd>${esc(email)}</dd></div><div><dt>Startpasswort</dt><dd><code>${esc(pw)}</code></dd></div></dl>
  <button type="button" class="btn btn-outline cred-copy" data-copy="${esc(`Portal: https://partner.leaserun.com\nBenutzername: ${email}\nStartpasswort: ${pw}`)}">Zugangsdaten kopieren</button>
  <small>Bei der ersten Anmeldung wird ein eigenes Passwort festgelegt. Bitte nur auf sicherem Weg weitergeben.</small></div>`;
document.addEventListener('click', async (e) => { const b = e.target.closest?.('.cred-copy'); if (!b) return; try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Kopiert ✓'; } catch { toast('Bitte markieren und kopieren.', true); } });

// ---------- Team ----------
async function vTeam(box) {
  const r = await api('/api/b2b/team');
  if (!r.ok) { box.innerHTML = `<section class="pt-card"><h2>Team konnte nicht geladen werden.</h2><p class="form-note">${esc(r.data?.error || 'Bitte versuchen Sie es erneut.')}</p><button type="button" class="btn btn-dark" data-reload>Erneut versuchen</button></section>`; return; }
  const { members, invites, seats } = r.data;
  box.innerHTML = `<section class="pt-card"><h2>Ihr Team</h2><p class="form-note">${members.length + invites.length} von ${seats} Berater-Zugängen belegt. Rollen: <strong>Inhaber</strong> (Tarif, Profil, Team) und <strong>Berater</strong> (Fälle, Kunden, Anfragen) – die Rechte prüft der Server.</p>
    <table class="bill-table"><thead><tr><th>E-Mail</th><th>Rolle</th><th>Seit</th><th></th></tr></thead><tbody>
    ${members.map((m) => `<tr><td>${esc(m.email)}${m.self ? ' (Sie)' : ''}</td><td>${m.role === 'owner' ? 'Inhaber' : 'Berater'}</td><td>${dt(m.created_at)}</td><td>${me.role === 'owner' && m.role !== 'owner' ? `<button class="text-btn del" data-m="${m.user_id}" type="button">Entfernen</button>` : ''}</td></tr>`).join('')}
    ${invites.map((i) => `<tr><td>${esc(i.email)}</td><td>Eingeladen</td><td>bis ${dt(i.expires_at)}</td><td><button class="text-btn del" data-i="${i.id}" type="button">Zurückziehen</button></td></tr>`).join('')}
    </tbody></table>
    ${me.role === 'owner' ? `<form id="inv" class="pt-row" style="margin-top:14px"><input type="email" required placeholder="kollegin@kanzlei.de" id="invMail" aria-label="E-Mail"><label class="chk inv-send"><input type="checkbox" id="invSend"> per E-Mail senden</label><button class="btn btn-dark" type="submit">Zugang anlegen</button></form><div id="invOut"></div>` : ''}
    <p class="form-note">Sie erhalten ein Startpasswort; der Berater vergibt bei der ersten Anmeldung ein eigenes. Berater arbeiten im Kontingent des Unternehmens; Tarif, Profil und Rechnungen verwaltet nur der Inhaber.</p></section>`;
  box.querySelectorAll('[data-m],[data-i]').forEach((b) => b.onclick = async () => {
    if (!confirm('Wirklich?')) return;
    const x = await api('/api/b2b/team?' + (b.dataset.m ? 'member=' + b.dataset.m : 'invite=' + b.dataset.i), { method: 'DELETE' });
    if (x.ok) route(); else toast(x.data?.error || 'Fehler', true);
  });
  if ($('#inv')) $('#inv').onsubmit = async (e) => {
    e.preventDefault();
    const x = await api('/api/b2b/team', { method: 'POST', body: JSON.stringify({ email: $('#invMail').value, send: Boolean($('#invSend')?.checked) }) });
    if (!x.ok) return toast(x.data?.error || 'Fehler', true);
    const html = credBox(x.data.email, x.data.password, x.data.mailed);
    await vTeam(box); addPw(box);
    if ($('#invOut')) $('#invOut').innerHTML = html;
  };
}

// Passwort jederzeit ändern (Profil für Inhaber, Team für alle Berater).
function addPw(box) {
  if (!box || box.querySelector('#pwCard')) return;
  box.insertAdjacentHTML('beforeend', `<section class="pt-card" id="pwCard"><h2>Mein Passwort</h2><p class="form-note">Angemeldet als ${esc(session()?.user?.email || '')}. Mindestens 10 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl.</p>
    <form id="pwF" class="pt-row pw-row"><input id="pw1" type="password" autocomplete="new-password" placeholder="Neues Passwort" aria-label="Neues Passwort" minlength="10" required><input id="pw2" type="password" autocomplete="new-password" placeholder="Wiederholen" aria-label="Neues Passwort wiederholen" minlength="10" required><button class="btn btn-dark" type="submit">Passwort ändern</button></form></section>`);
  $('#pwF').onsubmit = (e) => { e.preventDefault(); const p1 = $('#pw1').value; if (p1 !== $('#pw2').value) return toast('Die Passwörter stimmen nicht überein.', true); if (p1.length < 10 || !/[A-Z]/.test(p1) || !/[a-z]/.test(p1) || !/[0-9]/.test(p1)) return toast('Mindestens 10 Zeichen mit Groß-/Kleinbuchstaben und Zahl.', true);
    busy(e.target.querySelector('button'), async () => { const err = await changePassword(p1); if (err) throw Error(err); e.target.reset(); toast('Passwort geändert.'); }); };
}

// Unternehmenskonto endgültig löschen (nur Inhaber): Konto, Berater-Zugänge, Kunden-Einladungen, Fälle, Unterlagen,
// Logo und Nachweise. Ein laufendes Abo wird dabei sofort gekündigt. Rechnungen bleiben nach § 147 AO aufbewahrt.
function addDelete(box) {
  if (!box || me.role !== 'owner' || box.querySelector('#delCard')) return;
  const sub = me.account.planSource === 'stripe' && me.tier;
  box.insertAdjacentHTML('beforeend', `<section class="pt-card pt-danger" id="delCard"><h2>Unternehmenskonto löschen</h2>
    <p class="form-note">Löscht das Unternehmenskonto vollständig und endgültig: Stammdaten, Berater-Zugänge, Kunden und Einladungen, Fälle, Anfragen, Unterlagen, Logo und Nachweise. Ihre Anmeldung wird ebenfalls entfernt.${sub ? ' <strong>Ihr laufendes Abo wird dabei sofort gekündigt.</strong>' : ''} Rechnungen bleiben wegen der gesetzlichen Aufbewahrungspflicht (§ 147 AO) gespeichert.</p>
    <form id="delF" class="pt-row"><input id="delTxt" type="text" autocomplete="off" placeholder="LÖSCHEN eingeben" aria-label="Zur Bestätigung LÖSCHEN eingeben"><button class="btn btn-danger" type="submit">Endgültig löschen</button></form></section>`);
  $('#delF').onsubmit = (e) => {
    e.preventDefault();
    if ($('#delTxt').value.trim().toUpperCase() !== 'LÖSCHEN') { toast('Bitte zur Bestätigung LÖSCHEN eingeben.', true); return; }
    if (!confirm('Unternehmenskonto und alle Daten jetzt endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return;
    busy(e.target.querySelector('button'), async () => {
      const r = await api('/api/account', { method: 'DELETE', body: JSON.stringify({ confirm: 'LÖSCHEN', cancelSub: true }) });
      if (!r.ok) throw Error(r.data?.error || 'Löschen fehlgeschlagen.');
      try { (await import('./b2b-tools.mjs?v=892f3666')).clearAll(); } catch { /* weiter */ }
      toast('Das Unternehmenskonto wurde gelöscht.');
      setTimeout(() => { setSession(null); location.replace('/business'); }, 1200);
    });
  };
}

// ---------- Profil ----------
function vProfil(box) {
  const a = me.account;
  const brand = me.limits?.cobranding || a.hasWhitelabel;
  box.innerHTML = `<section class="pt-card"><h2>Einrichtung</h2><ul class="pt-check">${setupSteps().map(([ok, t, h]) => `<li class="${ok ? 'done' : ''}"><a href="${h}">${t}</a></li>`).join('')}</ul></section><form class="pt-card" id="prof"><h2>Stammdaten</h2>
      <dl class="pt-dl"><div><dt>Unternehmen</dt><dd>${esc(a.companyName)} (${esc(a.legalForm)})</dd></div><div><dt>Art</dt><dd>${TYPE[a.institutionType]}</dd></div>
      <div><dt>Registernummer</dt><dd>${esc(a.registerNumber || '–')}</dd></div><div><dt>Steuernummer / USt-IdNr.</dt><dd>${esc(a.taxId || '–')}</dd></div><div><dt>Kundennummer</dt><dd>${esc(a.customerNumber)}</dd></div></dl>
      <p class="form-note">Firmenname, Rechtsform und Steuerdaten ändert der Support (Nachweis erforderlich).</p>
      <div class="obj-grid">
        <label>Ansprechpartner<input name="advisorName" value="${esc(a.advisorName)}" required></label>
        <label>Telefon<input name="phone" value="${esc(a.phone || '')}"></label>
        <label>Straße und Nr.<input name="street" value="${esc(a.street || '')}"></label>
        <label>PLZ<input name="postalCode" value="${esc(a.postalCode)}" pattern="[0-9]{5}"></label>
        <label>Ort<input name="city" value="${esc(a.city)}"></label>
        <label>Terminlink (https://…)<input name="bookingUrl" value="${esc(a.bookingUrl || '')}" placeholder="https://calendly.com/…"></label>
        <label>Adresse der Partnerseite<input name="slug" value="${esc(a.slug || '')}" pattern="[a-z0-9\\-]{3,40}"></label>
      </div>
      <button class="btn btn-dark" type="submit">Speichern</button></form>
    <section class="pt-card"><h2>Co-Branding</h2>
      ${brand ? `<p class="form-note">Ihr Logo erscheint im Kopf jeder Kreditmappe und auf Partnerseite und Widget. LeaseRun bleibt dezent als „Strukturiert mit LeaseRun-Software“ mit Prüf-QR sichtbar.</p>
      <div class="pt-row"><div class="pt-logo">${a.hasLogo && a.slug ? `<img src="/api/b2b/logo?slug=${esc(a.slug)}&t=${Date.now()}" alt="Ihr Logo">` : '<span class="form-note">Kein Logo</span>'}</div>
      <label class="btn btn-ghost">Logo hochladen (PNG/JPG, max. 1 MB)<input type="file" id="logo" accept="image/png,image/jpeg" hidden></label>
      ${a.hasLogo ? '<button class="text-btn del" id="logoDel" type="button">Entfernen</button>' : ''}</div>
      <label class="pt-field">Markenfarbe<input type="color" id="color" value="${esc(a.brandColor || '#0F2C59')}"></label>` : '<p class="form-note">Co-Branding (eigenes Logo und Farbe) ist ab Tarif Kanzlei & Baufi Pro enthalten.</p>'}
    </section>
    <section class="pt-card"><h2>Erscheinungsbild Ihrer Unterlagen</h2>
      <p class="form-note">Für Fall-Analysen und Kunden-Präsentationen. <strong>Ab Pro:</strong> eigenes Logo, Farben und Schrift, LeaseRun nur als kleiner Hinweis. <strong>Enterprise / White-Label:</strong> komplett im Erscheinungsbild Ihres Hauses – mit Ihrem Absender und Ihrer Fußzeile, ohne LeaseRun.</p>
      <form id="brandF" class="pt-form"><div class="pt-grid2">
        <label>Zweitfarbe (Akzent)<input type="color" name="brandColor2" value="${esc(a.brandColor2 || '#0284C7')}"></label>
        <label>Schrift<select name="brandFont">${[['sans', 'Modern (serifenlos)'], ['serif', 'Seriös (mit Serifen)'], ['klassisch', 'Klassisch (Arial/Helvetica)']].map(([k, l]) => `<option value="${k}"${a.brandFont === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Dokumenttitel<input name="docTitle" maxlength="80" value="${esc(a.docTitle || '')}" placeholder="z. B. Ihre Finanzierungsübersicht"></label>
        <label>Absender / Abteilung<input name="docSender" maxlength="160" value="${esc(a.docSender || '')}" placeholder="z. B. Immobilienfinanzierung · Filiale Darmstadt"></label>
        <label class="full">Fußzeile (Pflichtangaben Ihres Hauses)<textarea name="docFooter" maxlength="400" rows="2" placeholder="z. B. Firmenname · Rechtsform · Sitz · Registergericht · Vorstand">${esc(a.docFooter || '')}</textarea></label>
      </div><button class="btn btn-dark" type="submit">Erscheinungsbild speichern</button></form>
      <p class="form-note">Verwenden Sie nur Namen, Logos und Gestaltungsmerkmale, zu deren Nutzung Ihr Haus berechtigt ist.</p>
    </section>
    <section class="pt-card"><h2>Rechtliches</h2>
      <p>Unternehmer nach § 14 BGB bestätigt am ${dtt(a.unternehmerConfirmedAt)}.</p>
      <p>Auftragsverarbeitungsvertrag (Version ${esc(a.avvVersion || '')}) geschlossen am ${dtt(a.avvAcceptedAt)}.</p>
      <button class="btn btn-ghost" id="avv" type="button">AVV als PDF</button></section>
    ${a.institutionType === 'BANK' ? `<section class="pt-card"><h2>Postkorb für Einreichungen</h2><p class="form-note">Vermittler mit LeaseRun-Konto können Ihrem Institut registrierte Kreditmappen zur Vorprüfung einreichen. Sie setzen Status und Rückfragen im Reiter Einreichungen.</p>
      <label class="pt-switch"><input type="checkbox" id="accSub"${a.acceptSubmissions ? ' checked' : ''}> Einreichungen annehmen und im Verzeichnis erscheinen</label></section>` : ''}
    ${me.tier === 'ENTERPRISE' || a.hasWhitelabel ? `<section class="pt-card"><h2>Eigener Hinweistext</h2><p class="form-note">Erscheint auf Ihrer Partnerseite, im Widget und in der Finanzierungsübersicht für Interessenten (z. B. Compliance-Hinweis Ihres Instituts). Max. 600 Zeichen.</p>
      <textarea id="discl" rows="3" maxlength="600" style="width:100%;border:1px solid #CBD5E1;border-radius:6px;padding:8px">${esc(a.customDisclaimer || '')}</textarea><button class="btn btn-ghost" id="disclSave" type="button">Speichern</button></section>` : ''}
    <section class="pt-card"><h2>Aufbewahrung der Anfragen</h2><p class="form-note">Anfragen werden nach dieser Frist automatisch gelöscht (Speicherbegrenzung, Art. 5 DSGVO). Legen Sie die Frist passend zu Ihren eigenen Pflichten fest.</p>
      <label class="pt-field">Löschen nach<select id="ret">${[1, 6, 12, 24, 36, 60, 120].map((m) => `<option value="${m}"${(a.leadRetentionMonths || 24) === m ? ' selected' : ''}>${m === 1 ? '30 Tagen' : m + ' Monaten'}</option>`).join('')}</select></label></section>
    ${me.limits?.cobranding ? `<section class="pt-card"><h2>Webhook für Ihr CRM</h2><p class="form-note">Bei jeder neuen Anfrage senden wir sie als JSON per POST an Ihre Adresse (https). Prüfen Sie die Signatur: Header <code>X-LeaseRun-Signature</code> = <code>sha256=</code> HMAC-SHA256 mit dem Geheimnis über <code>Zeitstempel.Body</code> (Header <code>X-LeaseRun-Timestamp</code>).</p>
      <label class="pt-field">Adresse<input id="whUrl" value="${esc(a.webhookUrl || '')}" placeholder="https://crm.example.de/hooks/leaserun"></label>
      ${a.webhookSecret ? `<p class="form-note">Geheimnis: <code>${esc(a.webhookSecret)}</code> <button class="text-btn" id="whRot" type="button">Neu erzeugen</button></p>` : ''}
      <div class="pt-row"><button class="btn btn-ghost" id="whSave" type="button">Speichern</button>${a.webhookUrl ? '<button class="btn btn-ghost" id="whTest" type="button">Test senden</button>' : ''}</div><div id="whLog"></div></section>` : ''}
    <section class="pt-card"><h2>Support-Zugriff</h2>
      <p class="form-note">Für Rückfragen kann der LeaseRun-Support Ihr Portal 7 Tage lang <strong>nur lesend</strong> einsehen, einschließlich der Anfragen. Ohne Ihre Freigabe ist das nicht möglich; jeder Zugriff wird protokolliert (Weisung nach Art. 28 DSGVO).</p>
      <p>${a.supportAccessUntil && new Date(a.supportAccessUntil) > new Date() ? `Freigegeben bis ${dtt(a.supportAccessUntil)}. <button class="text-btn del" id="supOff" type="button">Jetzt beenden</button>` : '<button class="btn btn-ghost" id="supOn" type="button">Support-Zugriff für 7 Tage freigeben</button>'}</p></section>`;
  import('./address-check.mjs?v=892f3666').then((m) => m.attachAddress($('#prof'))).catch(() => {});
  $('#prof').onsubmit = (e) => { e.preventDefault(); busy(e.submitter || $('#prof button'), async () => {
    const f = Object.fromEntries(new FormData(e.target));
    const body = { advisorName: f.advisorName, phone: f.phone, street: f.street, postalCode: f.postalCode, city: f.city, addressConfirmed: f.addressConfirmed === 'on', bookingUrl: f.bookingUrl, slug: f.slug };
    const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify(body) });
    if (!r.ok) throw Error(r.data?.error);
    me.account = { ...me.account, ...r.data.account }; toast('Gespeichert.');
  }); };
  $('#avv').onclick = (e) => busy(e.target, () => download('/api/b2b/avv?pdf=1', {}, 'AVV.pdf'));
  const sup = async (days) => {
    const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify({ supportAccessDays: days }) });
    if (!r.ok) return toast(r.data?.error || 'Fehler', true);
    me.account = { ...me.account, ...r.data.account }; toast(days ? 'Support-Zugriff freigegeben.' : 'Support-Zugriff beendet.'); vProfil(box);
  };
  if ($('#supOn')) $('#supOn').onclick = () => sup(7);
  const patch = async (body, okMsg) => {
    const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify(body) });
    if (!r.ok) throw Error(r.data?.error || 'Fehler');
    me.account = { ...me.account, ...r.data.account }; toast(okMsg);
  };
  $('#ret').onchange = (e) => patch({ leadRetentionMonths: Number(e.target.value) }, 'Frist gespeichert.').catch((er) => toast(er.message, true));
  if ($('#whSave')) $('#whSave').onclick = (e) => busy(e.target, async () => { await patch({ webhookUrl: $('#whUrl').value.trim() }, 'Webhook gespeichert.'); vProfil(box); });
  if ($('#whRot')) $('#whRot').onclick = () => { if (confirm('Neues Geheimnis erzeugen? Das alte wird sofort ungültig.')) patch({ regenerateWebhookSecret: true }, 'Neues Geheimnis erzeugt.').then(() => vProfil(box), (er) => toast(er.message, true)); };
  if ($('#whTest')) $('#whTest').onclick = (e) => busy(e.target, async () => {
    const r = await api('/api/b2b/webhook', { method: 'POST' });
    toast(r.ok ? `Test zugestellt (HTTP ${r.data.status}).` : `Nicht zugestellt: ${r.data?.error || 'Fehler'}`, !r.ok);
    const l = await api('/api/b2b/webhook');
    if (l.ok) $('#whLog').innerHTML = `<table class="bill-table"><tbody>${l.data.log.map((x) => `<tr><td>${dtt(x.created_at)}</td><td>${esc(x.event)}</td><td>${x.status ?? '–'}</td><td>${esc(x.error || 'ok')}</td></tr>`).join('')}</tbody></table>`;
  });
  if ($('#accSub')) $('#accSub').onchange = async (e) => {
    const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify({ acceptSubmissions: e.target.checked }) });
    if (r.ok) { me.account = { ...me.account, ...r.data.account }; toast('Gespeichert.'); } else { e.target.checked = !e.target.checked; toast(r.data?.error || 'Fehler', true); }
  };
  if ($('#disclSave')) $('#disclSave').onclick = (e) => busy(e.target, async () => {
    const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify({ customDisclaimer: $('#discl').value }) });
    if (!r.ok) throw Error(r.data?.error); me.account = { ...me.account, ...r.data.account }; toast('Gespeichert.');
  });
  if ($('#supOff')) $('#supOff').onclick = () => sup(0);
  if ($('#logo')) $('#logo').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 1024 * 1024) return toast('Das Logo ist größer als 1 MB.', true);
    const r = await api('/api/b2b/logo', { method: 'POST', body: f, headers: { 'content-type': f.type } });
    if (!r.ok) return toast(r.data?.error || 'Fehler', true);
    me.account.hasLogo = true; toast('Logo gespeichert.'); vProfil(box);
  };
  if ($('#logoDel')) $('#logoDel').onclick = async () => { await api('/api/b2b/logo', { method: 'DELETE' }); me.account.hasLogo = false; vProfil(box); };
  if ($('#color')) $('#color').onchange = async (e) => {
    const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify({ brandColor: e.target.value.toUpperCase() }) });
    if (r.ok) { me.account.brandColor = e.target.value; toast('Farbe gespeichert.'); } else toast(r.data?.error || 'Fehler', true);
  };
}

// Leistungsvergleich der Tarife als Tabelle (Spalte hl hervorgehoben).
const cmpTable = (v, hl = -1) => (v?.zeilen?.length ? `<details class="cmp" open><summary>Tarife im Vergleich</summary><div class="cmp-wrap"><table class="cmp-table"><thead><tr><th></th>${v.spalten.map((s, i) => `<th${i === hl ? ' class="hl"' : ''}>${esc(s)}</th>`).join('')}</tr></thead><tbody>${v.zeilen.map(([l, ...c]) => `<tr><th scope="row">${esc(l)}</th>${c.map((x, i) => `<td class="${x === '✓' ? 'y' : x === '–' ? 'n' : ''}${i === hl ? ' hl' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : '');
// ---------- Tarif & Rechnungen ----------
async function vTarif(box, known = null) {
  const o = me.offer || { branche: br(), label: B().label, selfService: true, plans: [], enterprise: null, addon: null, others: [] };
  const a = me.account;
  const extras = (me.branches || []).slice(1);
  const pid = (p, i) => `b2b-${o.branche}-${p.key}-${i === 'year' ? 'yearly' : 'monthly'}`;
  const [cfg, inv] = await Promise.all([fetch('/api/billing/config').then((r) => r.json()).catch(() => ({})), api('/api/b2b/invoices')]);
  const billingOn = Boolean(cfg.enabled ?? cfg.billingEnabled);
  const net = (c) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
  const tiers = ['BASIC', 'PRO'];
  const ckq = new URLSearchParams(location.search).get('checkout');
  box.innerHTML = `${ckq === 'test' ? '<div class="pt-alert ok"><strong>Testkauf erfolgreich.</strong> Die Bezahlung lief im Stripe-Testmodus – nichts berechnet, nichts freigeschaltet.</div>' : ckq === 'success' ? '<div class="pt-alert ok"><strong>Vielen Dank!</strong> Ihre Zahlung ist eingegangen; der Tarif wird in wenigen Sekunden aktiv.</div>' : ''}
    <section class="pt-card"><h2>Aktueller Tarif</h2>
      ${me.tier ? `<p class="tf-act"><span class="st ok">Aktiv</span></p>` : '<p class="tf-none"><strong>Noch kein Tarif aktiv</strong><br><span class="form-note">Wählen Sie einen Tarif, um das Unternehmensportal vollständig zu nutzen.</span></p>'}<p><strong>${me.tier ? TIER[me.tier] : ''}</strong>${a.planSource === 'manual' ? ' (vom Betreiber freigeschaltet)' : ''}${a.planUntil ? ` · läuft bis ${dt(a.planUntil)}` : ''}</p>
      ${a.planSource === 'stripe' && me.tier ? '<div class="tf-price" id="tfPrice" aria-live="polite"><span class="form-note">Aktueller Preis wird geladen …</span></div>' : ''}
      ${a.planSource === 'stripe' ? '<div class="tf-acts"><button class="btn btn-ghost" id="aboPm" type="button">Zahlungsmittel ändern</button><button class="btn btn-ghost" id="aboPortal" type="button">Abo verwalten (Wechsel, Kündigung)</button></div><p class="form-note" id="pmMsg" role="status" aria-live="polite"></p>' : ''}</section>
    <section class="pt-card tf-book"><h2>${me.tier ? 'Tarif wechseln oder erweitern' : 'Tarif wählen'}</h2>
      <p class="form-note">Alle Preise netto zzgl. 19 % USt. Wählen Sie die Laufzeit, dann den passenden Tarif.</p>
      <div class="tf-bar"><div class="seg" role="tablist" id="ivl"><button type="button" data-i="month" aria-selected="true">Monatlich</button><button type="button" data-i="year" aria-selected="false">Jährlich (2 Monate gespart)</button></div></div>
      ${o.selfService && o.plans.length && !me.tier && o.addon && o.others.length ? `<div class="br-add"><strong>Weitere Branchen direkt mitbuchen (optional)</strong><span class="form-note">${esc(o.addon.text)} – ${net(o.addon.monthCents)} netto pro Monat je Branche.</span><div>${o.others.map((x) => `<label><input type="checkbox" name="extraBr" value="${x.key}"> ${esc(x.label)}</label>`).join('')}</div></div>` : ''}
      <div class="offers">${o.selfService ? ['month', 'year'].map((i) => o.plans.map((p) => `<div class="offer${p.tier === 'PRO' ? ' rec' : ''}" data-ivl="${i}"${i === 'year' ? ' hidden' : ''}>${p.tier === 'PRO' ? '<span class="offer-rec">Empfohlen</span>' : ''}
        <h4>${esc(p.name)}</h4><div class="offer-price" data-base="${i === 'year' ? p.yearCents : p.monthCents}" data-add="${o.addon ? (i === 'year' ? o.addon.yearCents : o.addon.monthCents) : 0}" data-per="${i === 'year' ? 'pro Jahr' : 'pro Monat'}"><span class="op-v">${net(i === 'year' ? p.yearCents : p.monthCents)}</span> <small>netto ${i === 'year' ? 'pro Jahr' : 'pro Monat'}</small></div><p class="offer-extra form-note" hidden></p>
        <ul>${p.features.map((f) => `<li${/^Alles aus/.test(f) ? ' class="offer-basis"' : ''}>${esc(f)}</li>`).join('')}</ul>
        ${me.tier === p.tier ? '<span class="st ok">Gebucht</span>' : `<button class="btn btn-pay" data-plan="${pid(p, i)}" type="button"${billingOn ? '' : ' disabled'}>${billingOn ? 'Zahlungspflichtig als Unternehmer buchen' : 'Buchung startet in Kürze'}</button>`}</div>`).join('')).join('') : ''}
      ${o.enterprise ? `<div class="offer"><h4>${esc(o.enterprise.name)}</h4><div class="offer-price offer-price-txt">${esc(o.enterprise.price)}</div><ul>${o.enterprise.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn ${o.selfService ? 'btn-ghost' : 'btn-dark'}" href="mailto:support@leaserun.com?subject=Angebot%20${encodeURIComponent(o.enterprise.name)}">Angebot anfragen</a></div>` : ''}
    </div>
      <label class="consent b2b-terms" id="termsL"><input type="checkbox" id="terms"> <span>Ich buche als <strong>Unternehmer (§ 14 BGB)</strong> zu den <a href="/terms#b2b" target="_blank">AGB für Unternehmen</a>. Preise netto zzgl. 19 % USt. – auf der Bezahlseite sehen Sie Netto, USt. und Brutto. Ein Widerrufsrecht besteht nicht.</span></label>
      ${billingOn ? '' : '<p class="form-note">Online-Buchung ist noch nicht freigeschaltet. Für einen Testzugang oder Kauf auf Rechnung: support@leaserun.com.</p>'}
    </section>
    <section class="pt-card"><h2>Rechnungen</h2>${inv.ok && inv.data?.invoices?.length ? `<table class="bill-table"><thead><tr><th>Nummer</th><th>Datum</th><th>Brutto</th><th>Status</th><th></th></tr></thead><tbody>
      ${inv.data.invoices.map((i) => `<tr><td>${esc(i.invoice_number)}${i.kind !== 'invoice' ? ' (Storno)' : ''}</td><td>${dt(i.issue_date)}</td><td>${eur(i.gross_cents)}</td><td>${{ PAID: 'bezahlt', PENDING: 'offen', OVERDUE: 'überfällig', CANCELLED: 'storniert' }[i.payment_status]}</td><td><button class="text-btn" data-inv="${i.id}" type="button">PDF</button></td></tr>`).join('')}</tbody></table>` : '<p class="form-note">Noch keine Rechnungen.</p>'}</section>
    <details class="pt-card tf-more roi-card"><summary><h2>Lohnt sich das für Sie? <span class="st">Schätzung</span></h2></summary>
      <p class="form-note">Ihre eigene Rechnung – tragen Sie Ihre Werte ein. LeaseRun nennt bewusst keine pauschale Zeitersparnis.</p>
      <div class="roi-in"><label>Fälle pro Monat<input id="roiN" type="number" min="0" step="1" inputmode="numeric" placeholder="z. B. 4"></label>
        <label>Minuten Vorarbeit, die Sie je Fall sparen<input id="roiM" type="number" min="0" step="5" inputmode="numeric" placeholder="Ihre Schätzung"></label>
        <label>Ihr interner Stundensatz (€)<input id="roiH" type="number" min="0" step="5" inputmode="decimal" placeholder="z. B. 80"></label></div>
      <div id="roiOut" class="roi-res" aria-live="polite"></div></details>
    <details class="pt-card tf-more"><summary><h2>Branche &amp; rechtliche Grundlagen</h2></summary>
      <div class="tf-sub"><h3>Ihre Branche</h3>
      <div class="br-lock"><span>Freigeschaltet: <strong>${esc(o.label)}</strong>${extras.length ? ` + ${extras.map((k) => esc(BRANCHEN[k]?.label || k)).join(', ')}` : ''}</span></div>
      <p class="form-note">Ihre Branche bestimmt Pakete und Software-Tools. Sie wurde bei der Kontoanfrage festgelegt; einen Wechsel nimmt der Support vor: <a href="mailto:support@leaserun.com?subject=Branchenwechsel%20Unternehmenskonto">support@leaserun.com</a>.</p>
      ${o.addon && o.others.length && me.tier && a.planSource === 'stripe' ? `<div class="br-add"><strong>Weitere Branche dazubuchen</strong><span class="form-note">${esc(o.addon.text)} – ${net(o.addon.monthCents)} netto pro Monat je Branche (bei Jahresabo ${net(o.addon.yearCents)} pro Jahr), anteilig ab heute.</span>
        <div>${o.others.map((x) => `<label><input type="radio" name="addBr" value="${x.key}"> ${esc(x.label)}</label>`).join('')}</div>
        <button class="btn btn-dark" type="button" id="addBrGo">Zahlungspflichtig dazubuchen</button></div>` : o.addon && o.others.length && me.tier ? '<p class="form-note">Weitere Branchen bucht der Support für Sie dazu (Kauf auf Rechnung).</p>' : ''}
      </div>
      <div class="tf-sub trust-card"><h3>Rechtliche Grundlagen</h3><ul class="trust-l">
      <li><b>AVV nach Art. 28 DSGVO</b><span>bei der Registrierung abgeschlossen, im Profil jederzeit abrufbar</span></li>
      <li><b>GoBD-gerechtes Rechnungsarchiv</b><span>Rechnungen unveränderbar gespeichert, SHA-256-geprüft</span></li>
      <li><b>Hosting in Frankfurt am Main</b><span>Anwendung (Vercel, Region fra1) und Datenbank (Supabase, eu-central-1) in der EU</span></li>
      <li><b>USt-IdNr. ${esc(a.taxId || '–')}</b><span id="vatSt">${/^[A-Z]{2}[0-9A-Z]{2,12}$/.test(String(a.taxId || '').replace(/\s+/g, '')) ? '<button type="button" class="text-btn" id="vatChk">Beim EU-System VIES prüfen</button>' : 'im Profil hinterlegen, um sie per VIES prüfen zu lassen'}</span></li></ul></div>
    </details>`;
  // Aktueller Abopreis (netto, aus dem Stripe-Abo) – nach dem Dazubuchen einer Branche sofort aktualisiert.
  const showPrice = (pr, fresh = false) => {
    const el = $('#tfPrice'); if (!el) return;
    if (!pr) { el.innerHTML = '<span class="form-note">Preis siehe „Abo verwalten“.</span>'; return; }
    const per = pr.interval === 'year' ? 'pro Jahr' : 'pro Monat';
    el.innerHTML = `<div class="tf-price-main${fresh ? ' tf-price-new' : ''}"><strong>${net(pr.netCents)}</strong> <small>netto ${per} · ${net(pr.grossCents)} brutto</small>${fresh ? ' <span class="st ok">aktualisiert</span>' : ''}</div>
      <ul class="tf-lines">${pr.lines.map((l) => `<li><span>${esc(l.label)}${l.qty > 1 ? ` × ${l.qty}` : ''}</span><b>${net(l.netCents)}</b></li>`).join('')}</ul>
      ${pr.nextAt ? `<p class="form-note">Nächste Abrechnung am ${dt(pr.nextAt)}${fresh ? ' – der Aufpreis für den laufenden Zeitraum wird anteilig berechnet' : ''}.</p>` : ''}`;
  };
  if ($('#tfPrice')) { if (known) showPrice(known, true); else api('/api/b2b/checkout').then((r) => showPrice(r.ok ? r.data.price : null)).catch(() => showPrice(null)); }
  box.querySelectorAll('#ivl button').forEach((b) => b.onclick = () => {
    box.querySelectorAll('#ivl button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    box.querySelectorAll('.offer[data-ivl]').forEach((o) => { o.hidden = o.dataset.ivl !== b.dataset.i; });
  });
  $('#terms').onchange = () => $('#termsL').classList.remove('consent-missing');
  // Zusatzbranchen: Preis jedes Pakets sofort mit Aufpreis anzeigen (netto, je Intervall).
  const extraPrice = () => {
    const k = box.querySelectorAll('[name=extraBr]:checked').length;
    box.querySelectorAll('.offer-price[data-base]').forEach((el) => {
      const base = +el.dataset.base, add = +el.dataset.add, tot = base + k * add;
      el.querySelector('.op-v').textContent = net(tot);
      el.classList.toggle('offer-price-up', k > 0);
      const x = el.nextElementSibling;
      if (x && x.classList.contains('offer-extra')) { x.hidden = !k; x.textContent = k ? `${net(base)} Paket + ${k} × ${net(add)} Zusatzbranche${k > 1 ? 'n' : ''} ${el.dataset.per}` : ''; }
    });
  };
  box.querySelectorAll('[name=extraBr]').forEach((c) => c.addEventListener('change', extraPrice));
  extraPrice();
  // ROI nur aus Eingaben des Beraters; verglichen mit dem Netto-Monatspreis der Tarife.
  const roi = () => {
    const n = Number($('#roiN').value) || 0, mi = Number($('#roiM').value) || 0, h = Number($('#roiH').value) || 0, o = $('#roiOut');
    if (!n || !mi || !h) { o.innerHTML = '<p class="form-note">Alle drei Werte eintragen – dann sehen Sie Ihren Gegenwert pro Monat.</p>'; return; }
    const val = (n * mi / 60) * h;
    const pl = (me.offer?.plans || []).map((p) => ({ name: p.name, netto_cents: p.monthCents }));
    o.innerHTML = `<p class="roi-big">Geschätzt eingesparte Arbeitszeit: <b>${(n * mi / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Stunden</b> pro Monat · monatlicher Gegenwert <b>${eur(Math.round(val * 100))}</b></p><p class="form-note">Schätzung mit Ihren Annahmen – keine garantierte Einsparung.</p>
      <ul class="roi-l">${pl.map((p) => `<li><span>${esc(p.name)}</span><b class="${val * 100 >= p.netto_cents ? 'ok' : 'warn'}">${val * 100 >= p.netto_cents ? 'rechnet sich' : 'rechnet sich noch nicht'}</b><small>${net(p.netto_cents)} netto / Monat</small></li>`).join('')}</ul>`;
  };
  ['#roiN', '#roiM', '#roiH'].forEach((id) => $(id).addEventListener('input', roi)); roi();
  $('#vatChk')?.addEventListener('click', (e) => busy(e.target, async () => {
    const r = await api('/api/b2b/vat-check', { method: 'POST' });
    const st = $('#vatSt');
    if (!r.ok || !r.data.checked) { st.textContent = r.data?.error || 'Prüfung nicht möglich.'; return; }
    st.innerHTML = r.data.valid ? `<span class="st ok">gültig laut VIES</span> ${esc(r.data.name || '')} · ${esc(new Date(r.data.at).toLocaleDateString('de-DE'))}` : '<span class="st bad">laut VIES ungültig</span> – bitte im Profil korrigieren';
  }));
  box.querySelectorAll('[data-plan]').forEach((b) => b.onclick = () => busy(b, async () => {
    if (!$('#terms').checked) { const l = $('#termsL'); l.classList.add('consent-missing'); l.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#terms').focus({ preventScroll: true }); throw Error('Bitte zuerst bestätigen, dass Sie als Unternehmer buchen.'); }
    try { window.iaTrack?.('checkout_start', { seg: 'b2b', plan: b.dataset.plan }); } catch { /* ignore */ }
    const extras = [...box.querySelectorAll('[name=extraBr]:checked')].map((x) => x.value);
    const r = await api('/api/b2b/checkout', { method: 'POST', body: JSON.stringify({ plan: b.dataset.plan, terms: true, embedded: true, ...(extras.length ? { extras } : {}) }) });
    if (!r.ok) throw Error(r.data?.error);
    // Eingebettete Bezahlung auf leaserun.com/kasse, sonst Stripe-Bezahlseite.
    if (r.data.clientSecret) { try { sessionStorage.setItem('lr-kasse', JSON.stringify({ ...r.data, at: Date.now() })); location.href = '/checkout'; return; } catch { /* weiter mit Fehler */ } }
    if (!r.data.url) throw Error('Bezahlseite konnte nicht geöffnet werden.');
    location.href = r.data.url;
  }));
  $('#addBrGo')?.addEventListener('click', (e) => busy(e.target, async () => {
    const k = box.querySelector('[name=addBr]:checked')?.value;
    if (!k) throw Error('Bitte eine Branche wählen.');
    if (!$('#terms').checked) { const l = $('#termsL'); l.classList.add('consent-missing'); l.scrollIntoView({ behavior: 'smooth', block: 'center' }); throw Error('Bitte zuerst bestätigen, dass Sie als Unternehmer buchen.'); }
    const r = await api('/api/b2b/checkout', { method: 'PATCH', body: JSON.stringify({ branche: k, terms: true }) });
    if (!r.ok) throw Error(r.data?.error);
    // Konto ohne Neuladen aktualisieren: Branchen, Angebot und neuer Abopreis sofort sichtbar.
    const fresh = await api('/api/b2b/account');
    if (fresh.ok && fresh.data?.account) me = fresh.data;
    toast(r.data.price ? `Branche dazugebucht – neuer Preis ${net(r.data.price.netCents)} netto ${r.data.price.interval === 'year' ? 'pro Jahr' : 'pro Monat'}.` : 'Branche dazugebucht – die Tools sind freigeschaltet.');
    await vTarif(box, r.data.price || null);
    $('#tfPrice')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  if ($('#aboPortal')) $('#aboPortal').onclick = (e) => busy(e.target, async () => {
    const r = await api('/api/b2b/checkout', { method: 'PUT' });
    if (!r.ok) throw Error(r.data?.error); location.href = r.data.url;
  });
  // Zahlungsmittel ändern auf leaserun.com/kasse (LeaseRun-Stil, Karte oder SEPA-Lastschrift).
  if ($('#aboPm')) $('#aboPm').onclick = (e) => busy(e.target, async () => {
    const r = await api('/api/b2b/checkout', { method: 'PUT', body: JSON.stringify({ flow: 'payment' }) });
    if (!r.ok) throw Error(r.data?.error);
    if (r.data.clientSecret) { sessionStorage.setItem('lr-kasse', JSON.stringify({ ...r.data, at: Date.now() })); location.href = '/checkout'; return; }
    location.href = r.data.url;
  });
  // Rückkehr: neues Zahlungsmittel als Standard für Abo und Rechnungen übernehmen.
  { const q = new URLSearchParams(location.search), sid = q.get('session_id');
    if (q.get('zahlungsmittel') === '1' && sid && $('#pmMsg')) {
      try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ignore */ }
      $('#pmMsg').textContent = 'Zahlungsmittel wird übernommen …';
      api('/api/b2b/checkout', { method: 'PUT', body: JSON.stringify({ confirm: sid }) }).then((r) => {
        $('#pmMsg').innerHTML = r.ok && r.data?.ok ? `<span class="st ok">Gespeichert</span> ${r.data.label ? `<strong>${esc(r.data.label)}</strong> ist` : 'Das neue Zahlungsmittel ist'} jetzt Standard für Ihr Abo und künftige Rechnungen.` : esc(r.data?.error || 'Das Zahlungsmittel konnte nicht übernommen werden.');
      }).catch(() => { $('#pmMsg').textContent = 'Keine Verbindung – bitte Seite neu laden.'; });
    } }
  box.querySelectorAll('[data-inv]').forEach((b) => b.onclick = () => busy(b, () => download('/api/b2b/invoices?id=' + b.dataset.inv, {}, 'Rechnung.pdf')));
}

// ---------- Registrierung ----------
async function onboarding(avvVersion) {
  const avv = await fetch('/api/b2b/avv').then((r) => r.json()).catch(() => null);
  const ref = new URLSearchParams(location.search).get('ref') || '';
  root.innerHTML = `<div class="pt-onb">
    <a class="pt-brand dark" href="/"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a>
    <h1>Unternehmenskonto anlegen</h1>
    <p>Für Makler, Finanzierungsvermittler und Kreditinstitute. Nach der Registrierung stehen Partnerseite, Widget, QR-Codes und Anfragen-Pipeline bereit, sobald ein Tarif aktiv ist.</p>
    <form id="reg" class="pt-card">
      <h2>1. Unternehmen</h2>
      <div class="obj-grid">
        <label>Firmenname*<input name="companyName" required minlength="2" maxlength="160" autocomplete="organization"></label>
        <label>Rechtsform*<select name="legalForm" required><option value="">Bitte wählen</option>${['Einzelunternehmen', 'e. K.', 'GbR', 'OHG', 'KG', 'GmbH', 'UG (haftungsbeschränkt)', 'GmbH & Co. KG', 'AG', 'eG', 'Anstalt des öffentlichen Rechts', 'Sonstige'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label>Art*<select name="institutionType" required>${Object.entries(TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Vermittler-Registernummer<input name="registerNumber" placeholder="D-W-123-ABCD-12" maxlength="60"></label>
        <label>USt-IdNr. oder Steuernummer<input name="taxId" placeholder="DE123456789" maxlength="40"></label>
      </div>
      <p class="form-note">Registernummer (§ 34c/§ 34i GewO, Vermittlerregister) oder Steuernummer/USt-IdNr.: mindestens eine Angabe ist Pflicht.</p>
      <h2>2. Ansprechpartner und Anschrift</h2>
      <div class="obj-grid">
        <label>Name*<input name="advisorName" required minlength="2" autocomplete="name"></label>
        <label>Telefon<input name="phone" autocomplete="tel"></label>
        <label>Straße und Nr.*<input name="street" required minlength="3" autocomplete="street-address"></label>
        <label>PLZ*<input name="postalCode" required pattern="[0-9]{5}" inputmode="numeric" autocomplete="postal-code"></label>
        <label>Ort*<input name="city" required autocomplete="address-level2"></label>
        <label>Partnercode (optional)<input name="partnerCode" maxlength="30"></label>
      </div>
      <p class="form-note">Konto-E-Mail: ${esc(session()?.user?.email || '')}</p>
      <h2>3. Verträge</h2>
      <details class="pt-avv"><summary>${esc(avv?.title || 'Auftragsverarbeitungsvertrag')} (Version ${esc(avvVersion)}) lesen</summary>
        ${(avv?.sections || []).map((s) => `<h3>${esc(s.h)}</h3>${s.p.map((p) => `<p>${esc(p)}</p>`).join('')}`).join('')}</details>
      <label class="consent"><input type="checkbox" name="richtig" required> Ich versichere, dass alle Angaben zum Unternehmen und zu meiner Person vollständig und richtig sind. Mir ist bekannt, dass LeaseRun das Konto bei falschen Angaben sperren kann.</label>
      <label class="consent"><input type="checkbox" name="unternehmer" required> Ich bestätige, dass ich als Unternehmer im Sinne des § 14 BGB handele. Mir ist bekannt, dass kein Widerrufsrecht besteht.</label>
      <label class="consent"><input type="checkbox" name="avv" required> Ich schließe für das Unternehmen den Auftragsverarbeitungsvertrag (Art. 28 DSGVO) in der oben angezeigten Fassung ab und bin dazu berechtigt.</label>
      <label class="consent"><input type="checkbox" name="agb" required> Ich habe die <a href="/terms#b2b" target="_blank">AGB für Unternehmen</a> und die <a href="/privacy" target="_blank">Datenschutzhinweise</a> gelesen.</label>
      <p class="form-note">Nach dem Absenden erhalten Sie einen schriftlichen Nachweis über alle Angaben und Erklärungen als PDF per E-Mail.</p>
      <button class="btn btn-dark" type="submit">Unternehmenskonto anlegen</button>
      <p class="form-note">LeaseRun ist ein technisches Analyse- und Vorbereitungsinstrument. Keine Kreditvermittlung, keine Kreditzusage, keine Steuer- oder Rechtsberatung.</p>
    </form></div>`;
  import('./address-check.mjs?v=892f3666').then((m) => m.attachAddress($('#reg'))).catch(() => {});
  $('#reg').onsubmit = (e) => {
    e.preventDefault();
    busy(e.target.querySelector('button[type=submit]'), async () => {
      const f = Object.fromEntries(new FormData(e.target));
      const body = { ...f, unternehmer: f.unternehmer === 'on', avv: f.avv === 'on', richtig: f.richtig === 'on', agb: f.agb === 'on', referral: ref };
      const { work } = await import('./loader.mjs?v=892f3666');
      const w = work('Unternehmenskonto wird angelegt', ['Angaben prüfen', 'Konto anlegen', 'Nachweis erstellen und senden']);
      await w.step(0);
      const pr = api('/api/b2b/account', { method: 'POST', body: JSON.stringify(body) });
      await w.step(1);
      const r = await pr;
      if (!r.ok) { w.close(); throw Error(r.data?.error || 'Registrierung fehlgeschlagen.'); }
      await w.step(2); await w.done('Konto angelegt');
      toast('Unternehmenskonto angelegt.');
      location.hash = '#start';
      await start();
    });
  };
}

// Portal ohne Anmeldung: „Anmelden“ (Zugangsdaten von LeaseRun) oder „Unternehmenskonto anfragen“.
function portalGate() {
  const tab = /request/.test(location.hash) ? 'anfrage' : 'login';
  // Interessenten ohne Zugang: Demo bzw. Unterlagen über das bestehende Anfrageformular auf /business (kein eigenes Formular).
  root.innerHTML = `<div class="pt-gate"><div class="pt-lead"><p><strong>Noch kein Zugang?</strong> Lernen Sie LeaseRun in einer kurzen Demo kennen.</p><p class="pt-lead-b"><a class="btn btn-dark" href="/business?anliegen=demo#anfrage" data-lead="demo">Demo anfragen</a><a class="ck-link" href="/business?betreff=unterlagen#anfrage" data-lead="unterlagen">Unterlagen per E-Mail anfordern</a></p></div><nav class="b2b-mbar" aria-label="Demo anfragen"><a class="btn b2b-mbar-go" href="/business?anliegen=demo#anfrage" data-lead="demo">Demo anfragen</a><a class="b2b-mbar-doc" href="/business?betreff=unterlagen#anfrage" data-lead="unterlagen">Unterlagen per E-Mail</a></nav><div class="seg area-seg pt-gate-tabs" role="tablist"><button type="button" role="tab" data-gt="login" aria-selected="${tab === 'login'}">Anmelden</button><button type="button" role="tab" data-gt="anfrage" aria-selected="${tab === 'anfrage'}">Zugang anfragen</button></div><div id="ptGate"></div></div>`;
  // Klickzählung (cookielos über track.js, nichts bei „Do Not Track“/GPC oder abgelehnter Statistik).
  root.querySelectorAll('a[data-lead]').forEach((a) => a.addEventListener('click', () => {
    try { if (localStorage.getItem('lr-ga') === 'no') return; } catch { /* ohne Speicher: wie track.js */ }
    try { window.iaTrack?.(a.dataset.lead === 'unterlagen' ? 'b2b_unterlagen_klick' : 'b2b_demo_klick', { seg: 'b2b' }); } catch { /* nie stören */ }
  }));
  root.querySelectorAll('[data-gt]').forEach((b) => b.onclick = () => { history.replaceState(null, '', location.pathname + (b.dataset.gt === 'anfrage' ? '#anfrage' : '')); portalGate(); });
  const box = $('#ptGate');
  if (tab === 'login') {
    loginForm(box, { title: 'Unternehmensportal', lead: 'Melden Sie sich an, um Ihre Fälle und Kunden zu verwalten.', noteHtml: 'Noch kein Zugang? <a class="ck-link" href="#anfrage" id="toReq">Unternehmenskonto anfragen</a>', onUnknown: (v) => { history.replaceState(null, '', location.pathname + '#anfrage'); portalGate(); const f = root.querySelector('#reqF [name=email]'); if (f) f.value = v; } });
    box.querySelector('.area-login')?.insertAdjacentHTML('beforeend', '<p class="pt-sec-note"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Verschlüsselte Verbindung, Datenhaltung in Frankfurt. Ihre Fälle sind strikt von anderen Unternehmen getrennt. <a href="/security">Sicherheit</a> · <a href="/business#demo">Demo ohne Anmeldung</a></span></p>');
    box.querySelector('#toReq')?.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', location.pathname + '#anfrage'); portalGate(); });
    return;
  }
  const ts = Date.now();
  box.innerHTML = `<div class="pt-card pt-req"><h1>Unternehmenskonto anfragen</h1><p class="form-note">Für Finanzierungsvermittler, Makler, Banken und Kanzleien. Wir prüfen Ihre Angaben und senden Ihnen die Zugangsdaten innerhalb von zwei Werktagen.</p>
    <form id="reqF" class="b2b-form">
      <label>Unternehmen*<input name="company" required minlength="2" autocomplete="organization"></label>
      <label>Art des Unternehmens<select name="institutionType"><option value="BROKER">Finanzierungsvermittler (§ 34i GewO)</option><option value="REALTOR">Immobilienmakler (§ 34c GewO)</option><option value="BANK">Kreditinstitut</option><option value="OTHER">Sonstiges Unternehmen</option></select></label>
      <label>Ansprechpartner*<input name="name" required minlength="2" autocomplete="name"></label>
      <label>Geschäftliche E-Mail*<input name="email" type="email" required autocomplete="email"></label>
      <label>Telefon<input name="phone" autocomplete="tel"></label>
      <label>Ort<input name="city" autocomplete="address-level2" maxlength="80"></label>
      <fieldset class="b2b-proof full" data-konto><legend>Angaben zu Ihrem Unternehmen</legend><p class="form-note">Zugänge erhalten ausschließlich Unternehmen. Bei eingetragenen Gesellschaften genügt die Registernummer; Einzelunternehmen und Freiberufler laden bitte einen Nachweis hoch.</p><label>Rechtsform*<select name="legalForm" required><option value="" selected disabled>Bitte wählen</option><optgroup label="Im Handels- oder Partnerschaftsregister"><option data-hr="1">GmbH</option><option data-hr="1">UG (haftungsbeschränkt)</option><option data-hr="1">AG</option><option data-hr="1">KG</option><option data-hr="1">GmbH & Co. KG</option><option data-hr="1">OHG</option><option data-hr="1">e. K. (eingetragener Kaufmann)</option><option data-hr="1">PartG / PartG mbB</option><option data-hr="1">eG</option><option data-hr="1">SE</option></optgroup><optgroup label="Ohne Registereintrag"><option>Einzelunternehmen</option><option>Freiberufler</option><option>GbR</option><option>Sonstige Rechtsform</option></optgroup></select></label><label data-hr-only hidden>Handelsregisternummer*<input name="registerNumber" maxlength="60" placeholder="z. B. HRB 12345, Amtsgericht Darmstadt"></label><label data-nohr-only hidden>Steuernummer oder USt-IdNr.*<input name="taxId" maxlength="40"></label><div class="b2b-proof-up full" data-nohr-only hidden><label>Art des Nachweises*<select name="proofKind"><option value="gewerbe">Gewerbeanmeldung</option><option value="erlaubnis">Erlaubnis § 34c / § 34i GewO</option><option value="sonstiges">Sonstiger Nachweis (z. B. Bescheinigung des Finanzamts)</option></select></label><label>Datei (PDF, JPG oder PNG, max. 4 MB)*<input name="proof" type="file" accept="application/pdf,image/jpeg,image/png"></label><p class="form-note">Der Nachweis wird nur zur Prüfung verwendet und nach der Entscheidung gelöscht (spätestens nach 180 Tagen).</p></div></fieldset>
      <label class="full">Nachricht (optional)<textarea name="message" rows="3" maxlength="2000" placeholder="z. B. Anzahl Berater, gewünschter Starttermin"></textarea></label>
      <div class="pp-hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
      <label class="consent full"><input type="checkbox" name="privacy" required> Ich habe die <a class="ck-link" href="/privacy" target="_blank" rel="noopener">Datenschutzhinweise</a> gelesen. Die Angaben werden nur zur Bearbeitung der Anfrage gespeichert.</label>
      <div class="full"><button class="btn btn-dark btn-lg" type="submit">Anfrage senden</button></div>
      <p class="form-note full" id="reqMsg" role="status"></p></form></div>`;
  $('#reqF [name=legalForm]').addEventListener('change', () => syncLegal($('#reqF'))); syncLegal($('#reqF'));
  $('#reqF').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), d = Object.fromEntries(fd);
    const pf = fd.get('proof');
    if (pf && pf.size > 4 * 1024 * 1024) { $('#reqMsg').textContent = 'Der Nachweis ist größer als 4 MB. Bitte verkleinern oder als PDF speichern.'; return; }
    fd.set('kind', 'konto'); fd.set('ts', String(ts));
    busy(e.target.querySelector('button[type=submit]'), async () => {
      const r = await fetch('/api/b2b/contact', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error || 'Anfrage konnte nicht gesendet werden.');
      box.innerHTML = `<div class="pt-card pt-req"><h1>Danke – Ihre Anfrage ist eingegangen</h1><p>Wir prüfen Ihre Angaben und senden die Zugangsdaten an <strong>${esc(d.email)}</strong>, in der Regel innerhalb von zwei Werktagen.</p><p><button class="btn btn-outline" type="button" id="backLogin">Zur Anmeldung</button></p></div>`;
      $('#backLogin').onclick = () => { history.replaceState(null, '', location.pathname); portalGate(); };
    });
  };
}

// Login ohne Unternehmenskonto: Zugänge vergibt LeaseRun nach Anfrage.
function noAccount() {
  root.innerHTML = `<div class="pt-onb"><h1>Kein Unternehmenskonto</h1><p>Mit dieser Anmeldung ist kein Unternehmenskonto verbunden. Zugänge zum Unternehmensportal vergibt LeaseRun nach einer kurzen Anfrage.</p>
    <p class="pt-row"><button class="btn btn-dark" type="button" id="ptReq">Unternehmenskonto anfragen</button><a class="btn btn-outline" href="/app/dashboard">Zum Privatbereich</a><button class="btn btn-outline" type="button" id="ptOther">Mit anderen Zugangsdaten anmelden</button></p>
    <p class="form-note">Sie sind bereits angemeldet – Privatbereich und Unternehmensportal nutzen dieselbe Anmeldung.</p></div>`;
  $('#ptOther').onclick = () => { setSession(null); location.reload(); };
  $('#ptReq').onclick = () => { setSession(null); location.replace(location.pathname + '#anfrage'); location.reload(); };
}

// Erste Anmeldung: eigenes Passwort festlegen; Inhaber bestätigt § 14 BGB, AVV und Nutzungsbedingungen.
function firstLogin(d) {
  const owner = d.role === 'owner', cons = d.onboarding?.consentsMissing;
  root.innerHTML = `<div class="pt-onb pt-first"><span class="stage-k">Willkommen bei LeaseRun</span><h1>Ersteinrichtung für ${esc(d.account.companyName)}</h1>
    <p class="form-note">Kundennummer ${esc(d.account.customerNumber || '')}. Bitte legen Sie ein eigenes Passwort fest${owner && cons ? ' und bestätigen Sie die Vertragsgrundlagen' : ''}. Danach ist das Portal freigeschaltet.</p>
    <form id="firstF" class="pt-first-f">
      <label>Neues Passwort<input id="np1" type="password" autocomplete="new-password" minlength="10" required></label>
      <label>Neues Passwort wiederholen<input id="np2" type="password" autocomplete="new-password" minlength="10" required></label>
      <p class="form-note" id="npHint">Mindestens 10 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl.</p>
      ${owner && cons ? `<label class="consent"><input type="checkbox" name="unternehmer" required> Ich bestätige, dass das Unternehmen als Unternehmer im Sinne des § 14 BGB handelt. Mir ist bekannt, dass kein Widerrufsrecht besteht.</label>
      <label class="consent"><input type="checkbox" name="avv" required> Ich schließe für das Unternehmen den Auftragsverarbeitungsvertrag (Art. 28 DSGVO, Version ${esc(d.avvVersion)}) ab und bin dazu berechtigt.</label>
      <details class="pt-avv" id="avvBox"><summary>Auftragsverarbeitungsvertrag lesen</summary><div id="avvTxt"><p class="lr-ld" role="status">Wird geladen …</p></div></details>
      <label class="consent"><input type="checkbox" name="agb" required> Ich habe die <a class="ck-link" href="/terms#b2b" target="_blank" rel="noopener">AGB für Unternehmen</a> und die <a class="ck-link" href="/privacy" target="_blank" rel="noopener">Datenschutzhinweise</a> gelesen.</label>` : ''}
      <p class="auth-message error" id="firstMsg" hidden></p>
      <button class="btn btn-dark btn-lg" type="submit">Speichern und Portal öffnen</button></form></div>`;
  $('#avvBox')?.addEventListener('toggle', async (e) => {
    if (!e.target.open || e.target.dataset.ready) return; e.target.dataset.ready = '1';
    const a = await fetch('/api/b2b/avv').then((r) => r.json()).catch(() => null);
    $('#avvTxt').innerHTML = a ? (a.sections || []).map((x) => `<h3>${esc(x.h)}</h3>${x.p.map((t) => `<p>${esc(t)}</p>`).join('')}`).join('') : '<p class="form-note">Text konnte nicht geladen werden.</p>';
  });
  $('#firstF').onsubmit = (e) => {
    e.preventDefault();
    const m = $('#firstMsg'), p1 = $('#np1').value, p2 = $('#np2').value;
    const err = (t) => { m.textContent = t; m.hidden = false; };
    if (p1 !== p2) return err('Die beiden Passwörter stimmen nicht überein.');
    if (p1.length < 10 || !/[A-Z]/.test(p1) || !/[a-z]/.test(p1) || !/[0-9]/.test(p1)) return err('Bitte mindestens 10 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl.');
    busy(e.target.querySelector('button[type=submit]'), async () => {
      const f = Object.fromEntries(new FormData(e.target));
      const c = await changePassword(p1);
      if (c) return err(c);
      const x = await api('/api/b2b/onboard', { method: 'POST', body: JSON.stringify({ passwordChanged: true, unternehmer: f.unternehmer === 'on', avv: f.avv === 'on', agb: f.agb === 'on' }) });
      if (!x.ok) return err(x.data?.error || 'Speichern fehlgeschlagen.');
      toast('Passwort gespeichert – willkommen im Portal.');
      location.hash = '#start'; await start();
    });
  };
}

// Passwort über Supabase ändern (angemeldete Sitzung). Liefert eine Fehlermeldung oder null.
async function changePassword(pw) {
  const { supa, token } = await import('./sess.mjs?v=892f3666');
  const r = await supa('/auth/v1/user', { method: 'PUT', headers: { Authorization: 'Bearer ' + token() }, body: JSON.stringify({ password: pw }) }).catch(() => null);
  if (!r) return 'Keine Verbindung. Bitte erneut versuchen.';
  if (r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const t = String(j.msg || j.error_description || j.message || '');
  if (/same|different/i.test(t)) return 'Bitte ein anderes Passwort als das Startpasswort wählen.';
  if (/weak|short|pwned|leaked/i.test(t)) return 'Dieses Passwort ist zu schwach oder bekannt geworden. Bitte ein anderes wählen.';
  if (/reauth/i.test(t)) return 'Bitte melden Sie sich neu an und versuchen Sie es erneut.';
  return 'Passwort konnte nicht geändert werden.';
}

async function acceptInvite(tok) {
  const r = await api('/api/b2b/team', { method: 'PUT', body: JSON.stringify({ token: tok }) });
  history.replaceState(null, '', location.pathname + '#start');
  if (!r.ok) { root.innerHTML = `<div class="pt-onb"><h1>Einladung</h1><p>${esc(r.data?.error || 'Fehler')}</p><p><button class="btn btn-dark" type="button" id="ptOtherLogin">Mit anderer Adresse anmelden</button></p></div>`; root.querySelector('#ptOtherLogin').onclick = () => { setSession(null); location.reload(); }; return false; }
  toast('Sie sind dem Team beigetreten.');
  return true;
}

async function start() {
  // Rückkehr aus der Bestätigungs-E-Mail (Supabase-Standardversand): Sitzung aus dem Link übernehmen.
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('access_token')) { setSession({ access_token: hp.get('access_token'), refresh_token: hp.get('refresh_token'), expires_in: Number(hp.get('expires_in')) || 3600, token_type: 'bearer' }); history.replaceState(null, '', location.pathname + '#start'); }
  if (!session()?.access_token) {
    portalGate();
    return;
  }
  const inv = /einladung=([A-Za-z0-9_-]{20,80})/.exec(location.hash);
  if (inv && !(await acceptInvite(inv[1]))) return;
  const r = await api('/api/b2b/account');
  if (r.status === 401) { setSession(null); return start(); }
  if (!r.ok) { root.innerHTML = `<div class="pt-onb"><h1>Unternehmensportal</h1><p>${esc(r.data?.error || 'Nicht verfügbar.')}</p></div>`; return; }
  if (!r.data.account) { noAccount(); return; }
  if (r.data.onboarding?.mustChange || r.data.onboarding?.consentsMissing) { firstLogin(r.data); return; }
  me = r.data;
  const askBranche = false;
  if (new URLSearchParams(location.search).get('checkout') === 'success') toast('Danke! Der Tarif wird aktiviert, sobald die Zahlung bestätigt ist.');
  shell();
  tileWatch();
  route();
  if (askBranche) chooseBranche(true);
}

window.addEventListener('hashchange', () => { if (me) route(); });
// Erneutes Tippen auf den aktiven Bereich: zurück nach oben.
document.addEventListener('click', (e) => { const a = e.target.closest?.('a[data-v]'); if (a && a.getAttribute('href') === (location.hash || '#start')) window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
root.addEventListener('click', (e) => { if (e.target.closest('[data-brsw]')) chooseBranche(); if (e.target.closest('[data-reload]')) location.reload(); const off = e.target.closest('[data-ctx-off]'); if (off) { try { sessionStorage.removeItem('lr-ctx'); } catch { /* ignore */ } off.closest('.bw-ctx')?.remove(); } });
root.addEventListener('submit', async (e) => {
  if (e.target.id !== 'brandF') return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  d.brandColor2 = String(d.brandColor2 || '').toUpperCase();
  const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify(d) });
  if (r.ok) { Object.assign(me.account, d); toast('Erscheinungsbild gespeichert.'); } else toast(r.data?.error || 'Speichern fehlgeschlagen.', true);
});

// Branche: festgelegt am Konto. Ansicht nur zwischen gebuchten Branchen umschalten; weitere Branchen über „Tarif“.
function chooseBranche() {
  let d = document.getElementById('brDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'brDlg'; d.className = 'wa-dlg br-dlg'; document.body.append(d); }
  const own = myBranches(), cur = br();
  const tile = (k) => { const x = BRANCHEN[k]; return `<button type="button" class="br-opt${k === cur ? ' on' : ''}" data-pick="${k}" role="radio" aria-checked="${k === cur}">
      <span class="br-opt-h"><span class="br-opt-i" aria-hidden="true">${x.icon}</span><span><strong>${esc(x.label)}</strong><small>${esc(x.desc)}</small></span>${k === cur ? '<em>Aktiv</em>' : ''}</span></button>`; };
  d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>Ihre Branche</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
    <p class="form-note">Ihr Unternehmenskonto ist für ${own.map((k) => `<strong>${esc(BRANCHEN[k].label)}</strong>`).join(' und ')} freigeschaltet. Pakete und Software-Tools richten sich danach. Einen Branchenwechsel nimmt der Support vor (<a href="mailto:support@leaserun.com?subject=Branchenwechsel">support@leaserun.com</a>).</p>
    ${own.length > 1 ? `<div class="br-opts" role="radiogroup" aria-label="Ansicht">${own.map(tile).join('')}</div>` : ''}
    <div class="br-foot"><a class="btn btn-outline" href="#tarif" data-x>Weitere Branche dazubuchen</a>${own.length > 1 ? '<button type="button" class="btn btn-dark" id="brOk">Ansicht übernehmen</button>' : ''}</div></div>`;
  let pick = cur;
  d.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', () => d.close()));
  d.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { pick = b.dataset.pick; d.querySelectorAll('[data-pick]').forEach((x) => { const on = x.dataset.pick === pick; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); });
  d.querySelector('#brOk')?.addEventListener('click', () => {
    try { localStorage.setItem('lr-b2b-view', pick); } catch { /* ohne Speicher */ }
    d.close(); shell(); tileWatch(); route(); toast(`Ansicht: ${BRANCHEN[pick].label}`);
  });
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}
start();

// Kontoanfrage: eingetragene Gesellschaften → Registernummer genügt; sonst Steuernummer und Nachweis (Datei) Pflicht.
function syncLegal(f) {
  const sel = f.querySelector('[name=legalForm]'); if (!sel) return;
  const on = !f.querySelector('[data-konto]')?.disabled;
  const hr = sel.selectedOptions[0]?.dataset.hr === '1', chosen = Boolean(sel.value);
  f.querySelectorAll('[data-hr-only]').forEach((x) => { x.hidden = !(chosen && hr); });
  f.querySelectorAll('[data-nohr-only]').forEach((x) => { x.hidden = !(chosen && !hr); });
  const req = (n, v) => { const i = f.querySelector(`[name=${n}]`); if (i) i.required = on && v; };
  req('registerNumber', chosen && hr); req('taxId', chosen && !hr); req('proof', chosen && !hr);
}
