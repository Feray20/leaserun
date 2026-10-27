import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Email: recipient is validated and normalized (no header injection)', async () => {
  const { normalizeRecipient } = await import('../lib/notify/mail.ts');
  assert.equal(normalizeRecipient('  Customer@Example.COM '), 'customer@example.com');
  assert.equal(normalizeRecipient('a@b.com\nBcc: x@y.com'), null);
  assert.equal(normalizeRecipient('a@b.com, c@d.com'), null);
  assert.equal(normalizeRecipient('not-an-email'), null);
});

test('Email: button has a fallback link, preview text is set', async () => {
  const { brandedHtml } = await import('../lib/notify/mail.ts');
  const h = brandedHtml({ title: 'Title', text: 'First line here\n\nSecond paragraph', button: { label: 'Open', url: 'https://leaserun.com/app' } });
  assert.match(h, /If the button doesn't work/);
  assert.match(h, /display:none[^>]*>First line here/);
  assert.match(h, /<html lang="en">/);
});

test('Email: business customers receive mail separately as "LeaseRun Business"', async () => {
  const { fromAddress, brandedHtml } = await import('../lib/notify/mail.ts');
  process.env.NOTIFY_FROM_EMAIL = 'noreply@leaserun.com';
  assert.equal(fromAddress('b2b'), 'LeaseRun Business <noreply@leaserun.com>');
  assert.equal(fromAddress(), 'LeaseRun <noreply@leaserun.com>');
  assert.match(brandedHtml({ text: 'x', area: 'b2b' }), /Business Portal<\/td>/);
  assert.doesNotMatch(brandedHtml({ text: 'x' }), /Business Portal/);
  delete process.env.NOTIFY_FROM_EMAIL;
});

test('Email: postal address only in marketing mail (CAN-SPAM), never a personal name', async () => {
  const { brandedHtml } = await import('../lib/notify/mail.ts');
  process.env.COMPANY_POSTAL_ADDRESS = 'PO Box 123, Austin, TX 78701';
  assert.match(brandedHtml({ text: 'x', marketing: true }), /PO Box 123, Austin, TX 78701/);
  assert.doesNotMatch(brandedHtml({ text: 'x' }), /PO Box 123/);
  assert.doesNotMatch(brandedHtml({ text: 'x', marketing: true }), /Feray|Korkmaz|Reinheim/);
  delete process.env.COMPANY_POSTAL_ADDRESS;
});
