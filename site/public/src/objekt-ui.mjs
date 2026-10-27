// Property & document import with metrics engine and property analysis – shared by the app and the internal area.
// There is no property search: properties come in as a listing PDF (drop zone), a link, the one-click import in the
// user's own browser, or manual input. Large portals (Zillow, Redfin, Realtor.com …) are not fetched automatically (their terms).
// Element ids are kept for compatibility (form-spec, saved inputs). US meaning of some ids:
//   a_land = state · a_art = SFR|CONDO|MFH · a_area = sq ft · a_rooms = bedrooms · a_hg = HOA dues $/mo · a_rl = property tax $/yr
//   a_kwh = insurance $/yr · a_vq = market rent $/sq ft · a_mpb = rent control applies · a_nonrec = other expenses $/mo
//   a_mqm = repairs + capex (% of rent) · a_mg = property management (% of rent) · a_t = loan term (years) · a_fix = ARM fixed period
//   a_afa = depreciation period (27.5 / 39 years) · a_lz = market cap rate for income value · a_ec = owner-occupied ('owner' or '')
import * as C from './calc.mjs?v=892f3666';
import { parseListing, bookmarklet } from './listing-parse.mjs?v=892f3666';
import { work } from './loader.mjs?v=892f3666';
import { showPdf } from './pdf-view.mjs?v=892f3666';
const { GREST, kaufnebenkosten, analyse, exposeMetrics } = C;
const DEF_STATE = C.DEFAULT_STATE && GREST[C.DEFAULT_STATE] ? C.DEFAULT_STATE : (GREST.texas ? 'texas' : Object.keys(GREST)[0]);

const SESSION = 'leaserun-auth-session-v1';
const $ = (id) => document.getElementById(id);
let root = null;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (x) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const E2 = (x) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const P = (x, d = 2) => (x == null || Number.isNaN(x) ? '–' : `${x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
const D = (x, d = 2) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
// Accepts 1,234.56 and 1234.56.
const num = (id) => { const v = $(id)?.value; if (v === '' || v == null) return 0; const n = Number(String(v).replace(/[$,\s%]/g, '')); return Number.isFinite(n) ? n : 0; };
const val = (id) => $(id)?.value || '';
const table = (rows) => `<table class="bill-table"><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</tbody></table>`;
const tone = (v, good, warn) => (v == null ? 'na' : v >= good ? 'ok' : v >= warn ? 'warn' : 'bad');
const TYPE = { SFR: 'Single-family home', CONDO: 'Condo / townhome', MFH: 'Multifamily (2–4 units)' };
const stateKey = (abbr) => Object.keys(GREST).find((k) => String(GREST[k].abbr || '').toUpperCase() === String(abbr || '').toUpperCase());

// Signed in: start values come from the user's own financial profile, not sample numbers (set in mountObjekt).
let PROF = {};
const pv = (v) => (Number(v) > 0 ? Number(v) : '');
const landOpts = () => { const sel = GREST[PROF.land] ? PROF.land : DEF_STATE; return Object.entries(GREST).map(([k, g]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(g.name)}</option>`).join(''); };
const F = (id, label, value = '', step = 'any', type = 'text') => `<label>${label}<input id="${id}" type="${type}" ${type === 'text' ? 'inputmode="decimal" autocomplete="off"' : ''} ${type === 'number' ? `step="${step}" min="0"` : ''} value="${esc(value)}"></label>`;
const T = (id, label, value = '', type = 'text') => `<label>${label}<input id="${id}" type="${type}" value="${esc(value)}"${type === 'text' ? ' maxlength="200"' : ''}></label>`;

function renderImport() {
  return `<section class="ox" aria-label="Property and document import">
  <div class="ox-grid">
    <label class="ox-drop" id="ox_drop" tabindex="0"><input id="imp_pdf" type="file" accept="application/pdf" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5"/></svg>
      <strong>Drop a listing PDF here</strong><span>or tap to choose a file · up to 40 MB · the file stays on your device</span></label>
    <form class="ox-link" id="ox_link"><label for="ox_url"><strong>Link to the listing</strong><span>Listing PDF or a broker's or seller's page (https://…)</span></label>
      <div class="ox-row"><input id="ox_url" type="url" inputmode="url" placeholder="https://…" autocomplete="off"><button class="btn btn-dark" type="submit">Import</button></div>
      <p class="form-note">Zillow, Redfin and Realtor.com links are not fetched automatically (their terms of use). Use the one-click import below, paste the listing text, or save the listing as a PDF and upload it here.</p></form>
  </div>
  <p class="imp-msg" id="imp_msg" role="status" aria-live="polite"></p>
  <details class="ox-more"><summary>More ways: one-click import or paste text</summary>
  <article class="imp-card" id="imp">
    <div class="imp-head"><div><h3>One-click import from Zillow, Redfin, Realtor.com &amp; more</h3>
      <p>Open a listing, click the button – price, square feet, beds, baths, year built, HOA, taxes and rent estimate land in your property list with the link, and every metric is calculated right away.</p></div>
      <a class="btn btn-dark imp-bm" id="imp_bm" href="#" draggable="true" title="Drag to your bookmarks bar">＋ To LeaseRun</a></div>
    <ol class="imp-steps"><li><strong>Once:</strong> drag the "＋ To LeaseRun" button to your bookmarks bar (show the bar: Ctrl+Shift+B, on a Mac ⌘+Shift+B).</li>
      <li>Open a <strong>single listing</strong> on the portal and click "＋ To LeaseRun" in your bookmarks bar.</li>
      <li>Repeat for each listing – they all appear one below the other in your list.</li></ol>
    <details class="imp-paste"><summary>On your phone or without bookmarks: paste the listing text</summary>
      <p class="form-note">Select and copy the listing text (on your phone: long-press → "Select All" → "Copy"), paste it here and add the listing link.</p>
      <label>Link to the listing<input id="imp_url" type="url" placeholder="https://…" autocomplete="off"></label>
      <label>Listing text<textarea id="imp_text" rows="5" maxlength="30000" placeholder="$349,000 · 3 bd · 2 ba · 1,450 sqft · Built in 1995 · HOA $45/mo …"></textarea></label>
      <button class="btn btn-dark" id="imp_go" type="button">Import</button></details>
        <p class="form-note">The import runs only in your browser: only the listing you open or choose is read, and only numbers and facts for your own calculation (price, square feet, rent, year built, HOA, taxes). Names, phone numbers, email addresses and photos of agents or sellers are discarded right away and never stored. The listing file is not uploaded; nothing is sent to LeaseRun.</p>
  </article>
  </details>
  <div id="ox_metrics" class="ox-metrics" aria-live="polite"></div>
</section>`;
}

// ---------- Property analysis ----------
function renderAnalyse() {
  return `<section class="an" aria-label="Property analysis">
  <h2>Property analysis</h2>
  <div class="an-bar" id="a_bar" aria-live="polite"></div>
  <div class="an-grid">
  <details class="dash-card an-sec"><summary><h3>Listing and location</h3></summary><div class="obj-grid">
    ${T('a_url', 'Link to the listing (link only)', '', 'url')}${T('a_addr', 'Address or location')}
    <label>State<select id="a_land">${landOpts()}</select></label>
    <label>Property type<select id="a_art"><option value="SFR">Single-family home</option><option value="CONDO">Condo / townhome</option><option value="MFH">Multifamily (2–4 units)</option></select></label>
    <label>Use<select id="a_ec"><option value="">Rental (investment property)</option><option value="owner">I will live there (owner-occupied)</option></select></label>
  </div></details>
  <details class="dash-card an-sec"><summary><h3>Key facts</h3></summary><div class="obj-grid">
    ${F('a_price', 'Purchase price ($)')}${F('a_area', 'Square feet')}${F('a_rooms', 'Bedrooms')}${F('a_year', 'Year built')}
    ${F('a_broker', 'Buyer\'s agent you pay (%)', '', 'any')}${F('a_rl', 'Property taxes / year ($)', '', 'any')}${F('a_kwh', 'Insurance / year ($)', '', 'any')}<div class="an-etw">${F('a_hg', 'HOA dues / month ($)')}</div>
  </div><p class="form-note">Blank taxes or insurance: the analysis uses your state's average property tax rate and an insurance estimate (assumptions).</p></details>
  <details class="dash-card an-sec"><summary><h3>Rent and expenses</h3></summary><div class="obj-grid">
    ${F('a_rent', 'Monthly rent ($, current lease or estimate)')}${F('a_vq', 'Market rent of comparable rentals ($ per sq ft / month)')}
    <label class="consent"><input type="checkbox" id="a_mpb"> Unit is covered by rent control / rent stabilization</label>
    ${F('a_vac', 'Vacancy (%)', 6)}${F('a_mg', 'Property management (% of rent)', 8)}${F('a_mqm', 'Repairs + capex (% of rent)', 10)}${F('a_nonrec', 'Other expenses / month ($, e.g. utilities, lawn)')}
  </div><p class="form-note" id="a_mslink"></p></details>
  <details class="dash-card an-sec"><summary><h3>Financing</h3></summary><div class="obj-grid">
    ${F('a_eq', 'Cash for down payment + closing ($)', pv(PROF.equity))}${F('a_z', 'Interest rate (%)', '', 'any')}${F('a_t', 'Loan term (years)', 30)}${F('a_fix', 'ARM fixed period (years, 0 = fixed-rate)', 0)}
  </div><p class="form-note">Investment properties usually need 15–25% down; owner-occupied loans can go lower, with PMI below 20% down.</p></details>
  <details class="dash-card an-sec"><summary><h3>Tax and value (for specialists)</h3></summary><div class="obj-grid">
    ${F('a_bs', 'Building share of price (%, land is not depreciable)', 80)}<label>Depreciation period<select id="a_afa"><option value="27.5">27.5 years (residential rental)</option><option value="39">39 years (commercial)</option></select></label>${F('a_tax', 'Marginal tax rate, federal + state (%)', pv(PROF.marginalTaxPct))}
    ${F('a_lv', 'Land value ($, for income value)')}${F('a_lz', 'Market cap rate (%)', '', 'any')}${F('a_rnd', 'Remaining economic life (years, optional)')}
  </div><p class="form-note">Building share: often from the county assessor's land/improvement split. Market cap rate: from recent sales or an appraiser. Ask your CPA about cost segregation and bonus depreciation.</p></details>
  </div>
  <div class="an-jump" id="a_jump" hidden><span id="a_jump_t"></span><button class="btn btn-dark" type="button" id="a_jump_b">See analysis ↓</button></div>
  <div class="an-out" id="a_out"></div>
  <p class="an-actions" id="a_actions" hidden><button class="btn btn-dark" id="a_keep" type="button"${APPMODE ? ' hidden' : ''}>Add to list</button> <button class="btn btn-outline" id="a_pdf" type="button">Analysis as PDF</button> <button class="btn btn-outline" id="a_mail" type="button">Email it</button> <button class="btn ${APPMODE ? 'btn-dark' : 'btn-outline'}" id="a_save" type="button">${APPMODE ? 'Save to "My properties"' : 'Save as property in an account'}</button> <button class="btn btn-ghost" id="a_print" type="button">Print</button> <span class="form-note" id="a_msg" role="status"></span></p>
</section>`;
}

const PENDING = 'lr-pending-object';
let APPMODE = false, ONSAVE = null; // consumer app: no own list, save straight to "My properties"
const LIST = 'lr-intern-list-v1';
let last = null;
const token = () => { try { return JSON.parse(localStorage.getItem(SESSION) || 'null')?.access_token || ''; } catch { return ''; } };
const inputs = () => ({ price: num('a_price'), area: num('a_area'), land: val('a_land'), brokerPct: num('a_broker'), rent: num('a_rent'), vergleichQm: num('a_vq'), mietpreisbremse: $('a_mpb').checked,
  vacancyPct: num('a_vac'), mgmtPct: num('a_mg'), nonRecoverable: num('a_nonrec'), maintenanceQm: num('a_mqm'), equity: num('a_eq'), ratePct: num('a_z'), termYears: num('a_t') || 30, fixedYears: num('a_fix'),
  taxesAnnual: $('a_rl').value.trim() ? num('a_rl') : undefined, insuranceAnnual: $('a_kwh').value.trim() ? num('a_kwh') : undefined, hoaMonthly: num('a_hg'),
  ownerOccupied: val('a_ec') === 'owner', units: val('a_art') === 'MFH' ? Math.max(2, num('a_units') || 2) : 1,
  buildingSharePct: num('a_bs'), depYears: Number(val('a_afa')) || 27.5, taxPct: num('a_tax'), landValue: num('a_lv'), capRatePct: num('a_lz'), remainingLife: num('a_rnd'), yearBuilt: num('a_year') });
function updateAnalyse() {
  const ort = val('a_addr');
  $('a_mslink').innerHTML = `Market rent: use comparable rentals nearby (rental listings, a rent estimate or a local property manager)${ort ? ` – <a class="ck-link" href="https://www.google.com/search?q=${encodeURIComponent('rent comparables ' + ort)}" target="_blank" rel="noopener noreferrer">search rentals near ${esc(ort)}<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a>` : ''}. Without it the analysis uses the rent you entered.`;
  const a = analyse(inputs());
  const url = val('a_url').trim();
  const okUrl = /^https:\/\/[^\s]+$/i.test(url);
  if (!a) { $('a_bar').innerHTML = '<p class="form-note">Enter the purchase price – the bar fills in right away.</p>'; $('a_out').innerHTML = ''; $('a_actions').hidden = true; last = null; jumpUpd(null); renderMetrics(); return; }
  const chip = (label, v, cls = '') => `<div class="an-chip ${cls}"><small>${label}</small><strong>${v}</strong></div>`;
  const cap = a.capRate ?? (a.noi != null && a.price ? (a.noi * 12 / a.price) * 100 : null);
  const cash = a.cashToClose ?? a.nebenkosten;
  $('a_bar').innerHTML = `<div class="an-head"><div><strong>${esc(ort || 'Property without address')}</strong><span>${esc(TYPE[val('a_art')] || '')}${num('a_area') ? ` · ${D(num('a_area'), 0)} sq ft` : ''}${num('a_rooms') ? ` · ${D(num('a_rooms'), 0)} bd` : ''}${num('a_year') ? ` · built ${num('a_year')}` : ''}</span></div>${okUrl ? `<a class="btn btn-outline" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">Open listing<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a>` : ''}</div>
  <div class="an-chips">${chip('Price', E(a.price))}${chip('$ / sq ft', a.pricePerQm ? E(a.pricePerQm) : '–')}${chip('Cap rate', P(cap), cap == null ? 'na' : cap >= 7 ? 'ok' : cap >= 5 ? 'warn' : 'bad')}
  ${chip('Gross yield', P(a.grossYield), a.grossYield == null ? 'na' : '')}${chip('Cash flow pre-tax', E2(a.cashflow), a.rent ? (a.cashflow >= 0 ? 'ok' : 'bad') : 'na')}${chip('Cash flow after tax', E2(a.cashflowAfterTax), a.rent ? (a.cashflowAfterTax >= 0 ? 'ok' : 'warn') : 'na')}
  ${chip('DSCR', a.dscr == null ? '–' : D(a.dscr), tone(a.dscr, 1.25, 1))}${chip('Cash to close', E(cash), num('a_eq') >= cash ? 'ok' : 'bad')}</div>
  <p class="form-note an-src">Rent: ${a.rentSource === 'ist' ? 'rent you entered' : a.rentSource === 'mietspiegel' ? 'market rent × square feet (no rent entered)' : 'not entered – yield and cash flow are not meaningful'}. Color thresholds (cap rate ≥ 7% green, ≥ 5% yellow; DSCR ≥ 1.25 green) are LeaseRun assumptions.</p>`;
  const SECTIONS = [
    { title: 'Costs and cash', rows: [['Closing costs', `${E(a.nebenkosten)} (${P(a.nkPct)})`], ['Total cost', E(a.allIn)], ['Total cost per sq ft', a.allInPerQm ? E(a.allInPerQm) : '–'],
      ['Down payment', a.downPayment != null ? E(a.downPayment) : '–'], ['Cash to close', E(cash)], ['Loan / LTV', `${E(a.loan)} · ${P(a.ltv, 1)} of price`]] },
    { title: 'Rent and market', rows: [['Rent used', `${E2(a.rent)} (${a.rentPerQm ? E2(a.rentPerQm) + ' / sq ft' : '–'})`], ['Market rent (comparables)', a.rentMarket ? E2(a.rentMarket) : 'not entered'],
      ['Gap between rent and market', a.rentGapPct == null ? '–' : `${a.rentGapPct > 0 ? '+' : ''}${D(a.rentGapPct, 1)}% upside`], ['1% rule (rent ÷ price)', a.onePct != null ? P(a.onePct) : '–'],
      ['Break-even rent (cash flow 0)', E2(a.rentBreakEven)], ['Rent for DSCR 1.20', E2(a.rentDscr12)], ['Rent for a 5% cap rate on cost', E2(a.rentYield5)]] },
    { title: 'Returns', rows: [['Cap rate (NOI ÷ price)', P(cap)], ['Cap rate on total cost', P(a.netYield)], ['Gross rent multiplier', a.factor == null ? '–' : D(a.factor, 1)], ['Cash-on-cash return', P(a.cashOnCash)],
      ['Return incl. principal paydown', P(a.equityReturn)], ['Net operating income (NOI) / month', E2(a.noi)]] },
    { title: 'Monthly payment and risk', rows: [['Principal & interest', `${E2(a.rate)} (interest ${E2(a.interestM)}, principal ${E2(a.principalM)})`], ['PITIA (incl. taxes, insurance, HOA, PMI)', a.pitia != null ? E2(a.pitia) : '–'], ['PMI', a.pmi ? E2(a.pmi) : 'none'],
      ['DSCR (debt service coverage)', a.dscr == null ? '–' : D(a.dscr)], ['ICR (interest coverage)', a.icr == null ? '–' : D(a.icr)], ['Debt yield', P(a.debtYield)], ['Break-even interest rate', P(a.kippZins)], ['Payment at +2 points', E2(a.rateStress)],
      ...(num('a_fix') > 0 && num('a_fix') < 30 ? [['Balance at ARM reset', E(a.restAfterFixed)]] : []), ['Paid off after', a.payoffYears ? `${D(a.payoffYears, 1)} years` : '–']] },
    { title: 'Tax (year 1, simplified)', rows: [['Depreciation per year', E(a.afa)], ['Taxable rental income', E(a.taxable)], [a.tax < 0 ? 'Tax benefit (if losses are deductible)' : 'Tax owed', E(Math.abs(a.tax))], ['Tax effect per month', E2(-a.tax / 12)], ['Cash flow after tax per month', E2(a.cashflowAfterTax)]] },
    { title: 'Value', rows: [['Income value (NOI ÷ market cap rate)', a.ertragswert ? E(a.ertragswert) : 'market cap rate missing'], ['Price vs. income value', a.ertragswertGapPct == null ? '–' : `${a.ertragswertGapPct > 0 ? '+' : ''}${D(a.ertragswertGapPct, 1)}%`]] },
  ];
  last = { a, ort, url: okUrl ? url : '', sections: SECTIONS,
    chips: [['Price', E(a.price)], ['$ / sq ft', a.pricePerQm ? E(a.pricePerQm) : '–'], ['Cap rate', P(cap)], ['Gross yield', P(a.grossYield)],
      ['Cash flow pre-tax', E2(a.cashflow)], ['Cash flow after tax', E2(a.cashflowAfterTax)], ['DSCR', a.dscr == null ? '–' : D(a.dscr)], ['Cash to close', E(cash)]],
    subtitle: `${TYPE[val('a_art')] || ''}${num('a_area') ? ` · ${D(num('a_area'), 0)} sq ft` : ''}${num('a_rooms') ? ` · ${D(num('a_rooms'), 0)} bedrooms` : ''}${num('a_year') ? ` · built ${num('a_year')}` : ''} · ${GREST[val('a_land')]?.name || ''}` };
  $('a_out').innerHTML = `<h3 class="an-res-h" id="a_res">Analysis result</h3><div class="an-grid">${SECTIONS.map((x) => `<article class="dash-card"><h3>${x.title}</h3>${table(x.rows.map((r) => [esc(r[0]), esc(r[1])]))}</article>`).join('')}</div>
  ${a.hints.length ? `<article class="dash-card"><h3>Notes</h3><ul class="plain-list">${a.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></article>` : ''}
  `;
  $('a_actions').hidden = false;
  jumpUpd(a);
  renderMetrics();
}

// Quick access: once a price is entered, a bar at the bottom shows the key values and "See analysis" jumps to the result
// (which sits below the inputs).
let jumpObs = null, outVisible = false;
function jumpUpd(a) {
  const j = $('a_jump'); if (!j) return;
  if (!jumpObs && 'IntersectionObserver' in window) {
    jumpObs = new IntersectionObserver((es) => { outVisible = es.some((e) => e.isIntersecting); j.hidden = !last || outVisible; }, { rootMargin: '0px 0px -30% 0px' });
    jumpObs.observe($('a_out')); jumpObs.observe($('a_actions'));
    $('a_jump_b').onclick = () => $('a_res')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  if (!a) { j.hidden = true; return; }
  $('a_jump_t').innerHTML = `<b>${a.rent ? 'Cash flow ' + E2(a.cashflow) : 'Price ' + E(a.price)}</b><small>${a.grossYield == null ? 'Enter rent for returns' : 'Gross yield ' + P(a.grossYield)}</small>`;
  j.hidden = outVisible;
}

// Drop zone (drag & drop) and link import.
function bindImport() {
  const drop = $('ox_drop'), input = $('imp_pdf'), msg = () => $('imp_msg');
  if (drop && input) {
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('on'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
    drop.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer?.files || [])].find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
      if (!f) { msg().className = 'imp-msg bad'; msg().textContent = 'Please drop a listing as a PDF.'; return; }
      const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event('change'));
    });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  }
  $('ox_link')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('ox_url').value.trim(), m = msg();
    if (!/^https:\/\/\S+$/i.test(url)) { m.className = 'imp-msg bad'; m.textContent = 'Please enter a complete link starting with https://.'; return; }
    if (/(^|\.)(zillow|redfin|realtor|trulia|homes|movoto)\.(com)$/i.test(new URL(url).hostname)) {
      m.className = 'imp-msg'; m.innerHTML = 'This portal does not allow automated fetching. Quick alternatives: print the listing to PDF and drop it above – or use the <strong>one-click import</strong> or paste the text under "More ways".';
      const d = root.querySelector('.ox-more'); if (d) d.open = true; return;
    }
    if (!token()) { m.className = 'imp-msg bad'; m.innerHTML = 'Please <a class="ck-link" href="/auth/login">sign in</a> to import by link – or upload the listing as a PDF.'; return; }
    const w = work('Reading the link', ['Fetch link', 'Read text', 'Take over key facts', 'Calculate metrics']);
    try {
      await w.step(0);
      const r = await fetch('/api/expose-link', { method: 'POST', headers: { Authorization: 'Bearer ' + token(), 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw Error(j.error || 'The link could not be read.'); }
      await w.step(1);
      let listing;
      if ((r.headers.get('content-type') || '').includes('application/pdf')) {
        const t = await exposeText(await r.blob());
        if (t.replace(/\s+/g, '').length < 150) throw Error('The linked PDF contains no readable text (probably a scan).');
        listing = { u: url, t, ti: '' };
      } else { const j = await r.json(); listing = { u: j.u || url, t: j.t, ti: j.ti, j: j.j }; }
      await w.step(2);
      const ok = importListing(listing);
      await w.step(3);
      if (ok) { $('ox_url').value = ''; await w.done('Metrics calculated'); } else w.close();
    } catch (err) { w.close(); m.className = 'imp-msg bad'; m.textContent = err.message; }
  });
}

// Metrics engine: typed result (ExposeMetricsResult) from the current key facts.
function renderMetrics() {
  const box = $('ox_metrics'); if (!box) return;
  const hg = num('a_hg');
  const zip = (val('a_addr').match(/\b\d{5}\b/) || [''])[0];
  const r = exposeMetrics({
    title: val('a_addr') || 'Property', address: { zip, city: val('a_addr').replace(/\b\d{5}(-\d{4})?\b/, '').trim(), state: val('a_land') },
    purchasePrice: num('a_price'), livingAreaSqm: num('a_area'), monthlyColdRent: num('a_rent'), monthlyHausgeld: hg, monthlyMaintenanceReserve: 0,
    nonAllocatableCosts: num('a_nonrec'), constructionYear: num('a_year'), energyClass: '', energyValueKwh: 0,
  }, { equity: num('a_eq'), ratePct: num('a_z'), termYears: num('a_t') || 30, repaymentPct: undefined, fixedYears: num('a_fix'), brokerPct: num('a_broker') });
  if (!r) { box.innerHTML = ''; return; }
  const m = r.metrics, ic = m.incidentalCosts, fq = m.financingQuickCheck, sr = m.sanitationRisk;
  const k = (l, v, cls = '') => `<div class="an-chip ${cls}"><small>${l}</small><strong>${v}</strong></div>`;
  const risk = { LOW: ['ok', 'low'], MEDIUM: ['warn', 'medium'], HIGH: ['bad', 'high'] }[sr.riskLevel] || ['na', '–'];
  box.innerHTML = `<h3>Metrics from the listing</h3>
    <div class="an-chips">${k('Price per sq ft', m.pricePerSqm ? E(m.pricePerSqm) : '–')}${k('Rent per sq ft', m.rentPerSqm ? E2(m.rentPerSqm) : '–')}${k('Gross rent multiplier', m.purchaseMultiplier ? D(m.purchaseMultiplier, 1) : '–')}${k('Gross rental yield', m.grossRentalYieldPercent ? P(m.grossRentalYieldPercent) : '–')}${k('Cap rate on cost', m.netRentalYieldPercent ? P(m.netRentalYieldPercent) : '–')}
    ${k('Principal & interest', E2(fq.calculatedMonthlyRate))}${k('Cash flow before tax', E2(fq.monthlyPreTaxCashflow), num('a_rent') ? (fq.monthlyPreTaxCashflow >= 0 ? 'ok' : 'bad') : 'na')}${k('DSCR (target ≥ 1.25)', fq.dscrValue ? D(fq.dscrValue) : '–', tone(fq.dscrValue || null, 1.25, 1))}${k('Loan-to-value', fq.ltvPercent ? P(fq.ltvPercent, 1) : '–', fq.ltvPercent > 80 ? 'warn' : '')}${k('Payment at +2% rate', fq.stressTestRateDelta ? '+ ' + E2(fq.stressTestRateDelta) : '–', 'warn')}</div>
    ${hg ? '<p class="form-note">HOA dues found: they are included in the cash flow. Ask for the HOA budget and reserve study before you make an offer.</p>' : ''}<div class="ox-two">${table([['Transfer tax (' + esc(GREST[val('a_land')]?.name || '') + ')', E(ic.propertyTransferTax)], ['Title, settlement and recording', E(ic.notaryAndRegistry)], ['Buyer\'s agent', E(ic.brokerCommission)], ['<strong>Closing costs total</strong>', `<strong>${E(ic.totalIncidentalCosts)}</strong>`], ['<strong>Total investment</strong>', `<strong>${E(ic.totalInvestment)}</strong>`]])}
    <div class="ox-risk ${risk[0]}"><small>Repair risk</small><strong>${risk[1]}</strong><span>${num('a_year') ? `Built ${num('a_year')}` : 'Year built unknown'}${num('a_year') && num('a_year') < 1978 ? ' · pre-1978: lead-based paint disclosure required' : ''}</span>${sr.recommendedSanitationBuffer ? `<span>Suggested repair budget: <b>${E(sr.recommendedSanitationBuffer)}</b> (assumption by age, not an inspection)</span>` : '<span>Get a home inspection before the inspection period ends.</span>'}</div></div>`;
}

// Create the property analysis PDF: returns { blob, filename } or, for email, { sentTo }.
export async function analysePdf(mail = false) {
  if (!last) throw Error('No analysis yet – please enter a purchase price first.');
  const { a } = last;
  const body = { title: last.ort || 'Property analysis', subtitle: last.subtitle, url: last.url, chips: last.chips, sections: last.sections, hints: a.hints, email: mail };
  const r = await fetch('/api/analyse-pdf', { method: 'POST', headers: { Authorization: 'Bearer ' + token(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Error(j.error || 'The PDF could not be created.'); }
  if (mail) return r.json();
  const cd = r.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(cd);
  return { blob: await r.blob(), filename: m ? decodeURIComponent(m[1] || m[2]) : 'LeaseRun_DealRadar.pdf' };
}

// AutoPilot: take data from a listing/link (listing) or a filled form (values) and calculate.
// Returns a short summary; throws if no purchase price can be found.
export function autoAnalyse({ listing, values } = {}) {
  let r = null;
  if (listing) {
    r = importListing(listing);
    if (!r) throw Error('No purchase price found in the listing. Please use a single for-sale listing or enter the numbers manually.');
  } else if (values) {
    ['a_url', 'a_addr', 'a_price', 'a_area', 'a_rooms', 'a_year', 'a_rent', 'a_vq', 'a_nonrec', 'a_hg', 'a_rl', 'a_kwh'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
    for (const [id, v] of Object.entries(values)) {
      const el = $(id); if (!el) continue;
      if (el.type === 'checkbox') el.checked = Boolean(v);
      else if (el.tagName === 'SELECT') { const opt = [...el.options].find((o) => o.value === String(v) || o.textContent.trim() === String(v)); if (opt) el.value = opt.value; }
      else el.value = v;
    }
    updateAnalyse();
    if (!last) throw Error('The form is missing the purchase price.');
    keepCurrent({});
  }
  if (!last) throw Error('No analysis possible.');
  const { a } = last;
  return { name: last.ort || 'Property', price: a.price, rent: a.rent, grossYield: a.grossYield, netYield: a.netYield, cashflow: a.cashflow, cashflowAfterTax: a.cashflowAfterTax, dscr: a.dscr,
    nebenkosten: a.nebenkosten, found: r?.found || [], missing: r?.missing || (a.rent ? [] : ['Rent']), land: GREST[val('a_land')]?.name || '' };
}

function bindActions() {
  $('a_print').onclick = () => window.print();
  $('a_keep').onclick = () => { if (keepCurrent()) $('a_msg').textContent = ' Saved to the list (in this browser only).'; };
  const sendPdf = async (mail) => {
    if (!last) return;
    const b = $(mail ? 'a_mail' : 'a_pdf'); b.disabled = true; $('a_msg').textContent = '';
    const w = work(mail ? 'Sending DealRadar' : 'Creating DealRadar', ['Collect metrics', 'Create PDF', mail ? 'Send email' : 'Show document']);
    try {
      await w.step(0); await w.step(1);
      const out = await analysePdf(mail);
      await w.step(2);
      if (mail) { await w.done('Sent'); $('a_msg').textContent = ` Sent to ${out.sentTo || 'your email address'}.`; }
      else { await w.done('Done'); showPdf(out.blob, { filename: out.filename, title: 'DealRadar · ' + (last?.ort || 'Property analysis') }); }
    } catch (e) { w.close(); $('a_msg').textContent = ' ' + e.message; }
    b.disabled = false;
  };
  if ($('a_mail')) $('a_mail').onclick = () => sendPdf(true);
  if ($('a_pdf')) $('a_pdf').onclick = () => sendPdf(false);
  $('a_save').onclick = () => {
    if (!last) return; const { a, ort } = last;
    const nk = kaufnebenkosten({ price: a.price, land: val('a_land'), brokerPct: num('a_broker') });
    const rent = num('a_rent');
    const o = { name: (ort || 'Property from analysis').slice(0, 160), price: a.price, rent: a.rent, area: num('a_area'), yearBuilt: num('a_year'), equity: num('a_eq'), interestPct: num('a_z'), termYears: num('a_t') || 30,
      fixedYears: num('a_fix'), loan: Math.round(a.loan), nonRecoverable: num('a_nonrec'), maintenance: Math.round((num('a_mqm') / 100) * (rent || a.rent || 0) * 100) / 100, vacancyPct: num('a_vac'), mgmtPct: num('a_mg'),
      taxesAnnual: a.taxesM != null ? Math.round(a.taxesM * 12) : num('a_rl'), insuranceAnnual: a.insuranceM != null ? Math.round(a.insuranceM * 12) : num('a_kwh'), hoaMonthly: num('a_hg'),
      ownerOccupied: val('a_ec') === 'owner', units: val('a_art') === 'MFH' ? 2 : 1, propertyType: val('a_art'), land: val('a_land'), state: GREST[val('a_land')]?.abbr || '',
      purchaseCostPct: nk ? nk.totalPct : 0, grestPct: GREST[val('a_land')]?.pct ?? 0, brokerPct: num('a_broker'), buildingSharePct: num('a_bs'), marginalTaxPct: num('a_tax'),
      vergleichsmieteQm: num('a_vq'), mietpreisbremse: $('a_mpb').checked, liegenschaftszinsPct: num('a_lz'), restnutzungsdauer: num('a_rnd') };
    if (ONSAVE) { const b = $('a_save'); b.disabled = true; $('a_msg').textContent = ' Saving …'; Promise.resolve(ONSAVE({ ...o, source: last.url || '' })).then((ok) => { $('a_msg').textContent = ok ? ' Saved – below under "My properties".' : ' Could not save.'; }).catch(() => { $('a_msg').textContent = ' Could not save – please try again.'; }).finally(() => { b.disabled = false; }); return; }
    try { localStorage.setItem(PENDING, JSON.stringify({ ...o, source: '/internal/web-admin', at: Date.now() })); location.href = '/app/dashboard'; } catch { alert('Saving in the browser is not possible.'); }
  };
}

// Save the current analysis to the list; the same listing (same URL) is updated instead of duplicated.
function keepCurrent(meta = {}) {
  if (!last) return false; const { a, ort } = last;
  const ins = {}; root.querySelectorAll('.an input, .an select').forEach((el) => { ins[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  const list = readList();
  const prev = last.url ? list.find((x) => x.url === last.url) : null;
  const cap = a.capRate ?? (a.price ? (a.noi * 12 / a.price) * 100 : null);
  const item = { id: prev?.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), name: meta.name || ort || prev?.name || 'Property without address', url: last.url,
    portal: meta.portal ?? prev?.portal ?? '', title: meta.title ?? prev?.title ?? '', missing: meta.missing ?? (a.rent ? [] : ['Rent']), inputs: ins,
    k: { price: a.price, area: num('a_area') || null, rooms: num('a_rooms') || null, rent: a.rent || null, pqm: a.pricePerQm, factor: cap, gross: a.grossYield, net: a.netYield, cf: a.cashflow, cfat: a.cashflowAfterTax, dscr: a.dscr, minCap: a.cashToClose ?? a.nebenkosten, rate: a.rate } };
  writeList([item, ...list.filter((x) => x.id !== item.id)].slice(0, 100)); renderList();
  return true;
}

// Import a listing: only property fields are replaced; financing and tax stay as set.
const OBJ_FIELDS = ['a_url', 'a_addr', 'a_hg', 'a_rl', 'a_kwh', 'a_price', 'a_area', 'a_rooms', 'a_year', 'a_rent', 'a_vq', 'a_nonrec', 'a_lv', 'a_lz', 'a_rnd'];
function importListing(d) {
  const msg = $('imp_msg');
  const r = parseListing(d);
  if (r.price == null) {
    msg.className = 'imp-msg bad';
    msg.innerHTML = `No purchase price found${r.url ? ` on <a class="ck-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer nofollow">this page</a>` : ''}. Please open a <strong>single for-sale listing</strong> (not the search results) – or enter the numbers in the analysis below.`;
    return null;
  }
  OBJ_FIELDS.forEach((id) => { const el = $(id); if (el) el.value = ''; });
  if ($('a_mpb')) $('a_mpb').checked = false;
  const set = (id, v) => { if (v != null && v !== '' && $(id)) $(id).value = v; };
  const place = r.street ? `${r.street}, ${r.city}${r.state ? ', ' + r.state : ''}${r.plz ? ' ' + r.plz : ''}` : [r.city, r.state, r.plz].filter(Boolean).join(' ');
  set('a_url', r.url); set('a_addr', place || r.title); set('a_price', r.price); set('a_area', r.area); set('a_rooms', r.rooms);
  set('a_year', r.year); set('a_rent', r.rent); set('a_broker', r.brokerPct); set('a_art', r.art);
  set('a_hg', r.hausgeld); set('a_rl', r.taxesAnnual);
  const sk = r.state && stateKey(r.state); if (sk && $('a_land')) $('a_land').value = sk;
  updateAnalyse();
  keepCurrent({ name: r.name, portal: r.portal, title: r.title, missing: r.missing });
  msg.className = 'imp-msg ok';
  msg.innerHTML = `<strong>Imported${r.portal ? ` from ${esc(r.portal)}` : ''}:</strong> ${esc(r.found.join(', '))}.` +
    (r.missing.length ? ` <strong>Not found:</strong> ${esc(r.missing.join(', '))}${r.missing.includes('Rent') ? ' – without rent, returns and cash flow are not meaningful; enter the expected market rent in the analysis' : ''}.` : '') +
    (r.hausgeld ? ` HOA dues ${E(r.hausgeld)}/month are included in the cash flow.` : '') +
    ` State for closing costs and taxes: ${esc(GREST[val('a_land')]?.name || '')}${sk ? '' : ' – please check'}.` +
    (r.warnings.length ? ` <strong>${esc(r.warnings.join(' '))}</strong>` : '');
  ($('m_list') || $('a_bar'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return r;
}

// Read a listing PDF in the browser (pdf.js, served locally). The file never leaves the device.
const PDFJS = '/vendor/pdfjs-4.10.38/';
export async function exposeText(file) {
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

// Load a property from the account into the analysis (automatic property analysis); optionally straight to PDF/email.
const LOAD_KEY = 'lr-analyse-load';
export function loadFromObject(o) {
  const set = (id, v) => { const el = $(id); if (!el || v === undefined || v === null || v === '') return; if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v; };
  ['a_url', 'a_addr', 'a_price', 'a_area', 'a_rooms', 'a_year', 'a_rent', 'a_vq', 'a_nonrec', 'a_lv', 'a_lz', 'a_rnd', 'a_hg', 'a_rl', 'a_kwh'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
  set('a_addr', o.name); set('a_price', o.price); set('a_area', o.area); set('a_year', o.yearBuilt); set('a_ec', o.ownerOccupied ? 'owner' : '');
  set('a_rent', o.rent); set('a_vq', o.vergleichsmieteQm); set('a_mpb', o.mietpreisbremse); set('a_vac', o.vacancyPct); set('a_mg', o.mgmtPct); set('a_nonrec', o.nonRecoverable);
  set('a_hg', o.hoaMonthly); set('a_rl', o.taxesAnnual); set('a_kwh', o.insuranceAnnual);
  if (Number(o.maintenance) > 0 && Number(o.rent) > 0) set('a_mqm', Math.round((o.maintenance / o.rent) * 1000) / 10);
  set('a_eq', o.equity); set('a_z', o.interestPct); set('a_t', o.termYears); set('a_fix', o.fixedYears); set('a_bs', o.buildingSharePct);
  set('a_tax', o.marginalTaxPct); set('a_lz', o.liegenschaftszinsPct); set('a_rnd', o.restnutzungsdauer); set('a_broker', o.brokerPct);
  if (o.propertyType && TYPE[o.propertyType]) set('a_art', o.propertyType); else if (Number(o.units) > 1) set('a_art', 'MFH');
  const sk = GREST[o.land] ? o.land : stateKey(o.state); if (sk && $('a_land')) $('a_land').value = sk;
  updateAnalyse();
}
function checkAnalyseLoad() {
  let job = null;
  try { job = JSON.parse(sessionStorage.getItem(LOAD_KEY) || 'null'); sessionStorage.removeItem(LOAD_KEY); } catch { job = null; }
  if (!job || !job.o) return;
  loadFromObject(job.o);
  $('a_bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (job.then === 'pdf') $('a_pdf')?.click();
  if (job.then === 'mail') $('a_mail')?.click();
}

const IMPORT_KEY = 'lr-import';
function checkImport() {
  const m = location.hash.match(/[?&]import=([^&]*)/);
  if (m) { try { sessionStorage.setItem(IMPORT_KEY, m[1]); } catch { /* no storage */ } history.replaceState(null, '', location.pathname + location.search + (location.pathname.startsWith('/app/') ? '#objekte' : '#suche')); }
  let raw = m ? m[1] : null;
  try { raw = raw || sessionStorage.getItem(IMPORT_KEY); sessionStorage.removeItem(IMPORT_KEY); } catch { /* no storage */ }
  if (!raw) return;
  try { const d = JSON.parse(decodeURIComponent(raw)); if (d && typeof d === 'object') importListing({ u: d.u, ti: d.ti, t: d.t, j: d.j }); }
  catch { $('imp_msg').className = 'imp-msg bad'; $('imp_msg').textContent = 'The import was incomplete. Please click "＋ To LeaseRun" on the listing again.'; }
}

const readList = () => { try { return JSON.parse(localStorage.getItem(LIST) || '[]'); } catch { return []; } };
const writeList = (l) => { try { localStorage.setItem(LIST, JSON.stringify(l)); } catch { /* no storage */ } };
function renderList() {
  const box = $('m_list'); if (!box) return;
  const l = readList();
  const cnt = $('m_count'); if (cnt) cnt.textContent = l.length ? `${l.length} propert${l.length === 1 ? 'y' : 'ies'}` : '';
  if (!l.length) { box.innerHTML = '<p class="form-note">No listings yet. Import one above with "＋ To LeaseRun" or fill in an analysis and choose "Add to list".</p>'; return; }
  const sortKey = box.dataset.sort || 'at', dir = box.dataset.dir === 'asc' ? 1 : -1;
  const val2 = (x) => (sortKey === 'at' ? x.at : x.k?.[sortKey]);
  const rows = [...l].sort((x, y) => { const a = val2(x), b = val2(y); if (a == null) return 1; if (b == null) return -1; return (a > b ? 1 : a < b ? -1 : 0) * dir; });
  const best = (k, hi) => { const v = l.map((x) => x.k?.[k]).filter((x) => x != null); return v.length > 1 ? (hi ? Math.max(...v) : Math.min(...v)) : null; };
  const noRent = (x) => !x.k?.rent;
  const cell = (x, k, f, hi, needsRent) => { if (needsRent && noRent(x)) return '<span class="ml-na">–</span>'; const v = x.k?.[k]; const b = best(k, hi); return v == null ? '–' : v === b ? `<strong class="ml-best">${f(v)}</strong>` : f(v); };
  const tn = (v, good, warn, hi = true) => (v == null ? '' : hi ? (v >= good ? 'ok' : v >= warn ? 'warn' : 'bad') : (v <= good ? 'ok' : v <= warn ? 'warn' : 'bad'));
  const COLS = [['name', 'Property'], ['url', 'Listing'], ['price', 'Price'], ['pqm', '$/sq ft'], ['rent', 'Rent'], ['factor', 'Cap rate'], ['gross', 'Gross'], ['cf', 'CF pre-tax'], ['cfat', 'CF after tax'], ['dscr', 'DSCR'], ['minCap', 'Cash to close'], ['', '']];
  const th = COLS.map(([k, t]) => (k && k !== 'name' && k !== 'url' ? `<th><button class="ml-sort${sortKey === k ? ' on' : ''}" data-sort="${k}" type="button">${t}${sortKey === k ? (dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>` : `<th>${t}</th>`)).join('');
  box.innerHTML = `<div class="ml-wrap"><table class="ml-table"><thead><tr>${th}</tr></thead><tbody>${rows.map((x) => `<tr>
    <td class="ml-name" data-l="Property"><strong>${esc(x.name)}</strong>${x.title && x.title !== x.name ? `<small>${esc(x.title)}</small>` : ''}<small>${x.portal ? esc(x.portal) + ' · ' : ''}${new Date(x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${x.missing?.length ? ` · <span class="ml-na">missing: ${esc(x.missing.join(', '))}</span>` : ''}</small></td>
    <td data-l="Listing" class="ml-url">${x.url ? `<a class="ml-link" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(x.url)}">${esc(x.portal || 'Listing')}<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a><small>${esc(x.url.replace(/^https:\/\/(www\.)?/, '').slice(0, 42))}${x.url.length > 50 ? '…' : ''}</small>` : '–'}</td>
    <td data-l="Price">${cell(x, 'price', E, false)}</td>
    <td data-l="$/sq ft">${cell(x, 'pqm', E, false)}</td><td data-l="Rent">${x.k?.rent ? E(x.k.rent) : `<button class="text-btn ml-na" data-load="${x.id}" type="button">Enter rent</button>`}</td>
    <td data-l="Cap rate" class="t-${tn(x.k?.factor, 7, 5)}">${cell(x, 'factor', (v) => P(v, 1), true, true)}</td><td data-l="Gross">${cell(x, 'gross', (v) => P(v), true, true)}</td>
    <td data-l="CF pre-tax" class="t-${noRent(x) ? '' : tn(x.k?.cf, 0, -100)}">${cell(x, 'cf', E2, true, true)}</td><td data-l="CF after tax" class="t-${noRent(x) ? '' : tn(x.k?.cfat, 0, -100)}">${cell(x, 'cfat', E2, true, true)}</td>
    <td data-l="DSCR" class="t-${noRent(x) ? '' : tn(x.k?.dscr, 1.25, 1)}">${cell(x, 'dscr', (v) => D(v), true, true)}</td><td data-l="Cash to close">${cell(x, 'minCap', E, false)}</td>
    <td class="ml-act"><button class="text-btn" data-load="${x.id}" type="button">Edit</button> <button class="text-btn del" data-drop="${x.id}" type="button" aria-label="Remove ${esc(x.name)}">Remove</button></td></tr>`).join('')}</tbody></table></div>
  <p class="form-note">Bold: best value in the list. Color: cap rate ≥ 7% / cash flow ≥ $0 / DSCR ≥ 1.25 green (LeaseRun assumptions). Sort by column headers. Financing (cash, rate, term) applies as set in the analysis. The list is stored in this browser only.</p>`;
  box.querySelectorAll('[data-sort]').forEach((b) => b.onclick = () => { const k = b.dataset.sort; box.dataset.dir = box.dataset.sort === k && box.dataset.dir !== 'asc' ? 'asc' : 'desc'; box.dataset.sort = k; renderList(); });
  box.querySelectorAll('[data-drop]').forEach((b) => b.onclick = () => { writeList(readList().filter((x) => x.id !== b.dataset.drop)); renderList(); });
  box.querySelectorAll('[data-load]').forEach((b) => b.onclick = () => {
    const x = readList().find((y) => y.id === b.dataset.load); if (!x) return;
    Object.entries(x.inputs).forEach(([id, v]) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') el.checked = v; else el.value = v; });
    updateAnalyse(); $('a_bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// Builds import, analysis and list into a container. opts.pdf: offer the analysis PDF.
export function mountObjekt(container, opts = {}) {
  root = container;
  PROF = opts.profile || {};
  APPMODE = Boolean(opts.app); ONSAVE = opts.onSave || null;
  root.insertAdjacentHTML('beforeend', APPMODE ? `${renderImport()}${renderAnalyse()}` : `<h2 class="is-h">Property &amp; document import</h2>${renderImport()}${renderAnalyse()}<section class="dash-card ml-card"><div class="ml-head"><h2>Imported properties</h2><span class="form-note" id="m_count"></span></div><div id="m_list"></div></section>`);
  // Analysis sections open only when tapped; only one is open at a time.
  root.querySelectorAll('details.an-sec').forEach((dt) => dt.addEventListener('toggle', () => {
    if (!dt.open) return;
    root.querySelectorAll('details.an-sec[open]').forEach((o) => { if (o !== dt) o.open = false; });
    requestAnimationFrame(() => { const top = dt.getBoundingClientRect().top + window.scrollY - (document.querySelector('.app-top,.site-header')?.offsetHeight || 0) - 10; if (dt.getBoundingClientRect().top < 0 || dt.getBoundingClientRect().top > innerHeight * 0.6) window.scrollTo({ top, behavior: 'smooth' }); });
  }));
  // HOA dues mainly for condos/townhomes, but single-family homes can have an HOA too – the field stays visible for all types.
  const bm = $('imp_bm');
  if (bm) {
    bm.href = bookmarklet(location.origin);
    bm.addEventListener('click', (e) => { e.preventDefault(); $('imp_msg').className = 'imp-msg'; $('imp_msg').textContent = 'Don\'t click it here – drag the button to your bookmarks bar. Then open a listing on the portal and click the bookmark there.'; });
  }
  $('imp_pdf')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const msg = $('imp_msg');
    if (f.size > 40 * 1024 * 1024) { msg.className = 'imp-msg bad'; msg.textContent = 'The file is larger than 40 MB.'; return; }
    msg.className = 'imp-msg'; msg.textContent = '';
    const w = work('Reading the listing', ['Open file', 'Read text', 'Take over key facts', 'Calculate metrics']);
    try {
      await w.step(0); await w.step(1);
      const t = await exposeText(f);
      if (t.replace(/\s+/g, '').length < 150) { w.close(); msg.className = 'imp-msg bad'; msg.textContent = 'This listing has no readable text (probably a scanned document). Please enter the numbers in the analysis below.'; return; }
      await w.step(2);
      const ok = importListing({ u: $('imp_url')?.value.trim() || '', t, ti: f.name.replace(/\.pdf$/i, '') });
      await w.step(3);
      if (ok) await w.done('Analysis ready'); else w.close();
    } catch (err) { w.close(); msg.className = 'imp-msg bad'; msg.textContent = 'The listing could not be read (damaged or password-protected).'; console.warn(err); }
  });
  $('imp_go')?.addEventListener('click', () => {
    const t = $('imp_text').value.trim(), u = $('imp_url').value.trim();
    if (!t) { $('imp_text').focus(); return; }
    if (importListing({ u, t, ti: '' })) { $('imp_text').value = ''; $('imp_url').value = ''; }
  });
  if (window.__iaImport) window.removeEventListener('hashchange', window.__iaImport);
  window.__iaImport = () => { if (/[?&]import=/.test(location.hash)) checkImport(); if (/^#(suche|objekte)/.test(location.hash)) setTimeout(checkAnalyseLoad, 0); };
  window.addEventListener('hashchange', window.__iaImport);
  if (!opts.pdf) { $('a_pdf')?.remove(); $('a_mail')?.remove(); }
  // v2: US field meanings (old German inputs must not be reused).
  const KEY = 'lr-objekt-v2';
  try { localStorage.removeItem('lr-objekt-v1'); } catch { /* no storage */ }
  const ids = [...root.querySelectorAll('.an input, .an select')].map((e) => e.id).filter(Boolean);
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); ids.forEach((id) => { if (s[id] !== undefined) { const el = $(id); if (el.type === 'checkbox') el.checked = s[id]; else el.value = s[id]; } }); } catch { /* no storage */ }
  const save = () => { try { const o = {}; ids.forEach((id) => { const el = $(id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }); localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* no storage */ } };
  root.addEventListener('input', (e) => { if (!e.target.id) return; if (e.target.id.startsWith('a_')) updateAnalyse(); save(); });
  root.addEventListener('change', (e) => { if (e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') return; updateAnalyse(); save(); });
  bindActions(); bindImport(); updateAnalyse(); renderList(); checkImport(); checkAnalyseLoad();
}
