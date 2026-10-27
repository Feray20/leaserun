import { test } from 'node:test';
import assert from 'node:assert/strict';

test('deNum: deutsche Zahlenformate', async () => {
  const { deNum } = await import('../public/src/listing-parse.mjs');
  assert.equal(deNum('349.000'), 349000);
  assert.equal(deNum('72,5'), 72.5);
  assert.equal(deNum('1.234,56'), 1234.56);
  assert.equal(deNum('3.5'), 3.5);
  assert.equal(deNum('1 250'), 1250);
  assert.equal(deNum('abc'), null);
});

test('parseListing: Label über Wert (Exposé-Layout)', async () => {
  const { parseListing } = await import('../public/src/listing-parse.mjs');
  const t = ['Gepflegte 3-Zimmer-Wohnung mit Balkon', 'Heinrichstr. 10, 64283 Darmstadt, Bessungen', 'Kaufpreis', '349.000 €', 'Preis/m²', '4.847 €/m²',
    'Wohnfläche ca.', '72 m²', 'Zimmer', '3', 'Baujahr', '1995', 'Hausgeld', '310 €', 'Mieteinnahmen pro Monat', '850 €', 'Provision für Käufer', '3,57 % inkl. MwSt.',
    'Energieeffizienzklasse', 'C'].join('\n');
  const r = parseListing({ u: 'https://www.immobilienscout24.de/expose/123456789', ti: 'Gepflegte 3-Zimmer-Wohnung | ImmoScout24', t });
  assert.equal(r.portal, 'ImmoScout24');
  assert.equal(r.price, 349000);
  assert.equal(r.area, 72);
  assert.equal(r.rooms, 3);
  assert.equal(r.year, 1995);
  assert.equal(r.hausgeld, 310);
  assert.equal(r.rent, 850);
  assert.equal(r.brokerPct, 3.57);
  assert.equal(r.energyClass, 'C');
  assert.equal(r.plz, '64283');
  assert.equal(r.city, 'Darmstadt');
  assert.equal(r.art, 'ETW');
  assert.deepEqual(r.missing, []);
});

test('parseListing: Label und Wert in einer Zeile, Jahresmiete, Preis ohne Label', async () => {
  const { parseListing } = await import('../public/src/listing-parse.mjs');
  const t = ['Mehrfamilienhaus mit 6 Einheiten', '1.150.000 € VB', '04109 Leipzig - Zentrum', 'Wohnfläche 410 m²', 'Zimmer 18', 'Baujahr 1912', 'Mieteinnahmen p.a. 54.000 €', 'Provisionsfrei'].join('\n');
  const r = parseListing({ u: 'https://www.kleinanzeigen.de/s-anzeige/mfh/123-208-1', ti: 'Mehrfamilienhaus mit 6 Einheiten', t });
  assert.equal(r.price, 1150000);
  assert.equal(r.area, 410);
  assert.equal(r.rooms, 18);
  assert.equal(r.rent, 4500);
  assert.equal(r.brokerPct, 0);
  assert.equal(r.city, 'Leipzig');
  assert.equal(r.art, 'MFH');
});

test('parseListing: JSON-LD, ungültige URL und Mietangebot', async () => {
  const { parseListing, bookmarklet } = await import('../public/src/listing-parse.mjs');
  const j = JSON.stringify({ '@type': 'Apartment', offers: { price: '289000' }, floorSize: { value: 61.5 }, numberOfRooms: 2, address: { postalCode: '50667', addressLocality: 'Köln' } });
  const r = parseListing({ u: 'javascript:alert(1)', t: '', j });
  assert.equal(r.url, '');
  assert.equal(r.price, 289000);
  assert.equal(r.area, 61.5);
  assert.equal(r.city, 'Köln');
  const m = parseListing({ u: 'https://www.immowelt.de/expose/abc', t: 'Kaltmiete\n800 €\nKaution\n2.400 €' });
  assert.equal(m.warnings.length, 1);
  assert.ok(bookmarklet('https://leaserun.com').startsWith('javascript:'));
  assert.ok(!/[^\x20-\x7e]/.test(decodeURIComponent(bookmarklet('https://leaserun.com'))));
});

test('parseListing: Exposé-Text mit Kaltmiete und Jahresnettokaltmiete', async () => {
  const { parseListing } = await import('../public/src/listing-parse.mjs');
  const a = parseListing({ u: '', ti: 'Exposé', t: ['Exposé', 'Vermietete 2-Zimmer-Wohnung', '10115 Berlin', 'Kaufpreis: 289.000 €', 'Wohnfläche: ca. 58 m²', 'Zimmer: 2', 'Kaltmiete: 720 €', 'Baujahr: 1965'].join('\n') });
  assert.equal(a.price, 289000); assert.equal(a.area, 58); assert.equal(a.rent, 720); assert.equal(a.city, 'Berlin');
  const b = parseListing({ u: '', t: ['Kaufpreis 1.250.000 €', 'Jahresnettokaltmiete 66.000 €', 'Wohnfläche 520 m²'].join('\n') });
  assert.equal(b.rent, 5500);
  const c = parseListing({ u: '', t: 'Kaltmiete 800 €\nKaution 2.400 €' });
  assert.equal(c.rent, null);
});

test('Exposé: Kontaktdaten von Makler/Verkäufer werden nicht als Titel übernommen', async () => {
  const { parseListing, hasPII } = await import('../public/src/listing-parse.mjs');
  const t = 'Max Mustermann Immobilien GmbH · Tel. 06151 123456 · max@makler.de\nKaufpreis 249.000 €\nWohnfläche 64 m²\nZimmer 2\n64283 Darmstadt';
  const r = parseListing({ u: '', t, ti: '' });
  assert.equal(r.price, 249000);
  assert.ok(!/Mustermann|06151|@/.test(r.title + r.name), r.title + ' | ' + r.name);
  assert.ok(hasPII('Ansprechpartner: Frau Beispiel'));
  assert.ok(!hasPII('Helle 3-Zimmer-Wohnung mit Balkon'));
});
