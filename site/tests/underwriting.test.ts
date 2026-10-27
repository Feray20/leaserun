import { test } from 'node:test';
import assert from 'node:assert/strict';
import { underwrite, extraMetrics, ertragswert } from '../lib/underwriting/engine';
import { bankReadyScore } from '../lib/underwriting/score';

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test('Income approach value for the sample case', () => {
  const e = ertragswert({ annualRent: 9360, operatingCosts: 1783.2, landValue: 35640, capRate: 0.025, remainingLife: 50 })!;
  near(e.reinertrag, 7576.8); near(e.bodenverzinsung, 891); near(e.faktor, 28.3623, 0.0001);
  near(e.value, 35640 + (7576.8 - 891) * e.faktor);
  assert.equal(ertragswert({ annualRent: 9360, operatingCosts: 0, landValue: 0, capRate: 0, remainingLife: 50 }), null);
});

test('Extra metrics: debt yield, cash-on-cash, break-even rate, cap rate on cost', () => {
  const m = extraMetrics({ noi: 7576.8, cfads: 7576.8, debtService: 8719.68, loan: 149054.4, equity: 40728.6, totalCost: 189783, repaymentRate: 0.02 });
  near(m.debtYield!, 0.050832, 0.00001);
  near(m.cashOnCash!, (7576.8 - 8719.68) / 40728.6, 0.00001);
  near(m.breakEvenRate!, 7576.8 / 149054.4 - 0.02, 0.00001); // ≈ 3.08%
  near(m.netYield!, 7576.8 / 189783, 0.00001);
  assert.equal(extraMetrics({ noi: 1, cfads: 1, debtService: 0, loan: 0, equity: 0, totalCost: 0, repaymentRate: 0 }).debtYield, null);
});

test('Stress test: expense factor applies to operating expenses and repairs', () => {
  const base = { annualNetColdRent: 12000, nonRecoverableOperatingCosts: 1000, annualMaintenance: 1000, annualInterest: 4000, annualPrincipal: 2000, loanAmount: 100000, lendingValue: 150000, purchasePrice: 150000 };
  const r = underwrite(base, [
    { name: 'Base', interestRate: 0.04, vacancyRate: 0, maintenanceMultiplier: 1 },
    { name: 'Expenses +30%', interestRate: 0.04, vacancyRate: 0, maintenanceMultiplier: 1.3, costMultiplier: 1.3 },
    { name: 'Rate +200 bp', interestRate: 0.06, vacancyRate: 0, maintenanceMultiplier: 1 },
  ]);
  near(r.stress[0].noi, 10000); near(r.stress[1].noi, 9400);
  near(r.stress[2].debtService, 8000); near(r.stress[2].dscr, 1.25);
});

test('Score: stress resilience as an extra component, unchanged without stress', () => {
  const base = { dscr: 1.5, icr: 3, ltv: 0.6, documentCompleteness: 100, legalRisk: 0, technicalRisk: 0, cashReserveMonths: 12 };
  assert.equal(bankReadyScore(base).score, 100);
  assert.equal(bankReadyScore(base).components.length, 7);
  const s = bankReadyScore({ ...base, stressDscr: 0.6 });
  assert.equal(s.components.length, 8);
  assert.equal(s.score, 95); // stress sub-score 50 × 10%
  near(s.components.reduce((a, c) => a + c.max, 0), 100);
});
