// Web-Admin: Outreach center (contacts, mail-merge letters, calls, history) and Marketing center
// (campaigns with tracking link and QR code, results, newsletter emails with double opt-in only).
// Both are hidden from the visible Web-Admin navigation (owner's decision); the modules stay for direct links.
import { api, download, dt, dtt, esc } from './sess.mjs?v=892f3666';

const $ = (s, r = document) => r.querySelector(s);
const KIND = { bank: 'Bank / lender', vermittler: 'Mortgage broker', makler: 'Real estate agent / brokerage', finanzberater: 'Financial advisor', sonstige: 'Other (e.g. property manager)' };
const STATUS = { neu: 'New', angeschrieben: 'Letter sent', angerufen: 'Called', interesse: 'Interested', termin: 'Meeting', kunde: 'Customer', kein_interesse: 'Not interested', widerspruch: 'Do not contact' };
const CHANNEL = { brief: 'Letter', qr: 'QR code / flyer', link: 'Link', newsletter: 'Newsletter email', social: 'Social media', anzeige: 'Ad', messe: 'Trade show / event' };
const today = () => new Date().toISOString().slice(0, 10);
const slugify = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const toast = (t, bad) => { let el = $('#mkToast'); if (!el) { el = document.createElement('div'); el.id = 'mkToast'; el.className = 'pt-toast'; document.body.append(el); } el.textContent = t; el.style.background = bad ? '#991B1B' : ''; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 3200); };
const dlg = (id) => { let d = document.getElementById(id); if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'wa-dlg'; document.body.append(d); } return d; };

const BRIEF_DEFAULT = `when your clients come to their first meeting, documents are often still missing – and pre-qualification takes time before the real conversation can start.

LeaseRun gets your clients ready: their financial profile, property details and documents arrive organized, with a lender-readiness check, a rate stress test and a Lender Package built on common underwriting criteria (DTI, LTV, DSCR, reserves). With the case analysis you upload a client's document package and get a summary and a presentation in seconds – in your own branding if you like.

It's a win-win: you spend less time chasing paperwork, and your clients show up prepared. I'd be glad to show you in 15 minutes. Just scan the QR code or reply to support@leaserun.com.`;
const CALL = `Hi, this is … with LeaseRun. I'm calling because we help loan officers and agents get clients ready before the first meeting – do you have two minutes?

• Short version: clients upload their documents with us, and you see lender readiness and missing items before the meeting starts.
• Case analysis: upload a client's PDF package → summary and presentation in your own branding.
• Question: how much time does your team spend chasing missing documents today?
• Offer: a 15-minute video demo – would … work for you?

If "not interested": thank them and set the status. If "please don't contact me": set "Do not contact" right away (and add the number to the internal do-not-call list). Business numbers only; no autodialers or prerecorded messages.`;
const LINKEDIN = `Hi …, I saw you work in mortgage lending at {firma}. We built LeaseRun, a tool that gets clients fully prepared before the first meeting – documents, lender readiness, rate stress test – and turns a PDF package into a case analysis with a client presentation in seconds. Would you be open to a quick chat to see if it saves your team time? Happy to keep it a win-win.`;

// ---------------- Akquise ----------------
let CRM = { list: [], q: '', st: '', kind: '', due: false, sel: new Set() };
export async function akquise(v) {
  const r = await api('/api/admin/akquise');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Not available.')}</p>`; return; }
  CRM.list = r.data.contacts || [];
  const L = CRM.list, cnt = (f) => L.filter(f).length, td = today();
  v.innerHTML = `<section class="wa-over"><div class="wa-over-h"><h2>Outreach center</h2><p class="form-note">Manage business contacts (lenders, mortgage brokers, property managers, agents), create mail-merge letters with QR codes, log calls and LinkedIn contacts – and always see who got what and when.</p></div>
    <div class="wa-tiles">${[['Contacts', L.length, ''], ['Due today', cnt((c) => c.next_at && c.next_at <= td && !['kunde', 'widerspruch', 'kein_interesse'].includes(c.status)), 'warn'], ['Letter sent', cnt((c) => c.status === 'angeschrieben'), ''], ['Interested / meeting', cnt((c) => ['interesse', 'termin'].includes(c.status)), 'ok'], ['Customers', cnt((c) => c.status === 'kunde'), 'ok'], ['Do not contact', cnt((c) => c.status === 'widerspruch'), '']].map(([l, n, t]) => `<div class="wa-tile ${n && t ? t : ''}"><span class="wa-tile-l">${l}</span><strong>${n}</strong></div>`).join('')}</div>
    <details class="wa-help"><summary>What's allowed? (short version)</summary>
      <p><strong>Letters</strong> to businesses are fine as long as the contact hasn't opted out. Every letter includes how to opt out of further mail.</p>
      <p><strong>Calls</strong> only to business numbers, made by a person – no autodialers, texts or prerecorded messages without prior written consent (TCPA). Check the National Do Not Call Registry and state rules for anything that could be a personal cell phone. When in doubt, write first.</p>
      <p><strong>One-to-one emails</strong> (e.g. press and partnership requests) go through the Inbox – individually, with a clear sender, LeaseRun's postal address and an unsubscribe link (CAN-SPAM); opt-outs block the contact automatically and must be honored within 10 business days.</p>
      <p><strong>Marketing emails</strong> only to people who signed up through the form and confirmed (Marketing tab → Newsletter). No bulk emails to addresses collected here.</p>
      <p><strong>Source</strong> of every contact is required (e.g. "company website, team page"). On an opt-out set "Do not contact" – the record stays as a suppression entry. On a deletion request use "Delete". Not legal advice.</p></details>
    <div class="pt-row mk-bar"><input id="mkQ" placeholder="Search (company, city, name)" value="${esc(CRM.q)}"><select id="mkSt"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${CRM.st === k ? ' selected' : ''}>${l}</option>`).join('')}</select><select id="mkKind"><option value="">All types</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${CRM.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select><label class="chk"><input type="checkbox" id="mkDue"${CRM.due ? ' checked' : ''}> due only</label></div>
    <div class="pt-row mk-bar"><button class="btn btn-dark" id="mkAdd" type="button">+ Contact</button><button class="btn btn-outline" id="mkImp" type="button">Import CSV</button><button class="btn btn-outline" id="mkBrief" type="button">Letters for selection</button><button class="btn btn-dark" id="mkMails" type="button">Open inbox</button><button class="btn btn-ghost" id="mkScripts" type="button">Call & LinkedIn templates</button><span class="form-note" id="mkSel"></span></div>
    <div id="mkTable"></div></section>`;
  const draw = () => {
    const q = CRM.q.toLowerCase();
    const rows = L.filter((c) => (!CRM.st || c.status === CRM.st) && (!CRM.kind || c.kind === CRM.kind) && (!CRM.due || (c.next_at && c.next_at <= td)) && (!q || [c.company, c.branch, c.city, c.contact_name, c.postal_code].join(' ').toLowerCase().includes(q)));
    $('#mkTable').innerHTML = rows.length ? `<div class="wa-wrap"><table class="wa-table mk-table"><thead><tr><th><input type="checkbox" id="mkAll" aria-label="Select all"></th><th>Company</th><th>Contact</th><th>City</th><th>Status</th><th>Follow-up</th><th>Last contact</th></tr></thead><tbody>${rows.map((c) => `<tr class="${c.status === 'widerspruch' ? 'mk-off' : ''}"><td><input type="checkbox" data-sel="${c.id}"${CRM.sel.has(c.id) ? ' checked' : ''}${c.status === 'widerspruch' ? ' disabled' : ''}></td><td><button class="text-btn" data-open="${c.id}"><strong>${esc(c.company)}</strong></button>${c.branch ? `<br><small>${esc(c.branch)}</small>` : ''}<br><small>${KIND[c.kind]}</small></td><td>${esc(c.contact_name || '–')}${c.role ? `<br><small>${esc(c.role)}</small>` : ''}</td><td>${esc([c.city, c.postal_code].filter(Boolean).join(' ') || '–')}</td><td><select data-st="${c.id}" aria-label="Status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${c.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td><input type="date" data-next="${c.id}" value="${c.next_at || ''}" class="${c.next_at && c.next_at <= td ? 'due' : ''}"></td><td>${c.last ? `${esc({ brief: 'Letter', anruf: 'Call', email: 'Email', linkedin: 'LinkedIn', termin: 'Meeting', notiz: 'Note', status: 'Status' }[c.last.type] || c.last.type)}<br><small>${dt(c.last.at)}</small>` : '–'}</td></tr>`).join('')}</tbody></table></div><p class="form-note">${rows.length} of ${L.length} contacts</p>` : '<p class="form-note">No contacts. Start with "+ Contact" or "Import CSV".</p>';
    $('#mkSel').textContent = CRM.sel.size ? `${CRM.sel.size} selected` : '';
    $('#mkAll')?.addEventListener('change', (e) => { rows.filter((c) => c.status !== 'widerspruch').forEach((c) => (e.target.checked ? CRM.sel.add(c.id) : CRM.sel.delete(c.id))); draw(); });
    v.querySelectorAll('[data-sel]').forEach((x) => x.onchange = () => { x.checked ? CRM.sel.add(x.dataset.sel) : CRM.sel.delete(x.dataset.sel); $('#mkSel').textContent = CRM.sel.size ? `${CRM.sel.size} selected` : ''; });
    v.querySelectorAll('[data-open]').forEach((x) => x.onclick = () => openContact(x.dataset.open, () => akquise(v)));
    v.querySelectorAll('[data-st]').forEach((x) => x.onchange = async () => { if (x.value === 'widerspruch' && !confirm('Mark as "Do not contact"? The contact will get no more letters.')) { draw(); return; } const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'status', ids: [x.dataset.st], status: x.value }) }); if (rr.ok) { const c = L.find((y) => y.id === x.dataset.st); c.status = x.value; toast('Status saved.'); } else toast(rr.data?.error || 'Error', true); });
    v.querySelectorAll('[data-next]').forEach((x) => x.onchange = async () => { const c = L.find((y) => y.id === x.dataset.next); const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'status', ids: [c.id], status: c.status, nextAt: x.value || null }) }); if (rr.ok) { c.next_at = x.value || null; toast('Follow-up saved.'); } });
  };
  draw();
  $('#mkQ').oninput = (e) => { CRM.q = e.target.value; draw(); };
  $('#mkSt').onchange = (e) => { CRM.st = e.target.value; draw(); };
  $('#mkKind').onchange = (e) => { CRM.kind = e.target.value; draw(); };
  $('#mkDue').onchange = (e) => { CRM.due = e.target.checked; draw(); };
  $('#mkMails').onclick = () => { location.hash = 'postfach'; };
  $('#mkAdd').onclick = () => editContact(null, () => akquise(v));
  $('#mkImp').onclick = () => importCsv(() => akquise(v));
  $('#mkBrief').onclick = () => { const ids = [...CRM.sel]; if (!ids.length) { toast('Please select contacts first.', true); return; } letters(ids, () => { CRM.sel.clear(); akquise(v); }); };
  $('#mkScripts').onclick = () => { const d = dlg('mkScr'); d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>Templates</h2><button class="stage-x" data-x aria-label="Close">×</button></div><h3 class="wa-sub">Call script</h3><textarea rows="12" readonly class="mk-tpl">${esc(CALL)}</textarea><h3 class="wa-sub">LinkedIn message (send personally)</h3><textarea rows="6" readonly class="mk-tpl">${esc(LINKEDIN)}</textarea><p class="form-note">Afterward, log it in the contact dialog as "Call" or "LinkedIn".</p></div>`; d.querySelector('[data-x]').onclick = () => d.close(); d.showModal(); };
}

const F = [['company', 'Company*'], ['branch', 'Branch / department'], ['salutation', 'Salutation', 'sel'], ['contactName', 'Contact person'], ['role', 'Title'], ['street', 'Street address'], ['city', 'City'], ['postalCode', 'ZIP code'], ['phone', 'Phone'], ['email', 'Email (business)'], ['website', 'Website']];
// Salutation values stay as stored server-side; labels are US.
const SAL = { '': '–', Frau: 'Ms.', Herr: 'Mr.' };
const fromRow = (c) => ({ company: c.company, branch: c.branch, salutation: c.salutation, contactName: c.contact_name, role: c.role, street: c.street, postalCode: c.postal_code, city: c.city, phone: c.phone, email: c.email, website: c.website, kind: c.kind, source: c.source, notes: c.notes, nextAt: c.next_at });
function editContact(c, done) {
  const d = dlg('mkEdit'), x = c ? fromRow(c) : { kind: 'bank' };
  d.innerHTML = `<form class="wa-dlg-in" id="mkF"><div class="wa-dlg-h"><h2>${c ? 'Edit contact' : 'Add contact'}</h2><button type="button" class="stage-x" data-x aria-label="Close">×</button></div>
    <div class="wa-grid2"><label>Type<select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${x.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    ${F.map(([k, l, t]) => t === 'sel' ? `<label>${l}<select name="${k}">${['', 'Frau', 'Herr'].map((a) => `<option value="${a}"${(x[k] || '') === a ? ' selected' : ''}>${SAL[a]}</option>`).join('')}</select></label>` : `<label>${l}<input name="${k}" value="${esc(x[k] || '')}"${k === 'company' ? ' required' : ''}${k === 'postalCode' ? ' pattern="[0-9]{5}"' : ''}></label>`).join('')}
    <label class="full">Data source* <input name="source" required minlength="3" value="${esc(x.source || '')}" placeholder="e.g. company website team page, business card from trade show X"></label>
    <label>Follow-up<input type="date" name="nextAt" value="${x.nextAt || ''}"></label>
    <label class="full">Notes<textarea name="notes" rows="3" maxlength="2000">${esc(x.notes || '')}</textarea></label></div>
    <p class="auth-message error" id="mkErr" hidden></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Cancel</button><button type="submit" class="btn btn-dark">Save</button></div></form>`;
  d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
  d.querySelector('#mkF').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); f.nextAt = f.nextAt || null;
    const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify(c ? { action: 'update', id: c.id, contact: f } : { action: 'create', contact: f }) });
    if (!rr.ok) { const m = d.querySelector('#mkErr'); m.textContent = rr.data?.error || 'Error'; m.hidden = false; return; }
    d.close(); toast('Saved.'); done?.();
  };
  d.showModal();
}

async function openContact(id, done) {
  const r = await api('/api/admin/akquise?id=' + id);
  if (!r.ok) { toast(r.data?.error || 'Error', true); return; }
  const c = r.data.contact, acts = r.data.activities || [];
  const d = dlg('mkOpen');
  const T = { brief: 'Letter', anruf: 'Call', email: 'Email', linkedin: 'LinkedIn', termin: 'Meeting', notiz: 'Note', status: 'Status' };
  d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>${esc(c.company)}</h2><button type="button" class="stage-x" data-x aria-label="Close">×</button></div>
    <dl class="pt-dl">${[['Type', KIND[c.kind]], ['Branch', c.branch], ['Contact', [SAL[c.salutation || ''] === '–' ? '' : SAL[c.salutation || ''], c.contact_name].filter(Boolean).join(' ')], ['Title', c.role], ['Address', [c.street, [c.city, c.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['Phone', c.phone], ['Email', c.email], ['Website', c.website], ['Status', STATUS[c.status]], ['Follow-up', c.next_at ? dt(c.next_at) : null], ['Source', c.source], ['Notes', c.notes]].filter(([, x]) => x).map(([k, x]) => `<div><dt>${k}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>
    ${c.status === 'widerspruch' ? '<p class="pt-alert warn">Do not contact – no more letters, calls or marketing.</p>' : `<form class="mk-log" id="mkLog"><select name="type"><option value="anruf">Call</option><option value="linkedin">LinkedIn</option><option value="email">Email (reply / one-to-one)</option><option value="termin">Meeting scheduled</option><option value="notiz">Note</option></select><input name="note" placeholder="Result / note" maxlength="1000"><input type="date" name="nextAt" aria-label="Follow-up"><button class="btn btn-dark" type="submit">Log</button></form>`}
    <h3 class="wa-sub">History</h3>${acts.length ? `<ul class="mk-acts">${acts.map((a) => `<li><b>${T[a.type] || esc(a.type)}</b><span>${esc(a.note || '')}${a.campaign ? ` <small>Campaign ${esc(a.campaign)}</small>` : ''}</span><small>${dtt(a.at)}${a.actor ? ' · ' + esc(a.actor) : ''}</small></li>`).join('')}</ul>` : '<p class="form-note">No contact yet.</p>'}
    <div class="wiz-nav"><button type="button" class="btn btn-ghost mk-del" id="mkDel">Delete</button><span class="pt-row">${c.status === 'widerspruch' ? '' : '<button type="button" class="btn btn-outline" id="mkObj">Do not contact</button>'}<button type="button" class="btn btn-outline" id="mkEd">Edit</button></span></div></div>`;
  d.querySelector('[data-x]').onclick = () => d.close();
  d.querySelector('#mkEd').onclick = () => { d.close(); editContact(c, done); };
  d.querySelector('#mkObj')?.addEventListener('click', async () => { if (!confirm('Mark as "Do not contact"?')) return; await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'status', ids: [c.id], status: 'widerspruch' }) }); d.close(); done?.(); });
  d.querySelector('#mkDel').onclick = async () => { if (!confirm('Permanently delete the contact with its history? (e.g. on a deletion request) – for opt-outs, better keep the suppression entry.')) return; await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'delete', ids: [c.id] }) }); d.close(); done?.(); };
  d.querySelector('#mkLog')?.addEventListener('submit', async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'log', id: c.id, type: f.type, note: f.note || undefined, ...(f.nextAt ? { nextAt: f.nextAt } : {}) }) }); if (rr.ok) { toast('Logged.'); openContact(id, done); done?.(); } else toast(rr.data?.error || 'Error', true); });
  if (!d.open) d.showModal();
}

// CSV: column names (English, legacy German) → fields. Separator , or ; – first row = headers.
const MAP = { company: 'company', branch: 'branch', department: 'branch', contact: 'contactName', 'contact name': 'contactName', salutation: 'salutation', title: 'role', street: 'street', address: 'street', zip: 'postalCode', 'zip code': 'postalCode', city: 'city', phone: 'phone', type: 'kind', source: 'source', notes: 'notes', note: 'notes', firma: 'company', unternehmen: 'company', filiale: 'branch', abteilung: 'branch', ansprechpartner: 'contactName', name: 'contactName', anrede: 'salutation', funktion: 'role', position: 'role', strasse: 'street', straße: 'street', adresse: 'street', plz: 'postalCode', ort: 'city', stadt: 'city', telefon: 'phone', tel: 'phone', email: 'email', 'e-mail': 'email', website: 'website', web: 'website', art: 'kind', quelle: 'source', notiz: 'notes', notizen: 'notes' };
function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function importCsv(done) {
  const d = dlg('mkImpD');
  d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>Import contacts (CSV)</h2><button class="stage-x" data-x aria-label="Close">×</button></div>
    <p class="form-note">First row with column names, e.g. <code>Company,Branch,Salutation,Contact,Title,Street,City,ZIP,Phone,Email,Website,Type,Source</code>. Type: bank, vermittler (mortgage broker), makler (agent), finanzberater (advisor), sonstige (other). Only business data from legitimate public sources (e.g. company website, business card) – the source is stored.</p>
    <label>File<input type="file" id="mkCsv" accept=".csv,text/csv"></label>
    <label>Source, if the column is missing<input id="mkSrc" placeholder="e.g. company websites (research October 2026)"></label>
    <div id="mkPrev"></div><div class="wiz-nav"><button class="btn btn-outline" data-x type="button">Cancel</button><button class="btn btn-dark" id="mkGo" type="button" disabled>Import</button></div></div>`;
  d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
  let items = [];
  const read = async () => {
    const file = d.querySelector('#mkCsv').files[0]; if (!file) return;
    const rows = parseCsv(await file.text()); const head = rows.shift().map((h) => MAP[h.trim().toLowerCase()] || null);
    const src = d.querySelector('#mkSrc').value.trim();
    items = rows.map((r) => { const o = { kind: 'bank' }; head.forEach((k, i) => { if (k) o[k] = (r[i] || '').trim(); }); if (!KIND[o.kind]) o.kind = 'sonstige'; o.salutation = /^(ms|mrs|miss)\.?$/i.test(o.salutation || '') ? 'Frau' : /^mr\.?$/i.test(o.salutation || '') ? 'Herr' : ['Frau', 'Herr'].includes(o.salutation) ? o.salutation : ''; if (o.postalCode && !/^\d{5}$/.test(o.postalCode)) o.postalCode = ''; o.source = o.source || src; return o; }).filter((o) => o.company && o.company.length >= 2);
    const bad = items.filter((o) => !o.source || o.source.length < 3).length;
    d.querySelector('#mkPrev').innerHTML = `<p class="form-note">${items.length} contacts found${bad ? ` – <strong>${bad} without a source</strong> (please add a source)` : ''}.</p><div class="wa-wrap"><table class="wa-table"><tbody>${items.slice(0, 5).map((o) => `<tr><td>${esc(o.company)}</td><td>${esc(o.contactName || '')}</td><td>${esc(o.city || '')}</td><td>${esc(o.source || '–')}</td></tr>`).join('')}</tbody></table></div>`;
    d.querySelector('#mkGo').disabled = !items.length || bad > 0;
  };
  d.querySelector('#mkCsv').onchange = read; d.querySelector('#mkSrc').oninput = read;
  d.querySelector('#mkGo').onclick = async () => {
    const rr = await api('/api/admin/akquise', { method: 'POST', body: JSON.stringify({ action: 'import', contacts: items.slice(0, 1000).map((o) => ({ ...o, nextAt: null })) }) });
    if (!rr.ok) { toast(rr.data?.error || 'Import failed.', true); return; }
    d.close(); toast(`${rr.data.n} contacts imported.${rr.data.blocked ? ` ${rr.data.blocked} skipped (do not contact – suppression list).` : ""}`); done?.();
  };
  d.showModal();
}

async function letters(ids, done) {
  const w = await api('/api/admin/werbung');
  const camps = (w.data?.campaigns || []).filter((c) => c.active && c.channel === 'brief');
  const d = dlg('mkLet');
  d.innerHTML = `<form class="wa-dlg-in" id="mkLF"><div class="wa-dlg-h"><h2>Letter to ${ids.length} contact${ids.length === 1 ? '' : 's'}</h2><button type="button" class="stage-x" data-x aria-label="Close">×</button></div>
    <div class="wa-grid2"><label>Campaign<select name="campaign">${camps.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)} (${esc(c.slug)})</option>`).join('')}<option value="__neu">+ new letter campaign</option></select></label><label>New campaign (name)<input name="newName" placeholder="e.g. Texas lenders fall 2026"></label>
    <label class="full">Subject<input name="subject" required maxlength="140" value="Clients who show up ready for the first meeting"></label>
    <label class="full">Text (greeting and sign-off are added automatically; placeholders {firma} = company, {ort} = city)<textarea name="body" rows="10" required maxlength="4000">${esc(BRIEF_DEFAULT)}</textarea></label>
    <label>Signature<input name="signer" value="The LeaseRun team" maxlength="120"></label></div>
    <p class="form-note">Contacts marked "Do not contact" or without a complete address are skipped. Every letter gets a QR code with the campaign ID and an opt-out note. Sending is logged in the history.</p>
    <p class="auth-message error" id="mkLErr" hidden></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Cancel</button><button type="submit" class="btn btn-dark">Create letters as PDF</button></div></form>`;
  d.querySelector('[data-x]').onclick = () => d.close();
  d.querySelector('#mkLF').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = d.querySelector('#mkLErr');
    let slug = f.campaign;
    if (slug === '__neu' || !slug) {
      if (!f.newName || f.newName.trim().length < 2) { err.textContent = 'Please enter a name for the new campaign.'; err.hidden = false; return; }
      slug = slugify(f.newName);
      const cr = await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ action: 'campaign', name: f.newName.trim(), slug, channel: 'brief', segment: 'b2b', targetPath: '/business' }) });
      if (!cr.ok) { err.textContent = cr.data?.error || "The campaign couldn't be created."; err.hidden = false; return; }
    }
    try {
      await download('/api/admin/akquise/briefe', { method: 'POST', body: JSON.stringify({ ids, subject: f.subject, body: f.body, campaign: slug, signer: f.signer }) }, `leaserun-letters-${slug}.pdf`);
      d.close(); toast('Letters created and logged in the history.'); done?.();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  };
  d.showModal();
}

// ---------------- Marketing ----------------
export async function werbung(v) {
  const r = await api('/api/admin/werbung');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Not available.')}</p>`; return; }
  const { campaigns = [], subscribers = [], sends = [], mail } = r.data;
  const SC = r.data.scope === 'b2b' ? 'b2b' : 'b2c'; // active area – campaigns and sending only here
  const subCount = (seg) => ({ ok: subscribers.filter((s) => s.segment === seg && s.confirmed_at && !s.unsubscribed_at).length, open: subscribers.filter((s) => s.segment === seg && !s.confirmed_at && !s.unsubscribed_at).length, off: subscribers.filter((s) => s.segment === seg && s.unsubscribed_at).length });
  const b2b = subCount('b2b'), b2c = subCount('b2c');
  v.innerHTML = `<section class="wa-over"><div class="wa-over-h"><h2>Marketing center</h2><p class="form-note">Create campaigns, generate tracking links and QR codes, measure results and send news to confirmed subscribers.</p></div>
    <section class="pt-card"><h2>Campaigns</h2>
      <form class="mk-camp" id="wCamp"><input name="name" required minlength="2" maxlength="120" placeholder="Name, e.g. LinkedIn October"><input name="slug" required pattern="[a-z0-9-]{3,40}" placeholder="id-in-link"><select name="channel">${Object.entries(CHANNEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><input type="hidden" name="segment" value="${SC}"><select name="targetPath"><option value="/business">/business</option><option value="/">Home page</option><option value="/pricing">/pricing</option><option value="/learn">/learn</option></select><button class="btn btn-dark" type="submit">Create</button></form>
      ${campaigns.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Campaign</th><th>Channel</th><th>Visitors</th><th>Requests</th><th>Sign-ups</th><th>Letters</th><th>Link / QR</th></tr></thead><tbody>${campaigns.map((c) => `<tr class="${c.active ? '' : 'mk-off'}"><td><strong>${esc(c.name)}</strong><br><small>${esc(c.slug)} · ${c.segment.toUpperCase()} · ${dt(c.created_at)}</small></td><td>${CHANNEL[c.channel]}</td><td>${c.stats.visitors}</td><td>${c.stats.requests}${c.letters ? `<br><small>${Math.round((c.stats.requests / c.letters) * 1000) / 10} % of letters</small>` : ''}</td><td>${c.stats.registrations}</td><td>${c.letters || '–'}</td><td><button class="text-btn" data-copy="${esc(c.link)}">Copy link</button><br><button class="text-btn" data-qr="${esc(c.slug)}">QR code (PNG)</button><br><button class="text-btn" data-tog="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? 'End' : 'Reactivate'}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">No campaign yet.</p>'}
      <p class="form-note">Visitors and requests come from the cookieless analytics (links with utm_campaign). Use the QR code for letters, flyers and trade shows, the link for social media and ads.</p></section>
    <section class="pt-card"><h2>Newsletter by email (double opt-in)</h2>
      <div class="wa-tiles">${(SC === 'b2b' ? [['Confirmed', b2b.ok], ['Unconfirmed', b2b.open], ['Unsubscribed', b2b.off]] : [['Confirmed', b2c.ok], ['Unconfirmed', b2c.open], ['Unsubscribed', b2c.off]]).map(([l, n]) => `<div class="wa-tile"><span class="wa-tile-l">${l}</span><strong>${n}</strong></div>`).join('')}</div>
      ${mail ? '' : '<p class="pt-alert warn">Email delivery is not set up yet (System → Email delivery). Sign-ups are saved, but confirmation emails only go out afterward.</p>'}
      <form id="wSend" class="wa-grid2"><label>Recipients<select name="segment"><option value="${SC}">${SC === 'b2b' ? `Businesses – ${b2b.ok}` : `Consumers – ${b2c.ok}`} confirmed</option></select></label><label>Campaign (optional)<select name="campaign"><option value="">–</option>${campaigns.filter((c) => c.active).map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('')}</select></label>
        <label class="full">Subject<input name="subject" required maxlength="160" placeholder="e.g. New: case analysis in seconds"></label>
        <label class="full">Text<textarea name="body" required rows="8" maxlength="20000" placeholder="Hi there,&#10;&#10;…"></textarea></label>
        <label>Button text (optional)<input name="buttonLabel" maxlength="60" placeholder="Take a look"></label><label>Button target<select name="buttonPath"><option value="/business">/business</option><option value="/">Home page</option><option value="/pricing">/pricing</option><option value="/learn">/learn</option><option value="/business-portal">/business-portal</option></select></label>
        <div class="full pt-row"><button type="button" class="btn btn-outline" id="wTest">Test to me</button><button type="submit" class="btn btn-dark">Send to confirmed subscribers</button></div></form>
      <p class="form-note">Sent only to people who opted in through the form and clicked the confirmation link. Every email includes LeaseRun's postal address and an unsubscribe link (including one-click unsubscribe in the mail app), as required by CAN-SPAM.</p>
      <h3 class="wa-sub">Send log</h3>${sends.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Date</th><th>Subject</th><th>Area</th><th>Sent</th><th>Errors</th><th></th></tr></thead><tbody>${sends.map((s) => `<tr><td>${dtt(s.created_at)}</td><td>${esc(s.subject)}${s.campaign_slug ? `<br><small>${esc(s.campaign_slug)}</small>` : ''}</td><td>${s.segment.toUpperCase()}</td><td>${s.recipients}</td><td>${s.failed}</td><td><button class="text-btn" data-dl="${s.id}">Recipients</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Nothing sent yet.</p>'}
      <details class="wa-help"><summary>Subscribers (${subscribers.length})</summary><div class="wa-wrap"><table class="wa-table"><tbody>${subscribers.slice(0, 500).map((s) => `<tr><td>${esc(s.email)}<br><small>${esc([s.name, s.company].filter(Boolean).join(' · '))}</small></td><td>${s.segment.toUpperCase()}</td><td>${esc(s.source || '–')}</td><td>${s.unsubscribed_at ? 'unsubscribed' : s.confirmed_at ? `confirmed ${dt(s.confirmed_at)}` : 'unconfirmed'}</td><td>${s.unsubscribed_at ? '' : `<button class="text-btn" data-unsub="${s.id}">unsubscribe</button>`}</td></tr>`).join('')}</tbody></table></div></details></section>
    <section class="pt-card"><h2>Social media templates</h2><p class="form-note">To copy – insert the link of the matching campaign.</p>
      ${[['LinkedIn – loan officers & agents', 'Every mortgage starts with paperwork – and that is where most of the time goes. With LeaseRun, clients come to the first meeting prepared: financial profile, property, documents, lender readiness. New: the case analysis – upload a PDF package and get a summary and a client presentation in your own branding in seconds. → [Link]'], ['LinkedIn – investors', 'Does that rental really pencil out? Cash flow, cap rate, DSCR and a rate stress test in two minutes – free at LeaseRun. → [Link]'], ['Instagram – first-time buyers', 'First home? How much do you need for the down payment and closing costs, what will your PITI really be – and what will the lender want to see? Step by step at LeaseRun. Link in bio.']].map(([t, x]) => `<h3 class="wa-sub">${t}</h3><textarea class="mk-tpl" rows="4" readonly>${esc(x)}</textarea>`).join('')}</section></section>`;
  const reload = () => werbung(v);
  $('#wCamp').name.oninput = (e) => { const s = $('#wCamp').slug; if (!s.dataset.touched) s.value = slugify(e.target.value); };
  $('#wCamp').slug.oninput = (e) => { e.target.dataset.touched = '1'; };
  $('#wCamp').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const rr = await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ action: 'campaign', ...f }) }); if (rr.ok) { toast('Campaign created.'); reload(); } else toast(rr.data?.error || 'Error', true); };
  v.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied.'); } catch { prompt('Link:', b.dataset.copy); } });
  v.querySelectorAll('[data-qr]').forEach((b) => b.onclick = () => download('/api/admin/werbung?qr=' + encodeURIComponent(b.dataset.qr), {}, `qr-${b.dataset.qr}.png`).catch((x) => toast(x.message, true)));
  v.querySelectorAll('[data-tog]').forEach((b) => b.onclick = async () => { await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ action: 'toggle', id: b.dataset.tog, active: b.dataset.on === '1' }) }); reload(); });
  v.querySelectorAll('[data-unsub]').forEach((b) => b.onclick = async () => { if (!confirm('Unsubscribe this subscriber?')) return; await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ action: 'unsubscribe', id: b.dataset.unsub }) }); reload(); });
  v.querySelectorAll('[data-dl]').forEach((b) => b.onclick = async () => { const rr = await api('/api/admin/werbung?send=' + b.dataset.dl); const d = dlg('wDel'); d.innerHTML = `<div class="wa-dlg-in"><div class="wa-dlg-h"><h2>Recipients</h2><button class="stage-x" data-x aria-label="Close">×</button></div><ul class="mk-acts">${(rr.data?.deliveries || []).map((x) => `<li><b>${x.ok ? '✓' : '✗'}</b><span>${esc(x.email)}</span><small>${dtt(x.at)}</small></li>`).join('') || '<li>–</li>'}</ul></div>`; d.querySelector('[data-x]').onclick = () => d.close(); d.showModal(); });
  const send = async (test) => {
    const f = Object.fromEntries(new FormData($('#wSend'))); if (!f.subject || !f.body) { toast('Please fill in subject and text.', true); return; }
    const n = f.segment === 'b2b' ? b2b.ok : b2c.ok;
    if (!test && !confirm(`Send to ${n} confirmed subscribers (${f.segment.toUpperCase()}) now?`)) return;
    const body = { action: 'send', segment: f.segment, subject: f.subject, body: f.body, test, ...(f.campaign ? { campaign: f.campaign } : {}), ...(f.buttonLabel ? { buttonLabel: f.buttonLabel, buttonPath: f.buttonPath } : {}) };
    let rr = await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify(body) });
    if (!rr.ok) { toast(rr.data?.error || 'Sending failed.', true); return; }
    let sent = rr.data.sent || 0, failed = rr.data.failed || 0;
    while (!test && rr.ok && rr.data.remaining > 0) { toast(`Sent: ${sent} … continuing`); rr = await api('/api/admin/werbung', { method: 'POST', body: JSON.stringify({ ...body, continueId: rr.data.sendId }) }); if (rr.ok) { sent += rr.data.sent || 0; failed += rr.data.failed || 0; } }
    toast(test ? 'Test sent to your address.' : `Sent: ${sent}${failed ? `, errors: ${failed}` : ''}.`);
    if (!test) reload();
  };
  $('#wTest').onclick = () => send(true);
  $('#wSend').onsubmit = (e) => { e.preventDefault(); send(false); };
}
