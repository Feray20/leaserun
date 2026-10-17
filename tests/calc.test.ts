import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anschluss, verkauf, indexmiete, staffelmiete, kaufpreisaufteilung, grenze15, fristen, toICS, portfolio, addMonths, parseDate, iso,
} from '../public/src/calc.mjs';

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test('Anschluss: Mustermappe – Restschuld, Raten und Kipp-Punkt', () => {
  const a = anschluss({ loan: 149054.4, ratePa: 0.0385, repaymentPa: 0.02, fixedYears: 10, noiMonthly: 631.4, rates: [0.03, 0.04, 0.05] });
  near(a.rest, 112761.87);
  near(a.oldRate, 726.64);
  assert.deepEqual(a.rows.map((r) => r.rate), [469.84, 563.81, 657.78]);
  assert.deepEqual(a.rows.map((r) => r.cashflow), [161.56, 67.59, -26.38]);
  near(a.kippPunktPa!, 0.0472, 0.0001);
});

test('Verkauf: Verlust ohne Steuer, Gewinn innerhalb von 10 Jahren steuerpflichtig, danach steuerfrei', () => {
  const base = { price: 200000, purchaseCostPct: 10, buildingSharePct: 80, afaRatePa: 0.02, saleCostPct: 0, taxPct: 42 };
  const v0 = verkauf({ ...base, years: 5, growthPa: 0 });
  near(v0.afaTaken, 17600); near(v0.book, 202400); near(v0.gain, -2400); assert.equal(v0.tax, 0);
  const g = Math.pow(1.25, 1 / 5) - 1;
  const v1 = verkauf({ ...base, years: 5, growthPa: g });
  near(v1.value, 250000); near(v1.gain, 47600); near(v1.tax, 19992);
  const v2 = verkauf({ ...base, years: 10, growthPa: g });
  assert.equal(v2.within10, false); assert.equal(v2.tax, 0);
});

test('Verkauf: Freigrenze 1.000 € (§ 23 Abs. 3 Satz 5 EStG)', () => {
  const v = verkauf({ price: 100000, purchaseCostPct: 0, buildingSharePct: 0, afaRatePa: 0, years: 2, growthPa: Math.pow(1.00999, 1 / 2) - 1, taxPct: 40 });
  near(v.gain, 999); assert.equal(v.tax, 0);
});

test('Indexmiete und Jahresfrist (§ 557b BGB)', () => {
  const r = indexmiete({ rent: 800, indexOld: 100, indexNew: 105, lastChange: '2025-03-01', effective: '2026-02-01' })!;
  near(r.newRent, 840); assert.equal(r.changePct, 5); assert.equal(r.earliest, '2026-03-01'); assert.equal(r.timingOk, false);
  assert.equal(indexmiete({ rent: 800, indexOld: 0, indexNew: 105 }), null);
});

test('Staffelmiete: Jahresabstand und Mietpreisbremse je Staffel (§ 557a BGB)', () => {
  const s = staffelmiete({ steps: [{ date: '2026-01-01', rent: 700 }, { date: '2026-12-01', rent: 730 }, { date: '2027-12-01', rent: 760 }], area: 68, vergleichsmieteQm: 10, bremse: true });
  assert.equal(s[1].gapOk, false); assert.equal(s[2].gapOk, true);
  near(s[0].cap!, 748); assert.equal(s[1].capOk, true); assert.equal(s[2].capOk, false);
  near(s[2].increasePct, 4.11);
});

test('Kaufpreisaufteilung (Restwert) und 15-%-Grenze (Mustermappe)', () => {
  const k = kaufpreisaufteilung({ price: 300000, landArea: 500, bodenrichtwert: 200, meaShare: 1, meaTotal: 10 });
  near(k.land, 10000); near(k.building, 290000); near(k.buildingSharePct, 96.67);
  const g = grenze15({ price: 178200, purchaseCostPct: 6.5, buildingSharePct: 80, spentNet: 25000 });
  near(g.akGebaeude, 151826.4); near(g.limit, 22773.96); assert.equal(g.exceeded, true);
});

test('Fristen: Daten nach Kauf, Zinsbindung und Mieterhöhung', () => {
  const f = fristen({ purchaseDate: '2026-03-15', payoutDate: '2026-04-01', fixedYears: 15, lastRentChange: '2025-01-31' });
  const by = (t: string) => f.find((x) => x.title.startsWith(t))!.date;
  assert.equal(by('Ende der 15-%-Frist'), '2029-03-15');
  assert.equal(by('Verkauf ohne Spekulationssteuer'), '2036-03-16');
  assert.equal(by('Ende der Zinsbindung'), '2041-04-01');
  assert.equal(by('Kündigungsrecht'), '2036-04-01');
  assert.equal(by('Frühestes Vertragsende'), '2036-10-01');
  assert.equal(by('Mieterhöhung bis zur'), '2026-01-31');
  assert.equal(by('Mieterhöhung frühestens wirksam'), '2026-04-30');
  for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].date <= f[i].date);
  assert.equal(iso(addMonths(parseDate('2024-01-31'), 1)), '2024-02-29');
});

test('Kalenderdatei (RFC 5545): ganztägige Termine, CRLF, gefaltete Zeilen', () => {
  const ics = toICS(fristen({ purchaseDate: '2026-03-15' }), { stamp: new Date('2026-10-15T00:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20290315'));
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
});

test('Portfolio: Summen, DSCR und Zinsschock ab Ende der Zinsbindung', () => {
  const objs = [
    { id: 'a', name: 'A', price: 178200, rent: 780, vacancyPct: 2, nonRecoverable: 48, maintenance: 85, loan: 149054.4, interestPct: 3.85, repaymentPct: 2, fixedYears: 10 },
    { id: 'b', name: 'B', price: 250000, rent: 1000, vacancyPct: 0, nonRecoverable: 50, maintenance: 100, loan: 0, interestPct: 0, repaymentPct: 0 },
  ];
  const p = portfolio(objs, { shockPp: 2 });
  near(p.rows[0].noiMonthly, 631.4); near(p.rows[0].cashflow, -95.24);
  assert.equal(p.rows[1].dscr, null); assert.equal(p.rows[1].after, null);
  near(p.total.price, 428200); near(p.total.cashflow, 754.76);
  near(p.rows[0].after!.rate, 737.65); // 5,85 % + 2 % Tilgung auf 112.761,87 €
  near(p.rows[0].after!.cashflow, -106.25);
  assert.equal(p.total.afterCashflow, null);
});

import { GREST, kaufnebenkosten } from '../public/src/calc.mjs';

test('Grunderwerbsteuer: 16 Länder, Stand Oktober 2026', () => {
  assert.equal(Object.keys(GREST).length, 16);
  assert.equal(GREST.bayern.pct, 3.5);
  assert.equal(GREST.bremen.pct, 5.5);
  assert.equal(GREST.hessen.pct, 6.0);
  assert.equal(GREST['nordrhein-westfalen'].pct, 6.5);
  assert.equal(GREST.thueringen.pct, 5.0);
});

test('Kaufnebenkosten Hessen 300.000 € mit Makler 3,57 %', () => {
  const k = kaufnebenkosten({ price: 300000, land: 'hessen', brokerPct: 3.57 })!;
  assert.deepEqual(k.parts.map((p) => p.amount), [18000, 4500, 1500, 10710]);
  near(k.total, 34710); assert.equal(k.totalPct, 11.57); near(k.allIn, 334710);
  assert.equal(kaufnebenkosten({ price: 300000, land: 'atlantis' }), null);
});

import { einstieg } from '../public/src/calc.mjs';

test('Einstieg: Darlehen, Tilgungshebel, Sicherheitsnetz, 10-Jahres-Bild', () => {
  const e = einstieg({ price: 200000, rent: 800, equity: 30000, land: 'bayern', ratePa: 0.036, repaymentPa: 0.02, brokerPct: 0, costSharePct: 15, reserve: 10000, growthPa: 0 })!;
  // Nebenkosten Bayern: 3,5 % + 1,5 % + 0,5 % = 11.000 €; Darlehen 181.000 €
  near(e.nk.total, 11000); near(e.loan, 181000); assert.equal(e.equityCoversCosts, true);
  near(e.rate, 844.67); near(e.firstInterest, 543); near(e.firstPrincipal, 301.67);
  near(e.costs, 120); near(e.cashflow, -164.67); assert.equal(e.reserveMonths, 10); // 10.000 ÷ 964,67
  near(e.repaid10 + e.rest10, 181000);
  assert.equal(einstieg({ price: 0, rent: 1, equity: 1 }), null);
});

test('tilgungsplan: Zinsbindung, Volltilgung, Sondertilgung', async () => {
  const { tilgungsplan, tilgungsplanCSV, balanceAfterMonths } = await import('../public/src/calc.mjs');
  const p = tilgungsplan({ loan: 300000, ratePa: 0.035, repaymentPa: 0.02, fixedYears: 10 })!;
  assert.equal(p.monthly, 1375);
  assert.ok(Math.abs(p.restAtFixed - balanceAfterMonths(300000, 0.035, 0.02, 120)) < 0.05);
  assert.equal(p.months, 348);
  const s = tilgungsplan({ loan: 300000, ratePa: 0.035, repaymentPa: 0.02, fixedYears: 10, specialPa: 5000 })!;
  assert.ok(s.months! < p.months!);
  assert.ok(s.totalInterest < p.totalInterest);
  assert.equal(s.years[0].special, 5000);
  assert.equal(tilgungsplan({ loan: 0, ratePa: 0.03, repaymentPa: 0.02 }), null);
  assert.ok(tilgungsplanCSV(p).startsWith('Jahr;Zinsen;Tilgung;Sondertilgung;Restschuld\r\n1;'));
});

test('budget: Rate → Darlehen → Kaufpreis inkl. Nebenkosten', async () => {
  const { budget } = await import('../public/src/calc.mjs');
  const b = budget({ netIncome: 4000, expenses: 2500, bufferPct: 20, equity: 60000, ratePa: 0.035, repaymentPa: 0.02, land: 'bayern' })!;
  assert.equal(b.rate, 1200);
  assert.ok(Math.abs(b.loan - 261818.18) < 0.01);
  // Bayern 3,5 + 1,5 + 0,5 = 5,5 %
  assert.ok(Math.abs(b.price * 1.055 - (b.loan + 60000)) < 0.05);
  assert.equal(b.equityCoversNk, true);
  const k = budget({ netIncome: 3000, expenses: 2500, rent: 800, rentSharePct: 75, objectCosts: 100, bufferPct: 0, equity: 0, ratePa: 0.04, repaymentPa: 0.02, land: 'berlin' })!;
  assert.equal(k.rate, 1000);
  assert.equal(k.equityCoversNk, false);
  assert.equal(budget({ ratePa: 0.03, repaymentPa: 0.02, land: 'xx' }), null);
});

test('readiness: Anteil, fehlende Punkte, WEG nur bei Miteigentum', async () => {
  const { readiness } = await import('../public/src/calc.mjs');
  const leer = readiness({ name: 'A', price: 300000, rent: 1000 });
  assert.equal(leer.mappeReady, true);
  assert.ok(leer.pct < 40);
  assert.ok(leer.groups.find((g) => g.key === 'unterlagen')!.missing.includes('Mietverträge'));
  assert.equal(leer.groups.find((g) => g.key === 'unterlagen')!.total, 5);
  const voll = readiness({ name: 'B', price: 300000, rent: 1000, area: 70, yearBuilt: 1995, nonRecoverable: 50, maintenance: 60, vacancyPct: 2, equity: 60000,
    loan: 270000, interestPct: 3.5, repaymentPct: 2, fixedYears: 10, grundbuchAmt: 'AG X', grundbuchBlatt: '12', flur: '3', flurstueck: '45', heatingType: 'Gas', energyConsumption: 120, meaTotal: 1000 },
    ['objekt', 'miete', 'grundbuch', 'technik', 'finanzen', 'weg'].map((category) => ({ category })));
  assert.equal(voll.pct, 100);
  assert.equal(readiness({ name: 'C' }).mappeReady, false);
});

test('upcoming: nur künftige Termine, sortiert, mit Objektname', async () => {
  const { upcoming } = await import('../public/src/calc.mjs');
  const u = upcoming([{ id: 'a', name: 'Altbau', purchaseDate: '2024-03-01', fixedYears: 10 }, { id: 'b', name: 'Neubau', purchaseDate: '2026-01-15', payoutDate: '2026-02-01', fixedYears: 15 }],
    { today: new Date('2026-10-15T00:00:00Z'), limit: 3 });
  assert.equal(u.items.length, 3);
  assert.equal(u.items[0].date, '2027-03-01');
  assert.equal(u.items[0].object, 'Altbau');
  assert.ok(u.items.every((x, i, a) => i === 0 || a[i - 1].date <= x.date));
  assert.ok(u.all.every((x) => x.date >= '2026-10-15'));
});

test('scorecard: Ampel je Bereich, ungeprüft bei fehlenden Angaben', async () => {
  const { scorecard } = await import('../public/src/calc.mjs');
  assert.equal(scorecard({}).overall, 'na');
  const s = scorecard({ netIncome: 5000, householdSize: 2, price: 250000, rent: 900, area: 65, land: 'bayern', equity: 60000, ratePct: 3.5, repaymentPct: 2, maintenanceQm: 1.2 });
  // Bayern 3,5 + 1,5 + 0,5 = 5,5 % → 13.750 €; Ziel = 13.750 + 25.000 + 3 × 1.350 = 42.800
  assert.equal(s.eigenkapital.target, 42800);
  assert.equal(s.eigenkapital.status, 'ok');
  assert.equal(s.haushalt.living, 1350);
  assert.equal(s.objekt.status, 'ok');
  assert.equal(s.objekt.yieldPct, 4.32);
  const b = scorecard({ netIncome: 2500, householdSize: 1, price: 250000, rent: 1200, area: 65, land: 'berlin', equity: 10000, ratePct: 4, repaymentPct: 2, maintenanceQm: 0.5, vergleichsmieteQm: 12, mietpreisbremse: true });
  assert.equal(b.eigenkapital.status, 'bad');
  assert.equal(b.objekt.cap, 858);
  assert.equal(b.objekt.status, 'bad');
  assert.equal(b.overall, 'bad');
});

test('rank: Stufen aus Profil, Bankreife und Bestand', async () => {
  const { rank } = await import('../public/src/calc.mjs');
  const today = new Date('2026-10-15T00:00:00Z');
  assert.equal(rank({}, [], [], today).level, 1);
  assert.match(rank({}, [], [], today).next!, /Finanzprofil/);
  const o = { id: 'o', name: 'A', price: 300000, rent: 1000, area: 70, yearBuilt: 1990, nonRecoverable: 50, maintenance: 60, vacancyPct: 2, equity: 50000, loan: 0 };
  assert.equal(rank({ netIncome: 4000, equity: 50000 }, [o], [], today).level, 1); // 47 % Bankreife
  const docs = ['objekt', 'miete', 'grundbuch', 'technik', 'finanzen'].map((category) => ({ object_ref: 'o', category }));
  const full = { ...o, grundbuchAmt: 'AG', grundbuchBlatt: '1', flur: '1', flurstueck: '2', heatingType: 'Gas', energyConsumption: 100 };
  assert.equal(rank({ netIncome: 4000, equity: 50000 }, [full], [], today).level, 2); // 71 %
  assert.equal(rank({ netIncome: 4000, equity: 50000 }, [full], docs, today).level, 3);
  const bh = rank({}, [{ id: 'b', purchaseDate: '2025-01-01', fixedYears: 10 }], [], today);
  assert.equal(bh.name, 'Bestandshalter');
  assert.match(bh.next!, /Finanzprofil/); // offene Stufen bleiben sichtbar
});

test('cashflowSteuer: AfA, Steuerwirkung, Jahr 1', async () => {
  const { cashflowSteuer } = await import('../public/src/calc.mjs');
  const c = cashflowSteuer({ price: 300000, land: 'bayern', equity: 60000, ratePa: 0.035, repaymentPa: 0.02, rent: 1000, nonRecoverable: 50, maintenance: 50, buildingSharePct: 80, afaPct: 2, taxPct: 40, years: 10 })!;
  // AK 316.500 × 80 % × 2 % = 5.064
  assert.equal(c.afa, 5064);
  assert.equal(c.loan, 256500);
  const y1 = c.rows[0];
  assert.ok(Math.abs(y1.before - (12000 - 1200 - y1.interest - y1.principal)) < 0.02);
  assert.ok(Math.abs(y1.tax - (12000 - 1200 - y1.interest - 5064) * 0.4) < 0.02);
  assert.equal(c.rows.length, 10);
});

test('angebot und kaufenMieten: Kennzahlen und Plausibilität', async () => {
  const { angebot, kaufenMieten } = await import('../public/src/calc.mjs');
  const a = angebot({ price: 200000, rent: 800, area: 60, land: 'hessen', equity: 40000, ratePa: 0.035, repaymentPa: 0.02 })!;
  assert.equal(a.factor, 20.8);
  assert.equal(a.grossYieldPct, 4.8);
  assert.equal(a.pricePerQm, 3333.33);
  const k = kaufenMieten({ price: 400000, land: 'hessen', equity: 100000, ratePa: 0.035, repaymentPa: 0.025, ownerCosts: 250, rent: 1400, years: 25 })!;
  assert.equal(k.rows.length, 25);
  assert.ok(k.rows[24].debt < k.rows[0].debt);
  // ohne Wertsteigerung und mit hoher Anlagerendite verliert der Käufer eher
  const k2 = kaufenMieten({ price: 400000, land: 'hessen', equity: 100000, ratePa: 0.035, repaymentPa: 0.025, ownerCosts: 250, rent: 1400, valueGrowthPct: 0, investPct: 7, years: 25 })!;
  assert.ok(k2.end.buyer < k.end.buyer);
});

test('afaPlan: linear, degressiv, Sonder-AfA § 7b', async () => {
  const { afaPlan } = await import('../public/src/calc.mjs');
  const l = afaPlan({ ak: 300000, linearPct: 2, years: 10 })!;
  assert.equal(l.rows[0].regular, 6000);
  assert.equal(l.total, 60000);
  const d = afaPlan({ ak: 300000, method: 'degressiv', years: 2 })!;
  assert.equal(d.rows[0].regular, 15000);
  assert.equal(d.rows[1].regular, 14250);
  // § 7b: Bemessung höchstens 4.000 €/m² → 70 m² = 280.000; 5 % = 14.000 je Jahr, 4 Jahre
  const s = afaPlan({ ak: 300000, linearPct: 3, years: 10, sonder: true, area: 70, baukostenQm: 4300 })!;
  assert.equal(s.rows[0].extra, 14000);
  assert.equal(s.extra, 56000);
  assert.equal(s.rows[4].extra, 0);
  const no = afaPlan({ ak: 400000, linearPct: 3, years: 4, sonder: true, area: 70, baukostenQm: 5700 })!;
  assert.equal(no.s7b!.eligible, false);
  assert.equal(no.extra, 0);
});

test('mieterhoehung: Kappungsgrenze, Vergleichsmiete, Wirksamkeit', async () => {
  const { mieterhoehung } = await import('../public/src/calc.mjs');
  const m = mieterhoehung({ rent: 800, area: 70, vergleichQm: 13, rent3y: 750, capPct: 15, lastChange: '2025-06-01', sendDate: '2026-10-20' })!;
  assert.equal(m.byMarket, 910);
  assert.equal(m.byCap, 862.5);
  assert.equal(m.max, 862.5);
  assert.equal(m.limitedBy, 'kappung');
  assert.equal(m.earliestRequest, '2026-06-01');
  assert.equal(m.effective, '2027-01-01'); // Zugang Oktober → Beginn des dritten Monats danach
  const early = mieterhoehung({ rent: 800, area: 70, vergleichQm: 13, lastChange: '2025-12-15', sendDate: '2026-01-10' })!;
  assert.equal(early.sendUsed, '2026-12-15');
  assert.equal(early.effective, '2027-03-15'); // 15 Monate nach letzter Erhöhung
});

test('analyse: Kernkennzahlen, Mietspiegel, Break-even, Hinweise', async () => {
  const { analyse } = await import('../public/src/calc.mjs');
  const a = analyse({ price: 300000, area: 75, land: 'hessen', brokerPct: 3.57, rent: 1000, vergleichQm: 14, mietpreisbremse: true, vacancyPct: 2,
    nonRecoverable: 60, maintenanceQm: 1, equity: 60000, ratePct: 3.5, repaymentPct: 2, buildingSharePct: 75, afaPct: 2, taxPct: 42, yearBuilt: 1970, energyClass: 'G' })!;
  assert.equal(a.pricePerQm, 4000);
  assert.equal(a.rentMarket, 1050);
  assert.equal(a.rentCap, 1155);
  assert.equal(a.factor, 25);
  assert.equal(a.grossYield, 4);
  assert.equal(a.loan, 274710);
  // Break-even-Miete = (Rate + 60 + 75) / 0,98
  assert.ok(Math.abs(a.rentBreakEven! - (a.rate + 135) / 0.98) < 0.02);
  assert.ok(a.hints.some((h) => h.includes('1977')));
  assert.ok(a.hints.some((h) => h.includes('Effizienzklasse G')));
  const m = analyse({ price: 300000, area: 75, land: 'hessen', vergleichQm: 14, equity: 50000, ratePct: 3.5, repaymentPct: 2 })!;
  assert.equal(m.rentSource, 'mietspiegel');
  assert.equal(m.rent, 1050);
  assert.equal(analyse({ price: 0, land: 'hessen' }), null);
});

test('portalLinks: geprüfte URL-Formate der Portale', async () => {
  const { portalLinks } = await import('../public/src/calc.mjs');
  const w = portalLinks({ land: 'hessen', kreis: '', ort: 'Frankfurt am Main', art: 'wohnung', maxPrice: 300000, minArea: 40, minRooms: 2 });
  assert.equal(w[0].url, 'https://www.immobilienscout24.de/Suche/de/hessen/frankfurt-am-main/wohnung-kaufen?livingspace=40.0-&numberofrooms=2.0-&price=-300000.0');
  assert.equal(w[1].url, 'https://www.immowelt.de/suche/frankfurt-am-main/wohnungen/kaufen?roomi=2');
  assert.equal(w[2].url, 'https://www.kleinanzeigen.de/s-wohnung-kaufen/frankfurt-am-main/k0c196');
  const h = portalLinks({ land: 'hessen', kreis: 'Offenbach', ort: 'Langen (Hessen)', art: 'haus', maxPrice: 0, minArea: 0, minRooms: 0 });
  assert.equal(h[0].url, 'https://www.immobilienscout24.de/Suche/de/hessen/offenbach-kreis/langen-hessen/haus-kaufen');
  assert.equal(h[1].url, 'https://www.immowelt.de/suche/langen-hessen/haeuser/kaufen');
  const k = portalLinks({ land: 'nordrhein-westfalen', kreis: '', ort: 'Köln', art: 'mfh', maxPrice: 0, minArea: 0, minRooms: 0 });
  assert.equal(k[0].url, 'https://www.immobilienscout24.de/Suche/de/nordrhein-westfalen/koeln/mehrfamilienhaeuser');
  assert.equal(k[2].url, 'https://www.kleinanzeigen.de/s-haus-kaufen/mehrfamilienhaus-k%C3%B6ln/k0c208');
  const b = portalLinks({ land: 'berlin', kreis: '', ort: 'Berlin', art: 'wohnung', maxPrice: 0, minArea: 0, minRooms: 0 });
  assert.equal(b[0].url, 'https://www.immobilienscout24.de/Suche/de/berlin/berlin/wohnung-kaufen');
  const r = portalLinks({ land: 'hessen', kreis: '', ort: 'Darmstadt', art: 'wohnung', minPrice: 150000, maxPrice: 300000, minArea: 0, minRooms: 0 });
  assert.equal(r[0].url, 'https://www.immobilienscout24.de/Suche/de/hessen/darmstadt/wohnung-kaufen?price=150000.0-300000.0');
  const m = portalLinks({ land: 'hessen', kreis: '', ort: 'Darmstadt', art: 'wohnung', minPrice: 150000, maxPrice: 0, minArea: 0, minRooms: 0 });
  assert.equal(m[0].url, 'https://www.immobilienscout24.de/Suche/de/hessen/darmstadt/wohnung-kaufen?price=150000.0-');
});

test('verbilligteMiete: Stufen 66 % / 50 % / darunter', async () => {
  const { verbilligteMiete } = await import('../public/src/calc.mjs');
  assert.equal(verbilligteMiete({ ist: 700, ortsueblich: 1000 }).stufe, 'voll');
  assert.equal(verbilligteMiete({ ist: 660, ortsueblich: 1000 }).stufe, 'voll');
  assert.equal(verbilligteMiete({ ist: 600, ortsueblich: 1000 }).stufe, 'prognose');
  const u = verbilligteMiete({ ist: 400, ortsueblich: 1000 });
  assert.equal(u.stufe, 'anteilig'); assert.equal(u.abzugPct, 40);
  assert.equal(verbilligteMiete({ ist: 500, ortsueblich: 1000 }).mindestMiete66, 660);
  assert.equal(verbilligteMiete({ ist: 0, ortsueblich: 0 }), null);
});

test('dreiObjektGrenze: >3 Verkäufe in 5 Jahren', async () => {
  const { dreiObjektGrenze } = await import('../public/src/calc.mjs');
  const ok = dreiObjektGrenze(['2021-01-01', '2022-01-01', '2023-01-01']);
  assert.equal(ok.risiko, false); assert.equal(ok.maxImFenster, 3);
  const bad = dreiObjektGrenze(['2021-01-01', '2022-01-01', '2023-01-01', '2024-01-01']);
  assert.equal(bad.risiko, true); assert.equal(bad.maxImFenster, 4);
  const spread = dreiObjektGrenze(['2010-01-01', '2016-01-01', '2022-01-01', '2028-01-01']);
  assert.equal(spread.risiko, false);
  assert.equal(dreiObjektGrenze([]).anzahl, 0);
});

test('verkaufSteuerfrei: 10 Jahre und Eigennutzung', async () => {
  const { verkaufSteuerfrei } = await import('../public/src/calc.mjs');
  const a = verkaufSteuerfrei({ anschaffung: '2015-03-01' });
  assert.equal(a.fristEnde, '2025-03-01'); assert.equal(a.steuerfreiAb, '2025-03-02'); assert.equal(a.steuerfrei, false);
  assert.equal(verkaufSteuerfrei({ anschaffung: '2015-03-01', verkauf: '2025-03-01' }).steuerfrei, false); // Jahrestag noch in der Frist
  assert.equal(verkaufSteuerfrei({ anschaffung: '2015-03-01', verkauf: '2025-03-02' }).steuerfrei, true);
  assert.equal(verkaufSteuerfrei({ anschaffung: '2020-01-01', verkauf: '2024-01-01' }).steuerfrei, false);
  const e = verkaufSteuerfrei({ anschaffung: '2020-01-01', verkauf: '2024-01-01', eigengenutzt: true });
  assert.equal(e.steuerfrei, true); assert.match(e.grund, /Eigennutzung/);
  assert.equal(verkaufSteuerfrei({ anschaffung: '' }), null);
});
