import { test } from 'node:test';
import assert from 'node:assert/strict';

test('usNum: US number formats (and tolerant of European ones)', async () => {
  const { usNum, deNum } = await import('../public/src/listing-parse.mjs');
  assert.equal(usNum('349,000'), 349000);
  assert.equal(usNum('$1,234.56'), 1234.56);
  assert.equal(usNum('3.5'), 3.5);
  assert.equal(usNum('$1.2M'), 1200000);
  assert.equal(usNum('425K'), 425000);
  assert.equal(usNum('349.000'), 349000);
  assert.equal(usNum('abc'), null);
  assert.equal(deNum, usNum);
});

test('parseListing: Zillow-style text (label above value)', async () => {
  const { parseListing } = await import('../public/src/listing-parse.mjs');
  const t = ['$349,000', '3 bd 2 ba 1,450 sqft', '1234 Oak Ridge Dr, Austin, TX 78745', 'Est.: $2,310/mo',
    'Facts & features', 'Year built', 'Built in 1995', 'HOA', '$45 monthly', 'Annual tax amount', '$6,820', 'Rent Zestimate®', '$2,100/mo'].join('\n');
  const r = parseListing({ u: 'https://www.zillow.com/homedetails/1234-Oak-Ridge-Dr-Austin-TX-78745/123_zpid/', ti: '1234 Oak Ridge Dr, Austin, TX 78745 | Zillow', t });
  assert.equal(r.portal, 'Zillow');
  assert.equal(r.price, 349000);
  assert.equal(r.area, 1450);
  assert.equal(r.rooms, 3);
  assert.equal(r.baths, 2);
  assert.equal(r.year, 1995);
  assert.equal(r.hausgeld, 45);
  assert.equal(r.taxesAnnual, 6820);
  assert.equal(r.rent, 2100);
  assert.equal(r.plz, '78745');
  assert.equal(r.city, 'Austin');
  assert.equal(r.state, 'TX');
  assert.equal(r.art, 'SFR');
  assert.deepEqual(r.missing, []);
});

test('parseListing: label and value on one line, annual rents, duplex', async () => {
  const { parseListing } = await import('../public/src/listing-parse.mjs');
  const t = ['Duplex - 2 units', 'List Price: $415,000', '2210 Elm St, Columbus, OH 43211', 'Living area: 1,980 sq ft', 'Year built: 1924', 'Gross scheduled income: $30,000/yr', 'HOA: None'].join('\n');
  const r = parseListing({ u: 'https://www.redfin.com/OH/Columbus/2210-Elm-St-43211/home/1', ti: '', t });
  assert.equal(r.price, 415000);
  assert.equal(r.area, 1980);
  assert.equal(r.rent, 2500);
  assert.equal(r.hausgeld, 0);
  assert.equal(r.art, 'MFH');
  assert.equal(r.units, 2);
  assert.equal(r.state, 'OH');
});

test('parseListing: JSON-LD, invalid URL and rental listing', async () => {
  const { parseListing, bookmarklet } = await import('../public/src/listing-parse.mjs');
  const j = JSON.stringify({ '@type': 'SingleFamilyResidence', offers: { price: '289000' }, floorSize: { value: 1210 }, numberOfBedrooms: 3, address: { postalCode: '30310', addressLocality: 'Atlanta', addressRegion: 'GA', streetAddress: '15 Pine St' } });
  const r = parseListing({ u: 'javascript:alert(1)', t: '', j });
  assert.equal(r.url, '');
  assert.equal(r.price, 289000);
  assert.equal(r.area, 1210);
  assert.equal(r.city, 'Atlanta');
  assert.equal(r.state, 'GA');
  const m = parseListing({ u: 'https://www.zillow.com/homes/for_rent/abc', t: 'Rent\n$1,800/mo\nSecurity deposit\n$1,800' });
  assert.equal(m.warnings.length, 1);
  assert.equal(m.rent, null);
  assert.ok(bookmarklet('https://leaserun.com').startsWith('javascript:'));
  assert.ok(!/[^\x20-\x7e]/.test(decodeURIComponent(bookmarklet('https://leaserun.com'))));
});

test('Listing: contact details of agents/sellers are never used as the title', async () => {
  const { parseListing, hasPII } = await import('../public/src/listing-parse.mjs');
  const t = 'Listed by: Jane Smith, Sunrise Realty LLC (512) 555-0134 jane@sunrise.example\nPrice $249,000\n1,050 sqft\n2 beds\nAustin, TX 78701';
  const r = parseListing({ u: '', t, ti: '' });
  assert.equal(r.price, 249000);
  assert.ok(!/Smith|555|@/.test(r.title + r.name), r.title + ' | ' + r.name);
  assert.ok(hasPII('Contact: Mr. Example'));
  assert.ok(!hasPII('Bright 3-bedroom home with a fenced yard'));
});
