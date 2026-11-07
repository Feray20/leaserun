// LeaseRun lead admin API – inside the LeaseRun Worker (moved from the Supabase Edge Function "leads-admin",
// Nov 2026, so LeaseRun no longer needs Supabase Edge Functions and can run on the own server).
// Auth: shared admin password (Worker secret LEASERUN_ADMIN_PASSWORD). The service key (Worker secret
// LR_SB_SERVICE_KEY) is used server-side only; the browser never sees it. Same origin as the admin page → no CORS.
import { sbUrl } from './sb.mjs';

const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers });

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

export async function passwordOk(given, expected) {
  if (!expected || expected.length < 8 || typeof given !== 'string' || !given) return false;
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function rest(path, init = {}) {
  const key = process.env.LR_SB_SERVICE_KEY || '';
  return fetch(`${sbUrl()}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

export async function POST(request, { wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const expected = process.env.LEASERUN_ADMIN_PASSWORD || '';
  if (!(await passwordOk(body.password, expected))) {
    await wait(900); // slow down guessing
    return json({ error: expected.length >= 8 ? 'unauthorized' : 'not_configured' }, 401);
  }
  if (!process.env.LR_SB_SERVICE_KEY) return json({ error: 'not_configured' }, 500);

  if (body.action === 'list') {
    const r = await rest('leads?select=*&order=created_at.desc&limit=1000');
    if (!r.ok) return json({ error: `db ${r.status}` }, 500);
    return json({ leads: await r.json() });
  }
  if (body.action === 'update') {
    const id = String(body.id ?? ''), status = String(body.status ?? '');
    if (!ID.test(id) || !STATUSES.includes(status)) return json({ error: 'bad_request' }, 400);
    const r = await rest(`leads?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status }) });
    if (!r.ok) return json({ error: `db ${r.status}` }, 500);
    return json({ ok: true });
  }
  if (body.action === 'ping') return json({ ok: true });
  return json({ error: 'unknown_action' }, 400);
}
