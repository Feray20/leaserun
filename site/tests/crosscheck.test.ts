import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossCheck, quality } from '../public/src/doc-check.mjs';

test('Cross-check: different purchase price in listing and purchase agreement is detected', () => {
  const r = crossCheck([
    { type: 'expose', label: 'Listing', name: 'listing.pdf', values: { kaufpreis: 400000, flaeche: 1600 } },
    { type: 'kaufvertrag', label: 'Purchase agreement', name: 'contract.pdf', values: { kaufpreis: 405000 } },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].key, 'kaufpreis');
  assert.equal(r[0].differs, true);
  assert.deepEqual(r[0].hits.map((h) => h.name), ['listing.pdf', 'contract.pdf']);
});

test('Cross-check: equal values and rounding within tolerance are not a difference', () => {
  const r = crossCheck([
    { type: 'expose', label: 'Listing', values: { kaufpreis: 400000, flaeche: 1600 } },
    { type: 'kaufvertrag', label: 'Purchase agreement', values: { kaufpreis: 400000 } },
    { type: 'flaeche', label: 'Appraisal report', values: { flaeche: 1630 } },
  ]);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => !x.differs));
});

test('Cross-check: a value in only one document gives no comparison; quality levels', () => {
  assert.equal(crossCheck([{ type: 'expose', values: { kaufpreis: 1 } }]).length, 0);
  assert.equal(quality(0.9), 'high'); assert.equal(quality(0.6), 'medium'); assert.equal(quality(0.2), 'low');
});
