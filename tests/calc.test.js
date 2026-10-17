// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../site/lr-calc.js');

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('30-year payment matches the standard formula', () => {
  near(c.payment(200000, 6, 30), 1199.10);
  near(c.payment(187500, 7, 30), 1247.44);
  near(c.payment(120000, 0, 10), 1000);
});

test('balance after full term is zero and after 0 months is principal', () => {
  near(c.balanceAfter(200000, 6, 30, 360), 0, 0.5);
  near(c.balanceAfter(200000, 6, 30, 0), 200000);
});

test('cash purchase has no loan, no DSCR, no PMI', () => {
  const r = c.analyze({ loanType: 'cash', price: 150000, rent: 1500 });
  assert.equal(r.loan, 0);
  assert.equal(r.dscr, null);
  assert.equal(r.pmi, 0);
  near(r.cashFlowY, r.noi);
});

test('PMI only above 80% LTV on conventional loans', () => {
  assert.equal(c.analyze({ downPct: 20 }).pmi, 0);
  assert.ok(c.analyze({ downPct: 10 }).pmi > 0);
  assert.equal(c.analyze({ downPct: 10, loanType: 'dscr' }).pmi, 0);
});

test('state default property tax applies when none is entered', () => {
  const r = c.analyze({ state: 'NJ', price: 300000 });
  assert.equal(r.input.taxesAnnual, Math.round(300000 * 2.23 / 100));
  const own = c.analyze({ state: 'NJ', price: 300000, taxesAnnual: 4000 });
  assert.equal(own.input.taxesAnnual, 4000);
});

test('passive loss allowance phases out between $100k and $150k MAGI', () => {
  const lossy = { price: 400000, rent: 2000, downPct: 20 };
  assert.equal(c.analyze({ ...lossy, magi: 90000 }).tax.allowance, 25000);
  assert.equal(c.analyze({ ...lossy, magi: 125000 }).tax.allowance, 12500);
  assert.equal(c.analyze({ ...lossy, magi: 160000 }).tax.allowance, 0);
});

test('depreciation uses 27.5 years and excludes land', () => {
  const r = c.analyze({ loanType: 'cash', price: 275000, landPct: 20, inspection: 0, titlePct: 0, recording: 0 });
  near(r.tax.depreciation, 275000 * 0.8 / 27.5, 0.5);
});

test('negative cash flow is flagged high and verdict is not positive', () => {
  const r = c.analyze({ price: 400000, rent: 1800 });
  assert.ok(r.warnings.some(w => w.title === 'Negative cash flow' && w.level === 'high'));
  assert.equal(r.verdict.tone, 'bad');
});

test('a strong deal pencils out', () => {
  const r = c.analyze({ state: 'OH', price: 140000, rent: 1750, downPct: 25, rate: 6.5, yearBuilt: 2001 });
  assert.equal(r.verdict.tone, 'good', JSON.stringify(r.warnings));
});

test('pre-1978 homes get the lead paint warning', () => {
  assert.ok(c.analyze({ yearBuilt: 1960 }).warnings.some(w => /1978/.test(w.title)));
});

test('reserves check uses the investor profile', () => {
  const r = c.analyze({ price: 200000, rent: 1900 }, { liquid_reserves: 10000 });
  assert.ok(r.warnings.some(w => w.title === 'Not enough cash'));
});

test('extra payments shorten payoff', () => {
  const base = c.amortize(200000, 6.5, 30, 0, 0);
  const extra = c.amortize(200000, 6.5, 30, 200, 0);
  assert.equal(base.months, 360);
  assert.ok(extra.months < 300 && extra.interest < base.interest);
});

test('refinance break-even', () => {
  const r = c.refinance({ origBalance: 200000, origRate: 7.5, origTerm: 30, currentBalance: 190000, currentPayment: 1398.43,
    value: 260000, newLtv: 0, newRate: 6, newTerm: 30, costPct: 2 });
  assert.ok(r.monthlySaving > 0 && r.breakEvenMonths > 0 && r.breakEvenMonths < 40);
});

test('IRR of a simple flow', () => {
  near(c.irr([-100, 110]), 10, 0.01);
});
