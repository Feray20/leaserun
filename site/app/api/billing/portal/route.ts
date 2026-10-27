import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { userFromRequest } from '@/lib/billing/auth';
import { billingEnabled, findCustomer, stripe } from '@/lib/billing/stripe';
import { applyPaymentMethod, createPaymentMethodSession } from '@/lib/billing/payment-method';

export const dynamic = 'force-dynamic';

// Stripe customer portal. Optionally jump straight into a flow:
//   flow = 'update'  → change plan (upgrade/downgrade, if enabled in the Stripe portal)
//   flow = 'cancel'  → cancel subscription
//   flow = 'payment' → update payment method
// Without flow (or if a flow is not possible): portal home with receipts, payment methods and subscriptions.
export async function POST(req: Request) {
  if (!billingEnabled()) return NextResponse.json({ error: 'Payments are launching soon – until then there are no subscriptions or receipts.' }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { flow?: unknown };
  const flow = body.flow === 'update' || body.flow === 'cancel' || body.flow === 'payment' ? body.flow : null;
  try {
    const customer = await findCustomer(user.id, user.email);
    if (!customer) return NextResponse.json({ error: 'No purchases yet.' }, { status: 404 });
    const origin = new URL(req.url).origin;
    // Update payment method: on the LeaseRun page /checkout (embedded) instead of the Stripe customer portal.
    if (flow === 'payment') {
      const pm = await createPaymentMethodSession(stripe(), {
        customer: customer.id, area: 'b2c', back: '/app/dashboard#konto', metadata: { supabase_user_id: user.id },
        returnUrl: `${origin}/app/dashboard?zahlungsmittel=1&session_id={CHECKOUT_SESSION_ID}#konto`,
      }).catch((e) => { console.warn('pm_session_error', e instanceof Error ? e.message : e); return null; });
      if (pm) return NextResponse.json(pm);
    }
    const base: Stripe.BillingPortal.SessionCreateParams = { customer: customer.id, return_url: `${origin}/app/dashboard#konto`, locale: 'en' };
    let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
    if (flow === 'payment') flowData = { type: 'payment_method_update' };
    if (flow === 'update' || flow === 'cancel') {
      const subs = await stripe().subscriptions.list({ customer: customer.id, status: 'active', limit: 1 });
      const sub = subs.data[0];
      if (!sub) return NextResponse.json({ error: flow === 'cancel' ? 'You have no active subscription. Passes and one-time purchases end automatically.' : 'No active subscription. You can choose a plan under "Plans".' }, { status: 404 });
      flowData = flow === 'cancel' ? { type: 'subscription_cancel', subscription_cancel: { subscription: sub.id } } : { type: 'subscription_update', subscription_update: { subscription: sub.id } };
    }
    let session: Stripe.BillingPortal.Session;
    try {
      session = await stripe().billingPortal.sessions.create(flowData ? { ...base, flow_data: flowData } : base);
    } catch (e) {
      // e.g. plan change not configured in the Stripe portal: fall back to the portal home page.
      console.warn('portal_flow_fallback', e instanceof Error ? e.message : e);
      session = await stripe().billingPortal.sessions.create(base);
    }
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('portal_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'The billing portal could not be opened.' }, { status: 502 });
  }
}

// Return from /checkout after "Update payment method": make the new method the default (customer + active subscriptions).
export async function PUT(req: Request) {
  if (!billingEnabled()) return NextResponse.json({ error: 'Not available.' }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { sessionId?: unknown };
  const id = typeof body.sessionId === 'string' && /^cs_(live|test)_[A-Za-z0-9]+$/.test(body.sessionId) ? body.sessionId : null;
  if (!id) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const customer = await findCustomer(user.id, user.email);
    if (!customer) return NextResponse.json({ error: 'No customer account found.' }, { status: 404 });
    const r = await applyPaymentMethod(stripe(), id, customer.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    console.error('pm_apply_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'The payment method could not be saved. Please try again.' }, { status: 502 });
  }
}
