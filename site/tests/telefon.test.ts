import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { gespraechsskript, verifyRetell, zusammenfassung, minuten, kostenUsd, warnStufe, auswertungText } from '../lib/telefon/assistent';

test('Skript: KI-Hinweis, echte Preise, keine Beratung', () => {
  const t = gespraechsskript();
  assert.match(t, /digitale Assistentin/);
  assert.match(t, /BankReady Kreditmappe: 39 €/);
  assert.match(t, /Investor Pro: 29 € pro Monat/);
  assert.match(t, /Makler & Vermittler Basic: 59 € netto/);
  assert.match(t, /keine Anlage-, Steuer- oder Rechtsberatung/);
  assert.ok(!/Reinheim|Korkmaz/.test(t), 'kein Wohnort, kein Name');
  assert.match(auswertungText(), /rueckrufnummer/);
});

test('Signatur: gültig, falsch, zu alt', () => {
  const key = 'key_test', body = '{"event":"call_analyzed"}', ts = String(Date.now());
  const d = createHmac('sha256', key).update(body + ts).digest('hex');
  assert.equal(verifyRetell(body, `v=${ts},d=${d}`, key), true);
  assert.equal(verifyRetell(body + ' ', `v=${ts},d=${d}`, key), false);
  const old = String(Date.now() - 10 * 60 * 1000);
  assert.equal(verifyRetell(body, `v=${old},d=${createHmac('sha256', key).update(body + old).digest('hex')}`, key), false);
  assert.equal(verifyRetell(body, null, key), false);
});

test('Zusammenfassung und Budget', () => {
  const call = { from_number: '+4917012345678', start_timestamp: Date.UTC(2026, 9, 27, 9, 0), duration_ms: 125000,
    call_analysis: { call_summary: 'Frage zur Kreditmappe.', custom_analysis_data: { name: 'Max Muster', anliegen: 'Preis der Kreditmappe', kategorie: 'Frage zu Preisen', rueckruf: true, rueckrufnummer: '0170 1234567', dringend: false } } };
  const z = zusammenfassung(call);
  assert.equal(z.spam, false);
  assert.match(z.subject, /^Telefon: Max Muster/);
  assert.match(z.text, /Rückruf gewünscht: Ja – 0170 1234567/);
  assert.equal(minuten(call), 3);
  assert.equal(zusammenfassung({ call_analysis: { custom_analysis_data: { kategorie: 'Werbung/Spam' } } }).spam, true);
  assert.equal(kostenUsd({ minuten: 100 }), 12);
  assert.equal(warnStufe({ monat: '2026-10', minuten: 150, anrufe: 50 }), 80);
  assert.equal(warnStufe({ monat: '2026-10', minuten: 150, anrufe: 50, gewarnt: 80 }), 0);
  assert.equal(warnStufe({ monat: '2026-10', minuten: 190, anrufe: 60, gewarnt: 80 }), 100);
});
