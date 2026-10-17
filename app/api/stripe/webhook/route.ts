import '@/lib/env-alias';
import { track } from '@/lib/analytics/track';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/billing/stripe';
import { archiveStripeInvoice, syncSubscription } from '@/lib/b2b/stripe-b2b';
import { adminConfigured } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Stripe-Webhook. Signatur wird mit dem Endpunkt-Secret (STRIPE_WEBHOOK_SECRET) geprüft.
// Freischaltungen werden live aus Stripe gelesen; der Webhook bestätigt Ereignisse und protokolliert sie.
// Für Unternehmenskonten (metadata.b2b_account_id) wird der Tarif übertragen und jede bezahlte
// Rechnung ins Rechnungsarchiv übernommen; doppelte Zustellungen sind unschädlich (idempotent).
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
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
      console.info('billing_paid', { session: s.id, plan: s.metadata?.plan, status: s.payment_status });
      if (s.payment_status === 'paid' && s.metadata?.immoadv_test !== '1') await track({ seg: s.metadata?.b2b_account_id ? 'b2b' : 'b2c', ev: 'purchase', plan: s.metadata?.plan || (s.metadata?.b2b_account_id ? 'b2b' : null) });
      break;
    }
    case 'checkout.session.async_payment_failed':
    case 'invoice.payment_failed':
      console.warn('billing_payment_failed', { event: event.id, type: event.type });
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
