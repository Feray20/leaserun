import test from 'node:test';
import assert from 'node:assert/strict';
import { blockers, closeAllowedAt, commissionLines, periodBounds, periodOf, pickRule, previousPeriod, statementTotals, suggestInvoiceNumber, taxTreatment, type ConversionIn, type Rule } from '../lib/creator/billing';
import { painXml, sepaText } from '../lib/creator/sepa';
import { pdfSafe, renderDoc } from '../lib/creator/pdf';

const rule = (o: Partial<Rule>): Rule => ({ id: 'r', version: 1, creator_id: null, campaign_slug: null, kind: 'PERCENT', percent_bps: 2000, fixed_cents: 0, tiers: [], valid_from: '2026-01-01T00:00:00Z', valid_to: null, ...o });
const conv = (o: Partial<ConversionIn>): ConversionIn => ({ id: 'c', creator_id: 'A', campaign_slug: null, amount_net_cents: 4118, occurred_at: '2026-10-10T10:00:00Z', ...o });

test('Zeitraum: Monatsgrenzen in Berliner Zeit (Sommer- und Winterzeit)', () => {
  const okt = periodBounds('2026-10');
  assert.equal(okt.from.toISOString(), '2026-09-30T22:00:00.000Z'); // MESZ
  assert.equal(okt.to.toISOString(), '2026-10-31T23:00:00.000Z');   // MEZ (Umstellung am 25.10.)
  assert.equal(periodBounds('2026-12').to.toISOString(), '2026-12-31T23:00:00.000Z');
  assert.equal(periodOf(new Date('2026-10-31T23:30:00Z')), '2026-11');
  assert.equal(periodOf(new Date('2026-10-31T22:30:00Z')), '2026-10');
  assert.equal(previousPeriod('2026-01'), '2025-12');
  assert.throws(() => periodBounds('2026-13'));
});

test('Monatsabschluss erst nach Ablauf der Widerrufsfrist', () => {
  assert.equal(closeAllowedAt('2026-10', 15).toISOString(), '2026-11-15T23:00:00.000Z');
});

test('Regelwahl: Creator+Kampagne > Creator > Kampagne > Standard; Gültigkeit beachtet', () => {
  const rules = [rule({ id: 'def' }), rule({ id: 'camp', campaign_slug: 'herbst' }), rule({ id: 'crea', creator_id: 'A' }), rule({ id: 'both', creator_id: 'A', campaign_slug: 'herbst' }), rule({ id: 'other', creator_id: 'B' })];
  assert.equal(pickRule(rules, conv({ campaign_slug: 'herbst' }))?.id, 'both');
  assert.equal(pickRule(rules, conv({}))?.id, 'crea');
  assert.equal(pickRule(rules, conv({ creator_id: 'C', campaign_slug: 'herbst' }))?.id, 'camp');
  assert.equal(pickRule(rules, conv({ creator_id: 'C' }))?.id, 'def');
  const versions = [rule({ id: 'v1', version: 1, valid_to: '2026-10-15T00:00:00Z' }), rule({ id: 'v2', version: 2, valid_from: '2026-10-15T00:00:00Z', percent_bps: 2500 })];
  assert.equal(pickRule(versions, conv({ occurred_at: '2026-10-14T23:00:00Z' }))?.id, 'v1');
  assert.equal(pickRule(versions, conv({ occurred_at: '2026-10-20T00:00:00Z' }))?.id, 'v2');
  assert.equal(pickRule([rule({ valid_from: '2027-01-01T00:00:00Z' })], conv({})), null);
});

test('Provisionsarten: Prozent, fix, hybrid, gestaffelt (Rundung in Cent)', () => {
  const c = [conv({ id: '1', occurred_at: '2026-10-01T10:00:00Z' }), conv({ id: '2', occurred_at: '2026-10-02T10:00:00Z' }), conv({ id: '3', occurred_at: '2026-10-03T10:00:00Z' })];
  assert.deepEqual(commissionLines([rule({ percent_bps: 2000 })], c).map((l) => l.commission_cents), [824, 824, 824]); // 20 % von 41,18 € = 8,236 €
  assert.deepEqual(commissionLines([rule({ kind: 'FIXED', fixed_cents: 500 })], c).map((l) => l.commission_cents), [500, 500, 500]);
  assert.deepEqual(commissionLines([rule({ kind: 'HYBRID', percent_bps: 1000, fixed_cents: 100 })], c).map((l) => l.commission_cents), [512, 512, 512]);
  const tiered = rule({ kind: 'TIERED', percent_bps: 1000, tiers: [{ min_conversions: 2, percent_bps: 2000 }, { min_conversions: 3, percent_bps: 3000 }] });
  assert.deepEqual(commissionLines([tiered], [c[2], c[0], c[1]]).map((l) => [l.conversion_id, l.commission_cents]), [['1', 412], ['2', 824], ['3', 1235]]);
});

test('Ohne passende Regel: Provision 0 und keine Regel-ID (fällt in der Prüfung auf)', () => {
  assert.deepEqual(commissionLines([], [conv({})])[0], { conversion_id: 'c', creator_id: 'A', rule_id: null, rule_version: null, base_cents: 4118, commission_cents: 0 });
});

test('Steuer: Kleinunternehmer, umsatzsteuerpflichtig, Reverse Charge, Drittland, unklare Fälle', () => {
  assert.equal(taxTreatment({ country: 'DE', vat_status: 'small_business', vat_id: null, tax_number: '012/345/67890' }).mode, 'SMALL_BUSINESS');
  assert.deepEqual(taxTreatment({ country: 'DE', vat_status: 'vat_registered', vat_id: 'DE123456789', tax_number: null }).rate_bps, 1900);
  assert.equal(taxTreatment({ country: 'DE', vat_status: 'vat_registered', vat_id: null, tax_number: null }).mode, 'REVIEW_REQUIRED');
  assert.equal(taxTreatment({ country: 'AT', vat_status: 'vat_registered', vat_id: 'ATU12345678', tax_number: null }).mode, 'REVERSE_CHARGE');
  assert.equal(taxTreatment({ country: 'GR', vat_status: 'vat_registered', vat_id: 'EL123456789', tax_number: null }).mode, 'REVERSE_CHARGE');
  assert.equal(taxTreatment({ country: 'AT', vat_status: 'small_business', vat_id: null, tax_number: null }).mode, 'REVIEW_REQUIRED');
  assert.equal(taxTreatment({ country: 'CH', vat_status: 'not_applicable', vat_id: null, tax_number: null }).mode, 'NOT_TAXABLE_DE');
});

test('Summen: Provision + Anpassungen, USt nur auf positiven Betrag, Auszahlung nie negativ', () => {
  const vat = taxTreatment({ country: 'DE', vat_status: 'vat_registered', vat_id: 'DE123456789', tax_number: null });
  assert.deepEqual(statementTotals([824, 824], [{ amount_cents: 1000, kind: 'BONUS', reason: 'Top-Creator' }], vat), { commission_cents: 1648, adjustments_cents: 1000, net_cents: 2648, vat_cents: 503, gross_cents: 3151, payout_cents: 3151 });
  const small = taxTreatment({ country: 'DE', vat_status: 'small_business', vat_id: null, tax_number: 'x' });
  assert.deepEqual(statementTotals([500], [{ amount_cents: -900, kind: 'CLAWBACK', reason: 'Erstattung' }], small), { commission_cents: 500, adjustments_cents: -900, net_cents: -400, vat_cents: 0, gross_cents: -400, payout_cents: 0 });
});

test('Sperrgründe vor der Auszahlung', () => {
  const tax = taxTreatment({ country: 'DE', vat_status: 'small_business', vat_id: null, tax_number: 'x' });
  const ok = { creatorActive: true, payoutStatus: 'VERIFIED', agreementAccepted: true, tax, mode: 'INVOICE' as const, hasInvoice: true, payoutCents: 1000 };
  assert.deepEqual(blockers(ok), []);
  assert.deepEqual(blockers({ ...ok, hasInvoice: false }), ['invoice_missing']);
  assert.deepEqual(blockers({ ...ok, mode: 'CREDIT_NOTE', hasInvoice: false }), []);
  assert.deepEqual(blockers({ ...ok, payoutStatus: 'VERIFICATION_REQUIRED' }), ['payout_review']);
  assert.deepEqual(blockers({ ...ok, payoutStatus: null, agreementAccepted: false, creatorActive: false }), ['creator_inactive', 'payout_missing', 'agreement_missing']);
  assert.deepEqual(blockers({ ...ok, payoutCents: 0 }), ['nothing_to_pay']);
});

test('Rechnungsnummer-Vorschlag: eigene fortlaufende Reihe des Creators', () => {
  assert.equal(suggestInvoiceNumber(2026, []), 'CR-2026-001');
  assert.equal(suggestInvoiceNumber(2026, ['CR-2026-001', 'CR-2026-009', 'CR-2025-044', 'EIGEN-7']), 'CR-2026-010');
});

test('SEPA pain.001: Summen, Zeichensatz, Validierung', () => {
  const x = painXml({ msgId: 'IA-CR-202610', createdAt: new Date('2026-11-16T09:00:00Z'), executionDate: '2026-11-17', debtor: { name: 'LeaseRun · Feray Korkmaz', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' },
    payments: [{ endToEndId: 'CR-2026-10-ABC', name: 'Jürgen Müller & Söhne', iban: 'DE02120300000000202051', amountCents: 3151, remittance: 'LeaseRun Creator Oktober 2026 CR-2026-001' }, { endToEndId: 'CR-2026-10-DEF', name: 'Lea', iban: 'AT611904300234573201', bic: 'BKAUATWWXXX', amountCents: 1000, remittance: 'Gutschrift GS-2026-00001' }] });
  assert.match(x, /<NbOfTxs>2<\/NbOfTxs>/);
  assert.match(x, /<CtrlSum>41.51<\/CtrlSum>/);
  assert.match(x, /Juergen Mueller &amp; Soehne|Juergen Mueller Soehne/);
  assert.ok(!x.includes('·'));
  assert.equal(sepaText('Ä€ <b>', 10), 'Ae b');
  assert.throws(() => painXml({ msgId: 'x', createdAt: new Date(), executionDate: '2026-11-17', debtor: { name: 'a', iban: 'DE89370400440532013000' }, payments: [] }));
  assert.throws(() => painXml({ msgId: 'x', createdAt: new Date(), executionDate: '2026-11-17', debtor: { name: 'a', iban: 'DE89370400440532013000' }, payments: [{ endToEndId: 'e', name: 'n', iban: 'DE02120300000000202051', amountCents: -5, remittance: 'r' }] }));
});

test('PDF: Rechnung wird erzeugt, enthält keine vollständige IBAN, Sonderzeichen sicher', async () => {
  assert.equal(pdfSafe('a → b „c“ – d'), 'a -> b "c" - d');
  const bytes = await renderDoc({ kind: 'INVOICE', title: 'Rechnung', number: 'CR-2026-001', issueDate: '16.11.2026', servicePeriod: '01.10.2026 - 31.10.2026',
    issuer: { name: 'Nahim Sky', lines: ['Musterstraße 1', '64807 Dieburg'], taxIds: ['Steuernummer 012/345/67890'] }, recipient: { name: 'LeaseRun', lines: ['Inh. Feray Korkmaz', 'Georg-August-Zinn-Str. 25', '64354 Reinheim'] },
    meta: [['Zahlung an', 'DE••••••••••3000']], lines: Array.from({ length: 60 }, (_, i) => ({ description: `Provision Conversion ${i + 1}`, detail: 'Käufer-Pass · Link', amountCents: 824 })),
    totals: [['Summe netto', '494,40 €'], ['Rechnungsbetrag', '494,40 €', true]], notes: ['Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'], footer: 'Erstellt im LeaseRun Creator Hub' });
  const head = Buffer.from(bytes.slice(0, 5)).toString('latin1');
  assert.equal(head, '%PDF-');
  assert.ok(bytes.length > 2000);
  const { PDFDocument } = await import('pdf-lib');
  assert.equal((await PDFDocument.load(bytes)).getPageCount() >= 2, true, 'lange Rechnungen werden umbrochen');
  assert.ok(!Buffer.from(bytes).toString('latin1').includes('DE89370400440532013000'));
});
