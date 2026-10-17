// Exposé-AutoPilot für Makler und Berater: Exposé-PDF hineinziehen → Eckdaten werden im Browser erkannt →
// kundenfähige Vorab-Einschätzung zur Finanzierbarkeit (Rate, Nebenkosten, nötiges Haushaltsnetto je Eigenkapital-Szenario).
// Die Datei verlässt das Gerät nicht. Kontaktdaten Dritter (Makler, Verkäufer) werden nicht übernommen.
import { parseListing } from './listing-parse.mjs';
import { kaufnebenkosten, monthlyRate, GREST } from './calc.mjs';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const P = (v, d = 1) => `${v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
const PDFJS = '/vendor/pdfjs-4.10.38/';

async function pdfText(file) {
  const pdfjs = await import(PDFJS + 'pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const out = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 25); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      let line = '';
      for (const it of tc.items) { line += it.str || ''; if (it.hasEOL) { out.push(line); line = ''; } else if (it.str) line += ' '; }
      if (line.trim()) out.push(line);
    }
  } finally { await doc.destroy(); }
  return out.join('\n');
}

// Szenarien: Eigenkapital = Nebenkosten + x % des Kaufpreises. Rate ≤ 35 % des Haushaltsnettos als Faustregel.
export function financeScenarios({ price, land, brokerPct = 0, ratePa = 3.6, repayPa = 2 }) {
  const nk = kaufnebenkosten({ price, land, brokerPct });
  if (!nk) return null;
  const rows = [0, 10, 20].map((x) => {
    const equity = nk.total + (price * x) / 100;
    const loan = Math.max(0, price + nk.total - equity);
    const rate = monthlyRate(loan, ratePa / 100, repayPa / 100);
    return { x, equity, loan, rate, income: rate / 0.35, ltv: (loan / price) * 100 };
  });
  return { nk, rows };
}

export function mountExposeCheck(box, { account = {}, logoUrl = '' } = {}) {
  const lands = Object.entries(GREST).map(([k, g]) => `<option value="${k}"${k === 'hessen' ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
  box.innerHTML = `<h2>Exposé-AutoPilot: Finanzierbarkeit vorab einschätzen</h2>
    <p class="form-note">Exposé-PDF hineinziehen – Kaufpreis, Fläche, Miete und Ort werden erkannt. Daraus entsteht eine Vorab-Einschätzung, die Sie Interessenten mitgeben können: Kaufnebenkosten, Rate und nötiges Haushaltsnetto bei drei Eigenkapital-Varianten. Die Datei bleibt auf Ihrem Gerät; Namen und Kontaktdaten aus dem Exposé werden nicht übernommen.</p>
    <label class="ec-drop" id="ecDrop"><input type="file" id="ecFile" accept="application/pdf" hidden><strong>Exposé (PDF) hier ablegen</strong><span>oder klicken zum Auswählen</span></label>
    <div class="ec-grid">
      <label>Kaufpreis (€)<input id="ec_p" type="number" step="any"></label>
      <label>Kaltmiete / Monat (€, falls vermietet)<input id="ec_r" type="number" step="any"></label>
      <label>Wohnfläche (m²)<input id="ec_a" type="number" step="any"></label>
      <label>Objekt / Ort<input id="ec_n" type="text" maxlength="120"></label>
      <label>Bundesland<select id="ec_l">${lands}</select></label>
      <label>Käuferprovision (%)<input id="ec_m" type="number" step="0.01" value="3.57"></label>
      <label>Sollzins (%)<input id="ec_i" type="number" step="0.05" value="3.6"></label>
      <label>Tilgung (%)<input id="ec_t" type="number" step="0.1" value="2"></label>
    </div>
    <p class="form-note" id="ecMsg" role="status"></p>
    <div id="ecOut"></div>`;
  const $ = (id) => box.querySelector('#' + id);
  const n = (id) => Number($(id).value) || 0;
  const run = () => {
    const price = n('ec_p');
    if (!(price > 0)) { $('ecOut').innerHTML = ''; return; }
    const r = financeScenarios({ price, land: $('ec_l').value, brokerPct: n('ec_m'), ratePa: n('ec_i'), repayPa: n('ec_t') });
    if (!r) return;
    const rent = n('ec_r'), area = n('ec_a');
    const color = /^#[0-9a-f]{6}$/i.test(account.brandColor || '') ? account.brandColor : '#0F2C59';
    $('ecOut').innerHTML = `<article class="ec-sheet" id="ecSheet" style="--ec:${color}">
      <header class="ec-head">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}<div><small>Finanzierbarkeit – Vorab-Einschätzung</small><strong>${esc($('ec_n').value || 'Objekt')}</strong></div></header>
      <div class="ec-facts"><div><small>Kaufpreis</small><strong>${E(price)}</strong></div>${area ? `<div><small>Preis je m²</small><strong>${E(price / area)}</strong></div>` : ''}<div><small>Kaufnebenkosten</small><strong>${E(r.nk.total)}</strong><span>${P(r.nk.totalPct)} (${esc(r.nk.land)})</span></div>${rent ? `<div><small>Bruttomietrendite</small><strong>${P((rent * 12 / price) * 100, 2)}</strong></div>` : ''}</div>
      <table class="ec-table"><thead><tr><th>Eigenkapital</th><th>Darlehen</th><th>Rate / Monat</th><th>Haushaltsnetto ab ca.</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td><strong>${E(x.equity)}</strong><small>${x.x ? `Nebenkosten + ${x.x} %` : 'nur Nebenkosten'}</small></td><td>${E(x.loan)}<small>${P(x.ltv, 0)} des Kaufpreises</small></td><td><strong>${E(x.rate)}</strong></td><td>${E(x.income)}</td></tr>`).join('')}</tbody></table>
      <p class="ec-note">Annahmen: ${P(n('ec_i'), 2)} Sollzins, ${P(n('ec_t'), 1)} Tilgung, Rate höchstens 35 % des Haushaltsnettos (Faustregel). Rechnerische Orientierung – keine Finanzierungszusage, keine Kreditvermittlung oder Beratung; die Entscheidung trifft das finanzierende Institut nach Prüfung von Bonität und Objekt.${account.companyName ? ` Erstellt von ${esc(account.companyName)}${account.advisorName ? ', ' + esc(account.advisorName) : ''}${account.phone ? ', Tel. ' + esc(account.phone) : ''}.` : ''}</p>
    </article><p class="pt-row"><button type="button" class="btn btn-dark" id="ecPrint">Als PDF sichern / drucken</button></p>`;
    $('ecPrint').onclick = () => {
      const w = window.open('', '_blank'); if (!w) return;
      const css = `body{font:14px/1.5 system-ui,sans-serif;color:#0F172A;margin:28px}.ec-head{display:flex;gap:14px;align-items:center;border-bottom:3px solid ${color};padding-bottom:10px}.ec-head img{max-height:48px;max-width:160px}.ec-head small{display:block;color:#475569}.ec-head strong{font-size:20px;color:${color}}.ec-facts{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0}.ec-facts small,.ec-facts span{display:block;color:#475569;font-size:12px}.ec-facts strong{font-size:18px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #CBD5E1;padding:8px;text-align:left}td small{display:block;color:#64748B;font-size:12px}.ec-note{font-size:11.5px;color:#475569;margin-top:16px}`;
      w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Finanzierbarkeit – ${esc($('ec_n').value || 'Objekt')}</title><style>${css}</style></head><body>${$('ecSheet').innerHTML}</body></html>`);
      w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
    };
  };
  const load = async (f) => {
    const msg = $('ecMsg');
    if (!f || f.type !== 'application/pdf') { msg.textContent = 'Bitte eine PDF-Datei wählen.'; return; }
    if (f.size > 40 * 1024 * 1024) { msg.textContent = 'Die Datei ist größer als 40 MB.'; return; }
    msg.textContent = 'Exposé wird gelesen …';
    try {
      const t = await pdfText(f);
      if (t.replace(/\s+/g, '').length < 150) { msg.textContent = 'Kein lesbarer Text (eingescanntes Dokument). Bitte Werte eintragen.'; return; }
      const r = parseListing({ u: '', t, ti: '' });
      if (r.price) $('ec_p').value = r.price;
      if (r.rent) $('ec_r').value = Math.round(r.rent);
      if (r.area) $('ec_a').value = r.area;
      if (r.brokerPct != null) $('ec_m').value = r.brokerPct;
      $('ec_n').value = r.name || '';
      msg.textContent = `Erkannt: ${r.found.join(', ') || 'nichts'}.${r.missing.length ? ' Nicht gefunden: ' + r.missing.join(', ') + '.' : ''} Bitte Bundesland prüfen.`;
      run();
    } catch { msg.textContent = 'Das Exposé konnte nicht gelesen werden (beschädigt oder passwortgeschützt).'; }
  };
  $('ecFile').onchange = (e) => { load(e.target.files?.[0]); e.target.value = ''; };
  const drop = $('ecDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('on'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); load(e.dataTransfer.files?.[0]); });
  box.addEventListener('input', (e) => { if (e.target.id?.startsWith('ec_')) run(); });
}
