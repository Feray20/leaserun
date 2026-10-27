import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { userFromRequest } from '@/lib/billing/auth';
import { billingEnabled, findCustomer, stripe } from '@/lib/billing/stripe';
import { applyPaymentMethod, createPaymentMethodSession } from '@/lib/billing/payment-method';

export const dynamic = 'force-dynamic';

// Stripe-Kundenportal. Optional direkt in einen Ablauf springen:
//   flow = 'update'  → Tarif wechseln (Upgrade/Downgrade, sofern im Stripe-Portal freigegeben)
//   flow = 'cancel'  → Abo kündigen
//   flow = 'payment' → Zahlungsmittel ändern
// Ohne flow (oder wenn ein Ablauf nicht möglich ist): Portal-Startseite mit Rechnungen, Zahlungsmitteln und Abos.
export async function POST(req: Request) {
  if (!billingEnabled()) return NextResponse.json({ error: 'Die Zahlungsabwicklung startet in Kürze – bis dahin gibt es keine Abos oder Rechnungen.' }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { flow?: unknown };
  const flow = body.flow === 'update' || body.flow === 'cancel' || body.flow === 'payment' ? body.flow : null;
  try {
    const customer = await findCustomer(user.id, user.email);
    if (!customer) return NextResponse.json({ error: 'Noch keine Käufe vorhanden.' }, { status: 404 });
    const origin = new URL(req.url).origin;
    // Zahlungsmittel ändern: auf der LeaseRun-Seite /checkout (eingebettet) statt im Stripe-Kundenportal.
    if (flow === 'payment') {
      const pm = await createPaymentMethodSession(stripe(), {
        customer: customer.id, area: 'b2c', back: '/app/dashboard#konto', metadata: { supabase_user_id: user.id },
        returnUrl: `${origin}/app/dashboard?zahlungsmittel=1&session_id={CHECKOUT_SESSION_ID}#konto`,
      }).catch((e) => { console.warn('pm_session_error', e instanceof Error ? e.message : e); return null; });
      if (pm) return NextResponse.json(pm);
    }
    const base: Stripe.BillingPortal.SessionCreateParams = { customer: customer.id, return_url: `${origin}/app/dashboard#konto`, locale: 'de' };
    let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
    if (flow === 'payment') flowData = { type: 'payment_method_update' };
    if (flow === 'update' || flow === 'cancel') {
      const subs = await stripe().subscriptions.list({ customer: customer.id, status: 'active', limit: 1 });
      const sub = subs.data[0];
      if (!sub) return NextResponse.json({ error: flow === 'cancel' ? 'Es besteht kein laufendes Abo. 12-Monats-Zugänge und Einzelkäufe enden automatisch.' : 'Kein laufendes Abo. Einen Tarif buchen Sie unter „Angebot“.' }, { status: 404 });
      flowData = flow === 'cancel' ? { type: 'subscription_cancel', subscription_cancel: { subscription: sub.id } } : { type: 'subscription_update', subscription_update: { subscription: sub.id } };
    }
    let session: Stripe.BillingPortal.Session;
    try {
      session = await stripe().billingPortal.sessions.create(flowData ? { ...base, flow_data: flowData } : base);
    } catch (e) {
      // z. B. Tarifwechsel im Stripe-Portal nicht konfiguriert: auf die Portal-Startseite ausweichen.
      console.warn('portal_flow_fallback', e instanceof Error ? e.message : e);
      session = await stripe().billingPortal.sessions.create(base);
    }
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('portal_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Kundenportal konnte nicht geöffnet werden.' }, { status: 502 });
  }
}

// Rückkehr von /checkout nach „Zahlungsmittel ändern“: neues Zahlungsmittel als Standard setzen (Kunde + laufende Abos).
export async function PUT(req: Request) {
  if (!billingEnabled()) return NextResponse.json({ error: 'Nicht verfügbar.' }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { sessionId?: unknown };
  const id = typeof body.sessionId === 'string' && /^cs_(live|test)_[A-Za-z0-9]+$/.test(body.sessionId) ? body.sessionId : null;
  if (!id) return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  try {
    const customer = await findCustomer(user.id, user.email);
    if (!customer) return NextResponse.json({ error: 'Kein Kundenkonto gefunden.' }, { status: 404 });
    const r = await applyPaymentMethod(stripe(), id, customer.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    console.error('pm_apply_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Das Zahlungsmittel konnte nicht übernommen werden. Bitte erneut versuchen.' }, { status: 502 });
  }
}
