import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { userFromRequest } from '@/lib/billing/auth';
import { billingEnabled, findCustomer, stripe } from '@/lib/billing/stripe';

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
    const base: Stripe.BillingPortal.SessionCreateParams = { customer: customer.id, return_url: `${new URL(req.url).origin}/app/dashboard#konto`, locale: 'de' };
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
