import { test } from 'node:test';
import assert from 'node:assert/strict';

const M = () => import('../public/src/doc-check.mjs');
const thisMonth = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

test('Gehaltsabrechnung: Netto und Brutto', async () => {
  const { analyseText } = await M();
  const r = analyseText(`Muster GmbH\nEntgeltabrechnung für ${thisMonth()}\nSteuerklasse 1\nGesamt-Brutto 4.850,00 €\nLohnsteuer 812,33\nRentenversicherung 451,05\nAuszahlungsbetrag 3.012,45 €`);
  assert.equal(r.type, 'gehalt');
  assert.equal(r.values.brutto, 4850);
  assert.equal(r.values.netto, 3012.45);
  assert.ok(!r.findings.some(([s]) => s === 'bad'));
});

test('Grundbuch: Lasten in Abt. II und Grundschuld', async () => {
  const { analyseText } = await M();
  const r = analyseText('Amtsgericht Darmstadt Grundbuch von Reinheim Blatt 1234\nBestandsverzeichnis Gemarkung Reinheim Flur 3\nAbteilung I Eigentümer: Max Muster\nAbteilung II: Wegerecht für den jeweiligen Eigentümer\nAbteilung III: Grundschuld ohne Brief zu 250.000,00 EUR für Sparkasse\nAbruf vom 01.01.2020');
  assert.equal(r.type, 'grundbuch');
  assert.deepEqual(r.values.lasten, ['Wegerecht']);
  assert.deepEqual(r.values.grundschulden, [250000]);
  assert.ok(r.findings.some(([s, t]) => s === 'warn' && /3 Monate/.test(t)));
});

test('Energieausweis: Klasse, Verbrauch, abgelaufen', async () => {
  const { analyseText } = await M();
  const r = analyseText('ENERGIEAUSWEIS für Wohngebäude gemäß Gebäudeenergiegesetz (GEG)\nGültig bis: 12.03.2021\nEndenergieverbrauch dieses Gebäudes 182,4 kWh/(m²·a)\nEnergieeffizienzklasse F');
  assert.equal(r.type, 'energie');
  assert.equal(r.values.klasse, 'F');
  assert.equal(r.values.kwh, 182.4);
  assert.equal(r.values.art, 'Verbrauchsausweis');
  assert.ok(r.findings.some(([s]) => s === 'bad'));
});

test('Scan ohne Text und unbekanntes Dokument', async () => {
  const { analyseText } = await M();
  assert.equal(analyseText('   ').type, 'scan');
  assert.equal(analyseText('Einladung zum Sommerfest des Vereins am Samstag mit Grillen und Musik.').type, 'unbekannt');
});

test('Fallbild und fehlende Unterlagen', async () => {
  const { analyseText, caseFacts, missingDocs } = await M();
  const docs = [
    analyseText(`Verdienstabrechnung ${thisMonth()}\nSteuerklasse 4\nGesamtbrutto 4.000,00\nLohnsteuer 500,00\nAuszahlungsbetrag 2.800,00`),
    analyseText(`Verdienstabrechnung ${thisMonth()}\nSteuerklasse 4\nGesamtbrutto 4.000,00\nLohnsteuer 500,00\nAuszahlungsbetrag 3.000,00`),
    analyseText('Wirtschaftsplan 2026\nHausgeld monatlich 320,00 €\nErhaltungsrücklage Stand 8.500,00 €'),
    analyseText('Kaufvertragsentwurf Urkunde Notar Dr. X\nVerkäufer: A\nKäufer: B\nDer Kaufpreis beträgt 389.000,00 EUR'),
  ];
  const f = caseFacts(docs);
  assert.equal(f.nettoMonat, 2900);
  assert.equal(f.kaufpreis, 389000);
  assert.equal(f.hausgeld, 320);
  assert.equal(f.etw, true);
  const miss = missingDocs(docs.map((d) => d.type), f);
  assert.ok(miss.includes('Grundbuchauszug'));
  assert.ok(miss.includes('Teilungserklärung'));
  assert.ok(!miss.some((x) => /Gehalts/.test(x)));
});
