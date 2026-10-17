import { test } from 'node:test';
import assert from 'node:assert/strict';
const M = () => import('../public/src/retention.mjs');

test('Darlehen, Rate und Restschuld', async () => {
  const { schedule, loanOf } = await M();
  const o = { price: 300000, purchaseCostPct: 10, equity: 60000, interestPct: 3.6, repaymentPct: 2, payoutDate: '2020-01-01' };
  assert.equal(loanOf(o), 270000);
  const sc = schedule(o);
  assert.equal(Math.round(sc.rate), 1260);
  const r10 = sc.restAt(new Date('2030-01-01'));
  assert.ok(r10 > 200000 && r10 < 215000, String(r10));
  const zi = sc.interestInYear(2021);
  assert.ok(zi > 9000 && zi < 9800, String(zi));
});

test('AfA-Satz und Anlage-V-CSV', async () => {
  const { afaRate, anlageVCsv } = await M();
  assert.equal(afaRate({ yearBuilt: 2024 }), 0.03);
  assert.equal(afaRate({ yearBuilt: 1900 }), 0.025);
  assert.equal(afaRate({ yearBuilt: 1990 }), 0.02);
  const csv = anlageVCsv([{ name: 'ETW', price: 200000, buildingSharePct: 80, yearBuilt: 1990, rent: 800, interestPct: 3, repaymentPct: 2, payoutDate: '2024-01-01', purchaseDate: '2023-06-01' }], 2025);
  assert.ok(csv.includes('"ETW";9600,00;'));
  assert.ok(csv.includes(';3200,00;'));
});

test('Fristen: Zinsbindung und Mieterhöhung', async () => {
  const { deadlines } = await M();
  const soon = new Date(); soon.setFullYear(soon.getFullYear() - 9);
  const ds = deadlines({ payoutDate: soon.toISOString().slice(0, 10), fixedYears: 10, lastRentChange: '2020-01-01' });
  assert.ok(ds.some((x) => /Zinsbindung/.test(x.t) && x.m <= 13));
  assert.ok(ds.some((x) => /Mieterhöhung kann verlangt werden/.test(x.t)));
});
