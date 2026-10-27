// Web-Admin → Creator Operations: Bewerbungen prüfen, Creator 360, Zahlungsdaten (maskiert / geschützt anzeigen), Rollen.
// Rechte prüft ausschließlich der Server (Rolle im Creator-Bereich). Die Oberfläche blendet nur aus, was die Rolle nicht darf.
import { api, download, dt, dtt, esc } from './sess.mjs?v=892f3666';

const ST = {
  DRAFT: ['', 'Entwurf'], SUBMITTED: ['warn', 'Eingereicht'], UNDER_REVIEW: ['warn', 'In Prüfung'], INFO_REQUESTED: ['warn', 'Rückfrage offen'],
  ACTIVE: ['ok', 'Aktiv'], REJECTED: ['bad', 'Abgelehnt'], SUSPENDED: ['bad', 'Pausiert'],
};
const PAY = { PROVIDED: ['ok', 'Hinterlegt'], VERIFIED: ['ok', 'Geprüft'], VERIFICATION_REQUIRED: ['warn', 'Prüfung nötig'], MISSING: ['bad', 'Fehlt'] };
const ACT = {
  START_REVIEW: ['Prüfung starten', 'btn-outline'], APPROVE: ['Freigeben', 'btn-dark'], REQUEST_INFO: ['Information anfordern', 'btn-outline'],
  REJECT: ['Ablehnen', 'btn-outline'], SUSPEND: ['Pausieren', 'btn-outline'], REACTIVATE: ['Reaktivieren', 'btn-dark'],
};
const EV = {
  CREATOR_CREATED: 'Bewerbung begonnen', APPLICATION_SUBMITTED: 'Bewerbung eingereicht', REVIEW_STARTED: 'Prüfung gestartet', CREATOR_APPROVED: 'Freigegeben',
  CREATOR_INFO_REQUESTED: 'Information angefordert', CREATOR_REJECTED: 'Abgelehnt', CREATOR_SUSPENDED: 'Pausiert', CREATOR_REACTIVATED: 'Reaktiviert',
  AGREEMENT_ACCEPTED: 'Vereinbarung bestätigt', BANK_DATA_ADDED: 'Zahlungsdaten hinterlegt', BANK_DATA_CHANGED: 'Zahlungsdaten geändert',
  BANK_DETAILS_VIEWED: 'Zahlungsdaten angezeigt', BANK_DATA_VERIFIED: 'Zahlungsdaten geprüft', ACCESS_DENIED: 'Zugriff verweigert', ADMIN_ROLE_CHANGED: 'Rolle geändert',
};
const CAT = { immobilien: 'Immobilien', finanzen: 'Finanzen', business: 'Business', entrepreneurship: 'Entrepreneurship', lifestyle: 'Lifestyle', technology: 'Technology', education: 'Education', other: 'Sonstiges' };
const PL = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', other: 'Andere' };
const VAT = { small_business: 'Kleinunternehmer (§ 19 UStG)', vat_registered: 'Umsatzsteuerpflichtig', not_applicable: 'Nicht anwendbar / Ausland' };
const chip = (map, k) => `<span class="st ${map[k]?.[0] || ''}" style="margin:0">${esc(map[k]?.[1] || k)}</span>`;
const dl = (rows) => `<dl class="pt-dl">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? esc(u) : '#');
let filter = 'REVIEW';

export async function creatorOps(v) {
  const id = (location.hash.match(/^#creator-([0-9a-f-]{36})$/) || [])[1];
  if (id) return detail(v, id);
  if (location.hash === '#creator-rollen') return roles(v);
  if (location.hash === '#creator-kampagnen') return campaigns(v);
  if (location.hash === '#creator-assets') return assetsAdmin(v);
  if (location.hash === '#creator-inhalte') return contentAdmin(v);
  if (location.hash === '#creator-abrechnung') return billingAdmin(v);
  if (location.hash === '#creator-auszahlungen') return payoutsAdmin(v);
  if (location.hash === '#creator-provision') return rulesAdmin(v);
  return list(v);
}

// Unternavigation von Creator Operations
const SUBNAV = [['creator', 'Creator'], ['creator-kampagnen', 'Kampagnen'], ['creator-assets', 'Assets'], ['creator-inhalte', 'Beiträge'], ['creator-abrechnung', 'Abrechnung'], ['creator-auszahlungen', 'Auszahlungen'], ['creator-provision', 'Provision'], ['creator-rollen', 'Rollen']];
const subnav = (cur) => `<nav class="co-sub" aria-label="Creator Operations">${SUBNAV.map(([k, l]) => `<a href="#${k}"${k === cur ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
const eurC = (c) => (Number(c || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const num = (n) => Number(n || 0).toLocaleString('de-DE');
const RANGES = [['30d', '30 Tage'], ['90d', '90 Tage'], ['month', 'Dieser Monat'], ['last_month', 'Vormonat'], ['all', 'Gesamt']];
const CST = { SUBMITTED: ['warn', 'Zu prüfen'], APPROVED: ['ok', 'Freigegeben'], CHANGES_REQUESTED: ['bad', 'Änderung erbeten'] };
const KST = { DRAFT: ['', 'Entwurf'], ACTIVE: ['ok', 'Aktiv'], PAUSED: ['warn', 'Pausiert'], ENDED: ['', 'Beendet'] };
let campRange = '30d';
const errBox = (v, t) => { v.innerHTML = `<div class="wa-state err" role="alert"><strong>${esc(t || 'Nicht möglich.')}</strong></div>`; };
function dialog(html, onSubmit) {
  const d = document.createElement('dialog');
  d.className = 'wa-dlg';
  d.innerHTML = `<form class="wa-dlg-in" novalidate>${html}<p class="pt-alert bad" data-err hidden></p><div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Abbrechen</button><button type="submit" class="btn btn-dark">Speichern</button></div></form>`;
  document.body.append(d);
  d.querySelector('[data-x]').onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  const f = d.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = d.querySelector('[data-err]'); const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const msg = await onSubmit(f).catch((x) => x.message || 'Nicht möglich.');
    btn.disabled = false;
    if (msg) { err.hidden = false; err.textContent = msg; return; }
    d.close();
  };
  d.showModal();
  return d;
}
const fv = (f, n) => (f.elements[n]?.value ?? '').trim();

// ---------- Kampagnen ----------
async function campaigns(v) {
  const r = await api(`/api/admin/creators/campaigns?range=${campRange}`);
  if (!r.ok) return errBox(v, r.data?.error);
  const d = r.data;
  v.innerHTML = `${subnav('creator-kampagnen')}<section class="pt-card"><div class="wa-h-row"><h2>Kampagnen</h2>${d.me.manage ? '<button type="button" class="btn btn-dark" id="coNew">+ Kampagne</button>' : ''}</div>
      ${d.me.stats ? `<div class="pc-chips" role="group" aria-label="Zeitraum" style="margin:10px 0">${RANGES.map(([k, l]) => `<button type="button" data-r="${k}" aria-pressed="${k === campRange}">${l}</button>`).join('')}</div>` : ''}
      <p class="form-note">Welche Kampagne funktioniert? Besuche über Creator-Links (mit <code>utm_campaign</code>), Registrierungen und bezahlte Käufe (netto, ohne Erstattungen).</p>
      <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Kampagne</th><th>Status</th><th>Für</th>${d.me.stats ? '<th>Besuche</th><th>Registr.</th><th>Conv.</th><th>Umsatz</th>' : ''}<th>Assets</th><th></th></tr></thead><tbody>
      ${d.campaigns.map((k) => `<tr><td><strong>${esc(k.name)}</strong><br><small class="form-note">${esc(k.slug)} → ${esc(k.target_path)}</small></td><td>${chip(KST, k.status)}</td><td>${k.audience === 'ALL' ? 'alle Creator' : `${k.member_ids.length} Creator`}</td>
        ${d.me.stats ? `<td>${num(k.stats?.visits)}</td><td>${num(k.stats?.registrations)}</td><td>${num(k.stats?.conversions)}</td><td>${eurC(k.stats?.revenue_net_cents)}</td>` : ''}<td>${k.assets}</td>
        <td>${d.me.manage ? `<span class="wa-actions"><button type="button" data-edit="${esc(k.id)}">Bearbeiten</button>${k.audience === 'SELECTED' ? `<button type="button" data-mem="${esc(k.id)}">Creator</button>` : ''}</span>` : ''}</td></tr>`).join('')}
      ${d.me.stats && d.without_campaign ? `<tr><td><em>Ohne Kampagne</em></td><td></td><td></td><td>${num(d.without_campaign.visits)}</td><td>${num(d.without_campaign.registrations)}</td><td>${num(d.without_campaign.conversions)}</td><td>${eurC(d.without_campaign.revenue_net_cents)}</td><td></td><td></td></tr>` : ''}
      </tbody></table></div>${d.campaigns.length ? '' : '<p class="form-note">Noch keine Kampagnen.</p>'}</section>`;
  v.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { campRange = b.dataset.r; campaigns(v); });
  const edit = (k) => {
    const x = k || { audience: 'ALL', status: 'DRAFT', target_path: '/' };
    const sel = (n, list, cur) => `<select name="${n}">${list.map(([a, b]) => `<option value="${a}"${a === cur ? ' selected' : ''}>${b}</option>`).join('')}</select>`;
    dialog(`<h2 style="margin:0;color:#0F2C59">${k ? 'Kampagne bearbeiten' : 'Neue Kampagne'}</h2><div class="wa-grid2">
      <label>Name*<input name="name" required maxlength="120" value="${esc(x.name || '')}"></label>
      <label>Kurzname (Link)*<input name="slug" required maxlength="40" pattern="[a-z0-9-]{3,40}" value="${esc(x.slug || '')}"${k ? ' readonly' : ''}></label>
      <label>Status${sel('status', [['DRAFT', 'Entwurf'], ['ACTIVE', 'Aktiv'], ['PAUSED', 'Pausiert'], ['ENDED', 'Beendet']], x.status)}</label>
      <label>Für${sel('audience', [['ALL', 'alle aktiven Creator'], ['SELECTED', 'ausgewählte Creator']], x.audience)}</label>
      <label>Start<input type="date" name="starts_on" value="${esc(x.starts_on || '')}"></label><label>Ende<input type="date" name="ends_on" value="${esc(x.ends_on || '')}"></label>
      <label class="full">Ziel auf leaserun.com<input name="target_path" maxlength="120" value="${esc(x.target_path || '/')}" placeholder="/calculators/budget"></label></div>
      <label class="pt-field">Kurzbeschreibung<textarea name="summary" rows="2" maxlength="600">${esc(x.summary || '')}</textarea></label>
      <label class="pt-field">Briefing<textarea name="brief" rows="5" maxlength="8000">${esc(x.brief || '')}</textarea></label>
      <div class="wa-grid2"><label>Bitte so<textarea name="dos" rows="4" maxlength="4000">${esc(x.dos || '')}</textarea></label><label>Bitte nicht<textarea name="donts" rows="4" maxlength="4000">${esc(x.donts || '')}</textarea></label></div>`,
    async (f) => {
      const body = { ...(k ? { id: k.id } : {}), name: fv(f, 'name'), slug: fv(f, 'slug'), status: fv(f, 'status'), audience: fv(f, 'audience'), target_path: fv(f, 'target_path') || '/', starts_on: fv(f, 'starts_on') || null, ends_on: fv(f, 'ends_on') || null, summary: fv(f, 'summary') || null, brief: fv(f, 'brief') || null, dos: fv(f, 'dos') || null, donts: fv(f, 'donts') || null };
      const x2 = await api('/api/admin/creators/campaigns', { method: 'POST', body: JSON.stringify(body) });
      if (!x2.ok) return x2.data?.error || 'Nicht möglich.';
      campaigns(v); return null;
    });
  };
  v.querySelector('#coNew')?.addEventListener('click', () => edit(null));
  v.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => edit(d.campaigns.find((k) => k.id === b.dataset.edit)));
  v.querySelectorAll('[data-mem]').forEach((b) => b.onclick = () => {
    const k = d.campaigns.find((x) => x.id === b.dataset.mem);
    dialog(`<h2 style="margin:0;color:#0F2C59">Creator für „${esc(k.name)}“</h2><p class="form-note">Nur aktive Creator. Zugeordnete Creator sehen Kampagne und Assets im Creator Studio.</p>
      <div class="co-check">${d.creators.map((c) => `<label class="chk"><input type="checkbox" name="c" value="${esc(c.id)}"${k.member_ids.includes(c.id) ? ' checked' : ''}> ${esc(c.display_name || 'Ohne Namen')}</label>`).join('') || '<p class="form-note">Keine aktiven Creator.</p>'}</div>`,
    async (f) => {
      const ids = [...f.querySelectorAll('[name=c]:checked')].map((x) => x.value);
      const x2 = await api('/api/admin/creators/campaigns', { method: 'PUT', body: JSON.stringify({ campaign_id: k.id, creator_ids: ids }) });
      if (!x2.ok) return x2.data?.error || 'Nicht möglich.';
      campaigns(v); return null;
    });
  });
}

// ---------- Assets ----------
async function assetsAdmin(v) {
  const [r, c] = await Promise.all([api('/api/admin/creators/assets'), api('/api/admin/creators/campaigns')]);
  if (!r.ok) return errBox(v, r.data?.error);
  const camps = c.ok ? c.data.campaigns : [];
  const manage = c.ok && c.data.me.manage;
  const cname = (id) => camps.find((k) => k.id === id)?.name || 'Allgemein';
  const KIND = { image: 'Bild', video: 'Video', document: 'Dokument', logo: 'Logo', text: 'Text' };
  v.innerHTML = `${subnav('creator-assets')}<section class="pt-card"><div class="wa-h-row"><h2>Asset Library</h2>${manage ? '<span class="pt-row"><button type="button" class="btn btn-dark" id="coUp">+ Datei</button><button type="button" class="btn btn-outline" id="coTxt">+ Text</button></span>' : ''}</div>
    <p class="form-note">Dateien liegen im privaten Speicher; Creator erhalten nur kurzlebige, signierte Download-Links. Downloads werden protokolliert.</p>
    <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Asset</th><th>Art</th><th>Kampagne</th><th>Status</th><th></th></tr></thead><tbody>
    ${r.data.assets.map((a) => `<tr><td><strong>${esc(a.title)}</strong>${a.file ? `<br><small class="form-note">${esc(a.file)}${a.size_bytes ? ` · ${(a.size_bytes / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : ''}</small>` : ''}</td><td>${esc(KIND[a.kind] || a.kind)}</td><td>${esc(cname(a.campaign_id))}</td><td>${a.active ? '<span class="st ok" style="margin:0">sichtbar</span>' : '<span class="st" style="margin:0">verborgen</span>'}</td>
      <td>${manage ? `<span class="wa-actions"><button type="button" data-tg="${esc(a.id)}" data-on="${a.active ? '0' : '1'}">${a.active ? 'Verbergen' : 'Sichtbar machen'}</button></span>` : ''}</td></tr>`).join('')}</tbody></table></div>${r.data.assets.length ? '' : '<p class="form-note">Noch keine Assets.</p>'}</section>`;
  const campSel = `<label>Kampagne<select name="campaign_id"><option value="">Allgemein (alle Creator)</option>${camps.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}</select></label>`;
  v.querySelectorAll('[data-tg]').forEach((b) => b.onclick = async () => { const x = await api('/api/admin/creators/assets', { method: 'POST', body: JSON.stringify({ action: 'toggle', id: b.dataset.tg, active: b.dataset.on === '1' }) }); if (x.ok) assetsAdmin(v); else alert(x.data?.error || 'Nicht möglich.'); });
  v.querySelector('#coTxt')?.addEventListener('click', () => dialog(`<h2 style="margin:0;color:#0F2C59">Text-Asset (z. B. Caption, Hashtags, Pflichthinweis)</h2><div class="wa-grid2"><label>Titel*<input name="title" required maxlength="140"></label>${campSel}</div>
    <label class="pt-field">Text*<textarea name="text_body" rows="7" maxlength="8000" required></textarea></label><label class="pt-field">Nutzungshinweis<textarea name="usage_notes" rows="2" maxlength="1000"></textarea></label>`,
  async (f) => { const x = await api('/api/admin/creators/assets', { method: 'POST', body: JSON.stringify({ action: 'text', title: fv(f, 'title'), campaign_id: fv(f, 'campaign_id') || null, text_body: fv(f, 'text_body'), usage_notes: fv(f, 'usage_notes') || null }) }); if (!x.ok) return x.data?.error || 'Nicht möglich.'; assetsAdmin(v); return null; }));
  v.querySelector('#coUp')?.addEventListener('click', () => dialog(`<h2 style="margin:0;color:#0F2C59">Datei hochladen</h2><div class="wa-grid2"><label>Titel*<input name="title" required maxlength="140"></label>${campSel}
    <label>Art<select name="kind"><option value="image">Bild</option><option value="logo">Logo</option><option value="video">Video</option><option value="document">Dokument</option></select></label>
    <label>Datei* <small class="form-note">PNG, JPG, WebP, MP4, MOV, PDF, ZIP</small><input type="file" name="file" required accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,application/pdf,application/zip"></label></div>
    <label class="pt-field">Beschreibung<textarea name="description" rows="2" maxlength="1000"></textarea></label><label class="pt-field">Nutzungshinweis (z. B. „nur unverändert verwenden“)<textarea name="usage_notes" rows="2" maxlength="1000"></textarea></label><p class="form-note" data-prog></p>`,
  async (f) => {
    const file = f.elements.file.files[0];
    if (!file) return 'Bitte eine Datei wählen.';
    const prog = f.querySelector('[data-prog]');
    prog.textContent = 'Upload wird vorbereitet …';
    const x = await api('/api/admin/creators/assets', { method: 'POST', body: JSON.stringify({ action: 'upload', kind: fv(f, 'kind'), filename: file.name, mime: file.type, size: file.size, title: fv(f, 'title'), campaign_id: fv(f, 'campaign_id') || null, description: fv(f, 'description') || null, usage_notes: fv(f, 'usage_notes') || null }) });
    if (!x.ok) return x.data?.error || 'Nicht möglich.';
    prog.textContent = 'Datei wird hochgeladen …';
    const body = new FormData(); body.append('cacheControl', '3600'); body.append('', file);
    const up = await fetch(x.data.upload_url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body }).catch(() => null);
    if (!up || !up.ok) return 'Upload fehlgeschlagen. Bitte erneut versuchen.';
    prog.textContent = 'Datei wird geprüft …';
    const fin = await api('/api/admin/creators/assets', { method: 'POST', body: JSON.stringify({ action: 'finalize', id: x.data.id }) });
    if (!fin.ok) return fin.data?.error || 'Prüfung fehlgeschlagen.';
    assetsAdmin(v); return null;
  }));
}

// ---------- Beiträge (Creator Studio) ----------
let contentFilter = 'SUBMITTED';
async function contentAdmin(v) {
  const r = await api(`/api/admin/creators/content?status=${contentFilter}`);
  if (!r.ok) return errBox(v, r.data?.error);
  const PLAT = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', other: 'Andere' };
  v.innerHTML = `${subnav('creator-inhalte')}<section class="pt-card"><h2>Beiträge</h2>
    <div class="pc-chips" role="group" aria-label="Filter" style="margin:10px 0">${[['SUBMITTED', 'Zu prüfen'], ['CHANGES_REQUESTED', 'Änderung erbeten'], ['APPROVED', 'Freigegeben'], ['', 'Alle']].map(([k, l]) => `<button type="button" data-cf="${k}" aria-pressed="${k === contentFilter}">${l}</button>`).join('')}</div>
    <p class="form-note">Bitte Werbekennzeichnung und Aussagen über LeaseRun prüfen (z. B. keine Renditeversprechen, keine Kredit- oder Anlageberatung).</p>
    ${r.data.content.length ? `<ul class="co-social">${r.data.content.map((c) => `<li class="cr-content"><div><strong>${esc(c.lr_creators?.display_name || 'Creator')}</strong> · ${esc(PLAT[c.platform] || c.platform)} · ${dt(c.published_on)} ${chip(CST, c.status)}${c.lr_creator_campaigns ? ` <small class="form-note">· ${esc(c.lr_creator_campaigns.name)}</small>` : ''}<br>
        <a href="${/^https:\/\//.test(c.url) ? esc(c.url) : '#'}" target="_blank" rel="noopener noreferrer">${esc(c.title || c.url)}</a>${c.ad_disclosure ? ' <small class="form-note">· Kennzeichnung bestätigt</small>' : ''}${c.review_note ? `<br><small class="form-note">Anmerkung: ${esc(c.review_note)}</small>` : ''}</div>
        ${c.status !== 'APPROVED' ? `<span class="pt-row"><button type="button" class="btn btn-dark btn-sm" data-ok="${esc(c.id)}">Freigeben</button><button type="button" class="btn btn-outline btn-sm" data-ch="${esc(c.id)}">Änderung erbitten</button></span>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Keine Beiträge in dieser Ansicht.</p>'}</section>`;
  v.querySelectorAll('[data-cf]').forEach((b) => b.onclick = () => { contentFilter = b.dataset.cf; contentAdmin(v); });
  const review = async (id, status, note) => { const x = await api('/api/admin/creators/content', { method: 'POST', body: JSON.stringify({ id, status, note }) }); if (!x.ok) return x.data?.error || 'Nicht möglich.'; contentAdmin(v); return null; };
  v.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => { const m = await review(b.dataset.ok, 'APPROVED', null); if (m) alert(m); });
  v.querySelectorAll('[data-ch]').forEach((b) => b.onclick = () => dialog(`<h2 style="margin:0;color:#0F2C59">Änderung erbitten</h2><p class="form-note">Der Creator erhält die Anmerkung per E-Mail und im Creator Studio.</p><label class="pt-field">Anmerkung*<textarea name="note" rows="4" maxlength="1000" required></textarea></label>`,
    (f) => (fv(f, 'note') ? review(b.dataset.ch, 'CHANGES_REQUESTED', fv(f, 'note')) : Promise.resolve('Bitte eine Anmerkung angeben.'))));
}

// Creator-Konto direkt anlegen: E-Mail, Passwort (eigenes oder erzeugt) und Zugriff (Bewerbung ausfüllen oder sofort freigeschaltet).
function createCreator(done) {
  let d = document.getElementById('coMkDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'coMkDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<form class="wa-dlg-in" id="coMkF" novalidate><div class="wa-dlg-h"><h2>Creator anlegen</h2><button type="button" class="stage-x" data-x aria-label="Schließen">×</button></div>
    <p class="form-note">Eigener Login für den Creator-Bereich (getrennt von Kundenbereich und Unternehmensportal). Anmeldung unter leaserun.com/creator/anmelden.</p>
    <div class="wa-grid2"><label>Vorname*<input name="firstName" required maxlength="80"></label><label>Nachname*<input name="lastName" required maxlength="80"></label>
      <label>E-Mail (Benutzername)*<input name="email" type="email" required maxlength="200"></label><label>Anzeigename (z. B. Kanalname)<input name="displayName" maxlength="80"></label></div>
    <fieldset class="wa-fs"><legend>Passwort</legend><label class="wa-pw">Passwort<input name="password" type="text" autocomplete="new-password" minlength="10" maxlength="72" spellcheck="false" placeholder="mind. 10 Zeichen, Buchstaben + Ziffer"></label>
      <span class="wa-hint">Leer lassen, um ein sicheres Passwort automatisch zu erzeugen. Ändern kann der Creator es jederzeit über „Passwort vergessen“.</span></fieldset>
    <fieldset class="wa-fs"><legend>Zugriff</legend>
      <label class="chk"><input type="radio" name="access" value="APPLY" checked> <span><strong>Bewerbung ausfüllen</strong> – Creator meldet sich an, füllt die Bewerbung aus, danach prüfen und freigeben</span></label>
      <label class="chk"><input type="radio" name="access" value="ACTIVE"> <span><strong>Sofort freischalten</strong> – Portal mit persönlichem Link ab sofort; Rechnungs- und Auszahlungsdaten ergänzt der Creator im Portal</span></label></fieldset>
    <label class="chk"><input type="checkbox" name="sendMail"> Zugangsdaten per E-Mail senden</label>
    <p class="auth-message error" id="coMkMsg" hidden></p><div id="coMkOut"></div>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Abbrechen</button><button type="submit" class="btn btn-dark">Creator anlegen</button></div></form>`;
  d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.close());
  d.querySelector('#coMkF').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, fd = Object.fromEntries(new FormData(f)), m = d.querySelector('#coMkMsg');
    if (!f.reportValidity()) return;
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    const x = await api('/api/admin/creators/create', { method: 'POST', body: JSON.stringify({ firstName: fd.firstName, lastName: fd.lastName, email: fd.email, displayName: fd.displayName || '', password: fd.password || null, access: fd.access, sendMail: fd.sendMail === 'on' }) });
    btn.disabled = false;
    if (!x.ok) { m.textContent = x.data?.error || 'Anlegen fehlgeschlagen.'; m.hidden = false; return; }
    m.hidden = true;
    const txt = `Anmeldung: ${x.data.url}\nBenutzername: ${x.data.email}\nPasswort: ${x.data.password}\nZugriff: ${x.data.access === 'ACTIVE' ? 'freigeschaltet' : 'Bewerbung ausfüllen'}`;
    d.querySelector('#coMkOut').innerHTML = `<div class="pt-alert ok"><strong>Creator angelegt${x.data.mailed ? ' und Zugangsdaten per E-Mail gesendet' : ''}.</strong> Diese Daten werden nur jetzt angezeigt:<pre class="pt-code">${esc(txt)}</pre><button type="button" class="btn btn-outline" id="coMkCopy">Zugangsdaten kopieren</button></div>`;
    d.querySelector('#coMkCopy').onclick = async (ev) => { try { await navigator.clipboard.writeText(txt); ev.target.textContent = 'Kopiert ✓'; } catch { ev.target.textContent = 'Bitte markieren und kopieren'; } };
    f.querySelector('.wiz-nav').innerHTML = '<span></span><button type="button" class="btn btn-dark" id="coMkFin">Fertig</button>';
    d.querySelector('#coMkFin').onclick = () => { d.close(); done?.(); };
    f.querySelectorAll('input').forEach((i) => { i.disabled = true; });
  };
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}

async function list(v, q = '') {
  const r = await api(`/api/admin/creators?status=${filter === 'ALL' ? '' : filter}&q=${encodeURIComponent(q)}`);
  if (!r.ok) { v.innerHTML = `<div class="wa-state err" role="alert"><strong>Creator konnten nicht geladen werden.</strong><span>${esc(r.data?.error || '')}</span></div>`; return; }
  const d = r.data, c = d.counts;
  const kpi = (k, label, n, sub) => `<button type="button" data-f="${k}"><div class="pt-kpi" aria-pressed="${filter === k}"><small>${label}</small><strong>${n}</strong><small>${sub}</small></div></button>`;
  v.innerHTML = `${subnav('creator')}<section class="pt-card"><div class="wa-h-row"><h2>Creator Operations</h2>${d.me.permissions.includes('creators.review') ? '<button type="button" class="btn btn-dark wa-mk-one" id="coMk">+ Creator anlegen</button>' : ''}<span class="form-note" style="margin:0">Ihre Rolle: <strong>${esc(d.me.role_label)}</strong>${d.me.permissions.includes('roles.manage') ? ' · <a href="#creator-rollen" class="ck-link">Rollen verwalten</a>' : ''}</span></div>
      <p class="form-note">Wer braucht Aufmerksamkeit? ${d.attention ? `<strong>${d.attention}</strong> offene Vorgänge` : 'Keine offenen Vorgänge.'}</p></section>
    <div class="co-kpis">
      ${kpi('REVIEW', 'Neue Bewerbungen', c.SUBMITTED + c.UNDER_REVIEW, `${c.UNDER_REVIEW} in Prüfung`)}
      ${kpi('INFO_REQUESTED', 'Rückfrage offen', c.INFO_REQUESTED, 'wartet auf Creator')}
      ${kpi('ACTIVE', 'Aktive Creator', c.ACTIVE, `${c.SUSPENDED} pausiert`)}
      ${kpi('ALL', 'Alle', Object.values(c).reduce((a, b) => a + b, 0), d.bank_review != null ? `${d.bank_review} Zahlungsdaten prüfen` : `${c.DRAFT} Entwürfe`)}
    </div>
    <form class="wa-search" id="coQ"><input type="search" name="q" placeholder="Nach Creator-Name suchen …" value="${esc(q)}" aria-label="Creator suchen" autocomplete="off"><button class="btn btn-dark" type="submit">Suchen</button></form>
    <div class="co-list">${d.creators.length ? d.creators.map((x) => `<button type="button" class="co-row" data-id="${esc(x.id)}">
        <span><strong>${esc(x.display_name || 'Ohne Namen')}</strong><small>${esc(x.name || '')}${x.name && x.country ? ' · ' : ''}${esc(x.country || '')}</small></span>
        <span class="co-hide-m"><small>${esc(x.platforms.map((p) => PL[p] || p).join(', ') || '–')}</small><br><small>${esc((x.categories || []).map((k) => CAT[k] || k).join(', '))}</small></span>
        <span class="co-hide-m">${x.payout ? `${chip(PAY, x.payout.status)} ${x.payout.iban_masked ? `<small class="cr-mask">${esc(x.payout.iban_masked)}</small>` : ''}` : ''}<br><small>${x.submitted_at ? `eingereicht ${dt(x.submitted_at)}` : `geändert ${dt(x.updated_at)}`}</small></span>
        <span>${chip(ST, x.status)}</span></button>`).join('') : '<div class="wa-state"><strong>Keine Creator in dieser Ansicht.</strong><span>Neue Bewerbungen erscheinen hier automatisch.</span></div>'}</div>`;
  v.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; list(v, q); });
  v.querySelector('#coMk')?.addEventListener('click', () => createCreator(() => list(v, q)));
  v.querySelector('#coQ').onsubmit = (e) => { e.preventDefault(); list(v, e.target.elements.q.value.trim()); };
  v.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { location.hash = `creator-${b.dataset.id}`; });
}

async function detail(v, id) {
  const r = await api(`/api/admin/creators/${id}`);
  if (!r.ok) { v.innerHTML = `<p><a href="#creator" class="ck-link">← Alle Creator</a></p><div class="wa-state err" role="alert"><strong>Creator konnte nicht geladen werden.</strong><span>${esc(r.data?.error || '')}</span></div>`; return; }
  const d = r.data, c = d.creator, b = d.business, p = d.payout;
  const steps = { account: 'Konto', profile: 'Profil', social: 'Social', business: 'Business', payout: 'Zahlungsdaten', agreement: 'Vereinbarung' };
  v.innerHTML = `<p><a href="#creator" class="ck-link">← Alle Creator</a></p>
    <section class="pt-card"><div class="wa-h-row"><h2>${esc(c.display_name || 'Ohne Namen')} ${chip(ST, c.status)}</h2></div>
      ${c.status === 'SUBMITTED' || c.status === 'UNDER_REVIEW' ? '<p class="form-note" style="margin:4px 0 0">Neue Creator-Bewerbung</p>' : ''}
      <ul class="cr-done" style="display:flex;flex-wrap:wrap;gap:6px 16px">${Object.entries(steps).map(([k, l]) => `<li class="${d.completeness[k] ? '' : 'miss'}"><span aria-hidden="true">${d.completeness[k] ? '✓' : '!'}</span>${esc(l)}</li>`).join('')}</ul>
      ${c.info_request ? `<div class="pt-alert warn"><strong>Offene Rückfrage:</strong> ${esc(c.info_request)}</div>` : ''}
      <div class="co-actions" id="coAct">${d.actions.map((a) => `<button type="button" class="btn ${ACT[a][1]}" data-a="${a}">${ACT[a][0]}</button>`).join('') || '<span class="form-note">Keine Aktion in diesem Status bzw. für Ihre Rolle.</span>'}${d.can.delete ? '<button type="button" class="btn btn-danger" id="coDel">Konto löschen</button>' : ''}</div></section>
    <div class="pt-grid2 co-360">
      <section class="pt-card"><h3>Profil</h3>${dl([
        ['Name', c.first_name !== undefined ? esc([c.first_name, c.last_name].filter(Boolean).join(' ')) : '<span class="form-note">für Ihre Rolle ausgeblendet</span>'],
        ['E-Mail', c.email ? `${esc(c.email)} ${c.email_confirmed ? '<span class="st ok" style="margin:0">bestätigt</span>' : '<span class="st warn" style="margin:0">unbestätigt</span>'}` : null],
        ['Telefon', c.phone ? esc(c.phone) : null], ['Land', esc(c.country || '')], ['Unternehmen', esc(c.company || '')],
        ['Website', c.website ? `<a href="${safeUrl(c.website)}" target="_blank" rel="noopener noreferrer">${esc(c.website)}</a>` : null],
        ['Kategorien', esc((c.categories || []).map((k) => CAT[k] || k).join(', '))], ['Attributions-Code', c.ref_code ? `<code>${esc(c.ref_code)}</code>` : null],
        ['Bewerbung begonnen', dt(c.created_at)], ['Eingereicht', c.submitted_at ? dt(c.submitted_at) : null], ['Freigegeben', c.approved_at ? dt(c.approved_at) : null],
      ])}${c.bio ? `<p style="white-space:pre-wrap;margin:8px 0 0">${esc(c.bio)}</p>` : ''}</section>
      <section class="pt-card"><h3>Social Media</h3><p class="form-note" style="margin:0 0 8px">Nur öffentliche Angaben, keine Konto-Verbindung.</p>${d.socials.length ? `<ul class="co-social">${d.socials.map((s) => `<li><strong>${esc(s.platform === 'other' ? s.platform_label || 'Andere' : PL[s.platform])}</strong> ${esc(s.handle || s.channel_name || '')}<br><a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a>${s.follower_range ? ` <small class="form-note">· ${esc(s.follower_range.replace(/_/g, '–'))}</small>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Keine Angaben.</p>'}</section>
      ${b !== undefined ? `<section class="pt-card"><h3>Business und Rechnung</h3>${b ? dl([
        ['Art', b.entity_type === 'company' ? 'Unternehmen' : 'Privatperson / Einzelunternehmen'], ['Name / Firma', esc(b.legal_name)], ['Rechtsform', esc(b.legal_form || '')],
        ['Anschrift', `${esc(b.street)}<br>${esc(b.postal_code)} ${esc(b.city)}, ${esc(b.country)}`], ['Umsatzsteuer', esc(VAT[b.vat_status] || b.vat_status)],
        ['Steuernummer', esc(b.tax_number || '')], ['USt-IdNr.', esc(b.vat_id || '')], ['Rechnungs-E-Mail', esc(b.billing_email)],
      ]) : '<p class="form-note">Noch nicht hinterlegt.</p>'}</section>` : ''}
      ${p !== undefined ? `<section class="pt-card"><h3>Zahlungsdaten</h3>${p ? `${dl([['Kontoinhaber', esc(p.holder_name)], ['IBAN', `<span class="cr-mask">${esc(p.iban_masked)}</span>`], ['BIC', esc(p.bic || '')], ['Status', chip(PAY, p.status)], ['Hinterlegt', dtt(p.created_at)], ['Geprüft', p.verified_at ? dtt(p.verified_at) : null]])}
        <div class="co-actions">${d.can.reveal ? '<button type="button" class="btn btn-outline" id="coReveal">Geschützte Zahlungsdaten anzeigen</button>' : ''}${d.can.verify && p.status !== 'VERIFIED' ? '<button type="button" class="btn btn-outline" id="coVerify">Als geprüft markieren</button>' : ''}</div><div id="coRevealBox"></div>
        ${d.can.reveal ? '<p class="form-note">Das Anzeigen der vollständigen Zahlungsdaten wird mit Ihrer Kennung protokolliert.</p>' : ''}` : '<p class="form-note">Noch nicht hinterlegt.</p>'}</section>` : ''}
      <section class="pt-card"><h3>Vereinbarung</h3>${dl([['Aktuelle Fassung', d.agreement.current ? `${esc(d.agreement.current.version)}${d.agreement.current.is_draft ? ' <span class="st warn" style="margin:0">Entwurf</span>' : ''}` : '–'], ['Bestätigt', d.agreement.accepted_current ? '<span class="st ok" style="margin:0">ja</span>' : '<span class="st bad" style="margin:0">nein</span>']])}
        ${d.agreement.history.length ? `<p class="form-note">Zustimmungen: ${d.agreement.history.map((h) => `${esc(h.lr_creator_agreements?.version || '')} am ${dtt(h.accepted_at)}`).join(' · ')}</p>` : ''}</section>
      <section class="pt-card"><h3>Prüfverlauf</h3>${d.reviews.length ? `<ul class="pt-check">${d.reviews.map((x) => `<li><strong>${esc(ACT[x.action]?.[0] || x.action)}</strong> · ${dtt(x.created_at)}${x.visible_to_creator ? ' <small class="form-note">(an Creator gesendet)</small>' : ''}${x.message ? `<br><span style="white-space:pre-wrap">${esc(x.message)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Noch keine Entscheidungen.</p>'}</section>
    </div>
    ${d.can.conversions ? '<section class="pt-card" id="coPerf"><h3>Attribution und Performance</h3><p class="form-note">Wird geladen …</p></section>' : ''}
    <div class="pt-grid2 co-360">
      <section class="pt-card"><h3>Persönlicher Link</h3>${d.link ? `<p><code>${esc(d.link)}</code></p>` : '<p class="form-note">Wird bei der Freigabe vergeben.</p>'}
        <h3>Kampagnen</h3>${d.memberships.length ? `<ul class="co-social">${d.memberships.map((m) => `<li>${esc(m.lr_creator_campaigns?.name || '')} ${chip(KST, m.lr_creator_campaigns?.status)}</li>`).join('')}</ul>` : '<p class="form-note">Keine ausdrückliche Zuordnung (sieht alle Kampagnen „für alle Creator“).</p>'}</section>
      <section class="pt-card"><div class="wa-h-row"><h3 style="margin:0">Community-Vorteil</h3>${d.can.campaigns ? '<button type="button" class="btn btn-outline btn-sm" id="coBen">+ Vorteil</button>' : ''}</div>
        ${d.benefits.length ? `<ul class="co-social" style="margin-top:8px">${d.benefits.map((b) => `<li><strong class="cr-mask">${esc(b.code)}</strong> ${b.active ? '<span class="st ok" style="margin:0">aktiv</span>' : '<span class="st" style="margin:0">inaktiv</span>'}<br>${esc(b.benefit)}<br><small class="form-note">ab ${dt(b.starts_at)}${b.ends_at ? ` bis ${dt(b.ends_at)}` : ''}</small>${d.can.campaigns ? ` <span class="wa-actions"><button type="button" data-ben="${esc(b.id)}">Bearbeiten</button></span>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Kein Vorteil hinterlegt.</p>'}
        <p class="form-note">Damit der Code an der Kasse wirkt, muss in Stripe ein gleichnamiger Aktionscode existieren.</p></section>
    </div>
    ${d.billing ? `<section class="pt-card"><div class="wa-h-row"><h3 style="margin:0">Abrechnung</h3>${d.billing.manage ? `<span class="pt-row"><label class="form-note">Verfahren <select id="coMode"><option value="INVOICE"${d.billing.mode === 'INVOICE' ? ' selected' : ''}>Rechnung des Creators</option><option value="CREDIT_NOTE"${d.billing.mode === 'CREDIT_NOTE' ? ' selected' : ''}>Gutschrift durch LeaseRun</option></select></label><button type="button" class="btn btn-outline btn-sm" id="coAdj">+ Bonus / Korrektur</button></span>` : ''}</div>
      ${d.billing.statements.length ? `<div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Monat</th><th>Status</th><th>Conv.</th><th>Provision</th><th>Anpassungen</th><th>Auszahlung</th><th>Dokumente</th><th>Zahlung</th></tr></thead><tbody>${d.billing.statements.map((x) => `<tr><td>${esc(x.period)}</td><td>${chip(SST, x.status)}</td><td>${num(x.conversions)}</td><td>${eurC(x.commission_cents)}</td><td>${eurC(x.adjustments_cents)}</td><td><strong>${eurC(x.payout_cents)}</strong></td><td>${(x.lr_creator_documents || []).map((doc) => `<small>${esc(DOCT[doc.doc_type] || doc.doc_type)} ${esc(doc.number)}</small>`).join('<br>') || '–'}</td><td>${x.lr_creator_payouts?.[0] ? chip(PST, x.lr_creator_payouts[0].status) : (Array.isArray(x.lr_creator_payouts) ? '–' : x.lr_creator_payouts ? chip(PST, x.lr_creator_payouts.status) : '–')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Noch keine abgeschlossenen Monate.</p>'}
      <p><a class="ck-link" href="#creator-abrechnung">Zu Creator Billing</a></p></section>` : ''}
    <section class="pt-card"><h3>Beiträge</h3>${d.content.length ? `<ul class="co-social">${d.content.map((x) => `<li>${dt(x.published_on)} ${chip(CST, x.status)} <a href="${/^https:\/\//.test(x.url) ? esc(x.url) : '#'}" target="_blank" rel="noopener noreferrer">${esc(x.title || x.url)}</a></li>`).join('')}</ul><p><a class="ck-link" href="#creator-inhalte">Zur Beitragsprüfung</a></p>` : '<p class="form-note">Noch keine Beiträge.</p>'}</section>
    ${d.audit ? `<section class="pt-card"><h3>Audit</h3><p class="form-note">Unveränderbares Protokoll. Akteure pseudonymisiert, keine Zahlungsdaten.</p><div style="overflow-x:auto"><table class="wa-table co-audit"><thead><tr><th>Zeit</th><th>Ereignis</th><th>Wer</th><th>Ergebnis</th></tr></thead><tbody>${d.audit.map((a) => `<tr><td>${dtt(a.created_at)}</td><td>${esc(EV[a.event_type] || a.event_type)}</td><td>${esc(a.actor_kind === 'creator' ? 'Creator' : `${a.actor_role || ''} ${a.actor_ref}`)}</td><td>${a.result === 'SUCCESS' ? '<span class="st ok" style="margin:0">ok</span>' : `<span class="st bad" style="margin:0">${esc(a.result)}</span>`}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;

  v.querySelectorAll('[data-a]').forEach((btn) => btn.onclick = () => decide(v, id, btn.dataset.a, c));
  v.querySelector('#coDel')?.addEventListener('click', async (e) => {
    const m = c.email || '';
    const typed = prompt(`Creator-Konto ${c.display_name || ''} endgültig löschen?\n\nZugang, Profil, Social, Beiträge und Zahlungsdaten werden entfernt. Bereits erstellte Abrechnungen, Gutschriften und Auszahlungen bleiben wegen der gesetzlichen Aufbewahrung erhalten. Das lässt sich nicht rückgängig machen.\n\nZur Bestätigung die E-Mail-Adresse${m ? ` (${m})` : ''} eingeben:`);
    if (typed === null) return;
    e.target.disabled = true;
    const x = await api(`/api/admin/creators/${id}/delete`, { method: 'POST', body: JSON.stringify({ confirmEmail: typed.trim() }) });
    if (!x.ok) { alert(x.data?.error || 'Löschen fehlgeschlagen.'); e.target.disabled = false; return; }
    alert(x.data.mode === 'retained' ? 'Konto gelöscht. Die Abrechnungsdaten werden gesetzlich aufbewahrt.' : 'Creator-Konto vollständig gelöscht.');
    location.hash = '#creator';
  });
  const benefitDlg = (b) => dialog(`<h2 style="margin:0;color:#0F2C59">${b ? 'Vorteil bearbeiten' : 'Community-Vorteil anlegen'}</h2><div class="wa-grid2">
      <label>Code*<input name="code" required maxlength="20" pattern="[A-Za-z0-9]{3,20}" value="${esc(b?.code || (c.display_name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}"></label>
      <label>Status<select name="active"><option value="1"${!b || b.active ? ' selected' : ''}>aktiv</option><option value="0"${b && !b.active ? ' selected' : ''}>inaktiv</option></select></label>
      <label class="full">Vorteil*<input name="benefit" required maxlength="200" placeholder="z. B. 10 % auf den Käufer-Pass" value="${esc(b?.benefit || '')}"></label>
      <label>Gültig ab<input type="date" name="starts" value="${esc((b?.starts_at || '').slice(0, 10))}"></label><label>Gültig bis<input type="date" name="ends" value="${esc((b?.ends_at || '').slice(0, 10))}"></label></div>
      <label class="pt-field">Bedingungen<textarea name="terms" rows="3" maxlength="2000">${esc(b?.terms || '')}</textarea></label>`,
    async (f) => {
      const day = (x, end) => (x ? new Date(`${x}T${end ? '23:59:59' : '00:00:00'}+01:00`).toISOString() : null);
      const x = await api('/api/admin/creators/benefits', { method: 'POST', body: JSON.stringify({ ...(b ? { id: b.id } : {}), creator_id: id, code: fv(f, 'code'), benefit: fv(f, 'benefit'), terms: fv(f, 'terms') || null, active: fv(f, 'active') === '1', ...(fv(f, 'starts') ? { starts_at: day(fv(f, 'starts')) } : {}), ends_at: day(fv(f, 'ends'), true) }) });
      if (!x.ok) return x.data?.error || 'Nicht möglich.';
      detail(v, id); return null;
    });
  v.querySelector('#coBen')?.addEventListener('click', () => benefitDlg(null));
  v.querySelectorAll('[data-ben]').forEach((b) => b.onclick = () => benefitDlg(d.benefits.find((x) => x.id === b.dataset.ben)));
  if (d.can.conversions) perfBox(v.querySelector('#coPerf'), id, d.can.reverse, '30d');
  v.querySelector('#coMode')?.addEventListener('change', async (e) => {
    const x = await api('/api/admin/creators/billing', { method: 'POST', body: JSON.stringify({ action: 'billing_mode', creator_id: id, mode: e.target.value }) });
    if (!x.ok) { alert(x.data?.error || 'Nicht möglich.'); return; }
    detail(v, id);
  });
  v.querySelector('#coAdj')?.addEventListener('click', () => adjustDialog(id, () => detail(v, id)));
  v.querySelector('#coVerify')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const x = await api(`/api/admin/creators/${id}/bank`, { method: 'POST', body: JSON.stringify({ action: 'verify' }) });
    if (!x.ok) { alert(x.data?.error || 'Nicht möglich.'); e.target.disabled = false; return; }
    detail(v, id);
  });
  v.querySelector('#coReveal')?.addEventListener('click', async (e) => {
    if (!confirm('Vollständige Zahlungsdaten anzeigen? Der Zugriff wird protokolliert.')) return;
    e.target.disabled = true;
    const x = await api(`/api/admin/creators/${id}/bank`, { method: 'POST', body: JSON.stringify({ action: 'reveal' }) });
    const box = v.querySelector('#coRevealBox');
    if (!x.ok) { box.innerHTML = `<div class="pt-alert bad">${esc(x.data?.error || 'Nicht möglich.')}</div>`; e.target.disabled = false; return; }
    box.innerHTML = `<div class="co-reveal" role="status"><strong>Geschützte Zahlungsdaten</strong> <small class="form-note">· wird in <span id="coT">${x.data.hide_after_seconds}</span> s ausgeblendet</small>${dl([['Kontoinhaber', esc(x.data.holder_name)], ['IBAN', `<span class="cr-mask">${esc(x.data.iban)}</span>`], ['BIC', esc(x.data.bic || '')]])}<button type="button" class="btn btn-outline btn-sm" id="coHide">Jetzt ausblenden</button></div>`;
    let left = x.data.hide_after_seconds;
    const hide = () => { clearInterval(tm); box.innerHTML = ''; e.target.disabled = false; };
    const tm = setInterval(() => { left -= 1; const t = v.querySelector('#coT'); if (t) t.textContent = String(left); if (left <= 0 || !document.body.contains(box)) hide(); }, 1000);
    box.querySelector('#coHide').onclick = hide;
  });
}

function decide(v, id, action, c) {
  const needs = ['REQUEST_INFO', 'REJECT', 'SUSPEND'].includes(action);
  const d = document.createElement('dialog');
  d.className = 'wa-dlg';
  const title = { START_REVIEW: 'Prüfung starten', APPROVE: 'Creator freigeben', REQUEST_INFO: 'Information anfordern', REJECT: 'Bewerbung ablehnen', SUSPEND: 'Creator pausieren', REACTIVATE: 'Creator reaktivieren' }[action];
  const hint = {
    APPROVE: 'Bei Freigabe wird der Creator aktiv: Creator-Portal, Zahlungsdaten und Vereinbarung stehen ihm sofort zur Verfügung. Er erhält eine E-Mail.',
    REQUEST_INFO: 'Der Creator erhält diese Nachricht per E-Mail und im Portal („LeaseRun benötigt noch eine Information von dir.“) und kann seine Angaben ergänzen.',
    REJECT: 'Der Creator erhält diese Begründung per E-Mail.', SUSPEND: 'Der Creator erhält diese Begründung per E-Mail. Der Zugang wird pausiert.',
    START_REVIEW: 'Der Status wechselt auf „In Prüfung“. Der Creator kann seine Angaben weiterhin nicht ändern.', REACTIVATE: 'Der Creator ist wieder aktiv und erhält eine E-Mail.',
  }[action];
  d.innerHTML = `<form class="wa-dlg-in" method="dialog"><h2 style="margin:0;color:#0F2C59">${esc(title)}</h2><p>${esc(c.display_name || '')}</p><p class="form-note">${esc(hint)}</p>
    ${needs ? '<label class="pt-field">Nachricht an den Creator*<textarea name="message" rows="5" maxlength="2000" required></textarea></label>' : ''}
    <p class="pt-alert bad" id="coErr" hidden></p>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Abbrechen</button><button type="submit" class="btn btn-dark">${esc(title)}</button></div></form>`;
  document.body.append(d);
  d.querySelector('[data-x]').onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  d.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const message = e.target.elements.message?.value.trim() || null;
    const err = d.querySelector('#coErr');
    if (needs && !message) { err.hidden = false; err.textContent = 'Bitte eine Nachricht an den Creator angeben.'; return; }
    const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
    const r = await api(`/api/admin/creators/${id}`, { method: 'POST', body: JSON.stringify({ action, message }) });
    if (!r.ok) { err.hidden = false; err.textContent = r.data?.error || 'Nicht möglich.'; btn.disabled = false; return; }
    d.close();
    detail(v, id);
  };
  d.showModal();
}

async function roles(v) {
  const r = await api('/api/admin/creators/roles');
  if (!r.ok) { v.innerHTML = `<p><a href="#creator" class="ck-link">← Creator Operations</a></p><div class="wa-state err"><strong>${esc(r.data?.error || 'Nicht möglich.')}</strong></div>`; return; }
  const OPTS = [['', 'Standard (Super Admin)'], ['SUPER_ADMIN', 'Super Admin'], ['FINANCE_ADMIN', 'Finance Admin'], ['CREATOR_MANAGER', 'Creator Manager'], ['SUPPORT', 'Support'], ['READ_ONLY', 'Nur lesen']];
  v.innerHTML = `${subnav('creator-rollen')}<section class="pt-card"><h2>Rollen im Creator-Bereich</h2>
    <p class="form-note">Rollen schränken den Creator-Bereich ein – sie geben keinen zusätzlichen Zugang zum Web-Admin. Zugang haben weiterhin nur Adressen aus ADMIN_EMAILS mit zweitem Faktor. Vollständige Zahlungsdaten sehen nur Super Admin und Finance Admin.</p>
    <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Administrator</th><th>Rolle</th></tr></thead><tbody>${r.data.admins.map((a) => `<tr><td>${esc(a.email)}${a.self ? ' <small class="form-note">(Sie)</small>' : ''}</td><td>${a.self ? esc(a.role_label) : `<select data-email="${esc(a.email)}" aria-label="Rolle für ${esc(a.email)}">${OPTS.map(([k, l]) => `<option value="${k}"${(a.explicit ? a.role : '') === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`}</td></tr>`).join('')}</tbody></table></div>
    <p class="form-note" id="coRoleMsg" role="status"></p></section>`;
  v.querySelectorAll('select[data-email]').forEach((s) => s.onchange = async () => {
    const m = v.querySelector('#coRoleMsg');
    const x = await api('/api/admin/creators/roles', { method: 'POST', body: JSON.stringify({ email: s.dataset.email, role: s.value || null }) });
    m.textContent = x.ok ? 'Gespeichert und protokolliert.' : (x.data?.error || 'Nicht möglich.');
  });
}

// Attribution und Performance eines Creators (Creator 360)
async function perfBox(box, id, canReverse, range) {
  const r = await api(`/api/admin/creators/${id}/conversions?range=${range}`);
  if (!r.ok) { box.innerHTML = `<h3>Attribution und Performance</h3><p class="pt-alert bad">${esc(r.data?.error || 'Nicht möglich.')}</p>`; return; }
  const p = r.data.performance || {};
  box.innerHTML = `<div class="wa-h-row"><h3 style="margin:0">Attribution und Performance</h3><div class="pc-chips" role="group" aria-label="Zeitraum">${RANGES.map(([k, l]) => `<button type="button" data-pr="${k}" aria-pressed="${k === range}">${l}</button>`).join('')}</div></div>
    <div class="pt-kpis" style="margin-top:10px"><div class="pt-kpi"><small>Besuche</small><strong>${num(p.visits)}</strong><small>${num(p.visitors)} Besucher</small></div><div class="pt-kpi"><small>Registrierungen</small><strong>${num(p.registrations)}</strong></div>
      <div class="pt-kpi"><small>Conversions</small><strong>${num(p.conversions)}</strong><small>${num(p.via_code)} über Code</small></div><div class="pt-kpi"><small>Umsatz netto</small><strong>${eurC(p.revenue_net_cents)}</strong><small>${num(p.reversed)} zurückgenommen</small></div></div>
    ${r.data.conversions.length ? `<div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Datum</th><th>Kunde</th><th>Quelle</th><th>Tarif</th><th>Netto</th><th>Status</th><th></th></tr></thead><tbody>${r.data.conversions.map((x) => `<tr><td>${dtt(x.occurred_at)}</td><td><code>${esc(x.customer)}</code></td><td>${x.source === 'code' ? 'Code' : 'Link'}${x.campaign_slug ? ` · ${esc(x.campaign_slug)}` : ''}</td><td>${esc(x.plan || '')}</td><td>${eurC(x.amount_net_cents)}</td><td>${x.status === 'PENDING' ? '<span class="st warn" style="margin:0">offen</span>' : '<span class="st bad" style="margin:0">zurückgenommen</span>'}</td><td>${canReverse && x.status === 'PENDING' ? `<span class="wa-actions"><button type="button" data-rv="${esc(x.id)}">Zurücknehmen</button></span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine Conversions in diesem Zeitraum.</p>'}
    <p class="form-note">Kunden erscheinen nur als gekürzte Kennung. Creator sehen ausschließlich Summen.</p>`;
  box.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => perfBox(box, id, canReverse, b.dataset.pr));
  box.querySelectorAll('[data-rv]').forEach((b) => b.onclick = () => dialog('<h2 style="margin:0;color:#0F2C59">Conversion zurücknehmen</h2><p class="form-note">Endgültig und protokolliert. Erstattungen über Stripe werden automatisch zurückgenommen.</p><label class="pt-field">Grund*<textarea name="reason" rows="3" maxlength="300" required></textarea></label>',
    async (f) => { const x = await api(`/api/admin/creators/${id}/conversions`, { method: 'POST', body: JSON.stringify({ conversion_id: b.dataset.rv, reason: fv(f, 'reason') }) }); if (!x.ok) return x.data?.error || 'Nicht möglich.'; perfBox(box, id, canReverse, range); return null; }));
}

// ---------- Phase 3: Abrechnung, Auszahlungen, Provisionsregeln ----------
const SST = { READY: ['warn', 'Bereit'], INVOICED: ['warn', 'Rechnung da'], APPROVED: ['ok', 'Freigegeben'], PAID: ['ok', 'Bezahlt'], ZERO: ['', 'Kein Betrag'] };
const PST = { READY: ['warn', 'Bereit'], APPROVED: ['ok', 'Freigegeben'], EXPORTED: ['ok', 'Exportiert'], PAID: ['ok', 'Bezahlt'], FAILED: ['bad', 'Fehlgeschlagen'], RETURNED: ['bad', 'Zurückgekommen'] };
const DOCT = { STATEMENT: 'Abrechnung', INVOICE: 'Rechnung', CREDIT_NOTE: 'Gutschrift', CANCELLATION: 'Storno' };
const prevPeriod = (p) => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const nextPeriod = (p) => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
let billPeriod = null;

function adjustDialog(creatorId, done, period) {
  const now = new Date();
  const def = period || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  dialog(`<h2 style="margin:0;color:#0F2C59">Bonus oder Korrektur</h2><p class="form-note">Wird mit dem Abschluss des gewählten Monats (oder später) verrechnet. Negative Beträge für Korrekturen zu Ungunsten des Creators.</p>
    <div class="wa-grid2"><label>Art<select name="kind"><option value="BONUS">Bonus</option><option value="CORRECTION">Korrektur</option></select></label><label>Monat<input name="period" pattern="20[0-9]{2}-(0[1-9]|1[0-2])" value="${esc(def)}"></label>
    <label>Betrag in € (netto)*<input name="amount" inputmode="decimal" required placeholder="z. B. 50,00 oder -12,50"></label></div>
    <label class="pt-field">Begründung*<textarea name="reason" rows="2" maxlength="300" required></textarea></label>`,
  async (f) => {
    const cents = Math.round(Number(fv(f, 'amount').replace(/\./g, '').replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || !cents) return 'Bitte einen Betrag angeben.';
    const x = await api('/api/admin/creators/billing', { method: 'POST', body: JSON.stringify({ action: 'adjust', creator_id: creatorId, period: fv(f, 'period'), kind: fv(f, 'kind'), amount_cents: cents, reason: fv(f, 'reason') }) });
    if (!x.ok) return x.data?.error || 'Nicht möglich.';
    done(); return null;
  });
}

// Automatik und Kontrollen der Abrechnung (ändern dürfen nur Super Admins)
function settingsCard(d) {
  const c = d.settings;
  if (!c) return '';
  const on = (b) => (b ? '<span class="st ok" style="margin:0">an</span>' : '<span class="st" style="margin:0">aus</span>');
  if (!d.me.settings) {
    return `<section class="pt-card"><h2>Automatik</h2><dl class="pt-dl"><div><dt>Automatischer Monatsabschluss</dt><dd>${on(c.auto_close)}</dd></div><div><dt>Sperrfrist nach Monatsende</dt><dd>${num(c.close_delay_days)} Tage</dd></div><div><dt>Erinnerung „Rechnung fehlt“</dt><dd>nach ${num(c.invoice_reminder_days)} Tagen</dd></div><div><dt>Vier-Augen-Prinzip</dt><dd>${on(c.four_eyes)}</dd></div></dl><p class="form-note">Ändern können nur Super Admins.</p></section>`;
  }
  return `<section class="pt-card"><h2>Automatik</h2><form id="coSet" class="co-set">
    <label class="co-switch"><input type="checkbox" name="auto_close"${c.auto_close ? ' checked' : ''}><span><strong>Automatischer Monatsabschluss</strong><small>Täglicher Lauf schließt den Vormonat nach Ablauf der Sperrfrist ab. Creator erhalten danach eine E-Mail „Abrechnung bereit“.</small></span></label>
    <label class="co-switch"><input type="checkbox" name="four_eyes"${c.four_eyes ? ' checked' : ''}><span><strong>Vier-Augen-Prinzip</strong><small>Wer eine Abrechnung freigibt, darf die Auszahlung nicht selbst freigeben.</small></span></label>
    <div class="wa-grid2"><label>Sperrfrist nach Monatsende (Tage)<input type="number" name="close_delay_days" min="14" max="60" value="${num(c.close_delay_days)}"></label><label>Erinnerung „Rechnung fehlt“ nach (Tagen)<input type="number" name="invoice_reminder_days" min="3" max="30" value="${num(c.invoice_reminder_days)}"></label></div>
    <div class="pt-row"><button type="submit" class="btn btn-dark btn-sm">Speichern</button><span class="form-note" id="coSetMsg" role="status"></span></div>
    <p class="form-note">Die Sperrfrist beträgt mindestens 14 Tage, damit Widerrufe vor dem Abschluss berücksichtigt werden. Hinweise und Erinnerungen werden nur verschickt, wenn der E-Mail-Versand eingerichtet ist.</p></form></section>`;
}

async function billingAdmin(v) {
  const r = await api(`/api/admin/creators/billing${billPeriod ? `?period=${billPeriod}` : ''}`);
  if (!r.ok) return errBox(v, r.data?.error);
  const d = r.data, o = d.overview;
  billPeriod = d.period;
  const canClose = new Date(d.close_allowed_at) <= new Date();
  const tile = (l, val, sub) => `<div class="pt-kpi"><small>${l}</small><strong>${val}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  v.innerHTML = `${subnav('creator-abrechnung')}
    <div class="co-tiles6">${tile('Provision offen', eurC(o.pending_total_cents + o.approved_total_cents), 'gesamt')}${tile('Ausstehend', eurC(o.pending_total_cents))}${tile('Freigegeben', eurC(o.approved_total_cents))}${tile('Rechnungen offen', num(o.invoices_open), d.label)}${tile('Payout Ready', eurC(o.payout_ready_cents), d.label)}${tile('Bezahlt', eurC(o.paid_total_cents), 'gesamt')}</div>
    <section class="pt-card co-close"><div class="wa-h-row"><div><small class="pt-top-k">Creator Monatsabschluss</small><h2 style="margin:2px 0 0">${esc(d.label)}</h2></div>
      <div class="co-period"><button type="button" class="btn btn-outline btn-sm" data-per="${prevPeriod(d.period)}" aria-label="Vormonat">←</button><button type="button" class="btn btn-outline btn-sm" data-per="${nextPeriod(d.period)}" aria-label="Folgemonat">→</button></div></div>
      <dl class="pt-dl"><div><dt>Creator</dt><dd>${num(o.creators)}</dd></div><div><dt>Provision</dt><dd>${eurC(o.commission_cents)}</dd></div><div><dt>Rechnungen offen</dt><dd>${num(o.invoices_open)}</dd></div><div><dt>Payout Ready</dt><dd>${eurC(o.payout_ready_cents)}</dd></div><div><dt>Blockiert</dt><dd>${eurC(o.blocked_cents)}</dd></div><div><dt>Bezahlt</dt><dd>${eurC(o.paid_cents)}</dd></div></dl>
      ${d.unbilled.conversions ? `<p class="form-note">Noch nicht abgerechnet: ${num(d.unbilled.conversions)} Conversions (${eurC(d.unbilled.revenue_net_cents)} netto).</p>` : ''}
      ${d.open_refunds ? `<p class="form-note">${num(d.open_refunds)} Erstattung(en) aus Stripe werden beim nächsten Abschluss verrechnet (geringere Grundlage bzw. anteilige Rückforderung).</p>` : ''}
      ${d.me.manage ? (canClose ? `<button type="button" class="btn btn-dark" id="coClose">${o.closed ? 'Nachzügler abrechnen' : 'Monatsabschluss durchführen'}</button>` : `<button type="button" class="btn btn-dark" disabled>Monatsabschluss ab ${dt(d.close_allowed_at)}</button><span class="form-note"> Widerrufsfrist der Käufe läuft noch.</span>`) : ''}</section>
    <section class="pt-card"><h2>Abrechnungen ${esc(d.label)}</h2>${d.statements.length ? `<div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Creator</th><th>Status</th><th>Conv.</th><th>Provision</th><th>Anpass.</th><th>USt</th><th>Auszahlung</th><th>Offen</th><th>Dokumente</th><th></th></tr></thead><tbody>
      ${d.statements.map((s) => `<tr><td><a class="ck-link" href="#creator-${esc(s.creator_id)}">${esc(s.name)}</a><br><small class="form-note">${s.billing_mode === 'CREDIT_NOTE' ? 'Gutschrift' : 'Rechnung'}</small></td><td>${chip(SST, s.status)}</td><td>${num(s.conversions)}</td><td>${eurC(s.commission_cents)}</td><td>${eurC(s.adjustments_cents)}</td><td>${eurC(s.vat_cents)}</td><td><strong>${eurC(s.payout_cents)}</strong></td>
        <td>${s.blockers.length ? s.blockers.map((b) => `<span class="st bad" style="margin:0 4px 4px 0">${esc(b.text)}</span>`).join('') : (s.status === 'READY' || s.status === 'INVOICED' ? '<span class="st ok" style="margin:0">bereit</span>' : '')}</td>
        <td>${s.documents.filter((x) => x.doc_type !== 'STATEMENT').map((x) => `<small>${esc(DOCT[x.doc_type])} ${esc(x.number)}</small>`).join('<br>') || '–'}</td>
        <td>${d.me.manage && (s.status === 'READY' || s.status === 'INVOICED') && !s.blockers.length ? `<span class="wa-actions"><button type="button" data-ap="${esc(s.id)}">Freigeben</button></span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="form-note">${o.closed ? 'Keine Abrechnungen.' : 'Dieser Monat ist noch nicht abgeschlossen.'}</p>`}</section>
    ${settingsCard(d)}
    <section class="pt-card"><div class="wa-h-row"><h2 style="margin:0">Offene Anpassungen</h2></div>${d.open_adjustments.length ? `<ul class="co-social" style="margin-top:8px">${d.open_adjustments.map((x) => `<li>${esc(x.lr_creators?.display_name || 'Creator')} · ${esc(x.period)} · ${esc(x.kind)} <strong>${eurC(x.amount_cents)}</strong> – ${esc(x.reason)} ${d.me.manage && (x.kind === 'BONUS' || x.kind === 'CORRECTION') ? `<span class="wa-actions"><button type="button" data-deladj="${esc(x.id)}">Löschen</button></span>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Keine. Boni und Korrekturen legen Sie in Creator 360 an; Rückforderungen und Überträge entstehen automatisch beim Abschluss.</p>'}</section>`;
  v.querySelectorAll('[data-per]').forEach((b) => b.onclick = () => { billPeriod = b.dataset.per; billingAdmin(v); });
  v.querySelector('#coClose')?.addEventListener('click', () => dialog(`<h2 style="margin:0;color:#0F2C59">Monatsabschluss ${esc(d.label)}</h2><p>Für alle Creator mit Käufen oder Anpassungen wird eine Abrechnung erstellt. Beträge sind danach festgeschrieben; spätere Erstattungen werden im Folgemonat verrechnet.</p><p class="form-note">Rechnungs-Creator erhalten danach die Aufgabe „Rechnung erstellen“.</p>`,
    async () => { const x = await api('/api/admin/creators/billing', { method: 'POST', body: JSON.stringify({ action: 'close', period: d.period }) }); if (!x.ok) return x.data?.error || 'Nicht möglich.'; billingAdmin(v); return null; }));
  v.querySelectorAll('[data-ap]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const x = await api('/api/admin/creators/billing', { method: 'POST', body: JSON.stringify({ action: 'approve', statement_id: b.dataset.ap }) });
    if (!x.ok) { alert([x.data?.error, ...(x.data?.blockers || [])].filter(Boolean).join('\n')); b.disabled = false; return; }
    billingAdmin(v);
  });
  v.querySelector('#coSet')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, msg = v.querySelector('#coSetMsg');
    const body = { action: 'settings', auto_close: f.auto_close.checked, four_eyes: f.four_eyes.checked, close_delay_days: Number(f.close_delay_days.value), invoice_reminder_days: Number(f.invoice_reminder_days.value) };
    const x = await api('/api/admin/creators/billing', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = x.ok ? 'Gespeichert und protokolliert.' : (x.data?.error || 'Nicht möglich.');
  });
  v.querySelectorAll('[data-deladj]').forEach((b) => b.onclick = async () => { const x = await api('/api/admin/creators/billing', { method: 'POST', body: JSON.stringify({ action: 'delete_adjustment', id: b.dataset.deladj }) }); if (x.ok) billingAdmin(v); else alert(x.data?.error || 'Nicht möglich.'); });
}

async function payoutsAdmin(v) {
  const r = await api('/api/admin/creators/payouts');
  if (!r.ok) return errBox(v, r.data?.error);
  const d = r.data;
  v.innerHTML = `${subnav('creator-auszahlungen')}<section class="pt-card"><div class="wa-h-row"><h2 style="margin:0">Payout Center</h2><span class="form-note">${d.four_eyes ? 'Vier-Augen-Prinzip aktiv' : 'Vier-Augen-Prinzip aus (Abrechnung → Automatik)'}</span></div>
    ${d.debtor_configured ? '' : '<div class="pt-alert warn">Für den SEPA-Export fehlt das Auszahlungskonto von LeaseRun (CREATOR_PAYOUT_IBAN oder INVOICE_IBAN in Vercel).</div>'}
    <p class="form-note">Ablauf: Abrechnung freigeben → Auszahlung freigeben → SEPA-Datei im Online-Banking hochladen und dort freigeben → hier als bezahlt markieren oder unten den Kontoauszug abgleichen. LeaseRun löst selbst keine Zahlung aus.</p>
    ${d.payouts.length ? `<div style="overflow-x:auto"><table class="wa-table"><thead><tr><th><input type="checkbox" id="poAll" aria-label="Alle offenen wählen"></th><th>Creator</th><th>Monat</th><th>Betrag</th><th>Konto</th><th>Bankdaten</th><th>Status</th><th>Verwendungszweck</th></tr></thead><tbody>
    ${d.payouts.map((p) => `<tr><td><input type="checkbox" data-po="${esc(p.id)}" aria-label="Auswählen"></td><td><a class="ck-link" href="#creator-${esc(p.creator_id)}">${esc(p.lr_creators?.display_name || 'Creator')}</a></td><td>${esc(p.period_label)}</td><td><strong>${eurC(p.amount_cents)}</strong></td><td><span class="cr-mask">${esc(p.iban_masked)}</span></td><td>${p.bank_status === 'VERIFIED' ? '<span class="st ok" style="margin:0">geprüft</span>' : p.bank_status === 'VERIFICATION_REQUIRED' ? '<span class="st bad" style="margin:0">Prüfung nötig</span>' : p.bank_status ? '<span class="st warn" style="margin:0">hinterlegt</span>' : '<span class="st bad" style="margin:0">abgelöst</span>'}</td><td>${chip(PST, p.status)}${p.failed_reason ? `<br><small class="form-note">${esc(p.failed_reason)}</small>` : ''}${p.paid_at ? `<br><small class="form-note">${dt(p.paid_at)}${p.paid_via === 'BANK_STATEMENT' ? ' · laut Kontoauszug' : ''}</small>` : ''}</td><td><small>${esc(p.reference)}</small></td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Noch keine Auszahlungen. Sie entstehen mit der Freigabe einer Abrechnung.</p>'}
    ${d.me.manage && d.payouts.length ? `<div class="pt-row" style="margin-top:12px"><button type="button" class="btn btn-outline" data-act="approve">Freigeben</button><label class="form-note">Ausführung am <input type="date" id="poDate" value="${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}"></label><button type="button" class="btn btn-dark" data-act="export">SEPA-Datei erstellen</button><button type="button" class="btn btn-outline" data-act="paid">Als bezahlt markieren</button><button type="button" class="btn btn-outline" data-act="failed">Fehlgeschlagen</button><button type="button" class="btn btn-outline" data-act="returned">Zurückgekommen</button><button type="button" class="btn btn-outline" data-act="reissue">Erneut auszahlen</button></div>
    <p class="form-note">„Zurückgekommen“: Die Bank hat eine bereits bezahlte Überweisung zurückgegeben. Die Abrechnung wird wieder offen, die Zahlungsdaten gehen in die Prüfung und der Creator wird gebeten, sie zu prüfen. „Erneut auszahlen“ stößt dieselbe Auszahlung danach auf das aktuelle, geprüfte Konto neu an.</p><p class="form-note" id="poMsg" role="status"></p>` : ''}</section>
    ${d.me.manage ? `<section class="pt-card"><h2>Kontoauszug abgleichen</h2><p class="form-note">Kontoauszug im Format camt.053 (XML) aus dem Online-Banking hochladen. Exportierte Auszahlungen werden über die Referenz der SEPA-Datei erkannt und nach Ihrer Bestätigung mit Buchungsdatum als bezahlt markiert. Rückläufer werden mit übernommen (bezahlte Auszahlungen gelten dann als zurückgekommen); abweichende Beträge werden nur angezeigt.</p>
      <div class="pt-row"><label class="btn btn-outline btn-sm co-file">Datei wählen<input type="file" id="camtFile" accept=".xml,application/xml,text/xml" hidden></label><span class="form-note" id="camtName">Keine Datei gewählt</span></div>
      <div id="camtOut" aria-live="polite"></div></section>` : ''}`;
  bankStatement(v);
  const sel = () => [...v.querySelectorAll('[data-po]:checked')].map((x) => x.dataset.po);
  v.querySelector('#poAll')?.addEventListener('change', (e) => v.querySelectorAll('[data-po]').forEach((x) => { x.checked = e.target.checked; }));
  const m = (t) => { const el = v.querySelector('#poMsg'); if (el) el.textContent = t; };
  v.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
    const ids = sel();
    if (!ids.length) { m('Bitte zuerst Auszahlungen auswählen.'); return; }
    const act = b.dataset.act;
    if (act === 'export') {
      try { await download('/api/admin/creators/payouts', { method: 'POST', body: JSON.stringify({ action: 'export', ids, execution_date: v.querySelector('#poDate').value }) }, 'sepa.xml'); m('SEPA-Datei erstellt. Bitte im Online-Banking hochladen und freigeben.'); setTimeout(() => payoutsAdmin(v), 1200); } catch (e) { m(e.message); }
      return;
    }
    if (act === 'failed') return dialog('<h2 style="margin:0;color:#0F2C59">Zahlung fehlgeschlagen</h2><label class="pt-field">Grund*<textarea name="reason" rows="2" maxlength="300" required></textarea></label>',
      async (f) => { const x = await api('/api/admin/creators/payouts', { method: 'POST', body: JSON.stringify({ action: 'failed', ids, reason: fv(f, 'reason') }) }); if (!x.ok) return x.data?.error || 'Nicht möglich.'; payoutsAdmin(v); return null; });
    if (act === 'returned') return dialog('<h2 style="margin:0;color:#0F2C59">Auszahlung zurückgekommen</h2><p class="form-note">Nur für bereits bezahlte Auszahlungen. Der Creator erhält eine E-Mail mit der Bitte, die Zahlungsdaten zu prüfen.</p><label class="pt-field">Grund*<textarea name="reason" rows="2" maxlength="300" required placeholder="z. B. Rückläufer AC04 – Konto erloschen"></textarea></label>',
      async (f) => { const x = await api('/api/admin/creators/payouts', { method: 'POST', body: JSON.stringify({ action: 'returned', ids, reason: fv(f, 'reason') }) }); if (!x.ok) return x.data?.error || 'Nicht möglich.'; payoutsAdmin(v); return null; });
    if (act === 'paid') return dialog(`<h2 style="margin:0;color:#0F2C59">Als bezahlt markieren</h2><p>${ids.length} Auszahlung(en). Bitte nur markieren, wenn die Überweisung im Online-Banking ausgeführt wurde. Creator erhalten eine E-Mail.</p>`,
      async () => { const x = await api('/api/admin/creators/payouts', { method: 'POST', body: JSON.stringify({ action: 'paid', ids }) }); if (!x.ok) return x.data?.error || 'Nicht möglich.'; payoutsAdmin(v); return null; });
    const x = await api('/api/admin/creators/payouts', { method: 'POST', body: JSON.stringify({ action: act, ids }) });
    if (!x.ok) { m(x.data?.error || 'Nicht möglich.'); return; }
    if (act === 'reissue') { m(`${x.data.reissued} Auszahlung(en) neu angestoßen – bitte wie gewohnt freigeben.`); setTimeout(() => payoutsAdmin(v), 1500); return; }
    if (x.data.skipped) m(`${x.data.approved} freigegeben, ${x.data.skipped} übersprungen${x.data.four_eyes ? ' (Vier-Augen-Prinzip: Freigabe durch eine zweite Person)' : ''}.`);
    setTimeout(() => payoutsAdmin(v), x.data.skipped ? 1800 : 0);
  });
}

// Kontoauszug (camt.053): Vorschau, dann Übernahme. Der Server liest die Datei bei der Übernahme erneut.
const ISSUE = { amount_mismatch: 'Betrag weicht ab', returned: 'Rückläufer', not_booked: 'Noch nicht gebucht' };
function bankStatement(v) {
  const input = v.querySelector('#camtFile'), out = v.querySelector('#camtOut');
  if (!input) return;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    v.querySelector('#camtName').textContent = file.name;
    if (file.size > 3 * 1024 * 1024) { out.innerHTML = '<p class="pt-alert bad">Die Datei ist zu groß (höchstens 3 MB).</p>'; return; }
    const xml = await file.text();
    out.innerHTML = '<p class="form-note">Wird gelesen …</p>';
    const r = await api('/api/admin/creators/payouts/bank-statement', { method: 'POST', body: JSON.stringify({ xml, confirm: false }) });
    if (!r.ok) { out.innerHTML = `<p class="pt-alert bad">${esc(r.data?.error || 'Nicht möglich.')}</p>`; return; }
    const d = r.data;
    out.innerHTML = `${d.account_warning ? `<div class="pt-alert warn">${esc(d.account_warning)}</div>` : ''}${d.already_imported ? `<div class="pt-alert warn">Diese Datei wurde bereits am ${dt(d.already_imported)} übernommen.</div>` : ''}
      <dl class="pt-dl"><div><dt>Buchungen</dt><dd>${num(d.transactions)}</dd></div><div><dt>Erkannt</dt><dd>${num(d.matches.length)}</dd></div><div><dt>Zu prüfen</dt><dd>${num(d.issues.length)}</dd></div><div><dt>Andere Buchungen</dt><dd>${num(d.unrelated)}</dd></div></dl>
      ${d.matches.length ? `<div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Creator</th><th>Monat</th><th>Betrag</th><th>Gebucht</th><th>Erkannt über</th></tr></thead><tbody>${d.matches.map((m) => `<tr><td>${esc(m.creator || '')}</td><td>${esc(m.period || '')}</td><td><strong>${esc(m.amount)}</strong></td><td>${m.booking_date ? dt(m.booking_date) : '–'}</td><td>${m.via === 'end_to_end' ? 'Referenz der SEPA-Datei' : 'Verwendungszweck + Betrag'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-note">Keine offenen Auszahlungen in diesem Auszug gefunden.</p>'}
      ${d.issues.length ? `<ul class="co-social">${d.issues.map((i) => `<li><span class="st bad" style="margin:0 6px 0 0">${esc(ISSUE[i.kind] || i.kind)}</span>${esc(i.creator || 'Unbekannt')} · ${esc(i.amount)} – ${esc(i.note)}</li>`).join('')}</ul>` : ''}
      ${d.matches.length || d.issues.some((i) => i.kind === 'returned') ? '<div class="pt-row"><button type="button" class="btn btn-dark btn-sm" id="camtGo">Übernehmen</button><span class="form-note">Creator erhalten eine E-Mail.</span></div>' : ''}`;
    out.querySelector('#camtGo')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      const x = await api('/api/admin/creators/payouts/bank-statement', { method: 'POST', body: JSON.stringify({ xml, confirm: true }) });
      if (!x.ok) { e.target.disabled = false; out.insertAdjacentHTML('beforeend', `<p class="pt-alert bad">${esc(x.data?.error || 'Nicht möglich.')}</p>`); return; }
      out.innerHTML = `<p class="pt-alert ok">${num(x.data.paid)} Auszahlung(en) als bezahlt übernommen${x.data.returned ? `, ${num(x.data.returned)} Rückläufer vermerkt` : ''}.</p>`;
      setTimeout(() => payoutsAdmin(v), 1500);
    });
  };
}

async function rulesAdmin(v) {
  const r = await api('/api/admin/creators/rules');
  if (!r.ok) return errBox(v, r.data?.error);
  const d = r.data;
  const KIND = { PERCENT: 'Prozent', FIXED: 'Fester Betrag', HYBRID: 'Prozent + fest', TIERED: 'Gestaffelt' };
  const val = (x) => x.kind === 'FIXED' ? eurC(x.fixed_cents) : x.kind === 'HYBRID' ? `${(x.percent_bps / 100).toLocaleString('de-DE')} % + ${eurC(x.fixed_cents)}` : x.kind === 'TIERED' ? `${(x.percent_bps / 100).toLocaleString('de-DE')} %; ${(x.tiers || []).map((t) => `ab ${t.min_conversions}: ${(t.percent_bps / 100).toLocaleString('de-DE')} %`).join(', ')}` : `${(x.percent_bps / 100).toLocaleString('de-DE')} %`;
  const active = (x) => !x.valid_to || new Date(x.valid_to) > new Date();
  v.innerHTML = `${subnav('creator-provision')}<section class="pt-card"><div class="wa-h-row"><h2 style="margin:0">Provisionsregeln</h2>${d.me.manage ? '<button type="button" class="btn btn-dark" id="ruNew">+ Regel</button>' : ''}</div>
    <p class="form-note">Es gilt die spezifischste Regel: Creator + Kampagne vor Creator vor Kampagne vor Standard. Änderungen erzeugen eine neue Version ab jetzt – abgeschlossene Monate bleiben unverändert. Grundlage ist der Netto-Umsatz je Kauf.</p>
    <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Geltung</th><th>Art</th><th>Wert</th><th>Version</th><th>Gültig</th><th>Notiz</th></tr></thead><tbody>
    ${d.rules.map((x) => `<tr${active(x) ? '' : ' style="opacity:.55"'}><td>${x.creator_id ? esc(x.lr_creators?.display_name || 'Creator') : '<strong>Alle Creator</strong>'}${x.campaign_slug ? ` · Kampagne ${esc(x.campaign_slug)}` : ''}</td><td>${esc(KIND[x.kind])}</td><td>${esc(val(x))}</td><td>v${x.version}</td><td>${dt(x.valid_from)} – ${x.valid_to ? dt(x.valid_to) : 'offen'}</td><td><small>${esc(x.note || '')}</small></td></tr>`).join('')}</tbody></table></div></section>`;
  v.querySelector('#ruNew')?.addEventListener('click', () => dialog(`<h2 style="margin:0;color:#0F2C59">Neue Provisionsregel</h2><div class="wa-grid2">
      <label>Creator<select name="creator_id"><option value="">Alle Creator (Standard)</option>${d.creators.map((c) => `<option value="${esc(c.id)}">${esc(c.display_name || 'Ohne Namen')}</option>`).join('')}</select></label>
      <label>Kampagne<select name="campaign_slug"><option value="">alle Kampagnen</option>${d.campaigns.map((k) => `<option value="${esc(k.slug)}">${esc(k.name)}</option>`).join('')}</select></label>
      <label>Art<select name="kind"><option value="PERCENT">Prozent vom Netto-Umsatz</option><option value="FIXED">Fester Betrag je Kauf</option><option value="HYBRID">Prozent + fester Betrag</option><option value="TIERED">Gestaffelt nach Anzahl im Monat</option></select></label>
      <label>Prozent<input name="percent" inputmode="decimal" placeholder="z. B. 20"></label><label>Fester Betrag (€)<input name="fixed" inputmode="decimal" placeholder="z. B. 5,00"></label>
      <label class="full">Staffeln (nur bei „Gestaffelt“), eine pro Zeile<textarea name="tiers" rows="3" placeholder="ab 10: 25&#10;ab 25: 30"></textarea></label></div>
      <label class="pt-field">Notiz<input name="note" maxlength="300"></label>`,
  async (f) => {
    const n = (x) => Number(String(x || '0').replace(',', '.'));
    const tiers = fv(f, 'tiers').split('\n').map((l) => /ab\s*(\d+)\s*:\s*([\d.,]+)/i.exec(l)).filter(Boolean).map((m2) => ({ min_conversions: Number(m2[1]), percent_bps: Math.round(n(m2[2]) * 100) }));
    const x = await api('/api/admin/creators/rules', { method: 'POST', body: JSON.stringify({ creator_id: fv(f, 'creator_id') || null, campaign_slug: fv(f, 'campaign_slug') || null, kind: fv(f, 'kind'), percent_bps: Math.round(n(fv(f, 'percent')) * 100), fixed_cents: Math.round(n(fv(f, 'fixed')) * 100), tiers, note: fv(f, 'note') || null }) });
    if (!x.ok) return x.data?.error || 'Nicht möglich.';
    rulesAdmin(v); return null;
  }));
}
