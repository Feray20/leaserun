// Run: node --test tests/webhook.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySignature, parseReference, POST } from '../site/api/stripe-webhook.js';

const secret = 'whsec_test';
const sign = (body, t) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('valid signature passes, tampered body and old timestamp fail', () => {
  const now = 1_800_000_000, body = '{"id":"evt_1"}';
  assert.equal(verifySignature(body, sign(body, now), secret, now), true);
  assert.equal(verifySignature(body + ' ', sign(body, now), secret, now), false);
  assert.equal(verifySignature(body, sign(body, now - 1000), secret, now), false);
  assert.equal(verifySignature(body, 'garbage', secret, now), false);
  assert.equal(verifySignature(body, sign(body, now), '', now), false);
});

test('client_reference_id parsing', () => {
  const u = '11111111-2222-3333-4444-555555555555', p = '66666666-7777-8888-9999-000000000000';
  assert.deepEqual(parseReference(u), { user: u, property: null });
  assert.deepEqual(parseReference(`${u}_${p}`), { user: u, property: p });
  assert.deepEqual(parseReference('x_y'), { user: null, property: null });
});

test('handler grants the plan of a paid payment link', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = secret; process.env.LR_GRANT_SECRET = 'g'; process.env.LR_PAYMENT_LINKS = '{"plink_pro":"pro"}';
  const calls = []; globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('"pro"', { status: 200 }); };
  const body = JSON.stringify({ id: 'evt_9', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', payment_link: 'plink_pro', client_reference_id: '11111111-2222-3333-4444-555555555555', customer: 'cus_1', subscription: 'sub_1' } } });
  const t = Math.floor(Date.now() / 1000);
  const res = await POST(new Request('http://x', { method: 'POST', body, headers: { 'stripe-signature': sign(body, t) } }));
  assert.equal(res.status, 200);
  assert.equal(calls[0].p_plan, 'pro'); assert.equal(calls[0].p_subscription, 'sub_1'); assert.equal(calls[0].p_secret, 'g');
  const bad = await POST(new Request('http://x', { method: 'POST', body, headers: { 'stripe-signature': 't=1,v1=00' } }));
  assert.equal(bad.status, 400);
});
