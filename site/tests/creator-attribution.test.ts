import test from 'node:test';
import assert from 'node:assert/strict';
import { benefitValidAt, creatorLink, decide, netCents, normCampaign, normRef, type BenefitRef, type CreatorRef } from '../lib/creator/attribution-rules';

const now = new Date('2026-10-23T12:00:00Z');
const A: CreatorRef = { id: 'ca', user_id: 'ua', status: 'ACTIVE', ref_code: 'abcdefghjk' };
const B: CreatorRef = { id: 'cb', user_id: 'ub', status: 'ACTIVE', ref_code: 'mnpqrstuvw' };
const creators = new Map([[A.id, A], [B.id, B]]);
const benefitB: BenefitRef = { id: 'bb', creator_id: 'cb', code: 'BEN', active: true, starts_at: '2026-10-01T00:00:00Z', ends_at: null, campaign_slug: 'herbst' };
const facts = (o: Partial<Parameters<typeof decide>[0]> = {}) => ({ paid: true, test: false, b2b: false, userId: 'kunde', promoCodes: [], occurredAt: now, ...o });
const linkA = { creator_id: 'ca', campaign_slug: 'herbst', created_at: '2026-10-10T00:00:00Z' };

test('Link-Zuordnung innerhalb des Fensters', () => {
  assert.deepEqual(decide(facts(), { benefits: [], attribution: linkA, creators }), { attribute: true, creatorId: 'ca', source: 'link', benefitId: null, campaignSlug: 'herbst' });
});

test('Vorteilscode hat Vorrang vor dem Link (auch Groß-/Kleinschreibung egal)', () => {
  const d = decide(facts({ promoCodes: ['ben'] }), { benefits: [benefitB], attribution: linkA, creators });
  assert.deepEqual(d, { attribute: true, creatorId: 'cb', source: 'code', benefitId: 'bb', campaignSlug: 'herbst' });
});

test('Abgelaufener oder inaktiver Code fällt auf den Link zurück', () => {
  const expired = { ...benefitB, ends_at: '2026-10-20T00:00:00Z' };
  assert.equal((decide(facts({ promoCodes: ['BEN'] }), { benefits: [expired], attribution: linkA, creators }) as { creatorId: string }).creatorId, 'ca');
  const inactive = { ...benefitB, active: false };
  assert.equal((decide(facts({ promoCodes: ['BEN'] }), { benefits: [inactive], attribution: linkA, creators }) as { creatorId: string }).creatorId, 'ca');
  assert.equal(benefitValidAt({ ...benefitB, starts_at: '2026-11-01T00:00:00Z' }, now), false);
});

test('Keine Zuordnung: unbezahlt, Testkauf, B2B, ohne Nutzer, ohne Treffer', () => {
  const ctx = { benefits: [], attribution: linkA, creators };
  assert.deepEqual(decide(facts({ paid: false }), ctx), { attribute: false, reason: 'unpaid' });
  assert.deepEqual(decide(facts({ test: true }), ctx), { attribute: false, reason: 'test' });
  assert.deepEqual(decide(facts({ b2b: true }), ctx), { attribute: false, reason: 'b2b' });
  assert.deepEqual(decide(facts({ userId: null }), ctx), { attribute: false, reason: 'no_user' });
  assert.deepEqual(decide(facts(), { benefits: [], attribution: null, creators }), { attribute: false, reason: 'no_match' });
});

test('Eigenkauf des Creators wird nie zugeordnet (Link und Code)', () => {
  assert.deepEqual(decide(facts({ userId: 'ua' }), { benefits: [], attribution: linkA, creators }), { attribute: false, reason: 'self' });
  assert.deepEqual(decide(facts({ userId: 'ub', promoCodes: ['BEN'] }), { benefits: [benefitB], attribution: null, creators }), { attribute: false, reason: 'self' });
});

test('Nicht aktive Creator erhalten keine Zuordnung', () => {
  const susp = new Map([[A.id, { ...A, status: 'SUSPENDED' }]]);
  assert.deepEqual(decide(facts(), { benefits: [], attribution: linkA, creators: susp }), { attribute: false, reason: 'inactive' });
});

test('Zuordnungsfenster (Standard 90 Tage, einstellbar)', () => {
  const old = { ...linkA, created_at: '2026-06-01T00:00:00Z' };
  assert.deepEqual(decide(facts(), { benefits: [], attribution: old, creators }), { attribute: false, reason: 'expired' });
  assert.equal(decide(facts(), { benefits: [], attribution: old, creators, windowDays: 365 }).attribute, true);
});

test('Netto-Umsatz: Endbetrag minus Steuer, nie negativ', () => {
  assert.equal(netCents(4900, 782), 4118);
  assert.equal(netCents(0, 0), 0);
  assert.equal(netCents(100, 200), 0);
  assert.equal(netCents(null, undefined), 0);
});

test('Referenzen und Kampagnen werden streng geprüft', () => {
  assert.equal(normRef('abcdefghjk'), 'abcdefghjk');
  assert.equal(normRef('ABC'), null);
  assert.equal(normRef('a<script>'), null);
  assert.equal(normCampaign('Herbst-2026'), 'herbst-2026');
  assert.equal(normCampaign('x'), null);
});

test('Creator-Link enthält nur den Code und die Kampagne – keine Personendaten', () => {
  assert.equal(creatorLink('https://leaserun.com', 'abcdefghjk'), 'https://leaserun.com/?ref=abcdefghjk');
  assert.equal(creatorLink('https://leaserun.com', 'abcdefghjk', { slug: 'herbst', target_path: '/calculators/budget' }), 'https://leaserun.com/calculators/budget?ref=abcdefghjk&utm_campaign=herbst');
});
