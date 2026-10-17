// Partnerseite /p/<slug> und Website-Widget (?embed=1): Finanzierungsrechner mit Anfrage an den Partner.
import { analyse, GREST } from './calc.mjs';

const box = document.getElementById('pp');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = new URLSearchParams(location.search);
const slug = (location.pathname.match(/^\/p\/([a-z0-9-]{3,40})\/?$/) || [])[1] || '';
const embed = q.get('embed') === '1';
const source = embed ? 'widget' : q.get('src') === 'qr' ? 'qr' : 'landing';
if (embed) document.body.classList.add('embed');
const eur = (v) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €');
const num = (v) => Number(String(v || '').replace(/\./g, '').replace(',', '.')) || 0;

// Höhe an das einbettende Fenster melden (nur Zahl, keine Daten).
const report = () => { if (embed && parent !== window) parent.postMessage({ immoadv: 'height', h: document.documentElement.scrollHeight }, '*'); };
new ResizeObserver(report).observe(document.body);

function host() {
  try { return (location.ancestorOrigins?.[0] ? new URL(location.ancestorOrigins[0]) : new URL(document.referrer)).hostname; } catch { return ''; }
}

async function load() {
  if (!slug) { box.innerHTML = '<h1>Partner nicht gefunden</h1>'; return; }
  const r = await fetch(`/api/partner?slug=${slug}${embed ? `&embed=1&host=${encodeURIComponent(host())}` : ''}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    box.innerHTML = `<h1>${r.status === 403 ? 'Nicht freigegeben' : 'Partner nicht gefunden'}</h1><p>${esc(d.error || 'Dieser Partnerlink ist nicht (mehr) aktiv.')}</p>${embed ? '' : '<p><a class="btn btn-dark" href="/">Zu ImmoAdv</a></p>'}`;
    return;
  }
  if (!d.b2b) { legacy(d); return; }
  render(d);
}

function legacy(d) {
  box.innerHTML = `<div class="pp-head"><div><h1>${esc(d.name)}</h1><small>${esc(d.kind || '')}</small></div></div>
    <p>Sie wurden von ${esc(d.name)} eingeladen, Ihre Finanzierung mit ImmoAdv vorzubereiten: bankübliche Kennzahlen verstehen, Unterlagen vollständig sammeln, Kreditmappe erstellen.</p>
    <p class="pt-row"><a class="btn btn-dark" href="/auth/register?ref=${encodeURIComponent(d.slug)}">Kostenlos starten</a><a class="btn btn-ghost" href="/mustermappe">Mustermappe ansehen</a></p>
    <p class="pp-foot">ImmoAdv ist ein unabhängiges technisches Vorbereitungsinstrument. ${esc(d.name)} und ImmoAdv sind getrennte Unternehmen. ImmoAdv vermittelt keine Darlehen und erhält keine Vergütung für einen Abschluss.</p>`;
}

function render(p) {
  if (p.color) document.documentElement.style.setProperty('--pp', p.color);
  document.title = `Finanzierung durchrechnen | ${p.name}`;
  const pre = { price: q.get('preis') || '', rent: q.get('miete') || '', area: q.get('flaeche') || '', land: GREST[q.get('land')] ? q.get('land') : 'hessen', ref: (q.get('ref') || '').slice(0, 60) };
  box.innerHTML = `
    <header class="pp-head"><div style="display:flex;gap:12px;align-items:center">${p.logo ? `<img src="${esc(p.logo)}" alt="${esc(p.name)}">` : ''}<div><h1>${esc(p.name)}</h1><span class="pp-sub">${esc(p.kind)} · ${esc(p.city)}${p.verified ? ' · Angaben geprüft' : ''}</span></div></div>
      ${p.booking ? `<a class="btn btn-ghost" href="${esc(p.booking)}" target="_blank" rel="noopener">Termin buchen</a>` : ''}</header>
    ${pre.ref ? `<p><strong>Objekt:</strong> ${esc(pre.ref)}</p>` : ''}
    <div class="pp-grid">
      <section class="pt-card"><h2>Finanzierung durchrechnen</h2>
        <div class="obj-grid" id="calc">
          <label>Kaufpreis (€)<input id="c_price" inputmode="numeric" value="${esc(pre.price)}"></label>
          <label>Kaltmiete (€/Monat, bei Vermietung)<input id="c_rent" inputmode="numeric" value="${esc(pre.rent)}"></label>
          <label>Wohnfläche (m²)<input id="c_area" inputmode="numeric" value="${esc(pre.area)}"></label>
          <label>Eigenkapital (€)<input id="c_eq" inputmode="numeric"></label>
          <label>Bundesland<select id="c_land">${Object.keys(GREST).map((l) => `<option value="${l}"${l === pre.land ? ' selected' : ''}>${esc(GREST[l].name)}</option>`).join('')}</select></label>
          <label>Maklerprovision (%)<input id="c_broker" inputmode="decimal" value="3,57"></label>
          <label>Sollzins (% p. a.)<input id="c_rate" inputmode="decimal" value="3,8"></label>
          <label>Tilgung (% p. a.)<input id="c_tilg" inputmode="decimal" value="2"></label>
        </div>
        <div class="pp-out" id="out"></div>
        <p class="form-note">Annahmen: Grunderwerbsteuer des Bundeslands, Notar 1,5 %, Grundbuch 0,5 %, Instandhaltung 1 €/m² im Monat, Mietausfall 2 %. Rechnerische Orientierung, keine Kreditzusage und keine Bonitätsprüfung.</p>
      </section>
      <section class="pt-card" id="leadBox"><h2>Anfrage an ${esc(p.name)}</h2>
        <form id="lead" novalidate>
          <label>Name*<input name="name" required minlength="2" autocomplete="name"></label>
          <label>E-Mail*<input name="email" type="email" required autocomplete="email"></label>
          <label>Telefon<input name="phone" autocomplete="tel"></label>
          <label>Objektadresse<input name="address" maxlength="160" value="${esc(pre.ref)}"></label>
          <label>Nachricht<textarea name="message" rows="3" maxlength="2000"></textarea></label>
          <div class="pp-hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
          <label class="consent"><input type="checkbox" name="consent" required> Ich willige ein, dass meine Angaben (Kontakt-, Objekt- und Finanzierungsdaten) an ${esc(p.name)} übermittelt werden, damit ${esc(p.name)} mich zu meiner Anfrage kontaktiert. ImmoAdv verarbeitet die Daten im Auftrag von ${esc(p.name)}. Widerruf jederzeit gegenüber ${esc(p.name)}.</label>
          <button class="btn btn-dark" type="submit">Anfrage senden</button>
          <p class="form-note" id="leadMsg" role="status"></p>
        </form></section>
    </div>
    ${p.disclaimer ? `<p class="pp-foot">${esc(p.disclaimer)}</p>` : ''}<p class="pp-foot">Technik: <a href="/" target="_blank" rel="noopener">ImmoAdv</a> · ${esc(p.name)} und ImmoAdv sind getrennte Unternehmen. ImmoAdv vermittelt keine Darlehen. <a href="/datenschutz" target="_blank" rel="noopener">Datenschutz</a> · <a href="/impressum" target="_blank" rel="noopener">Impressum</a></p>`;
  const $ = (id) => document.getElementById(id);
  const vals = () => ({ price: num($('c_price').value), rent: num($('c_rent').value), area: num($('c_area').value), equity: num($('c_eq').value), land: $('c_land').value, brokerPct: num($('c_broker').value), ratePct: num($('c_rate').value), repaymentPct: num($('c_tilg').value) });
  const calc = () => {
    const v = vals();
    const a = v.price > 0 ? analyse({ ...v, maintenanceQm: 1, vacancyPct: 2 }) : null;
    $('out').innerHTML = a ? [
      ['Kaufnebenkosten', eur(a.nebenkosten)], ['Gesamtkosten', eur(a.allIn)], ['Darlehen', eur(a.loan)], ['Monatsrate', eur(a.rate)],
      ...(v.rent > 0 ? [['Cashflow vor Steuern / Monat', eur(a.cashflow)], ['Kapitaldienstdeckung (DSCR)', a.dscr == null ? '–' : a.dscr.toLocaleString('de-DE')], ['Bruttomietrendite', a.grossYield == null ? '–' : a.grossYield.toLocaleString('de-DE') + ' %']] : []),
      ['Eigenkapital deckt Nebenkosten', v.equity >= a.nebenkosten ? 'ja' : 'nein'],
    ].map(([l, x]) => `<div><span class="pp-l">${l}</span><strong>${x}</strong></div>`).join('') : '<div><span class="pp-l">Ergebnis</span><strong>Kaufpreis eingeben</strong></div>';
    report();
  };
  document.querySelectorAll('#calc input, #calc select').forEach((i) => i.addEventListener('input', calc));
  calc();
  window.__iaLeadTs = Date.now();
  $('lead').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const msg = $('leadMsg');
    if (!f.name || f.name.length < 2) { msg.textContent = 'Bitte Ihren Namen angeben.'; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email || '')) { msg.textContent = 'Bitte eine gültige E-Mail-Adresse angeben.'; return; }
    if (!f.consent) { msg.textContent = 'Bitte der Weitergabe an den Partner zustimmen.'; return; }
    const v = vals();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const r = await fetch('/api/b2b/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      slug, source, name: f.name, email: f.email, phone: f.phone || '', message: f.message || '', consent: true, website: f.website || '', ts: window.__iaLeadTs || 0,
      property: { ref: pre.ref || undefined, address: f.address || undefined, land: v.land, price: v.price || undefined, rent: v.rent || undefined, area: v.area || undefined, equity: v.equity || undefined, ratePct: v.ratePct, repaymentPct: v.repaymentPct, brokerPct: v.brokerPct },
    }) });
    const d = await r.json().catch(() => ({}));
    btn.disabled = false;
    if (!r.ok) { msg.textContent = d.error || 'Senden fehlgeschlagen.'; if (d.field === 'email') e.target.querySelector('[name=email]')?.focus(); return; }
    $('leadBox').innerHTML = `<h2>Danke!</h2><p>Ihre Anfrage ist bei ${esc(p.name)} eingegangen. Sie werden direkt kontaktiert.</p>${d.pdf ? `<p><a class="btn btn-ghost" href="${esc(d.pdf)}" download>Ihre Finanzierungsübersicht (PDF)</a></p>` : ''}${p.booking ? `<p><a class="btn btn-dark" href="${esc(p.booking)}" target="_blank" rel="noopener">Gleich einen Termin buchen</a></p>` : ''}`;
    report();
  };
}

load();
