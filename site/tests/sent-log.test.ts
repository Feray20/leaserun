import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSensitiveMail } from '@/lib/mail/sent-log';

test('Mails mit Zugangsdaten oder persönlichen Links werden nur als Vermerk abgelegt', () => {
  assert.ok(isSensitiveMail('Passwort zurücksetzen – LeaseRun', ''));
  assert.ok(isSensitiveMail('Ihr Anmeldelink – LeaseRun', ''));
  assert.ok(isSensitiveMail('Ihr Konto ist eingerichtet', 'Benutzername: x\nStartpasswort: abc'));
  assert.ok(isSensitiveMail('Bitte bestätigen: Neuigkeiten von LeaseRun', ''));
});

test('Normale Systemmails werden vollständig abgelegt', () => {
  assert.ok(!isSensitiveMail('Ihre Rechnung von LeaseRun', 'Anbei Ihre Rechnung.'));
  assert.ok(!isSensitiveMail('Termin bestätigt: 28. Oktober, 10:00 Uhr', 'Ihr Teams-Link folgt.'));
  assert.ok(!isSensitiveMail('Monatspaket Oktober', 'Belege im Anhang.'));
});
