import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, splitStreet, checkAddress, stateOfZip } from '../lib/address.ts';

test('Address: split house number and street, normalize USPS abbreviations', async () => {
  assert.deepEqual(splitStreet('123 Main St'), { name: 'Main St', no: '123' });
  assert.deepEqual(splitStreet('1600B Oak Avenue'), { name: 'Oak Avenue', no: '1600B' });
  assert.deepEqual(splitStreet('Main Street'), { name: 'Main Street', no: '' });
  assert.equal(norm('123 Main Street'), norm('123 main st.'));
  assert.equal(norm('North Oak Boulevard'), norm('N Oak Blvd'));
  assert.equal(stateOfZip('78701'), 'TX');
  assert.equal(stateOfZip('10001-1234'), 'NY');
  assert.equal(stateOfZip('90210'), 'CA');
  assert.equal(stateOfZip('20001'), 'DC');
  const bad = await checkAddress({ postalCode: '1234' });
  assert.equal(bad.plzValid, false);
});
