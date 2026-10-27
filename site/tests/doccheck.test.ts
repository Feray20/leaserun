import { test } from 'node:test';
import assert from 'node:assert/strict';

const M = () => import('../public/src/doc-check.mjs');
const recent = () => { const d = new Date(Date.now() - 5 * 864e5); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; };

test('Pay stub: gross and net pay', async () => {
  const { analyseText } = await M();
  const r = analyseText(`Acme Corp\nEarnings Statement\nPay Date ${recent()}\nGross Pay $4,850.00\nFederal Income Tax 612.33\nSocial Security 300.70\nMedicare 70.33\nNet Pay $3,612.45\nYTD Gross 48,500.00`);
  assert.equal(r.type, 'gehalt');
  assert.equal(r.values.brutto, 4850);
  assert.equal(r.values.netto, 3612.45);
  assert.equal(r.values.ytd, 48500);
  assert.ok(!r.findings.some(([s]) => s === 'bad'));
});

test('Title commitment: lis pendens and existing deed of trust', async () => {
  const { analyseText } = await M();
  const r = analyseText('Commitment for Title Insurance\nSchedule A\nVested in: John Sample, fee simple\nLegal description: Lot 4, Block 2, APN 123-45-678\nSchedule B Exceptions\n1. Easement for utilities recorded 1998\n2. Lis pendens recorded 01/05/2020\n3. Deed of Trust securing $250,000.00 to First Bank\nEffective date 01/10/2020');
  assert.equal(r.type, 'grundbuch');
  assert.ok(r.values.lasten.includes('Easement'));
  assert.ok(r.values.lasten.some((x: string) => /Lis pendens/.test(x)));
  assert.deepEqual(r.values.grundschulden, [250000]);
  assert.ok(r.findings.some(([s]) => s === 'bad'));
  assert.ok(r.findings.some(([s, t]) => s === 'warn' && /updated commitment/.test(t)));
});

test('Home inspection: major items', async () => {
  const { analyseText } = await M();
  const r = analyseText('HOME INSPECTION REPORT\nInspector: ASHI certified\nRoof: shingles near end of life, replace within 2 years\nElectrical: Federal Pacific panel – safety concern\nPlumbing: minor leak under sink');
  assert.equal(r.type, 'energie');
  assert.ok(r.values.issues.includes('Roof'));
  assert.ok(r.values.issues.includes('Electrical'));
  assert.ok(r.findings.some(([s]) => s === 'bad'));
});

test('Scan without text and unknown document', async () => {
  const { analyseText } = await M();
  assert.equal(analyseText('   ').type, 'scan');
  assert.equal(analyseText('Invitation to the summer barbecue of the soccer club on Saturday with music.').type, 'unbekannt');
});

test('Case summary and missing documents', async () => {
  const { analyseText, caseFacts, missingDocs } = await M();
  const docs = [
    analyseText(`Earnings Statement ${recent()}\nGross Pay 4,000.00\nFederal Income Tax 500.00\nNet Pay 2,800.00`),
    analyseText(`Earnings Statement ${recent()}\nGross Pay 4,000.00\nFederal Income Tax 500.00\nNet Pay 3,000.00`),
    analyseText('Annual Budget 2026\nHomeowners Association\nMonthly assessment $320.00\nReserve fund balance $85,000.00'),
    analyseText('Residential Purchase Agreement\nBuyer: A\nSeller: B\nThe purchase price is $389,000.00\nEarnest money deposit $5,000\nInspection period: 10 days'),
  ];
  const f = caseFacts(docs);
  assert.equal(f.nettoMonat, 2900);
  assert.equal(f.bruttoMonat, 4000);
  assert.equal(f.kaufpreis, 389000);
  assert.equal(f.hausgeld, 320);
  assert.equal(f.etw, true);
  const miss = missingDocs(docs.map((d) => d.type), f);
  assert.ok(miss.includes('Title commitment'));
  assert.ok(miss.includes('CC&Rs / condo declaration'));
  assert.ok(!miss.some((x) => /Pay stubs/.test(x)));
});
