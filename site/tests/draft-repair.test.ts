import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftIssues, repairDraftHtml } from '@/lib/mail/draft-repair';
import { SIG_IMG } from '@/lib/mail/template';

// Real-world shape of a creator outreach draft (Oct 2026): button, gray note, sign-off, previous signature, footer.
const F = 'font-family:Helvetica,Arial,sans-serif';
const BODY = `<table><tr><td style="padding:28px 28px 6px;${F}"><p style="margin:0 0 16px">If you're open to it, I'll send you personal access.</p><table role="presentation"><tr><td bgcolor="#0F2C59"><a href="mailto:support@leaserun.com?subject=Creator%20x%20LeaseRun&amp;body=Hey" target="_blank" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;border-radius:10px">Send me access &rarr;</a></td></tr></table><p style="margin:10px 0 16px;${F};font-size:13px;line-height:20px;color:#64748b">Or simply reply to this email.</p><p style="margin:0 0 8px;${F};font-size:12px;line-height:19px;color:#94a3b8">We found your address on your website. If you're not interested, a short reply is enough and I won't follow up.</p></td></tr>`;
const PREV_SIG = `<tr><td style="padding:14px 28px 28px;${F}"><p style="margin:0 0 12px;${F};font-size:16px;line-height:24px;color:#1e293b">Best regards</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td colspan="3" style="padding:0 0 10px"><img src="cid:att2" width="117" height="46" alt="" style="display:block;width:117px;height:46px;border:0;margin:0 0 4px"></td></tr><tr><td valign="top" width="60" style="width:60px;min-width:60px;padding:2px 0 0;vertical-align:top"><img src="cid:att0" width="60" height="60" alt="" style="display:block;width:60px;height:60px;max-width:60px;border:0;border-radius:30px;-ms-interpolation-mode:bicubic"></td><td width="14" style="width:14px;min-width:14px;font-size:0;line-height:0">&nbsp;</td><td valign="top" style="vertical-align:top;border-left:2px solid #e2e8f0;padding:0 0 0 14px"><p style="margin:0">LeaseRun</p><p style="margin:0 0 6px">Head of Operations</p><p style="margin:0 0 10px"><a href="https://leaserun.com">leaserun.com</a> | <a href="mailto:support@leaserun.com">support@leaserun.com</a></p><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0A66C2"><a href="https://www.linkedin.com/company/leaserun/"><span>in</span>LeaseRun on LinkedIn</a></td></tr></table></td></tr></table></td></tr>`;
const FOOT = `<tr><td bgcolor="#F8FAFC" style="background-color:#f8fafc;border-top:1px solid #eef2f6;padding:14px 28px 16px;${F}"><p style="margin:0 0 4px">LeaseRun · Questions? support@leaserun.com</p><p style="margin:0"><a href="https://leaserun.com/privacy">Privacy</a> · <a href="https://leaserun.com/api/abmelden?t=8af1757532c54260bda7decd61746a82">Unsubscribe</a></p></td></tr></table>`;
const DRAFT = BODY + PREV_SIG + FOOT;

test('previous signature is detected and brought to the current standard', () => {
  assert.ok(draftIssues(DRAFT).includes('sig_layout'));
  assert.ok(draftIssues(DRAFT).includes('note'));
  const out = repairDraftHtml(DRAFT);
  assert.equal((out.match(/cid:att2/g) || []).length, 1, 'signature exactly once');
  assert.equal((out.match(/cid:att0/g) || []).length, 1, 'photo exactly once');
  assert.equal((out.match(/LeaseRun on LinkedIn/g) || []).length, 1, 'LinkedIn button exactly once');
  assert.ok(!out.includes('border-left:2px solid #e2e8f0'), 'vertical line removed');
  assert.ok(!out.includes('<span style="color:#cbd5e1">&nbsp;&nbsp;|'), 'no duplicate support@ in the signature');
  assert.ok(out.includes('abmelden?t=8af1757532c54260bda7decd61746a82'), 'unsubscribe link kept');
  assert.ok(out.includes('Best regards'));
  assert.ok(!/Feray|Korkmaz/.test(out), 'no personal name in company email');
  assert.deepEqual(draftIssues(out).filter((x) => x === 'sig_layout' || x === 'note'), []);
});

test('legacy German signature ("auf LinkedIn") is repaired too', () => {
  const legacy = DRAFT.replace('LeaseRun on LinkedIn', 'LeaseRun auf LinkedIn');
  assert.ok(draftIssues(legacy).includes('sig_layout'));
  const out = repairDraftHtml(legacy);
  assert.ok(!out.includes('auf LinkedIn'));
  assert.equal((out.match(/LeaseRun on LinkedIn/g) || []).length, 1);
});

test('gray note moves from the letter body into the footer', () => {
  const out = repairDraftHtml(DRAFT);
  const iNote = out.indexOf('We found your address on your website');
  assert.ok(iNote > out.indexOf('bgcolor="#F8FAFC"'), 'note is in the footer');
  assert.ok(iNote < out.indexOf('Privacy</a>'), 'above the legal links');
  assert.ok(iNote > out.indexOf('Best regards'), 'after the sign-off');
});

test('repair is idempotent', () => {
  const once = repairDraftHtml(DRAFT);
  assert.equal(repairDraftHtml(once), once);
});

test('sending swaps the signature image without losing the spacing', () => {
  const sent = repairDraftHtml(DRAFT).replace(/<img src="cid:att2"[^>]*>/g, SIG_IMG);
  assert.match(sent, /<td colspan="2" style="padding:0 0 14px"><img src="cid:att2"/);
});

test('buttons open a page instead of a mail window', () => {
  const out = repairDraftHtml(DRAFT);
  assert.ok(!/href="mailto:[^"]*"[^>]*border-radius:10px/.test(out), 'no mailto button left');
  assert.match(out, /href="https:\/\/leaserun\.com\/request\?art=creator&amp;t=8af1757532c54260bda7decd61746a82" target="_blank"/);
  assert.ok(out.includes('Send me access &rarr;</a>'));
});

test('button mapping by label', async () => {
  const { ctaFromLabel, ctaUrl } = await import('@/lib/mail/cta');
  assert.deepEqual(ctaFromLabel('Book a call &rarr;'), { art: 'termin' });
  assert.deepEqual(ctaFromLabel('Quick reply &rarr;'), { art: 'kooperation' });
  assert.deepEqual(ctaFromLabel('Request numbers &rarr;'), { art: 'unterlagen', w: 'zahlen' });
  assert.deepEqual(ctaFromLabel('Request samples'), { art: 'unterlagen', w: 'muster' });
  assert.deepEqual(ctaFromLabel('Choose a topic &rarr;'), { art: 'unterlagen', w: 'beitrag' });
  assert.deepEqual(ctaFromLabel('Termin vorschlagen &rarr;'), { art: 'termin' }, 'legacy German label still works');
  assert.equal(ctaFromLabel('Whatever'), null);
  assert.equal(ctaUrl('termin'), 'https://leaserun.com/book?topic=Press');
  assert.equal(ctaUrl('zugang', undefined, 'short'), 'https://leaserun.com/request?art=zugang', 'invalid token is dropped');
});

test('interim version (LinkedIn as text link) gets the LinkedIn button', () => {
  const interim = `<p>Best regards</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td colspan="2" style="padding:0 0 14px"><img src="cid:att2" width="117" height="46" alt="" style="display:block;margin:0"></td></tr><tr><td><img src="cid:att0"></td><td><p>LeaseRun</p><p style="margin:0"><a href="https://leaserun.com">leaserun.com</a><span style="color:#cbd5e1">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="https://www.linkedin.com/company/leaserun/" style="color:#0284c7;text-decoration:none">LinkedIn</a></p></td></tr></table></td></tr>`;
  const out = repairDraftHtml(interim);
  assert.equal((out.match(/LeaseRun on LinkedIn/g) || []).length, 1);
  assert.equal((out.match(/cid:att2/g) || []).length, 1);
  assert.equal(repairDraftHtml(out), out);
});

test('button survives a rewrite and appears in the letter layout', async () => {
  const { extractCta, ctaBlock, parseCta } = await import('@/lib/mail/cta');
  const { renderBrief } = await import('@/lib/mail/template');
  const c = extractCta(DRAFT);
  assert.deepEqual(c, { art: 'creator', label: 'Send me access', anrede: 'sie' });
  assert.equal(parseCta({ art: 'evil', label: 'x' }), null, 'unknown type is rejected');
  const html = renderBrief({ body: '<p>Hi</p>', unsubUrl: null, cta: ctaBlock(c!, '8af1757532c54260bda7decd61746a82') });
  assert.match(html, /href="https:\/\/leaserun\.com\/request\?art=creator&amp;t=8af1757532c54260bda7decd61746a82"/);
  assert.ok(html.indexOf('Send me access') < html.indexOf('Best regards'), 'button sits above the sign-off');
  assert.ok(html.includes('Or simply reply to this email.'));
  assert.equal((html.match(/LeaseRun on LinkedIn/g) || []).length, 1, 'LinkedIn button in the signature');
  assert.ok(!/href="mailto:[^"]*"[^>]*border-radius:10px/.test(html));
  assert.ok(!/Feray|Korkmaz|Reinheim/.test(html), 'no personal name or address');
});

test('commercial footer shows the postal address and unsubscribe link only when set', async () => {
  const { footer } = await import('@/lib/mail/template');
  process.env.COMPANY_POSTAL_ADDRESS = 'PO Box 123, Austin, TX 78701';
  assert.match(footer('https://leaserun.com/api/abmelden?t=x'), /PO Box 123, Austin, TX 78701/);
  assert.match(footer('https://leaserun.com/api/abmelden?t=x'), /Unsubscribe/);
  assert.doesNotMatch(footer(null), /PO Box 123|Unsubscribe/);
  delete process.env.COMPANY_POSTAL_ADDRESS;
});

test('sign-off with a name at the end is not added twice', async () => {
  const { splitGreeting } = await import('@/lib/mail/template');
  const P = '<p style="margin:0 0 16px;color:#1e293b">';
  assert.deepEqual(splitGreeting(`${P}Text.</p>${P}Sincerely<br>The LeaseRun Team</p>`), { body: `${P}Text.</p>`, greeting: 'Sincerely' });
  assert.deepEqual(splitGreeting(`<p>Text.</p><p>Best regards</p>`), { body: '<p>Text.</p>', greeting: 'Best regards' });
  assert.deepEqual(splitGreeting(`<p>Text.</p><p>Mit freundlichen Grüßen</p>`), { body: '<p>Text.</p>', greeting: 'Mit freundlichen Grüßen' }, 'replies in German keep a German sign-off');
  assert.equal(splitGreeting('<p>Just text.</p>').greeting, 'Best regards');
});
