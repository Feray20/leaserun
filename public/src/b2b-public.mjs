// /b2b: Tarife aus der zentralen Preisliste und Kontaktformular für Demo/Enterprise/Kooperation.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const net = (c) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';

async function offers() {
  const box = document.getElementById('b2bOffers');
  if (!box) return;
  const d = await fetch('/data/preise.json').then((r) => r.json()).catch(() => null);
  if (!d?.b2b) { box.innerHTML = '<p class="form-note">Tarife derzeit nicht verfügbar.</p>'; return; }
  const b = d.b2b;
  const card = (p, rec) => `<div class="offer${rec ? ' rec' : ''}" data-ivl="${p.interval}"${p.interval === 'year' ? ' hidden' : ''}>${rec ? '<span class="offer-rec">Am häufigsten gewählt</span>' : ''}
    <h4>${esc(p.name.replace(' (Jahr)', ''))}</h4><div class="offer-price">${net(p.netto_cents)} <small>netto ${esc(p.intervall)}</small></div>
    <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn btn-dark" href="#anfrage">Unternehmenskonto anfragen</a></div>`;
  box.innerHTML = `<div class="seg" role="tablist"><button type="button" data-i="month" aria-selected="true">Monatlich</button><button type="button" data-i="year" aria-selected="false">Jährlich</button></div>
    <div class="offers">${b.plans.map((p) => card(p, p.tier === 'PRO')).join('')}
      <div class="offer"><h4>${esc(b.enterprise.name)}</h4><div class="offer-price">${esc(b.enterprise.preis)}</div><ul>${b.enterprise.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn btn-ghost" href="#kontakt">Angebot anfragen</a></div></div>
    <p class="price-note">${esc(b.hinweis)}</p>`;
  box.querySelectorAll('[data-i]').forEach((btn) => btn.onclick = () => {
    box.querySelectorAll('[data-i]').forEach((x) => x.setAttribute('aria-selected', String(x === btn)));
    box.querySelectorAll('.offer[data-ivl]').forEach((o) => { o.hidden = o.dataset.ivl !== btn.dataset.i; });
  });
}

function contact() {
  const f = document.getElementById('b2bContact');
  if (!f) return;
  const ts = Date.now();
  const kind = new URLSearchParams(location.search).get('anliegen');
  if (kind && f.kind.querySelector(`option[value="${kind}"]`)) f.kind.value = kind;
  // Nachweis-Felder nur bei der Kontoanfrage (dort Pflicht).
  const sync = () => { const on = f.kind.value === 'konto'; f.querySelectorAll('[data-konto]').forEach((x) => { x.hidden = !on; x.disabled = !on; }); syncLegal(f); };
  f.kind.addEventListener('change', sync); f.legalForm?.addEventListener('change', () => syncLegal(f)); sync();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('b2bMsg');
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const fd = new FormData(f), d = Object.fromEntries(fd);
    const btn = f.querySelector('button[type=submit]');
    let r;
    if (d.kind === 'konto') {
      const pf = fd.get('proof');
      if (pf && pf.size > 4 * 1024 * 1024) { msg.textContent = 'Der Nachweis ist größer als 4 MB. Bitte verkleinern oder als PDF speichern.'; return; }
      fd.set('ts', String(ts)); fd.delete('newsletter'); const cp = new URLSearchParams(location.search).get('utm_campaign'); if (cp && /^[a-z0-9-]{3,40}$/.test(cp)) fd.set('camp', cp); btn.disabled = true;
      r = await fetch('/api/b2b/contact', { method: 'POST', body: fd });
    } else {
      delete d.proof; btn.disabled = true;
      const cp = new URLSearchParams(location.search).get('utm_campaign');
      const { newsletter: _nl, ...rest } = d; // eslint-disable-line no-unused-vars
      r = await fetch('/api/b2b/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...rest, privacy: d.privacy === 'on', ts, ...(cp && /^[a-z0-9-]{3,40}$/.test(cp) ? { camp: cp } : {}) }) });
    }
    const j = await r.json().catch(() => ({}));
    btn.disabled = false;
    if (r.ok) {
      let nl = '';
      if (d.newsletter === 'on') { const x = await fetch('/api/newsletter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: d.email, name: d.name, company: d.company, segment: 'b2b', source: 'b2b-formular', consent: true, ts }) }).catch(() => null); if (x && x.ok) nl = ' Für die Neuigkeiten haben wir Ihnen eine Bestätigungs-E-Mail geschickt.'; }
      f.innerHTML = `<div class="pt-alert full"><strong>Danke!</strong> Ihre Anfrage ist eingegangen. Wir melden uns innerhalb von zwei Werktagen.${nl}</div>`;
    }
    else { msg.textContent = j.error || 'Senden fehlgeschlagen.'; if (j.field === 'email') f.email?.focus(); }
  };
}

// routes.js rendert den Inhalt nach DOMContentLoaded; kurz warten, bis die Container da sind.
function init(tries = 0) {
  if (!document.getElementById('b2bOffers') && tries < 40) { setTimeout(() => init(tries + 1), 50); return; }
  offers().then(() => {
    // Herkunft (z. B. von der Prüfseite) an die Registrierung weitergeben.
    const ref = (new URLSearchParams(location.search).get('ref') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
    if (ref) document.querySelectorAll('a[href="/b2b-portal"]').forEach((a) => { a.href = '/b2b-portal?ref=' + encodeURIComponent(ref); });
  });
  contact();
}
// Rückmeldung nach Bestätigen/Abmelden der Neuigkeiten.
{ const nl = new URLSearchParams(location.search).get('newsletter'); const t = { bestaetigt: 'Danke – Ihre Anmeldung für die Neuigkeiten ist bestätigt.', abgemeldet: 'Sie sind abgemeldet und erhalten keine Neuigkeiten mehr.', ungueltig: 'Dieser Link ist ungültig oder abgelaufen.' }[nl]; if (t) { const show = () => { const m = document.createElement('div'); m.className = 'nl-banner'; m.setAttribute('role', 'status'); m.textContent = t; document.body.prepend(m); setTimeout(() => m.remove(), 8000); }; if (document.readyState === 'loading') addEventListener('DOMContentLoaded', show); else show(); } }
init();

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
