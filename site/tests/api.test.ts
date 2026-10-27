import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.API_KEY_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';
process.env.API_ENCRYPTION_KEY = '0'.repeat(64);

const keys = await import('../lib/api/keys');
const ent = await import('../lib/api/entitlements');
const net = await import('../lib/api/net');
const cr = await import('../lib/api/crypto');
const pag = await import('../lib/api/pagination');
const eng = await import('../lib/api/validation-engine');
const sch = await import('../lib/api/schemas');
const td = await import('../lib/api/testdata');
const wh = await import('../lib/api/webhooks');

const acc = (plan_tier: 'BASIC' | 'PRO' | 'ENTERPRISE' | null, extra: Record<string, unknown> = {}) => ({ id: 't1', status: 'active' as const, plan_tier, plan_until: null, has_whitelabel: false, ...extra });
const row = (o: Record<string, unknown> = {}) => ({ tenant_id: 't1', enabled: true, live_enabled: false, rate_limit: null, burst_limit: null, max_document_bytes: null, webhooks_allowed: null, white_label_allowed: null, routing_enabled: false, ...o });

test('API keys: format, peppered hash, prefix, masking', () => {
  const g = keys.generateKey('test');
  assert.match(g.secret, /^test_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
  assert.equal(keys.parseKey(g.secret)?.prefix, g.prefix);
  assert.equal(g.hash, keys.hashKey(g.secret));
  assert.notEqual(keys.hashKey(g.secret, 'x'.repeat(40)), g.hash, 'different pepper → different hash');
  assert.equal(keys.parseKey('live_abc'), null);
  assert.equal(keys.maskKey(g.prefix), `${g.prefix}_********`);
  assert.ok(!g.hash.includes(g.secret));
});

test('Key state: revoked, expired, disabled', () => {
  assert.equal(keys.keyState({ revoked_at: null, expires_at: null, disabled_at: null }), 'active');
  assert.equal(keys.keyState({ revoked_at: '2026-01-01', expires_at: null, disabled_at: null }), 'revoked');
  assert.equal(keys.keyState({ revoked_at: null, expires_at: new Date(Date.now() - 1000).toISOString(), disabled_at: null }), 'expired');
  assert.equal(keys.keyState({ revoked_at: null, expires_at: null, disabled_at: '2026-01-01' }), 'disabled');
});

test('Entitlements: Basic without API, Pro standard API without webhooks, Enterprise full', () => {
  const basic = ent.computePolicy(acc('BASIC'), row());
  assert.equal(basic.enabled, false); assert.equal(basic.reason, 'PLAN'); assert.deepEqual(basic.allowed_scopes, []);
  const pro = ent.computePolicy(acc('PRO'), row());
  assert.equal(pro.enabled, true); assert.equal(pro.rate_limit, 60);
  assert.ok(pro.allowed_scopes.includes('cases:write') && pro.allowed_scopes.includes('validation:execute') && pro.allowed_scopes.includes('documents:write'));
  assert.ok(!pro.allowed_scopes.includes('webhooks:write')); assert.equal(pro.webhook_enabled, false); assert.equal(pro.white_label_enabled, false);
  const ent1 = ent.computePolicy(acc('ENTERPRISE'), row({ rate_limit: 1000 }));
  assert.ok(ent1.allowed_scopes.includes('webhooks:write')); assert.equal(ent1.webhook_enabled, true); assert.equal(ent1.white_label_enabled, true); assert.equal(ent1.rate_limit, 1000);
  assert.equal(ent.computePolicy(acc(null), row()).enabled, false, 'no plan, no API');
});

test('Entitlements: admin switch, lock, live access, overrides', () => {
  assert.equal(ent.computePolicy(acc('PRO'), null).reason, 'NOT_ENABLED');
  assert.equal(ent.computePolicy(acc('PRO', { status: 'locked' }), row()).reason, 'LOCKED');
  assert.equal(ent.computePolicy(acc('PRO'), row()).live_enabled, false);
  assert.equal(ent.computePolicy(acc('PRO'), row({ live_enabled: true })).live_enabled, true);
  assert.equal(ent.computePolicy(acc('PRO'), row({ webhooks_allowed: true })).webhook_enabled, true, 'admin can enable webhooks for Pro');
  assert.equal(ent.computePolicy(acc('ENTERPRISE'), row({ webhooks_allowed: false })).webhook_enabled, false);
  assert.equal(ent.computePolicy(acc('BASIC'), row({ webhooks_allowed: true })).webhook_enabled, false, 'override does not lift a missing API plan');
  assert.equal(ent.computePolicy(acc('PRO', { plan_until: '2020-01-01T00:00:00Z' }), row()).reason, 'PLAN', 'expired plan');
});

test('IP allowlist with CIDR (IPv4/IPv6, mapped)', () => {
  assert.ok(net.ipAllowed('203.0.113.7', ['203.0.113.0/24']));
  assert.ok(!net.ipAllowed('198.51.100.1', ['203.0.113.0/24']));
  assert.ok(net.ipAllowed('::ffff:203.0.113.7', ['203.0.113.0/24']));
  assert.ok(net.ipAllowed('2001:db8::5', ['2001:db8::/32']));
  assert.ok(net.ipAllowed('1.2.3.4', []), 'empty list = no restriction');
  assert.ok(!net.ipAllowed(null, ['1.2.3.4']));
  assert.ok(net.validCidr('10.0.0.0/8') && !net.validCidr('10.0.0.0/33') && !net.validCidr('nope'));
});

test('SSRF protection: internal targets and metadata services blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe'])
    assert.ok(!net.isPublicIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2a00:1450:4001::1']) assert.ok(net.isPublicIp(ip), ip);
  for (const u of ['http://example.com/h', 'https://localhost/h', 'https://127.0.0.1/h', 'https://[::1]/h', 'https://user:pw@example.com/h', 'https://example.com:8443/h', 'https://metadata.google.internal/x', 'https://api.leaserun.com/x', 'https://intranet/x'])
    assert.equal(net.checkWebhookUrl(u).ok, false, u);
  assert.equal(net.checkWebhookUrl('https://hooks.example.com/leaserun?x=1').ok, true);
});

test('Webhook signature and secret encryption', () => {
  const sec = cr.newWebhookSecret();
  const enc = cr.encryptSecret(sec);
  assert.ok(!enc.includes(sec)); assert.equal(cr.decryptSecret(enc), sec);
  assert.throws(() => cr.decryptSecret(enc.slice(0, -2) + 'AA'), 'tampering is detected');
  const sig = cr.signWebhook('whsec_x', '1700000000', '{"a":1}');
  assert.equal(sig, 'v1=' + createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex'));
});

test('Idempotency hash independent of field order', () => {
  assert.equal(cr.canonicalHash('POST', '/r', { a: 1, b: { c: 2, d: 3 } }), cr.canonicalHash('POST', '/r', { b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(cr.canonicalHash('POST', '/r', { a: 1 }), cr.canonicalHash('POST', '/r', { a: 2 }));
});

test('Cursor pagination: encode, decode, errors', () => {
  const c = { t: '2026-10-24T05:00:00.123456+00:00', id: '11111111-1111-4111-8111-111111111111' };
  assert.deepEqual(pag.decodeCursor(pag.encodeCursor(c)), c);
  assert.throws(() => pag.decodeCursor('broken'));
  const p = pag.pageOf([{ id: 'a', t: '1' }, { id: 'b', t: '2' }, { id: 'c', t: '3' }], 2, (r) => r.t);
  assert.equal(p.data.length, 2); assert.equal(p.pagination.has_more, true); assert.ok(p.pagination.next_cursor);
  assert.throws(() => pag.pageParams(new URL('https://x/?limit=0')));
});

test('Schema: unknown fields are rejected, test case is valid', () => {
  assert.equal(sch.CaseInput.safeParse(td.TEST_CASE).success, true);
  assert.equal(sch.CaseInput.safeParse({ foo: 1 }).success, false);
  assert.equal(sch.CaseInput.safeParse({ property: { purchase_price: -1 } }).success, false);
  assert.equal(sch.CaseInput.safeParse({ customer: { email: 'not-an-email' } }).success, false);
  const m = sch.mergeCase({ property: { purchase_price: 1, address: { city: 'A' } } }, { property: { address: { city: null, state: 'TX' } } });
  assert.deepEqual(m, { property: { purchase_price: 1, address: { state: 'TX' } } });
  assert.equal(sch.CaseInput.safeParse({ property: { address: { state: 'hessen' } } }).success, false, 'only US state codes');
  assert.equal(sch.CaseInput.safeParse({ property: { address: { state: 'ca', postal_code: '94105-1234' } } }).success, true);
});

test('Pre-check test case: machine-readable checks, gap detected, no loan approval', () => {
  const r = eng.evaluateCase(td.TEST_CASE, []);
  const codes = r.checks.map((c) => c.code);
  for (const c of r.checks) for (const k of ['code', 'severity', 'category', 'message', 'field', 'requires_action', 'value', 'threshold']) assert.ok(k in c, k);
  // $450,000 + $13,500 closing costs − $100,000 funds = $363,500 needed, loan $350,000
  assert.equal(r.figures.ancillary_costs, 13500);
  assert.ok(codes.includes('FINANCING_GAP'));
  assert.equal(r.checks.find((c) => c.code === 'FINANCING_GAP')!.threshold, 363500);
  // P&I on $350,000 at 6.5% for 30 years ≈ $2,212.24; PITIA adds $675 tax + $150 insurance + $250 HOA
  assert.ok(Math.abs((r.figures.monthly_rate as number) - 2212.24) < 0.5);
  assert.ok(Math.abs((r.figures.monthly_pitia as number) - 3287.24) < 0.5);
  assert.ok(codes.includes('DOCUMENTS_MISSING')); assert.ok(r.missing_documents.includes('identity'));
  assert.equal(r.bank_readiness, 'not_ready');
  assert.ok(r.completeness_score > 0 && r.completeness_score < 100);
  assert.ok(!/\bapproved\b|guaranteed/i.test(JSON.stringify(r).replace(/Not a loan approval|automated underwriting approval|no guarantee/gi, '')), 'no approval wording');
  assert.match(r.disclaimer, /not a loan approval/i);
});

test('Pre-check complete case with documents: no errors', () => {
  const d = { ...td.TEST_CASE, loan: { ...td.TEST_CASE.loan, requested_amount: 363500 }, equity: { amount: 100000, available_amount: 120000 }, household: { ...td.TEST_CASE.household, monthly_gross_income: 14000, monthly_net_income: 10400 }, applicants: [{ ...td.TEST_CASE.applicants![0], monthly_gross_income: 14000, monthly_net_income: 10400 }] };
  const docs = eng.requiredDocuments(d).map((t, i) => ({ id: String(i), type: t, sha256: String(i).padStart(64, '0'), status: 'verified', verification_status: 'formally_verified', malware_scan: 'not_configured' }));
  const r = eng.evaluateCase(d, docs);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.missing_documents.length, 0);
  assert.equal(r.completeness_score, 100);
});

test('Pre-check: liquidity gap and contradictions', () => {
  const r = eng.evaluateCase({ property: { purchase_price: 300000, address: { state: 'FL' }, land_value: 400000 }, equity: { amount: 20000, available_amount: 15000 }, loan: { requested_amount: 260000 }, household: { monthly_net_income: 4000, monthly_expenses: 1000 } }, []);
  const gap = r.checks.find((c) => c.code === 'LIQUIDITY_GAP');
  assert.ok(gap); assert.equal(gap!.field, 'equity.available_amount'); assert.equal(gap!.requires_action, true);
  assert.ok(r.checks.some((c) => c.code === 'CONTRADICTORY_INFORMATION' && c.field === 'property.land_value'));
});

test('Webhook receiver response bodies are masked', () => {
  const m = wh.maskExcerpt('ok jane@example.com SSN 123-45-6789 DE89 3704 0044 0532 0130 00 +1 (512) 555-0147 acct 000123456789');
  assert.ok(!m.includes('jane@example.com') && !m.includes('123-45-6789') && !m.includes('DE89') && !m.includes('555-0147') && !m.includes('000123456789'));
});

test('Test PDF has a real file signature', async () => {
  const { detectMime } = await import('../lib/documents/files');
  assert.equal(detectMime(td.testPdf())?.mime, 'application/pdf');
});
