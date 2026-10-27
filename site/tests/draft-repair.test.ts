import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftIssues, repairDraftHtml } from '@/lib/mail/draft-repair';
import { SIG_IMG } from '@/lib/mail/template';

// Echter Ausschnitt eines Creator-Entwurfs (Okt. 2026): Knopf, grauer Hinweis, Gruß, vorige Signatur, Fußzeile.
const F = 'font-family:Helvetica,Arial,sans-serif';
const BODY = `<table><tr><td style="padding:28px 28px 6px;${F}"><p style="margin:0 0 16px">Wenn ihr grundsätzlich offen seid, schick ich euch einen persönlichen Zugang.</p><table role="presentation"><tr><td bgcolor="#0F2C59"><a href="mailto:support@leaserun.com?subject=Finanzkroko%20x%20LeaseRun&amp;body=Hey" target="_blank" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;border-radius:10px">Zugang schicken &rarr;</a></td></tr></table><p style="margin:10px 0 16px;${F};font-size:13px;line-height:20px;color:#64748b">Oder antwortet einfach auf diese Mail.</p><p style="margin:0 0 8px;${F};font-size:12px;line-height:19px;color:#94a3b8">Eure Adresse steht auf eurer Website. Wenn ihr kein Interesse habt, reicht eine kurze Antwort, dann melde ich mich nicht nochmal.</p></td></tr>`;
const PREV_SIG = `<tr><td style="padding:14px 28px 28px;${F}"><p style="margin:0 0 12px;${F};font-size:16px;line-height:24px;color:#1e293b">Viele Grüße</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td colspan="3" style="padding:0 0 10px"><img src="cid:att2" width="117" height="46" alt="" style="display:block;width:117px;height:46px;border:0;margin:0 0 4px"></td></tr><tr><td valign="top" width="60" style="width:60px;min-width:60px;padding:2px 0 0;vertical-align:top"><img src="cid:att0" width="60" height="60" alt="" style="display:block;width:60px;height:60px;max-width:60px;border:0;border-radius:30px;-ms-interpolation-mode:bicubic"></td><td width="14" style="width:14px;min-width:14px;font-size:0;line-height:0">&nbsp;</td><td valign="top" style="vertical-align:top;border-left:2px solid #e2e8f0;padding:0 0 0 14px"><p style="margin:0">Feray Korkmaz</p><p style="margin:0 0 6px">Head of Operations · LeaseRun</p><p style="margin:0 0 10px"><a href="https://leaserun.com">leaserun.com</a> | <a href="mailto:support@leaserun.com">support@leaserun.com</a></p><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0A66C2"><a href="https://www.linkedin.com/company/leaserun/"><span>in</span>LeaseRun auf LinkedIn</a></td></tr></table></td></tr></table></td></tr>`;
const FOOT = `<tr><td bgcolor="#F8FAFC" style="background-color:#f8fafc;border-top:1px solid #eef2f6;padding:14px 28px 16px;${F}"><p style="margin:0 0 4px">LeaseRun · Fragen? support@leaserun.com</p><p style="margin:0"><a href="https://leaserun.com/legal-notice">Impressum</a> · <a href="https://leaserun.com/api/abmelden?t=8af1757532c54260bda7decd61746a82">Keine E-Mails mehr erhalten</a></p></td></tr></table>`;
const DRAFT = BODY + PREV_SIG + FOOT;

test('vorige Signatur wird erkannt und auf den neuen Standard gebracht', () => {
  assert.ok(draftIssues(DRAFT).includes('sig_layout'));
  assert.ok(draftIssues(DRAFT).includes('note'));
  const out = repairDraftHtml(DRAFT);
  assert.equal((out.match(/cid:att2/g) || []).length, 1, 'Unterschrift bleibt genau einmal');
  assert.equal((out.match(/cid:att0/g) || []).length, 1, 'Foto bleibt genau einmal');
  assert.equal((out.match(/LeaseRun auf LinkedIn/g) || []).length, 1, 'LinkedIn-Knopf genau einmal');
  assert.ok(!out.includes('border-left:2px solid #e2e8f0'), 'senkrechte Linie entfernt');
  assert.ok(!out.includes('<span style="color:#cbd5e1">&nbsp;&nbsp;|'), 'kein doppeltes support@ in der Signatur');
  assert.ok(out.includes('abmelden?t=8af1757532c54260bda7decd61746a82'), 'Abmeldelink bleibt');
  assert.ok(out.includes('Viele Grüße'));
  assert.deepEqual(draftIssues(out).filter((x) => x === 'sig_layout' || x === 'note'), []);
});

test('grauer Hinweis wandert vom Brieftext in die Fußzeile', () => {
  const out = repairDraftHtml(DRAFT);
  const iNote = out.indexOf('Eure Adresse steht auf eurer Website');
  assert.ok(iNote > out.indexOf('bgcolor="#F8FAFC"'), 'Hinweis steht in der Fußzeile');
  assert.ok(iNote < out.indexOf('Impressum'), 'über Impressum');
  assert.ok(iNote > out.indexOf('Viele Grüße'), 'nach dem Gruß');
});

test('Reparatur ist idempotent', () => {
  const once = repairDraftHtml(DRAFT);
  assert.equal(repairDraftHtml(once), once);
});

test('Versand ersetzt das Unterschrift-Bild, ohne den Abstand zu verlieren', () => {
  const sent = repairDraftHtml(DRAFT).replace(/<img src="cid:att2"[^>]*>/g, SIG_IMG);
  assert.match(sent, /<td colspan="2" style="padding:0 0 14px"><img src="cid:att2"/);
});

test('Knöpfe öffnen eine Seite statt eines Mail-Fensters', () => {
  const out = repairDraftHtml(DRAFT);
  assert.ok(!/href="mailto:[^"]*"[^>]*border-radius:10px/.test(out), 'kein mailto-Knopf mehr');
  assert.match(out, /href="https:\/\/leaserun\.de\/anfrage\?art=creator&amp;t=8af1757532c54260bda7decd61746a82" target="_blank"/);
  assert.ok(out.includes('Zugang schicken &rarr;</a>'));
});

test('Knopf-Zuordnung nach Beschriftung', async () => {
  const { ctaFromLabel, ctaUrl } = await import('@/lib/mail/cta');
  assert.deepEqual(ctaFromLabel('Termin vorschlagen &rarr;'), { art: 'termin' });
  assert.deepEqual(ctaFromLabel('Kurz antworten &rarr;'), { art: 'kooperation' });
  assert.deepEqual(ctaFromLabel('Zahlen anfordern &rarr;'), { art: 'unterlagen', w: 'zahlen' });
  assert.deepEqual(ctaFromLabel('Muster anfordern'), { art: 'unterlagen', w: 'muster' });
  assert.deepEqual(ctaFromLabel('Thema auswählen &rarr;'), { art: 'unterlagen', w: 'beitrag' });
  assert.equal(ctaFromLabel('Irgendwas'), null);
  assert.equal(ctaUrl('termin'), 'https://leaserun.com/book?thema=Presse%20%26%20Kooperation');
  assert.equal(ctaUrl('zugang', undefined, 'kurz'), 'https://leaserun.com/request?art=zugang', 'ungültiges Token wird weggelassen');
});

test('Zwischenstand (LinkedIn als Textlink) bekommt den LinkedIn-Knopf', () => {
  const interim = `<p>Viele Grüße</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td colspan="2" style="padding:0 0 14px"><img src="cid:att2" width="117" height="46" alt="" style="display:block;margin:0"></td></tr><tr><td><img src="cid:att0"></td><td><p>Feray Korkmaz</p><p style="margin:0"><a href="https://leaserun.com">leaserun.com</a><span style="color:#cbd5e1">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="https://www.linkedin.com/company/leaserun/" style="color:#0284c7;text-decoration:none">LinkedIn</a></p></td></tr></table></td></tr>`;
  const out = repairDraftHtml(interim);
  assert.equal((out.match(/LeaseRun auf LinkedIn/g) || []).length, 1);
  assert.equal((out.match(/cid:att2/g) || []).length, 1);
  assert.equal(repairDraftHtml(out), out);
});

test('Knopf bleibt beim Überarbeiten erhalten und erscheint im Brief-Layout', async () => {
  const { extractCta, ctaBlock, parseCta } = await import('@/lib/mail/cta');
  const { renderBrief } = await import('@/lib/mail/template');
  const c = extractCta(DRAFT);
  assert.deepEqual(c, { art: 'creator', label: 'Zugang schicken', anrede: 'ihr' });
  assert.equal(parseCta({ art: 'boese', label: 'x' }), null, 'unbekannte Art wird verworfen');
  const html = renderBrief({ body: '<p>Hallo</p>', unsubUrl: null, cta: ctaBlock(c!, '8af1757532c54260bda7decd61746a82') });
  assert.match(html, /href="https:\/\/leaserun\.de\/anfrage\?art=creator&amp;t=8af1757532c54260bda7decd61746a82"/);
  assert.ok(html.indexOf('Zugang schicken') < html.indexOf('Viele Grüße'), 'Knopf steht über dem Gruß');
  assert.ok(html.includes('Oder antwortet einfach auf diese Mail.'));
  assert.equal((html.match(/LeaseRun auf LinkedIn/g) || []).length, 1, 'LinkedIn-Knopf in der Signatur');
  assert.ok(!/href="mailto:[^"]*"[^>]*border-radius:10px/.test(html));
});

test('Gruß mit Name am Ende wird nicht doppelt angehängt', async () => {
  const { splitGreeting } = await import('@/lib/mail/template');
  const P = '<p style="margin:0 0 16px;color:#1e293b">';
  assert.deepEqual(splitGreeting(`${P}Text.</p>${P}Mit freundlichen Grüßen<br>Feray Korkmaz</p>`), { body: `${P}Text.</p>`, greeting: 'Mit freundlichen Grüßen' });
  assert.deepEqual(splitGreeting(`<p>Text.</p><p>Viele Grüße</p>`), { body: '<p>Text.</p>', greeting: 'Viele Grüße' });
  assert.equal(splitGreeting('<p>Nur Text.</p>').greeting, 'Viele Grüße');
});
