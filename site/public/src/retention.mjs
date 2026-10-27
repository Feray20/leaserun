// Tools that keep paying off over months: Pro monthly report with deadlines and Schedule E helper; beginner savings plan
// with a monthly check-in. All calculations run in the browser from the account data. Not tax or lending advice.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => (v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
// Accepts 1,234.56 and 1234.56.
const n = (v) => { const x = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : 0; };
const ym = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const addM = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const monthsUntil = (d) => Math.round((d.getTime() - Date.now()) / (30.44 * 864e5));

export function loanOf(o) { return n(o.loan) || Math.max(0, Math.round(n(o.price) * (1 + n(o.purchaseCostPct) / 100) - n(o.equity))); }
// Monthly P&I from funding: fully amortizing over termYears (US standard: 30-year fixed). Older objects without a term
// fall back to the initial repayment rate (repaymentPct).
export function schedule(o) {
  const L = loanOf(o), z = n(o.interestPct) / 100, years = n(o.termYears);
  const i = z / 12;
  const rate = years > 0 ? (i > 0 ? (L * i) / (1 - Math.pow(1 + i, -years * 12)) : L / (years * 12)) : (L * (z + n(o.repaymentPct) / 100)) / 12;
  const start = o.payoutDate ? new Date(o.payoutDate) : null;
  return { L, z, rate, start, restAt(date) { if (!start || !L || !rate) return L; const m = Math.max(0, Math.round((date - start) / (30.44 * 864e5))); let s = L; for (let k = 0; k < m && s > 0; k++) s -= rate - (s * z) / 12; return Math.max(0, s); },
    interestInYear(y) { if (!start || !L || !rate) return L * z; let s = L, sum = 0; const d = new Date(start); for (let k = 0; k < 600 && s > 0; k++) { const zi = (s * z) / 12; if (d.getFullYear() === y) sum += zi; if (d.getFullYear() > y) break; s -= rate - zi; d.setMonth(d.getMonth() + 1); } return sum; } };
}
// Annual straight-line depreciation rate (IRS MACRS): residential rental 27.5 years, commercial 39 years. Land is not depreciable.
export function afaRate(o) { return o && (o.commercial === true || String(o.use || o.type || '').toLowerCase() === 'commercial') ? 1 / 39 : 1 / 27.5; }

// Deadlines per property (next 36 months or open).
export function deadlines(o) {
  const out = [];
  const fixed = n(o.fixedYears);
  if (o.payoutDate && fixed > 0 && fixed < 30) { const e = addM(new Date(o.payoutDate), fixed * 12); const m = monthsUntil(e); if (m <= 60) out.push({ m, t: `ARM fixed-rate period ends ${ym(e)}`, tip: m > 6 ? 'Watch rates for a refinance' : 'Compare refinance quotes now' }); }
  if (o.purchaseDate) {
    const k = new Date(o.purchaseDate);
    const s = addM(k, 12), ms = monthsUntil(s); if (ms > 0 && ms <= 36) out.push({ m: ms, t: `Long-term capital gains holding period reached ${ym(s)}`, tip: 'A sale after that is taxed at long-term rates' });
    const h = addM(k, 24), mh = monthsUntil(h); if (mh > 0 && mh <= 36) out.push({ m: mh, t: `2-year ownership test (Section 121) met ${ym(h)}`, tip: 'Home-sale exclusion if you also lived there 2 of 5 years' });
  }
  if (o.lastRentChange) { const r = addM(new Date(o.lastRentChange), 12), mr = monthsUntil(r); out.push({ m: Math.max(0, mr), t: mr <= 0 ? 'Rent increase can be proposed at renewal' : `Next rent review at lease renewal ${ym(r)}`, tip: 'Check notice periods and local rent rules', href: '/calculators/rent-increase' }); }
  return out.sort((a, b) => a.m - b.m);
}

function profiReport(objs) {
  const now = new Date();
  const rows = objs.map((o) => {
    const sc = schedule(o), rent = n(o.rent) * (1 - n(o.vacancyPct) / 100);
    const fixed = (n(o.taxesAnnual) + n(o.insuranceAnnual)) / 12 + n(o.hoaMonthly);
    const cf = rent - n(o.nonRecoverable) - n(o.maintenance) - fixed - sc.rate;
    return { o, rate: sc.rate, rest: sc.restAt(now), cf, dl: deadlines(o) };
  });
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return { rows, rest: sum('rest'), cf: sum('cf'), rate: sum('rate'), dl: rows.flatMap((r) => r.dl.map((d) => ({ ...d, name: r.o.name }))).sort((a, b) => a.m - b.m).slice(0, 8) };
}

// Schedule E helper (CSV for you or your CPA). Function name kept for callers.
export function anlageVCsv(objs, year) {
  const head = ['Property', 'Rents received (est.)', 'Mortgage interest (calculated)', 'Depreciation (straight-line, building only)', 'Taxes, insurance & HOA', 'Other operating expenses', 'Repairs (budget)', 'Net income/loss (simplified)'];
  const lines = objs.map((o) => {
    const ein = n(o.rent) * 12 * (1 - n(o.vacancyPct) / 100), zins = schedule(o).interestInYear(year);
    // Mid-month convention in the year placed in service.
    const pd = o.purchaseDate ? new Date(o.purchaseDate) : null;
    const share = pd && pd.getFullYear() === year ? (12 - pd.getMonth() - 0.5) / 12 : pd && pd.getFullYear() > year ? 0 : 1;
    const afa = n(o.price) * (n(o.buildingSharePct) || 80) / 100 * afaRate(o) * share;
    const fix = n(o.taxesAnnual) + n(o.insuranceAnnual) + n(o.hoaMonthly) * 12;
    const nk = n(o.nonRecoverable) * 12, inst = n(o.maintenance) * 12;
    return [o.name, ein, zins, afa, fix, nk, inst, ein - zins - afa - fix - nk - inst];
  });
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : '"' + String(v).replace(/"/g, '""') + '"');
  return '﻿' + [head.map(fmt).join(','), ...lines.map((l) => l.map(fmt).join(',')), '', fmt(`Schedule E helper ${year} – calculated from what you entered in LeaseRun. Not tax advice; your records control (bank statements, Form 1098 from your lender, invoices). Ask your CPA about passive-loss limits.`)].join('\n');
}

export function mountRetention(grid, { mode, d, u, saveData, paid }) {
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.name);
  if (mode === 'profi') {
    const el = document.createElement('article');
    el.className = 'dash-card wide ret-card'; el.dataset.view = 'start'; el.id = 'monatsbericht';
    if (!objs.length) { el.innerHTML = `<h3>Monthly report</h3><p class="form-note">Once you add a property with loan details, you will see cash flow, loan balance and upcoming deadlines here every month.</p>`; grid.append(el); return; }
    const r = profiReport(objs), y = new Date().getFullYear();
    el.innerHTML = `<div class="ret-h"><h3>Monthly report ${esc(ym(new Date()))}</h3><span class="form-note">${objs.length} propert${objs.length === 1 ? 'y' : 'ies'}</span></div>
      <div class="ret-kpis"><div><small>Pre-tax cash flow / month</small><strong class="${r.cf < 0 ? 'neg' : 'pos'}">${E(r.cf)}</strong></div><div><small>Mortgage payments (P&amp;I) / month</small><strong>${E(r.rate)}</strong></div><div><small>Loan balance today</small><strong>${E(r.rest)}</strong></div></div>
      <h4 class="ret-sub">Upcoming deadlines</h4>${r.dl.length ? `<ul class="ret-dl">${r.dl.map((x) => `<li class="${x.m <= 12 ? 'hot' : ''}"><span><strong>${esc(x.name)}</strong> · ${esc(x.t)}</span><small>${x.href ? `<a href="${x.href}">${esc(x.tip)}</a>` : esc(x.tip)}</small></li>`).join('')}</ul>` : '<p class="form-note">No deadlines coming up. Tip: enter purchase date, loan funding date, ARM fixed period and last rent change on the property.</p>'}
      <div class="ret-act">${paid ? `<button type="button" class="btn btn-outline" id="anlV">Schedule E helper ${y - 1} (CSV)</button><button type="button" class="btn btn-ghost" id="anlV2">${y} to date</button>` : `<a class="btn btn-outline" href="#angebot">Schedule E helper with Investor Pro</a>`}</div>
      <p class="form-note">Calculated from what you entered (repairs and operating expenses as monthly amounts). Not tax advice.</p>`;
    grid.append(el);
    const dl = (yy) => { const b = new Blob([anlageVCsv(objs, yy)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `leaserun-schedule-e-${yy}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    el.querySelector('#anlV')?.addEventListener('click', () => dl(y - 1));
    el.querySelector('#anlV2')?.addEventListener('click', () => dl(y));
    return;
  }
  // Beginner: savings plan toward the down payment with a monthly check-in.
  const p = d.profile || (d.profile = {});
  const el = document.createElement('article');
  el.className = 'dash-card wide ret-card'; el.dataset.view = 'start'; el.id = 'sparplan';
  const paint = () => {
    const tp = n(p.targetPrice);
    // Goal: saved goal, otherwise 20% down + ~3% closing costs on the target price. No sample numbers when nothing is entered.
    const goal = n(p.savingsGoal) || (tp > 0 ? Math.round((tp * 0.23) / 1000) * 1000 : 0);
    const have = n(p.equity), rate = n(p.savingsMonthly), left = Math.max(0, goal - have);
    const months = goal > 0 && rate > 0 ? Math.ceil(left / rate) : goal > 0 && left === 0 ? 0 : null, pct = goal ? Math.min(100, Math.round((have / goal) * 100)) : 0;
    const log = Array.isArray(p.savingsLog) ? p.savingsLog.slice(-12) : [];
    const thisM = new Date().toISOString().slice(0, 7), done = log.some((x) => x.m === thisM);
    const max = Math.max(goal, ...log.map((x) => n(x.v)), 1);
    const mLabel = (m) => new Date(m + '-15').toLocaleDateString('en-US', { month: 'short' });
    el.innerHTML = `<div class="ret-h"><h3>My savings plan for the down payment</h3><span class="form-note">${goal ? `${pct}% done` : 'Set a goal'}</span></div>
      <div class="ret-bar" role="img" aria-label="${pct} percent of the goal"><i style="width:${pct}%"></i></div>
      <div class="ret-kpis"><div><small>Saved</small><strong>${E(have)}</strong></div><div><small>Goal</small><strong>${goal ? E(goal) : '–'}</strong></div><div><small>${months === 0 ? 'Goal reached' : 'Expected to reach'}</small><strong>${months === 0 ? '✓ reached' : months ? esc(ym(addM(new Date(), months))) : '–'}</strong></div></div>
      ${log.length > 1 ? `<div class="ret-hist" aria-label="History">${log.map((x) => `<span title="${esc(x.m)}: ${E(n(x.v))}"><i style="height:${Math.max(4, (n(x.v) / max) * 100)}%"></i><small>${esc(mLabel(x.m))}</small></span>`).join('')}</div>` : ''}
      <form class="ret-form" id="spF"><label>Goal ($)<input name="goal" type="text" inputmode="decimal" value="${goal || ''}"></label><label>Saved today ($)<input name="have" type="text" inputmode="decimal" value="${have || ''}"></label><label>Savings / month ($)<input name="rate" type="text" inputmode="decimal" value="${rate || ''}" placeholder="e.g. 500"></label>
        <button class="btn btn-dark" type="submit">${done ? 'Update' : 'Save monthly check-in'}</button></form>
      <p class="form-note">${done ? 'Check-in done for this month – see you next month!' : 'Enter your balance once a month to see how close you are to your goal.'} Rule of thumb: down payment (3–20% for a home you live in, 15–25% for a rental) plus about 2–5% closing costs and a few months of reserves.</p>`;
    el.querySelector('#spF').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      p.savingsGoal = n(f.goal); p.equity = n(f.have); p.savingsMonthly = n(f.rate);
      const L = (Array.isArray(p.savingsLog) ? p.savingsLog : []).filter((x) => x.m !== thisM); L.push({ m: thisM, v: p.equity }); p.savingsLog = L.slice(-24);
      try { await saveData(u, d); } catch { /* stays visible locally */ }
      paint();
    };
  };
  paint();
  grid.append(el);
}
