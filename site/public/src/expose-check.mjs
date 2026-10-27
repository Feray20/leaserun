// Listing AutoPilot for agents and loan officers: drop in a listing PDF → key facts are read in the browser →
// a client-ready affordability preview (closing costs, PITIA, income needed per down-payment scenario).
// The file never leaves the device. Contact details of third parties (agents, sellers) are not taken.
import { parseListing } from './listing-parse.mjs?v=892f3666';
import { kaufnebenkosten, GREST, DEFAULT_STATE } from './calc.mjs?v=892f3666';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const P = (v, d = 1) => `${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
// Accepts 1,234.56 and 1234.56.
const toNum = (v) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
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

// Scenarios: down payment 5%, 10% and 20% of the price; buyer also pays closing costs in cash (cash to close).
// 30-year fixed by default. Income needed = PITIA ÷ 28% (front-end DTI rule of thumb), gross monthly income.
// Property tax and insurance default to rough national averages when not given (assumptions, shown in the note).
const pmt = (loan, ratePct, years) => { if (!(loan > 0)) return 0; const r = ratePct / 100 / 12, n = years * 12; return r > 0 ? (loan * r) / (1 - Math.pow(1 + r, -n)) : loan / n; };
export const DOWN_SCENARIOS = [5, 10, 20];
export function financeScenarios({ price, land, brokerPct = 0, ratePa = 6.5, termYears = 30, taxesAnnual, insuranceAnnual, hoaMonthly = 0, pmiPct = 0.6 }) {
  if (!(price > 0)) return null;
  const nk = kaufnebenkosten({ price, land, brokerPct });
  if (!nk) return null;
  const taxM = (taxesAnnual ?? price * 0.011) / 12, insM = (insuranceAnnual ?? Math.max(900, price * 0.006)) / 12;
  const rows = DOWN_SCENARIOS.map((x) => {
    const down = (price * x) / 100;
    const loan = Math.max(0, price - down);
    const rate = pmt(loan, ratePa, termYears);
    const pmi = x < 20 ? (loan * pmiPct) / 100 / 12 : 0;
    const pitia = rate + pmi + taxM + insM + (Number(hoaMonthly) || 0);
    return { x, down, equity: down + nk.total, loan, rate, pmi, pitia, income: pitia / 0.28, ltv: (loan / price) * 100 };
  });
  return { nk, rows, taxM, insM };
}

export function mountExposeCheck(box, { account = {}, logoUrl = '' } = {}) {
  const def = GREST[DEFAULT_STATE] ? DEFAULT_STATE : Object.keys(GREST)[0];
  const lands = Object.entries(GREST).map(([k, g]) => `<option value="${k}"${k === def ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
  box.innerHTML = `<h2>Listing AutoPilot: affordability preview</h2>
    <p class="form-note">Drop in a listing PDF – price, square feet, rent, taxes, HOA and location are detected. You get an affordability preview you can share with buyers: estimated closing costs, monthly payment (PITIA) and the income needed at three down-payment levels. The file stays on your device; names and contact details in the listing are not imported.</p>
    <label class="ec-drop" id="ecDrop"><input type="file" id="ecFile" accept="application/pdf" hidden><strong>Drop the listing PDF here</strong><span>or click to choose a file</span></label>
    <div class="ec-grid">
      <label>Price ($)<input id="ec_p" type="text" inputmode="decimal"></label>
      <label>Monthly rent ($, if rented)<input id="ec_r" type="text" inputmode="decimal"></label>
      <label>Square feet<input id="ec_a" type="text" inputmode="decimal"></label>
      <label>Property / location<input id="ec_n" type="text" maxlength="120"></label>
      <label>State<select id="ec_l">${lands}</select></label>
      <label>Property taxes / year ($)<input id="ec_x" type="text" inputmode="decimal" placeholder="state average"></label>
      <label>HOA dues / month ($)<input id="ec_h" type="text" inputmode="decimal" value="0"></label>
      <label>Buyer's agent (%)<input id="ec_m" type="text" inputmode="decimal" value="2.5"></label>
      <label>Interest rate (%)<input id="ec_i" type="text" inputmode="decimal" value="6.5"></label>
      <label>Loan term (years)<input id="ec_t" type="text" inputmode="numeric" value="30"></label>
    </div>
    <p class="form-note" id="ecMsg" role="status"></p>
    <div id="ecOut"></div>`;
  const $ = (id) => box.querySelector('#' + id);
  const n = (id) => toNum($(id).value);
  const run = () => {
    const price = n('ec_p');
    if (!(price > 0)) { $('ecOut').innerHTML = ''; return; }
    const r = financeScenarios({ price, land: $('ec_l').value, brokerPct: n('ec_m'), ratePa: n('ec_i'), termYears: n('ec_t') || 30, taxesAnnual: $('ec_x').value.trim() ? n('ec_x') : undefined, hoaMonthly: n('ec_h') });
    if (!r) return;
    const rent = n('ec_r'), area = n('ec_a');
    const color = /^#[0-9a-f]{6}$/i.test(account.brandColor || '') ? account.brandColor : '#0F2C59';
    $('ecOut').innerHTML = `<article class="ec-sheet" id="ecSheet" style="--ec:${color}">
      <header class="ec-head">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}<div><small>Affordability preview</small><strong>${esc($('ec_n').value || 'Property')}</strong></div></header>
      <div class="ec-facts"><div><small>Price</small><strong>${E(price)}</strong></div>${area ? `<div><small>Price per sq ft</small><strong>${E(price / area)}</strong></div>` : ''}<div><small>Est. closing costs</small><strong>${E(r.nk.total)}</strong><span>${P(r.nk.totalPct)} (${esc(r.nk.land)})</span></div>${rent ? `<div><small>Gross rental yield</small><strong>${P((rent * 12 / price) * 100, 2)}</strong></div>` : ''}</div>
      <table class="ec-table"><thead><tr><th>Down payment</th><th>Loan</th><th>PITIA / month</th><th>Gross income from approx.</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td><strong>${E(x.down)}</strong><small>${x.x}% down · cash to close ${E(x.equity)}</small></td><td>${E(x.loan)}<small>${P(x.ltv, 0)} LTV${x.pmi ? ' · incl. PMI' : ''}</small></td><td><strong>${E(x.pitia)}</strong><small>P&amp;I ${E(x.rate)}</small></td><td>${E(x.income)}/mo</td></tr>`).join('')}</tbody></table>
      <p class="ec-note">Assumptions: ${P(n('ec_i'), 2)} interest, ${n('ec_t') || 30}-year fixed, property taxes ${E(r.taxM * 12)}/yr, homeowners insurance ${E(r.insM * 12)}/yr, PMI 0.6%/yr below 20% down, housing payment at most 28% of gross monthly income (rule of thumb). Investment properties usually need 15–25% down. Estimate only – not a loan approval, rate quote or lending advice; the lender decides after reviewing credit, income and the property.${account.companyName ? ` Prepared by ${esc(account.companyName)}${account.advisorName ? ', ' + esc(account.advisorName) : ''}${account.phone ? ', phone ' + esc(account.phone) : ''}.` : ''}</p>
    </article><p class="pt-row"><button type="button" class="btn btn-dark" id="ecPrint">Save as PDF / print</button></p>`;
    $('ecPrint').onclick = () => {
      const w = window.open('', '_blank'); if (!w) return;
      const css = `body{font:14px/1.5 system-ui,sans-serif;color:#0F172A;margin:28px}.ec-head{display:flex;gap:14px;align-items:center;border-bottom:3px solid ${color};padding-bottom:10px}.ec-head img{max-height:48px;max-width:160px}.ec-head small{display:block;color:#475569}.ec-head strong{font-size:20px;color:${color}}.ec-facts{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0}.ec-facts small,.ec-facts span{display:block;color:#475569;font-size:12px}.ec-facts strong{font-size:18px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #CBD5E1;padding:8px;text-align:left}td small{display:block;color:#64748B;font-size:12px}.ec-note{font-size:11.5px;color:#475569;margin-top:16px}`;
      w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Affordability – ${esc($('ec_n').value || 'Property')}</title><style>${css}</style></head><body>${$('ecSheet').innerHTML}</body></html>`);
      w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
    };
  };
  const load = async (f) => {
    const msg = $('ecMsg');
    if (!f || f.type !== 'application/pdf') { msg.textContent = 'Please choose a PDF file.'; return; }
    if (f.size > 40 * 1024 * 1024) { msg.textContent = 'The file is larger than 40 MB.'; return; }
    msg.textContent = 'Reading the listing …';
    try {
      const t = await pdfText(f);
      if (t.replace(/\s+/g, '').length < 150) { msg.textContent = 'No readable text (scanned document). Please enter the numbers.'; return; }
      const r = parseListing({ u: '', t, ti: '' });
      if (r.price) $('ec_p').value = r.price;
      if (r.rent) $('ec_r').value = Math.round(r.rent);
      if (r.area) $('ec_a').value = r.area;
      if (r.taxesAnnual) $('ec_x').value = r.taxesAnnual;
      if (r.hausgeld != null) $('ec_h').value = r.hausgeld;
      if (r.brokerPct != null) $('ec_m').value = r.brokerPct;
      if (r.state) { const k = Object.keys(GREST).find((x) => GREST[x].abbr === r.state); if (k) $('ec_l').value = k; }
      $('ec_n').value = r.name || '';
      msg.textContent = `Found: ${r.found.join(', ') || 'nothing'}.${r.missing.length ? ' Not found: ' + r.missing.join(', ') + '.' : ''} Please check the state.`;
      run();
    } catch { msg.textContent = 'The listing could not be read (damaged or password-protected).'; }
  };
  $('ecFile').onchange = (e) => { load(e.target.files?.[0]); e.target.value = ''; };
  const drop = $('ecDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('on'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); load(e.dataTransfer.files?.[0]); });
  box.addEventListener('input', (e) => { if (e.target.id?.startsWith('ec_')) run(); });
  box.addEventListener('change', (e) => { if (e.target.id === 'ec_l') run(); });
}
