// Web-Admin → Postfach: E-Mails empfangen, lesen, beantworten und im LeaseRun-Design senden (support@leaserun.com).
import { api as api0, dtt, esc } from './sess.mjs?v=892f3666';

// Schneller Postfach-Aufbau: Ordnerlisten und geöffnete Nachrichten werden kurz zwischengespeichert und sofort gezeigt,
// die frische Fassung lädt still im Hintergrund nach. Jede Änderung (POST) leert den Nachrichten-Zwischenspeicher.
const LC = new Map(), MC = new Map(), MSG_TTL = 90_000;
const api = (u, o) => { if (o?.method === 'POST') { MC.clear(); LC.clear(); } return api0(u, o); };
const listUrl = (f, q) => `/api/admin/mail?folder=${f}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
// Vorab-Laden in einer kleinen Warteschlange (höchstens zwei gleichzeitig, nur wenn der Browser frei ist): So steht
// ein echter Klick nie hinter acht Hintergrund-Anfragen an.
const PQ = []; let pRun = 0;
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 50));
function pump() { while (pRun < 2 && PQ.length) { const job = PQ.shift(); pRun++; idle(() => job().finally(() => { pRun--; pump(); })); } }
const queue = (job) => { PQ.push(job); pump(); };
function prefetchList(f) { if (LC.has(f)) return; queue(() => (LC.has(f) ? Promise.resolve() : api0(listUrl(f, '')).then((r) => { if (r.ok && !LC.has(f)) LC.set(f, r.data); }).catch(() => null))); }
function startMsg(id) {
  const c = MC.get(id); if (c && Date.now() - c.at < MSG_TTL) return c.p;
  const p = api0('/api/admin/mail?id=' + id); MC.set(id, { at: Date.now(), p });
  p.then((r) => { if (!r.ok) MC.delete(id); }).catch(() => MC.delete(id));
  return p;
}
// Darüberfahren lädt sofort (die Absicht ist klar); die automatische Vorab-Ladung reiht sich in die Warteschlange ein.
const prefetchMsg = (id, now) => (now ? startMsg(id) : queue(() => Promise.resolve(startMsg(id)).catch(() => null)));

const $ = (s, r = document) => r.querySelector(s);
const FOLDERS = [
  ['inbox', 'Posteingang', '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>'],
  ['starred', 'Markiert', '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>'],
  ['belege', 'Belege', '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'],
  ['sent', 'Gesendet', '<path d="M4 12l16-8-6 16-3-6z"/><path d="M11 14l9-10"/>'],
  ['drafts', 'Entwürfe', '<path d="M4 20h4L19 9l-4-4L4 16z"/>'],
  ['archive', 'Archiv', '<path d="M3 5h18v4H3z"/><path d="M5 9v10h14V9M10 13h4"/>'],
  ['spam', 'Spam', '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.5"/>'],
  ['trash', 'Papierkorb', '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'],
];
// Belege-Ordner: Stand in der Steuersoftware je Mail.
const TAXTXT = { offen: 'Bitte zuordnen', bestaetigt: 'Gebucht', privat: 'Privat / keine Rechnung', duplikat: 'Doppelt', storniert: 'Storniert', keine: 'Ohne Rechnung' };
const TAXCLS = { offen: 'warn', bestaetigt: 'ok', storniert: 'bad' };
const S = { folder: 'inbox', q: '', items: [], open: null, sel: new Set(), data: null };
const toast = (t, bad) => { let el = $('#pfToast'); if (!el) { el = document.createElement('div'); el.id = 'pfToast'; el.className = 'pt-toast'; document.body.append(el); } el.textContent = t; el.style.background = bad ? '#991B1B' : ''; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 3400); };
const icon = (p, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const when = (m) => { const d = new Date(m.received_at || m.sent_at || m.created_at); const t = new Date(); return d.toDateString() === t.toDateString() ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: d.getFullYear() === t.getFullYear() ? undefined : '2-digit' }); };
// Absender immer mit Name UND Adresse (Schutz vor gefälschten Namen).
const who = (m) => (m.direction === 'in' ? (m.from_name && m.from_name.toLowerCase() !== String(m.from_email).toLowerCase() ? `${m.from_name} · ${m.from_email}` : m.from_email) : `An: ${(m.to_emails || []).join(', ') || '–'}`);
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const OPEN_KEY = 'lr-pf-open';
const remember = (id) => { try { if (id) sessionStorage.setItem(OPEN_KEY, id); else sessionStorage.removeItem(OPEN_KEY); } catch { /* ignore */ } };
let booted = false;
export async function postfach(v) {
  v.innerHTML = `<section class="pf"><aside class="pf-side"><button class="btn btn-dark pf-new" type="button" id="pfNew">${icon('<path d="M12 5v14M5 12h14"/>')}Neue E-Mail</button><nav class="pf-nav" id="pfNav"></nav><div class="pf-box" id="pfBox"></div></aside>
    <div class="pf-main"><div class="pf-bar"><input id="pfQ" type="search" placeholder="E-Mails durchsuchen" value="${esc(S.q)}"><button type="button" class="btn btn-outline btn-sm" id="pfSync" title="Neue E-Mails abrufen">${icon('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', 16)} Abrufen</button><div class="pf-acts" id="pfActs"></div></div><div class="pf-cols"><div class="pf-list" id="pfList" aria-live="polite"></div><div class="pf-read" id="pfRead"></div></div></div></section>`;
  $('#pfNew', v) && ($('#pfNew', v).onclick = () => compose({}));
  $('#pfSync', v) && ($('#pfSync', v).onclick = () => { S.sync = true; load(v); });
  let t; if ($('#pfQ', v)) $('#pfQ', v).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value; load(v); }, 300); };
  // Aus Avas Paket-Ansicht (Headquarters → Freigaben): Ordner „Entwürfe“, Auswahl vormerken, ersten Entwurf öffnen.
  const pick = (() => { try { const x = JSON.parse(sessionStorage.getItem('lr-pf-pick') || '[]'); sessionStorage.removeItem('lr-pf-pick'); return Array.isArray(x) ? x.filter((id) => typeof id === 'string') : []; } catch { return []; } })();
  if (pick.length) { S.folder = 'drafts'; S.q = ''; S.open = null; S.items = []; remember(pick[0]); }
  // Klick auf „Postfach“ öffnet immer den Posteingang (Wunsch Feray). Nur direkt nach einem Neuladen der Seite
  // (z. B. automatisches Update) bleibt die zuletzt geöffnete E-Mail offen.
  const reloaded = !booted && (() => { try { return performance.getEntriesByType('navigation')[0]?.type === 'reload'; } catch { return false; } })();
  booted = true;
  // Aus „Verkäufe“: E-Mails zu einer Bestellnummer in allen Ordnern suchen.
  const findQ = (() => { try { const x = sessionStorage.getItem('lr-pf-q'); sessionStorage.removeItem('lr-pf-q'); return x && /^[\w-]{3,60}$/.test(x) ? x : ''; } catch { return ''; } })();
  if (findQ) { S.folder = 'all'; S.q = findQ; S.open = null; S.sel.clear(); remember(null); if ($('#pfQ', v)) $('#pfQ', v).value = findQ; }
  else if (!pick.length && !reloaded) { S.folder = 'inbox'; S.q = ''; S.open = null; S.sel.clear(); remember(null); if ($('#pfQ', v)) $('#pfQ', v).value = ''; }
  await load(v);
  if (pick.length && v.isConnected) { pick.forEach((id) => { if (S.items.some((m) => m.id === id)) S.sel.add(id); }); drawList(v); }
  // Geöffnete E-Mail nach einem Neuladen der Seite (z. B. automatisches Update) wieder öffnen – nicht zurück zur Liste.
  const keep = (() => { try { return sessionStorage.getItem(OPEN_KEY); } catch { return null; } })();
  if (keep && !S.open && v.isConnected) openMsg(v, keep, true);
  // Läuft noch ein „Alle senden“ (z. B. nach App-Wechsel)? Dann Stand anzeigen.
  watchQueue(v);
}

// Neue E-Mails im Hintergrund abrufen; die Liste ist bis dahin schon sichtbar.
async function syncInbox(v, manual) {
  const r = await api(`/api/admin/mail?sync=only${manual ? '&force=1' : ''}`);
  const n = r.ok ? r.data?.fetched || 0 : 0;
  if (n) { toast(`${n} neue E-Mail(s) empfangen.`); if (S.folder === 'inbox') load(v, true); }
  else if (manual) toast(r.ok ? 'Keine neuen E-Mails.' : 'Abruf gerade nicht möglich.', !r.ok);
}

let seq = 0;
async function load(v, quiet) {
  const manual = S.sync; S.sync = false;
  const my = ++seq, key = S.q ? '' : S.folder;
  // Zwischengespeicherte Liste sofort zeigen (kein „Wird geladen …“ beim Ordnerwechsel).
  const cached = key && LC.get(key);
  if (cached && !quiet) render(v, cached);
  else if (!quiet && !S.items.length) $('#pfList').innerHTML = '<p class="form-note pf-empty">Wird geladen …</p>';
  const r = await api0(listUrl(S.folder, S.q));
  if (my !== seq) return; // eine neuere Anfrage (Ordnerwechsel, Suche) hat diese überholt
  if (!r.ok) { if (!cached) $('#pfList').innerHTML = `<p class="form-note pf-empty">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  if (key) LC.set(key, r.data);
  if (r.data.imported) toast(`${r.data.imported} vorbereitete E-Mails liegen jetzt unter Entwürfe.`);
  if (!quiet && (manual || S.folder === 'inbox')) syncInbox(v, manual);
  render(v, r.data);
  // Die nächsten Ordner und die obersten Nachrichten vorab laden, damit Klicks sofort reagieren.
  setTimeout(() => { ['drafts', 'inbox', 'sent'].forEach(prefetchList); S.items.slice(0, 4).forEach((m) => { if (m.direction === 'out' || m.read_at) prefetchMsg(m.id); }); }, 400);
}

function render(v, data) {
  const keepSel = S.data === data;
  S.data = data; S.items = data.items || []; if (!keepSel) S.sel.clear();
  const c = data.counts || {};
  $('#pfNav').innerHTML = FOLDERS.map(([k, l, p]) => `<button type="button" class="pf-f${S.folder === k ? ' on' : ''}" data-f="${k}">${icon(p)}<span>${l}</span>${c[k] ? `<b>${c[k]}</b>` : ''}</button>`).join('');
  $('#pfNav').querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { remember(null); S.folder = b.dataset.f; S.open = null; S.items = []; $('#pfRead').innerHTML = ''; v.querySelector('.pf')?.classList.remove('reading'); load(v); });
  // Kopfzeile nur mit Postfach und Empfangsstatus. Terminlink (Standard leaserun.com/termin) und „Vorschau an mich“-Adresse
  // bleiben gespeichert, werden hier aber nicht mehr angezeigt (Wunsch Feray, 27.10.2026).
  if (!$('#pfBoxIn')) $('#pfBox').innerHTML = `<p class="pf-set" id="pfBoxIn">${esc(data.mailbox)} · <span class="${data.receiving ? 'pf-ok' : 'pf-warn'}">${data.receiving ? `Empfang aktiv${data.webhook ? ' (sofort)' : ''}` : 'Empfang nicht eingerichtet'}</span></p>`;
  drawList(v);
}

// Entwürfe, die gesendet werden können (Status Entwurf, mindestens ein Empfänger).
const sendable = (ids) => S.items.filter((m) => m.direction === 'out' && m.status === 'entwurf' && (m.to_emails || []).length && (!ids || ids.includes(m.id)));
let sending = false;

function drawList(v) {
  const L = S.items;
  const ready = S.folder === 'drafts' && !S.q ? sendable(S.sel.size ? [...S.sel] : null) : [];
  const sendBtn = ready.length ? `<button class="btn btn-dark btn-sm" data-sendall type="button"${sending ? ' disabled' : ''}>${sending ? 'Wird gesendet …' : S.sel.size ? `Ausgewählte senden (${ready.length})` : `Alle senden (${ready.length})`}</button>` : '';
  $('#pfActs').innerHTML = S.sel.size ? `<span class="form-note">${S.sel.size} ausgewählt</span>${sendBtn}
    <button class="btn btn-ghost btn-sm" data-bulk="read" type="button">Gelesen</button><button class="btn btn-ghost btn-sm" data-bulk="archive" type="button">Archivieren</button>
    ${S.folder === 'trash' ? '<button class="btn btn-ghost btn-sm" data-bulk="purge" type="button">Endgültig löschen</button>' : '<button class="btn btn-ghost btn-sm" data-bulk="trash" type="button">Löschen</button>'}${S.folder === 'spam' ? '<button class="btn btn-ghost btn-sm" data-bulk="inbox" type="button">Kein Spam</button>' : ''}` : sendBtn;
  $('#pfActs').querySelectorAll('[data-bulk]').forEach((b) => b.onclick = () => bulk(v, b.dataset.bulk, [...S.sel]));
  // „Alle senden“: zweimal tippen (Schutz vor Versehen, kein Dialog). Jede Mail geht einzeln über denselben Weg wie
  // „Senden“ im Entwurf – mit Prüfung auf Abmeldung/Sperrliste auf dem Server.
  const sb = $('#pfActs [data-sendall]');
  if (sb) sb.onclick = () => {
    if (sending) return;
    if (!sb.dataset.armed) { sb.dataset.armed = '1'; sb.textContent = `Wirklich ${ready.length} E-Mail(s) senden? Nochmal tippen`; clearTimeout(sb._t); sb._t = setTimeout(() => drawList(v), 5000); return; }
    clearTimeout(sb._t); sendAll(v, ready.map((m) => m.id));
  };
  $('#pfList').innerHTML = L.length ? L.map((m) => `<div class="pf-row${m.direction === 'in' && !m.read_at ? ' unread' : ''}${S.open === m.id ? ' on' : ''}" data-id="${m.id}" role="button" tabindex="0">
      <input type="checkbox" data-ck="${m.id}" aria-label="Auswählen"${S.sel.has(m.id) ? ' checked' : ''}>
      <button type="button" class="pf-star${m.starred ? ' on' : ''}" data-star="${m.id}" aria-label="Markieren">${icon(FOLDERS[1][2], 16)}</button>
      <div class="pf-row-t"><div class="pf-row-h"><strong>${esc(who(m))}${m.known ? ' <span class="pf-known" title="Vertraut – mit dieser Adresse gab es schon einen Austausch">✓ Vertraut</span>' : m.fresh ? ' <span class="pf-new" title="Erstkontakt – noch kein Austausch mit dieser Adresse">Erstkontakt</span>' : ''}</strong><time>${when(m)}</time></div>
      <div class="pf-row-s">${(() => { const alt = m.direction === 'in' && (m.to_emails || []).find((e) => /@leaserun\.de$/i.test(e) && !/^support@/i.test(e)); return alt ? `<span class="st">an ${esc(alt.split('@')[0])}@</span> ` : ''; })()}${esc(m.subject || '(ohne Betreff)')}${(m.attachments || []).filter((a) => !a.inline).length ? ` ${icon('<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>', 14)}` : ''}</div>
      <div class="pf-row-p">${m.state ? `<span class="pf-state s-${m.state}">${{ neu: 'Neu', offen: 'Offen', gelesen: 'Gelesen', entwurf: 'Entwurf bereit', beantwortet: 'Beantwortet' }[m.state]}</span> ` : ''}${m.status === 'fehler' ? `<span class="st bad">Fehler</span> ${esc(m.error || '')}` : m.status === 'gesperrt' ? '<span class="st bad">Gesperrt</span> ' : m.research_flag && m.status !== 'gesendet' ? `<span class="st bad" title="${esc(m.research_flag)}">Vor Versand prüfen</span> ` : ''}${m.tax ? `<span class="st ${TAXCLS[m.tax] || ''}">${TAXTXT[m.tax] || esc(m.tax)}</span> ` : ''}${esc(m.snippet || '')}</div></div></div>`).join('')
    : `<p class="form-note pf-empty">${S.q ? 'Keine Treffer.' : { inbox: 'Keine E-Mails im Posteingang.', drafts: 'Keine Entwürfe.', sent: 'Noch nichts gesendet.' }[S.folder] || 'Leer.'}</p>`;
  $('#pfList').querySelectorAll('.pf-row').forEach((row) => {
    const go = (e) => { if (e.target.closest('input,button')) return; openMsg(v, row.dataset.id); };
    row.onclick = go; row.onkeydown = (e) => { if (e.key === 'Enter') go(e); };
    const m = L.find((y) => y.id === row.dataset.id);
    // Vorab laden beim Darüberfahren – ungelesene eingehende Mails nicht (sonst gälten sie als gelesen).
    if (m && (m.direction === 'out' || m.read_at)) row.onpointerenter = () => prefetchMsg(m.id, true);
  });
  $('#pfList').querySelectorAll('[data-ck]').forEach((x) => x.onchange = () => { x.checked ? S.sel.add(x.dataset.ck) : S.sel.delete(x.dataset.ck); drawList(v); });
  $('#pfList').querySelectorAll('[data-star]').forEach((b) => b.onclick = async () => { const m = L.find((y) => y.id === b.dataset.star); m.starred = !m.starred; drawList(v); await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'mark', ids: [m.id], starred: m.starred }) }); });
}

// „Alle senden“ läuft auf dem Server weiter – auch wenn die App gewechselt oder das Handy gesperrt wird.
// Hier wird nur der Stand angezeigt (solange das Postfach offen ist).
async function sendAll(v, ids) {
  sending = true; drawList(v);
  const r = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'sendqueue', ids }) }).catch(() => ({ ok: false, data: { error: 'Netzwerkfehler' } }));
  if (!r.ok) { sending = false; drawList(v); toast(r.data?.error || 'Senden konnte nicht gestartet werden.', true); return; }
  S.sel.clear();
  if (S.open && ids.includes(S.open)) { S.open = null; $('#pfRead').innerHTML = ''; v.querySelector('.pf')?.classList.remove('reading'); }
  toast(`${ids.length} E-Mail(s) werden gesendet – das läuft auch weiter, wenn du die App wechselst.`);
  watchQueue(v);
}
let qTimer = null;
async function watchQueue(v) {
  clearTimeout(qTimer);
  const r = await api0('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'queuestatus' }) }).catch(() => null);
  const q = r?.ok ? r.data.queue : null;
  if (!q || !v.isConnected) { sending = false; return; }
  if (q.left > 0) {
    sending = true;
    const b = $('#pfActs [data-sendall]'); if (b) b.textContent = `Wird gesendet … ${q.sent} von ${q.total}`;
    toast(`Gesendet: ${q.sent} von ${q.total}${q.failed.length ? ` · ${q.failed.length} Fehler` : ''}`);
    qTimer = setTimeout(() => watchQueue(v), 4000);
    return;
  }
  if (!sending) return; // nichts lief – Liste nicht unnötig neu laden
  sending = false; LC.clear();
  toast(q.failed.length ? `${q.sent} gesendet, ${q.failed.length} nicht gesendet – siehe Entwürfe.` : `Fertig: ${q.sent} E-Mail(s) gesendet.`, !!q.failed.length);
  if (q.failed.length) console.warn('Nicht gesendet:', q.failed);
  load(v);
}

async function bulk(v, what, ids) {
  if (!ids.length) return;
  if (what === 'purge' && !confirm(`${ids.length} E-Mail(s) endgültig löschen?`)) return;
  const body = what === 'purge' ? { action: 'purge', ids } : what === 'read' ? { action: 'mark', ids, read: true } : { action: 'mark', ids, folder: what };
  const r = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) { toast(r.data?.error || 'Fehler', true); return; }
  if (ids.includes(S.open)) { S.open = null; $('#pfRead').innerHTML = ''; v.querySelector('.pf')?.classList.remove('reading'); }
  load(v);
}

async function openMsg(v, id, restoring) {
  const it = S.items.find((x) => x.id === id);
  if (it && it.direction === 'out' && it.status !== 'gesendet' && it.design === 'frei') { compose({ id }); return; }
  S.open = id; drawList(v);
  const rd = $('#pfRead'); rd.innerHTML = '<p class="lr-ld" role="status">Lädt …</p>';
  v.querySelector('.pf')?.classList.add('reading');
  const c = MC.get(id);
  const r = c && Date.now() - c.at < MSG_TTL ? await c.p : await api0('/api/admin/mail?id=' + id);
  if (S.open !== id) return;
  if (!r.ok) { MC.delete(id); if (restoring) { remember(null); S.open = null; rd.innerHTML = ''; v.querySelector('.pf')?.classList.remove('reading'); drawList(v); return; } rd.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Fehler')}</p>`; return; }
  remember(id);
  const { message: m, thread, contact, party, legal } = r.data;
  // Rechtsgrundlage (Server): Werbung ohne Einwilligung bzw. bei Widerspruch ist gesperrt – „Senden“ dann deaktiviert.
  const noBasis = Boolean(legal && legal.basis === 'fehlt');
  // Vorherige/nächste Mail in der aktuellen Liste (Ordner bzw. Suche).
  const pos = S.items.findIndex((x) => x.id === id), prevId = pos > 0 ? S.items[pos - 1].id : null, nextId = pos >= 0 && pos < S.items.length - 1 ? S.items[pos + 1].id : null;
  if (it && !it.read_at) { it.read_at = new Date().toISOString(); if (it.state === 'neu') it.state = it.direction === 'in' ? 'offen' : it.state; LC.delete(S.folder); drawList(v); }
  const draft = m.direction === 'out' && m.status !== 'gesendet';
  rd.innerHTML = `<div class="pf-rh"><div class="pf-nav2"><button type="button" class="btn btn-ghost btn-sm pf-back" id="pfBack">← Liste</button>${pos >= 0 ? `<span class="pf-pos">${pos + 1} / ${S.items.length}</span><button type="button" class="btn btn-ghost btn-sm" id="pfPrevMsg"${prevId ? '' : ' disabled'} aria-label="Vorherige E-Mail">‹ Vorherige</button><button type="button" class="btn btn-ghost btn-sm" id="pfNextMsg"${nextId ? '' : ' disabled'} aria-label="Nächste E-Mail">Nächste ›</button>` : ''}</div><h2>${esc(m.subject || '(ohne Betreff)')}</h2>
      ${m.auth?.threat?.score >= 5 ? `<div class="pt-alert bad"><strong>Vorsicht – vermutlich Phishing oder Schadsoftware.</strong> ${m.auth.threat.reasons.map(esc).join(' · ')}. Links und Bilder wurden entfernt; keine Anhänge öffnen.</div>` : m.auth?.threat?.reasons?.length ? `<p class="form-note">Hinweis: ${m.auth.threat.reasons.map(esc).join(' · ')}</p>` : ''}
      ${m.direction === 'in' && m.auth?.unsub ? `<p class="form-note pf-unsub">${m.auth.unsubscribed_at ? `<span class="st ok">Abbestellt</span> am ${esc(dtt(m.auth.unsubscribed_at))} – weitere Mails dieses Absenders kommen ins Archiv.` : '<button type="button" class="btn btn-outline btn-sm" id="pfUnsub">Abbestellen</button> Sendet die Abmeldung automatisch an den Absender.'}</p>` : ''}
      ${party ? `<div class="pf-party${party.known ? ' known' : ''}"><p>${party.known ? '<span class="pf-known">✓ Vertraut</span> ' : '<span class="st">Neu</span> '}<strong>${esc(party.email)}</strong>${party.known ? ` · Austausch vorhanden (${party.sent} E-Mail(s) von uns)` : ' · noch kein Austausch mit dieser Adresse'}</p>${party.history.length ? `<details${party.known ? ' open' : ''}><summary>Frühere E-Mails (${party.history.length})</summary><ul class="pf-hist">${party.history.map((h) => `<li><button type="button" class="pf-hl" data-hist="${esc(h.id)}"><span class="pf-hd">${h.direction === 'in' ? '↙ Von' : '↗ An'} · ${esc(when(h))}</span><b>${esc(h.subject || '(ohne Betreff)')}</b><small>${esc((h.snippet || '').slice(0, 110))}</small></button></li>`).join('')}</ul></details>` : ''}</div>` : ''}
      ${contact ? `<p class="form-note">Akquise-Kontakt: <strong>${esc(contact.company)}</strong>${contact.contact_name ? ` · ${esc(contact.contact_name)}` : ''} · Status ${esc(contact.status)}</p>` : ''}
      ${m.direction === 'out' && (m.research_url || m.research_summary || m.research_flag) ? `<details class="pf-src" open><summary>Recherche zum Empfänger <small>(nur intern – wird nicht mitgesendet)</small></summary>
        ${m.research_flag ? `<div class="pt-alert bad"><strong>${esc(m.research_flag)}</strong></div>` : ''}
        ${m.research_summary ? `<p>${esc(m.research_summary)}</p>` : ''}
        ${/^https:\/\//.test(m.research_url || '') ? `<p class="form-note">Adresse gefunden auf: <a href="${esc(m.research_url)}" target="_blank" rel="noopener noreferrer">${esc(m.research_url.replace(/^https:\/\/(www\.)?/, '').slice(0, 90))}</a>${m.research_checked_at ? ` · geprüft ${esc(dtt(m.research_checked_at))}` : ''}</p>` : ''}</details>` : ''}
      ${draft ? `<div class="pf-rcp" id="pfRcp"><label class="pf-fld"><span>An</span><input name="to" value="${esc((m.to_emails || []).join(', '))}" autocomplete="off" inputmode="email"></label>
        <label class="pf-fld"><span>Cc</span><input name="cc" value="${esc((m.cc_emails || []).join(', '))}" autocomplete="off" inputmode="email" placeholder="optional"></label>
        <label class="pf-fld"><span>Bcc</span><input name="bcc" value="${esc((m.bcc_emails || []).join(', '))}" autocomplete="off" inputmode="email" placeholder="unsichtbar für alle anderen"></label></div>` : ''}
      ${draft && legal ? `<p class="form-note pf-legal"><span class="st${legal.kind === 'werbung' ? ' warn' : ''}">${legal.kind === 'werbung' ? 'Werbung' : 'Transaktion/Antwort'}</span> <span class="st ${noBasis ? 'bad' : 'ok'}">${esc(legal.label)}</span>${noBasis && legal.reason ? ` · Gesperrt: ${esc(legal.reason)}` : ''}${m.status === 'gesperrt' && !noBasis && m.error ? ` · ${esc(m.error)}` : ''}</p>` : ''}
      <div class="pf-ra">${draft ? `<button class="btn btn-dark btn-sm" id="pfSend" type="button"${noBasis ? ' disabled title="Keine Rechtsgrundlage – Senden gesperrt"' : ''}>Senden</button><button class="btn btn-outline btn-sm" id="pfPrev" type="button" title="Schickt die Mail genau so an dich, wie der Empfänger sie sehen würde – nicht an den Empfänger">Vorschau an mich</button>` : `<button class="btn btn-dark btn-sm" id="pfReply" type="button">Antworten</button><button class="btn btn-outline btn-sm" id="pfFwd" type="button">Weiterleiten</button>`}
      <button class="btn btn-ghost btn-sm" data-mv="archive" type="button">Archivieren</button><button class="btn btn-ghost btn-sm" data-mv="${m.folder === 'trash' ? 'inbox' : 'trash'}" type="button">${m.folder === 'trash' ? 'Wiederherstellen' : 'Löschen'}</button>${m.folder === 'spam' ? '<button class="btn btn-ghost btn-sm" data-mv="inbox" type="button">Kein Spam</button>' : m.direction === 'in' ? '<button class="btn btn-ghost btn-sm" data-mv="spam" type="button">Spam</button>' : ''}</div></div>
    ${thread.map((x, xi) => `<article class="pf-msg${x.id === m.id ? ' cur' : ''}${xi < thread.length - 1 ? ' pf-col' : ''}" data-i="${xi}"><header tabindex="0" role="button" aria-expanded="${xi < thread.length - 1 ? 'false' : 'true'}" title="Auf- oder zuklappen"><strong>${esc(x.direction === 'in' ? (x.from_name ? `${x.from_name} <${x.from_email}>` : x.from_email) : `LeaseRun <${x.from_email}>`)}</strong><span>an ${esc((x.to_emails || []).join(', '))}${(x.cc_emails || []).length ? `, Cc ${esc(x.cc_emails.join(', '))}` : ''}${x.direction === 'out' && (x.bcc_emails || []).length ? `, Bcc ${esc(x.bcc_emails.join(', '))}` : ''}</span><time>${esc(dtt(x.received_at || x.sent_at || x.created_at))}</time>${x.status && x.direction === 'out' ? `<span class="st ${x.status === 'gesendet' ? 'ok' : x.status === 'entwurf' ? '' : 'bad'}">${esc({ gesendet: 'Gesendet', entwurf: 'Entwurf', fehler: 'Fehler', gesperrt: 'Gesperrt' }[x.status] || x.status)}</span>` : ''}${x.direction === 'out' && x.auth?.delivery ? (() => { const dl = x.auth.delivery; return dl.bounced_at ? '<span class="st bad">Nicht zustellbar</span>' : dl.opened_at ? `<span class="st ok">Geöffnet ${esc(dtt(dl.opened_at))}</span>` : dl.delivered_at ? `<span class="st ok">Zugestellt ${esc(dtt(dl.delivered_at))}</span>` : ''; })() : ''}${x.direction === 'in' && x.read_at ? `<span class="st">Gelesen ${esc(dtt(x.read_at))}</span>` : ''}${x.error ? `<small class="pf-err">${esc(x.error)}</small>` : ''}${x.direction === 'out' && x.status === 'entwurf' && x.design !== 'fertig' ? `<button type="button" class="btn btn-dark btn-sm pf-edit" data-edit="${esc(x.id)}">Bearbeiten &amp; senden</button>` : ''}<small class="pf-snip">${esc(String(x.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 140))}</small></header>
      ${(x.attachments || []).filter((a) => !a.inline || x.direction === 'out').length ? `<div class="pf-att">${x.attachments.map((a, i) => (a.inline && x.direction === 'in' ? '' : `<button type="button" class="pf-chip" data-file="${x.id}:${i}">${icon('<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>', 14)}${esc(a.name)} <small>${kb(a.size)}</small></button>`)).join('')}</div>` : ''}
      <iframe class="pf-frame" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin" title="E-Mail-Inhalt"></iframe></article>`).join('')}
    ${m.direction === 'in' ? '<p class="form-note pf-note">Bilder werden geschützt über leaserun.com geladen – der Absender sieht weder Ihre IP-Adresse noch Ihr Gerät.</p>' : ''}`;
  // Verlauf: nur die neueste Mail ist offen, ältere sind eingeklappt (Absender, Datum, erste Zeile) und öffnen sich per
  // Klick. Eingeklappte Mails werden erst beim Aufklappen geladen – das hält lange Verläufe schnell.
  const initFrame = (f, i) => {
    if (f._init) return; f._init = true;
    f.srcdoc = linksNewTab(thread[i].view);
    f.onload = () => fit(f);
    // Sofort anpassen, sobald der Text steht – nicht erst, wenn alle Bilder geladen sind; danach bei jeder Größenänderung
    // (Logos/Banner laden nach) erneut. So erscheint die Mail sofort in voller Breite und ohne leere Kästen.
    let tries = 0;
    const early = () => { const doc = f.contentDocument; if (doc?.body && doc.readyState !== 'loading') { fit(f); try { if (!f._ro) { f._ro = new ResizeObserver(() => { clearTimeout(f._rt); f._rt = setTimeout(() => fit(f), 120); }); f._ro.observe(doc.body); } } catch { /* ohne Beobachter */ } doc.querySelectorAll('img').forEach((im) => { if (!im.complete) im.addEventListener('load', () => fit(f), { once: true }); im.addEventListener('error', () => { im.style.display = 'none'; fit(f); }, { once: true }); }); } else if (tries++ < 40) setTimeout(early, 50); };
    setTimeout(early, 0);
  };
  rd.querySelectorAll('.pf-msg').forEach((art) => {
    const i = Number(art.dataset.i), f = art.querySelector('.pf-frame'), h = art.querySelector('header');
    if (!art.classList.contains('pf-col')) initFrame(f, i);
    const toggle = (e) => {
      if (e.target.closest('a,button,input')) return;
      const open = art.classList.toggle('pf-col') === false;
      h.setAttribute('aria-expanded', String(open));
      if (open) { initFrame(f, i); setTimeout(() => fit(f), 30); }
    };
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
  });
  $('#pfUnsub')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Wird abbestellt …';
    const rr = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'unsubscribe', id: m.id }) });
    if (rr.data?.open) { window.open(rr.data.open, '_blank', 'noopener'); toast(rr.data.error); }
    else toast(rr.ok ? `Abbestellt (${rr.data.how}).` : rr.data?.error || 'Fehler', !rr.ok);
    e.target.disabled = false; e.target.textContent = 'Abbestellen';
  });
  if (!$('#pfBack')) return; // Ansicht inzwischen gewechselt (z. B. zu HQ) – nichts mehr binden
  $('#pfBack').onclick = () => { remember(null); S.open = null; v.querySelector('.pf')?.classList.remove('reading'); drawList(v); };
  if (prevId && $('#pfPrevMsg')) $('#pfPrevMsg').onclick = () => openMsg(v, prevId);
  if (nextId && $('#pfNextMsg')) $('#pfNextMsg').onclick = () => openMsg(v, nextId);
  rd.querySelectorAll('[data-hist]').forEach((b) => b.onclick = () => openMsg(v, b.dataset.hist));
  rd.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => compose({ id: b.dataset.edit }));
  rd.scrollTop = 0; if (rd.getBoundingClientRect().top < 0) rd.scrollIntoView({ block: 'start' });
  rd.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => bulk(v, b.dataset.mv, [m.id]));
  rd.querySelectorAll('[data-file]').forEach((b) => b.onclick = async () => { const rr = await api('/api/admin/mail?file=' + encodeURIComponent(b.dataset.file)); if (rr.ok) window.open(rr.data.url, '_blank', 'noopener'); else toast(rr.data?.error || 'Fehler', true); });
  $('#pfPrev')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Wird gesendet …';
    const rr = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'preview', id: m.id }) });
    toast(rr.ok ? `Vorschau an ${rr.data.to} gesendet – so sieht der Empfänger die Mail.` : rr.data?.error || 'Vorschau fehlgeschlagen', !rr.ok);
    b.disabled = false; b.textContent = 'Vorschau an mich';
  });
  $('#pfSend')?.addEventListener('click', async (e) => {
    const box = $('#pfRcp'), L = (n) => String(box?.querySelector(`[name=${n}]`)?.value || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const to = L('to'), cc = L('cc'), bcc = L('bcc');
    if (!to.length) { toast('Bitte einen Empfänger angeben.', true); box?.querySelector('[name=to]')?.focus(); return; }
    // Keine Rückfrage (Wunsch Feray): „Senden“ ist die Freigabe. Empfänger stehen sichtbar im Feld darüber.
    e.target.disabled = true; e.target.textContent = 'Sendet …';
    const rr = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'send', id: m.id, to, cc, bcc }) });
    // Fehlgeschlagen: Entwurf bleibt offen, damit nichts verloren geht und sofort erneut gesendet werden kann.
    if (!rr.ok) { toast(rr.data?.error || 'Senden fehlgeschlagen.', true); e.target.disabled = false; e.target.textContent = 'Senden'; return; }
    toast(`Gesendet an ${to.join(', ')}.`);
    // Zurück zur Liste – auch am Handy (Lese-Modus beenden, sonst bleibt eine leere weiße Fläche).
    remember(null); S.open = null; rd.innerHTML = ''; v.querySelector('.pf')?.classList.remove('reading');
    LC.delete(S.folder); LC.delete('sent'); LC.delete('drafts');
    load(v); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  const last = thread.filter((x) => x.direction === 'in').pop() || m;
  // Liegt im Verlauf schon ein Antwort-Entwurf (z. B. von Claude vorbereitet), öffnet „Antworten“ genau diesen –
  // bearbeiten, Vorschau, HTML, Senden – statt einen zweiten, leeren Entwurf anzulegen.
  const ready = !draft && thread.filter((x) => x.direction === 'out' && x.status === 'entwurf' && x.design !== 'fertig').pop();
  if (ready) { const b = $('#pfReply'); if (b) { b.textContent = 'Entwurf öffnen & senden'; b.onclick = () => compose({ id: ready.id }); } }
  // Noch kein Entwurf: Claude kann ihn auf Knopfdruck schreiben (sonst passiert das bei neuen Mails automatisch).
  if (!ready && !draft && m.direction === 'in') {
    const ab = document.createElement('button'); ab.type = 'button'; ab.className = 'btn btn-outline btn-sm'; ab.textContent = 'Antwort vorbereiten lassen';
    $('#pfReply')?.after(ab);
    ab.onclick = async () => {
      ab.disabled = true; ab.textContent = 'Wird geschrieben …';
      const rr = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'autodraft', id: last.id }) });
      if (rr.ok && rr.data.id) { toast('Entwurf fertig.'); compose({ id: rr.data.id }); ab.remove(); }
      else { toast(rr.data?.error || 'Nicht möglich.', true); ab.disabled = false; ab.textContent = 'Antwort vorbereiten lassen'; }
    };
  }
  else $('#pfReply')?.addEventListener('click', () => compose({ replyTo: last.id, to: [last.direction === 'in' ? last.from_email : (last.to_emails || [])[0]].filter(Boolean), subject: /^(re|aw):/i.test(m.subject) ? m.subject : `Re: ${m.subject}` }));
  $('#pfFwd')?.addEventListener('click', () => compose({ forward: m.id, subject: /^(wg|fwd?):/i.test(m.subject) ? m.subject : `WG: ${m.subject}`, body: `<p><br></p><p>---------- Weitergeleitete Nachricht ----------<br>Von: ${esc(m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email)}<br>Betreff: ${esc(m.subject)}</p>${String(m.text_body || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}` }));
}

// Links in der E-Mail-Vorschau (z. B. „Termin vorschlagen“) immer in einem neuen Tab öffnen. Im Vorschaurahmen selbst
// dürfen leaserun.com-Seiten aus Sicherheitsgründen nicht laden (Schutz vor Clickjacking) – sonst bleibt eine graue Fläche.
function linksNewTab(html) {
  const h = String(html || '');
  const base = '<base target="_blank">';
  if (/<base\b/i.test(h)) return h.replace(/<base\b[^>]*>/i, base);
  return /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + base) : base + h;
}

// E-Mail immer vollständig zeigen: zu breite Inhalte auf die Rahmenbreite verkleinern, Höhe an den Inhalt anpassen.
// Höhe = größerer Wert aus „ungezoomt gemessen × Zoom“ und „nach dem Zoom gemessen“ – Browser rechnen den Zoom
// unterschiedlich ein; so wird eine Mail nie abgeschnitten (lieber etwas Weißraum unten).
function fit(f) {
  try {
    const doc = f.contentDocument, root = doc.documentElement;
    noInnerScroll(f);
    root.style.zoom = '1';
    const w = f.clientWidth, sw = Math.max(root.scrollWidth, doc.body?.scrollWidth || 0);
    // Nur den Inhalt messen (body), nie die Rahmenhöhe selbst (html ist mindestens so hoch wie der Rahmen) – sonst wächst
    // der Rahmen bei jedem Nachmessen weiter und unter der Mail entsteht eine große leere Fläche.
    const body = doc.body;
    const h0 = body ? Math.max(body.scrollHeight, body.getBoundingClientRect().height) : 600;
    const z = sw > w + 2 ? Math.max(0.3, (w - 2) / sw) : 1;
    root.style.zoom = String(z);
    const h1 = body ? body.getBoundingClientRect().height : 0;
    f.style.height = Math.min(200000, Math.ceil(Math.max(h0 * z, h1)) + 16) + 'px';
  } catch { f.style.height = '900px'; }
}
window.addEventListener('resize', () => document.querySelectorAll('.pf-frame').forEach((f) => fit(f)));

// Scrollen über einer E-Mail: Der Rahmen ist so hoch wie die Mail und darf selbst NICHT scrollen. Dann reicht der
// Browser Mausrad, Touchpad und Wischen von selbst an die Seite bzw. das Fenster darum weiter – in allen Browsern und
// auf dem Handy. (Früher wurde das Mausrad per Skript umgeleitet; das blieb in manchen Browsern hängen.)
function noInnerScroll(f) {
  try {
    f.setAttribute('scrolling', 'no');
    const doc = f.contentDocument;
    if (!doc?.head || doc.getElementById('pfNoScroll')) return;
    const st = doc.createElement('style'); st.id = 'pfNoScroll';
    st.textContent = 'html,body{overflow:hidden!important;height:auto!important;min-height:0!important;max-height:none!important;overscroll-behavior:auto!important}';
    doc.head.append(st);
  } catch { /* fremder Rahmen */ }
}

// ---------- Verfassen ----------
const TOOLS = [['bold', 'B', 'Fett'], ['italic', 'I', 'Kursiv'], ['underline', 'U', 'Unterstrichen'], ['h2', 'Ü', 'Überschrift'], ['insertUnorderedList', '•', 'Liste'], ['insertOrderedList', '1.', 'Nummerierte Liste'], ['blockquote', '❝', 'Hervorhebung'], ['link', '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>', 'Link']];
async function compose(o) {
  let cur = { id: o.id || null, to: o.to || [], cc: [], bcc: [], subject: o.subject || '', body: o.body || '', withUnsub: o.replyTo ? false : true, attachments: [] };
  if (o.id) {
    const r = await api('/api/admin/mail?id=' + o.id);
    if (!r.ok) { toast(r.data?.error || 'Fehler', true); return; }
    const m = r.data.message;
    cur = { id: m.id, to: m.to_emails, cc: m.cc_emails, bcc: m.bcc_emails || [], subject: m.subject, body: m.html || '', withUnsub: m.with_unsub, attachments: m.attachments || [] };
  }
  let d = document.getElementById('pfCompose');
  if (!d) { d = document.createElement('dialog'); d.id = 'pfCompose'; d.className = 'wa-dlg pf-dlg'; document.body.append(d); }
  d.innerHTML = `<form class="wa-dlg-in pf-c" id="pfC"><div class="wa-dlg-h"><h2>${o.replyTo ? 'Antworten' : o.forward ? 'Weiterleiten' : cur.id ? 'Entwurf' : 'Neue E-Mail'}</h2><button class="stage-x" type="button" data-x aria-label="Schließen">×</button></div>
    <label class="pf-fld"><span>Von</span><input value="Support | LeaseRun <${esc(S.data?.mailbox || 'support@leaserun.com')}>" disabled></label>
    <label class="pf-fld"><span>An</span><input name="to" value="${esc(cur.to.join(', '))}" placeholder="name@firma.de, …" autocomplete="off" required></label>
    <label class="pf-fld"><span>Cc</span><input name="cc" value="${esc(cur.cc.join(', '))}" autocomplete="off"></label>
    <label class="pf-fld"><span>Bcc</span><input name="bcc" value="${esc((cur.bcc || []).join(', '))}" autocomplete="off" placeholder="unsichtbar für alle anderen Empfänger"></label>
    <label class="pf-fld"><span>Betreff</span><input name="subject" value="${esc(cur.subject)}" maxlength="300" required></label>
    <div class="pf-tb" role="toolbar" aria-label="Formatierung">${TOOLS.map(([c, l, t]) => `<button type="button" data-cmd="${c}" title="${t}" aria-label="${t}">${l}</button>`).join('')}<button type="button" id="pfHtmlBtn" class="pf-tb-html" title="HTML-Code anzeigen, kopieren und bearbeiten" aria-pressed="false">&lt;/&gt; HTML</button></div>
    <div class="pf-lay" id="pfLay" hidden><iframe class="pf-lif" id="pfLif" title="E-Mail im LeaseRun-Layout" sandbox="allow-same-origin"></iframe></div>
    <div class="pf-ed" id="pfEd" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Nachricht">${cur.body || '<p>Guten Tag,</p><p><br></p>'}</div>
    <div class="pf-code" id="pfSrc" hidden><label class="pf-code-l" for="pfHtml">Kompletter HTML-Code der E-Mail mit Layout – aktualisiert sich automatisch beim Schreiben</label><textarea id="pfHtml" spellcheck="false" autocomplete="off" readonly></textarea>
      <div class="pf-code-a"><button type="button" class="btn btn-dark btn-sm" id="pfFullCopy">HTML kopieren</button><button type="button" class="btn btn-outline btn-sm" id="pfHtmlCopy">Nur Text-HTML kopieren</button></div></div>
    <p class="form-note pf-sig" id="pfSig">Layout wird geladen … Logo, „Viele Grüße“, Unterschrift, Kontaktdaten und Impressum kommen automatisch dazu.</p>
    <div class="pf-att" id="pfAtt"></div>
    <div class="pf-cf"><label class="pf-file btn btn-outline btn-sm">${icon('<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>', 16)}Anhang<input type="file" id="pfFile" multiple hidden></label>
      <label class="pf-un"><input type="checkbox" name="unsub"${cur.withUnsub ? ' checked' : ''}> Abmeldelink anhängen</label><span class="pf-sp"></span>
      <button class="btn btn-ghost btn-sm" type="button" id="pfCopy" title="Kopiert die fertige E-Mail mit Layout – zum Einfügen in Outlook, Gmail o. Ä.">Mit Layout kopieren</button><button class="btn btn-ghost btn-sm" type="button" id="pfPrev">Vorschau</button><button class="btn btn-outline btn-sm" type="button" id="pfSave">Entwurf speichern</button><button class="btn btn-dark" type="submit">Senden</button></div></form>`;
  if (!d.open) d.showModal();
  let ed = $('#pfEd', d), edDoc = document;
  const f = $('#pfC', d);
  const drawAtt = () => { $('#pfAtt', d).innerHTML = cur.attachments.map((a, i) => `<span class="pf-chip">${esc(a.name)} <small>${kb(a.size)}</small><button type="button" data-rm="${i}" aria-label="Entfernen">×</button></span>`).join(''); $('#pfAtt', d).querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => { const rr = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'detach', id: cur.id, index: Number(b.dataset.rm) }) }); if (rr.ok) { cur.attachments = rr.data.attachments; drawAtt(); } }); };
  drawAtt();
  const list = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const payload = (extra = {}) => ({ action: 'save', id: cur.id || undefined, to: list(f.to.value), cc: list(f.cc.value), bcc: list(f.bcc.value), subject: f.subject.value, body: ed.innerHTML, withUnsub: f.unsub.checked, ...(cur.id ? {} : { replyTo: o.replyTo, forward: o.forward }), ...extra });
  const save = async (extra) => { const r = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify(payload(extra)) }); if (r.data?.id) cur.id = r.data.id; return r; };
  d.querySelectorAll('[data-cmd]').forEach((b) => b.onclick = () => {
    ed.focus(); const c = b.dataset.cmd;
    if (c === 'link') { const u = prompt('Link-Adresse (https://…)', 'https://'); if (u && /^(https?:|mailto:)/.test(u)) edDoc.execCommand('createLink', false, u); }
    else if (c === 'h2' || c === 'blockquote') edDoc.execCommand('formatBlock', false, c);
    else edDoc.execCommand(c);
  });
  const bindPaste = (el, doc) => el.addEventListener('paste', (e) => { const t = e.clipboardData?.getData('text/plain'); if (t != null && !e.clipboardData.types.includes('text/html')) return; e.preventDefault(); doc.execCommand('insertText', false, t || ''); });
  bindPaste(ed, document);
  // Schließen (×, Esc oder Klick auf die abgedunkelte Fläche daneben): Eingaben werden vorher gespeichert. Klappt das Speichern
  // nicht, bleibt das Fenster offen und zeigt den Grund – so geht kein Entwurf mehr verloren.
  const snap = () => JSON.stringify([f.to.value, f.cc.value, f.bcc.value, f.subject.value, ed.innerHTML]);
  let start = snap();
  const dirty = () => snap() !== start;
  // Fertiges LeaseRun-Layout direkt im Fenster (Wunsch Feray): Logo, Gruß, Unterschrift, Fußzeile und bei Antworten der
  // zitierte Verlauf stehen fest – änderbar ist nur der Text im markierten Feld. Klappt das Laden nicht, bleibt das
  // einfache Textfeld (Layout kommt dann wie bisher beim Senden dazu).
  const MARK = 'PFBODYMARK7Q';
  (async () => {
    const r = await api0('/api/admin/mail', { method: 'POST', body: JSON.stringify(payload({ preview: true, body: `<p>${MARK}</p>` })) }).catch(() => null);
    const sig = $('#pfSig', d);
    if (!r?.ok || !d.open) { if (sig) sig.textContent = 'Darunter automatisch: „Viele Grüße“, Foto, Unterschrift, Kontaktdaten, Impressum – im LeaseRun-Design.'; return; }
    const fr = $('#pfLif', d);
    await new Promise((res) => { fr.onload = res; fr.srcdoc = r.data.preview; });
    const doc = fr.contentDocument;
    const td = doc && [...doc.querySelectorAll('td')].reverse().find((t) => t.textContent.includes(MARK));
    if (!td) { if (sig) sig.textContent = 'Darunter automatisch: „Viele Grüße“, Foto, Unterschrift, Kontaktdaten, Impressum – im LeaseRun-Design.'; return; }
    const st = doc.createElement('style');
    st.textContent = 'a{pointer-events:none}.pf-body{outline:none;min-height:160px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#1e293b;border-radius:8px;box-shadow:0 0 0 2px #bae6fd;padding:8px 10px;margin:-8px -10px;cursor:text}.pf-body:focus{box-shadow:0 0 0 2px #38bdf8}.pf-body p{margin:0 0 16px}.pf-body h2{margin:8px 0 12px;font-size:21px;line-height:28px;font-weight:800;color:#0f2c59}.pf-body ul,.pf-body ol{margin:0 0 16px;padding-left:22px}.pf-body blockquote{margin:0 0 16px;padding:12px 16px;border-left:3px solid #38bdf8;background:#f0f9ff;font-size:15px;line-height:24px;color:#334155}.pf-body a{color:#0284c7;text-decoration:underline}';
    doc.head.append(st);
    const box = doc.createElement('div');
    box.className = 'pf-body'; box.contentEditable = 'true'; box.spellcheck = true;
    box.setAttribute('role', 'textbox'); box.setAttribute('aria-multiline', 'true'); box.setAttribute('aria-label', 'Nachricht');
    const wasDirty = dirty();
    box.innerHTML = ed.innerHTML;
    td.replaceChildren(box);
    bindPaste(box, doc);
    box.addEventListener('input', () => queueFull());
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeDlg(); } });
    ed.hidden = true; ed = box; edDoc = doc;
    if (!wasDirty) start = snap();
    $('#pfLay', d).hidden = false;
    if (sig) sig.textContent = 'So kommt die E-Mail an. Nur der Text im blauen Rahmen ist änderbar – Layout, Gruß, Unterschrift und Fußzeile bleiben immer gleich.';
    fit(fr);
    try { const ro = new ResizeObserver(() => { clearTimeout(fr._rt); fr._rt = setTimeout(() => fit(fr), 80); }); ro.observe(doc.body); } catch { /* ohne Beobachter */ }
    doc.querySelectorAll('img').forEach((im) => { if (!im.complete) im.addEventListener('load', () => fit(fr), { once: true }); });
    box.focus();
  })();
  const reload = () => { const v = document.querySelector('.pf')?.parentElement; if (v) load(v); };
  // Mehrere Empfänger in einem neuen Entwurf: je Adresse ein eigener Entwurf (keine Doppelten, niemand sieht die anderen).
  const saveDraft = async () => {
    const to = list(f.to.value);
    if (!cur.id && to.length > 1 && confirm(`Für jede der ${to.length} Adressen einen eigenen Entwurf anlegen?\n\nSo sieht kein Empfänger die anderen. Adressen, an die es schon einen Entwurf oder eine gesendete Mail gibt, werden übersprungen.`)) {
      const r = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify(payload({ split: true })) });
      if (r.ok) { toast(`${r.data.created} Entwürfe angelegt${r.data.skipped?.length ? `, ${r.data.skipped.length} übersprungen (gab es schon): ${r.data.skipped.join(', ')}` : ''}.`); return { ...r, split: true }; }
      return r;
    }
    return save();
  };
  let closing = false;
  const closeDlg = async () => {
    if (closing) return; closing = true;
    try {
      if (dirty() || (cur.id && ed.textContent.trim())) {
        const r = await saveDraft();
        if (!r.ok) { toast(`Nicht gespeichert: ${r.data?.error || 'Fehler'} – Fenster bleibt offen.`, true); return; }
        if (!r.split) toast('Entwurf gespeichert.');
      }
      d.close(); reload();
    } finally { closing = false; }
  };
  $('[data-x]', d).onclick = closeDlg;
  d.oncancel = (e) => { e.preventDefault(); closeDlg(); };
  d.onmousedown = (e) => { d._down = e.target === d; };
  d.onclick = (e) => { if (e.target !== d || !d._down) return; const b = d.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) closeDlg(); };
  $('#pfSave', d).onclick = async () => { const r = await saveDraft(); if (r.split) { d.close(); reload(); return; } toast(r.ok ? 'Entwurf gespeichert.' : r.data?.error || 'Fehler', !r.ok); };
  // HTML-Ansicht (Wunsch Feray): Code des Textes sehen, kopieren und direkt bearbeiten; das komplette E-Mail-HTML
  // (mit Layout, Signatur, Fußzeile) lässt sich ebenfalls als Code kopieren.
  const src = $('#pfSrc', d), ta = $('#pfHtml', d), hb = $('#pfHtmlBtn', d);
  // Immer das komplette HTML mit Layout (Logo, Gruß, Unterschrift, Fußzeile) – genau das, was beim Empfänger ankommt.
  let fullSeq = 0, fullT;
  const refreshFull = async () => {
    const my = ++fullSeq;
    const r = await api0('/api/admin/mail', { method: 'POST', body: JSON.stringify(payload({ preview: true })) }).catch(() => null);
    if (my !== fullSeq || src.hidden) return;
    ta.value = r?.ok ? r.data.preview : (r?.data?.error || 'HTML konnte nicht geladen werden.');
  };
  const queueFull = () => { if (src.hidden) return; clearTimeout(fullT); fullT = setTimeout(refreshFull, 600); };
  hb.onclick = () => { const on = src.hidden; src.hidden = !on; hb.setAttribute('aria-pressed', String(on)); if (on) { ta.value = 'Wird geladen …'; refreshFull(); } };
  d.addEventListener('input', queueFull);
  ed.addEventListener?.('input', queueFull);
  const copyText = async (t, ok) => { try { await navigator.clipboard.writeText(t); toast(ok); } catch { toast('Kopieren nicht möglich – bitte im Browser die Zwischenablage erlauben.', true); } };
  $('#pfHtmlCopy', d).onclick = () => copyText(ed.innerHTML, 'HTML-Code des Textes kopiert.');
  $('#pfFullCopy', d).onclick = async () => { const r = await api0('/api/admin/mail', { method: 'POST', body: JSON.stringify(payload({ preview: true })) }); if (!r.ok) { toast(r.data?.error || 'Fehler', true); return; } ta.value = r.data.preview; copyText(r.data.preview, 'HTML kopiert – komplett mit Layout.'); };
  $('#pfCopy', d).onclick = async () => {
    const r = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify(payload({ preview: true })) });
    if (!r.ok) { toast(r.data?.error || 'Fehler', true); return; }
    const html = r.data.preview;
    const tmp = document.createElement('div'); tmp.innerHTML = html.replace(/<(style|title)[\s\S]*?<\/\1>/gi, '');
    const text = tmp.innerText.replace(/\n{3,}/g, '\n\n').trim();
    try {
      if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      else await navigator.clipboard.writeText(html);
      toast('Kopiert – mit Layout. In Outlook, Gmail o. Ä. einfach einfügen.');
    } catch { toast('Kopieren nicht möglich – bitte im Browser die Zwischenablage erlauben.', true); }
  };
  $('#pfPrev', d).onclick = async () => {
    const r = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify(payload({ preview: true })) });
    if (!r.ok) { toast(r.data?.error || 'Fehler', true); return; }
    let p = document.getElementById('pfPv'); if (!p) { p = document.createElement('dialog'); p.id = 'pfPv'; p.className = 'wa-dlg'; document.body.append(p); }
    p.innerHTML = `<div class="wa-dlg-in mk-pv"><div class="wa-dlg-h"><h2>Vorschau</h2><button class="stage-x" data-x aria-label="Schließen">×</button></div><div class="mk-pv-sw" role="group" aria-label="Ansicht"><button type="button" class="on" data-w="390">Handy</button><button type="button" data-w="680">Desktop</button></div><iframe class="mk-pv-if" title="Vorschau" sandbox="allow-popups allow-popups-to-escape-sandbox" style="width:390px"></iframe></div>`;
    p.querySelector('iframe').srcdoc = linksNewTab(r.data.preview); p.showModal();
    p.querySelector('[data-x]').onclick = () => p.close();
    p.onclick = (e) => { if (e.target !== p) return; const b = p.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) p.close(); };
    p.querySelectorAll('[data-w]').forEach((x) => x.onclick = () => { p.querySelectorAll('[data-w]').forEach((y) => y.classList.toggle('on', y === x)); p.querySelector('iframe').style.width = x.dataset.w + 'px'; });
  };
  $('#pfFile', d).onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (!cur.id) { const r = await save(); if (!r.ok) { toast(r.data?.error || 'Bitte zuerst Empfänger und Betreff angeben.', true); return; } }
    for (const file of files) {
      const u = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'uploadUrl', id: cur.id, name: file.name, size: file.size }) });
      if (!u.ok) { toast(u.data?.error || 'Upload nicht möglich.', true); continue; }
      const put = await fetch(u.data.url, { method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file }).catch(() => null);
      if (!put?.ok) { toast(`„${file.name}“ konnte nicht hochgeladen werden.`, true); continue; }
      const a = await api('/api/admin/mail', { method: 'POST', body: JSON.stringify({ action: 'attach', id: cur.id, path: u.data.path, name: file.name, type: file.type || 'application/octet-stream', size: file.size }) });
      if (a.ok) { cur.attachments = a.data.attachments; drawAtt(); }
    }
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const to = list(f.to.value);
    if (!to.length) { toast('Bitte einen Empfänger angeben.', true); return; }
    // Keine Rückfrage (Wunsch Feray): „Senden“ ist die Freigabe.
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Sendet …';
    const r = await save({ send: true });
    btn.disabled = false; btn.textContent = 'Senden';
    if (!r.ok) { toast(r.data?.error || 'Senden fehlgeschlagen.', true); return; }
    toast('Gesendet.'); d.close();
    const v = document.querySelector('.pf')?.parentElement; if (v) load(v);
  };
}
