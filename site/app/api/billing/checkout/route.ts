import { after, NextResponse } from 'next/server';
import { isOwnRequest } from '@/lib/security/trusted';
import { reportServerError } from '@/lib/admin/server-error';
import { allowRequest } from '@/lib/security/rate-limit';
import { userFromRequest } from '@/lib/billing/auth';
import { checkoutParams, createCheckoutSession, embedKey, safeBack, toEmbedded, type KasseSummary } from '@/lib/billing/checkout-params';
import { billingEnabled, ensureAddonPrice, ensureCustomer, ensurePrice, ensureTaxRate, isPlan, PLANS, stripe } from '@/lib/billing/stripe';
import { intakeClosed } from '@/lib/security/panic';
import { testCustomer, testStripeFor } from '@/lib/billing/testmode';
import { visitorOf } from '@/lib/analytics/track';
import { ownEmails, rememberOwnVisitor } from '@/lib/admin/kasse-kennzahl';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (await intakeClosed()) return NextResponse.json({ error: 'Temporarily unavailable (maintenance). Please try again later.' }, { status: 503 });
  if (!billingEnabled()) {
    return NextResponse.json({ error: 'Paid plans are not available for purchase yet.' }, { status: 503 });
  }
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
  if (!allowRequest(`checkout:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  let body: { plan?: unknown; consent?: unknown; addon?: unknown; reviewOk?: unknown; embedded?: unknown; back?: unknown };
  try {
    body = (await req.json()) as { plan?: unknown; consent?: unknown; addon?: unknown; reviewOk?: unknown; embedded?: unknown; back?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!isPlan(body.plan)) return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 });
  // Affirmative consent to the Terms (and, for subscriptions, to the automatic-renewal terms) – checkbox in the dialog.
  if (body.consent !== true) {
    return NextResponse.json({ error: 'Please check the box to accept the terms first.' }, { status: 400 });
  }

  const plan = body.plan;
  const origin = new URL(req.url).origin;
  const back = safeBack(body.back, '/pricing');

  try {
    // Test purchase switch on (admins only): same checkout in Stripe test mode, no real money, nothing unlocked.
    const ts = await testStripeFor(user.email);
    if (ts) {
      after(() => rememberOwnVisitor(visitorOf(req)));
      const [tc, tp, tt] = await Promise.all([testCustomer(ts, user.email), ensurePrice(plan, ts), ensureTaxRate(ts)]);
      const x = await createCheckoutSession(ts, checkoutParams({
        plan, customer: tc, clientRef: `test-${user.id}`, price: tp, taxRate: tt,
        metadata: { plan, leaserun_test: '1', admin: user.email, consent_at: new Date().toISOString() },
        successUrl: `${origin}/app/dashboard?checkout=test#konto`, cancelUrl: `${origin}${back}`,
      }));
      return NextResponse.json({ url: x.url, test: true });
    }
    // Add-on only with one-time purchases (Lender Package, Buyer Pass) and only when explicitly chosen (never pre-checked).
    const withAddon = body.addon === 'leitfaden' && PLANS[plan].mode === 'payment';
    const [customer, price, taxRate, addonPrice] = await Promise.all([
      ensureCustomer(user.id, user.email),
      ensurePrice(plan),
      ensureTaxRate(),
      withAddon ? ensureAddonPrice() : Promise.resolve(null),
    ]);
    // Owner's own checkout (testing) – not counted as a customer abandon in the Headquarters checkout stats.
    const intern = ownEmails().has(String(user.email || '').toLowerCase()) || (await isOwnRequest(req));
    // Remember the daily visitor ID of this own checkout so its visits drop out of the funnel for 24 hours.
    if (intern) after(() => rememberOwnVisitor(visitorOf(req)));
    const metadata: Record<string, string> = {
      plan,
      ...(addonPrice ? { addon: 'leitfaden' } : {}),
      ...(body.reviewOk === true ? { review_ok: '1' } : {}),
      supabase_user_id: user.id,
      consent_at: new Date().toISOString(),
      ...(intern ? { intern: '1' } : {}),
    };

    const params = checkoutParams({
      plan, customer: customer.id, clientRef: user.id, price, taxRate, metadata, addonPrice,
      successUrl: `${origin}/app/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}${back}`,
    });

    const pk = body.embedded === true ? embedKey() : null;
    if (pk) {
      const success = `${origin}/app/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
      // Embedded checkout; if that fails (e.g. changed Stripe rules), fall back to hosted Stripe checkout – a purchase must never fail.
      const session = await createCheckoutSession(stripe(), { ...toEmbedded(params, success), expand: ['line_items'] }).catch((e) => { console.error('checkout_embed_fallback', e instanceof Error ? e.message : e); after(() => reportServerError('checkout_embed_fallback', e, '/api/billing/checkout', 'fallback')); return null; });
      if (!session) { const hosted = await createCheckoutSession(stripe(), params); return NextResponse.json({ url: hosted.url }); }
      const def = PLANS[plan];
      const summary: KasseSummary = {
        title: def.name, interval: def.mode === 'subscription' ? 'per month' : null, net: false, back, area: 'b2c',
        lines: (session.line_items?.data || []).map((l) => ({ label: l.description || def.name, amount: l.amount_total })), total: session.amount_total,
      };
      return NextResponse.json({ clientSecret: session.client_secret, publishableKey: pk, summary });
    }
    const session = await createCheckoutSession(stripe(), params);
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('checkout_error', e instanceof Error ? e.message : e);
    after(() => reportServerError('checkout_error', e, '/api/billing/checkout'));
    return NextResponse.json({ error: 'Checkout could not be started. Please try again.' }, { status: 502 });
  }
}
