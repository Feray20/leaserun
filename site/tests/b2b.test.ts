import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentLinkPayload, totals } from '../lib/b2b/epc';
import { buchungsstapel, ustJournal } from '../lib/b2b/datev';

test('Invoice totals: no VAT by default, amounts in cents', () => {
  const t = totals([{ description: 'Basic', quantity: 1, unitNetCents: 7900 }, { description: 'Packages', quantity: 3, unitNetCents: 1000 }]);
  assert.deepEqual(t, { net: 10900, vat: 0, gross: 10900 });
});

test('Sales tax rate is applied when given', () => {
  assert.deepEqual(totals([{ description: 'Pro', quantity: 1, unitNetCents: 14900 }], 6.25), { net: 14900, vat: 931, gross: 15831 });
});

test('Void invoice gives negative totals', () => {
  assert.deepEqual(totals([{ description: 'x', quantity: 1, unitNetCents: -14900 }]), { net: -14900, vat: 0, gross: -14900 });
});

test('Payment link QR payload: https only, reference and amount appended', () => {
  const p = paymentLinkPayload({ url: 'https://pay.leaserun.com/b/test', cents: 7900, reference: 'INV-2026-10-00001' });
  const u = new URL(p);
  assert.equal(u.searchParams.get('client_reference_id'), 'INV-2026-10-00001');
  assert.equal(u.searchParams.get('amount'), '79.00');
  assert.equal(paymentLinkPayload({ url: 'http://pay.example.com', cents: 100, reference: 'x' }), '');
  assert.equal(paymentLinkPayload({ url: 'not a url', cents: 100, reference: 'x' }), '');
});

const rows = [
  { invoice_number: 'INV-2026-10-00001', kind: 'invoice', issue_date: '2026-10-05', net_cents: 7900, vat_cents: 0, gross_cents: 7900, buyer: { company: 'Sample Realty LLC' }, source: 'manual' },
  { invoice_number: 'INV-2026-10-00002', kind: 'storno', issue_date: '2026-10-20', net_cents: -7900, vat_cents: 0, gross_cents: -7900, buyer: { company: '=Formula' }, source: 'manual' },
];

test('General journal: AR debit / revenue credit, US dates, voids reversed', () => {
  const csv = buchungsstapel(rows, 'SKR03').replace('\uFEFF', '').trim().split('\r\n');
  assert.equal(csv[0], 'Journal No,Date,Account,Debit,Credit,Description,Customer');
  assert.equal(csv[1], 'INV-2026-10-00001,10/05/2026,1200 Accounts Receivable,79.00,,Invoice INV-2026-10-00001,Sample Realty LLC');
  assert.equal(csv[2], 'INV-2026-10-00001,10/05/2026,4000 Subscription Revenue,,79.00,Invoice INV-2026-10-00001,Sample Realty LLC');
  assert.equal(csv[3].split(',')[4], '79.00', 'void credits accounts receivable');
  assert.ok(!csv.join('\n').includes(',=Formula'), 'formula injection is neutralized');
});

test('Alternative chart uses 1100/4100', () => {
  const lines = buchungsstapel(rows.slice(0, 1), 'SKR04').trim().split('\r\n');
  assert.ok(lines[1].includes('1100 Accounts Receivable') && lines[2].includes('4100 Software Revenue'));
});

test('Sales journal: totals in USD', () => {
  const j = ustJournal([rows[0], { ...rows[0], invoice_number: 'INV-2026-10-00003', net_cents: 14900, vat_cents: 931, gross_cents: 15831 }], '2026-10');
  assert.ok(j.includes('Total,,,,228.00,9.31,237.31,'));
  assert.ok(j.includes('Revenue (before sales tax),228.00'));
});

test('Business days: weekends and US federal holidays are skipped', async () => {
  const { nthWorkday, isHoliday } = await import('../lib/b2b/workdays');
  assert.equal(nthWorkday(2026, 11, 3), '2026-11-04'); // Nov 2 Mon, 3 Tue, 4 Wed
  assert.equal(nthWorkday(2027, 1, 1), '2027-01-04'); // Jan 1 holiday (Fri), Jan 2/3 weekend
  assert.equal(nthWorkday(2025, 9, 1), '2025-09-02'); // Sep 1, 2025 is Labor Day (Mon)
  assert.ok(isHoliday(new Date(Date.UTC(2026, 10, 26)))); // Thanksgiving 2026
  assert.ok(isHoliday(new Date(Date.UTC(2026, 6, 3)))); // July 4, 2026 is a Saturday → observed Fri July 3
  assert.ok(isHoliday(new Date(Date.UTC(2026, 4, 25)))); // Memorial Day 2026
  assert.ok(!isHoliday(new Date(Date.UTC(2026, 3, 3)))); // Good Friday is not a federal holiday
});

test('Download token for the financing summary: valid, bound, expires', async () => {
  process.env.LEAD_TOKEN_SECRET = 'test-secret';
  const { leadToken, checkLeadToken } = await import('../lib/b2b/leadtoken');
  const id = '11111111-2222-3333-4444-555555555555';
  const t = leadToken(id, 1_000_000);
  assert.ok(checkLeadToken(id, t, 1_000_000 + 60_000));
  assert.ok(!checkLeadToken('11111111-2222-3333-4444-000000000000', t, 1_000_000));
  assert.ok(!checkLeadToken(id, t, 1_000_000 + 3 * 3600_000), 'invalid after 2 hours');
  assert.ok(!checkLeadToken(id, t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 1_000_000));
});

test('Webhook: signature and protection against internal addresses', async () => {
  const { signPayload, isPrivateIp } = await import('../lib/b2b/webhook-sign');
  const { createHmac } = await import('node:crypto');
  assert.equal(signPayload('secret', '1700000000', '{"a":1}'), 'sha256=' + createHmac('sha256', 'secret').update('1700000000.{"a":1}').digest('hex'));
  for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2a00:1450::1']) assert.ok(!isPrivateIp(ip), ip);
});
