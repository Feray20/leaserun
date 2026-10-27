import type Stripe from 'stripe';
import { stripe } from '@/lib/billing/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { type B2BAccount, type Tier } from '@/lib/b2b/core';
import { BRANCHEN, findPlan, getCatalog } from '@/lib/b2b/catalog';
import { buyerFromAccount } from '@/lib/b2b/invoice';

// Stripe for business accounts: prices in USD, subscription billed monthly or yearly. No VAT. Sales tax is only
// collected when Stripe Tax is enabled for the account (env STRIPE_TAX_ENABLED=true → automatic_tax).

// Price per plan from the business catalog (Web-Admin). Price change → new Stripe price (lookup key contains the amount);
// existing subscriptions keep their previous price.
export async function ensureB2BPrice(planId: string): Promise<{ price: string; name: string; tier: Tier; interval: 'month' | 'year' }> {
  const f = findPlan(await getCatalog(true), planId);
  if (!f) throw new Error('unknown_plan');
  const lookup = `leaserun_b2b_usd_${planId.replace(/-/g, '_')}_${f.cents}`;
  const name = `${f.plan.name}${f.interval === 'year' ? ' (annual)' : ''}`;
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (found.data[0]) return { price: found.data[0].id, name, tier: f.plan.tier, interval: f.interval };
  const price = await s.prices.create({
    currency: 'usd', unit_amount: f.cents, tax_behavior: 'exclusive', lookup_key: lookup,
    recurring: { interval: f.interval },
    product_data: { name: `LeaseRun ${name}`, metadata: { leaserun_b2b_plan: planId, tier: f.plan.tier, branche: f.branche } },
    metadata: { leaserun_b2b_plan: planId, tier: f.plan.tier, branche: f.branche },
  });
  return { price: price.id, name, tier: f.plan.tier, interval: f.interval };
}

// Add-on industry (quantity = number of added industries), same interval as the subscription.
export async function ensureAddonPrice(interval: 'month' | 'year'): Promise<string> {
  const cat = await getCatalog(true);
  const cents = interval === 'year' ? cat.addon.yearCents : cat.addon.monthCents;
  const lookup = `leaserun_b2b_usd_addon_branche_${interval}_${cents}`;
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await s.prices.create({
    currency: 'usd', unit_amount: cents, tax_behavior: 'exclusive', lookup_key: lookup, recurring: { interval },
    product_data: { name: 'LeaseRun add-on industry', metadata: { leaserun_b2b_addon: 'branche' } }, metadata: { leaserun_b2b_addon: 'branche' },
  });
  return price.id;
}
export const parseExtras = (v: unknown): string[] => String(v || '').split(',').map((x) => x.trim()).filter((x) => (BRANCHEN as string[]).includes(x) && x !== 'bank').slice(0, 4);

// US: no VAT and no fixed tax rate. Sales tax (where software is taxable) is calculated by Stripe Tax only when
// STRIPE_TAX_ENABLED=true. Kept for compatibility: always returns null (no manual tax rate is attached).
export const stripeTaxEnabled = () => process.env.STRIPE_TAX_ENABLED === 'true';
export async function ensureTaxRateExclusive(): Promise<string | null> {
  return null;
}
// Line-item tax rates (none in the US setup) and the automatic_tax switch for Checkout.
export const taxRatesFor = (tax: string | null) => (tax ? { tax_rates: [tax] } : {});
export const automaticTax = () => (stripeTaxEnabled() ? { automatic_tax: { enabled: true } } : {});

// Payment methods for businesses – deliberately different from consumers: business card and ACH bank debit
// (US bank account), no consumer methods (Klarna, PayPal, Apple/Google Pay, Link). Own Stripe payment method
// configuration, created once and reused. Anything not enabled in the Stripe account is simply hidden by Stripe.
// If creating it fails, the default configuration applies (payment stays possible).
const B2B_PMC_NAME = 'LeaseRun Business US';
let b2bPmc: string | null = null;
export async function ensureB2BPaymentConfig(): Promise<string | undefined> {
  if (b2bPmc) return b2bPmc;
  try {
    const s = stripe();
    const list = await s.paymentMethodConfigurations.list({ limit: 100 });
    const hit = list.data.find((c) => c.name === B2B_PMC_NAME && c.active);
    if (hit) return (b2bPmc = hit.id);
    const on = { display_preference: { preference: 'on' as const } };
    const off = { display_preference: { preference: 'off' as const } };
    const c = await s.paymentMethodConfigurations.create({
      name: B2B_PMC_NAME,
      card: on, us_bank_account: on, sepa_debit: off,
      apple_pay: off, google_pay: off, link: off, klarna: off, paypal: off, amazon_pay: off,
      bancontact: off, eps: off, pix: off, kakao_pay: off, naver_pay: off, payco: off, samsung_pay: off, satispay: off, mb_way: off,
    } as Stripe.PaymentMethodConfigurationCreateParams);
    return (b2bPmc = c.id);
  } catch (e) {
    console.error('b2b_pmc_error', e instanceof Error ? e.message : e);
    return undefined;
  }
}

export async function ensureB2BCustomer(a: B2BAccount): Promise<string> {
  const s = stripe();
  if (a.stripe_customer_id) return a.stripe_customer_id;
  const c = await s.customers.create({
    email: a.email,
    name: `${a.company_name}`,
    preferred_locales: ['en-US'],
    address: { line1: a.street || undefined, postal_code: a.postal_code, city: a.city, country: 'US' },
    metadata: { b2b_account_id: a.id, customer_number: a.customer_number, ...(a.tax_id ? { ein: a.tax_id } : {}) },
  });
  await supabaseAdmin().from('lr_b2b_accounts').update({ stripe_customer_id: c.id }).eq('id', a.id);
  return c.id;
}

const TIERS: Tier[] = ['BASIC', 'PRO', 'ENTERPRISE'];

// Sync subscription state to the business account (idempotent).
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const accountId = sub.metadata?.b2b_account_id;
  if (!accountId) return;
  const tier = TIERS.find((t) => t === sub.metadata?.tier) ?? null;
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  const item = (sub.items.data.find((i) => !i.price?.metadata?.leaserun_b2b_addon) ?? sub.items.data[0]) as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const extras = parseExtras(sub.metadata?.extras);
  const interval = item?.price?.recurring?.interval === 'year' ? 'year' : 'month';
  const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null;
  const db = supabaseAdmin();
  const { data: a } = await db.from('lr_b2b_accounts').select('plan_source, stripe_subscription_id').eq('id', accountId).maybeSingle();
  if (!a) return;
  // Do not overwrite manual activations by the operator unless it is the same subscription.
  if (a.plan_source === 'manual' && a.stripe_subscription_id !== sub.id) return;
  await db.from('lr_b2b_accounts').update(
    live && tier
      ? { plan_tier: tier, plan_source: 'stripe', plan_until: cancelAt, billing_interval: interval, stripe_subscription_id: sub.id, extra_branches: extras, stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id, updated_at: new Date().toISOString() }
      : { plan_tier: null, plan_source: null, plan_until: null, stripe_subscription_id: sub.id, updated_at: new Date().toISOString() },
  ).eq('id', accountId);
}

// Copy a paid Stripe invoice of a business account into the invoice archive (number and PDF stay with Stripe).
export async function archiveStripeInvoice(inv: Stripe.Invoice): Promise<void> {
  const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
  if (!customerId || !inv.number) return;
  const db = supabaseAdmin();
  const { data: a } = await db.from('lr_b2b_accounts').select('*').eq('stripe_customer_id', customerId).maybeSingle();
  if (!a) return;
  const gross = inv.total ?? 0;
  const net = (inv as Stripe.Invoice & { total_excluding_tax?: number | null }).total_excluding_tax ?? gross;
  const items = inv.lines.data.map((l) => ({ description: l.description || 'LeaseRun', quantity: l.quantity ?? 1, unitNetCents: Math.round((l.amount ?? 0) / Math.max(1, l.quantity ?? 1)) }));
  const period = inv.lines.data[0]?.period;
  const fmt = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const { error } = await db.rpc('lr_create_invoice', {
    p: {
      invoice_number: inv.number, kind: gross < 0 ? 'credit' : 'invoice', source: 'stripe', account_id: a.id, buyer: buyerFromAccount(a as B2BAccount), items,
      net_cents: net, vat_rate: net > 0 ? Math.round(((gross - net) / net) * 10000) / 100 : 0, vat_cents: gross - net, gross_cents: gross, payment_method: 'STRIPE_CARD', payment_status: 'PAID',
      service_period: period ? `${fmt(period.start)} to ${fmt(period.end)}` : '', paid_at: new Date().toISOString(),
      stripe_invoice_id: inv.id, stripe_pdf_url: inv.invoice_pdf || inv.hosted_invoice_url || '', created_by: 'stripe-webhook',
    },
  });
  // Duplicate delivery: the unique Stripe id / number prevents double booking.
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
}
