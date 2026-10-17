import type Stripe from 'stripe';
import { stripe } from '@/lib/billing/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { B2B_PLANS, type B2BAccount, type Tier } from '@/lib/b2b/core';
import { buyerFromAccount } from '@/lib/b2b/invoice';

// Stripe für Unternehmenskonten: Nettopreise zzgl. 19 % USt (exklusiv), Abo monatlich oder jährlich.

export async function ensureB2BPrice(planId: string): Promise<string> {
  const p = B2B_PLANS.find((x) => x.id === planId);
  if (!p) throw new Error('unknown_plan');
  const lookup = `immoadv_b2b_${planId.replace(/-/g, '_')}_${p.netto_cents}`;
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await s.prices.create({
    currency: 'eur', unit_amount: p.netto_cents, tax_behavior: 'exclusive', lookup_key: lookup,
    recurring: { interval: p.interval },
    product_data: { name: `ImmoAdv ${p.name}`, metadata: { immoadv_b2b_plan: planId, tier: p.tier } },
    metadata: { immoadv_b2b_plan: planId, tier: p.tier },
  });
  return price.id;
}

export async function ensureTaxRateExclusive(): Promise<string> {
  const s = stripe();
  const list = await s.taxRates.list({ active: true, inclusive: false, limit: 100 });
  const hit = list.data.find((t) => t.metadata?.immoadv === 'ust19_excl');
  if (hit) return hit.id;
  const t = await s.taxRates.create({ display_name: 'USt', description: 'Umsatzsteuer 19 %', percentage: 19, inclusive: false, country: 'DE', jurisdiction: 'DE', metadata: { immoadv: 'ust19_excl' } });
  return t.id;
}

export async function ensureB2BCustomer(a: B2BAccount): Promise<string> {
  const s = stripe();
  if (a.stripe_customer_id) return a.stripe_customer_id;
  const c = await s.customers.create({
    email: a.email,
    name: `${a.company_name}`,
    preferred_locales: ['de'],
    address: { line1: a.street || undefined, postal_code: a.postal_code, city: a.city, country: 'DE' },
    metadata: { b2b_account_id: a.id, customer_number: a.customer_number },
    ...(a.tax_id && /^DE[0-9]{9}$/.test(a.tax_id) ? { tax_id_data: [{ type: 'eu_vat' as const, value: a.tax_id }] } : {}),
  });
  await supabaseAdmin().from('immo_b2b_accounts').update({ stripe_customer_id: c.id }).eq('id', a.id);
  return c.id;
}

const TIERS: Tier[] = ['BASIC', 'PRO', 'ENTERPRISE'];

// Abo-Zustand auf das Unternehmenskonto übertragen (idempotent).
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const accountId = sub.metadata?.b2b_account_id;
  if (!accountId) return;
  const tier = TIERS.find((t) => t === sub.metadata?.tier) ?? null;
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  const item = sub.items.data[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const interval = item?.price?.recurring?.interval === 'year' ? 'year' : 'month';
  const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null;
  const db = supabaseAdmin();
  const { data: a } = await db.from('immo_b2b_accounts').select('plan_source, stripe_subscription_id').eq('id', accountId).maybeSingle();
  if (!a) return;
  // Manuelle Freischaltungen durch den Betreiber nicht überschreiben, außer es ist dasselbe Abo.
  if (a.plan_source === 'manual' && a.stripe_subscription_id !== sub.id) return;
  await db.from('immo_b2b_accounts').update(
    live && tier
      ? { plan_tier: tier, plan_source: 'stripe', plan_until: cancelAt, billing_interval: interval, stripe_subscription_id: sub.id, stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id, updated_at: new Date().toISOString() }
      : { plan_tier: null, plan_source: null, plan_until: null, stripe_subscription_id: sub.id, updated_at: new Date().toISOString() },
  ).eq('id', accountId);
}

// Bezahlte Stripe-Rechnung eines Unternehmenskontos ins Rechnungsarchiv übernehmen (Nummer und PDF bleiben bei Stripe).
export async function archiveStripeInvoice(inv: Stripe.Invoice): Promise<void> {
  const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
  if (!customerId || !inv.number) return;
  const db = supabaseAdmin();
  const { data: a } = await db.from('immo_b2b_accounts').select('*').eq('stripe_customer_id', customerId).maybeSingle();
  if (!a) return;
  const gross = inv.total ?? 0;
  const net = (inv as Stripe.Invoice & { total_excluding_tax?: number | null }).total_excluding_tax ?? gross;
  const items = inv.lines.data.map((l) => ({ description: l.description || 'ImmoAdv', quantity: l.quantity ?? 1, unitNetCents: Math.round((l.amount ?? 0) / Math.max(1, l.quantity ?? 1)) }));
  const period = inv.lines.data[0]?.period;
  const fmt = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const { error } = await db.rpc('immo_create_invoice', {
    p: {
      invoice_number: inv.number, kind: gross < 0 ? 'credit' : 'invoice', source: 'stripe', account_id: a.id, buyer: buyerFromAccount(a as B2BAccount), items,
      net_cents: net, vat_rate: 19, vat_cents: gross - net, gross_cents: gross, payment_method: 'STRIPE_CARD', payment_status: 'PAID',
      service_period: period ? `${fmt(period.start)} bis ${fmt(period.end)}` : '', paid_at: new Date().toISOString(),
      stripe_invoice_id: inv.id, stripe_pdf_url: inv.invoice_pdf || inv.hosted_invoice_url || '', created_by: 'stripe-webhook',
    },
  });
  // Doppelte Zustellung: eindeutige Stripe-ID bzw. Nummer verhindert Doppelbuchung.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
}
