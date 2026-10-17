// Web-Admin: Akquise-Zentrale (Kontakte, Serienbriefe, Anrufe, Verlauf) und Werbungszentrale
// (Kampagnen mit Tracking-Link und QR-Code, Erfolgsmessung, Neuigkeiten-E-Mails nur mit Double-Opt-in).
import { api, download, dt, dtt, esc } from './sess.mjs';

const $ = (s, r = document) => r.querySelector(s);
const KIND = { bank: 'Bank / Sparkasse', vermittler: 'Finanzierungsvermittler', makler: 'Immobilienmakler', finanzberater: 'Finanz-/Vermögensberater', sonstige: 'Sonstige' };
const STATUS = { neu: 'Neu', angeschrieben: 'Angeschrieben', angerufen: 'Angerufen', interesse: 'Interesse', termin: 'Termin', kunde: 'Kunde', kein_interesse: 'Kein Interesse', widerspruch: 'Werbewiderspruch' };
const CHANNEL = { brief: 'Brief', qr: 'QR-Code / Flyer', link: 'Link', newsletter: 'Neuigkeiten-E-Mail', social: 'Social Media', anzeige: 'Anzeige', messe: 'Messe / Event' };
const today = () => new Date().toISOString().slice(0, 10);
const slugify = (t) => String(t).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const toast = (t, bad) => { let el = $('#mkToast'); if (!el) { el = document.createElement('div'); el.id = 'mkToast'; el.className = 'pt-toast'; document.body.append(el); } el.textContent = t; el.style.background = bad ? '#991B1B' : ''; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 3200); };
const dlg = (id) => { let d = document.getElementById(id); if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'ad-dlg'; document.body.append(d); } return d; };

const BRIEF_DEFAULT = `wenn Ihre Kunden zum ersten Gespräch kommen, fehlen oft noch Unterlagen – und die Vorprüfung kostet Zeit, bevor die eigentliche Beratung beginnt.

ImmoAdv bereitet Ihre Kunden vor: Selbstauskunft, Objektdaten und Unterlagen kommen strukturiert bei Ihnen an, mit Bankreife, Zins-Stresstest und Kreditmappe nach banküblichen Kriterien. Mit der Fall-Analyse laden Sie das Unterlagen-Paket eines Kunden hoch und erhalten in Sekunden eine Auswertung und eine Präsentation – auf Wunsch komplett im Erscheinungsbild Ihres Hauses.

Gern zeige ich Ihnen das in 15 Minuten. Scannen Sie einfach den QR-Code oder antworten Sie mir per E-Mail an support@immoadv.de.`;
const CALL = `Guten Tag, mein Name ist … von ImmoAdv aus Reinheim. Ich rufe an, weil wir Baufinanzierungsberatern die Vorbereitung von Fällen abnehmen – haben Sie zwei Minuten?

• Kurz: Kunden laden ihre Unterlagen bei uns hoch, Sie sehen Bankreife und fehlende Unterlagen, bevor der Termin beginnt.
• Fall-Analyse: PDF-Paket eines Kunden hochladen → Auswertung und Präsentation im Design Ihres Hauses.
• Frage: Wie viel Zeit geht bei Ihnen heute für Unterlagen-Nachforderungen drauf?
• Angebot: 15-Minuten-Vorführung per Video – passt Ihnen …?

Bei „kein Interesse“: bedanken, Status setzen. Bei „bitte keine Werbung“: sofort „Werbewiderspruch“ setzen.`;
const LINKEDIN = `Hallo …, ich sehe, Sie beraten in der Baufinanzierung bei {firma}. Wir haben mit ImmoAdv ein Werkzeug gebaut, das Kunden vor dem Erstgespräch vollständig vorbereitet – Unterlagen, Bankreife, Zins-Stresstest – und aus einem PDF-Paket in Sekunden eine Fall-Analyse samt Kundenpräsentation macht. Hätten Sie Lust auf einen kurzen Austausch, ob das bei Ihnen Zeit spart?`;

// ---------------- Akquise ----------------
let CRM = { list: [], q: '', st: '', kind: '', due: false, sel: new Set() };
export async function akquise(v) {
  const r = await api('/api/admin/akquise');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  CRM.list = r.data.contacts || [];
  const L = CRM.list, cnt = (f) => L.filter(f).length, td = today();
  v.innerHTML = `<section class="ad-over"><div class="ad-over-h"><h2>Akquise-Zentrale</h2><p class="form-note">Geschäftskontakte pflegen, Serienbriefe mit QR-Code erzeugen, Anrufe und LinkedIn-Kontakte protokollieren – und jederzeit sehen, wer was wann bekommen hat.</p></div>
    <div class="ad-tiles">${[['Kontakte', L.length, ''], ['Heute fällig', cnt((c) => c.next_at && c.next_at <= td && !['kunde', 'widerspruch', 'kein_interesse'].includes(c.status)), 'warn'], ['Angeschrieben', cnt((c) => c.status === 'angeschrieben'), ''], ['Interesse / Termin', cnt((c) => ['interesse', 'termin'].includes(c.status)), 'ok'], ['Kunden', cnt((c) => c.status === 'kunde'), 'ok'], ['Werbewiderspruch', cnt((c) => c.status === 'widerspruch'), '']].map(([l, n, t]) => `<div class="ad-tile ${n && t ? t : ''}"><span class="ad-tile-l">${l}</span><strong>${n}</strong></div>`).join('')}</div>
    <details class="ad-help"><summary>Was ist erlaubt? (kurz erklärt)</summary>
      <p><strong>Briefe</strong> an Unternehmen sind erlaubt, solange kein Werbewiderspruch vorliegt. Jeder Brief enthält automatisch den Hinweis zur Datenherkunft und zum Widerspruchsrecht (Art. 14, 21 DSGVO).</p>
      <p><strong>Anrufe</strong> bei Unternehmen nur bei mutmaßlichem Interesse (§ 7 Abs. 2 Nr. 1 UWG) – z. B. wenn ein konkreter Bezug zum Geschäft des Angerufenen besteht. Im Zweifel erst schreiben.</p>
      <p><strong>Werbe-E-Mails</strong> nur an Empfänger, die über das Formular eingewilligt und bestätigt haben (Reiter „Werbung“ → Neuigkeiten). Keine E-Mails an hier gesammelte Adressen.</p>
      <p><strong>Quelle</strong> jedes Kontakts angeben (z. B. „Impressum der Filial-Website“). Bei Widerspruch Status „Werbewiderspruch“ setzen – der Kontakt bleibt als Sperrvermerk erhalten. Auf Löschverlangen „Löschen“ verwenden. Keine Rechtsberatung.</p></details>
    <div class="pt-row mk-bar"><input id="mkQ" placeholder="Suchen (Firma, Ort, Name)" value="${esc(CRM.q)}"><select id="mkSt"><option value="">Alle Status</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${CRM.st === k ? ' selected' : ''}>${l}</option>`).join('')}</select><select id="mkKind"><option value="">Alle Arten</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${CRM.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select><label class="chk"><input type="checkbox" id="mkDue"${CRM.due ? ' checked' : ''}> nur fällige</label></div>
    <div class="pt-row mk-bar"><button class="btn btn-dark" id="mkAdd" type="button">+ Kontakt</button><button class="btn btn-outline" id="mkImp" type="button">CSV importieren</button><button class="btn btn-outline" id="mkBrief" type="button">Serienbrief für Auswahl</button><button class="btn btn-ghost" id="mkScripts" type="button">Anruf- & LinkedIn-Vorlagen</button><span class="form-note" id="mkSel"></span></div>
    <div id="mkTable"></div></section>`;
  const draw = () => {
    const q = CRM.q.toLowerCase();
    const rows = L.filter((c) => (!CRM.st || c.status === CRM.st) && (!CRM.kind || c.kind === CRM.kind) && (!CRM.due || (c.next_at && c.next_at <= td)) && (!q || [c.company, c.branch, c.city, c.contact_name, c.postal_code].join(' ').toLowerCase().includes(q)));
    $('#mkTable').innerHTML = rows.length ? `<div class="ad-wrap"><table class="ad-table mk-table"><thead><tr><th><input type="checkbox" id="mkAll" aria-label="Alle auswählen"></th><th>Unternehmen</th><th>Ansprechpartner</th><th>Ort</th><th>Status</th><th>Wiedervorlage</th><th>Letzter Kontakt</th></tr></thead><tbody>${rows.map((c) => `<tr class="${c.status === 'widerspruch' ? 'mk-off' : ''}"><td><input type="checkbox" data-sel="${c.id}"${CRM.sel.has(c.id) ? ' checked' : ''}${c.status === 'widerspruch' ? ' disabled' : ''}></td><td><button class="text-btn" data-open="${c.id}"><strong>${esc(c.company)}</strong></button>${c.branch ? `<br><small>${esc(c.branch)}</small>` : ''}<br><small>${KIND[c.kind]}</small></td><td>${esc(c.contact_name || '–')}${c.role ? `<br><small>${esc(c.role)}</small>` : ''}</td><td>${esc([c.postal_code, c.city].filter(Boolean).join(' ') || '–')}</td><td><select data-st="${c.id}" aria-label="Status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${c.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td><input type="date" data-next="${c.id}" value="${c.next_at || ''}" class="${c.next_at && c.next_at <= td ? 'due' : ''}"></td><td>${c.last ? `${esc({ brief: 'Brief', anruf: 'Anruf', email: 'E-Mail', linkedin: 'LinkedIn', termin: 'Termin', notiz: 'Notiz', status: 'Status' }[c.last.type] || c.last.type)}<br><small>${dt(c.last.at)}</small>` : '–'}</td></tr>`).join('')}</tbody></table></div><p class="form-note">${rows.length} von ${L.length} Kontakten</p>` : '<p class="form-note">Keine Kontakte. Mit „+ Kontakt“ oder „CSV importieren“ beginnen.</p>';
    $('#mkSel').textContent = CRM.sel.size ? `${CRM.sel.size} ausgewählt` : '';
    $('#mkAll')?.addEventListener('change', (e) => { rows.filter((c) => c.status !== 'widerspruch').forEach((c) => (e.target.checked ? CRM.sel.add(c.id) : CRM.sel.delete(c.id))); draw(); });
    v.querySelectorAll('[data-sel]').forEach((x) => x.onchange = () => { x.checked ? CRM.sel.add(x.dataset.sel) : CRM.sel.delete(x.dataset.sel); $('#mkSel').textContent = CRM.sel.size ? `${CRM.sel.size} ausgewählt` : ''; });
    v.querySelectorAll('[data-open]').forEach((x) => x.onclick = () => openContact(x.dataset.open, () => akquise(v)));
    v.querySelectorAll('[data-st]').forEach((x) => x.onchange = async () => { if (x.value === 'widerspruch' && !confirm('Werbewiderspruch eintragen? Der Kontakt erhält dann keine Briefe mehr.')) { draw(); return; } const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'status', ids: [x.dataset.st], status: x.value }) }); if (rr.ok) { const c = L.find((y) => y.id === x.dataset.st); c.status = x.value; toast('Status gespeichert.'); } else toast(rr.data?.error || 'Fehler', true); });
    v.querySelectorAll('[data-next]').forEach((x) => x.onchange = async () => { const c = L.find((y) => y.id === x.dataset.next); const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'status', ids: [c.id], status: c.status, nextAt: x.value || null }) }); if (rr.ok) { c.next_at = x.value || null; toast('Wiedervorlage gespeichert.'); } });
  };
  draw();
  $('#mkQ').oninput = (e) => { CRM.q = e.target.value; draw(); };
  $('#mkSt').onchange = (e) => { CRM.st = e.target.value; draw(); };
  $('#mkKind').onchange = (e) => { CRM.kind = e.target.value; draw(); };
  $('#mkDue').onchange = (e) => { CRM.due = e.target.checked; draw(); };
  $('#mkAdd').onclick = () => editContact(null, () => akquise(v));
  $('#mkImp').onclick = () => importCsv(() => akquise(v));
  $('#mkBrief').onclick = () => { const ids = [...CRM.sel]; if (!ids.length) { toast('Bitte zuerst Kontakte auswählen.', true); return; } letters(ids, () => { CRM.sel.clear(); akquise(v); }); };
  $('#mkScripts').onclick = () => { const d = dlg('mkScr'); d.innerHTML = `<div class="ad-dlg-in"><div class="ad-dlg-h"><h2>Vorlagen</h2><button class="stage-x" data-x aria-label="Schließen">×</button></div><h3 class="ad-sub">Anruf-Leitfaden</h3><textarea rows="12" readonly class="mk-tpl">${esc(CALL)}</textarea><h3 class="ad-sub">LinkedIn-Nachricht (persönlich senden)</h3><textarea rows="6" readonly class="mk-tpl">${esc(LINKEDIN)}</textarea><p class="form-note">Kontakt danach im Kontakt-Dialog als „Anruf“ bzw. „LinkedIn“ protokollieren.</p></div>`; d.querySelector('[data-x]').onclick = () => d.close(); d.showModal(); };
}

const F = [['company', 'Unternehmen*'], ['branch', 'Filiale / Abteilung'], ['salutation', 'Anrede', 'sel'], ['contactName', 'Ansprechpartner'], ['role', 'Funktion'], ['street', 'Straße'], ['postalCode', 'PLZ'], ['city', 'Ort'], ['phone', 'Telefon'], ['email', 'E-Mail (geschäftlich)'], ['website', 'Website']];
const fromRow = (c) => ({ company: c.company, branch: c.branch, salutation: c.salutation, contactName: c.contact_name, role: c.role, street: c.street, postalCode: c.postal_code, city: c.city, phone: c.phone, email: c.email, website: c.website, kind: c.kind, source: c.source, notes: c.notes, nextAt: c.next_at });
function editContact(c, done) {
  const d = dlg('mkEdit'), x = c ? fromRow(c) : { kind: 'bank' };
  d.innerHTML = `<form class="ad-dlg-in" id="mkF"><div class="ad-dlg-h"><h2>${c ? 'Kontakt bearbeiten' : 'Kontakt anlegen'}</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
    <div class="ad-grid2"><label>Art<select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${x.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    ${F.map(([k, l, t]) => t === 'sel' ? `<label>${l}<select name="${k}">${['', 'Frau', 'Herr'].map((a) => `<option${(x[k] || '') === a ? ' selected' : ''}>${a}</option>`).join('')}</select></label>` : `<label>${l}<input name="${k}" value="${esc(x[k] || '')}"${k === 'company' ? ' required' : ''}${k === 'postalCode' ? ' pattern="[0-9]{5}"' : ''}></label>`).join('')}
    <label class="full">Quelle der Daten* <input name="source" required minlength="3" value="${esc(x.source || '')}" placeholder="z. B. Impressum der Filial-Website, Visitenkarte Messe X"></label>
    <label>Wiedervorlage<input type="date" name="nextAt" value="${x.nextAt || ''}"></label>
    <label class="full">Notizen<textarea name="notes" rows="3" maxlength="2000">${esc(x.notes || '')}</textarea></label></div>
    <p class="auth-message error" id="mkErr" hidden></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Abbrechen</button><button type="submit" class="btn btn-dark">Speichern</button></div></form>`;
  d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
  d.querySelector('#mkF').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); f.nextAt = f.nextAt || null;
    const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify(c ? { action: 'update', id: c.id, contact: f } : { action: 'create', contact: f }) });
    if (!rr.ok) { const m = d.querySelector('#mkErr'); m.textContent = rr.data?.error || 'Fehler'; m.hidden = false; return; }
    d.close(); toast('Gespeichert.'); done?.();
  };
  d.showModal();
}

async function openContact(id, done) {
  const r = await api('/api/admin/akquise?id=' + id);
  if (!r.ok) { toast(r.data?.error || 'Fehler', true); return; }
  const c = r.data.contact, acts = r.data.activities || [];
  const d = dlg('mkOpen');
  const T = { brief: '✉ Brief', anruf: '☎ Anruf', email: '@ E-Mail', linkedin: 'in LinkedIn', termin: '📅 Termin', notiz: '✎ Notiz', status: '• Status' };
  d.innerHTML = `<div class="ad-dlg-in"><div class="ad-dlg-h"><h2>${esc(c.company)}</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
    <dl class="pt-dl">${[['Art', KIND[c.kind]], ['Filiale', c.branch], ['Ansprechpartner', [c.salutation, c.contact_name].filter(Boolean).join(' ')], ['Funktion', c.role], ['Anschrift', [c.street, [c.postal_code, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['Telefon', c.phone], ['E-Mail', c.email], ['Website', c.website], ['Status', STATUS[c.status]], ['Wiedervorlage', c.next_at ? dt(c.next_at) : null], ['Quelle', c.source], ['Notizen', c.notes]].filter(([, x]) => x).map(([k, x]) => `<div><dt>${k}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>
    ${c.status === 'widerspruch' ? '<p class="pt-alert warn">Werbewiderspruch – keine Briefe, Anrufe oder Werbung mehr.</p>' : `<form class="mk-log" id="mkLog"><select name="type"><option value="anruf">Anruf</option><option value="linkedin">LinkedIn</option><option value="email">E-Mail (Antwort/Einzelkontakt)</option><option value="termin">Termin vereinbart</option><option value="notiz">Notiz</option></select><input name="note" placeholder="Ergebnis / Notiz" maxlength="1000"><input type="date" name="nextAt" aria-label="Wiedervorlage"><button class="btn btn-dark" type="submit">Protokollieren</button></form>`}
    <h3 class="ad-sub">Verlauf</h3>${acts.length ? `<ul class="mk-acts">${acts.map((a) => `<li><b>${T[a.type] || esc(a.type)}</b><span>${esc(a.note || '')}${a.campaign ? ` <small>Kampagne ${esc(a.campaign)}</small>` : ''}</span><small>${dtt(a.at)}${a.actor ? ' · ' + esc(a.actor) : ''}</small></li>`).join('')}</ul>` : '<p class="form-note">Noch kein Kontakt.</p>'}
    <div class="wiz-nav"><button type="button" class="btn btn-ghost mk-del" id="mkDel">Löschen</button><span class="pt-row">${c.status === 'widerspruch' ? '' : '<button type="button" class="btn btn-outline" id="mkObj">Werbewiderspruch</button>'}<button type="button" class="btn btn-outline" id="mkEd">Bearbeiten</button></span></div></div>`;
  d.querySelector('[data-x]').onclick = () => d.close();
  d.querySelector('#mkEd').onclick = () => { d.close(); editContact(c, done); };
  d.querySelector('#mkObj')?.addEventListener('click', async () => { if (!confirm('Werbewiderspruch eintragen?')) return; await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'status', ids: [c.id], status: 'widerspruch' }) }); d.close(); done?.(); });
  d.querySelector('#mkDel').onclick = async () => { if (!confirm('Kontakt mit Verlauf endgültig löschen? (z. B. auf Löschverlangen) – bei Werbewiderspruch besser den Sperrvermerk behalten.')) return; await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'delete', ids: [c.id] }) }); d.close(); done?.(); };
  d.querySelector('#mkLog')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'log', id: c.id, type: f.type, note: f.note || undefined, ...(f.nextAt ? { nextAt: f.nextAt } : {}) }) }); if (rr.ok) { toast('Protokolliert.'); openContact(id, done); done?.(); } else toast(rr.data?.error || 'Fehler', true); });
  if (!d.open) d.showModal();
}

// CSV: Spaltennamen (deutsch) → Felder. Trennzeichen ; oder , – erste Zeile = Überschriften.
const MAP = { firma: 'company', unternehmen: 'company', filiale: 'branch', abteilung: 'branch', ansprechpartner: 'contactName', name: 'contactName', anrede: 'salutation', funktion: 'role', position: 'role', strasse: 'street', straße: 'street', adresse: 'street', plz: 'postalCode', ort: 'city', stadt: 'city', telefon: 'phone', tel: 'phone', email: 'email', 'e-mail': 'email', website: 'website', web: 'website', art: 'kind', quelle: 'source', notiz: 'notes', notizen: 'notes' };
function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function importCsv(done) {
  const d = dlg('mkImpD');
  d.innerHTML = `<div class="ad-dlg-in"><div class="ad-dlg-h"><h2>Kontakte importieren (CSV)</h2><button class="stage-x" data-x aria-label="Schließen">×</button></div>
    <p class="form-note">Erste Zeile mit Spaltennamen, z. B. <code>Firma;Filiale;Anrede;Ansprechpartner;Funktion;Straße;PLZ;Ort;Telefon;E-Mail;Website;Art;Quelle</code>. Art: bank, vermittler, makler, finanzberater, sonstige. Nur Daten aus zulässigen Quellen (z. B. Impressum, Visitenkarte) – die Quelle wird gespeichert und im Brief genannt.</p>
    <label>Datei<input type="file" id="mkCsv" accept=".csv,text/csv"></label>
    <label>Quelle, falls die Spalte fehlt<input id="mkSrc" placeholder="z. B. Impressum der Websites (Recherche Oktober 2026)"></label>
    <div id="mkPrev"></div><div class="wiz-nav"><button class="btn btn-outline" data-x type="button">Abbrechen</button><button class="btn btn-dark" id="mkGo" type="button" disabled>Importieren</button></div></div>`;
  d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
  let items = [];
  const read = async () => {
    const file = d.querySelector('#mkCsv').files[0]; if (!file) return;
    const rows = parseCsv(await file.text()); const head = rows.shift().map((h) => MAP[h.trim().toLowerCase()] || null);
    const src = d.querySelector('#mkSrc').value.trim();
    items = rows.map((r) => { const o = { kind: 'bank' }; head.forEach((k, i) => { if (k) o[k] = (r[i] || '').trim(); }); if (!KIND[o.kind]) o.kind = 'sonstige'; if (!['Frau', 'Herr'].includes(o.salutation)) o.salutation = ''; if (o.postalCode && !/^\d{5}$/.test(o.postalCode)) o.postalCode = ''; o.source = o.source || src; return o; }).filter((o) => o.company && o.company.length >= 2);
    const bad = items.filter((o) => !o.source || o.source.length < 3).length;
    d.querySelector('#mkPrev').innerHTML = `<p class="form-note">${items.length} Kontakte erkannt${bad ? ` – <strong>${bad} ohne Quelle</strong> (bitte Quelle angeben)` : ''}.</p><div class="ad-wrap"><table class="ad-table"><tbody>${items.slice(0, 5).map((o) => `<tr><td>${esc(o.company)}</td><td>${esc(o.contactName || '')}</td><td>${esc(o.city || '')}</td><td>${esc(o.source || '–')}</td></tr>`).join('')}</tbody></table></div>`;
    d.querySelector('#mkGo').disabled = !items.length || bad > 0;
  };
  d.querySelector('#mkCsv').onchange = read; d.querySelector('#mkSrc').oninput = read;
  d.querySelector('#mkGo').onclick = async () => {
    const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'import', contacts: items.slice(0, 1000).map((o) => ({ ...o, nextAt: null })) }) });
    if (!rr.ok) { toast(rr.data?.error || 'Import fehlgeschlagen.', true); return; }
    d.close(); toast(`${rr.data.n} Kontakte importiert.${rr.data.blocked ? ` ${rr.data.blocked} übersprungen (Werbewiderspruch – Sperrliste).` : ""}`); done?.();
  };
  d.showModal();
}

async function letters(ids, done) {
  const w = await api('/api/admin/werbung');
  const camps = (w.data?.campaigns || []).filter((c) => c.active && c.channel === 'brief');
  const d = dlg('mkLet');
  d.innerHTML = `<form class="ad-dlg-in" id="mkLF"><div class="ad-dlg-h"><h2>Serienbrief an ${ids.length} Kontakt${ids.length === 1 ? '' : 'e'}</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
    <div class="ad-grid2"><label>Kampagne<select name="campaign">${camps.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)} (${esc(c.slug)})</option>`).join('')}<option value="__neu">+ neue Brief-Kampagne</option></select></label><label>Neue Kampagne (Name)<input name="newName" placeholder="z. B. Sparkassen Hessen Herbst 2026"></label>
    <label class="full">Betreff<input name="subject" required maxlength="140" value="Kunden, die vorbereitet ins Erstgespräch kommen"></label>
    <label class="full">Text (Anrede und Grußformel werden automatisch ergänzt; Platzhalter {firma}, {ort})<textarea name="body" rows="10" required maxlength="4000">${esc(BRIEF_DEFAULT)}</textarea></label>
    <label>Unterschrift<input name="signer" value="Feray Korkmaz" maxlength="120"></label></div>
    <p class="form-note">Kontakte mit Werbewiderspruch oder ohne vollständige Anschrift werden übersprungen. Jeder Brief erhält einen QR-Code mit Kampagnen-Kennung und den Datenschutzhinweis. Der Versand wird im Verlauf protokolliert.</p>
    <p class="auth-message error" id="mkLErr" hidden></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Abbrechen</button><button type="submit" class="btn btn-dark">Briefe als PDF erzeugen</button></div></form>`;
  d.querySelector('[data-x]').onclick = () => d.close();
  d.querySelector('#mkLF').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = d.querySelector('#mkLErr');
    let slug = f.campaign;
    if (slug === '__neu' || !slug) {
      if (!f.newName || f.newName.trim().length < 2) { err.textContent = 'Bitte einen Namen für die neue Kampagne angeben.'; err.hidden = false; return; }
      slug = slugify(f.newName);
      const cr = await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ action: 'campaign', name: f.newName.trim(), slug, channel: 'brief', segment: 'b2b', targetPath: '/b2b' }) });
      if (!cr.ok) { err.textContent = cr.data?.error || 'Kampagne konnte nicht angelegt werden.'; err.hidden = false; return; }
    }
    try {
      await download('/api/admin/akquise/briefe', { method: 'POST', body: JSON.stringify({ ids, subject: f.subject, body: f.body, campaign: slug, signer: f.signer }) }, `immoadv-briefe-${slug}.pdf`);
      d.close(); toast('Briefe erzeugt und im Verlauf protokolliert.'); done?.();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  };
  d.showModal();
}

// ---------------- Werbung ----------------
export async function werbung(v) {
  const r = await api('/api/admin/werbung');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Nicht verfügbar.')}</p>`; return; }
  const { campaigns = [], subscribers = [], sends = [], mail } = r.data;
  const subCount = (seg) => ({ ok: subscribers.filter((s) => s.segment === seg && s.confirmed_at && !s.unsubscribed_at).length, open: subscribers.filter((s) => s.segment === seg && !s.confirmed_at && !s.unsubscribed_at).length, off: subscribers.filter((s) => s.segment === seg && s.unsubscribed_at).length });
  const b2b = subCount('b2b'), b2c = subCount('b2c');
  v.innerHTML = `<section class="ad-over"><div class="ad-over-h"><h2>Werbungszentrale</h2><p class="form-note">Kampagnen anlegen, Tracking-Links und QR-Codes erzeugen, Erfolg messen und Neuigkeiten an bestätigte Abonnenten senden.</p></div>
    <section class="pt-card"><h2>Kampagnen</h2>
      <form class="mk-camp" id="wCamp"><input name="name" required minlength="2" maxlength="120" placeholder="Name, z. B. LinkedIn Oktober"><input name="slug" required pattern="[a-z0-9-]{3,40}" placeholder="kennung-im-link"><select name="channel">${Object.entries(CHANNEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select name="segment"><option value="b2b">B2B</option><option value="b2c">B2C</option></select><select name="targetPath"><option value="/b2b">/b2b</option><option value="/">Startseite</option><option value="/angebote">/angebote</option><option value="/wissen">/wissen</option></select><button class="btn btn-dark" type="submit">Anlegen</button></form>
      ${campaigns.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Kampagne</th><th>Kanal</th><th>Besucher</th><th>Anfragen</th><th>Registrierungen</th><th>Briefe</th><th>Link / QR</th></tr></thead><tbody>${campaigns.map((c) => `<tr class="${c.active ? '' : 'mk-off'}"><td><strong>${esc(c.name)}</strong><br><small>${esc(c.slug)} · ${c.segment.toUpperCase()} · ${dt(c.created_at)}</small></td><td>${CHANNEL[c.channel]}</td><td>${c.stats.visitors}</td><td>${c.stats.requests}${c.letters ? `<br><small>${Math.round((c.stats.requests / c.letters) * 1000) / 10} % der Briefe</small>` : ''}</td><td>${c.stats.registrations}</td><td>${c.letters || '–'}</td><td><button class="text-btn" data-copy="${esc(c.link)}">Link kopieren</button><br><button class="text-btn" data-qr="${esc(c.slug)}">QR-Code (PNG)</button><br><button class="text-btn" data-tog="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? 'Beenden' : 'Reaktivieren'}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Noch keine Kampagne.</p>'}
      <p class="form-note">Besucher und Anfragen kommen aus der cookielosen Analyse (Links mit utm_campaign). Für Briefe, Flyer und Messen den QR-Code verwenden, für Social Media und Anzeigen den Link.</p></section>
    <section class="pt-card"><h2>Neuigkeiten per E-Mail (Double-Opt-in)</h2>
      <div class="ad-tiles">${[['B2B bestätigt', b2b.ok], ['B2B unbestätigt', b2b.open], ['B2B abgemeldet', b2b.off], ['B2C bestätigt', b2c.ok], ['B2C abgemeldet', b2c.off]].map(([l, n]) => `<div class="ad-tile"><span class="ad-tile-l">${l}</span><strong>${n}</strong></div>`).join('')}</div>
      ${mail ? '' : '<p class="pt-alert warn">E-Mail-Versand ist noch nicht eingerichtet (System → E-Mail-Versand). Anmeldungen werden gespeichert, aber Bestätigungsmails gehen erst danach raus.</p>'}
      <form id="wSend" class="ad-grid2"><label>Empfänger<select name="segment"><option value="b2b">B2B – ${b2b.ok} bestätigt</option><option value="b2c">B2C – ${b2c.ok} bestätigt</option></select></label><label>Kampagne (optional)<select name="campaign"><option value="">–</option>${campaigns.filter((c) => c.active).map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('')}</select></label>
        <label class="full">Betreff<input name="subject" required maxlength="160" placeholder="z. B. Neu: Fall-Analyse in Sekunden"></label>
        <label class="full">Text<textarea name="body" required rows="8" maxlength="20000" placeholder="Guten Tag,&#10;&#10;…"></textarea></label>
        <label>Button-Text (optional)<input name="buttonLabel" maxlength="60" placeholder="Jetzt ansehen"></label><label>Button-Ziel<select name="buttonPath"><option value="/b2b">/b2b</option><option value="/">Startseite</option><option value="/angebote">/angebote</option><option value="/wissen">/wissen</option><option value="/b2b-portal">/b2b-portal</option></select></label>
        <div class="full pt-row"><button type="button" class="btn btn-outline" id="wTest">Test an mich</button><button type="submit" class="btn btn-dark">An bestätigte Abonnenten senden</button></div></form>
      <p class="form-note">Gesendet wird nur an Empfänger, die über das Formular eingewilligt und den Bestätigungslink geklickt haben. Jede E-Mail enthält Ihr Impressum und einen Abmeldelink (auch Ein-Klick-Abmeldung im E-Mail-Programm).</p>
      <h3 class="ad-sub">Versandprotokoll</h3>${sends.length ? `<div class="ad-wrap"><table class="ad-table"><thead><tr><th>Datum</th><th>Betreff</th><th>Bereich</th><th>Gesendet</th><th>Fehler</th><th></th></tr></thead><tbody>${sends.map((s) => `<tr><td>${dtt(s.created_at)}</td><td>${esc(s.subject)}${s.campaign_slug ? `<br><small>${esc(s.campaign_slug)}</small>` : ''}</td><td>${s.segment.toUpperCase()}</td><td>${s.recipients}</td><td>${s.failed}</td><td><button class="text-btn" data-dl="${s.id}">Empfänger</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Noch nichts gesendet.</p>'}
      <details class="ad-help"><summary>Abonnenten (${subscribers.length})</summary><div class="ad-wrap"><table class="ad-table"><tbody>${subscribers.slice(0, 500).map((s) => `<tr><td>${esc(s.email)}<br><small>${esc([s.name, s.company].filter(Boolean).join(' · '))}</small></td><td>${s.segment.toUpperCase()}</td><td>${esc(s.source || '–')}</td><td>${s.unsubscribed_at ? 'abgemeldet' : s.confirmed_at ? `bestätigt ${dt(s.confirmed_at)}` : 'unbestätigt'}</td><td>${s.unsubscribed_at ? '' : `<button class="text-btn" data-unsub="${s.id}">abmelden</button>`}</td></tr>`).join('')}</tbody></table></div></details></section>
    <section class="pt-card"><h2>Vorlagen für Social Media</h2><p class="form-note">Zum Kopieren – Link der passenden Kampagne einsetzen.</p>
      ${[['LinkedIn – Berater', 'Baufinanzierung beginnt mit Unterlagen – und genau da geht die meiste Zeit verloren. Mit ImmoAdv kommen Kunden vorbereitet ins Erstgespräch: Selbstauskunft, Objekt, Unterlagen, Bankreife. Neu: die Fall-Analyse – PDF-Paket hochladen, in Sekunden Auswertung und Kundenpräsentation im eigenen Design. 👉 [Link]'], ['LinkedIn – Kapitalanleger', 'Lohnt sich die Wohnung wirklich? Cashflow nach Steuern, Zins-Stresstest und Restschuld in zwei Minuten – kostenlos bei ImmoAdv. 👉 [Link]'], ['Instagram – Einsteiger', 'Erste Immobilie? Wie viel Eigenkapital brauchst du, was kostet dich die Rate wirklich – und was will die Bank sehen? Schritt für Schritt bei ImmoAdv. Link in Bio.']].map(([t, x]) => `<h3 class="ad-sub">${t}</h3><textarea class="mk-tpl" rows="4" readonly>${esc(x)}</textarea>`).join('')}</section></section>`;
  const reload = () => werbung(v);
  $('#wCamp').name.oninput = (e) => { const s = $('#wCamp').slug; if (!s.dataset.touched) s.value = slugify(e.target.value); };
  $('#wCamp').slug.oninput = (e) => { e.target.dataset.touched = '1'; };
  $('#wCamp').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const rr = await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ action: 'campaign', ...f }) }); if (rr.ok) { toast('Kampagne angelegt.'); reload(); } else toast(rr.data?.error || 'Fehler', true); };
  v.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link kopiert.'); } catch { prompt('Link:', b.dataset.copy); } });
  v.querySelectorAll('[data-qr]').forEach((b) => b.onclick = () => download('/api/admin/werbung?qr=' + encodeURIComponent(b.dataset.qr), {}, `qr-${b.dataset.qr}.png`).catch((x) => toast(x.message, true)));
  v.querySelectorAll('[data-tog]').forEach((b) => b.onclick = async () => { await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ action: 'toggle', id: b.dataset.tog, active: b.dataset.on === '1' }) }); reload(); });
  v.querySelectorAll('[data-unsub]').forEach((b) => b.onclick = async () => { if (!confirm('Diesen Abonnenten abmelden?')) return; await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ action: 'unsubscribe', id: b.dataset.unsub }) }); reload(); });
  v.querySelectorAll('[data-dl]').forEach((b) => b.onclick = async () => { const rr = await api('/api/admin/werbung?send=' + b.dataset.dl); const d = dlg('wDel'); d.innerHTML = `<div class="ad-dlg-in"><div class="ad-dlg-h"><h2>Empfänger</h2><button class="stage-x" data-x aria-label="Schließen">×</button></div><ul class="mk-acts">${(rr.data?.deliveries || []).map((x) => `<li><b>${x.ok ? '✓' : '✗'}</b><span>${esc(x.email)}</span><small>${dtt(x.at)}</small></li>`).join('') || '<li>–</li>'}</ul></div>`; d.querySelector('[data-x]').onclick = () => d.close(); d.showModal(); });
  const send = async (test) => {
    const f = Object.fromEntries(new FormData($('#wSend'))); if (!f.subject || !f.body) { toast('Bitte Betreff und Text ausfüllen.', true); return; }
    const n = f.segment === 'b2b' ? b2b.ok : b2c.ok;
    if (!test && !confirm(`Jetzt an ${n} bestätigte Abonnenten (${f.segment.toUpperCase()}) senden?`)) return;
    const body = { action: 'send', segment: f.segment, subject: f.subject, body: f.body, test, ...(f.campaign ? { campaign: f.campaign } : {}), ...(f.buttonLabel ? { buttonLabel: f.buttonLabel, buttonPath: f.buttonPath } : {}) };
    let rr = await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify(body) });
    if (!rr.ok) { toast(rr.data?.error || 'Versand fehlgeschlagen.', true); return; }
    let sent = rr.data.sent || 0, failed = rr.data.failed || 0;
    while (!test && rr.ok && rr.data.remaining > 0) { toast(`Gesendet: ${sent} … weiter`); rr = await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ ...body, continueId: rr.data.sendId }) }); if (rr.ok) { sent += rr.data.sent || 0; failed += rr.data.failed || 0; } }
    toast(test ? 'Test an Ihre Adresse gesendet.' : `Gesendet: ${sent}${failed ? `, Fehler: ${failed}` : ''}.`);
    if (!test) reload();
  };
  $('#wTest').onclick = () => send(true);
  $('#wSend').onsubmit = (e) => { e.preventDefault(); send(false); };
}
