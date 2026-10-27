import '@/lib/env-alias';
import { track } from '@/lib/analytics/track';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/billing/stripe';
import { archiveStripeInvoice, syncSubscription } from '@/lib/b2b/stripe-b2b';
import { adminConfigured } from '@/lib/supabase/admin';
import { sendReviewRequest } from '@/lib/review-mail';
import { pushAdmins } from '@/lib/admin/push';
import { applyPaymentMethod, PM_PURPOSE } from '@/lib/billing/payment-method';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Stripe webhook. The signature is verified with the endpoint secret (STRIPE_WEBHOOK_SECRET).
// Entitlements are read live from Stripe; the webhook acknowledges and logs events.
// For business accounts (metadata.b2b_account_id) the plan is synced and every paid invoice is added to the
// invoice archive; duplicate deliveries are harmless (idempotent).
export async function POST(req: Request) {
  // Temporarily also read the variable created with a typo in Vercel (setup check keeps reporting the typo).
  const secret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRETT;
  const signature = req.headers.get('stripe-signature');
  if (!secret || !signature) return NextResponse.json({ error: 'not configured' }, { status: 400 });

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    if (adminConfigured()) await handleB2B(event);
  } catch (e) {
    console.error('b2b_webhook_error', event.type, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'retry' }, { status: 500 });
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object as Stripe.Checkout.Session;
      // Payment method changed (setup, no payment): make it the default – no purchase notices, no review request.
      if (s.mode === 'setup') {
        if (s.metadata?.purpose === PM_PURPOSE && event.type === 'checkout.session.completed') {
          await applyPaymentMethod(stripe(), s.id).then((r) => console.info('pm_updated', { session: s.id, ok: r.ok })).catch((e) => console.warn('pm_update_webhook', e instanceof Error ? e.message : e));
        }
        break;
      }
      console.info('billing_paid', { session: s.id, plan: s.metadata?.plan, status: s.payment_status });
      if (s.payment_status === 'paid' && s.metadata?.leaserun_test !== '1') await pushAdmins('payment', 'New payment', 'A purchase was paid.');
      await sendReviewRequest(s).catch((e) => console.warn('review_mail', e instanceof Error ? e.message : e));
      // Creator attribution (promo code or creator link) – errors must never fail the webhook.
      await import('@/lib/creator/attribution').then((x) => x.recordCheckoutConversion(stripe(), s)).catch((e) => console.warn('creator_conversion', e instanceof Error ? e.message : e));
      if (s.payment_status === 'paid' && s.metadata?.leaserun_test !== '1') await track({ seg: s.metadata?.b2b_account_id ? 'b2b' : 'b2c', ev: 'purchase', plan: s.metadata?.plan || (s.metadata?.b2b_account_id ? 'b2b' : null) });
      break;
    }
    case 'charge.refunded':
      await import('@/lib/creator/attribution').then((x) => x.reverseForCharge(event.data.object as Stripe.Charge)).catch((e) => console.warn('creator_reverse', e instanceof Error ? e.message : e));
      break;
    case 'checkout.session.async_payment_failed':
    case 'invoice.payment_failed':
      console.warn('billing_payment_failed', { event: event.id, type: event.type });
      // Admin app: important notice (no names or amounts on the lock screen).
      if (event.livemode) await pushAdmins('payment', 'Payment failed', 'A payment was declined. Details in the app under Payments.', 'payment_failed');
      break;
    case 'customer.subscription.deleted':
    case 'customer.subscription.updated':
      console.info('billing_subscription', { event: event.id, type: event.type });
      break;
    default:
      break;
  }
  return NextResponse.json({ received: true });
}

async function handleB2B(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.metadata?.b2b_account_id && s.subscription) {
        const sub = await stripe().subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id);
        await syncSubscription(sub);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    case 'invoice.paid':
      await archiveStripeInvoice(event.data.object as Stripe.Invoice);
      break;
    default:
      break;
  }
}
