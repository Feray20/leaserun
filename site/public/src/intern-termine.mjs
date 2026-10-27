// Web-Admin → Termine: Anfragen aus leaserun.com/termin annehmen (Teams-Termin im Outlook-Kalender), ablehnen, absagen; Arbeitszeiten.
import { api, esc } from './sess.mjs?v=892f3666';

const $ = (s, r = document) => r.querySelector(s);
const TZ = 'Europe/Berlin';
const fFull = (t) => new Date(t).toLocaleString('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
const fTime = (t) => new Date(t).toLocaleTimeString('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const LAB = { angefragt: 'Offen', bestaetigt: 'Bestätigt', abgelehnt: 'Abgelehnt', abgesagt: 'Abgesagt' };
const DAYS = [['1', 'Montag'], ['2', 'Dienstag'], ['3', 'Mittwoch'], ['4', 'Donnerstag'], ['5', 'Freitag'], ['6', 'Samstag'], ['0', 'Sonntag']];
const toast = (t, bad) => { let el = $('#tmToast'); if (!el) { el = document.createElement('div'); el.id = 'tmToast'; el.className = 'pt-toast'; document.body.append(el); } el.textContent = t; el.style.background = bad ? '#991B1B' : ''; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3800); };
let S = { tab: 'offen', data: null, week: null, cal: {}, mode: (() => { try { return localStorage.getItem('lr-tm-mode') === 'monat' ? 'monat' : 'woche'; } catch { return 'woche'; } })() };

export async function termine(v) {
  v.innerHTML = '<div class="lr-ld" role="status">Termine werden geladen …</div>';
  const r = await api('/api/admin/termine');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  S.data = r.data; draw(v);
}

function draw(v) {
  const { bookings, graph } = S.data, now = Date.now();
  const open = bookings.filter((b) => b.status === 'angefragt' && Date.parse(b.ends_at) > now);
  const next = bookings.filter((b) => b.status === 'bestaetigt' && Date.parse(b.ends_at) > now);
  const past = bookings.filter((b) => !open.includes(b) && !next.includes(b)).reverse();
  const list = { offen: open, kommend: next, verlauf: past }[S.tab];
  v.innerHTML = `<section class="tma">
    <div class="tma-head"><div><h2>Termine</h2><p class="form-note">Buchungsseite: <a href="/book" target="_blank" rel="noopener">leaserun.com/termin</a> · ${S.data.config.active ? 'online buchbar' : '<strong>pausiert</strong>'}</p></div>
      <div class="tma-btns"><button class="btn btn-outline btn-sm" type="button" id="tmaCopy">Link kopieren</button><button class="btn btn-outline btn-sm" type="button" id="tmaCfg">Arbeitszeiten</button><button class="btn btn-outline btn-sm" type="button" id="tmaIcs">Kalender-Abo (iPhone/Outlook)</button></div></div>
    <div class="tma-ms ${graph.ok ? 'ok' : 'warn'}" id="tmaMsBox"><div><strong>Microsoft Teams &amp; Outlook:</strong> <span id="tmaMs">${esc(graph.message)}</span>${graph.ok ? '' : '<br><small>Einmal anmelden: Danach entsteht beim Annehmen automatisch ein Teams-Termin in Ihrem Outlook-Kalender, und belegte Zeiten werden ausgeblendet.</small>'}</div>
      <div class="tma-btns">${graph.ok ? `<button class="btn btn-ghost btn-sm" type="button" id="tmaTest">Verbindung testen</button>${graph.mode === 'login' ? '<button class="btn btn-ghost btn-sm" type="button" id="tmaOut">Abmelden</button>' : ''}` : '<button class="btn btn-sm tma-ms-btn" type="button" id="tmaLogin"><svg viewBox="0 0 21 21" width="16" height="16" aria-hidden="true"><path fill="#F25022" d="M1 1h9v9H1z"/><path fill="#7FBA00" d="M11 1h9v9h-9z"/><path fill="#00A4EF" d="M1 11h9v9H1z"/><path fill="#FFB900" d="M11 11h9v9h-9z"/></svg>Mit Microsoft verbinden</button><button class="btn btn-ghost btn-sm" type="button" id="tmaLink" title="Alternative Anmeldung mit Code (microsoft.com/devicelogin)">Anmeldung per Code</button>'}</div></div>
    <div class="tma-chk" id="tmaChk"><div class="tma-chk-h"><strong>Prüfen &amp; erledigen</strong><span class="form-note" id="tmaChkSum">Microsoft-Verbindung, Kalender, Anmeldung</span><span style="flex:1"></span><button class="btn btn-outline btn-sm" type="button" id="tmaChkGo">Jetzt prüfen</button><button class="btn btn-dark btn-sm" type="button" id="tmaChkFix" disabled>Alles erledigen</button></div><div id="tmaChkList"></div></div>
    <div class="tma-cols"><div class="tma-left">
    <div class="br-tabs" role="tablist">${[['offen', `Offene Anfragen (${open.length})`], ['kommend', `Bestätigt (${next.length})`], ['verlauf', 'Verlauf']].map(([k, l]) => `<button type="button" role="tab" data-t="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div>
    <div class="tma-list">${list.length ? list.map(card).join('') : `<p class="form-note tma-empty">${S.tab === 'offen' ? 'Keine offenen Anfragen.' : S.tab === 'kommend' ? 'Keine bestätigten Termine.' : 'Noch kein Verlauf.'}</p>`}</div></div>
    <div class="tma-cal" id="tmaCal"></div></div></section>`;
  v.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { S.tab = b.dataset.t; draw(v); });
  $('#tmaCopy', v).onclick = () => navigator.clipboard?.writeText('https://leaserun.com/book').then(() => toast('Link kopiert.'));
  $('#tmaCfg', v).onclick = () => config(v);
  $('#tmaIcs', v).onclick = () => icsDialog();
  const t = $('#tmaTest', v); if (t) t.onclick = async () => { t.disabled = true; const rr = await api('/api/admin/termine?test=1'); t.disabled = false; if (rr.ok) { $('#tmaMs', v).textContent = rr.data.graph.message; toast(rr.data.graph.ok ? 'Verbindung in Ordnung.' : 'Verbindung fehlgeschlagen.', !rr.data.graph.ok); } };
  // Standard ist die Anmeldung per Link: Viele Microsoft-365-Organisationen blockieren die Code-Anmeldung (devicelogin)
  // per Richtlinie – Microsoft zeigt dann „Hierauf haben Sie keinen Zugriff“. Die Code-Anmeldung bleibt als Alternative.
  const lo = $('#tmaLogin', v); if (lo) lo.onclick = () => msLink(v);
  const lk = $('#tmaLink', v); if (lk) lk.onclick = () => msLogin(v, lk);
  $('#tmaChkGo', v).onclick = () => runCheck(v);
  // Läuft noch eine Anmeldung (z. B. nach Neuladen)? Dann automatisch weiter warten statt neu zu beginnen.
  if (!graph.ok && graph.pending && !S.resumed) { S.resumed = true; msLogin(v, null, graph.pending); }
  else if (!graph.ok) runCheck(v);
  const out = $('#tmaOut', v); if (out) out.onclick = async () => { if (!confirm('Microsoft-Verbindung trennen? Neue Termine bekommen dann keinen Teams-Link mehr.')) return; await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msLogout' }) }); termine(v); };
  v.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => act(v, b.dataset.act, b.dataset.id, b));
  drawCal(v);
}

function card(b) {
  const actions = b.status === 'angefragt' && Date.parse(b.ends_at) > Date.now()
    ? `<button class="btn btn-dark btn-sm" type="button" data-act="accept" data-id="${b.id}">Annehmen</button><button class="btn btn-outline btn-sm" type="button" data-act="decline" data-id="${b.id}">Ablehnen</button>`
    : b.status === 'bestaetigt' && Date.parse(b.ends_at) > Date.now() ? `${b.teams_url ? `<a class="btn btn-sm tma-teams" href="${esc(b.teams_url)}" target="_blank" rel="noopener">Teams öffnen</a>` : ''}<button class="btn btn-outline btn-sm" type="button" data-act="cancel" data-id="${b.id}">Absagen</button>` : '';
  return `<article class="tma-card"><div class="tma-when"><strong>${esc(fFull(b.starts_at))}</strong><span>bis ${fTime(b.ends_at)}</span><em class="tma-st tma-${b.status}">${LAB[b.status]}</em></div>
    <div class="tma-who"><strong>${esc(b.name)}</strong>${b.company ? ` · ${esc(b.company)}` : ''}<br><a href="mailto:${esc(b.email)}">${esc(b.email)}</a>${b.phone ? ` · <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : ''}</div>
    ${b.topic ? `<p class="tma-topic">${esc(b.topic)}</p>` : ''}${b.message ? `<p class="tma-msg">${esc(b.message)}</p>` : ''}${b.note ? `<p class="form-note">Notiz: ${esc(b.note)}</p>` : ''}
    ${actions ? `<div class="tma-acts">${actions}</div>` : ''}</article>`;
}

async function act(v, a, id, btn) {
  let body = { action: a, id };
  if (a === 'accept' && !S.data.graph.ok) {
    const u = prompt('Microsoft Teams ist noch nicht verbunden. Optional einen Teams-Link einfügen (leer lassen = ohne Link bestätigen):', '');
    if (u === null) return; if (u.trim()) body.teamsUrl = u.trim();
  }
  if (a === 'decline' || a === 'cancel') {
    const n = prompt(a === 'decline' ? 'Kurze Nachricht an den Gast (optional):' : 'Grund der Absage (wird dem Gast mitgeteilt, optional):', '');
    if (n === null) return; body.note = n.trim();
  }
  btn.disabled = true; const label = btn.textContent; btn.textContent = a === 'accept' ? 'Teams-Termin wird angelegt …' : 'Bitte warten …';
  const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) { btn.disabled = false; btn.textContent = label; toast(r.data?.error || 'Fehlgeschlagen.', true); return; }
  toast(r.data.message + (r.data.mailed === false ? ' (E-Mail an den Gast fehlgeschlagen)' : ''), r.data.mailed === false);
  const i = S.data.bookings.findIndex((x) => x.id === id); if (i >= 0) S.data.bookings[i] = r.data.booking;
  S.cal = {}; draw(v);
}

function config(v) {
  const c = S.data.config;
  let d = $('#tmaDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'tmaDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const rows = (k) => (c.days[k] || []).map(([a, b]) => `<span class="tma-rng"><input type="time" value="${a}" data-k="${k}" data-p="a">–<input type="time" value="${b}" data-k="${k}" data-p="b"><button type="button" class="tma-x" data-rm aria-label="Zeitraum entfernen">×</button></span>`).join('');
  d.innerHTML = `<form class="wa-dlg-in" id="tmaF"><div class="wa-dlg-h"><h2>Arbeitszeiten &amp; Buchung</h2><button class="stage-x" type="button" data-x aria-label="Schließen">×</button></div>
    <label class="chk"><input type="checkbox" id="cAct"${c.active ? ' checked' : ''}> Online-Buchung aktiv</label>
    <div class="wa-grid3"><label>Dauer (Min.)<input id="cDur" type="number" min="10" max="240" value="${c.durationMin}"></label><label>Puffer (Min.)<input id="cBuf" type="number" min="0" max="120" value="${c.bufferMin}"></label><label>Vorlauf (Std.)<input id="cLead" type="number" min="0" max="336" value="${c.leadHours}"></label><label>Tage im Voraus<input id="cAhead" type="number" min="1" max="120" value="${c.daysAhead}"></label></div>
    <fieldset class="cat-box"><legend>Wochentage (deutsche Zeit)</legend>${DAYS.map(([k, l]) => `<div class="tma-day" data-day="${k}"><strong>${l}</strong><div class="tma-rngs">${rows(k) || '<span class="form-note">frei</span>'}</div><button type="button" class="btn btn-ghost btn-sm" data-add="${k}">+ Zeitraum</button></div>`).join('')}</fieldset>
    <label>Themen (eine pro Zeile)<textarea id="cTop" rows="4">${esc(c.topics.join('\n'))}</textarea></label>
    <label>Einleitung auf der Buchungsseite<input id="cIntro" maxlength="400" value="${esc(c.intro)}"></label>
    <p class="form-note">Belegte Zeiten aus Ihrem Outlook-Kalender werden automatisch ausgeblendet, sobald Microsoft verbunden ist.</p>
    <div class="pt-row"><button class="btn btn-ghost" type="button" id="cReset">Standard</button><span style="flex:1"></span><button class="btn btn-dark" type="submit">Speichern</button></div><p class="form-note" id="cMsg" role="status"></p></form>`;
  if (!d.open) d.showModal();
  d.querySelector('[data-x]').onclick = () => d.close();
  const collect = () => { const days = {}; DAYS.forEach(([k]) => { days[k] = [...d.querySelectorAll(`[data-day="${k}"] .tma-rng`)].map((s) => [s.querySelector('[data-p=a]').value, s.querySelector('[data-p=b]').value]).filter(([a, b]) => a && b); }); return days; };
  const rebind = () => {
    d.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { const k = b.closest('[data-day]').dataset.day; b.parentElement.remove(); c.days = collect(); config(v); });
    d.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => { c.days = collect(); const k = b.dataset.add; c.days[k] = [...(c.days[k] || []), ['09:00', '12:00']]; config(v); });
  };
  rebind();
  d.querySelector('#cReset').onclick = async () => { if (!confirm('Arbeitszeiten auf Standard zurücksetzen?')) return; const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'config', config: null }) }); if (r.ok) { S.data.config = r.data.config; config(v); } };
  d.querySelector('#tmaF').onsubmit = async (e) => {
    e.preventDefault();
    const n = (id) => Number(d.querySelector(id).value) || 0;
    const cfg = { active: d.querySelector('#cAct').checked, durationMin: n('#cDur'), bufferMin: n('#cBuf'), leadHours: n('#cLead'), daysAhead: n('#cAhead'), days: collect(), topics: d.querySelector('#cTop').value.split('\n').map((x) => x.trim()).filter(Boolean), intro: d.querySelector('#cIntro').value.trim() };
    const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'config', config: cfg }) });
    const m = d.querySelector('#cMsg');
    if (r.ok) { S.data.config = r.data.config; m.textContent = 'Gespeichert – gilt sofort auf leaserun.com/termin.'; draw(v); } else m.textContent = r.data?.error || 'Speichern fehlgeschlagen.';
  };
}

// Gerätecode-Anmeldung: Code anzeigen, Microsoft-Seite öffnen, im Hintergrund auf die Bestätigung warten.
async function msLogin(v, btn, resume) {
  let data = resume;
  if (!data) {
    btn.disabled = true; btn.textContent = 'Wird vorbereitet …';
    const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msLogin' }) });
    if (!r.ok) { toast(r.data?.error || 'Anmeldung nicht möglich.', true); termine(v); return; }
    data = r.data;
  }
  const { userCode, url, interval, expiresIn } = data;
  const box = $('#tmaMsBox', v);
  box.className = 'tma-ms tma-login'; box.dataset.busy = '1';
  box.innerHTML = `<div class="tma-login-in"><strong>Bei Microsoft anmelden</strong><ol><li>Code kopieren: <button type="button" class="tma-code" id="tmaCode" title="Kopieren">${esc(userCode)}</button></li><li>Code einfügen und mit Ihrem Microsoft-365-Konto anmelden: <a class="btn btn-dark btn-sm tma-go" href="${esc(url)}" target="_blank" rel="noopener" id="tmaGo">microsoft.com/devicelogin öffnen<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a></li><li>Zugriff auf den Kalender „Akzeptieren“ – dieses Fenster erkennt die Anmeldung automatisch.</li></ol>
    <div class="lr-ld tma-wait" role="status">Warte auf Ihre Anmeldung bei Microsoft …</div><button type="button" class="btn btn-ghost btn-sm" id="tmaStop">Abbrechen</button> <button type="button" class="btn btn-ghost btn-sm" id="tmaAlt">Klappt nicht? Anmeldung per Link</button></div>`;
  $('#tmaAlt', v).onclick = () => { stop = true; msLink(v); };
  const copy = () => navigator.clipboard?.writeText(userCode).then(() => toast('Code kopiert.')).catch(() => {});
  $('#tmaCode', v).onclick = copy; $('#tmaGo', v).addEventListener('click', copy);
  let stop = false; $('#tmaStop', v).onclick = () => { stop = true; termine(v); };
  const until = Date.now() + expiresIn * 1000;
  while (!stop && Date.now() < until && document.body.contains(box)) {
    await new Promise((res) => setTimeout(res, interval * 1000));
    if (stop || !document.body.contains(box)) return;
    const p = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msPoll' }) });
    const st = p.data?.status;
    if (st === 'done') { toast(`Verbunden mit ${p.data.account}.`); termine(v); return; }
    if (st === 'expired' || st === 'error') { toast(p.data.message || 'Anmeldung fehlgeschlagen.', true); termine(v); return; }
  }
}

// Anmeldung per Link: Microsoft-Seite öffnen, danach die Adresse aus der Adresszeile (http://localhost/?code=…) einfügen.
// Funktioniert auch, wenn eine Organisation die Code-Anmeldung (microsoft.com/devicelogin) per Richtlinie blockiert.
async function msLink(v) {
  const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msLink' }) });
  if (!r.ok) { toast(r.data?.error || 'Nicht möglich.', true); return; }
  const box = $('#tmaMsBox', v);
  box.className = 'tma-ms tma-login'; box.dataset.busy = '1';
  box.innerHTML = `<form class="tma-login-in" id="tmaLinkF"><strong>Anmeldung per Link</strong><ol>
    <li><a class="btn btn-dark btn-sm" href="${esc(r.data.url)}" target="_blank" rel="noopener">Bei Microsoft anmelden</a> – mit Ihrem Microsoft-365-Konto, Zugriff „Akzeptieren“ (als Administrator „Im Namen der Organisation zustimmen“ anhaken).</li>
    <li>Danach zeigt der Browser „Seite nicht erreichbar“ – das ist richtig. Die komplette Adresse oben aus der Adresszeile kopieren (beginnt mit <code>http://localhost/?code=</code>).</li>
    <li><label class="tma-paste">Hier einfügen<input name="url" required autocomplete="off" placeholder="http://localhost/?code=…"></label></li></ol>
    <p class="form-note">Zeigt Microsoft stattdessen „Hierauf haben Sie keinen Zugriff“: auf „Weitere Details“ tippen, den Text mit dem Fehlercode (AADSTS…) kopieren und hier einfügen – LeaseRun zeigt dann, was genau zu tun ist.</p>
    <div class="tma-btns"><button class="btn btn-dark btn-sm" type="submit">Verbinden</button><button type="button" class="btn btn-ghost btn-sm" id="tmaLinkX">Abbrechen</button></div><p class="form-note" id="tmaLinkMsg" role="status"></p></form>`;
  $('#tmaLinkX', v).onclick = () => termine(v);
  $('#tmaLinkF', v).onsubmit = async (e) => {
    e.preventDefault(); const b = e.target.querySelector('[type=submit]'); b.disabled = true; $('#tmaLinkMsg', v).textContent = 'Wird geprüft …';
    const rr = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msLinkDone', url: new FormData(e.target).get('url') }) });
    b.disabled = false;
    if (rr.data?.ok) { toast(rr.data.message); termine(v); } else $('#tmaLinkMsg', v).textContent = rr.data?.message || rr.data?.error || 'Fehlgeschlagen.';
  };
}

// Prüfen & erledigen: Status kurz, Einzelheiten erst beim Aufklappen; „Alles erledigen“ behebt, was automatisch geht.
async function runCheck(v, fix) {
  const list = $('#tmaChkList', v), go = $('#tmaChkGo', v), fx = $('#tmaChkFix', v); if (!list) return;
  go.disabled = true; fx.disabled = true; $('#tmaChkSum', v).textContent = fix ? 'Wird erledigt …' : 'Wird geprüft …';
  const r = fix ? await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msFix', ids: fix }) }) : await api('/api/admin/termine?check=1');
  go.disabled = false; if (!document.body.contains(list)) return;
  if (!r.ok) { $('#tmaChkSum', v).textContent = r.data?.error || 'Prüfung nicht möglich.'; return; }
  if (r.data.done?.length) toast(r.data.done.join(' · '));
  const cks = r.data.checks || [], bad = cks.filter((c) => !c.ok), auto = bad.filter((c) => c.fix).map((c) => c.id);
  $('#tmaChkSum', v).textContent = bad.length ? `${bad.length} Punkt(e) offen` : 'Alles in Ordnung';
  fx.disabled = !auto.length; fx.textContent = auto.length ? 'Alles erledigen' : 'Nichts automatisch zu erledigen';
  fx.onclick = () => runCheck(v, auto);
  list.innerHTML = cks.map((c) => `<details class="tma-ck ${c.ok ? (c.warn ? 'warn' : 'ok') : 'bad'}"><summary><span class="tma-dot"></span>${esc(c.label)}${c.fix && !c.ok ? `<em>automatisch lösbar</em>` : ''}</summary><p>${esc(c.detail)}</p>${c.how ? `<p class="form-note">${esc(c.how)}</p>` : ''}</details>`).join('');
  if (fix && cks.some((c) => c.id === 'ms:conn' && c.ok) && !S.data.graph.ok) termine(v);
}

// ---------- Kalender (Woche): Outlook-Termine + LeaseRun-Buchungen ----------
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = (s) => { const wd = (new Date(s + 'T12:00:00Z').getUTCDay() + 6) % 7; return addDays(s, -wd); };
const dayLab = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });

async function drawCal(v, force) {
  const el = $('#tmaCal', v); if (!el) return;
  S.week = S.week || monday(ymd(new Date()));
  const month = S.mode === 'monat', today = ymd(new Date());
  // Monat: Raster ab dem Montag der Woche mit dem Monatsersten, 6 Wochen (42 Tage).
  const mRef = month ? (S.mref || S.week.slice(0, 7)) : null;
  const wk = month ? monday(mRef + '-01') : S.week;
  const n = month ? 42 : 7, days = [...Array(n)].map((_, i) => addDays(wk, i));
  const range = month ? new Date(mRef + '-15T12:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC', month: 'long', year: 'numeric' }) : `${dayLab(days[0])} – ${new Date(days[6] + 'T12:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  el.innerHTML = `<div class="tmc-head"><div class="tmc-nav"><button type="button" class="btn btn-outline btn-sm" data-w="-1" aria-label="${month ? 'Vorheriger Monat' : 'Vorherige Woche'}">‹</button><button type="button" class="btn btn-outline btn-sm" data-w="0">Heute</button><button type="button" class="btn btn-outline btn-sm" data-w="1" aria-label="${month ? 'Nächster Monat' : 'Nächste Woche'}">›</button></div><strong>${range}</strong>
    <div class="seg tmc-mode" role="tablist" aria-label="Ansicht"><button type="button" data-m="woche" aria-selected="${!month}">Woche</button><button type="button" data-m="monat" aria-selected="${month}">Monat</button></div></div>
    <div class="tmc-body">${S.cal[wk + ':' + n] && !force ? '' : '<div class="lr-ld" role="status">Kalender wird geladen …</div>'}</div>`;
  const key = wk + ':' + n;
  el.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => {
    const k = +b.dataset.w;
    if (month) { if (k === 0) S.mref = today.slice(0, 7); else { const d = new Date(mRef + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); S.mref = d.toISOString().slice(0, 7); } }
    else S.week = k === 0 ? monday(today) : addDays(S.week, 7 * k);
    drawCal(v);
  });
  el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { S.mode = b.dataset.m; if (S.mode === 'monat') S.mref = S.week.slice(0, 7); try { localStorage.setItem('lr-tm-mode', S.mode); } catch { /* ohne Speicher */ } drawCal(v); });
  if (!S.cal[key] || force) {
    const from = new Date(wk + 'T00:00:00'), to = new Date(addDays(wk, n) + 'T00:00:00');
    const r = await api(`/api/admin/termine?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    if ((month ? monday((S.mref || S.week.slice(0, 7)) + '-01') : S.week) !== wk || S.mode !== (month ? 'monat' : 'woche') || !document.body.contains(el)) return;
    if (!r.ok) { $('.tmc-body', el).innerHTML = `<p class="form-note">${esc(r.data?.error || 'Kalender nicht verfügbar.')}</p>`; return; }
    S.cal[key] = r.data;
  }
  const d = S.cal[key];
  const items = [
    ...d.events.map((e) => ({ k: 'ol', start: e.start, end: e.end, allDay: e.allDay, title: e.subject, sub: e.location, href: e.teams || e.link, tip: e.showAs === 'free' ? 'frei' : e.showAs === 'tentative' ? 'mit Vorbehalt' : '' })),
    ...d.bookings.map((b) => ({ k: b.status === 'bestaetigt' ? 'ok' : 'req', start: b.starts_at, end: b.ends_at, title: `${b.name}${b.company ? ` · ${b.company}` : ''}`, sub: b.topic || '', href: b.teams_url, id: b.id })),
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const byDay = Object.fromEntries(days.map((x) => [x, []]));
  for (const it of items) { const k = it.allDay ? it.start.slice(0, 10) : ymd(new Date(it.start)); if (byDay[k]) byDay[k].push(it); }
  const chip = (it) => `<${it.href ? `a href="${esc(it.href)}" target="_blank" rel="noopener"` : it.id ? `button type="button" data-goto="${it.id}"` : 'div'} class="tmc-ev tmc-${it.k}" title="${esc(it.title)}${it.sub ? ' – ' + esc(it.sub) : ''}"><span class="tmc-t">${it.allDay ? 'ganztägig' : `${fTime(it.start)}–${fTime(it.end)}`}${it.tip ? ` · ${it.tip}` : ''}</span><span class="tmc-s">${esc(it.title)}</span>${it.sub ? `<span class="tmc-l">${esc(it.sub)}</span>` : ''}</${it.href ? 'a' : it.id ? 'button' : 'div'}>`;
  $('.tmc-body', el).innerHTML = `${d.calError ? `<p class="form-note tmc-err">Outlook: ${esc(d.calError)}</p>` : ''}${!d.connected ? '<p class="form-note tmc-err">Outlook ist nicht verbunden – angezeigt werden nur LeaseRun-Buchungen.</p>' : ''}
    ${month ? `<div class="tmc-month"><div class="tmc-wd">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<span>${w}</span>`).join('')}</div><div class="tmc-mgrid">${days.map((x) => `<div class="tmc-mday${x === today ? ' now' : ''}${x.slice(0, 7) !== mRef ? ' out' : ''}"><span class="tmc-mn">${+x.slice(8)}</span>${byDay[x].slice(0, 3).map(chip).join('')}${byDay[x].length > 3 ? `<button type="button" class="tmc-more" data-day="${x}">+${byDay[x].length - 3} weitere</button>` : ''}</div>`).join('')}</div></div>`
      : `<div class="tmc-grid">${days.map((x) => `<div class="tmc-day${x === today ? ' now' : ''}${byDay[x].length ? '' : ' empty'}"><div class="tmc-dh">${dayLab(x)}</div>${byDay[x].map(chip).join('') || '<span class="tmc-none">frei</span>'}</div>`).join('')}</div>`}
    ${items.length ? '' : `<p class="form-note tmc-free">${month ? 'In diesem Monat' : 'Diese Woche'} sind keine Termine eingetragen.</p>`}<div class="tmc-legend"><span class="tmc-ol">Outlook</span><span class="tmc-ok">LeaseRun bestätigt</span><span class="tmc-req">Anfrage offen</span></div>`;
  el.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { S.mode = 'woche'; S.week = monday(b.dataset.day); try { localStorage.setItem('lr-tm-mode', 'woche'); } catch { /* ohne Speicher */ } drawCal(v); });
  el.querySelectorAll('[data-goto]').forEach((b) => b.onclick = () => { const bk = S.data.bookings.find((x) => x.id === b.dataset.goto); if (!bk) return; S.tab = bk.status === 'angefragt' ? 'offen' : 'kommend'; draw(v); setTimeout(() => { const c = v.querySelector(`[data-id="${bk.id}"]`)?.closest('.tma-card'); c?.scrollIntoView({ behavior: 'smooth', block: 'center' }); c?.classList.add('flash'); setTimeout(() => c?.classList.remove('flash'), 1600); }, 50); });
}

// Kalender-Abo: alle LeaseRun-Termine automatisch im iPhone-/iPad-, Outlook- oder Google-Kalender.
async function icsDialog(renew = false) {
  const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'icsToken', renew }) });
  if (!r.ok) { toast(r.data?.error || 'Nicht verfügbar.', true); return; }
  const url = r.data.url, web = url.replace(/^https:/, 'webcal:');
  let d = document.getElementById('tmIcs'); if (!d) { d = document.createElement('dialog'); d.id = 'tmIcs'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<div class="wa-dlg-in tm-ics"><div class="wa-dlg-h"><h2>Kalender-Abo</h2><button class="stage-x" type="button" data-x aria-label="Schließen">×</button></div>
    <p>Alle LeaseRun-Termine (Anfragen, Bestätigungen, Absagen) erscheinen automatisch in Ihrem Kalender und aktualisieren sich selbst.</p>
    <a class="btn btn-dark" href="${esc(web)}">Auf diesem iPhone/iPad/Mac abonnieren</a>
    <label class="pf-fld"><span>Link</span><input value="${esc(url)}" readonly id="tmIcsUrl"></label>
    <div class="tma-btns"><button class="btn btn-outline btn-sm" type="button" id="tmIcsCopy">Link kopieren</button><button class="btn btn-ghost btn-sm" type="button" id="tmIcsNew">Neuen Link erzeugen</button></div>
    <p class="form-note">Outlook: Kalender hinzufügen → Aus dem Internet abonnieren → Link einfügen. Google Kalender: Weitere Kalender → Per URL. Der Link ist geheim – nicht weitergeben. „Neuen Link erzeugen“ macht den alten sofort ungültig.</p></div>`;
  if (!d.open) d.showModal();
  d.querySelector('[data-x]').onclick = () => d.close();
  d.querySelector('#tmIcsCopy').onclick = () => navigator.clipboard?.writeText(url).then(() => toast('Link kopiert.'));
  d.querySelector('#tmIcsNew').onclick = () => { if (confirm('Neuen Link erzeugen? Bestehende Abos mit dem alten Link hören auf, sich zu aktualisieren.')) icsDialog(true); };
}
