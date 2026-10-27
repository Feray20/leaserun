import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Angebotsvergleich: niedrigere Kosten + Restschuld gewinnt', async () => {
  const { compareOffers } = await import('../public/src/b2c-tools.mjs');
  const r = compareOffers([
    { bank: 'A', loan: 300000, rate: 3.6, repay: 2, years: 10, fees: 0 },
    { bank: 'B', loan: 300000, rate: 3.5, repay: 2, years: 10, fees: 2000 },
  ]);
  assert.equal(r.rows.length, 2);
  assert.ok(r.sameYears);
  const a = r.rows[0], b = r.rows[1];
  assert.ok(Math.abs(a.pay - 1400) < 0.01, String(a.pay)); // 300.000 × 5,6 % / 12
  assert.ok(a.rest < 300000 && a.rest > 200000);
  assert.equal(r.best.bank, b.cost + b.rest < a.cost + a.rest ? 'B' : 'A');
});

test('Forward: Aufschlag je Vorlaufmonat, aufschlagsfreie Monate', async () => {
  const { forwardCalc } = await import('../public/src/b2c-tools.mjs');
  const r = forwardCalc({ rest: 200000, monthsToEnd: 30, todayRate: 3.5, surchargePerMonth: 0.02, repay: 2, freeMonths: 6 });
  assert.equal(r.lead, 24);
  assert.ok(Math.abs(r.fwdRate - 3.98) < 1e-9);
  assert.ok(r.fwdPay > r.todayPay);
});

test('§ 489 BGB: 10 Jahre nach Auszahlung plus 6 Monate Frist', async () => {
  const { kuendigungsrecht489 } = await import('../public/src/b2c-tools.mjs');
  const k = kuendigungsrecht489('2016-03-15');
  assert.equal(k.from.getFullYear(), 2026);
  assert.equal(k.end.getMonth(), 8);
  assert.equal(kuendigungsrecht489(''), null);
});

test('Exposé-AutoPilot: Szenarien mit Nebenkosten und Rate', async () => {
  const { financeScenarios } = await import('../public/src/expose-check.mjs');
  const r = financeScenarios({ price: 300000, land: 'hessen', brokerPct: 0, ratePa: 3.6, repayPa: 2 });
  assert.ok(r && r.rows.length === 3);
  assert.equal(Math.round(r.rows[0].loan), 300000);
  assert.ok(Math.abs(r.rows[0].rate - 1400) < 0.01);
  assert.ok(r.rows[2].loan < r.rows[1].loan);
});

test('Kaufpreis-Verhandlung: Höchstpreis aus Ziel-Cashflow', async () => {
  const { maxPrice } = await import('../public/src/b2c-tools.mjs');
  const r = maxPrice({ rent: 1000, costPct: 0, equity: 0, rate: 4, repay: 2, nkPct: 0, targetCf: 0, targetYield: 0 });
  assert.ok(Math.abs(r.byCf - 200000) < 0.01); // 1.000 € × 12 / 6 %
  assert.equal(r.max, r.byCf);
  assert.ok(maxPrice({ rent: 1000, costPct: 0, equity: 0, rate: 4, repay: 2, nkPct: 0, targetCf: 0, targetYield: 8 }).max === 150000);
});

test('Betriebskosten: Umlage nach Fläche und Personen', async () => {
  const { betriebskosten } = await import('../public/src/b2c-tools.mjs');
  const r = betriebskosten({ rows: [{ t: 'Grundsteuer', key: 'flaeche', betrag: 1000 }, { t: 'Wasser', key: 'personen', betrag: 1000 }, { t: 'Strom', key: 'einheit', betrag: 600 }], flaecheGesamt: 400, flaecheMieter: 100, personenGesamt: 10, personenMieter: 2, einheitenGesamt: 6, monate: 12, vorauszahlung: 400 });
  assert.ok(Math.abs(r.summe - (250 + 200 + 100)) < 1e-9);
  assert.ok(Math.abs(r.saldo - 150) < 1e-9);
});

test('Profi: Angebote mit unterschiedlicher Bindung auf gemeinsamen Horizont normiert', async () => {
  const { normalizeOffers } = await import('../public/src/b2c-tools.mjs');
  const r = normalizeOffers([
    { bank: 'Kurz', loan: 300000, rate: 3.4, repay: 2, years: 10, fees: 0 },
    { bank: 'Lang', loan: 300000, rate: 3.7, repay: 2, years: 15, fees: 0 },
  ], { anschlussRate: 5 });
  assert.equal(r.horizon, 15);
  const kurz = r.rows.find((x) => x.bank === 'Kurz')!;
  assert.ok(kurz.extra > 0 && kurz.restH < kurz.rest);
  // Bei 5 % Anschlusszins wird die kurze Bindung teurer als ihr Bindungsende-Vergleich vermuten lässt.
  assert.ok(kurz.costH > kurz.cost);
});

test('Kaufnebenkosten: Eigenkapital deckt Nebenkosten, Beleihungsauslauf mit Abschlag', async () => {
  const { nkPlan } = await import('../public/src/b2c-tools.mjs');
  const r = nkPlan({ price: 300000, land: 'bayern', equity: 40000, blwAbschlagPct: 10 })!;
  assert.equal(Math.round(r.nk.total), 16500); // 3,5 % + 1,5 % + 0,5 %
  assert.ok(r.coversNk);
  assert.equal(Math.round(r.loan), 276500);
  assert.equal(Math.round(r.bla * 10) / 10, 102.4);
  assert.equal(nkPlan({ price: 300000, land: '', equity: 0 }), null);
});

test('Sondertilgung nach Steuern: vermietet senkt den effektiven Zins', async () => {
  const { sondertilgungVergleich } = await import('../public/src/b2c-tools.mjs');
  const v = sondertilgungVergleich({ rate: 4, taxPct: 40, vermietet: true, altRendite: 5 });
  assert.equal(Math.round(v.eff * 100) / 100, 2.4);
  assert.equal(v.lohnt, false); // 5 % vor Steuern = 3,68 % nach Abgeltungsteuer > 2,4 %
  const s = sondertilgungVergleich({ rate: 4, vermietet: false, altRendite: 5 });
  assert.equal(s.lohnt, true);
});

test('Deutsche Zahleneingaben', async () => {
  const { num } = await import('../public/src/b2c-tools.mjs');
  assert.equal(num('300.000'), 300000);
  assert.equal(num('3,55'), 3.55);
  assert.equal(num('1.234,56 €'), 1234.56);
  assert.equal(num('3.55'), 3.55);
  assert.equal(num(''), 0);
});
