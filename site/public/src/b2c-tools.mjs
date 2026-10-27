// Software tools for consumers (view "Software tools"). Everything runs in the browser; inputs stay in this browser.
// Personalized: every tool starts with the numbers of the chosen property and the financial profile – no sample values.
// Plans: Free = basic tools · Buyer Pass = all purchase tools with print and templates · Investor Pro = additionally
// portfolio, refinance & rate lock, and expense pass-through. Beginner and Pro views differ in order, depth of explanation
// and expert logic (LTV/PMI, normalized loan comparison, tax effect, portfolio stress test).
// Unlocking in the browser is a convenience; all formulas are documented openly.
import * as C from './calc.mjs?v=892f3666';
const { monthlyRate, balanceAfterMonths, tilgungsplan, kaufnebenkosten, portfolio, GREST } = C;

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const E2 = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const P = (v, d = 2) => `${(Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
const D = (v, d = 2) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
// US input: "300,000", "3.55", "$1,234.56", "300000". European input ("300.000", "3,55") is still understood.
export const num = (v) => {
  let t = String(v ?? '').replace(/[$€%\s]/g, '').trim();
  if (!t) return 0;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  const x = Number(t);
  return Number.isFinite(x) ? x : 0;
};

// ---------- Loan math (US: fully amortizing, e.g. 30-year fixed) ----------
// Monthly P&I for a fully amortizing loan.
export const pmt = (loan, ratePct, years) => {
  if (!(loan > 0) || !(years > 0)) return 0;
  const r = ratePct / 100 / 12, n = Math.round(years * 12);
  return r > 0 ? (loan * r) / (1 - Math.pow(1 + r, -n)) : loan / n;
};
// Balance after m months of a fully amortizing loan.
export const balance = (loan, ratePct, years, m) => {
  if (!(loan > 0)) return 0;
  const r = ratePct / 100 / 12, p = pmt(loan, ratePct, years);
  if (r === 0) return Math.max(0, loan - p * m);
  const q = Math.pow(1 + r, m);
  return Math.max(0, loan * q - (p * (q - 1)) / r);
};
// Equivalent initial repayment rate (decimal) for a term – lets us reuse the calc.mjs amortization helpers.
const repayOf = (ratePct, years) => (typeof C.repaymentFromTerm === 'function' ? C.repaymentFromTerm(ratePct / 100, years) : (() => { const r = ratePct / 100; return years > 0 ? (pmt(100000, ratePct, years) * 12) / 100000 - r : 0; })());

// ---------- Calculation core (exported for tests) ----------
// Compare Loan Estimates over a horizon (default: years you expect to keep the loan): interest + points + lender fees,
// and the balance still owed at the end. Field names kept for callers: repay = loan term in years if > 3 (US),
// otherwise a legacy initial repayment rate in %; years = comparison horizon; fees = points + lender fees ($).
export function compareOffers(list) {
  const rows = list.filter((o) => o.loan > 0 && o.rate > 0 && o.repay > 0 && o.years > 0).map((o) => {
    const months = Math.round(o.years * 12);
    const term = o.repay > 3 ? o.repay : null;
    const pay = term ? pmt(o.loan, o.rate, term) : monthlyRate(o.loan, o.rate / 100, o.repay / 100);
    const rest = term ? balance(o.loan, o.rate, term, months) : balanceAfterMonths(o.loan, o.rate / 100, o.repay / 100, months);
    const interest = pay * months - (o.loan - rest);
    const cost = interest + (o.fees || 0);
    return { ...o, pay, rest, interest, cost, months };
  });
  if (!rows.length) return { rows, best: null, sameYears: true };
  const sameYears = rows.every((r) => r.years === rows[0].years);
  // Comparable: costs + remaining balance (what you pay until the horizon and still owe afterwards), per dollar borrowed.
  rows.forEach((r) => { r.score = (r.cost + r.rest) / r.loan; });
  const best = rows.reduce((a, b) => (b.score < a.score ? b : a));
  return { rows, best, sameYears };
}

// Refinance / ARM reset: balance, lead time, extended rate-lock rate and comparison with rate scenarios at the reset.
// surchargePerMonth = extra rate per month of lock beyond the free period (extended lock cost, percentage points).
// repay = remaining term in years if > 3 (US), otherwise a legacy repayment rate in %.
export function forwardCalc({ rest, monthsToEnd, todayRate, surchargePerMonth, repay, freeMonths = 0 }) {
  const lead = Math.max(0, monthsToEnd - freeMonths);
  const fwdRate = todayRate + surchargePerMonth * lead;
  const pay = (r) => (repay > 3 ? pmt(rest, r, repay) : monthlyRate(rest, r / 100, repay / 100));
  const scen = [-1, 0, 1, 2].map((d) => ({ d, rate: todayRate + d, pay: pay(Math.max(0, todayRate + d)) }));
  return { lead, fwdRate, fwdPay: pay(fwdRate), todayPay: pay(todayRate), scen, breakEven: fwdRate };
}

// Prepayment penalty window (US): most residential mortgages have none; where allowed (some non-QM/DSCR loans), it
// typically ends 3 years after funding (step-down 3-2-1). Returns the date from which prepaying is free and the
// date one year later for a 5-year schedule hint. Function name kept for callers.
export function kuendigungsrecht489(payout, years = 3) {
  if (!payout) return null;
  const d = new Date(payout);
  if (Number.isNaN(d.getTime())) return null;
  const from = new Date(d); from.setFullYear(from.getFullYear() + years);
  const end = new Date(d); end.setFullYear(end.getFullYear() + 5);
  return { from, end };
}

// Highest price at which a target monthly cash flow or a target cap rate is reached.
// costPct = operating expenses (taxes, insurance, HOA, management, repairs, vacancy) as % of rent;
// rate in %, repay = loan term in years (> 3) or legacy repayment rate in %; equity = cash for down payment + closing;
// nkPct = closing costs in % of price; targetYield = minimum cap rate (NOI ÷ price) in %.
export function maxPrice({ rent, costPct, equity, rate, repay, nkPct, targetCf, targetYield }) {
  const costs = rent * costPct / 100;
  const ann = repay > 3 ? (pmt(100000, rate, repay) * 12) / 100000 : (rate + repay) / 100;
  const byCf = ann > 0 ? (((rent - costs - targetCf) * 12) / ann + equity) / (1 + nkPct / 100) : 0;
  const noi = (rent - costs) * 12;
  const byYield = targetYield > 0 ? (costPct > 0 ? noi : rent * 12) / (targetYield / 100) : Infinity;
  return { byCf: Math.max(0, byCf), byYield, max: Math.max(0, Math.min(byCf, byYield)) };
}

// Expense pass-through (e.g. RUBS – ratio utility billing – or CAM reconciliation in small multifamily / commercial):
// split building costs by allocation key, subtract tenant prepayments. Keys: 'flaeche' = sq ft, 'personen' = occupants,
// 'einheit' = per unit, 'direkt' = 100 %. Check your state and lease before billing tenants.
export function betriebskosten({ rows, flaecheGesamt, flaecheMieter, personenGesamt, personenMieter, einheitenGesamt, monate = 12, vorauszahlung }) {
  const share = (k) => k === 'flaeche' ? (flaecheGesamt > 0 ? flaecheMieter / flaecheGesamt : 0) : k === 'personen' ? (personenGesamt > 0 ? personenMieter / personenGesamt : 0) : k === 'einheit' ? (einheitenGesamt > 0 ? 1 / einheitenGesamt : 0) : 1;
  const out = rows.filter((r) => r.betrag > 0).map((r) => ({ ...r, anteil: r.betrag * share(r.key) * (monate / 12) }));
  const summe = out.reduce((a, r) => a + r.anteil, 0);
  return { rows: out, summe, saldo: summe - vorauszahlung };
}

// Pro: make offers with different horizons comparable. Shorter horizons (e.g. an ARM's fixed period) are rolled forward
// at an assumed reset rate to the common horizon (longest one).
export function normalizeOffers(list, { anschlussRate = 0 } = {}) {
  const base = compareOffers(list);
  if (!base.rows.length) return { ...base, horizon: 0 };
  const H = Math.max(...base.rows.map((r) => r.years));
  const rows = base.rows.map((r) => {
    if (r.years >= H || !(anschlussRate > 0)) return { ...r, costH: r.cost, restH: r.rest, extra: 0 };
    const m = Math.round((H - r.years) * 12);
    const term = r.repay > 3 ? Math.max(1, r.repay - r.years) : null;
    const pay = term ? pmt(r.rest, anschlussRate, term) : monthlyRate(r.rest, anschlussRate / 100, r.repay / 100);
    const restH = term ? balance(r.rest, anschlussRate, term, m) : balanceAfterMonths(r.rest, anschlussRate / 100, r.repay / 100, m);
    const extra = pay * m - (r.rest - restH);
    return { ...r, costH: r.cost + extra, restH, extra };
  });
  rows.forEach((r) => { r.scoreH = (r.costH + r.restH) / r.loan; });
  const best = rows.reduce((a, b) => (b.scoreH < a.scoreH ? b : a));
  return { rows, best, sameYears: base.sameYears, horizon: H };
}

// Closing costs and financing structure (US). equity = cash available (down payment + closing costs).
// Pro: LTV against the appraised value (price minus an assumed appraisal gap), PMI for owner-occupied loans above 80% LTV.
// Field names kept for callers: blwAbschlagPct = appraisal gap %, blw = appraised value, bla = LTV on appraised value.
export function nkPlan({ price, land, brokerPct = 0, notaryPct, equity = 0, blwAbschlagPct = 0, ownerOccupied = true, pmiPct = 0.6 }) {
  const nk = notaryPct != null ? kaufnebenkosten({ price, land, notaryPct, brokerPct }) : kaufnebenkosten({ price, land, brokerPct });
  if (!nk) return null;
  const total = price + nk.total;
  const loan = Math.max(0, total - equity);
  const blw = price * (1 - blwAbschlagPct / 100);
  const ltv = price > 0 ? (loan / price) * 100 : 0;
  const bla = blw > 0 ? (loan / Math.min(price, blw)) * 100 : 0;
  const downPct = price > 0 ? Math.max(0, ((equity - nk.total) / price) * 100) : 0;
  return { nk, total, loan, ekQuote: total > 0 ? (equity / total) * 100 : 0, coversNk: equity >= nk.total, beyondNk: equity - nk.total,
    ltv, blw, bla, downPct, pmiMonthly: ownerOccupied && bla > 80 ? (loan * pmiPct) / 100 / 12 : 0 };
}

// Pro: is an extra principal payment better than an alternative investment? Mortgage interest on a rental is deductible
// (Schedule E), on a home only if you itemize – so prepaying "earns" the rate after tax. Alternative investment taxed at
// long-term capital gains + NIIT by default (taxable account, 18.8 %), or your own rate.
export function sondertilgungVergleich({ rate, taxPct = 0, vermietet = false, altRendite = 0, altTaxPct = 18.8 }) {
  const eff = vermietet ? rate * (1 - taxPct / 100) : rate;
  const altNet = altRendite * (1 - altTaxPct / 100);
  const altNoetig = eff / (1 - altTaxPct / 100);
  return { eff, altNet, altNoetig, lohnt: altRendite > 0 ? eff >= altNet : null };
}

// Pro: metrics at the asking price (GRM, cap rate, DSCR, break-even rate).
// faktor = gross rent multiplier (price ÷ annual rent); nar = cap rate on all-in cost (%).
export function preisKennzahlen({ asking, rent, costPct, equity, rate, repay, nkPct }) {
  if (!(asking > 0) || !(rent > 0)) return null;
  const costs = (rent * costPct) / 100;
  const loan = Math.max(0, asking * (1 + nkPct / 100) - equity);
  const pay = repay > 3 ? pmt(loan, rate, repay) : monthlyRate(loan, rate / 100, repay / 100);
  const noiY = (rent - costs) * 12;
  // Break-even interest rate: highest rate at which NOI still covers P&I (bisection).
  let breakEven = null;
  if (loan > 0) {
    if (repay > 3) { let lo = 0, hi = 30; if ((pmt(loan, hi, repay) * 12) < noiY) breakEven = hi; else if (pmt(loan, 0, repay) * 12 <= noiY) { for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (pmt(loan, mid, repay) * 12 <= noiY) lo = mid; else hi = mid; } breakEven = lo; } else breakEven = 0; }
    else breakEven = (noiY / loan) * 100 - repay;
  }
  return {
    faktor: asking / (rent * 12),
    nar: (noiY / (asking * (1 + nkPct / 100))) * 100,
    capRate: (noiY / asking) * 100,
    dscr: pay > 0 ? (rent - costs) / pay : null,
    breakEven,
    loan, pay, cf: rent - costs - pay,
  };
}

// ---------- Charts (SVG, no library) ----------
const COL = { navy: '#0F2C59', blue: '#0284C7', sky: '#7DD3FC', green: '#16A34A', amber: '#D97706', red: '#DC2626', grey: '#CBD5E1', ink: '#334155', muted: '#64748B', violet: '#7C3AED', teal: '#0D9488', rose: '#E11D48' };
const PART_COLORS = [COL.navy, COL.blue, COL.sky, COL.amber, COL.teal, COL.violet, COL.rose, COL.muted];
const kShort = (v) => (Math.abs(v) >= 1e6 ? `$${D(v / 1e6, 1)}M` : Math.abs(v) >= 1e4 ? `$${D(v / 1e3, 0)}K` : E(v));
// Horizontal bars as HTML (readable on mobile): [{ label, value, color }]
function chartBars(items, { title = '', fmt = E } = {}) {
  const rows = items.filter((i) => Number.isFinite(i.value));
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return `<figure class="tl-chart" role="img" aria-label="${esc(title || 'Bar chart')}">${title ? `<figcaption class="tl-ct">${esc(title)}</figcaption>` : ''}<div class="tl-bars">${rows.map((r) => `<div class="tl-bar"><span class="l">${esc(r.label)}</span><span class="t"><i style="width:${Math.max(1.5, (Math.abs(r.value) / max) * 100).toFixed(1)}%;background:${r.color || COL.blue}"></i></span><b>${esc(fmt(r.value))}</b></div>`).join('')}</div></figure>`;
}
// Lines over one axis (SVG): series [{ name, values, color, dash }], xs = x-axis labels.
function chartLines(series, { title = '', xs = [], fmt = kShort, marker = null, markerLabel = 'Rate reset' } = {}) {
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (!all.length) return '';
  const W = 420, H = 200, L = 62, R = 10, T = 10, B = 24;
  const max = Math.max(...all, 1) * 1.05, min = Math.min(0, ...all);
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : 0);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const grid = [0, 0.5, 1].map((f) => { const v = min + f * (max - min); return `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#E2E8F0"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" font-size="12" text-anchor="end" fill="${COL.muted}">${esc(fmt(v))}</text>`; }).join('');
  const step = Math.max(1, Math.ceil(n / 6));
  const xl = xs.map((t, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="12" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}" fill="${COL.muted}">${esc(t)}</text>` : '')).join('');
  const lines = series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''} points="${s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
  const mk = marker != null && marker < n ? `<line x1="${x(marker).toFixed(1)}" x2="${x(marker).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="${COL.amber}" stroke-dasharray="3 4"/>` : '';
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') + (mk ? `<span><i style="background:${COL.amber}"></i>${esc(markerLabel)}</span>` : '');
  return `<figure class="tl-chart">${title ? `<figcaption class="tl-ct">${esc(title)}</figcaption>` : ''}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || 'Line chart')}">${grid}${mk}${lines}${xl}</svg><div class="tl-legend">${legend}</div></figure>`;
}
// One stacked bar with legend (HTML): parts [{ label, value, color }]
function chartStack(parts, { title = '' } = {}) {
  const ok = parts.filter((p) => p.value > 0);
  const sum = ok.reduce((a, p) => a + p.value, 0);
  if (!(sum > 0)) return '';
  return `<figure class="tl-chart" role="img" aria-label="${esc(title || 'Breakdown')}">${title ? `<figcaption class="tl-ct">${esc(title)}</figcaption>` : ''}<div class="tl-stack">${ok.map((p) => `<i style="width:${((p.value / sum) * 100).toFixed(2)}%;background:${p.color}"></i>`).join('')}</div><div class="tl-legend">${ok.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${E(p.value)}</b> · ${D((p.value / sum) * 100, 0)}%</span>`).join('')}</div></figure>`;
}

// ---------- UI ----------
let CTX = { mode: 'einsteiger', tier: 'free', objId: 'eigen', prices: { pass: '$49 one-time', pro: '$29/month' } };
const LOCK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3Z"/></svg>';
const PRO = () => CTX.mode === 'profi';
const KEY = (tool) => `lr-tool3-${tool}-${CTX.objId}`;
const load = (tool, seed) => { try { const v = JSON.parse(localStorage.getItem(KEY(tool)) || 'null'); return v && typeof v === 'object' ? { ...seed, ...v } : { ...seed }; } catch { return { ...seed }; } };
const save = (tool, v) => { try { localStorage.setItem(KEY(tool), JSON.stringify(v)); } catch { /* no storage */ } };
const val = (v) => (v === '' || v == null || v === 0 ? '' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4, useGrouping: false }) : v);
const inp = (k, label, v, ph = '') => `<label>${label}<input data-f="${k}" type="text" inputmode="decimal" autocomplete="off" value="${esc(val(v))}"${ph ? ` placeholder="${esc(ph)}"` : ''}></label>`;
const txt = (k, label, v, ph = '') => `<label>${label}<input data-f="${k}" type="text" maxlength="80" value="${esc(v ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}></label>`;
const chk = (k, label, on) => `<label class="tl-chk"><input data-f="${k}" type="checkbox"${on ? ' checked' : ''}> ${label}</label>`;
const landSel = (k, v) => `<label>State<select data-f="${k}"><option value="">– choose –</option>${Object.entries(GREST).map(([id, g]) => `<option value="${id}"${id === v ? ' selected' : ''}>${esc(g.name)}${g.pct ? ` (${D(g.pct, 2)}% transfer tax)` : ''}</option>`).join('')}</select></label>`;
const read = (box, st) => { box.querySelectorAll('[data-f]').forEach((el) => { st[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; }); };
const need = (t) => `<p class="tl-need">${t}</p>`;
// Beginner: short explanation to expand. Pro: no explanations.
const why = (t) => (PRO() ? '' : `<details class="tl-why"><summary>What does this mean?</summary><p>${t}</p></details>`);
const facts = (list) => `<div class="tl-facts">${list.filter(Boolean).map(([k, v, s, tone]) => `<div${tone ? ` class="${tone}"` : ''}><small>${k}</small><strong>${v}</strong>${s ? `<span>${s}</span>` : ''}</div>`).join('')}</div>`;
const lockPrint = () => `<p class="tl-hint">${LOCK_SVG} Print, PDF and templates with the Buyer Pass (${esc(CTX.prices.pass)}) · <a href="#angebot">see plans</a></p>`;
const printBtn = (id, label = 'Print / save as PDF') => (CTX.print ? `<p class="tl-act"><button type="button" class="btn btn-outline" data-print="${id}">${label}</button></p>` : lockPrint());
// State slug from an object/profile: stored slug, a 2-letter code, or empty.
const stateOf = (v) => { const s = String(v || ''); if (GREST[s]) return s; const k = Object.keys(GREST).find((x) => String(GREST[x].abbr || '').toUpperCase() === s.toUpperCase()); return k || ''; };

// Start values from the chosen property and the financial profile (no made-up sample numbers).
function seed(d) {
  const p = d.profile || {}, o = CTX.obj || {};
  const price = num(o.price), rent = num(o.rent), equity = num(o.equity) || num(p.equity);
  const fixed = (num(o.taxesAnnual) + num(o.insuranceAnnual)) / 12 + num(o.hoaMonthly);
  const costs = num(o.nonRecoverable) + num(o.maintenance) + fixed + (rent * num(o.mgmtPct)) / 100 + (rent * num(o.vacancyPct)) / 100;
  return {
    price, rent, area: num(o.area), equity, land: stateOf(o.land || o.state || p.land || p.state), broker: num(o.brokerPct),
    loan: num(o.loan), rate: num(o.interestPct), term: num(o.termYears) || (num(o.interestPct) ? 30 : ''), years: num(o.fixedYears),
    costPct: rent > 0 && costs > 0 ? Math.round((costs / rent) * 1000) / 10 : '', tax: num(o.marginalTaxPct) || num(p.marginalTaxPct),
    payout: o.payoutDate || '', vermietet: rent > 0 && o.ownerOccupied !== true, owner: o.ownerOccupied === true, net: num(p.netIncome),
  };
}

// ---------- 1. Closing costs & cash to close (free) ----------
function nkTool(box, d) {
  const s0 = seed(d);
  const st = load('nk', { price: s0.price, land: s0.land, broker: s0.broker, equity: s0.equity, abschlag: 0, owner: s0.owner || !s0.vermietet });
  box.innerHTML = `<h3>Closing costs &amp; cash to close</h3><p class="form-note">${PRO() ? 'Closing costs by state, financing structure, LTV against the appraisal and PMI.' : 'What you pay on top of the price – and whether your cash covers it.'}</p>
    <div class="tl-grid">${inp('price', 'Purchase price ($)', st.price, 'e.g. from the listing')}${landSel('land', st.land)}${inp('broker', 'Buyer\'s agent you pay (%)', st.broker, '0 if the seller pays')}${inp('equity', 'Cash available ($)', st.equity, 'down payment + closing costs')}
    ${chk('owner', 'I will live in the home (owner-occupied)', st.owner)}${PRO() ? `${inp('abschlag', 'Appraisal gap: appraisal below price (%)', st.abschlag, '0 if it appraises at price')}` : ''}</div><div class="tl-out" aria-live="polite"></div>`;
  const run = () => {
    read(box, st); save('nk', st);
    const out = box.querySelector('.tl-out');
    const r = nkPlan({ price: num(st.price), land: st.land, brokerPct: num(st.broker), equity: num(st.equity), blwAbschlagPct: PRO() ? num(st.abschlag) : 0, ownerOccupied: Boolean(st.owner) });
    if (!r) { out.innerHTML = need('Please enter the purchase price and choose the state.'); return; }
    const parts = r.nk.parts.map((x, i) => ({ label: x.label.replace(/ \((estimate|typical)\)/i, ''), value: x.amount, color: PART_COLORS[i % PART_COLORS.length] }));
    const minDown = st.owner ? 3 : 15;
    out.innerHTML = facts([
      ['Closing costs', E(r.nk.total), P(r.nk.totalPct, 1) + ' of the price'],
      ['Total cost', E(r.total)],
      ['Loan needed', E(r.loan), num(st.equity) ? `Down payment ${P(r.downPct, 1)}` : 'no cash entered'],
      PRO() ? ['LTV', P(r.bla, 1), r.blw < num(st.price) ? `on appraised value ≈ ${E(r.blw)}` : 'on purchase price', r.bla > 97 ? 'bad' : r.bla > 80 ? 'warn' : 'ok'] : ['Cash covers closing costs', r.coversNk ? 'yes' : 'no', r.coversNk ? `+ ${E(r.beyondNk)} toward the down payment` : `${E(-r.beyondNk)} short`, r.coversNk ? 'ok' : 'bad'],
      r.pmiMonthly > 0 ? ['Estimated PMI', `${E(r.pmiMonthly)}/mo`, 'until you reach 20% equity', 'warn'] : null,
    ]) + chartStack(parts, { title: 'What the closing costs consist of' }) + chartStack([{ label: 'Your cash', value: Math.min(num(st.equity), r.total), color: COL.green }, { label: 'Loan', value: r.loan, color: COL.navy }], { title: 'How the purchase is financed' })
      + (PRO()
        ? `<p class="tl-verdict">LTV ${P(r.ltv, 1)} on the price${r.blw < num(st.price) ? `, ${P(r.bla, 1)} on the appraised value` : ''}. Lenders price in LTV tiers (best at 75% or below, PMI above 80% on owner-occupied loans). ${st.owner ? (r.bla > 97 ? 'Above 97% LTV conventional loans are usually not available (FHA allows 96.5%, VA/USDA up to 100%).' : r.bla > 80 ? `To reach 80% and avoid PMI you would need about ${E(r.loan - Math.min(num(st.price), r.blw) * 0.8)} more.` : 'You are at or below 80% – no PMI.') : (r.bla > 85 ? 'Investment-property loans usually need 15–25% down; this LTV will be hard to finance.' : r.bla > 75 ? 'At 75–85% LTV, investment loans are possible but cost more.' : 'You are in a good tier for an investment loan.')} An appraisal below the price means you cover the gap in cash; the gap here is an assumption.</p>`
        : `<p class="tl-verdict">${r.coversNk ? `<strong>Good position:</strong> your cash covers the closing costs and leaves ${E(r.beyondNk)} for the down payment (${P(r.downPct, 1)}).${r.downPct < minDown ? ` For ${st.owner ? 'a home you live in' : 'a rental'} lenders usually want at least ${minDown}% down.` : ''}` : `<strong>This is tight:</strong> your cash does not fully cover the closing costs. You need cash for the down payment and closing costs, plus some reserves; ask about seller credits.`}</p>`
          + why('Closing costs (transfer tax, title insurance, escrow and recording fees, lender fees, prepaid taxes and insurance) are paid in cash at closing and do not add value to the home. With 20% down on a home you live in, you avoid PMI; investment properties usually need 15–25% down.'));
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
}

// ---------- 2. Price check (free; offer letter with the Buyer Pass) ----------
function priceTool(box, d) {
  const s0 = seed(d);
  const st = load('price', { asking: s0.price, rent: s0.rent, costPct: s0.costPct || 40, equity: s0.equity, rate: s0.rate, term: s0.term || 30, land: s0.land, broker: s0.broker, targetCf: 0, targetYield: '' });
  box.innerHTML = `<h3>Price check</h3><p class="form-note">${PRO() ? 'Maximum price from target cash flow and minimum cap rate, metrics at the asking price.' : 'Up to which price does the property work for you – and how much room is there to negotiate?'}</p>
    <div class="tl-grid">${inp('asking', 'Asking price ($)', st.asking)}${inp('rent', 'Monthly rent ($)', st.rent)}${inp('equity', 'Cash available ($)', st.equity)}${inp('rate', 'Interest rate (%)', st.rate, 'from a Loan Estimate')}${inp('term', 'Loan term (years)', st.term)}${landSel('land', st.land)}
    ${inp('costPct', PRO() ? 'Operating expenses incl. taxes, insurance, vacancy (% of rent)' : 'Expenses: taxes, insurance, repairs, vacancy (% of rent)', st.costPct, 'often 35–50%')}${PRO() ? `${inp('broker', 'Buyer\'s agent you pay (%)', st.broker)}${inp('targetCf', 'Target cash flow / month ($)', st.targetCf)}${inp('targetYield', 'Minimum cap rate (%)', st.targetYield, 'optional')}` : `${inp('targetCf', 'How much should be left each month? ($)', st.targetCf, '0 = rent covers the payment')}`}</div>
    <div class="tl-out" aria-live="polite"></div>${CTX.print ? '<p class="tl-act"><button type="button" class="btn btn-outline" data-copy="1">Copy offer note for your agent</button></p>' : lockPrint()}`;
  let letter = '';
  const run = () => {
    read(box, st); save('price', st);
    const out = box.querySelector('.tl-out');
    const v = { asking: num(st.asking), rent: num(st.rent), costPct: num(st.costPct), equity: num(st.equity), rate: num(st.rate), repay: num(st.term) || 30, targetCf: num(st.targetCf), targetYield: PRO() ? num(st.targetYield) : 0 };
    if (!(v.rent > 0) || !(v.rate > 0)) { out.innerHTML = need('Please enter monthly rent and interest rate.'); return; }
    const nk = st.land ? kaufnebenkosten({ price: 100000, land: st.land, brokerPct: num(st.broker) }) : null; // without state: 3% flat
    const nkPct = nk ? nk.totalPct : 3;
    const r = maxPrice({ ...v, nkPct });
    const gap = v.asking - r.max;
    const offer = Math.floor(r.max / 1000) * 1000;
    const k = PRO() ? preisKennzahlen({ ...v, nkPct }) : null;
    letter = `Offer summary for my agent\n\nI would like to offer ${E(offer)}${v.asking ? ` (asking price ${E(v.asking)})` : ''}.\n\nReasoning: at a market rent of ${E(v.rent)} per month, operating expenses of about ${P(v.costPct, 0)} of rent (property taxes, insurance, repairs, vacancy) and closing costs of about ${P(nkPct, 1)}, the property only covers the mortgage up to this price.${v.asking ? ` At the asking price the gross yield is ${P((v.rent * 12) / v.asking * 100)}.` : ''}\n\nPlease keep the inspection, appraisal and financing contingencies in the offer.\n\nThank you.`;
    out.innerHTML = facts([
      ['Your maximum price', E(r.max), Number.isFinite(r.byYield) && r.byYield < r.byCf ? 'limited by minimum cap rate' : 'limited by cash flow'],
      v.asking ? [gap > 0 ? 'To negotiate' : 'Cushion', E(Math.abs(gap)), `${P(Math.abs(gap) / v.asking * 100, 1)} ${gap > 0 ? 'below asking' : 'below your maximum'}`, gap > 0 ? 'warn' : 'ok'] : null,
      k ? ['Gross rent multiplier', D(k.faktor, 1), `Cap rate ${P(k.capRate)}`] : null,
      k ? ['DSCR at asking price', k.dscr == null ? '–' : D(k.dscr), `Break-even rate ${k.breakEven == null ? '–' : P(k.breakEven)}`, k.dscr != null && k.dscr < 1 ? 'bad' : k.dscr != null && k.dscr < 1.25 ? 'warn' : 'ok'] : null,
    ]) + (v.asking ? chartBars([{ label: 'Asking price', value: v.asking, color: COL.grey }, { label: 'Max. price (cash flow)', value: r.byCf, color: COL.navy }, ...(Number.isFinite(r.byYield) ? [{ label: 'Max. price (cap rate)', value: r.byYield, color: COL.blue }] : [])], { title: 'Price comparison' }) : '')
      + `<p class="tl-verdict">${!v.asking ? 'Enter the asking price to see your room to negotiate.' : gap > 0 ? (gap / v.asking > 0.15 ? `<strong>At the asking price you miss your target by a wide margin.</strong> ${E(offer)} would be justified – sellers rarely accept such a large discount. ${PRO() ? 'Check rent upside (market rent, value-add) or more cash down.' : 'Rethink your targets or look for another property.'}` : `<strong>At the asking price it does not quite work.</strong> An offer around ${E(offer)} can be justified with the numbers.`) : '<strong>The asking price is within your range.</strong> Negotiating still pays off: every dollar less lowers your payment and closing costs.'}</p>`
      + why('The maximum price is the price at which rent minus expenses just covers the mortgage payment (plus the cash flow you want). Above it, you put money in every month.');
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
  box.querySelector('[data-copy]')?.addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(letter); e.target.textContent = 'Copied ✓'; } catch { /* no clipboard */ } });
}

// ---------- 3. Extra principal payments (free) ----------
function specialTool(box, d) {
  const s0 = seed(d);
  const st = load('special', { loan: s0.loan, rate: s0.rate, term: s0.term || 30, special: '', years: 10, vermietet: s0.vermietet, tax: s0.tax, alt: '' });
  box.innerHTML = `<h3>Extra principal payments</h3><p class="form-note">${PRO() ? 'Interest saved, payoff date and balance – and whether prepaying beats an alternative investment after tax.' : 'What happens if you pay extra principal every year?'}</p>
    <div class="tl-grid">${inp('loan', 'Loan amount ($)', st.loan)}${inp('rate', 'Interest rate (%)', st.rate)}${inp('term', 'Loan term (years)', st.term)}${inp('special', 'Extra principal per year ($)', st.special, 'e.g. one extra payment')}${inp('years', 'Compare balance after (years)', st.years)}
    ${PRO() ? `${inp('tax', 'Marginal tax rate (%)', st.tax)}${inp('alt', 'Alternative investment return before tax (%)', st.alt, 'optional')}${chk('vermietet', 'Property is a rental (interest deductible on Schedule E)', st.vermietet)}` : ''}</div><div class="tl-out" aria-live="polite"></div>`;
  const run = () => {
    read(box, st); save('special', st);
    const out = box.querySelector('.tl-out');
    const v = { loan: num(st.loan), rate: num(st.rate), term: num(st.term) || 30, special: num(st.special), years: Math.max(1, Math.round(num(st.years) || 10)) };
    const rp = repayOf(v.rate, v.term);
    const a = tilgungsplan({ loan: v.loan, ratePa: v.rate / 100, repaymentPa: rp, fixedYears: v.years });
    if (!a || !(v.rate > 0)) { out.innerHTML = need('Please enter loan amount, interest rate and loan term.'); return; }
    if (!(v.special > 0)) { out.innerHTML = need(`Enter a yearly amount – e.g. one extra monthly payment a year, here ${E(pmt(v.loan, v.rate, v.term))}. Most US mortgages have no prepayment penalty.`); return; }
    const b = tilgungsplan({ loan: v.loan, ratePa: v.rate / 100, repaymentPa: rp, fixedYears: v.years, specialPa: v.special });
    const restA = a.years[v.years - 1]?.balance ?? 0, restB = b.years[v.years - 1]?.balance ?? 0;
    const yA = a.months ? a.months / 12 : null, yB = b.months ? b.months / 12 : null;
    const n = Math.min(a.years.length, 40);
    const curve = (p) => [v.loan, ...Array.from({ length: n }, (_, i) => p.years[i]?.balance ?? 0)];
    const cmp = PRO() ? sondertilgungVergleich({ rate: v.rate, taxPct: num(st.tax), vermietet: st.vermietet, altRendite: num(st.alt) }) : null;
    out.innerHTML = facts([
      ['Interest saved', E(a.totalInterest - b.totalInterest), '', 'ok'],
      ['Paid off in', `${yB ? D(yB, 1) : '–'} instead of ${yA ? D(yA, 1) : '–'} years`],
      [`Balance after ${v.years} years`, E(restB), `instead of ${E(restA)}`],
      cmp ? ['Rate after tax', P(cmp.eff), st.vermietet ? 'interest deducted on Schedule E' : 'your home: no deduction assumed'] : null,
    ]) + chartLines([{ name: 'without extra payments', values: curve(a), color: '#94A3B8' }, { name: 'with extra payments', values: curve(b), color: COL.green }], { title: 'Loan balance over time', xs: Array.from({ length: n + 1 }, (_, i) => `Yr ${i}`), marker: v.years, markerLabel: 'Comparison year' })
      + (cmp
        ? `<p class="tl-verdict">Every extra dollar of principal earns a guaranteed ${P(cmp.eff)} per year. ${cmp.lohnt == null ? `An alternative investment would need more than ${P(cmp.altNoetig)} before tax to do better.` : cmp.lohnt ? `<strong>Prepaying wins:</strong> the alternative investment only returns ${P(cmp.altNet)} after tax.` : `<strong>The alternative investment is better on paper:</strong> ${P(cmp.altNet)} after tax – but with market risk; prepaying is risk-free.`} On a rental, prepaying also lowers the deductible interest in later years.</p>`
        : `<p class="tl-verdict">Check your note for a prepayment penalty (rare on standard home loans) and tell your servicer the extra amount goes to principal. Keep an emergency fund – money paid into the loan is hard to get back without refinancing or a HELOC.</p>`
          + why('An extra principal payment lowers the balance right away. Because interest is always charged on the balance, you pay less interest every month afterwards – and are debt-free sooner.'));
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
}

// ---------- 4. Compare Loan Estimates (Buyer Pass) ----------
function offersTool(box, d) {
  const s0 = seed(d);
  const blank = () => ({ bank: '', loan: s0.loan || '', rate: '', eff: '', repay: s0.term || 30, years: 7, fees: '' });
  const st = load('offers', { list: [blank(), blank(), blank()], anschluss: '' });
  const F = [['bank', 'Lender', 1], ['loan', 'Loan amount ($)'], ['rate', 'Interest rate (%)'], ['eff', 'APR (%)'], ['repay', 'Loan term (years)'], ['years', 'Years you expect to keep it'], ['fees', 'Points + lender fees ($)']];
  box.innerHTML = `<h3>Compare Loan Estimates</h3><p class="form-note">${PRO() ? 'Costs over your horizon plus remaining balance; ARMs are rolled forward at an assumed reset rate to the longest horizon.' : 'Enter the numbers from each Loan Estimate (page 2: points and origination charges). The comparison adds what you pay until you expect to sell or refinance and what you still owe then.'}</p>
    <div class="tl-offers">${st.list.map((o, i) => `<fieldset class="tl-off"><legend>Offer ${i + 1}</legend>${F.map(([k, l, t]) => `<label>${l}<input data-o="${i}" data-k="${k}" type="text" ${t ? 'maxlength="40"' : 'inputmode="decimal"'} value="${esc(val(o[k]))}"></label>`).join('')}</fieldset>`).join('')}</div>
    ${PRO() ? `<div class="tl-grid">${inp('anschluss', 'Assumed rate after an ARM reset (%) for shorter horizons', st.anschluss, 'e.g. today\'s rate + 1')}</div>` : ''}
    <div class="tl-out" aria-live="polite"></div>${printBtn('offers', 'Print comparison / save as PDF')}`;
  const run = () => {
    box.querySelectorAll('[data-o]').forEach((el) => { st.list[+el.dataset.o][el.dataset.k] = el.value; });
    const a = box.querySelector('[data-f="anschluss"]'); if (a) st.anschluss = a.value;
    save('offers', st);
    const out = box.querySelector('.tl-out');
    const list = st.list.map((o) => ({ ...o, loan: num(o.loan), rate: num(o.rate), eff: num(o.eff), repay: num(o.repay) || 30, years: num(o.years), fees: num(o.fees) }));
    const r = PRO() ? normalizeOffers(list, { anschlussRate: num(st.anschluss) }) : compareOffers(list);
    if (!r.rows.length) { out.innerHTML = need('Please enter at least one offer with loan amount, interest rate, loan term and years you expect to keep it.'); return; }
    const norm = PRO() && !r.sameYears && num(st.anschluss) > 0;
    out.innerHTML = `<div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Offer</th><th>P&amp;I / month</th><th>Interest over horizon</th><th>Points + fees</th><th>Balance at the end</th>${norm ? `<th>Cost + balance to yr ${r.horizon}</th>` : ''}</tr></thead><tbody>${r.rows.map((x) => `<tr class="${x === r.best ? 'best' : ''}"><td><strong>${esc(x.bank || 'Offer')}</strong><small>${P(x.rate, 3)} rate${x.eff ? ` · ${P(x.eff, 3)} APR` : ''} · ${x.repay}-yr · ${x.years} yrs</small></td><td>${E2(x.pay)}</td><td>${E(x.interest)}</td><td>${E(x.fees)}</td><td>${E(x.rest)}</td>${norm ? `<td>${E(x.costH + x.restH)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
      + chartBars(r.rows.map((x) => ({ label: x.bank || 'Offer', value: norm ? x.costH + x.restH : x.cost + x.rest, color: x === r.best ? COL.green : COL.navy })), { title: norm ? `Cost and balance through year ${r.horizon}` : 'Cost and balance at the end of your horizon' })
      + `<p class="tl-verdict">${r.best ? `<strong>Lowest total cost: ${esc(r.best.bank || 'Offer')}.</strong> ` : ''}${r.sameYears ? '' : norm ? `Shorter horizons are rolled forward at ${P(num(st.anschluss))} through year ${r.horizon} – the result depends on that assumption. ` : PRO() ? '<strong>Different horizons:</strong> enter a reset rate to compare the offers over the same period. ' : '<strong>Note:</strong> the horizons differ. Use the same number of years for every offer for a fair comparison. '}${PRO() ? 'Rate-lock length, lender credits, escrow requirements and third-party fees (title, appraisal) are on the Loan Estimate and are not priced here.' : 'Paying points only pays off if you keep the loan long enough.'}</p>`
      + why('Not just the rate counts: points lower the rate but cost cash up front. The comparison adds interest, points and lender fees and the balance you still owe – the smallest total wins for your horizon.');
  };
  box.addEventListener('input', run);
  run();
}

// ---------- 5. Prepare your lender meeting (Buyer Pass) ----------
const Q_EIN = [
  ['Rates and costs', ['What are the interest rate and APR – and for how many points?', 'How long is the rate lock, and what does an extension cost?', 'Is there a prepayment penalty?', 'Which lender fees are on page 2 of the Loan Estimate (origination, underwriting)?', 'Will you require an escrow account for taxes and insurance?']],
  ['How you review me', ['What credit score, DTI and down payment do you require for this loan?', 'How do you count my income (W-2, self-employed, 1099)?', 'How many months of reserves do I need after closing?', 'Which documents are still missing?']],
  ['After approval', ['When will I get a written conditional approval?', 'What could still change before the Closing Disclosure?']],
];
const Q_PRO = [
  ['Pricing and options', ['LLPAs: how do credit score and LTV tiers change the rate?', 'Lock period and float-down option?', 'Buy-down options (temporary 2-1 or permanent points)?', 'Prepayment penalty structure on DSCR loans (e.g. 3-2-1)?', 'Can rental income from a lease or appraisal (Form 1007) be used?']],
  ['Valuation and collateral', ['Appraisal: full appraisal or waiver, and how are comps chosen?', 'DSCR calculation: gross rent ÷ PITIA or NOI ÷ debt service?', 'Do you lend to an LLC? Personal guarantee required?', 'Seasoning requirements for a cash-out refinance?']],
  ['Portfolio and structure', ['How many financed properties do you allow (Fannie Mae limit 10)?', 'How are existing rentals counted (Schedule E, 75% of rent)?', 'Portfolio or blanket loan for additional purchases?']],
];
function bankTool(box, d) {
  const p = d.profile || {}, o = CTX.obj || {};
  const st = load('bank', {});
  const Q = PRO() ? Q_PRO : Q_EIN;
  const loan = num(o.loan);
  const f = [
    ['Gross monthly income', p.netIncome ? E(num(p.netIncome)) : 'not entered yet'],
    ['Cash available', p.equity ? E(num(p.equity)) : 'not entered yet'],
    p.creditScore ? ['Credit score', String(num(p.creditScore))] : null,
    CTX.obj ? ['Property', esc(o.name || 'Property'), o.price ? `Price ${E(num(o.price))}` : ''] : ['Properties in your account', String((d.objects || []).filter((x) => x && x.name).length)],
    loan ? ['Loan amount', E(loan), o.interestPct ? `${P(num(o.interestPct), 3)} · ${num(o.termYears) || 30}-year` : ''] : null,
  ];
  box.innerHTML = `<h3>Prepare your lender meeting</h3><p class="form-note">${PRO() ? 'Negotiation points beyond the rate – pricing adjustments, valuation, collateral, options.' : 'Your numbers, the right questions and room for the answers. Print it and take it along.'}</p>
    ${facts(f)}${!p.netIncome || !p.equity ? '<p class="form-note">Add missing details under <a href="#konto">Account › Financial profile</a>.</p>' : ''}
    ${Q.map(([h, qs], gi) => `<h4 class="tl-sub">${h}</h4><ol class="tl-q">${qs.map((q, qi) => { const k = (PRO() ? 'p' : 'e') + gi + '_' + qi; return `<li><label><span>${q}</span><input type="text" data-b="${k}" maxlength="200" placeholder="Lender's answer" value="${esc(st[k] || '')}"></label></li>`; }).join('')}</ol>`).join('')}
    <label class="tl-notes">Your notes<textarea data-b="notes" rows="3" maxlength="2000">${esc(st.notes || '')}</textarea></label>
    ${printBtn('bank', 'Print question sheet / save as PDF')}`;
  box.addEventListener('input', (e) => { const k = e.target.dataset.b; if (!k) return; st[k] = e.target.value; save('bank', st); });
}

// ---------- 6. Portfolio metrics (Investor Pro) ----------
function portfolioTool(box, d) {
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.name && num(o.price) > 0)
    .map((o) => ({ id: o.id, name: o.name, price: num(o.price), loan: num(o.loan), rent: num(o.rent), vacancyPct: num(o.vacancyPct), nonRecoverable: num(o.nonRecoverable) + (num(o.taxesAnnual) + num(o.insuranceAnnual)) / 12 + num(o.hoaMonthly) + (num(o.rent) * num(o.mgmtPct)) / 100, maintenance: num(o.maintenance), interestPct: num(o.interestPct), repaymentPct: num(o.termYears) ? repayOf(num(o.interestPct), num(o.termYears)) * 100 : num(o.repaymentPct), termYears: num(o.termYears), fixedYears: num(o.fixedYears) }));
  const st = load('portfolio', { shock: 2 });
  box.innerHTML = `<h3>Portfolio metrics</h3><p class="form-note">${PRO() ? 'All properties: NOI, debt service, DSCR, LTV and cash flow after a rate shock at ARM reset or refinance.' : 'How do your properties look together – and what happens if rates are higher when a loan resets?'}</p>
    <div class="tl-grid">${inp('shock', 'Rate shock at reset (percentage points)', st.shock)}</div><div class="tl-out" aria-live="polite"></div>${printBtn('portfolio')}`;
  const run = () => {
    read(box, st); save('portfolio', st);
    const out = box.querySelector('.tl-out');
    if (!objs.length) { out.innerHTML = need('Add at least one property with price, rent and loan under <a href="#objekte">Properties</a>.'); return; }
    const pf = portfolio(objs, { shockPp: num(st.shock) });
    const t = pf.total;
    out.innerHTML = facts([
      ['Cash flow / month', E2(t.cashflow), 'before tax', t.cashflow < 0 ? 'bad' : 'ok'],
      ['Total DSCR', t.dscr == null ? '–' : D(t.dscr), 'NOI ÷ debt service', t.dscr != null && t.dscr < 1 ? 'bad' : t.dscr != null && t.dscr < 1.25 ? 'warn' : 'ok'],
      ['Total LTV', t.ltv == null ? '–' : P(t.ltv, 1), `${E(t.loan)} on ${E(t.price)}`],
      t.afterCashflow != null ? ['Cash flow after rate shock', E2(t.afterCashflow), `+${D(num(st.shock), 1)} pts at reset`, t.afterCashflow < 0 ? 'bad' : 'ok'] : null,
    ]) + `<div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Property</th><th>NOI / month</th><th>P&amp;I</th><th>Cash flow</th><th>DSCR</th><th>LTV</th><th>after shock</th></tr></thead><tbody>${pf.rows.map((r) => `<tr><td><strong>${esc(r.name)}</strong><small>Gross yield ${r.grossYieldPct == null ? '–' : P(r.grossYieldPct)}</small></td><td>${E2(r.noiMonthly)}</td><td>${E2(r.rate)}</td><td>${E2(r.cashflow)}</td><td>${r.dscr == null ? '–' : D(r.dscr)}</td><td>${r.ltv == null ? '–' : P(r.ltv, 1)}</td><td>${r.after ? E2(r.after.cashflow) : '–'}</td></tr>`).join('')}</tbody></table></div>`
      + chartBars(pf.rows.flatMap((r) => [{ label: r.name, value: r.cashflow, color: r.cashflow < 0 ? COL.red : COL.green }, ...(r.after ? [{ label: '… after shock', value: r.after.cashflow, color: r.after.cashflow < 0 ? COL.red : COL.amber }] : [])]), { title: 'Cash flow per property (month)', fmt: E2 })
      + `<p class="tl-verdict">${pf.rows.filter((r) => r.after && r.after.cashflow < 0).length ? `<strong>${pf.rows.filter((r) => r.after && r.after.cashflow < 0).length} propert${pf.rows.filter((r) => r.after && r.after.cashflow < 0).length === 1 ? 'y turns' : 'ies turn'} cash-flow negative after the rate shock.</strong> Consider refinancing into a fixed rate or paying down principal before the reset.` : 'All properties still cover their payments after the assumed rate shock.'}${PRO() ? ' NOI = rent minus vacancy, taxes, insurance, HOA, management, other expenses and repairs; "after shock" uses the balance at the reset. Fixed-rate loans (no ARM period) are not shocked.' : ''}</p>`
      + why('DSCR shows how many times the rent after expenses covers the mortgage payment. Below 1.0 you add money every month; most DSCR lenders want 1.20–1.25 or more. The rate shock simulates a higher rate when an adjustable-rate loan resets or you refinance.');
  };
  box.addEventListener('input', run);
  run();
}

// ---------- 7. Refinance & rate lock (Investor Pro) ----------
function forwardTool(box, d) {
  const o = CTX.obj || {};
  const term = num(o.termYears) || 30;
  const yrs = num(o.fixedYears) > 0 && num(o.fixedYears) < 30 ? num(o.fixedYears) : 5;
  const restSeed = num(o.loan) > 0 && num(o.interestPct) > 0 ? Math.round(balance(num(o.loan), num(o.interestPct), term, yrs * 12)) : '';
  let mSeed = '';
  if (o.payoutDate) { const end = new Date(o.payoutDate); end.setMonth(end.getMonth() + yrs * 12); mSeed = Math.max(0, Math.round((end - Date.now()) / 2629800000)); }
  const st = load('fwd', { rest: restSeed, months: mSeed, today: '', sur: 0.02, free: 2, repay: Math.max(1, term - yrs), payout: o.payoutDate || '', costs: '' });
  box.innerHTML = `<h3>Refinance &amp; rate lock</h3><p class="form-note">${PRO() ? 'Extended-lock rate from lead time and cost per month, break-even against rate scenarios, refinance cost recovery.' : 'When does your fixed-rate period end – and is it worth locking a rate early or refinancing?'}</p>
    <div class="tl-grid">${inp('rest', 'Balance at reset / refinance ($)', st.rest)}${inp('months', 'Months until reset', st.months)}${inp('today', 'Today\'s rate (%)', st.today, 'current quote')}${inp('sur', 'Extended lock cost per month (rate points)', st.sur)}${inp('free', 'Lock months included at no cost', st.free)}${inp('repay', 'Remaining term (years)', st.repay)}${inp('costs', 'Refinance closing costs ($)', st.costs, 'optional, about 2–5%')}
    <label>Loan funded on<input data-f="payout" type="date" value="${esc(st.payout)}"></label></div>
    <div class="tl-out" aria-live="polite"></div>${printBtn('fwd')}`;
  const run = () => {
    read(box, st); save('fwd', st);
    const out = box.querySelector('.tl-out');
    const v = { rest: num(st.rest), months: num(st.months), today: num(st.today), sur: num(st.sur), free: num(st.free), repay: num(st.repay) || 25 };
    if (!(v.rest > 0) || !(v.today > 0)) { out.innerHTML = need('Please enter the balance, today\'s rate and the remaining term.'); return; }
    const r = forwardCalc({ rest: v.rest, monthsToEnd: v.months, todayRate: v.today, surchargePerMonth: v.sur, repay: v.repay, freeMonths: v.free });
    const k = kuendigungsrecht489(st.payout);
    const xs = [-1, 0, 1, 2, 3].map((dd) => v.today + dd);
    const cur = o.interestPct ? pmt(v.rest, num(o.interestPct), v.repay) : null;
    const saving = cur != null ? cur - r.todayPay : null;
    const be = num(st.costs) > 0 && saving > 0 ? Math.ceil(num(st.costs) / saving) : null;
    out.innerHTML = facts([['Rate with extended lock', P(r.fwdRate, 3), `${r.lead} months of extra lock`], ['Payment with locked rate', E2(r.fwdPay)], ['Payment at today\'s rate', E2(r.todayPay)], be ? ['Refinance break-even', `${be} months`, `saves ${E2(saving)}/mo vs. your current rate`, be <= 36 ? 'ok' : 'warn'] : null])
      + chartLines([{ name: 'Payment at the rate when the reset comes', values: xs.map((z) => pmt(v.rest, Math.max(0, z), v.repay)), color: COL.navy }, { name: 'Payment with locked rate (fixed)', values: xs.map(() => r.fwdPay), color: COL.green, dash: true }], { title: 'Monthly payment by rate at the reset', xs: xs.map((z) => P(z, 1)), fmt: (x) => E(x) })
      + `<p class="tl-verdict"><strong>Locking early pays off if the rate at the reset is above ${P(r.breakEven, 3)}.</strong> ${PRO() ? 'Extended locks usually require a non-refundable fee; if rates drop, ask about a float-down. ARM resets follow index + margin within the caps in your note.' : 'It protects you from rising rates – if they fall, you pay more than necessary.'}</p>`
      + (k ? `<p class="tl-verdict"><strong>Prepayment penalty:</strong> most home loans have none. If your loan has one (common on DSCR loans, e.g. 3-2-1), it typically ends on ${k.from.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}; on a 5-year schedule on ${k.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Check your note.</p>` : '')
      + why('A rate lock fixes today\'s rate for a future closing. Longer locks cost a little more per month. Refinancing pays off when the monthly savings recover the closing costs before you sell.');
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
}

// ---------- 8. Expense pass-through / utility billing (Investor Pro) ----------
function bkTool(box, d) {
  const o = CTX.obj || {};
  const DEF = [['Water / sewer', 'personen'], ['Trash', 'personen'], ['Common-area electric', 'einheit'], ['Landscaping', 'flaeche'], ['Snow removal', 'flaeche'], ['Pest control', 'einheit'], ['Common-area cleaning', 'einheit'], ['Property tax (NNN leases only)', 'flaeche'], ['Building insurance (NNN only)', 'flaeche'], ['Gas (shared meter)', 'flaeche']];
  const st = load('bk', { mieter: '', zeitraum: `${new Date().getFullYear() - 1}`, flaecheGesamt: '', flaecheMieter: num(o.area) || '', personenGesamt: '', personenMieter: '', einheitenGesamt: num(o.units) || '', monate: 12, vorauszahlung: '', rows: DEF.map(([t, key]) => ({ t, key, betrag: '' })) });
  const KEYS = [['flaeche', 'Square feet'], ['personen', 'Occupants'], ['einheit', 'Per unit'], ['direkt', 'Direct (100%)']];
  box.innerHTML = `<h3>Utility &amp; expense billing</h3><p class="form-note">Enter the building's costs and choose an allocation key – the tool splits them to your tenant (RUBS) and subtracts what they already paid. Only bill what the lease allows; several states and cities restrict utility billing (RUBS) – check your local rules.</p>
    <div class="tl-grid">${txt('mieter', 'Tenant', st.mieter)}${txt('zeitraum', 'Billing period', st.zeitraum)}${inp('monate', 'Months occupied', st.monate)}${inp('flaecheGesamt', 'Building square feet', st.flaecheGesamt)}${inp('flaecheMieter', 'Unit square feet', st.flaecheMieter)}${inp('personenGesamt', 'Occupants in building', st.personenGesamt)}${inp('personenMieter', 'Occupants in unit', st.personenMieter)}${inp('einheitenGesamt', 'Units', st.einheitenGesamt)}${inp('vorauszahlung', 'Tenant payments in the period ($)', st.vorauszahlung)}</div>
    <div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Expense</th><th>Building total ($)</th><th>Allocation key</th><th>Tenant share</th></tr></thead><tbody>${st.rows.map((r, i) => `<tr><td><input data-r="${i}" data-rk="t" type="text" maxlength="40" value="${esc(r.t)}"></td><td><input data-r="${i}" data-rk="betrag" type="text" inputmode="decimal" value="${esc(val(r.betrag))}"></td><td><select data-r="${i}" data-rk="key">${KEYS.map(([k, l]) => `<option value="${k}"${r.key === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td class="bk-a" data-a="${i}">–</td></tr>`).join('')}</tbody></table></div>
    <div class="tl-out" aria-live="polite"></div>${CTX.print ? '<p class="tl-act"><button type="button" class="btn btn-dark" data-bkprint="1">Print statement / save as PDF</button></p>' : ''}`;
  let res;
  const run = () => {
    read(box, st);
    box.querySelectorAll('[data-r]').forEach((el) => { st.rows[+el.dataset.r][el.dataset.rk] = el.value; });
    save('bk', st);
    const v = { rows: st.rows.map((r) => ({ ...r, betrag: num(r.betrag) })), flaecheGesamt: num(st.flaecheGesamt), flaecheMieter: num(st.flaecheMieter), personenGesamt: num(st.personenGesamt), personenMieter: num(st.personenMieter), einheitenGesamt: num(st.einheitenGesamt), monate: num(st.monate) || 12, vorauszahlung: num(st.vorauszahlung) };
    res = betriebskosten(v);
    v.rows.forEach((r, i) => { const x = res.rows.find((y) => y.t === r.t && y.betrag === r.betrag); const c = box.querySelector(`[data-a="${i}"]`); if (c) c.textContent = x ? E2(x.anteil) : '–'; });
    const out = box.querySelector('.tl-out');
    if (!res.rows.length) { out.innerHTML = need('Enter the building\'s costs and allocation data.'); return; }
    out.innerHTML = facts([['Tenant\'s share', E2(res.summe)], ['Already paid', E2(v.vorauszahlung)], [res.saldo >= 0 ? 'Balance due' : 'Credit to tenant', E2(Math.abs(res.saldo)), '', res.saldo >= 0 ? 'warn' : 'ok']])
      + chartBars(res.rows.map((r) => ({ label: r.t, value: r.anteil, color: COL.blue })), { title: 'Tenant share per expense', fmt: E2 })
      + '<p class="tl-verdict">Bill only expenses your lease allows, with the allocation method stated in the lease. Keep receipts available for the tenant. Rules differ by state and city.</p>';
    res.v = v;
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
  box.querySelector('[data-bkprint]')?.addEventListener('click', () => {
    if (!res?.rows.length) return;
    const w = window.open('', '_blank'); if (!w) return;
    const keyL = Object.fromEntries(KEYS), v = res.v;
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Expense statement ${esc(st.zeitraum)}</title><style>body{font:13.5px/1.5 system-ui,sans-serif;margin:28px;color:#0F172A}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #CBD5E1;padding:6px;text-align:left}td.r,th.r{text-align:right}h1{font-size:20px}.n{font-size:11px;color:#475569;margin-top:18px}</style></head><body>
      <h1>Utility &amp; expense statement ${esc(st.zeitraum)}</h1><p>Tenant: <strong>${esc(st.mieter || '–')}</strong> · ${D(v.flaecheMieter, 0)} of ${D(v.flaecheGesamt, 0)} sq ft · occupants ${v.personenMieter} of ${v.personenGesamt} · units ${v.einheitenGesamt} · ${v.monate} months</p>
      <table><tr><th>Expense</th><th class="r">Building total</th><th>Allocation</th><th class="r">Your share</th></tr>${res.rows.map((r) => `<tr><td>${esc(r.t)}</td><td class="r">${E2(r.betrag)}</td><td>${keyL[r.key]}</td><td class="r">${E2(r.anteil)}</td></tr>`).join('')}
      <tr><th colspan="3">Total of your share</th><th class="r">${E2(res.summe)}</th></tr><tr><td colspan="3">less payments made</td><td class="r">− ${E2(v.vorauszahlung)}</td></tr><tr><th colspan="3">${res.saldo >= 0 ? 'Balance due' : 'Credit'}</th><th class="r">${E2(Math.abs(res.saldo))}</th></tr></table>
      <p>Receipts are available on request.</p><p class="n">Prepared with LeaseRun on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Template only – not legal advice; check your lease and state and local rules.</p></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  });
}

function printBox(box, title) {
  const w = window.open('', '_blank');
  if (!w) return;
  const clone = box.cloneNode(true);
  clone.querySelectorAll('input,textarea,select').forEach((el) => { const s = document.createElement('span'); s.className = 'pv'; s.textContent = el.type === 'checkbox' ? (el.checked ? 'yes' : 'no') : el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text || '') : el.value || '—'; el.replaceWith(s); });
  clone.querySelectorAll('.tl-act,.tl-hint,.tl-why,.tl-need').forEach((el) => el.remove());
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} – LeaseRun</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#0F172A;margin:28px}h3{color:#0F2C59}table{border-collapse:collapse;width:100%}td,th{border:1px solid #CBD5E1;padding:6px;text-align:left}tr.best{background:#DCFCE7}label{display:block;margin:4px 0}.pv{font-weight:700;margin-left:6px}fieldset{border:1px solid #CBD5E1;margin:0 0 8px}small{display:block;color:#475569}.tl-facts{display:flex;gap:16px;flex-wrap:wrap}.tl-chart{margin:10px 0}.tl-chart svg{max-width:640px;width:100%}.tl-legend span{margin-right:12px}.tl-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}footer{margin-top:24px;font-size:11px;color:#64748B}</style></head><body>${clone.innerHTML}<footer>Prepared with LeaseRun on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Estimates for planning only – not lending, tax or legal advice.</footer></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

// ---------- Registry: plan and order per view ----------
// need: 'free' · 'pass' (Buyer Pass or Investor Pro) · 'pro' (Investor Pro)
const TOOLS = {
  nk: ['Closing costs & cash to close', 'free', 'What comes on top of the price and whether your cash is enough.', nkTool],
  price: ['Price check', 'free', 'Maximum price and room to negotiate.', priceTool],
  special: ['Extra principal payments', 'free', 'Interest saved and an earlier payoff.', specialTool],
  offers: ['Compare Loan Estimates', 'pass', 'Which offer costs the least over your horizon.', offersTool],
  bank: ['Prepare your lender meeting', 'pass', 'Your numbers, the right questions, room for answers.', bankTool],
  portfolio: ['Portfolio metrics', 'pro', 'All properties: cash flow, DSCR, LTV and rate shock.', portfolioTool],
  fwd: ['Refinance & rate lock', 'pro', 'Lock rate, break-even and refinance cost recovery.', forwardTool],
  bk: ['Utility & expense billing', 'pro', 'Split shared costs to tenants and bill them.', bkTool],
};
// Beginner: in purchase order (calculate, negotiate, lender). Pro: portfolio and metrics first.
const ORDER = {
  einsteiger: { main: ['nk', 'price', 'offers', 'bank', 'special'], more: ['portfolio', 'fwd', 'bk'] },
  profi: { main: ['portfolio', 'price', 'offers', 'fwd', 'special', 'bk'], more: ['nk', 'bank'] },
};
const PLAN_LINE = {
  free: (m) => m === 'profi' ? 'Free: closing costs, price check and extra principal payments. Loan Estimate comparison and lender meeting with the Buyer Pass; portfolio, refinance and expense billing with Investor Pro.' : 'Free: closing costs, price check and extra principal payments. Loan Estimate comparison, lender meeting, printing and offer notes with the Buyer Pass.',
  starter: () => 'Buyer Pass active: all purchase tools including printing and offer notes. Portfolio, refinance and expense billing with Investor Pro.',
  pro: () => 'Investor Pro active: all software tools without limits.',
};
const TICON = {
  nk: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h8"/>',
  price: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  special: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  offers: '<path d="M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2 10l10-6 10 6z"/>',
  bank: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  portfolio: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  fwd: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  bk: '<path d="M7 3h10v18l-3-2-2 2-2-2-3 2z"/><path d="M10 8h4M10 12h4"/>',
};
const RANK = { free: 0, pass: 1, pro: 2 };
const TIER_RANK = { free: 0, starter: 1, pro: 2 };

// "Calculate with: Example" – a ready-made sample rental the way a pro would set it up (clearly labeled as an example).
const EX_STATE = C.DEFAULT_STATE && GREST[C.DEFAULT_STATE] ? C.DEFAULT_STATE : (GREST.texas ? 'texas' : Object.keys(GREST)[0]);
const EX_OBJ = { id: 'beispiel', name: 'Example: 3-bed single-family rental (pro template)', price: 300000, rent: 2200, area: 1500, units: 1, equity: 85000, land: EX_STATE, brokerPct: 0,
  loan: 225000, interestPct: 7, termYears: 30, fixedYears: 0, nonRecoverable: 50, maintenance: 220, vacancyPct: 6, mgmtPct: 8, taxesAnnual: 5400, insuranceAnnual: 1800, hoaMonthly: 0, marginalTaxPct: 30, payoutDate: '' };
const EX_PROFILE = { equity: 85000, land: EX_STATE, marginalTaxPct: 30, netIncome: 9000 };

// Beginner: "How a pro would fill this in" – only on request, clearly labeled as an example;
// your own inputs are saved first and can be restored with one tap.
const PROFI_EX = {
  nk: { v: { price: 300000, land: EX_STATE, broker: 0, equity: 85000, owner: false }, tips: [
    'Price from the listing – but use the price check first to set your maximum.',
    'Always choose the state: transfer taxes range from 0 to over 2% depending on state and county.',
    'Buyer\'s agent: since 2024 you agree on this in writing; enter 0 if the seller pays it.',
    'Cash: for a rental plan on 20–25% down plus 2–5% closing costs and 6 months of reserves.'] },
  price: { v: { asking: 300000, rent: 2200, costPct: 45, equity: 85000, rate: 7, term: 30, land: EX_STATE, broker: 0, targetCf: 0, targetYield: '' }, tips: [
    'Rent from comparable rentals nearby (or the current lease) – never the optimistic "potential rent" from the listing.',
    'Expenses at 40–50% of rent cover taxes, insurance, repairs, capex, vacancy and management (the "50% rule").',
    'Rate from a current Loan Estimate plus a cushion – investment properties price about 0.5–0.75 points above home loans.',
    'Target "$0 left over": rent covers the payment. Anything above that is your room to negotiate.'] },
  special: { v: { loan: 240000, rate: 7, term: 30, special: 1600, years: 10, vermietet: false, tax: '', alt: '' }, tips: [
    'Take loan amount and rate exactly from your note or monthly statement.',
    'One extra payment a year (here about $1,600) cuts years off a 30-year loan.',
    'Build an emergency fund (3–6 months of expenses) first – prepaid principal is hard to get back.',
    'On a rental the interest is deductible, so prepaying often pays off less there.'] },
};

export async function mountTools(view, { d, tier = 'free', b2b = false, mode = 'einsteiger', features = {} }) {
  const m = mode === 'profi' ? 'profi' : 'einsteiger';
  const t = b2b ? 'pro' : ['starter', 'pro'].includes(tier) ? tier : 'free';
  // Remove old inputs once (earlier versions stored sample or German-format values).
  try { Object.keys(localStorage).filter((k) => k.startsWith('lr-tool-') || k.startsWith('lr-tool2-')).forEach((k) => localStorage.removeItem(k)); } catch { /* no storage */ }
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.name);
  let pick = null; try { pick = sessionStorage.getItem('lr-tool3-obj'); } catch { /* no storage */ }
  const demo = pick === 'beispiel';
  const sel = demo ? EX_OBJ : objs.find((o) => String(o.id) === pick) || (pick === 'eigen' ? null : objs.find((o) => num(o.price) > 0) || null);
  // Individual unlocks from the Web-Admin: "on" unlocks, "off" locks – otherwise the plan applies.
  const F = b2b ? {} : (features || {});
  CTX = { ...CTX, mode: m, tier: t, print: F.druck === 'on' || (F.druck !== 'off' && t !== 'free'), obj: sel, objId: demo ? 'beispiel' : sel ? String(sel.id || objs.indexOf(sel)) : 'eigen' };
  const dd = demo ? { ...d, profile: { ...(d.profile || {}), ...EX_PROFILE } } : d;
  try {
    const PR = await fetch('/data/preise.json').then((r) => r.json());
    const pl = Object.fromEntries((PR.privat?.plans || []).map((x) => [x.id, x]));
    const usd = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
    CTX.prices = { pass: pl['buyer-pass'] ? `${usd(pl['buyer-pass'].cents)} one-time` : CTX.prices.pass, pro: pl['pro-monthly'] ? `${usd(pl['pro-monthly'].cents)}/month` : CTX.prices.pro };
  } catch { /* default prices */ }
  const has = (id) => (F['t_' + id] === 'on' ? true : F['t_' + id] === 'off' ? false : TIER_RANK[t] >= RANK[TOOLS[id][1]]);
  const o = ORDER[m];
  const lockCard = (id) => { const [title, nd, desc] = TOOLS[id]; return `<h3>${esc(title)} <span class="tl-badge">${nd === 'pro' ? 'Investor Pro' : 'Buyer Pass'}</span></h3><p class="form-note">${esc(desc)}</p><p class="tl-hint">${LOCK_SVG} Included in ${nd === 'pro' ? `Investor Pro (${esc(CTX.prices.pro)})` : `the Buyer Pass (${esc(CTX.prices.pass)}) and Investor Pro`} · <a href="#angebot">See plans</a></p>`; };
  const sec = (id) => `<section class="tl-card${has(id) ? '' : ' tl-locked'}" id="t-${id}" hidden></section>`;
  const mainIds = [...o.main.filter(has), ...o.main.filter((id) => !has(id))];
  view.innerHTML = `<div class="tl-top"><div><h2 class="tl-h">Software tools</h2><p class="form-note">${m === 'profi' ? 'Metrics and expert logic: LTV and PMI, normalized Loan Estimate comparison, tax effect, portfolio stress test.' : 'Step by step through your purchase – every tool uses your own numbers and explains the result.'}</p></div><span class="tl-plan tl-plan-${t}">${t === 'pro' ? 'Investor Pro' : t === 'starter' ? 'Buyer Pass' : 'Free'}</span></div>
    <p class="tl-planline">${esc(PLAN_LINE[t](m))}</p>
    <div class="tl-base"><label>Calculate with<select id="tlObj"><option value="eigen"${sel ? '' : ' selected'}>Your own numbers (start empty)</option><option value="beispiel"${demo ? ' selected' : ''}>Example (pro template, prefilled)</option>${objs.map((x) => `<option value="${esc(String(x.id))}"${x === sel ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>${demo ? `<small class="tl-demo"><strong>Sample numbers</strong> – a 3-bed single-family rental for $300,000 in ${esc(GREST[EX_STATE]?.name || 'Texas')}, set up the way a pro would. Not your numbers: change them to try things out or choose "Your own numbers" above.</small>` : objs.length ? '<small>Values from your property and financial profile are used and can be adjusted in each tool.</small>' : '<small>No property yet – <a href="#objekte">add a property</a>, then the tools calculate with your numbers.</small>'}</div>
    <div class="obj-pick tl-pickgrid" role="group" aria-label="Software tools">${[...mainIds, ...o.more].map((id, i) => `<button type="button" class="obj-op${has(id) ? '' : ' off'}" data-tl="${id}" aria-expanded="false"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TICON[id] || TICON.nk}</svg><span><strong>${m === 'einsteiger' && i < mainIds.length && has(id) ? `${i + 1}. ` : ''}${esc(TOOLS[id][0])}</strong><small>${has(id) ? esc(TOOLS[id][2]) : `${esc(TOOLS[id][2])} · ${TOOLS[id][1] === 'pro' ? 'Investor Pro' : 'Buyer Pass'}`}</small></span><svg class="obj-op-c" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('')}</div>
    <p class="tl-links"><a href="#steuer">Taxes &amp; depreciation</a> · <a href="/calculators">All calculators</a></p>

    ${[...mainIds, ...o.more].map(sec).join('')}
    <p class="form-note tl-foot">Your inputs stay in this browser only. <button type="button" class="text-btn" id="tlClear">Reset inputs</button></p>`;
  const q = (id) => view.querySelector('#t-' + id);
  const mount = (id) => {
    const b = q(id); if (!b) return; if (!has(id)) { b.innerHTML = lockCard(id); return; }
    TOOLS[id][3](b, dd);
    const ex = PROFI_EX[id];
    if (m !== 'einsteiger' || !ex || demo) return;
    const bak = 'lr-tool3-bak-' + id;
    let shown = false; try { shown = !!sessionStorage.getItem(bak); } catch { /* no storage */ }
    b.querySelector('h3')?.insertAdjacentHTML('afterend', shown
      ? `<div class="tl-ex on"><p><strong>A pro's example</strong> – not your numbers. This is how an experienced buyer approaches it:</p><ul>${ex.tips.map((tp) => `<li>${esc(tp)}</li>`).join('')}</ul><button type="button" class="btn btn-outline" data-ex-back>Restore my own numbers</button></div>`
      : '<div class="tl-ex"><button type="button" class="btn btn-outline" data-ex-go><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>How a pro would fill this in</button></div>');
    b.querySelector('[data-ex-go]')?.addEventListener('click', () => {
      try { sessionStorage.setItem(bak, localStorage.getItem(KEY(id)) ?? '__empty__'); localStorage.setItem(KEY(id), JSON.stringify(ex.v)); } catch { /* no storage */ }
      mount(id);
    });
    b.querySelector('[data-ex-back]')?.addEventListener('click', () => {
      try { const v = sessionStorage.getItem(bak); sessionStorage.removeItem(bak); if (v === '__empty__' || v == null) localStorage.removeItem(KEY(id)); else localStorage.setItem(KEY(id), v); } catch { /* no storage */ }
      mount(id);
    });
  };
  // Tools open only when tapped: before that only the picker is visible, afterwards exactly one tool.
  const mounted = new Set();
  const open = (id, scroll) => {
    CTX.open = id || null;
    view.querySelectorAll('.tl-card').forEach((c) => { c.hidden = c.id !== 't-' + id; });
    view.querySelectorAll('[data-tl]').forEach((a) => { const on = a.dataset.tl === id; a.classList.toggle('on', on); a.setAttribute('aria-expanded', String(on)); });
    if (!id) return;
    if (!mounted.has(id)) { mounted.add(id); mount(id); }
    const c = q(id);
    if (scroll && c) requestAnimationFrame(() => { const top = c.getBoundingClientRect().top + window.scrollY - (document.querySelector('.app-top')?.offsetHeight || 0) - 12; window.scrollTo({ top, behavior: 'smooth' }); });
  };
  if (CTX.open && TOOLS[CTX.open]) open(CTX.open, false);
  view.querySelector('#tlObj')?.addEventListener('change', (e) => { try { sessionStorage.setItem('lr-tool3-obj', e.target.value); } catch { /* no storage */ } mountTools(view, { d, tier, b2b, mode, features }); });
  view.querySelector('#tlClear')?.addEventListener('click', () => { if (!confirm('Reset inputs in the software tools? Values will be taken from your property and financial profile again.')) return; try { Object.keys(localStorage).filter((k) => k.startsWith('lr-tool3-')).forEach((k) => localStorage.removeItem(k)); } catch { /* no storage */ } mountTools(view, { d, tier, b2b, mode, features }); });
  view.onclick = (e) => { const b = e.target.closest('[data-print]'); if (b) printBox(b.closest('.tl-card'), TOOLS[b.dataset.print]?.[0] || 'LeaseRun'); };
  view.querySelectorAll('button[data-tl]').forEach((a) => a.onclick = (e) => { e.preventDefault(); open(CTX.open === a.dataset.tl ? null : a.dataset.tl, true); });
}
