// Run: node --test tests/leads-admin.test.mjs  (no network: fetch is stubbed)
import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, passwordOk } from '../site/api/leads-admin.mjs';
import { sbUrl } from '../site/api/sb.mjs';

const req = (body) => new Request('https://leaserun.com/api/leads-admin', { method: 'POST', body: JSON.stringify(body) });
const nowait = { wait: async () => {} };

test('password check: too short, missing or wrong is rejected', async () => {
  assert.equal(await passwordOk('x', ''), false);
  assert.equal(await passwordOk('geheim12', 'kurz'), false);
  assert.equal(await passwordOk('', 'geheim123'), false);
  assert.equal(await passwordOk('falsch123', 'geheim123'), false);
  assert.equal(await passwordOk('geheim123', 'geheim123'), true);
});

test('list and update use the service key server-side; bad input is refused', async () => {
  process.env.LEASERUN_ADMIN_PASSWORD = 'geheim123'; process.env.LR_SB_SERVICE_KEY = 'service-test';
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(init?.method === 'PATCH' ? '' : '[{"id":"a"}]', { status: 200 }); };
  assert.equal((await POST(req({ password: 'nope', action: 'list' }), nowait)).status, 401);
  assert.equal(calls.length, 0);
  const r = await POST(req({ password: 'geheim123', action: 'list' }), nowait);
  assert.deepEqual(await r.json(), { leads: [{ id: 'a' }] });
  assert.match(calls[0].url, /\/rest\/v1\/leads\?select=\*&order=created_at\.desc&limit=1000$/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer service-test');
  assert.equal((await POST(req({ password: 'geheim123', action: 'update', id: 'x', status: 'won' }), nowait)).status, 400);
  assert.equal((await POST(req({ password: 'geheim123', action: 'update', id: '11111111-2222-3333-4444-555555555555', status: 'hacked' }), nowait)).status, 400);
  const u = await POST(req({ password: 'geheim123', action: 'update', id: '11111111-2222-3333-4444-555555555555', status: 'won' }), nowait);
  assert.equal(u.status, 200);
  assert.equal(calls.at(-1).init.method, 'PATCH');
});

test('database address: default until the move, own server via LR_SB_URL, junk ignored', () => {
  delete process.env.LR_SB_URL;
  assert.equal(sbUrl(), 'https://pxexxguhgqfxwhtnwcrj.supabase.co');
  process.env.LR_SB_URL = 'https://db.leaserun.com';
  assert.equal(sbUrl(), 'https://db.leaserun.com');
  process.env.LR_SB_URL = 'javascript:alert(1)';
  assert.equal(sbUrl(), 'https://pxexxguhgqfxwhtnwcrj.supabase.co');
  delete process.env.LR_SB_URL;
});
