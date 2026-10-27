import { test } from 'node:test';
import assert from 'node:assert/strict';
import { available, authorize, decide, settle, refund, release, limitAllowed, nextReset, type LimitState } from '../lib/cards/limits';
import { toCents, formatEur } from '../lib/cards/money';
import { programStatus, capabilities } from '../lib/cards/status';
import { benefitFor } from '../lib/cards/benefits';
import { currentPricing, pricingHash, PRICING_VERSIONS } from '../lib/cards/pricing';

const L = (limit: number, extra: Partial<LimitState> = {}): LimitState => ({ monthlyLimit: limit * 100, settled: 0, reserved: 0, refunded: 0, securityDeposit: 0, refundsReleaseLimit: true, ...extra });

test('Limit 500 €: 500 € zulässig, 501 € abgelehnt', () => {
  assert.equal(decide(L(500), 'ACTIVE', 50_000), 'AUTHORIZED');
  assert.equal(decide(L(500), 'ACTIVE', 50_100), 'DECLINED_LIMIT_EXCEEDED');
});

test('Limit 1.000 €: 700 € + 300 € beide zulässig; 700 € + 400 € → zweite abgelehnt', () => {
  let s = authorize(L(1000), 'ACTIVE', 70_000); assert.equal(s.result, 'AUTHORIZED');
  const b = authorize(s.next, 'ACTIVE', 30_000); assert.equal(b.result, 'AUTHORIZED'); assert.equal(available(b.next), 0);
  s = authorize(L(1000), 'ACTIVE', 70_000);
  const c = authorize(s.next, 'ACTIVE', 40_000); assert.equal(c.result, 'DECLINED_LIMIT_EXCEEDED'); assert.equal(available(c.next), 30_000);
});

test('Nacheinander verarbeitete Anfragen (wie unter Zeilensperre): 600 € + 600 € bei 1.000 € → nur eine', () => {
  const a = authorize(L(1000), 'ACTIVE', 60_000), b = authorize(a.next, 'ACTIVE', 60_000);
  assert.deepEqual([a.result, b.result], ['AUTHORIZED', 'DECLINED_LIMIT_EXCEEDED']);
  assert.ok(b.next.reserved + b.next.settled <= 100_000);
});

test('Erstattung: Limit 1.000 €, 800 € abgerechnet, 200 € erstattet → 400 € verfügbar (Regel konfigurierbar)', () => {
  let s = authorize(L(1000), 'ACTIVE', 80_000).next; s = settle(s, 80_000); s = refund(s, 20_000);
  assert.equal(available(s), 40_000);
  assert.equal(available({ ...s, refundsReleaseLimit: false }), 20_000);
});

test('Verfügbar nie negativ; Freigabe gibt Reservierung zurück', () => {
  assert.equal(available(L(100, { settled: 20_000 })), 0);
  const s = release(authorize(L(100), 'ACTIVE', 5_000).next, 5_000);
  assert.equal(available(s), 10_000);
});

test('Gesperrte oder nicht aktive Karte → Ablehnung; ungültige Beträge werfen', () => {
  assert.equal(decide(L(1000), 'FROZEN', 100), 'DECLINED_CARD_FROZEN');
  assert.equal(decide(L(1000), 'BLOCKED', 100), 'DECLINED_CARD_FROZEN');
  assert.equal(decide(L(1000), 'PENDING', 100), 'DECLINED_CARD_INACTIVE');
  for (const x of [0, -1, 1.5, 200_000_000]) assert.throws(() => decide(L(1000), 'ACTIVE', x));
});

test('Limitänderung: Charge höchstens bis zur Kaution', () => {
  assert.equal(limitAllowed('charge', 100_000, 100_000).ok, true);
  assert.equal(limitAllowed('charge', 100_100, 100_000).ok, false);
  assert.equal(limitAllowed('debit', 75_000, 0).ok, true);
  assert.equal(limitAllowed('debit', -1, 0).ok, false);
});

test('Geld in Cent ohne Gleitkommafehler, deutsche Anzeige', () => {
  assert.equal(toCents('1.250,50'), 125_050);
  assert.equal(toCents('0,1') + toCents('0,2'), 30);
  assert.equal(toCents('1250.5'), 125_050);
  assert.equal(formatEur(66_421), '664,21 €');
  assert.equal(formatEur(null), 'Noch nicht festgelegt');
  assert.throws(() => toCents('abc'));
});

test('Reset: Monatsanfang Europe/Berlin', () => {
  assert.equal(nextReset(new Date('2026-10-18T10:00:00Z')).toISOString(), '2026-10-31T23:00:00.000Z');
  assert.equal(nextReset(new Date('2026-12-31T23:30:00Z')).toISOString(), '2027-01-31T23:00:00.000Z');
  assert.equal(nextReset(new Date('2026-03-10T10:00:00Z')).toISOString(), '2026-03-31T22:00:00.000Z');
});

test('Ohne Anbieter nie „live“; Vorteil nur mit aktiver, echter Karte im Live-Betrieb', () => {
  assert.equal(programStatus({}), 'COMING_SOON');
  assert.equal(programStatus({ CARD_PROGRAM_STATUS: 'LIVE' }), 'COMING_SOON');
  assert.equal(programStatus({ CARD_PROGRAM_STATUS: 'LIVE', CARD_PROVIDER_API_URL: 'x', CARD_PROVIDER_API_KEY: 'y' }), 'COMING_SOON');
  assert.equal(programStatus({ CARD_PROGRAM_STATUS: 'LIVE', CARD_PROVIDER_API_URL: 'x', CARD_PROVIDER_API_KEY: 'y', CARD_COMPLIANCE_APPROVED: 'true' }), 'LIVE');
  assert.equal(capabilities({}).cardIssuing, 'READY_FOR_INTEGRATION');
  assert.equal(benefitFor([{ status: 'ACTIVE', is_demo: true, created_at: '2026-10-01' }], true).eligible, false);
  assert.equal(benefitFor([{ status: 'ACTIVE', is_demo: false, created_at: '2026-10-01' }], false).eligible, false);
  assert.equal(benefitFor([{ status: 'ACTIVE', is_demo: false, created_at: '2026-10-01' }], true).eligible, true);
});

test('Preisverzeichnis: 19 Kapitel, keine erfundenen Preise, Prüfsumme stabil', () => {
  const v = currentPricing();
  assert.equal(v.chapters.length, 19);
  assert.equal(v.status, 'DRAFT');
  const priced = v.chapters.flatMap((c) => c.items).filter((i) => i.amount != null);
  assert.ok(priced.every((i) => i.amount === 0), 'Nur 0,00-€-Positionen sind festgelegt');
  assert.equal(pricingHash(v), pricingHash(PRICING_VERSIONS[PRICING_VERSIONS.length - 1]));
  assert.match(pricingHash(v), /^[0-9a-f]{64}$/);
});

test('Stripe Issuing: Testbetrieb nur mit Testschlüssel und Webhook-Geheimnis, live nur mit Freigabe', () => {
  const base = { CARD_PROVIDER: 'stripe', STRIPE_ISSUING_WEBHOOK_SECRET: 'whsec_x' };
  assert.equal(programStatus({ ...base, CARD_PROGRAM_STATUS: 'SANDBOX', STRIPE_SECRET_KEY: 'sk_live_1' }), 'COMING_SOON');
  assert.equal(programStatus({ ...base, CARD_PROGRAM_STATUS: 'SANDBOX', STRIPE_TEST_SECRET_KEY: 'sk_test_1' }), 'SANDBOX');
  assert.equal(programStatus({ ...base, CARD_PROGRAM_STATUS: 'LIVE', STRIPE_SECRET_KEY: 'sk_live_1' }), 'COMING_SOON');
  assert.equal(programStatus({ ...base, CARD_PROGRAM_STATUS: 'LIVE', STRIPE_SECRET_KEY: 'sk_live_1', CARD_COMPLIANCE_APPROVED: 'true' }), 'LIVE');
  assert.equal(programStatus({ CARD_PROVIDER: 'stripe', CARD_PROGRAM_STATUS: 'SANDBOX', STRIPE_TEST_SECRET_KEY: 'sk_test_1' }), 'COMING_SOON');
});
