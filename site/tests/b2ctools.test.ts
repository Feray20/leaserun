import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Loan Estimate comparison: lower cost + balance wins (30-year terms)', async () => {
  const { compareOffers, pmt } = await import('../public/src/b2c-tools.mjs');
  const r = compareOffers([
    { bank: 'A', loan: 300000, rate: 6.75, repay: 30, years: 7, fees: 0 },
    { bank: 'B', loan: 300000, rate: 6.5, repay: 30, years: 7, fees: 3000 },
  ]);
  assert.equal(r.rows.length, 2);
  assert.ok(r.sameYears);
  const a = r.rows[0], b = r.rows[1];
  assert.ok(Math.abs(a.pay - pmt(300000, 6.75, 30)) < 0.01);
  assert.ok(Math.abs(a.pay - 1945.79) < 0.05, String(a.pay)); // standard 30-year P&I
  assert.ok(a.rest < 300000 && a.rest > 250000);
  assert.equal(r.best.bank, b.cost + b.rest < a.cost + a.rest ? 'B' : 'A');
});

test('Rate lock: cost per month of lead time, free months', async () => {
  const { forwardCalc } = await import('../public/src/b2c-tools.mjs');
  const r = forwardCalc({ rest: 200000, monthsToEnd: 8, todayRate: 6.5, surchargePerMonth: 0.05, repay: 25, freeMonths: 2 });
  assert.equal(r.lead, 6);
  assert.ok(Math.abs(r.fwdRate - 6.8) < 1e-9);
  assert.ok(r.fwdPay > r.todayPay);
});

test('Prepayment penalty window: 3 years after funding by default', async () => {
  const { kuendigungsrecht489 } = await import('../public/src/b2c-tools.mjs');
  const k = kuendigungsrecht489('2024-03-15');
  assert.equal(k.from.getFullYear(), 2027);
  assert.equal(k.end.getFullYear(), 2029);
  assert.equal(kuendigungsrecht489(''), null);
});

test('Listing AutoPilot: down payment scenarios with PITIA', async () => {
  const { financeScenarios } = await import('../public/src/expose-check.mjs');
  const { GREST } = await import('../public/src/calc.mjs');
  const land = Object.keys(GREST)[0];
  const r = financeScenarios({ price: 300000, land, brokerPct: 0, ratePa: 6.5, termYears: 30, taxesAnnual: 3600, insuranceAnnual: 1200 });
  assert.ok(r && r.rows.length === 3);
  assert.equal(Math.round(r.rows[0].loan), 285000);
  assert.ok(r.rows[0].pmi > 0 && r.rows[2].pmi === 0);
  assert.ok(Math.abs(r.rows[2].rate - 1516.96) < 0.05, String(r.rows[2].rate));
  assert.ok(Math.abs(r.rows[2].pitia - (r.rows[2].rate + 400)) < 0.01);
  assert.ok(r.rows[2].loan < r.rows[1].loan);
});

test('Price check: maximum price from target cash flow and cap rate', async () => {
  const { maxPrice } = await import('../public/src/b2c-tools.mjs');
  const r = maxPrice({ rent: 1000, costPct: 0, equity: 0, rate: 4, repay: 2, nkPct: 0, targetCf: 0, targetYield: 0 });
  assert.ok(Math.abs(r.byCf - 200000) < 0.01); // legacy repayment rate: $1,000 × 12 / 6%
  assert.equal(r.max, r.byCf);
  assert.ok(maxPrice({ rent: 1000, costPct: 0, equity: 0, rate: 4, repay: 2, nkPct: 0, targetCf: 0, targetYield: 8 }).max === 150000);
  const us = maxPrice({ rent: 2000, costPct: 40, equity: 60000, rate: 7, repay: 30, nkPct: 3, targetCf: 0, targetYield: 0 });
  assert.ok(us.byCf > 200000 && us.byCf < 260000, String(us.byCf));
});

test('Expense billing: split by square feet and occupants', async () => {
  const { betriebskosten } = await import('../public/src/b2c-tools.mjs');
  const r = betriebskosten({ rows: [{ t: 'Landscaping', key: 'flaeche', betrag: 1000 }, { t: 'Water', key: 'personen', betrag: 1000 }, { t: 'Common electric', key: 'einheit', betrag: 600 }], flaecheGesamt: 4000, flaecheMieter: 1000, personenGesamt: 10, personenMieter: 2, einheitenGesamt: 6, monate: 12, vorauszahlung: 400 });
  assert.ok(Math.abs(r.summe - (250 + 200 + 100)) < 1e-9);
  assert.ok(Math.abs(r.saldo - 150) < 1e-9);
});

test('Pro: offers with different horizons normalized to a common horizon', async () => {
  const { normalizeOffers } = await import('../public/src/b2c-tools.mjs');
  const r = normalizeOffers([
    { bank: 'ARM', loan: 300000, rate: 6.0, repay: 30, years: 5, fees: 0 },
    { bank: 'Fixed', loan: 300000, rate: 6.75, repay: 30, years: 10, fees: 0 },
  ], { anschlussRate: 8 });
  assert.equal(r.horizon, 10);
  const arm = r.rows.find((x) => x.bank === 'ARM')!;
  assert.ok(arm.extra > 0 && arm.restH < arm.rest);
  // At an 8% reset rate the ARM costs more than its 5-year comparison suggests.
  assert.ok(arm.costH > arm.cost);
});

test('Closing costs: cash covers closing costs, LTV and PMI', async () => {
  const { nkPlan } = await import('../public/src/b2c-tools.mjs');
  const { GREST } = await import('../public/src/calc.mjs');
  const land = Object.keys(GREST)[0];
  const r = nkPlan({ price: 300000, land, equity: 40000, ownerOccupied: true })!;
  assert.ok(r.nk.total > 0);
  assert.equal(Math.round(r.loan), Math.round(300000 + r.nk.total - 40000));
  assert.equal(r.coversNk, 40000 >= r.nk.total);
  assert.ok(r.bla > 80 && r.pmiMonthly > 0);
  assert.equal(nkPlan({ price: 300000, land: '', equity: 0 }), null);
});

test('Extra principal vs. investing after tax: rental lowers the effective rate', async () => {
  const { sondertilgungVergleich } = await import('../public/src/b2c-tools.mjs');
  const v = sondertilgungVergleich({ rate: 7, taxPct: 30, vermietet: true, altRendite: 8 });
  assert.equal(Math.round(v.eff * 100) / 100, 4.9);
  assert.equal(v.lohnt, false); // 8% before tax = 6.5% after 18.8% > 4.9%
  const s = sondertilgungVergleich({ rate: 7, vermietet: false, altRendite: 8 });
  assert.equal(s.lohnt, true);
});

test('US number input (tolerant of European format)', async () => {
  const { num } = await import('../public/src/b2c-tools.mjs');
  assert.equal(num('300,000'), 300000);
  assert.equal(num('3.55'), 3.55);
  assert.equal(num('$1,234.56'), 1234.56);
  assert.equal(num('1.234,56 €'), 1234.56);
  assert.equal(num('3,55'), 3.55);
  assert.equal(num(''), 0);
});
