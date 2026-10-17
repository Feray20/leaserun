import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { userFromRequest } from '@/lib/billing/auth';
import { checkoutParams } from '@/lib/billing/checkout-params';
import { billingEnabled, ensureCustomer, ensurePrice, ensureTaxRate, isPlan, stripe } from '@/lib/billing/stripe';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!billingEnabled()) {
    return NextResponse.json({ error: 'Kostenpflichtige Angebote sind noch nicht buchbar.' }, { status: 503 });
  }
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  if (!allowRequest(`checkout:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, { status: 429 });
  }

  let body: { plan?: unknown; consent?: unknown };
  try {
    body = (await req.json()) as { plan?: unknown; consent?: unknown };
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

  try {
    const [customer, price, taxRate] = await Promise.all([
      ensureCustomer(user.id, user.email),
      ensurePrice(plan),
      ensureTaxRate(),
    ]);
    const metadata = {
      plan,
      supabase_user_id: user.id,
      consent_immediate_start: new Date().toISOString(),
    };

    const params = checkoutParams({
      plan, customer: customer.id, clientRef: user.id, price, taxRate, metadata,
      successUrl: `${origin}/app/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/angebote?checkout=cancel`,
    });

    const session = await stripe().checkout.sessions.create(params);
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('checkout_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Checkout konnte nicht erstellt werden.' }, { status: 502 });
  }
}
