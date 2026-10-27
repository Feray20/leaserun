import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, splitStreet, checkAddress } from '../lib/address.ts';

test('Adresse: Straße und Hausnummer trennen, Schreibweisen angleichen', async () => {
  assert.deepEqual(splitStreet('Georg-August-Zinn-Str. 25'), { name: 'Georg-August-Zinn-Str.', no: '25' });
  assert.deepEqual(splitStreet('Hauptstraße 12a'), { name: 'Hauptstraße', no: '12a' });
  assert.deepEqual(splitStreet('Am Markt 3-5'), { name: 'Am Markt', no: '3-5' });
  assert.deepEqual(splitStreet('Hauptstraße'), { name: 'Hauptstraße', no: '' });
  assert.equal(norm('Georg-August-Zinn-Str.'), norm('Georg-August-Zinn-Straße'));
  assert.equal(norm('Muehlweg'), norm('Mühlweg'));
  const bad = await checkAddress({ postalCode: '1234' });
  assert.equal(bad.plzValid, false);
});
