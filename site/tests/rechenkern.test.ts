import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afaRate, afaSchedule, balanceAfterYears, equityReturn, kappungsgrenzeMax, mietpreisbremseMax } from '../lib/kreditmappe/math';
import { underwrite } from '../lib/underwriting/engine';
import { bankReadyScore } from '../lib/underwriting/score';

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test('AfA-Satz nach Fertigstellungsjahr (§ 7 Abs. 4 EStG)', () => {
  assert.equal(afaRate(2024), 0.03);
  assert.equal(afaRate(2023), 0.03);
  assert.equal(afaRate(1998), 0.02);
  assert.equal(afaRate(1925), 0.02);
  assert.equal(afaRate(1900), 0.025);
  assert.equal(afaRate(0), 0.02);
});

test('Restschuld: Mustermappe 149.054,40 € bei 3,85 % / 2 % nach 10 Jahren', () => {
  near(balanceAfterYears(149054.4, 0.0385, 0.02, 10), 112761.87, 0.01);
  assert.equal(balanceAfterYears(0, 0.04, 0.02, 10), 0);
  near(balanceAfterYears(120000, 0, 0.1, 5), 60000, 0.001);
});

test('Degressive AfA: 5 % vom Restwert, Summe kleiner als Bemessungsgrundlage', () => {
  const d = afaSchedule(100000, 3, 'degressiv', 0.03);
  near(d[0], 5000); near(d[1], 4750); near(d[2], 4512.5);
  const l = afaSchedule(100000, 3, 'linear', 0.03);
  assert.deepEqual(l, [3000, 3000, 3000]);
});

test('Mietpreisbremse und Kappungsgrenze', () => {
  near(mietpreisbremseMax(10, 50), 550);
  assert.equal(mietpreisbremseMax(10, 50, 600), 600);
  near(kappungsgrenzeMax(700, 900, false), 840);
  near(kappungsgrenzeMax(700, 900, true), 805);
  assert.equal(kappungsgrenzeMax(700, 760, false), 760);
});

test('Eigenkapitalrendite', () => {
  near(equityReturn(40000, -1200, 3000, 1800)!, 0.09);
  assert.equal(equityReturn(0, 1000), null);
});

test('Underwriting: DSCR = CFADS ÷ Kapitaldienst', () => {
  const r = underwrite({
    annualNetColdRent: 26400, vacancyRate: 0, nonRecoverableOperatingCosts: 3000, annualMaintenance: 2400,
    annualOtherCashCosts: 600, annualInterest: 12000, annualPrincipal: 9000, loanAmount: 300000, lendingValue: 350000, purchasePrice: 400000,
  });
  near(r.noi, 21000); near(r.cfads, 20400); near(r.debtService, 21000);
  near(r.dscr, 20400 / 21000, 1e-9);
  near(r.icr, 21000 / 12000, 1e-9);
  near(r.ltvPurchasePrice, 0.75, 1e-9);
  assert.throws(() => underwrite({ annualNetColdRent: 1, nonRecoverableOperatingCosts: 0, annualInterest: 0, annualPrincipal: 0, loanAmount: 0, lendingValue: 0, purchasePrice: 1 }));
});

test('Banken-Ready-Score: Gewichte summieren 100 %, Treiber konsistent', () => {
  const s = bankReadyScore({ dscr: 1.5, icr: 3, ltv: 0.6, documentCompleteness: 100, legalRisk: 0, technicalRisk: 0, cashReserveMonths: 12 });
  assert.equal(s.score, 100);
  near(s.components.reduce((a, c) => a + c.weight, 0), 1, 1e-9);
  const z = bankReadyScore({ dscr: 0, icr: 0, ltv: 1, documentCompleteness: 0, legalRisk: 100, technicalRisk: 100, cashReserveMonths: 0 });
  assert.equal(z.score, 0);
});
