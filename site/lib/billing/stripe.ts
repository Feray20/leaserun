import Stripe from 'stripe';

// Central Stripe logic. Stripe is the single source of truth for purchases:
// there is no separate payment database; entitlements are read from Stripe.

import PRICES from '@/public/data/preise.json';

// Offers come from public/data/preise.json (one source for website and billing). All prices in USD.
// Purchasable: Lender Package (one-time), Buyer Pass (90 days, incl. 1 Lender Package), Investor Pro (monthly).
export type Plan = 'credit-map' | 'buyer-pass' | 'pro-monthly';

type PlanDef = {
  lookupKey: string;
  name: string;
  description: string;
  amount: number; // price in US cents (sales tax, if any, is added on top by Stripe Tax)
  mode: 'payment' | 'subscription';
};

type JsonPlan = { id: string; name: string; cents: number; intervall: string; mode: string; features: string[] };
const ALL: JsonPlan[] = PRICES.privat.plans;
const KEYS: Record<Plan, string> = { 'credit-map': 'leaserun_credit_map', 'buyer-pass': 'leaserun_buyer_pass_90d', 'pro-monthly': 'leaserun_pro_monthly' };
// Legacy plans (only used to recognize existing purchases; no longer for sale).
const LEGACY_STARTER_SUB = 'leaserun_starter_monthly';
const PASS_MS = 90 * 24 * 60 * 60 * 1000;
export const CURRENCY = 'usd';

export const PLANS = Object.fromEntries(
  (Object.keys(KEYS) as Plan[]).map((id) => {
    const p = ALL.find((x) => x.id === id);
    if (!p) throw new Error(`Price missing in preise.json: ${id}`);
    // Currency and amount are part of the lookup key: a price change automatically creates a new Stripe price.
    return [id, { lookupKey: `${KEYS[id]}_${CURRENCY}_${p.cents}`, name: `LeaseRun ${p.name}`, description: `${p.name} – ${p.intervall}.`, amount: p.cents, mode: p.mode === 'subscription' ? 'subscription' : 'payment' }];
  }),
) as Record<Plan, PlanDef>;

export const isPlan = (v: unknown): v is Plan => typeof v === 'string' && v in PLANS;

export function billingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY) && process.env.BILLING_ENABLED === 'true';
}

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is missing');
  if (!client) client = new Stripe(key, { timeout: 20000, maxNetworkRetries: 1 });
  return client;
}

// Test purchase in the Web-Admin: dedicated test key (STRIPE_TEST_SECRET_KEY) – or the main key if it is a test key.
// Test purchases run through a separate Stripe test account and never unlock real access.
let testClient: Stripe | null = null;
export function testKeyMode(): 'test-key' | 'main-is-test' | null {
  if ((process.env.STRIPE_TEST_SECRET_KEY || '').startsWith('sk_test_')) return 'test-key';
  if ((process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')) return 'main-is-test';
  return null;
}
export function testStripe(): Stripe {
  const mode = testKeyMode();
  if (!mode) throw new Error('No Stripe test key');
  if (!testClient) testClient = new Stripe(mode === 'test-key' ? String(process.env.STRIPE_TEST_SECRET_KEY) : String(process.env.STRIPE_SECRET_KEY));
  return testClient;
}

// Fetch the price by lookup_key or create it once.
export async function ensurePrice(plan: Plan, s: Stripe = stripe()): Promise<string> {
  const def = PLANS[plan];
  const found = await s.prices.list({ lookup_keys: [def.lookupKey], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await s.prices.create({
    currency: CURRENCY,
    unit_amount: def.amount,
    // US style: list prices exclude sales tax; Stripe Tax adds it at checkout only where it applies.
    tax_behavior: 'exclusive',
    lookup_key: def.lookupKey,
    product_data: { name: def.name, metadata: { leaserun_plan: plan } },
    ...(def.mode === 'subscription' ? { recurring: { interval: 'month' as const } } : {}),
    metadata: { leaserun_plan: plan },
  });
  return price.id;
}

// Add-on (order bump) for the Lender Package or Buyer Pass: Closing Checklist & Lender Negotiation Guide.
type JsonAddon = { id: string; name: string; cents: number };
const ADDONS: JsonAddon[] = ((PRICES.privat as unknown as { addons?: JsonAddon[] }).addons) || [];
export const ADDON_LEITFADEN = ADDONS.find((a) => a.id === 'leitfaden') || null;
export async function ensureAddonPrice(s: Stripe = stripe()): Promise<string | null> {
  const a = ADDON_LEITFADEN;
  if (!a) return null;
  const key = `leaserun_addon_leitfaden_${CURRENCY}_${a.cents}`;
  const found = await s.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await s.prices.create({ currency: CURRENCY, unit_amount: a.cents, tax_behavior: 'exclusive', lookup_key: key, product_data: { name: `LeaseRun ${a.name}`, metadata: { leaserun_addon: 'leitfaden' } }, metadata: { leaserun_addon: 'leitfaden' } });
  return price.id;
}

// Sales tax: no fixed tax rate (no VAT in the US). If Stripe Tax is enabled (STRIPE_TAX_ENABLED=true and set up in the
// Stripe dashboard with the states where LeaseRun is registered), checkout calculates sales tax automatically and
// receipts show a tax line only when tax was actually charged. Returns null = no manual tax rate on line items.
export function stripeTaxEnabled(): boolean {
  return process.env.STRIPE_TAX_ENABLED === 'true';
}
export async function ensureTaxRate(_s: Stripe = stripe()): Promise<string | null> {
  void _s;
  return null;
}

// Use exactly one Stripe customer per Supabase user.
// Cache the customer per user for 10 minutes: plan, invoices and payment methods often ask at the same time.
const CUST_CACHE = new Map<string, { at: number; c: Stripe.Customer }>();
export async function findCustomer(userId: string, email: string): Promise<Stripe.Customer | null> {
  const hit = CUST_CACHE.get(userId);
  if (hit && Date.now() - hit.at < 600_000) return hit.c;
  const list = await stripe().customers.list({ email, limit: 20 });
  const c = list.data.find((x) => x.metadata?.supabase_user_id === userId) ?? null;
  if (c) { CUST_CACHE.set(userId, { at: Date.now(), c }); if (CUST_CACHE.size > 2000) CUST_CACHE.delete(CUST_CACHE.keys().next().value as string); }
  return c;
}

export async function ensureCustomer(userId: string, email: string): Promise<Stripe.Customer> {
  const existing = await findCustomer(userId, email);
  if (existing) return existing;
  return stripe().customers.create({
    email,
    preferred_locales: ['en-US'],
    metadata: { supabase_user_id: userId },
  });
}

export type Entitlements = {
  pro: boolean;
  proSource: 'subscription' | 'pass' | null;
  proUntil: string | null;
  starter: boolean;
  starterUntil: string | null;
  tier: 'free' | 'starter' | 'pro';
  creditMaps: number;
  hasCustomer: boolean;
  leitfaden?: boolean;
};

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Entitlements = Stripe purchases + manual grants from the Web-Admin (lr_access_grants).
// The higher tier wins; Lender Package credits are added up. Without Stripe only the manual grant counts.
const TIER_RANK = { free: 0, starter: 1, pro: 2 } as const;
const FREE: Entitlements = { pro: false, proSource: null, proUntil: null, starter: false, starterUntil: null, tier: 'free', creditMaps: 0, hasCustomer: false };
export type AccessGrant = { tier: 'free' | 'starter' | 'pro'; credit_maps: number; leitfaden: boolean; valid_until: string | null; note: string | null; granted_by: string; updated_at: string; features?: Record<string, 'on' | 'off'> };
export async function accessGrant(userId: string): Promise<AccessGrant | null> {
  try {
    const { adminConfigured, supabaseAdmin } = await import('@/lib/supabase/admin');
    if (!adminConfigured()) return null;
    const { data } = await supabaseAdmin().from('lr_access_grants').select('tier, credit_maps, leitfaden, valid_until, note, granted_by, updated_at, features').eq('user_id', userId).maybeSingle();
    if (!data) return null;
    if (data.valid_until && Date.parse(data.valid_until) < Date.now()) return null;
    return data as AccessGrant;
  } catch { return null; }
}
export async function entitlementsFor(userId: string, email: string, fresh = false): Promise<Entitlements & { grant?: AccessGrant | null }> {
  if (fresh) forgetEntitlements(userId);
  const [base, grant] = await Promise.all([
    // Stripe errors (timeout, rate limit) must never cancel a manual grant.
    process.env.STRIPE_SECRET_KEY ? cachedStripeEntitlements(userId, email).catch((e) => { console.error('stripe_entitlements_error', e instanceof Error ? e.message : e); return FREE; }) : Promise.resolve(FREE),
    accessGrant(userId),
  ]);
  if (!grant) return base;
  const tier = TIER_RANK[grant.tier] > TIER_RANK[base.tier] ? grant.tier : base.tier;
  return {
    ...base, tier, grant,
    pro: base.pro || grant.tier === 'pro',
    proSource: base.pro ? base.proSource : grant.tier === 'pro' ? 'pass' : null,
    proUntil: base.pro ? base.proUntil : grant.tier === 'pro' ? grant.valid_until : null,
    starter: base.starter || grant.tier === 'starter',
    starterUntil: base.starter ? base.starterUntil : grant.tier === 'starter' ? grant.valid_until : null,
    creditMaps: base.creditMaps + (grant.credit_maps || 0),
    leitfaden: Boolean(base.leitfaden || grant.leitfaden),
  };
}

// Short per-user cache (30 s, in-process only): account, offers and navigation often ask for the plan at the
// same time – so the page does not wait on Stripe several times. Wait at most 8 s for Stripe.
const ENT_CACHE = new Map<string, { at: number; p: Promise<Entitlements> }>();
export function forgetEntitlements(userId: string) { ENT_CACHE.delete(userId); }
function cachedStripeEntitlements(userId: string, email: string): Promise<Entitlements> {
  const hit = ENT_CACHE.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.p;
  const p = Promise.race([
    stripeEntitlements(userId, email),
    new Promise<Entitlements>((_, rej) => setTimeout(() => rej(new Error('stripe_timeout')), 8000)),
  ]);
  ENT_CACHE.set(userId, { at: Date.now(), p });
  p.catch(() => ENT_CACHE.delete(userId));
  if (ENT_CACHE.size > 2000) ENT_CACHE.delete(ENT_CACHE.keys().next().value as string);
  return p;
}

// Derive entitlements from Stripe (paid checkout sessions and active subscriptions).
async function stripeEntitlements(userId: string, email: string): Promise<Entitlements> {
  const customer = await findCustomer(userId, email);
  if (!customer) return { pro: false, proSource: null, proUntil: null, starter: false, starterUntil: null, tier: 'free', creditMaps: 0, hasCustomer: false };
  const s = stripe();

  const [subs, sessions] = await Promise.all([
    s.subscriptions.list({ customer: customer.id, status: 'all', limit: 20 }),
    s.checkout.sessions.list({ customer: customer.id, limit: 100 }),
  ]);
  const live = subs.data.filter((x) => ['active', 'trialing', 'past_due'].includes(x.status));
  const subKey = (x: Stripe.Subscription) => x.items.data[0]?.price?.lookup_key || '';
  const activeSub = live.find((x) => !subKey(x).startsWith(LEGACY_STARTER_SUB));
  const starterSub = live.find((x) => subKey(x).startsWith(LEGACY_STARTER_SUB));

  const paid = sessions.data.filter((x) => x.payment_status === 'paid' && x.metadata?.supabase_user_id === userId);
  // Every Lender Package and every Buyer Pass (includes 1 package) gives one Lender Package credit.
  const creditMaps = paid.filter((x) => ['credit-map', 'credit-map-starter', 'buyer-pass'].includes(String(x.metadata?.plan))).length;
  const starterPass = paid
    .filter((x) => x.metadata?.plan === 'starter-yearly' || x.metadata?.plan === 'buyer-pass')
    .map((x) => x.created * 1000 + (x.metadata?.plan === 'buyer-pass' ? PASS_MS : YEAR_MS))
    .filter((until) => until > Date.now())
    .sort((a, b) => b - a)[0];
  const starter = Boolean(starterSub || starterPass);
  const starterUntil = starterSub ? null : starterPass ? new Date(starterPass).toISOString() : null;
  const passes = paid
    .filter((x) => x.metadata?.plan === 'pro-yearly')
    .map((x) => x.created * 1000 + YEAR_MS)
    .filter((until) => until > Date.now())
    .sort((a, b) => b - a);

  const leitfaden = paid.some((x) => x.metadata?.addon === 'leitfaden');
  if (activeSub) return { pro: true, proSource: 'subscription', proUntil: null, starter, starterUntil, tier: 'pro', creditMaps, hasCustomer: true, leitfaden };
  if (passes[0]) return { pro: true, proSource: 'pass', proUntil: new Date(passes[0]).toISOString(), starter, starterUntil, tier: 'pro', creditMaps, hasCustomer: true, leitfaden };
  return { pro: false, proSource: null, proUntil: null, starter, starterUntil, tier: starter ? 'starter' : 'free', creditMaps, hasCustomer: true, leitfaden };
}
