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
  if (await intakeClosed()) return NextResponse.json({ error: 'Vorübergehend nicht möglich (Wartung). Bitte später erneut versuchen.' }, { status: 503 });
  if (!billingEnabled()) {
    return NextResponse.json({ error: 'Kostenpflichtige Angebote sind noch nicht buchbar.' }, { status: 503 });
  }
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  if (!allowRequest(`checkout:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, { status: 429 });
  }

  let body: { plan?: unknown; consent?: unknown; addon?: unknown; reviewOk?: unknown; embedded?: unknown; back?: unknown };
  try {
    body = (await req.json()) as { plan?: unknown; consent?: unknown; addon?: unknown; reviewOk?: unknown; embedded?: unknown; back?: unknown };
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }
  if (!isPlan(body.plan)) return NextResponse.json({ error: 'Unbekanntes Angebot.' }, { status: 400 });
  // Ausdrückliche Zustimmung zum sofortigen Leistungsbeginn (§ 356 Abs. 4 und 5 BGB).
  if (body.consent !== true) {
    return NextResponse.json({ error: 'Bitte der sofortigen Bereitstellung zustimmen.' }, { status: 400 });
  }

  const plan = body.plan;
  const origin = new URL(req.url).origin;
  const back = safeBack(body.back, '/pricing');

  try {
    // Testkauf-Schalter an (nur Administratoren): gleiche Bezahlseite im Stripe-Testmodus, kein echtes Geld, keine Freischaltung.
    const ts = await testStripeFor(user.email);
    if (ts) {
      after(() => rememberOwnVisitor(visitorOf(req)));
      const [tc, tp, tt] = await Promise.all([testCustomer(ts, user.email), ensurePrice(plan, ts), ensureTaxRate(ts)]);
      const x = await createCheckoutSession(ts, checkoutParams({
        plan, customer: tc, clientRef: `test-${user.id}`, price: tp, taxRate: tt,
        metadata: { plan, leaserun_test: '1', admin: user.email, consent_immediate_start: new Date().toISOString() },
        successUrl: `${origin}/app/dashboard?checkout=test#konto`, cancelUrl: `${origin}${back}`,
      }));
      return NextResponse.json({ url: x.url, test: true });
    }
    // Zusatzprodukt nur zu Einmalkäufen (Kreditmappe, Käufer-Pass) und nur auf ausdrücklichen Wunsch (kein vorausgewähltes Kästchen).
    const withAddon = body.addon === 'leitfaden' && PLANS[plan].mode === 'payment';
    const [customer, price, taxRate, addonPrice] = await Promise.all([
      ensureCustomer(user.id, user.email),
      ensurePrice(plan),
      ensureTaxRate(),
      withAddon ? ensureAddonPrice() : Promise.resolve(null),
    ]);
    // Kasse der Betreiberin (Test) – zählt in der Kassen-Auswertung des Headquarters nicht als Kundenabbruch.
    const intern = ownEmails().has(String(user.email || '').toLowerCase()) || (await isOwnRequest(req));
    // Tägliche Besucherkennung dieser eigenen Kasse merken: so fallen ihre Aufrufe 24 Std. lang auch aus dem Trichter.
    if (intern) after(() => rememberOwnVisitor(visitorOf(req)));
    const metadata: Record<string, string> = {
      plan,
      ...(addonPrice ? { addon: 'leitfaden' } : {}),
      ...(body.reviewOk === true ? { review_ok: '1' } : {}),
      supabase_user_id: user.id,
      consent_immediate_start: new Date().toISOString(),
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
      // Eingebettete Bezahlung; klappt das nicht (z. B. geänderte Stripe-Vorgaben), sofort die Stripe-Bezahlseite – ein Kauf darf nie scheitern.
      const session = await createCheckoutSession(stripe(), { ...toEmbedded(params, success), expand: ['line_items'] }).catch((e) => { console.error('checkout_embed_fallback', e instanceof Error ? e.message : e); after(() => reportServerError('checkout_embed_fallback', e, '/api/billing/checkout', 'ausweichen')); return null; });
      if (!session) { const hosted = await createCheckoutSession(stripe(), params); return NextResponse.json({ url: hosted.url }); }
      const def = PLANS[plan];
      const summary: KasseSummary = {
        title: def.name, interval: def.mode === 'subscription' ? 'monatlich' : null, net: false, back, area: 'b2c',
        lines: (session.line_items?.data || []).map((l) => ({ label: l.description || def.name, amount: l.amount_total })), total: session.amount_total,
      };
      return NextResponse.json({ clientSecret: session.client_secret, publishableKey: pk, summary });
    }
    const session = await createCheckoutSession(stripe(), params);
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('checkout_error', e instanceof Error ? e.message : e);
    after(() => reportServerError('checkout_error', e, '/api/billing/checkout'));
    return NextResponse.json({ error: 'Checkout konnte nicht erstellt werden.' }, { status: 502 });
  }
}
