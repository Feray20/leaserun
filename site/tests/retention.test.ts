import { test } from 'node:test';
import assert from 'node:assert/strict';
const M = () => import('../public/src/retention.mjs');

test('Loan, payment and balance (30-year fixed)', async () => {
  const { schedule, loanOf } = await M();
  const o = { price: 300000, purchaseCostPct: 3, equity: 69000, interestPct: 6.5, termYears: 30, payoutDate: '2020-01-01' };
  assert.equal(loanOf(o), 240000);
  const sc = schedule(o);
  assert.equal(Math.round(sc.rate), 1517); // standard 30-year P&I on $240,000 at 6.5%
  const r10 = sc.restAt(new Date('2030-01-01'));
  assert.ok(r10 > 200000 && r10 < 210000, String(r10));
  const zi = sc.interestInYear(2021);
  assert.ok(zi > 15000 && zi < 15700, String(zi));
  assert.equal(Math.round(schedule({ loan: 100000, interestPct: 3, repaymentPct: 2 }).rate), 417); // legacy objects
});

test('Depreciation rate and Schedule E CSV', async () => {
  const { afaRate, anlageVCsv } = await M();
  assert.equal(afaRate({}), 1 / 27.5);
  assert.equal(afaRate({ commercial: true }), 1 / 39);
  const csv = anlageVCsv([{ name: 'Duplex', price: 275000, buildingSharePct: 80, rent: 1000, interestPct: 6, termYears: 30, payoutDate: '2024-01-01', purchaseDate: '2023-06-01' }], 2025);
  assert.ok(csv.includes('"Duplex",12000.00,'));
  assert.ok(csv.includes(',8000.00,')); // 275,000 × 80% ÷ 27.5
});

test('Deadlines: ARM reset and rent review', async () => {
  const { deadlines } = await M();
  const soon = new Date(); soon.setFullYear(soon.getFullYear() - 6);
  const ds = deadlines({ payoutDate: soon.toISOString().slice(0, 10), fixedYears: 7, lastRentChange: '2020-01-01' });
  assert.ok(ds.some((x) => /ARM fixed-rate period/.test(x.t) && x.m <= 13));
  assert.ok(ds.some((x) => /Rent increase can be proposed/.test(x.t)));
  assert.ok(!deadlines({ payoutDate: '2020-01-01', fixedYears: 30 }).some((x) => /ARM/.test(x.t)));
});
