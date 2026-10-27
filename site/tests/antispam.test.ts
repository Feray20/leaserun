import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEmailShape, honeypotTripped, tooFast, spamScore, DISPOSABLE_DOMAINS } from '../lib/security/antispam-pure.ts';

test('checkEmailShape: gültig, Wegwerf, Tippfehler, ungültig', () => {
  assert.equal(checkEmailShape('Max.Mustermann@web.de').ok, true);
  assert.equal(checkEmailShape('a@gmail.com').domain, 'gmail.com');
  const d = checkEmailShape('test@mailinator.com'); assert.equal(d.ok, false); assert.equal(d.reason, 'wegwerf');
  const t = checkEmailShape('kunde@gmail.con'); assert.equal(t.reason, 'tippfehler'); assert.equal(t.suggestion, 'kunde@gmail.com');
  assert.equal(checkEmailShape('keinklammeraffe').ok, false);
  assert.equal(checkEmailShape('a@b').ok, false);
  assert.equal(checkEmailShape('a@@b.de').ok, false);
  assert.equal(checkEmailShape('a b@web.de').ok, false);
});

test('honeypotTripped', () => {
  assert.equal(honeypotTripped(''), false);
  assert.equal(honeypotTripped(undefined), false);
  assert.equal(honeypotTripped('http://x'), true);
});

test('tooFast: zu schnell oder uralt blockt, normal und fehlend nicht', () => {
  assert.equal(tooFast(Date.now() - 300), true);       // 0,3 s → Bot
  assert.equal(tooFast(Date.now() - 4000), false);     // 4 s → Mensch
  assert.equal(tooFast(Date.now() - 48 * 3600_000), true); // 2 Tage alt
  assert.equal(tooFast(undefined), false);             // kein Token → nicht blocken
  assert.equal(tooFast(0), false);
  assert.equal(tooFast('abc'), false);
});

test('spamScore: Links und Spamwörter hoch, normale Anfrage niedrig', () => {
  assert.ok(spamScore('Hallo, ich interessiere mich für die Wohnung in Darmstadt. Bitte rufen Sie mich an.') < 4);
  assert.ok(spamScore('Best SEO service and backlink, visit http://x.ru http://y.ru http://z.ru') >= 4);
  assert.ok(spamScore('Buy cheap viagra now') >= 4);
  assert.ok(spamScore('Срочно свяжитесь со мной по поводу инвестиций') >= 2);
  assert.equal(spamScore(''), 0);
});

test('DISPOSABLE_DOMAINS enthält gängige Wegwerf-Dienste', () => {
  for (const d of ['mailinator.com', 'yopmail.com', 'trashmail.de', '1secmail.com']) assert.ok(DISPOSABLE_DOMAINS.has(d));
});
