// Web-Admin → Improvement suggestions: inbox per area (B2C or B2B), star rating, status, answer.
import { api, dtt, esc } from './sess.mjs?v=892f3666';

const TOPICS = { bedienung: 'Ease of use & navigation', rechner: 'Calculators & metrics', kreditmappe: 'Lender Package & documents', inhalte: 'Content & explanations', neue_funktion: 'New feature', fehler: 'Found a bug', sonstiges: 'Other' };
const STATUS = { neu: 'New', in_pruefung: 'Under review', geplant: 'Planned', umgesetzt: 'Done', abgelehnt: 'Not planned' };
const stars = (n, name = '') => `<span class="fb-stars"${name ? ` role="radiogroup" aria-label="${name}"` : ''}>${[1, 2, 3, 4, 5].map((k) => name ? `<button type="button" data-star="${k}" aria-label="${k} of 5" aria-checked="${k === n}" role="radio" class="${k <= (n || 0) ? 'on' : ''}">★</button>` : `<i class="${k <= n ? 'on' : ''}">★</i>`).join('')}</span>`;

export async function vorschlaege(v, seg) {
  const r = await api('/api/admin/feedback');
  if (!r.ok) { v.innerHTML = `<div class="wa-state err" role="alert"><strong>Suggestions could not be loaded.</strong><span>${esc(r.data?.error || '')}</span><button type="button" class="btn btn-outline" data-retry>Try again</button></div>`; v.querySelector('[data-retry]').onclick = () => vorschlaege(v, seg); return; }
  const items = r.data.items || [];
  let filter = 'offen', sort = 'neu';
  const SORTS = { neu: (a, b) => String(b.created_at).localeCompare(String(a.created_at)), wichtig: (a, b) => (b.importance || 0) - (a.importance || 0), bewertung: (a, b) => (b.admin_rating || 0) - (a.admin_rating || 0), aktualisiert: (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) };
  const paint = () => {
    const list = items.filter((x) => filter === 'alle' ? true : filter === 'offen' ? ['neu', 'in_pruefung'].includes(x.status) : x.status === filter).sort(SORTS[sort]);
    const cnt = (f) => items.filter((x) => f === 'alle' ? true : f === 'offen' ? ['neu', 'in_pruefung'].includes(x.status) : x.status === f).length;
    v.innerHTML = `<section class="pt-card"><h2>Improvement suggestions · ${seg === 'b2b' ? 'Business' : 'Consumers'}</h2>
      <p class="form-note">Suggestions from ${seg === 'b2b' ? 'the Business Portal' : 'consumer accounts'}. The customer sets the importance; your rating and note are only visible here. The customer sees your answer next to their suggestion.</p>
      <div class="pc-chips" role="group" aria-label="Filter">${[['offen', 'Open'], ['geplant', 'Planned'], ['umgesetzt', 'Done'], ['abgelehnt', 'Not planned'], ['alle', 'All']].map(([k, l]) => `<button type="button" data-fbf="${k}" aria-pressed="${k === filter}">${l} <b>${cnt(k)}</b></button>`).join('')}</div>
      <label class="us-sort fb-sort">Sort<select data-fbsort>${[['neu', 'Newest first'], ['wichtig', 'Importance to customer'], ['bewertung', 'Your rating'], ['aktualisiert', 'Recently edited']].map(([k, l]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${list.length ? `<div class="fb-list">${list.map((x) => `<article class="fb-card" data-id="${x.id}">
        <header><div><strong>${esc(TOPICS[x.topic] || x.topic)}</strong><small>Received ${dtt(x.created_at)}${x.updated_at && x.updated_at !== x.created_at ? ` · edited ${dtt(x.updated_at)}` : ''} · ${esc(x.company ? `${x.company} · ` : '')}${esc(x.email || 'Account')}${x.page ? ` · ${esc(x.page)}` : ''}</small></div><span class="st ${x.status === 'umgesetzt' ? 'ok' : x.status === 'abgelehnt' ? 'bad' : x.status === 'neu' ? 'warn' : ''}">${STATUS[x.status]}</span></header>
        <p class="fb-text">${esc(x.text)}</p>
        <div class="fb-meta"><span>Importance to customer ${stars(x.importance)}</span></div>
        <div class="fb-admin"><label>Your rating ${stars(x.admin_rating, 'Your rating')}</label>
          <label>Status<select data-fbs>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${k === x.status ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="fb-wide">Internal note<textarea data-fbn rows="2" maxlength="2000" placeholder="e.g. effort, implementation idea">${esc(x.admin_note || '')}</textarea></label>
          <label class="fb-wide">Answer to the customer (optional)<textarea data-fba rows="2" maxlength="2000" placeholder="Shown to the customer under their suggestions">${esc(x.answer || '')}</textarea></label>
          <button class="btn btn-dark" type="button" data-fbsave>Save</button><span class="form-note" data-fbmsg role="status"></span></div>
      </article>`).join('')}</div>` : '<div class="pt-empty"><strong>No suggestions in this view.</strong></div>'}</section>`;
    v.querySelectorAll('[data-fbf]').forEach((b) => b.onclick = () => { filter = b.dataset.fbf; paint(); });
    v.querySelector('[data-fbsort]')?.addEventListener('change', (e) => { sort = e.target.value; paint(); });
    v.querySelectorAll('.fb-card').forEach((card) => {
      const it = items.find((x) => x.id === card.dataset.id);
      card.querySelectorAll('[data-star]').forEach((b) => b.onclick = () => {
        const n = Number(b.dataset.star); it.admin_rating = it.admin_rating === n ? null : n;
        card.querySelectorAll('[data-star]').forEach((s) => { s.classList.toggle('on', Number(s.dataset.star) <= (it.admin_rating || 0)); s.setAttribute('aria-checked', String(Number(s.dataset.star) === it.admin_rating)); });
      });
      card.querySelector('[data-fbsave]').onclick = async (e) => {
        const m = card.querySelector('[data-fbmsg]'); e.target.disabled = true;
        const body = { id: it.id, status: card.querySelector('[data-fbs]').value, adminRating: it.admin_rating ?? null, adminNote: card.querySelector('[data-fbn]').value, answer: card.querySelector('[data-fba]').value };
        const x = await api('/api/admin/feedback', { method: 'PATCH', body: JSON.stringify(body) });
        e.target.disabled = false;
        if (x.ok) { Object.assign(it, { status: body.status, admin_note: body.adminNote, answer: body.answer }); m.textContent = 'Saved.'; setTimeout(paint, 600); } else m.textContent = x.data?.error || 'Error';
      };
    });
  };
  paint();
}

// System → Google reviews: enter the review link and Place ID (average and count come live from Google).
export async function reviewsAdmin(v) {
  const r = await api('/api/admin/reviews');
  if (!r.ok) return;
  const d = r.data;
  const box = document.createElement('section');
  box.className = 'pt-card'; box.id = 'rvAdmin';
  box.innerHTML = `<h2>Google reviews</h2>
    <ol class="wa-steps"><li>Create a Google Business Profile: <a href="https://business.google.com" target="_blank" rel="noopener">business.google.com</a> (service-area business without a storefront – hide the address).</li>
      <li>In the profile choose "Ask for reviews" and paste the link (https://g.page/r/…) here – "Review us on Google" then appears in customer accounts and the Business Portal.</li>
      <li>Optional, for stars on the website: enter the Place ID (<a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener">Place ID Finder</a>) and set GOOGLE_PLACES_API_KEY in Vercel.</li></ol>
    <form id="rvF" class="wa-grid2"><label>Review link<input name="reviewUrl" type="url" value="${esc(d.reviewUrl || '')}" placeholder="https://g.page/r/…"></label><label>Place ID (optional)<input name="placeId" value="${esc(d.placeId || '')}" placeholder="ChIJ…"></label>
      <div><button class="btn btn-dark" type="submit">Save</button> <span class="form-note" id="rvMsg" role="status"></span></div></form>
    <p class="form-note">Status: ${d.rating ? `★ ${Number(d.rating).toFixed(1)} from ${d.count} Google reviews` : d.placeId ? (d.apiKey ? 'Google returns no reviews yet.' : 'GOOGLE_PLACES_API_KEY is missing in Vercel.') : 'No Place ID yet – no stars appear on the website.'} · Rules (FTC): no incentives for reviews, ask every customer the same way, no self-written or bought reviews.</p>`;
  v.append(box);
  box.querySelector('#rvF').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const x = await api('/api/admin/reviews', { method: 'POST', body: JSON.stringify(f) });
    box.querySelector('#rvMsg').textContent = x.ok ? 'Saved.' : x.data?.error || 'Error';
  };
}

// Nutzer (B2C) → „Zugriff freischalten“: Werkzeuge unabhängig vom bezahlten Tarif freigeben, befristet oder dauerhaft.
export async function accessDialog(userId, mail, msg = () => {}) {
  if (!document.getElementById('accCss')) { const st = document.createElement('style'); st.id = 'accCss'; st.textContent = `.acc-feat{border:1px solid #E2E8F0;border-radius:12px;padding:10px 12px;display:grid;gap:10px}.acc-grp{display:grid;gap:6px}.acc-grp>strong{color:#0F2C59;font-size:13px;text-transform:uppercase;letter-spacing:.05em}.acc-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px 12px;padding:6px 0;border-top:1px solid #F1F5F9}.acc-row small{color:#64748B;font-size:12px;margin-left:4px;text-transform:none;letter-spacing:0;display:inline}.acc-seg{display:inline-flex;background:#F1F5F9;border-radius:999px;padding:3px}.acc-seg label{margin:0}.acc-seg input{position:absolute;opacity:0;pointer-events:none}.acc-seg span{display:block;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:700;color:#475569;cursor:pointer}.acc-seg input:checked+span{background:#0F2C59;color:#fff}.acc-seg input[value=off]:checked+span{background:#B91C1C}.acc-seg input[value=on]:checked+span{background:#047857}.acc-seg input:focus-visible+span{outline:2px solid #0284C7}`; document.head.append(st); }
  const r = await api('/api/admin/access?user=' + encodeURIComponent(userId));
  if (!r.ok) { msg(r.data?.error || 'Nicht verfügbar.', true); return; }
  const g = r.data.grant;
  let d = document.getElementById('accDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'accDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const until = g?.valid_until ? String(g.valid_until).slice(0, 10) : '';
  d.innerHTML = `<form method="dialog" class="acc-f">
    <h2>Zugriff freischalten</h2><p class="form-note">${esc(mail)} · ${g ? `aktuell: <b>${g.tier === 'pro' ? 'Alle Werkzeuge (wie Investor Pro)' : g.tier === 'starter' ? 'Kauf-Werkzeuge (wie Käufer-Pass)' : 'Einzelfreigaben'}</b>, seit ${dtt(g.updated_at)} von ${esc(g.granted_by)}` : 'bisher nur der bezahlte Tarif'}</p>
    <fieldset class="acc-t"><legend>Freigeschaltete Werkzeuge</legend>
      <label class="chk"><input type="radio" name="tier" value="free"${g?.tier === 'free' ? ' checked' : ''}> <span><b>Nur einzelne Funktionen</b> – Tarif bleibt, es gelten nur die Einzelfreigaben unten</span></label>
      <label class="chk"><input type="radio" name="tier" value="starter"${g && g.tier === 'starter' || !g ? ' checked' : ''}> <span><b>Kauf-Werkzeuge</b> – wie Käufer-Pass: Objekte unbegrenzt, Bankangebote vergleichen, Bankgespräch, Druck/PDF</span></label>
      <label class="chk"><input type="radio" name="tier" value="pro"${g?.tier === 'pro' ? ' checked' : ''}> <span><b>Alle Werkzeuge</b> – wie Investor Pro: zusätzlich Portfolio, Anschluss & Forward, Betriebskosten, Kreditmappen unbegrenzt</span></label></fieldset>
    <fieldset class="acc-feat"><legend>Einzelne Funktionen freigeben oder entziehen</legend>
      <p class="form-note">„Nach Tarif“ folgt dem bezahlten bzw. oben gewählten Umfang. „Frei“ schaltet die Funktion zusätzlich frei, „Gesperrt“ nimmt sie weg – auch wenn der Tarif sie enthält.</p>
      ${(() => { const cat = r.data.catalog || {}, f = g?.features || {}; const groups = {}; for (const [k, [grp, label, need]] of Object.entries(cat)) (groups[grp] ||= []).push([k, label, need]);
        const NEED = { free: 'kostenlos', starter: 'ab Käufer-Pass', pro: 'Investor Pro' };
        return Object.entries(groups).map(([grp, list]) => `<div class="acc-grp"><strong>${esc(grp)}</strong>${list.map(([k, label, need]) => `<div class="acc-row"><span>${esc(label)} <small>${NEED[need] || ''}</small></span><span class="acc-seg" role="radiogroup" aria-label="${esc(label)}">${[['auto', 'Nach Tarif'], ['on', 'Frei'], ['off', 'Gesperrt']].map(([v, l]) => `<label><input type="radio" name="f_${k}" value="${v}"${(f[k] || 'auto') === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</span></div>`).join('')}</div>`).join(''); })()}
    </fieldset>
    <div class="wa-grid2"><label>Zusätzliche Kreditmappen<input name="creditMaps" type="number" min="0" max="1000" value="${Number(g?.credit_maps || 0)}"></label>
      <label>Gültig bis (leer = unbefristet)<input name="validUntil" type="date" value="${esc(until)}"></label></div>
    <label class="chk"><input type="checkbox" name="leitfaden"${g?.leitfaden ? ' checked' : ''}> Notar-Checkliste & Verhandlungsleitfaden freischalten</label>
    <label>Interne Notiz (z. B. Grund)<textarea name="note" rows="2" maxlength="500">${esc(g?.note || '')}</textarea></label>
    <p class="form-note">Der Kunde sieht die Werkzeuge nach dem nächsten Neuladen. Bezahlte Tarife bleiben unberührt; es gilt die höhere Stufe. Jede Änderung wird protokolliert.</p>
    <div class="pt-row"><button class="btn btn-dark" type="button" id="accSave">Speichern</button>${g ? '<button class="btn btn-outline" type="button" id="accDel">Freischaltung entfernen</button>' : ''}<button class="btn btn-ghost" value="x">Abbrechen</button></div>
    <p class="form-note" id="accMsg" role="status"></p></form>`;
  const f = d.querySelector('form');
  // Enter im Formular = Speichern (nicht Schließen ohne Wirkung).
  f.addEventListener('submit', (e) => { if (e.submitter?.value !== 'x') { e.preventDefault(); d.querySelector('#accSave').click(); } });
  d.querySelector('#accSave').onclick = async () => {
    const fd = new FormData(f), out = d.querySelector('#accMsg'), sb = d.querySelector('#accSave');
    const features = {}; for (const k of Object.keys(r.data.catalog || {})) features[k] = fd.get('f_' + k) || 'auto';
    const body = { user: userId, features, tier: fd.get('tier'), creditMaps: Number(fd.get('creditMaps') || 0), leitfaden: fd.get('leitfaden') === 'on', validUntil: fd.get('validUntil') || null, note: String(fd.get('note') || '') };
    sb.disabled = true; f.classList.add('acc-busy'); out.className = 'form-note'; out.textContent = 'Wird gespeichert …';
    out.scrollIntoView({ block: 'nearest' });
    const x = await api('/api/admin/access', { method: 'POST', body: JSON.stringify(body) }).catch(() => ({ ok: false, data: { error: 'Keine Verbindung.' } }));
    sb.disabled = false; f.classList.remove('acc-busy');
    if (x.ok) { out.className = 'form-note ok'; out.textContent = `Gespeichert: ${body.tier === 'pro' ? 'alle Werkzeuge' : body.tier === 'starter' ? 'Kauf-Werkzeuge' : 'Einzelfreigaben'}${Object.values(features).filter((v) => v !== 'auto').length ? ` · ${Object.values(features).filter((v) => v !== 'auto').length} Funktionen einzeln eingestellt` : ''}.`; setTimeout(() => { d.close(); msg(`Zugriff für ${mail} gespeichert.`); }, 700); }
    else { out.className = 'form-note err'; out.textContent = x.data?.error || 'Speichern fehlgeschlagen.'; }
  };
  d.querySelector('#accDel')?.addEventListener('click', async () => {
    if (!confirm('Manuelle Freischaltung entfernen? Es gilt dann nur noch der bezahlte Tarif.')) return;
    const x = await api('/api/admin/access?user=' + encodeURIComponent(userId), { method: 'DELETE' });
    if (x.ok) { d.close(); msg(`Freischaltung für ${mail} entfernt.`); } else d.querySelector('#accMsg').textContent = x.data?.error || 'Fehler';
  });
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}
