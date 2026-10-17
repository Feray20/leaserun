// Unternehmensportal (/b2b-portal): Registrierung mit § 14 BGB und AVV, Anfragen-Pipeline,
// Widget- und QR-Studio, Team, Profil mit Co-Branding, Tarif und Rechnungen.
import { BRANCHEN, BRANCHE_KEYS, brancheFromType } from './b2b-branche.mjs';
import { api, download, dt, dtt, esc, eur, loginForm, logout, session, setSession } from './sess.mjs';

const root = document.getElementById('portal');
const $ = (s, el = document) => el.querySelector(s);
const VIEWS = [
  ['start', 'Übersicht'], ['fall', 'Fall-Analyse'], ['tools', 'Software-Tools'], ['kunden', 'Kunden'], ['anfragen', 'Anfragen'], ['einreichungen', 'Einreichungen'], ['wissen', 'Praxis-Toolkit'], ['werkzeuge', 'Widget & QR'], ['verifizierung', 'Verifizierung'], ['team', 'Team'], ['profil', 'Profil'], ['tarif', 'Tarif & Rechnungen'],
];
// Handy-Leiste: vier Hauptbereiche plus „Mehr“ (alle übrigen Bereiche als Liste).
const MAIN = [
  ['start', 'Start', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
  ['fall', 'Analyse', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><circle cx="12" cy="14" r="2.6"/><path d="M14 16l2.5 2.5"/>'],
  ['kunden', 'Kunden', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.5 2.6 3.5 6"/>'],
  ['anfragen', 'Anfragen', '<path d="M4 5h16v11H8l-4 4z"/>'],
];
const TYPE = { BANK: 'Kreditinstitut', BROKER: 'Finanzierungsvermittler (§ 34i GewO)', REALTOR: 'Immobilienmakler (§ 34c GewO)', OTHER: 'Sonstiges Unternehmen' };
const TIER = { BASIC: 'Makler & Vermittler Basic', PRO: 'Kanzlei & Baufi Pro', ENTERPRISE: 'Bank & Filiale Enterprise' };
const STATUS = { neu: 'Neu', in_bearbeitung: 'In Bearbeitung', abgeschlossen: 'Abgeschlossen', abgelehnt: 'Abgelehnt' };
const LAENDER = ['baden-wuerttemberg', 'bayern', 'berlin', 'brandenburg', 'bremen', 'hamburg', 'hessen', 'mecklenburg-vorpommern', 'niedersachsen', 'nordrhein-westfalen', 'rheinland-pfalz', 'saarland', 'sachsen', 'sachsen-anhalt', 'schleswig-holstein', 'thueringen'];
const landName = (l) => l.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-').replace('Wuerttemberg', 'Württemberg').replace('Thueringen', 'Thüringen');

let me = null;
// Branchen-Ansicht des angemeldeten Beraters (gespeichert in seinen Kontodaten, jederzeit wechselbar).
const br = () => BRANCHEN[me?.branche] ? me.branche : brancheFromType(me?.account?.institutionType);
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
function shell() {
  const a = me.account;
  root.innerHTML = `<div class="pt">
    <aside class="pt-side"><a class="pt-brand" href="/"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a>
      <small class="pt-tag">Unternehmensportal</small>
      <nav>${VIEWS.filter(([v]) => me.role === 'owner' || !['tarif', 'profil'].includes(v)).map(([v, l]) => `<a href="#${v}" data-v="${v}">${vLabel(v, l)}${v === 'anfragen' && me.usage.leadsNew ? ` <b class="pt-dot">${me.usage.leadsNew}</b>` : ''}</a>`).join('')}</nav>
      <div class="pt-foot"><strong>${esc(a.companyName)}</strong><small>${esc(a.customerNumber)} · ${me.role === 'owner' ? 'Inhaber' : 'Berater'}</small><a href="/app/dashboard">Zur Anwendung</a><button type="button" class="pt-logout" id="ptLogout">Abmelden</button></div>
    </aside>
    <section class="pt-main"><header class="pt-top"><h1 id="ptTitle"></h1><button type="button" class="pt-br" id="ptBr" title="Branche wechseln – das Portal passt sich an"><span aria-hidden="true">${B().icon}</span> ${esc(B().short)} <b aria-hidden="true">⇄</b></button><button type="button" class="pt-logout pt-logout-m" id="ptLogoutM">Abmelden</button>${a.status === 'locked' ? '<span class="st bad">Gesperrt</span>' : me.tier ? `<span class="st ok">${TIER[me.tier]}</span>` : '<span class="st warn">Kein Tarif</span>'}</header>
      ${a.status === 'locked' ? `<div class="pt-alert bad"><strong>Konto gesperrt.</strong> ${esc(a.lockReason || '')} Rechnungen und AVV bleiben abrufbar. Fragen an support@immoadv.de.</div>` : ''}
      <div id="ptView"></div><p class="pt-liab">ImmoAdv stellt rein technische Analyse- und Erfassungsinstrumente bereit und trifft keine Votierungs-, Bonitäts- oder Kreditentscheidung. Die aufsichtsrechtliche Pflicht zur Prüfung nach MaRisk, KWG oder § 34i GewO verbleibt vollumfänglich beim beratenden bzw. finanzierenden Institut. <a href="/nutzungsbedingungen#hinweise">Rechtliche Hinweise</a> · <a href="/datenschutz">Datenschutz</a></p></section>
    <nav class="pt-tabs" aria-label="Bereiche">${MAIN.map(([v, l, ic]) => `<a href="#${v}" data-v="${v}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span>${v === 'kunden' ? B().kunden : l}</span>${v === 'anfragen' && me.usage.leadsNew ? `<b class="pt-dot">${me.usage.leadsNew}</b>` : ''}</a>`).join('')}<button type="button" id="ptMore" aria-expanded="false" aria-controls="ptSheet"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg><span>Mehr</span></button></nav>
    <div class="pt-sheet" id="ptSheet" hidden><div class="pt-sheet-bg" data-close></div><div class="pt-sheet-in" role="dialog" aria-label="Alle Bereiche"><div class="pt-sheet-h"><span class="pt-sheet-t"><strong>Hauptmenü</strong>${(a.companyName || '').trim().length >= 3 ? `<small>${esc(a.companyName)}</small>` : ''}</span><button type="button" class="stage-x" data-close aria-label="Schließen">×</button></div>
      <nav>${VIEWS.filter(([v]) => !MAIN.some(([m]) => m === v) && (me.role === 'owner' || !['tarif', 'profil'].includes(v))).map(([v, l]) => `<a href="#${v}" data-v="${v}">${l}</a>`).join('')}<a href="/app/dashboard">Zur Anwendung</a><button type="button" class="pt-logout" id="ptLogoutS">Abmelden</button></nav></div></div>
  </div>`;
  root.querySelectorAll('#ptLogout,#ptLogoutM,#ptLogoutS').forEach((b) => { b.onclick = async () => { try { (await import('./b2b-tools.mjs')).clearAll(); } catch { /* weiter */ } logout(); }; });
  $('#ptBr').onclick = () => chooseBranche();
  const sheet = $('#ptSheet'), more = $('#ptMore');
  const openSheet = (on) => { sheet.hidden = !on; more.setAttribute('aria-expanded', String(on)); document.body.classList.toggle('pt-sheet-open', on); };
  more.onclick = () => openSheet(sheet.hidden);
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.closest('a')) openSheet(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) openSheet(false); });
}

function route() {
  const v = (location.hash.slice(1).split('=')[0] || 'start');
  const view = VIEWS.find(([k]) => k === v) ? v : 'start';
  document.querySelectorAll('[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === view));
  $('#ptMore')?.classList.toggle('on', !MAIN.some(([m]) => m === view));
  $('#ptTitle').textContent = vLabel(view, VIEWS.find(([k]) => k === view)[1]);
  const box = $('#ptView');
  box.innerHTML = '<p class="form-note">Wird geladen …</p>';
  ({ start: vStart, tools: (b) => import('./b2b-tools.mjs').then((m) => m.renderPrograms(b, { tier: me.tier, branche: br(), toast, brand: { color: me.limits?.cobranding && me.account.brandColor ? me.account.brandColor : '#0F2C59', logo: me.limits?.cobranding && me.account.hasLogo && me.account.slug ? `/api/b2b/logo?slug=${encodeURIComponent(me.account.slug)}` : '', sender: [me.account.companyName, me.account.advisorName].filter(Boolean).join(' · ') } })).catch(() => { b.innerHTML = '<p class="form-note">Programme konnten nicht geladen werden.</p>'; }), fall: (b) => import('./b2b-fall.mjs').then((m) => m.renderFall(b, { api, toast, me })).catch(() => { b.innerHTML = '<p class="form-note">Fall-Analyse konnte nicht geladen werden.</p>'; }), kunden: vKunden, wissen: (b) => import('./b2b-wissen.mjs').then((m) => m.renderWissen(b, br())).catch(() => { b.innerHTML = '<p class="form-note">Fachwissen konnte nicht geladen werden.</p>'; }), verifizierung: vVerify, anfragen: vLeads, einreichungen: vSubs, werkzeuge: vTools, team: (b) => vTeam(b).then(() => addPw(b)), profil: (b) => { vProfil(b); addPw(b); }, tarif: vTarif })[view](box);
}

// ---------- Kunden: einladen und Fortschritt sehen (nur mit Einwilligung des Kunden) ----------
const PH = ['Orientieren', 'Objekte prüfen', 'Bankgespräch', 'Bestand'];
let KD_LAST = null; // zuletzt erstellte Einladung (Link bleibt nach dem Neuladen sichtbar)
const kdLinkHtml = (x) => `<div class="pt-alert ok"><strong>${x.mailed ? 'Einladung per E-Mail gesendet.' : 'Einladung erstellt.'}</strong> ${x.mailed ? 'Zusätzlich können Sie den Link selbst weitergeben:' : 'Bitte den Link an Ihren Kunden senden (E-Mail-Versand ist noch nicht eingerichtet):'}<div class="pt-row kd-copy"><input readonly value="${esc(x.link)}" aria-label="Einladungslink"><button type="button" class="btn btn-outline" id="kdCopy">Kopieren</button></div><small>Gültig 14 Tage, nur einmal verwendbar.</small></div>`;
async function vKunden(box) {
  const r = await api('/api/b2b/clients');
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  const all = r.data.clients || [];
  const con = all.filter((c) => c.status === 'verbunden').sort((a, b) => (b.progress?.best ?? -1) - (a.progress?.best ?? -1));
  const inv = all.filter((c) => c.status === 'eingeladen');
  const ready = con.filter((c) => (c.progress?.best ?? 0) >= 90).length;
  const card = (c) => {
    const p = c.progress || {}, best = p.best ?? 0;
    return `<article class="kd-card"><div class="kd-top"><strong>${esc(c.name || c.email || 'Kunde')}</strong>${best >= 90 ? '<span class="st ok">bankreif</span>' : best >= 60 ? '<span class="st warn">fast</span>' : '<span class="st">in Vorbereitung</span>'}</div>
      ${c.name && c.email ? `<small class="kd-mail">${esc(c.email)}</small>` : ''}
      <div class="kd-bar" role="img" aria-label="Bankreife ${best} %"><span style="width:${Math.max(2, Math.min(100, best))}%"></span></div>
      <dl class="kd-dl"><div><dt>Bankreife</dt><dd>${p.best == null ? '–' : best + ' %'}</dd></div><div><dt>Stufe</dt><dd>${p.stage ? `${p.stage} · ${PH[p.stage - 1]}` : '–'}</dd></div><div><dt>Objekte</dt><dd>${p.objects ?? '–'}</dd></div><div><dt>Unterlagen</dt><dd>${p.docs ?? '–'}</dd></div><div><dt>Finanzprofil</dt><dd>${p.profile == null ? '–' : p.profile ? 'ausgefüllt' : 'offen'}</dd></div><div><dt>Zuletzt aktiv</dt><dd>${p.lastActive ? dt(p.lastActive) : '–'}</dd></div></dl>
      ${p.missing && p.missing.length ? `<div class="kd-miss"><strong>Fehlt noch:</strong> ${p.missing.map(esc).join(' · ')}</div>` : p.missing ? '<div class="kd-miss ok">Alle Unterlagen-Arten vorhanden.</div>' : ''}
      <div class="kd-btns"><button type="button" class="btn btn-dark" data-kd-req="${esc(c.id)}"${c.lastRequestAt && Date.now() - new Date(c.lastRequestAt).getTime() < 864e5 ? ' disabled title="Heute bereits erinnert"' : ''}>Unterlagen anfordern</button><button type="button" class="btn btn-outline" data-kd-pdf="${esc(c.id)}">Kurzbericht (PDF)</button></div>
      ${c.lastRequestAt ? `<small class="kd-last">Zuletzt erinnert: ${dtt(c.lastRequestAt)}</small>` : ''}
      <div class="kd-act"><small>verbunden seit ${c.since ? dt(c.since) : '–'}</small><button type="button" class="btn btn-ghost" data-kd-end="${esc(c.id)}">Trennen</button></div></article>`;
  };
  // Bestandskunden-Radar: Kunden, deren Zinsbindung in den nächsten 36 Monaten endet (nur mit Radar-Einwilligung, ab Pro).
  const mon = (ym) => { const [y, m] = ym.split('-').map(Number); const n = new Date(); return (y - n.getFullYear()) * 12 + (m - 1 - n.getMonth()); };
  const radarRows = con.flatMap((c) => (Array.isArray(c.radar) ? c.radar : []).map((ym) => ({ c, ym, m: mon(ym) }))).filter((x) => x.m >= -1 && x.m <= 36).sort((a, b) => a.m - b.m);
  const radarAsked = con.filter((c) => c.radar).length;
  const radar = `<section class="pt-card kd-radar"><div class="kd-head"><h2>Bestandskunden-Radar</h2><span class="form-note">${radarAsked} von ${con.length} Kunden teilen ihr Zinsbindungsende</span></div><p class="form-note">Automatische Erinnerung: Am 1. jedes Monats bekommen Sie eine E-Mail, sobald bei einem Kunden die Zinsbindung in 36, 24, 12, 6 oder 3 Monaten endet.</p>
    ${!r.data.radarOn ? '<p class="form-note">Der Radar meldet Ihnen, wenn bei Ihren Kunden die Zinsbindung in 36, 24 oder 12 Monaten endet – Ihre Anschlussfinanzierungen von morgen. Enthalten ab <a href="#tarif">Kanzlei & Baufi Pro</a>.</p>'
      : radarRows.length ? `<ul class="kd-rlist">${radarRows.map((x) => `<li class="${x.m <= 12 ? 'hot' : x.m <= 24 ? 'warm' : ''}"><span><strong>${esc(x.c.name || x.c.email || 'Kunde')}</strong><small>Zinsbindung endet ${x.ym.split('-').reverse().join('/')}</small></span><b>${x.m < 0 ? 'abgelaufen' : x.m === 0 ? 'diesen Monat' : `in ${x.m} Monat${x.m === 1 ? '' : 'en'}`}</b>${x.m <= 60 ? '<em>Forward möglich</em>' : ''}</li>`).join('')}</ul>`
      : '<p class="form-note">Aktuell endet bei keinem Ihrer Kunden die Zinsbindung in den nächsten 36 Monaten.</p>'}
    <p class="form-note">Kunden schalten das Teilen von Monat und Jahr des Zinsbindungsendes in ihrem Konto selbst frei (eigene Einwilligung, jederzeit widerrufbar) – ohne Beträge oder Bankdaten.</p></section>`;
  box.innerHTML = radar + `<section class="pt-card"><h2>Kunde einladen</h2>
      <p class="form-note">Ihr Kunde bereitet Finanzprofil, Objekt und Unterlagen in ImmoAdv vor – kostenlos. Stimmt er zu, sehen Sie hier seinen Fortschritt: Stufe, Bankreife, Anzahl Objekte und Unterlagen. Dokumente und Inhalte sehen Sie nicht; der Kunde kann die Verbindung jederzeit trennen.</p>
      <form class="pt-row kd-form" id="kdF"><input id="kdMail" type="email" required placeholder="E-Mail des Kunden" aria-label="E-Mail des Kunden" autocomplete="off"><input id="kdName" type="text" placeholder="Name (optional)" aria-label="Name (optional)" maxlength="120"><button class="btn btn-dark" type="submit">Einladen</button><label class="chk kd-consent"><input type="checkbox" id="kdOk" required> Ich bestätige, dass mir die Einwilligung des Kunden für die Zusendung dieser Einladung vorliegt (Art. 6 Abs. 1 lit. a/b DSGVO).</label></form>
      <div id="kdLink">${KD_LAST ? kdLinkHtml(KD_LAST) : ''}</div></section>
    <section class="pt-card"><div class="kd-head"><h2>Ihre Kunden</h2><span class="form-note">${con.length} verbunden · ${ready} bankreif · ${inv.length} Einladung${inv.length === 1 ? '' : 'en'} offen</span></div>
      ${con.length ? `<p class="form-note">Sortiert nach Bankreife – die abschlussreifen Fälle stehen oben.</p><div class="kd-list">${con.map(card).join('')}</div>` : '<p class="form-note">Noch keine verbundenen Kunden. Laden Sie Ihren ersten Kunden oben ein.</p>'}
      ${inv.length ? `<h3 class="kd-sub">Offene Einladungen</h3><ul class="kd-inv">${inv.map((c) => `<li><span><strong>${esc(c.name || c.email)}</strong><small>${c.name ? esc(c.email) + ' · ' : ''}gültig bis ${dt(c.expiresAt)}</small></span><button type="button" class="btn btn-ghost" data-kd-end="${esc(c.id)}">Zurückziehen</button></li>`).join('')}</ul>` : ''}</section>`;
  $('#kdF').onsubmit = (e) => { e.preventDefault(); const b = e.target.querySelector('button'); busy(b, async () => {
    const x = await api('/api/b2b/clients', { method: 'POST', body: JSON.stringify({ email: $('#kdMail').value.trim(), name: $('#kdName').value.trim() || undefined, consent: $('#kdOk').checked }) });
    if (!x.ok) throw Error(x.data?.error || 'Einladung fehlgeschlagen.');
    KD_LAST = x.data;
    await vKunden(box);
  }); };
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
  box.querySelectorAll('[data-kd-pdf]').forEach((b) => b.onclick = () => busy(b, async () => { await download('/api/b2b/clients/report?id=' + encodeURIComponent(b.dataset.kdPdf), {}, 'ImmoAdv-Kurzbericht.pdf'); }));
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

// Muster-Fall (fiktiv) statt leerer Kacheln: zeigt, wie ein fertig geprüfter Fall aussieht.
const MUSTER_DOCS = [['Personalausweis', 1], ['Selbstauskunft', 1], ['Gehaltsabrechnungen (3 Monate)', 1], ['Arbeitsvertrag', 1], ['Einkommensteuerbescheid', 1], ['Eigenkapitalnachweis', 1], ['Kontoauszüge (3 Monate)', 1], ['Exposé', 1], ['Grundrisse und Wohnfläche', 1], ['Energieausweis', 1], ['Teilungserklärung', 1], ['Protokolle Eigentümerversammlung', 1], ['Wirtschaftsplan und Hausgeldabrechnung', 1], ['Mietvertrag', 1], ['Grundbuchauszug (nicht älter als 3 Monate)', 0]];
const MUSTER = `<section class="pt-card pt-muster"><div class="pt-muster-h"><div><span class="st">Beispiel · fiktiver Fall</span><h2>Muster-Fall: Familie Beispiel, vermietete ETW</h2><p class="form-note">So sieht ein Fall aus, wenn Ihr Kunde seine Unterlagen über ImmoAdv vorbereitet hat. Alle Daten sind erfunden.</p></div><a class="btn btn-outline btn-sm" href="#fall">Eigenen Fall prüfen</a></div>
  <div class="pt-kpis"><div class="pt-kpi"><small>Kapitaldienstdeckung (DSCR)</small><strong>1,24</strong><span class="form-note">Nettomiete 1.551 € ÷ Rate 1.251 €</span></div><div class="pt-kpi"><small>Haushaltsüberschuss</small><strong>1.180 €</strong><span class="form-note">nach Rate und Lebenshaltung</span></div><div class="pt-kpi"><small>Unterlagen</small><strong>14 von 15</strong><span class="form-note">fehlt: Grundbuchauszug</span></div><div class="pt-kpi"><small>Beleihungsauslauf</small><strong>88 %</strong><span class="form-note">Darlehen 268.000 € · BLW 304.000 €</span></div></div>
  <details class="pt-muster-d"><summary>Unterlagen und Rechenweg ansehen</summary><ul class="pt-check">${MUSTER_DOCS.map(([t, ok]) => `<li class="${ok ? 'done' : ''}"><span>${t}${ok ? '' : ' – <strong>fehlt</strong>'}</span></li>`).join('')}</ul>
  <p class="form-note">Kaufpreis 320.000 € · Kaltmiete 1.700 € · nicht umlagefähig 149 € · Darlehen 268.000 € zu 3,60 % Soll und 2,00 % Tilgung = Rate 1.250,67 €. DSCR = (1.700 − 149) ÷ 1.250,67 = 1,24. Haushalt: Netto 4.950 € + Miete 1.700 € − Lebenshaltung 2.150 € − Warmmiete eigene Wohnung 1.220 € − nicht umlagefähige Kosten 149 € − Rate 1.251 € − Versicherungen/Sonstiges 700 € = 1.180 €.</p></details></section>`;

function vStart(box) {
  const a = me.account, u = me.usage, lim = me.limits;
  const quota = lim ? (lim.dossiersPerMonth == null ? 'unbegrenzt' : `${u.dossiersThisMonth} von ${lim.dossiersPerMonth + (a.dossierBonus || 0)}`) : '–';
  const steps = [
    [Boolean(a.avvAcceptedAt), 'AVV abgeschlossen', '#profil'],
    [Boolean(me.tier), 'Tarif gebucht', '#tarif'],
    [Boolean(a.hasLogo || a.brandColor), 'Logo oder Farbe hinterlegt', '#profil'],
    [Boolean(a.bookingUrl), 'Terminlink eingetragen', '#profil'],
    [u.leadsNew > 0 || false, 'Widget oder QR-Code im Einsatz', '#werkzeuge'],
  ];
  box.innerHTML = `${a.verified ? '' : `<div class="pt-alert warn"><strong>Ihr Konto ist noch nicht freigeschaltet.</strong> Bitte laden Sie Ihre Gewerbeanmeldung oder einen Handelsregisterauszug hoch und reichen Sie ihn ein. Nach unserer Prüfung schalten wir Partnerseite, Widget, Anfragen, Kreditmappen und Tarife frei. <a class="btn btn-dark" href="#verifizierung">Zur Verifizierung</a></div>`}
    <section class="pt-card pt-focus"><div class="pt-focus-h"><span aria-hidden="true">${B().icon}</span><div><small>Ihre Ansicht</small><strong>${esc(B().label)}</strong></div><button type="button" class="btn btn-outline btn-sm" data-brsw>Branche wechseln</button></div>
      <div class="pt-focus-g">${B().focus.map(([t, x, h]) => `<a href="${h}"><strong>${esc(t)}</strong><span>${esc(x)}</span></a>`).join('')}</div></section>
    <div class="pt-kpis">
      <div class="pt-kpi"><small>Neue Anfragen</small><strong>${u.leadsNew}</strong><a href="#anfragen">Ansehen</a></div>
      <div class="pt-kpi"><small>Kreditmappen diesen Monat</small><strong>${quota}</strong><a href="/app/dashboard#objekte">Erstellen</a></div>
      <div class="pt-kpi"><small>Berater-Zugänge</small><strong>${u.seats} / ${lim ? lim.seats : 1}</strong><a href="#team">Team</a></div>
      <div class="pt-kpi"><small>Status</small><strong>${a.verified ? 'Geprüft' : 'Ungeprüft'}</strong><span class="form-note">${a.verified ? 'Angaben vom Betreiber geprüft' : 'Prüfung durch den Betreiber steht aus'}</span></div>
    </div>
    <div class="pt-grid2">
      <section class="pt-card"><h2>Einrichtung</h2><ul class="pt-check">${steps.map(([ok, t, h]) => `<li class="${ok ? 'done' : ''}"><a href="${h}">${t}</a></li>`).join('')}</ul></section>
      <section class="pt-card"><h2>So arbeiten Sie mit ImmoAdv</h2><ol class="pt-ol">
        <li><strong>Fall anlegen:</strong> In der <a href="/app/dashboard#objekte">Anwendung</a> Objekt und Finanzierung erfassen, Unterlagen hochladen.</li>
        <li><strong>Kreditmappe erstellen:</strong> Kennzahlen nach banküblichen Kriterien (Kapitaldienstfähigkeit, Beleihungsauslauf, Cashflow) mit Echtheits-QR${me.limits?.cobranding ? ' und Ihrem Logo' : ''}.</li>
        <li><strong>Anfragen gewinnen:</strong> Widget auf Ihrer Website, QR-Code im Exposé oder Ihre <a href="#werkzeuge">Partnerseite</a>.</li></ol>
        <p class="form-note">Rechnerische Orientierungswerte nach einem strukturierten Datenmodell. Keine Kreditzusage und keine Bonitätsentscheidung; die Entscheidung trifft das finanzierende Institut.</p></section>
    </div>${u.leadsNew > 0 ? '' : MUSTER}<section class="pt-card" id="stats30"></section>`;
  startStats($('#stats30'));
}

// ---------- Verifizierung (Gewerbenachweis) ----------
const VKIND = { gewerbe: 'Gewerbeanmeldung', handelsregister: 'Handelsregisterauszug', erlaubnis: 'Erlaubnis § 34c / § 34i GewO', sonstiges: 'Sonstiger Nachweis' };
async function vVerify(box) {
  const r = await api('/api/b2b/verification');
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const v = r.data, locked = v.verified || v.status === 'eingereicht', owner = v.isOwner;
  const stat = { offen: ['warn', 'Noch nicht eingereicht'], eingereicht: ['warn', 'Eingereicht – wird geprüft'], geprueft: ['ok', 'Geprüft und freigeschaltet'], abgelehnt: ['bad', 'Bitte Unterlagen ergänzen'] }[v.status] || ['warn', v.status];
  box.innerHTML = `<section class="pt-card"><h2>Unternehmen verifizieren</h2>
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
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const leads = r.data.leads;
  const members = t.ok ? t.data.members : [];
  const self = members.find((m) => m.self)?.user_id;
  const who = (id) => members.find((m) => m.user_id === id)?.email || '';
  const assignSel = (l) => members.length > 1 || me.role === 'owner'
    ? `<label class="form-note">Zuständig <select data-as="${l.id}"><option value="">– niemand –</option>${members.filter((m) => me.role === 'owner' || m.self || m.user_id === l.assigned_to).map((m) => `<option value="${m.user_id}"${m.user_id === l.assigned_to ? ' selected' : ''}>${esc(m.email)}${m.self ? ' (Sie)' : ''}</option>`).join('')}</select></label>` : '';
  const n = (v) => (v == null || v === '' ? '–' : Number(v).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €');
  box.innerHTML = `<div class="pt-bar"><div class="seg" role="tablist">${['alle', ...Object.keys(STATUS)].map((s, i) => `<button type="button" data-f="${s}" aria-selected="${i === 0}">${s === 'alle' ? 'Alle' : STATUS[s]}</button>`).join('')}<button type="button" data-f="mine" aria-selected="false">Mir zugewiesen</button></div>
    <button class="btn btn-ghost" id="csv" type="button">CSV exportieren</button></div>
    ${leads.length ? '' : '<div class="pt-empty"><strong>Noch keine Anfragen.</strong><p>Binden Sie das <a href="#werkzeuge">Widget</a> ein oder teilen Sie Ihre Partnerseite. Jede Anfrage erscheint hier mit Objektdaten und Kennzahlen.</p></div>'}
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
  $('#csv').onclick = (e) => busy(e.target, () => download('/api/b2b/leads?format=csv', {}, 'ImmoAdv_Anfragen.csv'));
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
        <button class="btn btn-ghost" data-sv="${s.id}" type="button">Status und Antwort senden</button></article>`).join('') : '<div class="pt-empty">Noch keine Einreichungen.</div>'}</section>` : ''}
    <section class="pt-card"><h2>Kreditmappe bei einem Institut einreichen</h2>
      ${!me.tier ? '<p class="form-note">Einreichungen gibt es ab einem gebuchten Tarif.</p>' : !targets.length ? '<p class="form-note">Derzeit nimmt noch kein Institut über ImmoAdv Einreichungen an.</p>' : !versions.length ? '<p class="form-note">Sie haben noch keine registrierte Kreditmappe. Erstellen Sie eine in der <a href="/app/dashboard#objekte">Anwendung</a>.</p>' : `
      <form id="subF" class="obj-grid">
        <label>Kreditmappe<select name="versionId" required>${versions.map((x) => `<option value="${x.id}">${esc(x.object_ref)} · Version ${x.version_no} · ${dt(x.created_at)}</option>`).join('')}</select></label>
        <label>Institut<select name="targetId" required>${targets.map((x) => `<option value="${x.id}">${esc(x.name)} · ${esc(x.city)}${x.verified ? ' ✓' : ''}</option>`).join('')}</select></label>
        <label>Bezeichnung (optional)<input name="label" maxlength="160" placeholder="z. B. ETW Darmstadt, Familie M."></label>
        <label>Hinweis an das Institut<input name="note" maxlength="1000"></label>
      </form>
      <label class="consent"><input type="checkbox" id="subC"> Die Einwilligung meines Kunden zur Weitergabe dieser Kreditmappe an das gewählte Institut liegt mir vor.</label>
      <button class="btn btn-dark" id="subGo" type="button">Einreichen</button>`}
      <p class="form-note">Das Institut erhält die registrierte Kreditmappe (mit Echtheits-QR) und kann Status und Rückfragen setzen. Die Kreditentscheidung trifft allein das Institut.</p></section>
    <section class="pt-card"><h2>Ihre Einreichungen</h2>${outbox.length ? `<table class="bill-table"><thead><tr><th>Objekt</th><th>Institut</th><th>Datum</th><th>Status</th><th>Antwort</th></tr></thead><tbody>${outbox.map((s) => `<tr><td>${esc(s.object_label)}</td><td>${esc(s.to)}</td><td>${dt(s.created_at)}</td><td>${SUB[s.status]}</td><td>${esc(s.reply || '–')}</td></tr>`).join('')}</tbody></table>` : '<p class="form-note">Noch keine.</p>'}</section>`;
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
  const snippet = `<script src="${location.origin}/widget.js" data-immoadv="${esc(a.slug)}" async></script>`;
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
      <p class="form-note">Datenschutz: Nehmen Sie ImmoAdv als Auftragsverarbeiter in Ihre Datenschutzerklärung auf. Jede Anfrage enthält eine Einwilligung mit Ihrem Firmennamen als Empfänger (Zeitpunkt und Wortlaut werden gespeichert).</p></section>
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
  import('./expose-check.mjs').then((m) => m.mountExposeCheck($('#ecBox'), { account: { ...a, brandColor: me.limits?.cobranding ? a.brandColor : '' }, logoUrl: me.limits?.cobranding && a.hasLogo && a.slug ? `/api/b2b/logo?slug=${encodeURIComponent(a.slug)}` : '' })).catch(() => { $('#ecBox').innerHTML = '<p class="form-note">Exposé-AutoPilot konnte nicht geladen werden.</p>'; });
}

// Zugangsdaten einmalig anzeigen (Startpasswort muss bei der ersten Anmeldung geändert werden).
const credBox = (email, pw, mailed) => `<div class="pt-alert ok cred"><strong>Zugang angelegt${mailed ? ' und per E-Mail gesendet' : ''}.</strong> Diese Daten werden nur jetzt angezeigt:
  <dl class="cred-dl"><div><dt>Portal</dt><dd>partner.immoadv.de</dd></div><div><dt>Benutzername</dt><dd>${esc(email)}</dd></div><div><dt>Startpasswort</dt><dd><code>${esc(pw)}</code></dd></div></dl>
  <button type="button" class="btn btn-outline cred-copy" data-copy="${esc(`Portal: https://partner.immoadv.de\nBenutzername: ${email}\nStartpasswort: ${pw}`)}">Zugangsdaten kopieren</button>
  <small>Bei der ersten Anmeldung wird ein eigenes Passwort festgelegt. Bitte nur auf sicherem Weg weitergeben.</small></div>`;
document.addEventListener('click', async (e) => { const b = e.target.closest?.('.cred-copy'); if (!b) return; try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Kopiert ✓'; } catch { toast('Bitte markieren und kopieren.', true); } });

// ---------- Team ----------
async function vTeam(box) {
  const r = await api('/api/b2b/team');
  if (!r.ok) { box.innerHTML = `<p class="form-note">${esc(r.data?.error)}</p>`; return; }
  const { members, invites, seats } = r.data;
  box.innerHTML = `<section class="pt-card"><h2>Berater-Zugänge (${members.length + invites.length} von ${seats})</h2>
    <table class="bill-table"><thead><tr><th>E-Mail</th><th>Rolle</th><th>Seit</th><th></th></tr></thead><tbody>
    ${members.map((m) => `<tr><td>${esc(m.email)}${m.self ? ' (Sie)' : ''}</td><td>${m.role === 'owner' ? 'Inhaber' : 'Berater'}</td><td>${dt(m.created_at)}</td><td>${me.role === 'owner' && m.role !== 'owner' ? `<button class="text-btn del" data-m="${m.user_id}" type="button">Entfernen</button>` : ''}</td></tr>`).join('')}
    ${invites.map((i) => `<tr><td>${esc(i.email)}</td><td>Eingeladen</td><td>bis ${dt(i.expires_at)}</td><td><button class="text-btn del" data-i="${i.id}" type="button">Zurückziehen</button></td></tr>`).join('')}
    </tbody></table>
    ${me.role === 'owner' ? `<form id="inv" class="pt-row" style="margin-top:14px"><input type="email" required placeholder="kollegin@kanzlei.de" id="invMail" aria-label="E-Mail"><label class="chk inv-send"><input type="checkbox" id="invSend"> per E-Mail senden</label><button class="btn btn-dark" type="submit">Zugang anlegen</button></form><div id="invOut"></div>` : ''}
    <p class="form-note">Sie legen den Zugang an und erhalten ein Startpasswort; der Berater legt bei der ersten Anmeldung ein eigenes Passwort fest. Sie sehen die Anfragen und erstellen Kreditmappen im Kontingent des Unternehmens; Tarif, Profil und Rechnungen verwaltet nur der Inhaber.</p></section>`;
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

// ---------- Profil ----------
function vProfil(box) {
  const a = me.account;
  const brand = me.limits?.cobranding || a.hasWhitelabel;
  box.innerHTML = `<form class="pt-card" id="prof"><h2>Stammdaten</h2>
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
      ${brand ? `<p class="form-note">Ihr Logo erscheint im Kopf jeder Kreditmappe und auf Partnerseite und Widget. ImmoAdv bleibt dezent als „Strukturiert mit ImmoAdv-Software“ mit Prüf-QR sichtbar.</p>
      <div class="pt-row"><div class="pt-logo">${a.hasLogo && a.slug ? `<img src="/api/b2b/logo?slug=${esc(a.slug)}&t=${Date.now()}" alt="Ihr Logo">` : '<span class="form-note">Kein Logo</span>'}</div>
      <label class="btn btn-ghost">Logo hochladen (PNG/JPG, max. 1 MB)<input type="file" id="logo" accept="image/png,image/jpeg" hidden></label>
      ${a.hasLogo ? '<button class="text-btn del" id="logoDel" type="button">Entfernen</button>' : ''}</div>
      <label class="pt-field">Markenfarbe<input type="color" id="color" value="${esc(a.brandColor || '#0F2C59')}"></label>` : '<p class="form-note">Co-Branding (eigenes Logo und Farbe) ist ab Tarif Kanzlei & Baufi Pro enthalten.</p>'}
    </section>
    <section class="pt-card"><h2>Erscheinungsbild Ihrer Unterlagen</h2>
      <p class="form-note">Für Fall-Analysen und Kunden-Präsentationen. <strong>Ab Pro:</strong> eigenes Logo, Farben und Schrift, ImmoAdv nur als kleiner Hinweis. <strong>Enterprise / White-Label:</strong> komplett im Erscheinungsbild Ihres Hauses – mit Ihrem Absender und Ihrer Fußzeile, ohne ImmoAdv.</p>
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
    ${a.institutionType === 'BANK' ? `<section class="pt-card"><h2>Postkorb für Einreichungen</h2><p class="form-note">Vermittler mit ImmoAdv-Konto können Ihrem Institut registrierte Kreditmappen zur Vorprüfung einreichen. Sie setzen Status und Rückfragen im Reiter Einreichungen.</p>
      <label class="pt-switch"><input type="checkbox" id="accSub"${a.acceptSubmissions ? ' checked' : ''}> Einreichungen annehmen und im Verzeichnis erscheinen</label></section>` : ''}
    ${me.tier === 'ENTERPRISE' || a.hasWhitelabel ? `<section class="pt-card"><h2>Eigener Hinweistext</h2><p class="form-note">Erscheint auf Ihrer Partnerseite, im Widget und in der Finanzierungsübersicht für Interessenten (z. B. Compliance-Hinweis Ihres Instituts). Max. 600 Zeichen.</p>
      <textarea id="discl" rows="3" maxlength="600" style="width:100%;border:1px solid #CBD5E1;border-radius:6px;padding:8px">${esc(a.customDisclaimer || '')}</textarea><button class="btn btn-ghost" id="disclSave" type="button">Speichern</button></section>` : ''}
    <section class="pt-card"><h2>Aufbewahrung der Anfragen</h2><p class="form-note">Anfragen werden nach dieser Frist automatisch gelöscht (Speicherbegrenzung, Art. 5 DSGVO). Legen Sie die Frist passend zu Ihren eigenen Pflichten fest.</p>
      <label class="pt-field">Löschen nach<select id="ret">${[1, 6, 12, 24, 36, 60, 120].map((m) => `<option value="${m}"${(a.leadRetentionMonths || 24) === m ? ' selected' : ''}>${m === 1 ? '30 Tagen' : m + ' Monaten'}</option>`).join('')}</select></label></section>
    ${me.limits?.cobranding ? `<section class="pt-card"><h2>Webhook für Ihr CRM</h2><p class="form-note">Bei jeder neuen Anfrage senden wir sie als JSON per POST an Ihre Adresse (https). Prüfen Sie die Signatur: Header <code>X-ImmoAdv-Signature</code> = <code>sha256=</code> HMAC-SHA256 mit dem Geheimnis über <code>Zeitstempel.Body</code> (Header <code>X-ImmoAdv-Timestamp</code>).</p>
      <label class="pt-field">Adresse<input id="whUrl" value="${esc(a.webhookUrl || '')}" placeholder="https://crm.example.de/hooks/immoadv"></label>
      ${a.webhookSecret ? `<p class="form-note">Geheimnis: <code>${esc(a.webhookSecret)}</code> <button class="text-btn" id="whRot" type="button">Neu erzeugen</button></p>` : ''}
      <div class="pt-row"><button class="btn btn-ghost" id="whSave" type="button">Speichern</button>${a.webhookUrl ? '<button class="btn btn-ghost" id="whTest" type="button">Test senden</button>' : ''}</div><div id="whLog"></div></section>` : ''}
    <section class="pt-card"><h2>Support-Zugriff</h2>
      <p class="form-note">Für Rückfragen kann der ImmoAdv-Support Ihr Portal 7 Tage lang <strong>nur lesend</strong> einsehen, einschließlich der Anfragen. Ohne Ihre Freigabe ist das nicht möglich; jeder Zugriff wird protokolliert (Weisung nach Art. 28 DSGVO).</p>
      <p>${a.supportAccessUntil && new Date(a.supportAccessUntil) > new Date() ? `Freigegeben bis ${dtt(a.supportAccessUntil)}. <button class="text-btn del" id="supOff" type="button">Jetzt beenden</button>` : '<button class="btn btn-ghost" id="supOn" type="button">Support-Zugriff für 7 Tage freigeben</button>'}</p></section>`;
  $('#prof').onsubmit = (e) => { e.preventDefault(); busy(e.submitter || $('#prof button'), async () => {
    const f = Object.fromEntries(new FormData(e.target));
    const body = { advisorName: f.advisorName, phone: f.phone, street: f.street, postalCode: f.postalCode, city: f.city, bookingUrl: f.bookingUrl, slug: f.slug };
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

// ---------- Tarif & Rechnungen ----------
async function vTarif(box) {
  if (!prices) prices = await fetch('/data/preise.json').then((r) => r.json());
  const b2b = prices.b2b;
  const a = me.account;
  const [cfg, inv] = await Promise.all([fetch('/api/billing/config').then((r) => r.json()).catch(() => ({})), api('/api/b2b/invoices')]);
  const billingOn = Boolean(cfg.enabled ?? cfg.billingEnabled);
  const net = (c) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
  const tiers = ['BASIC', 'PRO'];
  box.innerHTML = `
    <section class="pt-card"><h2>Aktueller Tarif</h2>
      <p><strong>${me.tier ? TIER[me.tier] : 'Kein Tarif gebucht'}</strong>${a.planSource === 'manual' ? ' (vom Betreiber freigeschaltet)' : ''}${a.planUntil ? ` · läuft bis ${dt(a.planUntil)}` : ''}</p>
      ${a.planSource === 'stripe' ? '<button class="btn btn-ghost" id="aboPortal" type="button">Abo verwalten (Zahlungsmittel, Wechsel, Kündigung)</button>' : ''}</section>
    <div class="seg" role="tablist" id="ivl"><button type="button" data-i="month" aria-selected="true">Monatlich</button><button type="button" data-i="year" aria-selected="false">Jährlich (2 Monate gespart)</button></div>
    <div class="offers">${tiers.map((t) => b2b.plans.filter((p) => p.tier === t).map((p) => `<div class="offer${t === 'PRO' ? ' rec' : ''}" data-ivl="${p.interval}"${p.interval === 'year' ? ' hidden' : ''}>${t === 'PRO' ? '<span class="offer-rec">Am häufigsten gewählt</span>' : ''}
        <h4>${esc(p.name.replace(' (Jahr)', ''))}</h4><div class="offer-price">${net(p.netto_cents)} <small>netto ${esc(p.intervall)}</small></div>
        <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${me.tier === t ? '<span class="st ok">Gebucht</span>' : `<button class="btn btn-pay" data-plan="${p.id}" type="button"${billingOn ? '' : ' disabled'}>${billingOn ? 'Weiter zur Bezahlung' : 'Buchung startet in Kürze'}</button>`}</div>`).join('')).join('')}
      <div class="offer"><h4>${esc(b2b.enterprise.name)}</h4><div class="offer-price">${esc(b2b.enterprise.preis)}</div><ul>${b2b.enterprise.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn btn-ghost" href="/b2b#kontakt">Angebot anfragen</a></div>
    </div>
    <label class="consent"><input type="checkbox" id="terms"> Ich buche als Unternehmer (§ 14 BGB) zu den <a href="/nutzungsbedingungen#b2b" target="_blank">Nutzungsbedingungen für Unternehmen</a>. Preise netto zzgl. 19 % USt. Ein Widerrufsrecht besteht nicht.</label>
    ${billingOn ? '' : '<p class="form-note">Online-Buchung ist noch nicht freigeschaltet. Für einen Testzugang oder Kauf auf Rechnung: support@immoadv.de.</p>'}
    <section class="pt-card"><h2>Rechnungen</h2>${inv.ok && inv.data.invoices.length ? `<table class="bill-table"><thead><tr><th>Nummer</th><th>Datum</th><th>Brutto</th><th>Status</th><th></th></tr></thead><tbody>
      ${inv.data.invoices.map((i) => `<tr><td>${esc(i.invoice_number)}${i.kind !== 'invoice' ? ' (Storno)' : ''}</td><td>${dt(i.issue_date)}</td><td>${eur(i.gross_cents)}</td><td>${{ PAID: 'bezahlt', PENDING: 'offen', OVERDUE: 'überfällig', CANCELLED: 'storniert' }[i.payment_status]}</td><td><button class="text-btn" data-inv="${i.id}" type="button">PDF</button></td></tr>`).join('')}</tbody></table>` : '<p class="form-note">Noch keine Rechnungen.</p>'}</section>`;
  box.querySelectorAll('#ivl button').forEach((b) => b.onclick = () => {
    box.querySelectorAll('#ivl button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    box.querySelectorAll('.offer[data-ivl]').forEach((o) => { o.hidden = o.dataset.ivl !== b.dataset.i; });
  });
  box.querySelectorAll('[data-plan]').forEach((b) => b.onclick = () => busy(b, async () => {
    if (!$('#terms').checked) throw Error('Bitte die Unternehmer-Bestätigung ankreuzen.');
    try { window.iaTrack?.('checkout_start', { seg: 'b2b', plan: b.dataset.plan }); } catch { /* ignore */ }
    const r = await api('/api/b2b/checkout', { method: 'POST', body: JSON.stringify({ plan: b.dataset.plan, terms: true }) });
    if (!r.ok) throw Error(r.data?.error);
    location.href = r.data.url;
  }));
  if ($('#aboPortal')) $('#aboPortal').onclick = (e) => busy(e.target, async () => {
    const r = await api('/api/b2b/checkout', { method: 'PUT' });
    if (!r.ok) throw Error(r.data?.error); location.href = r.data.url;
  });
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
      <label class="consent"><input type="checkbox" name="richtig" required> Ich versichere, dass alle Angaben zum Unternehmen und zu meiner Person vollständig und richtig sind. Mir ist bekannt, dass ImmoAdv das Konto bei falschen Angaben sperren kann.</label>
      <label class="consent"><input type="checkbox" name="unternehmer" required> Ich bestätige, dass ich als Unternehmer im Sinne des § 14 BGB handele. Mir ist bekannt, dass kein Widerrufsrecht besteht.</label>
      <label class="consent"><input type="checkbox" name="avv" required> Ich schließe für das Unternehmen den Auftragsverarbeitungsvertrag (Art. 28 DSGVO) in der oben angezeigten Fassung ab und bin dazu berechtigt.</label>
      <label class="consent"><input type="checkbox" name="agb" required> Ich habe die <a href="/nutzungsbedingungen#b2b" target="_blank">Nutzungsbedingungen für Unternehmen</a> und die <a href="/datenschutz" target="_blank">Datenschutzhinweise</a> gelesen.</label>
      <p class="form-note">Nach dem Absenden erhalten Sie einen schriftlichen Nachweis über alle Angaben und Erklärungen als PDF per E-Mail.</p>
      <button class="btn btn-dark" type="submit">Unternehmenskonto anlegen</button>
      <p class="form-note">ImmoAdv ist ein technisches Analyse- und Vorbereitungsinstrument. Keine Kreditvermittlung, keine Kreditzusage, keine Steuer- oder Rechtsberatung.</p>
    </form></div>`;
  $('#reg').onsubmit = (e) => {
    e.preventDefault();
    busy(e.target.querySelector('button[type=submit]'), async () => {
      const f = Object.fromEntries(new FormData(e.target));
      const body = { ...f, unternehmer: f.unternehmer === 'on', avv: f.avv === 'on', richtig: f.richtig === 'on', agb: f.agb === 'on', referral: ref };
      const { work } = await import('./loader.mjs');
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

// Portal ohne Anmeldung: „Anmelden“ (Zugangsdaten von ImmoAdv) oder „Unternehmenskonto anfragen“.
function portalGate() {
  const tab = /anfrage/.test(location.hash) ? 'anfrage' : 'login';
  root.innerHTML = `<div class="pt-gate"><div class="seg area-seg pt-gate-tabs" role="tablist"><button type="button" role="tab" data-gt="login" aria-selected="${tab === 'login'}">Anmelden</button><button type="button" role="tab" data-gt="anfrage" aria-selected="${tab === 'anfrage'}">Unternehmenskonto anfragen</button></div><div id="ptGate"></div></div>`;
  root.querySelectorAll('[data-gt]').forEach((b) => b.onclick = () => { history.replaceState(null, '', location.pathname + (b.dataset.gt === 'anfrage' ? '#anfrage' : '')); portalGate(); });
  const box = $('#ptGate');
  if (tab === 'login') {
    loginForm(box, { title: 'Unternehmensportal', lead: 'Anmeldung mit den Zugangsdaten, die Sie von ImmoAdv erhalten haben.', noteHtml: 'Noch kein Zugang? <a class="ck-link" href="#anfrage" id="toReq">Unternehmenskonto anfragen</a>' });
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
      <label class="consent full"><input type="checkbox" name="privacy" required> Ich habe die <a class="ck-link" href="/datenschutz" target="_blank" rel="noopener">Datenschutzhinweise</a> gelesen. Die Angaben werden nur zur Bearbeitung der Anfrage gespeichert.</label>
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

// Login ohne Unternehmenskonto: Zugänge vergibt ImmoAdv nach Anfrage.
function noAccount() {
  root.innerHTML = `<div class="pt-onb"><h1>Kein Unternehmenskonto</h1><p>Mit dieser Anmeldung ist kein Unternehmenskonto verbunden. Zugänge zum Unternehmensportal vergibt ImmoAdv nach einer kurzen Anfrage.</p>
    <p class="pt-row"><button class="btn btn-dark" type="button" id="ptReq">Unternehmenskonto anfragen</button><button class="btn btn-outline" type="button" id="ptOther">Mit anderen Zugangsdaten anmelden</button></p></div>`;
  $('#ptOther').onclick = () => { setSession(null); location.reload(); };
  $('#ptReq').onclick = () => { setSession(null); location.replace(location.pathname + '#anfrage'); location.reload(); };
}

// Erste Anmeldung: eigenes Passwort festlegen; Inhaber bestätigt § 14 BGB, AVV und Nutzungsbedingungen.
function firstLogin(d) {
  const owner = d.role === 'owner', cons = d.onboarding?.consentsMissing;
  root.innerHTML = `<div class="pt-onb pt-first"><span class="stage-k">Willkommen bei ImmoAdv</span><h1>Ersteinrichtung für ${esc(d.account.companyName)}</h1>
    <p class="form-note">Kundennummer ${esc(d.account.customerNumber || '')}. Bitte legen Sie ein eigenes Passwort fest${owner && cons ? ' und bestätigen Sie die Vertragsgrundlagen' : ''}. Danach ist das Portal freigeschaltet.</p>
    <form id="firstF" class="pt-first-f">
      <label>Neues Passwort<input id="np1" type="password" autocomplete="new-password" minlength="10" required></label>
      <label>Neues Passwort wiederholen<input id="np2" type="password" autocomplete="new-password" minlength="10" required></label>
      <p class="form-note" id="npHint">Mindestens 10 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl.</p>
      ${owner && cons ? `<label class="consent"><input type="checkbox" name="unternehmer" required> Ich bestätige, dass das Unternehmen als Unternehmer im Sinne des § 14 BGB handelt. Mir ist bekannt, dass kein Widerrufsrecht besteht.</label>
      <label class="consent"><input type="checkbox" name="avv" required> Ich schließe für das Unternehmen den Auftragsverarbeitungsvertrag (Art. 28 DSGVO, Version ${esc(d.avvVersion)}) ab und bin dazu berechtigt.</label>
      <details class="pt-avv" id="avvBox"><summary>Auftragsverarbeitungsvertrag lesen</summary><div id="avvTxt"><p class="form-note">Wird geladen …</p></div></details>
      <label class="consent"><input type="checkbox" name="agb" required> Ich habe die <a class="ck-link" href="/nutzungsbedingungen#b2b" target="_blank" rel="noopener">Nutzungsbedingungen für Unternehmen</a> und die <a class="ck-link" href="/datenschutz" target="_blank" rel="noopener">Datenschutzhinweise</a> gelesen.</label>` : ''}
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
  const { supa, token } = await import('./sess.mjs');
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
  const askBranche = !BRANCHEN[me.branche];
  if (new URLSearchParams(location.search).get('checkout') === 'success') toast('Danke! Der Tarif wird aktiviert, sobald die Zahlung bestätigt ist.');
  shell();
  route();
  if (askBranche) chooseBranche(true);
}

window.addEventListener('hashchange', () => { if (me) route(); });
root.addEventListener('click', (e) => { if (e.target.closest('[data-brsw]')) chooseBranche(); });
root.addEventListener('submit', async (e) => {
  if (e.target.id !== 'brandF') return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  d.brandColor2 = String(d.brandColor2 || '').toUpperCase();
  const r = await api('/api/b2b/account', { method: 'PATCH', body: JSON.stringify(d) });
  if (r.ok) { Object.assign(me.account, d); toast('Erscheinungsbild gespeichert.'); } else toast(r.data?.error || 'Speichern fehlgeschlagen.', true);
});

// Branche wählen: Kacheln; die Wahl wird in den eigenen Kontodaten gespeichert und gilt auf allen Geräten.
function chooseBranche(first = false) {
  let d = document.getElementById('brDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'brDlg'; d.className = 'ad-dlg br-dlg'; document.body.append(d); }
  const cur = br();
  d.innerHTML = `<div class="ad-dlg-in"><div class="ad-dlg-h"><h2>${first ? 'In welcher Branche arbeiten Sie?' : 'Branche wechseln'}</h2>${first ? '' : '<button type="button" class="stage-x" data-x aria-label="Schließen">×</button>'}</div>
    <p class="form-note">Startseite, Bezeichnungen und das Praxis-Toolkit passen sich an Ihre Branche an. Sie können jederzeit wechseln – oben rechts.</p>
    <div class="br-tiles">${BRANCHE_KEYS.map((k) => `<button type="button" class="br-tile${k === cur ? ' on' : ''}" data-br="${k}"><span aria-hidden="true">${BRANCHEN[k].icon}</span><strong>${esc(BRANCHEN[k].label)}</strong><small>${esc(BRANCHEN[k].desc)}</small></button>`).join('')}</div>
    <p class="form-note" id="brMsg" role="status"></p></div>`;
  d.querySelector('[data-x]')?.addEventListener('click', () => d.close());
  if (first) d.addEventListener('cancel', (e) => e.preventDefault(), { once: true });
  d.querySelectorAll('[data-br]').forEach((b) => b.onclick = async () => {
    const k = b.dataset.br;
    d.querySelectorAll('[data-br]').forEach((x) => { x.disabled = true; });
    const { supa, token } = await import('./sess.mjs');
    const r = await supa('/auth/v1/user', { method: 'PUT', headers: { Authorization: 'Bearer ' + token() }, body: JSON.stringify({ data: { b2b_branche: k } }) }).catch(() => null);
    if (!r?.ok) { d.querySelector('#brMsg').textContent = 'Speichern fehlgeschlagen – bitte erneut versuchen.'; d.querySelectorAll('[data-br]').forEach((x) => { x.disabled = false; }); return; }
    me.branche = k; d.close();
    shell(); route();
    toast(`Ansicht: ${BRANCHEN[k].label}`);
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
