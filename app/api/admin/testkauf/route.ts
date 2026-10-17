import { NextResponse } from 'next/server';
import { z } from 'zod';
import type Stripe from 'stripe';
import { requireAdmin } from '@/lib/security/admin';
import { PLANS, ensurePrice, ensureTaxRate, isPlan, testKeyMode, testStripe } from '@/lib/billing/stripe';
import { checkoutParams } from '@/lib/billing/checkout-params';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → Testkauf: dieselbe Bezahlseite wie im echten Kauf, aber im Stripe-Testmodus.
// Es fließt kein Geld, und Testkäufe schalten keine Leistungen in echten Konten frei.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const PM = ['card', 'paypal', 'apple_pay', 'google_pay', 'klarna', 'sepa_debit', 'link'] as const;
const PM_LABEL: Record<string, string> = { card: 'Karte', paypal: 'PayPal', apple_pay: 'Apple Pay', google_pay: 'Google Pay', klarna: 'Klarna', sepa_debit: 'SEPA-Lastschrift', link: 'Link' };

function pmStatus(cfg: Stripe.PaymentMethodConfiguration | undefined) {
  const c = (cfg || {}) as unknown as Record<string, { available?: boolean; display_preference?: { value?: string } } | undefined>;
  return PM.map((k) => ({ key: k, label: PM_LABEL[k], on: Boolean(c[k]?.available && c[k]?.display_preference?.value === 'on') }));
}

async function testCustomer(s: Stripe, email: string): Promise<string> {
  const list = await s.customers.list({ email, limit: 10 });
  const hit = list.data.find((c) => c.metadata?.immoadv_test === '1');
  if (hit) return hit.id;
  const c = await s.customers.create({ email, name: 'ImmoAdv Testkauf', preferred_locales: ['de'], metadata: { immoadv_test: '1' } });
  return c.id;
}

function summary(x: Stripe.Checkout.Session) {
  const pi = typeof x.payment_intent === 'object' ? x.payment_intent : null;
  const pm = pi && typeof pi.payment_method === 'object' ? pi.payment_method : null;
  const inv = typeof x.invoice === 'object' ? x.invoice : null;
  const sub = typeof x.subscription === 'object' ? x.subscription : null;
  const subInv = sub && typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
  const anyInv = inv || subInv;
  return {
    id: x.id, created: new Date(x.created * 1000).toISOString(), plan: x.metadata?.plan || null,
    status: x.status, paymentStatus: x.payment_status, amount: x.amount_total, tax: x.total_details?.amount_tax ?? null,
    method: pm?.type ? PM_LABEL[pm.type] || pm.type : (x.payment_method_types || []).join(', '),
    email: x.customer_details?.email || null,
    invoicePdf: anyInv?.invoice_pdf || null, invoiceUrl: anyInv?.hosted_invoice_url || null, invoiceNumber: anyInv?.number || null,
    subscription: sub ? { status: sub.status } : null,
  };
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const mode = testKeyMode();
  const plans = Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name.replace(/^ImmoAdv /, ''), cents: p.amount, mode: p.mode }));
  if (!mode) return j({ available: false, plans });
  const s = testStripe();
  const sid = new URL(req.url).searchParams.get('sid');
  try {
    if (sid) {
      if (!/^cs_test_[A-Za-z0-9]+$/.test(sid)) return j({ error: 'Ungültige Sitzung.' }, 400);
      const x = await s.checkout.sessions.retrieve(sid, { expand: ['payment_intent.payment_method', 'invoice', 'subscription.latest_invoice'] });
      return j({ available: true, session: summary(x) });
    }
    const [cfgs, recent] = await Promise.all([
      s.paymentMethodConfigurations.list({ limit: 20 }).catch(() => null),
      s.checkout.sessions.list({ limit: 10, expand: ['data.payment_intent.payment_method'] }).catch(() => null),
    ]);
    const def = cfgs?.data.find((c) => c.is_default && c.active) || cfgs?.data.find((c) => c.active);
    return j({
      available: true, mode, plans,
      methods: pmStatus(def),
      recent: (recent?.data || []).filter((x) => x.metadata?.immoadv_test === '1').map(summary),
    });
  } catch (e) {
    console.error('testkauf_get', e instanceof Error ? e.message : e);
    return j({ error: 'Stripe-Testmodus nicht erreichbar – Testschlüssel prüfen.' }, 502);
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!testKeyMode()) return j({ error: 'Kein Stripe-Testschlüssel hinterlegt (STRIPE_TEST_SECRET_KEY).' }, 503);
  const p = z.object({ plan: z.string() }).safeParse(await req.json().catch(() => null));
  if (!p.success || !isPlan(p.data.plan)) return j({ error: 'Unbekanntes Angebot.' }, 400);
  const plan = p.data.plan;
  const s = testStripe();
  const origin = new URL(req.url).origin;
  try {
    const [customer, price, taxRate] = await Promise.all([testCustomer(s, auth.user.email), ensurePrice(plan, s), ensureTaxRate(s)]);
    const metadata = { plan, immoadv_test: '1', admin: auth.user.email, consent_immediate_start: new Date().toISOString() };
    const x = await s.checkout.sessions.create(checkoutParams({
      plan, customer, clientRef: `test-${Date.now()}`, price, taxRate, metadata,
      successUrl: `${origin}/intern/web-admin?testkauf={CHECKOUT_SESSION_ID}#testkauf`,
      cancelUrl: `${origin}/intern/web-admin?testkauf=abbruch#testkauf`,
    }));
    await adminAudit(auth.user.email, 'testkauf_start', null, { plan });
    return j({ url: x.url });
  } catch (e) {
    console.error('testkauf_post', e instanceof Error ? e.message : e);
    return j({ error: `Testkauf konnte nicht gestartet werden: ${e instanceof Error ? e.message.slice(0, 160) : 'Fehler'}` }, 502);
  }
}
