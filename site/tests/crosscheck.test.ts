import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossCheck, quality } from '../public/src/doc-check.mjs';

test('Abgleich: abweichender Kaufpreis zwischen Exposé und Kaufvertrag wird erkannt', () => {
  const r = crossCheck([
    { type: 'expose', label: 'Exposé', name: 'expose.pdf', values: { kaufpreis: 400000, flaeche: 80 } },
    { type: 'kaufvertrag', label: 'Kaufvertrag', name: 'kv.pdf', values: { kaufpreis: 405000 } },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].key, 'kaufpreis');
  assert.equal(r[0].differs, true);
  assert.deepEqual(r[0].hits.map((h) => h.name), ['expose.pdf', 'kv.pdf']);
});

test('Abgleich: gleiche Werte und Rundung innerhalb der Toleranz sind keine Abweichung', () => {
  const r = crossCheck([
    { type: 'expose', label: 'Exposé', values: { kaufpreis: 400000, flaeche: 80 } },
    { type: 'kaufvertrag', label: 'Kaufvertrag', values: { kaufpreis: 400000 } },
    { type: 'flaeche', label: 'Wohnflächenberechnung', values: { flaeche: 81.5 } },
  ]);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => !x.differs));
});

test('Abgleich: nur ein Dokument mit dem Wert ergibt keinen Vergleich; Qualitätsstufen', () => {
  assert.equal(crossCheck([{ type: 'expose', values: { kaufpreis: 1 } }]).length, 0);
  assert.equal(quality(0.9), 'hoch'); assert.equal(quality(0.6), 'mittel'); assert.equal(quality(0.2), 'niedrig');
});
