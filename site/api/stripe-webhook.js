// Stripe webhook → unlocks LeaseRun plans in Supabase.
// Env (Vercel): STRIPE_WEBHOOK_SECRET (whsec_...), LR_GRANT_SECRET, LR_PAYMENT_LINKS ({"plink_...":"pro", ...}).
// No Stripe secret key is needed: the plan comes from the payment link, the user from client_reference_id.
import crypto from 'node:crypto';

const SB_URL = 'https://pxexxguhgqfxwhtnwcrj.supabase.co';
const SB_KEY = 'sb_publishable_7Ga_tZ-JbJyVbA5e8YaGUg_DvftkCHP';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLANS = new Set(['loan_package', 'buyer_pass', 'pro', 'b2b_basic', 'b2b_pro']);

export function verifySignature(raw, header, secret, now = Math.floor(Date.now() / 1000), tolerance = 300) {
  if (!header || !secret) return false;
  const parts = Object.create(null); const v1 = [];
  for (const kv of header.split(',')) { const i = kv.indexOf('='); if (i < 0) continue; const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (k === 'v1') v1.push(v); else parts[k] = v; }
  const t = Number(parts.t);
  if (!t || !v1.length || Math.abs(now - t) > tolerance) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex');
  return v1.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export function parseReference(ref) {
  const [u, p] = String(ref || '').split('_');
  return { user: UUID.test(u || '') ? u : null, property: UUID.test(p || '') ? p : null };
}

async function grant(args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/lr_grant`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: process.env.LR_GRANT_SECRET, ...args })
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`grant failed ${r.status}: ${text.slice(0, 200)}`);
  return text;
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

export async function POST(request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET)) return json({ error: 'invalid signature' }, 400);
  if (!process.env.LR_GRANT_SECRET) return json({ error: 'not configured' }, 500);
  let evt; try { evt = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  const o = evt.data && evt.data.object || {};
  let links = {}; try { links = JSON.parse(process.env.LR_PAYMENT_LINKS || '{}'); } catch {}

  try {
    if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
      if (evt.type === 'checkout.session.completed' && o.payment_status === 'unpaid') return json({ ok: true, skipped: 'awaiting async payment' });
      const plan = links[o.payment_link] || (o.metadata && o.metadata.lr_plan);
      const ref = parseReference(o.client_reference_id);
      if (!PLANS.has(plan) || !ref.user) return json({ ok: true, skipped: 'not a LeaseRun plan purchase' });
      const res = await grant({ p_event: evt.id, p_action: 'checkout', p_user: ref.user, p_plan: plan, p_property: plan === 'loan_package' ? ref.property : null,
        p_customer: typeof o.customer === 'string' ? o.customer : null, p_subscription: typeof o.subscription === 'string' ? o.subscription : null });
      return json({ ok: true, result: res });
    }
    if (evt.type === 'customer.subscription.deleted') {
      const res = await grant({ p_event: evt.id, p_action: 'cancel', p_user: null, p_plan: null, p_subscription: o.id });
      return json({ ok: true, result: res });
    }
    return json({ ok: true, ignored: evt.type });
  } catch (e) {
    console.error(e);
    return json({ error: 'processing failed' }, 500); // Stripe retries
  }
}

export function GET() { return json({ ok: true, endpoint: 'stripe-webhook' }); }
