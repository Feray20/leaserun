// Web-Admin → Partner → Pakete & Preise: B2B-Katalog je Branche bearbeiten (Preise, Leistungen, Tools, Zusatzbranche).
import { api, esc } from './sess.mjs?v=892f3666';

const ORDER = ['makler', 'vermittler', 'finanzberater', 'allgemein', 'bank'];
const eur = (c) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const cents = (v) => Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')) * 100) || 0;

export async function catalogEditor() {
  let d = document.getElementById('catDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'catDlg'; d.className = 'wa-dlg cat-dlg'; document.body.append(d); }
  const r = await api('/api/admin/b2b-catalog');
  if (!r.ok) { alert(r.data?.error || 'Nicht verfügbar.'); return; }
  let cat = r.data.catalog;
  const TOOLS = r.data.tools, accs = r.data.accounts || [];
  let cur = 'makler';
  const toolBoxes = (name, sel) => `<div class="cat-tools">${Object.entries(TOOLS).map(([k, l]) => `<label><input type="checkbox" data-t="${name}" value="${k}"${sel.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
  const draw = () => {
    const c = cat.branchen[cur];
    const n = accs.filter((a) => a.branche === cur).length, nx = accs.filter((a) => (a.extra_branches || []).includes(cur)).length;
    d.innerHTML = `<form class="wa-dlg-in" id="catF"><div class="wa-dlg-h"><h2>Pakete &amp; Preise</h2><button class="stage-x" type="button" data-x aria-label="Schließen">×</button></div>
      <p class="form-note">Preise netto. Änderungen gelten für neue Buchungen sofort (neuer Stripe-Preis); laufende Abos behalten ihren Preis. Jahrespreis frei wählbar (üblich: 10 × Monatspreis).</p>
      <div class="br-tabs" role="tablist">${ORDER.map((k) => `<button type="button" role="tab" data-br="${k}" aria-selected="${k === cur}">${esc(cat.branchen[k].short)}</button>`).join('')}<button type="button" role="tab" data-br="addon" aria-selected="${cur === 'addon'}">Zusatzbranche</button></div>
      ${cur === 'addon' ? `<fieldset class="cat-box"><legend>Zusatzbranche</legend><label class="consent"><input type="checkbox" id="adOn"${cat.addon.active ? ' checked' : ''}> buchbar</label>
        <div class="wa-grid3"><label>Preis pro Monat (€)<input id="adM" inputmode="decimal" value="${eur(cat.addon.monthCents)}"></label><label>Preis pro Jahr (€)<input id="adY" inputmode="decimal" value="${eur(cat.addon.yearCents)}"></label></div>
        <label>Beschreibung<input id="adT" maxlength="300" value="${esc(cat.addon.text)}"></label></fieldset>`
      : `<p class="form-note"><strong>${n}</strong> Konto/Konten mit dieser Hauptbranche · <strong>${nx}</strong> als Zusatzbranche</p>
      <fieldset class="cat-box"><legend>Branche</legend><div class="wa-grid3"><label>Name<input id="bLabel" maxlength="80" value="${esc(c.label)}"></label><label>Kurzname<input id="bShort" maxlength="40" value="${esc(c.short)}"></label><label class="consent"><input type="checkbox" id="bSelf"${c.selfService ? ' checked' : ''}> online buchbar</label></div>
        <label>Beschreibung<input id="bDesc" maxlength="200" value="${esc(c.desc)}"></label></fieldset>
      ${c.plans.map((p, i) => `<fieldset class="cat-box"><legend>${p.key === 'pro' ? 'Paket Pro' : 'Paket Basic'} (Tarif ${p.tier})</legend>
        <div class="wa-grid3"><label>Name<input data-p="${i}" data-f="name" maxlength="80" value="${esc(p.name)}"></label><label>Preis pro Monat (€)<input data-p="${i}" data-f="monthCents" inputmode="decimal" value="${eur(p.monthCents)}"></label><label>Preis pro Jahr (€)<input data-p="${i}" data-f="yearCents" inputmode="decimal" value="${eur(p.yearCents)}"></label>
        <label>Berater-Zugänge<input data-p="${i}" data-f="seats" type="number" min="1" value="${p.seats}"></label><label class="consent"><input type="checkbox" data-p="${i}" data-f="active"${p.active ? ' checked' : ''}> buchbar</label></div>
        <p class="form-note">Software-Tools</p>${toolBoxes('p' + i, p.tools)}
        <label>Leistungen (eine pro Zeile)<textarea data-p="${i}" data-f="features" rows="5">${esc(p.features.join('\n'))}</textarea></label></fieldset>`).join('')}
      <fieldset class="cat-box"><legend>Enterprise (auf Anfrage)</legend><div class="wa-grid3"><label>Name<input id="eName" maxlength="80" value="${esc(c.enterprise.name)}"></label><label>Preisangabe<input id="ePrice" maxlength="80" value="${esc(c.enterprise.price)}"></label><label class="consent"><input type="checkbox" id="eOn"${c.enterprise.active ? ' checked' : ''}> anzeigen</label></div>
        <p class="form-note">Software-Tools</p>${toolBoxes('e', c.enterprise.tools)}
        <label>Leistungen (eine pro Zeile)<textarea id="eFeat" rows="4">${esc(c.enterprise.features.join('\n'))}</textarea></label></fieldset>`}
      <div class="pt-row cat-foot"><button class="btn btn-ghost" type="button" id="catReset">Auf Startwerte zurücksetzen</button><span style="flex:1"></span><button class="btn btn-dark" type="submit">Speichern</button></div><p class="form-note" id="catMsg" role="status"></p></form>`;
    if (!d.open) d.showModal();
    d.querySelector('[data-x]').onclick = () => d.close();
    d.querySelectorAll('[data-br]').forEach((b) => b.onclick = () => { read(); cur = b.dataset.br; draw(); });
    d.querySelector('#catReset').onclick = async () => { if (!confirm('Alle Pakete und Preise auf die Startwerte zurücksetzen?')) return; const rr = await api('/api/admin/b2b-catalog', { method: 'POST', body: JSON.stringify({ reset: true }) }); if (rr.ok) { cat = rr.data.catalog; draw(); d.querySelector('#catMsg').textContent = 'Zurückgesetzt.'; } };
    d.querySelector('#catF').onsubmit = async (e) => {
      e.preventDefault(); read();
      const rr = await api('/api/admin/b2b-catalog', { method: 'POST', body: JSON.stringify({ catalog: cat }) });
      const m = d.querySelector('#catMsg');
      if (rr.ok) { cat = rr.data.catalog; m.textContent = 'Gespeichert – gilt ab sofort auf /business, im Portal und im Checkout.'; } else m.textContent = rr.data?.error || 'Speichern fehlgeschlagen.';
    };
  };
  // Formularwerte in den Katalog übernehmen (aktueller Reiter).
  const read = () => {
    const q = (s) => d.querySelector(s);
    if (cur === 'addon') { if (!q('#adM')) return; cat.addon = { active: q('#adOn').checked, monthCents: cents(q('#adM').value), yearCents: cents(q('#adY').value), text: q('#adT').value.trim() }; return; }
    const c = cat.branchen[cur]; if (!q('#bLabel')) return;
    c.label = q('#bLabel').value.trim(); c.short = q('#bShort').value.trim(); c.desc = q('#bDesc').value.trim(); c.selfService = q('#bSelf').checked;
    c.plans.forEach((p, i) => {
      const f = (n) => d.querySelector(`[data-p="${i}"][data-f="${n}"]`);
      p.name = f('name').value.trim(); p.monthCents = cents(f('monthCents').value); p.yearCents = cents(f('yearCents').value); p.seats = Math.max(1, Number(f('seats').value) || 1); p.active = f('active').checked;
      p.tools = [...d.querySelectorAll(`[data-t="p${i}"]:checked`)].map((x) => x.value);
      p.features = f('features').value.split('\n').map((x) => x.trim()).filter(Boolean);
    });
    c.enterprise = { active: q('#eOn').checked, name: q('#eName').value.trim(), price: q('#ePrice').value.trim(), tools: [...d.querySelectorAll('[data-t="e"]:checked')].map((x) => x.value), features: q('#eFeat').value.split('\n').map((x) => x.trim()).filter(Boolean) };
  };
  draw();
}
