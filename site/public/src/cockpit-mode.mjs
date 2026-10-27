// Cockpit per mode (consumer area):
//  Beginner – affordability gauge (DTI), maximum home price, PITIA, cash to close, closing-cost check, monthly budget.
//  Pro      – Return radar, 10-year wealth curve, scenarios for vacancy and rate after an ARM reset / refinance.
// When signed in there are no sample numbers: everything uses the customer's financial profile and properties; if
// something is missing, a hint is shown. US logic: fully amortizing loans (default 30-year fixed), PITIA, DTI, DSCR.
// Self-contained math (does not depend on the calculator library) so the widget stays stable.

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : Number(x).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }));
const P = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : `${Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
// Accepts "1,234.56", "1234.56" and "$1,234".
const n = (v) => { const x = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : 0; };

// US states + DC (stored as the two-letter code in profile.state).
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

// Planning assumptions (shown to the user). Not a loan offer.
const A = { rate: 0.065, years: 30, taxPct: 1.1, insPct: 0.5, closingPct: 3, front: 28, back: 43, minDownPct: 3.5 };

// Monthly principal & interest for a fully amortizing loan.
export function payment(loan, ratePa, years = 30) {
  if (!(loan > 0)) return 0;
  const r = ratePa / 12, m = years * 12;
  return r > 0 ? (loan * r) / (1 - Math.pow(1 + r, -m)) : loan / m;
}
// Remaining balance after k months.
function balanceAfter(loan, ratePa, years, k) {
  if (!(loan > 0)) return 0;
  const r = ratePa / 12, pmt = payment(loan, ratePa, years);
  if (!(r > 0)) return Math.max(0, loan - pmt * k);
  return Math.max(0, loan * Math.pow(1 + r, k) - pmt * ((Math.pow(1 + r, k) - 1) / r));
}

// Terms in plain words (tooltip on tap and focus).
const TIPS = {
  pitia: 'PITIA = principal, interest, property taxes, homeowners insurance and HOA dues – what you actually pay every month.',
  dti: 'Debt-to-income ratio (DTI): your monthly debts including the new housing payment, divided by gross monthly income. Many lenders look for 43% or less.',
  closing: 'Closing costs: lender fees, appraisal, title insurance, escrow/settlement, recording fees, transfer taxes (state/local) and prepaid taxes and insurance. Typically 2–5% of the price.',
  cash: 'Cash to close = down payment + closing costs. Lenders also like to see reserves left over afterward.',
  pmi: 'With less than 20% down on a conventional loan, lenders usually require private mortgage insurance (PMI), which adds to the monthly payment.',
};
export const tip = (k, label) => `<span class="tipw">${label}<button type="button" class="tip" aria-label="What does ${esc(label)} mean?" data-tip="${esc(TIPS[k])}">?</button></span>`;

// Semicircle gauge: 0–60% DTI (green up to 36, yellow up to 43, red above).
function tacho(pct) {
  const p = Math.max(0, Math.min(60, pct ?? 0)), ang = Math.PI * (1 - p / 60);
  const x = 100 + 78 * Math.cos(ang), y = 100 - 78 * Math.sin(ang);
  const arc = (a0, a1, c) => { const s = Math.PI * (1 - a0 / 60), e = Math.PI * (1 - a1 / 60); return `<path d="M${100 + 86 * Math.cos(s)} ${100 - 86 * Math.sin(s)} A86 86 0 0 1 ${100 + 86 * Math.cos(e)} ${100 - 86 * Math.sin(e)}" stroke="${c}" stroke-width="16" fill="none"/>`; };
  return `<svg viewBox="0 0 200 118" class="tacho" role="img" aria-label="Debt-to-income ${pct == null ? 'unknown' : Math.round(pct) + '% of gross income'}">
    ${arc(0, 36, '#22C55E')}${arc(36, 43, '#F59E0B')}${arc(43, 60, '#EF4444')}
    ${pct == null ? '' : `<line x1="100" y1="100" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#0F2C59" stroke-width="5" stroke-linecap="round"/><circle cx="100" cy="100" r="8" fill="#0F2C59"/>`}
  </svg>`;
}

// Monthly housing cost (PITIA) for a price, down payment and HOA.
function pitia(price, cash, hoa) {
  const closing = (price * A.closingPct) / 100;
  const down = Math.max(0, Math.min(price, cash - closing));
  const loan = Math.max(0, price - down);
  const pi = payment(loan, A.rate, A.years);
  const ti = (price * (A.taxPct + A.insPct)) / 100 / 12;
  return { closing, down, loan, pi, ti, total: pi + ti + hoa };
}
// Highest price where PITIA stays within the front-end (28%) and back-end (43%) limits and the minimum down payment is covered.
function maxPrice(gross, debts, cash, hoa) {
  const cap = Math.min((gross * A.front) / 100, (gross * A.back) / 100 - debts);
  if (!(cap > 0)) return 0;
  let lo = 0, hi = 5_000_000;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2, x = pitia(mid, cash, hoa);
    const okCash = cash >= (mid * A.closingPct) / 100 + (mid * A.minDownPct) / 100;
    if (x.total <= cap && okCash) lo = mid; else hi = mid;
  }
  return Math.floor(lo / 1000) * 1000;
}

// ---------------- Beginner ----------------
export function mountEinsteiger(box, { d, save }) {
  const pr = d.profile || {};
  const st = STATES[pr.state] ? pr.state : '';
  box.innerHTML = `<section class="cm cm-ein" aria-label="My budget">
    <h4 class="sc-h">My budget at a glance</h4>
    <div class="cm-in">
      <label>Gross monthly income ($)<input id="cm_net" inputmode="decimal" value="${n(pr.netIncome) || ''}" placeholder="before taxes"></label>
      <label>Monthly debt payments ($)<input id="cm_out" inputmode="decimal" value="${pr.expenses === undefined || pr.expenses === '' ? '' : n(pr.expenses)}" placeholder="car, student loans, cards …"></label>
      <label>Cash available ($)<input id="cm_eq" inputmode="decimal" value="${pr.equity === undefined || pr.equity === '' ? '' : n(pr.equity)}" placeholder="for down payment and closing"></label>
      <label>Target price ($, optional)<input id="cm_tp" inputmode="decimal" value="${n(pr.targetPrice) || ''}"></label>
      <label>HOA dues ($/month)<input id="cm_wk" inputmode="decimal" value="${n(pr.housingCosts) || ''}" placeholder="0 if none"></label>
      <label>State<select id="cm_land"><option value="">please choose</option>${Object.entries(STATES).map(([k, name]) => `<option value="${k}"${k === st ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
    </div>
    <div id="cm_out_box" aria-live="polite"></div>
    <p class="form-note">Assumptions: ${P(A.rate * 100, 2)} interest rate, ${A.years}-year fixed, property tax ${P(A.taxPct)} and insurance ${P(A.insPct)} of the price per year, closing costs about ${A.closingPct}% (varies by state and county), limits ${A.front}% housing / ${A.back}% total ${tip('dti', 'DTI')}. For planning only – not a loan offer or pre-approval.</p>
  </section>`;
  const $ = (id) => box.querySelector('#' + id);
  let t = 0;
  const calc = () => {
    const gross = n($('cm_net').value), debts = n($('cm_out').value), cash = n($('cm_eq').value), tp = n($('cm_tp').value), hoa = n($('cm_wk').value), state = $('cm_land').value;
    const o = $('cm_out_box');
    if (!gross || !state || $('cm_out').value === '') { o.innerHTML = `<p class="cm-empty">Enter your gross income, monthly debts and state to see your range. ${$('cm_eq').value === '' ? 'Add your available cash too.' : ''}</p>`; return; }
    const max = maxPrice(gross, debts, cash, hoa);
    const price = tp > 0 ? tp : max;
    const x = pitia(price, cash, hoa);
    const dti = gross > 0 ? ((x.total + debts) / gross) * 100 : null;
    const downPct = price > 0 ? (x.down / price) * 100 : 0;
    const surplus = gross - debts - x.total;
    const lamp = downPct >= 20 ? ['ok', '20%+ down, no PMI'] : downPct >= A.minDownPct ? ['warn', 'covered, PMI likely'] : ['bad', 'not covered'];
    const zone = dti == null ? ['', '–'] : dti <= 36 ? ['ok', 'Comfortable'] : dti <= 43 ? ['warn', 'Tight'] : ['bad', 'Over the limit'];
    const w = Math.max(1, gross);
    o.innerHTML = `<div class="cm-grid">
      <div class="cm-tacho ${zone[0]}">${tacho(dti)}<strong>${zone[1]}</strong><small>${dti == null ? '' : `${Math.round(dti)}% debt-to-income`}</small></div>
      <div class="cm-kpis">
        <div class="cm-k"><small>Maximum home price</small><strong>${E(max)}</strong><span>with your income and cash</span></div>
        <div class="cm-k"><small>${tip('pitia', 'Monthly PITIA')}</small><strong>${E(x.total)}</strong><span>${tp > 0 ? 'for your target price' : 'at the maximum price'}</span></div>
        <div class="cm-k"><small>${tip('cash', 'Cash to close')}</small><strong>${E(x.closing + Math.max(x.down, (price * A.minDownPct) / 100))}</strong><span>at least · 20% down: ${E(x.closing + price * 0.2)}</span></div>
        <div class="cm-k ${lamp[0]}"><small>${tip('closing', 'Closing costs')}</small><strong>${E(x.closing)}</strong><span><i class="amp ${lamp[0]}"></i> Down payment ${E(x.down)} (${P(downPct, 0)}) · ${lamp[1]}</span></div>
      </div></div>
      <div class="cm-hh" aria-label="Monthly budget"><small>Monthly budget (gross)</small>
        <div class="cm-bar"><span class="b-out" style="width:${Math.min(100, (debts / w) * 100)}%" title="Debts"></span><span class="b-wohn" style="width:${Math.min(100, (x.total / w) * 100)}%" title="Housing"></span><span class="b-rest ${surplus < 0 ? 'neg' : ''}" style="width:${Math.max(0, Math.min(100, (surplus / w) * 100))}%" title="Remaining"></span></div>
        <div class="cm-leg"><span><i class="b-out"></i>Debts ${E(debts)}</span><span><i class="b-wohn"></i>Housing ${E(x.total)}</span><span><i class="b-rest"></i>${surplus < 0 ? 'Shortfall' : 'Left (before taxes)'} ${E(Math.abs(surplus))}</span></div></div>
      <p class="form-note">Closing costs are an estimate for ${esc(STATES[state])}; transfer taxes, title and escrow fees differ by state and county. ${downPct < 20 ? tip('pmi', 'PMI') + ' is not included above.' : ''}</p>`;
    clearTimeout(t);
    t = setTimeout(() => save({ netIncome: gross, expenses: debts, equity: $('cm_eq').value === '' ? '' : cash, targetPrice: tp, housingCosts: hoa, state }), 600);
  };
  box.addEventListener('input', calc); box.addEventListener('change', calc);
  calc();
}

// ---------------- Pro ----------------
// Metrics per property (same idea as the portfolio): NOI, P&I, cash flow, DSCR, LTV, yield, price-to-rent.
function objMetrics(o) {
  const price = n(o.price), rent = n(o.rent), loan = n(o.loan), zi = n(o.interestPct) / 100, years = n(o.termYears) || 30;
  const noi = rent * (1 - n(o.vacancyPct) / 100) - n(o.nonRecoverable) - n(o.maintenance);
  const rate = payment(loan, zi, years);
  return { price, rent, loan, zi, years, noi, rate, cf: noi - rate, dscr: rate > 0 ? noi / rate : null, ltv: price > 0 ? (loan / price) * 100 : null, gross: price > 0 ? (rent * 12 / price) * 100 : null, cap: price > 0 ? (noi * 12 / price) * 100 : null, factor: rent > 0 ? price / (rent * 12) : null, fixed: n(o.fixedYears) || years };
}

// Return radar: five axes, each 0 (weak) to 1 (strong). Ranges are LeaseRun assumptions and are shown.
function radar(m) {
  const cl = (x) => Math.max(0, Math.min(1, x));
  const ax = [
    ['Gross yield', m.gross == null ? 0 : cl(m.gross / 10), P(m.gross)],
    ['DSCR', m.dscr == null ? 0 : cl((m.dscr - 0.8) / 0.7), m.dscr == null ? '–' : m.dscr.toFixed(2)],
    ['Cash flow', cl((m.cf + 500) / 1000), E(m.cf)],
    ['LTV', m.ltv == null ? 0 : cl((110 - m.ltv) / 60), m.ltv == null ? '–' : P(m.ltv, 0)],
    ['Price-to-rent', m.factor == null ? 0 : cl((20 - m.factor) / 12), m.factor == null ? '–' : m.factor.toFixed(1)],
  ];
  const c = 110, R = 78, pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / ax.length; return [c + r * Math.cos(a), c + r * Math.sin(a)]; };
  const ring = (f) => ax.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(',')).join(' ');
  const poly = ax.map(([, v], i) => pt(i, R * Math.max(0.04, v)).map((x) => x.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="0 0 220 220" class="radar" role="img" aria-label="Return radar">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}" class="rg"/>`).join('')}
    ${ax.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="rg"/>`; }).join('')}
    <polygon points="${poly}" class="rp"/>
    ${ax.map(([l, , v], i) => { const [x, y] = pt(i, R + 20); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="rl">${esc(l)}</text><text x="${x.toFixed(1)}" y="${(y + 11).toFixed(1)}" text-anchor="middle" class="rv">${esc(v)}</text>`; }).join('')}
  </svg>`;
}

// 10-year wealth curve: equity in the property = value − loan balance, plus cumulative cash flow (before taxes).
// After the fixed period (ARM) the payment is recalculated at the reset rate on the remaining balance and term.
function wealth(m, o, { growthPct = 0, vacancyPct = null, refiPct = null } = {}) {
  const years = [];
  let cum = 0;
  const vac = vacancyPct == null ? n(o.vacancyPct) : vacancyPct;
  const noi = m.rent * (1 - vac / 100) - n(o.nonRecoverable) - n(o.maintenance);
  let bal = m.loan, rate = m.rate;
  for (let y = 1; y <= 10; y++) {
    const inFixed = y <= m.fixed;
    if (!inFixed && y === m.fixed + 1 && refiPct != null && bal > 0) rate = payment(bal, refiPct / 100, Math.max(1, m.years - m.fixed));
    const zi = inFixed || refiPct == null ? m.zi : refiPct / 100;
    if (inFixed) bal = balanceAfter(m.loan, m.zi, m.years, y * 12);
    else if (bal > 0) { for (let k = 0; k < 12; k++) bal = Math.max(0, bal * (1 + zi / 12) - rate); }
    cum += (noi - rate) * 12;
    const value = m.price * Math.pow(1 + growthPct / 100, y);
    years.push({ y, eq: value - bal, cum, bal, value, cf: noi - rate });
  }
  return years;
}
function curve(ys) {
  const W = 320, H = 150, pad = 30;
  const vals = ys.map((x) => x.eq + x.cum);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const X = (i) => pad + (i * (W - pad - 8)) / (ys.length - 1), Y = (v) => H - 20 - ((v - lo) / (hi - lo || 1)) * (H - 40);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="wcurve" role="img" aria-label="Wealth after 10 years ${E(vals[vals.length - 1])}">
    <line x1="${pad}" x2="${W - 8}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" class="wz"/>
    <path d="${line} L${X(ys.length - 1).toFixed(1)} ${Y(lo).toFixed(1)} L${X(0).toFixed(1)} ${Y(lo).toFixed(1)} Z" class="wa"/><path d="${line}" class="wl"/>
    ${ys.map((x, i) => (i % 3 === 2 || i === 0 ? `<text x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="wt">Y${x.y}</text>` : '')).join('')}
    <text x="${X(ys.length - 1).toFixed(1)}" y="${(Y(vals[vals.length - 1]) - 6).toFixed(1)}" text-anchor="end" class="wv">${E(vals[vals.length - 1])}</text>
  </svg>`;
}

export function mountProfi(box, { d }) {
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => n(o.price) > 0);
  if (!objs.length) { box.innerHTML = '<p class="form-note pro-empty">Return radar, wealth curve and scenarios appear once a property with price, rent and loan is added. <a href="#suche">Import a listing</a></p>'; return; }
  box.innerHTML = `<section class="cm cm-pro" aria-label="Investment analysis">
    <div class="cm-pro-h"><h4 class="sc-h">Investment analysis</h4><label>Property<select id="cp_o">${objs.map((o, i) => `<option value="${i}">${esc(o.name || 'Property ' + (i + 1))}</option>`).join('')}</select></label></div>
    <div class="cm-pro-g"><div class="cm-card"><h5>Return radar</h5><div id="cp_radar"></div><p class="form-note">Outside = strong. Scales: gross yield up to 10%, DSCR 0.8–1.5, cash flow ±$500/month, LTV 50–110%, price-to-rent 8–20 (LeaseRun assumptions).</p></div>
    <div class="cm-card"><h5>Wealth in 10 years</h5><div id="cp_curve"></div><p class="form-note" id="cp_cn"></p></div></div>
    <div class="cm-card"><h5>Scenarios</h5><div class="cm-sl">
      <label>Appreciation per year<input id="cp_g" type="range" min="-2" max="6" step="0.5" value="3"><output id="cp_gv"></output></label>
      <label>Vacancy<input id="cp_v" type="range" min="0" max="25" step="1" value="5"><output id="cp_vv"></output></label>
      <label>Rate after ARM reset / refinance<input id="cp_r" type="range" min="3" max="11" step="0.25" value="7"><output id="cp_rv"></output></label>
    </div><div id="cp_sc" class="cm-sc"></div></div>
  </section>`;
  const $ = (id) => box.querySelector('#' + id);
  const run = () => {
    const o = objs[Number($('cp_o').value) || 0], m = objMetrics(o);
    const g = Number($('cp_g').value), v = Number($('cp_v').value), r = Number($('cp_r').value);
    $('cp_gv').textContent = P(g); $('cp_vv').textContent = P(v, 0); $('cp_rv').textContent = P(r, 2);
    $('cp_radar').innerHTML = radar(m);
    const base = wealth(m, o, { growthPct: g, vacancyPct: v, refiPct: r });
    const last = base[base.length - 1];
    $('cp_curve').innerHTML = curve(base);
    $('cp_cn').textContent = `Equity in the property ${E(last.eq)} + cumulative cash flow ${E(last.cum)} (before taxes). Loan balance after 10 years ${E(last.bal)}.`;
    const after = base.find((x) => x.y === Math.min(10, m.fixed + 1));
    const stress = payment(m.loan, m.zi + 0.02, m.years) - m.rate;
    // Break-even rate: highest rate at which NOI still covers P&I (binary search).
    let lo = 0, hi = 0.3; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (payment(m.loan, mid, m.years) <= m.noi) lo = mid; else hi = mid; }
    $('cp_sc').innerHTML = `<div class="cm-kpis">
      <div class="cm-k ${base[0].cf < 0 ? 'bad' : 'ok'}"><small>Cash flow with ${P(v, 0)} vacancy</small><strong>${E(base[0].cf)}</strong><span>per month, before taxes</span></div>
      <div class="cm-k ${after && after.cf < 0 ? 'bad' : 'ok'}"><small>Cash flow after the fixed period</small><strong>${after && m.fixed < 10 ? E(after.cf) : '–'}</strong><span>${m.fixed >= 10 ? `rate fixed for ${m.fixed >= m.years ? 'the full term' : `${m.fixed} years`}` : `at ${P(r, 2)} after the reset`}</span></div>
      <div class="cm-k warn"><small>Rate stress test +2 points</small><strong>+ ${E(stress)}</strong><span>extra payment per month</span></div>
      <div class="cm-k"><small>Break-even rate</small><strong>${m.loan > 0 && m.noi > 0 ? P(lo * 100, 2) : '–'}</strong><span>above this, cash flow turns negative</span></div></div>`;
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
}

// Tooltips: tap/click opens, outside closes.
if (!window.__iaTips) {
  window.__iaTips = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.tip');
    document.querySelectorAll('.tip-pop').forEach((p) => { if (!b || p.dataset.for !== b.dataset.tip) p.remove(); });
    if (!b) return;
    e.preventDefault();
    if (b.nextElementSibling?.classList.contains('tip-pop')) { b.nextElementSibling.remove(); return; }
    const p = document.createElement('span'); p.className = 'tip-pop'; p.setAttribute('role', 'tooltip'); p.dataset.for = b.dataset.tip; p.textContent = b.dataset.tip; b.after(p);
  });
}
