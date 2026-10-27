import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSensitiveMail } from '@/lib/mail/sent-log';

test('Emails with credentials or personal links are stored only as a note', () => {
  assert.ok(isSensitiveMail('Reset your password – LeaseRun', ''));
  assert.ok(isSensitiveMail('Your LeaseRun sign-in link', ''));
  assert.ok(isSensitiveMail('Your account is ready', 'Username: x\nTemporary password: abc'));
  assert.ok(isSensitiveMail('Please confirm: updates from LeaseRun', ''));
  assert.ok(isSensitiveMail('Your verification code – LeaseRun', ''));
});

test('Regular system emails are stored in full', () => {
  assert.ok(!isSensitiveMail('Your LeaseRun receipt', 'Attached is your receipt.'));
  assert.ok(!isSensitiveMail('Meeting booked: Oct 28, 10:00 AM', 'Your Teams link follows.'));
  assert.ok(!isSensitiveMail('Monthly statement October', 'Statement attached.'));
});
