import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoAnalyse, DEMO_DEFAULTS, kaufnebenkosten } from '../public/src/calc.mjs';

test('Startseiten-Demo: Beispielwohnung rechnet mit dem Rechenkern', () => {
  const d = demoAnalyse();
  const nk = kaufnebenkosten({ price: DEMO_DEFAULTS.price, land: DEMO_DEFAULTS.land, brokerPct: DEMO_DEFAULTS.brokerPct })!;
  assert.equal(d.nk!.total, nk.total);
  assert.equal(d.loan, Math.round((nk.allIn - DEMO_DEFAULTS.equity) * 100) / 100);
  assert.ok(d.rate > 0 && d.rest10 < d.loan);
  assert.ok(d.lamps.every((l) => l.key !== 'objekt'), 'Eigennutzung: keine Objekt-Rendite');
  assert.ok(d.score! >= 0 && d.score! <= 100);
});

test('Startseiten-Demo: Vermietung bewertet zusätzlich das Objekt', () => {
  const d = demoAnalyse({ use: 'investor', rent: 1200 });
  assert.ok(d.lamps.some((l) => l.key === 'objekt'));
});

test('Startseiten-Demo: wenig Eigenkapital und Einkommen senken den Orientierungswert', () => {
  const gut = demoAnalyse({ equity: 150000, netIncome: 8000 });
  const knapp = demoAnalyse({ equity: 10000, netIncome: 3000 });
  assert.ok(gut.score! > knapp.score!);
  assert.equal(knapp.lamps.find((l) => l.key === 'eigenkapital')!.status, 'bad');
});

test('Startseiten-Demo: eine rote Ampel deckelt den Orientierungswert', () => {
  const d = demoAnalyse({ equity: 10000 });
  assert.ok(d.score! <= 59);
  assert.ok(d.openPoints >= 1);
});
