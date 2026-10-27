import Stripe from 'stripe';

// Zentrale Stripe-Logik. Stripe ist die einzige Quelle der Wahrheit für Käufe:
// Es gibt keine eigene Zahlungsdatenbank, Freischaltungen werden aus Stripe gelesen.

import PRICES from '@/public/data/preise.json';

// Angebote kommen aus public/data/preise.json (eine Quelle für Website und Abrechnung).
// Buchbar: Kreditmappe (Einzelkauf), Käufer-Pass (90 Tage, inkl. 1 Kreditmappe), Investor Pro (monatlich).
export type Plan = 'credit-map' | 'buyer-pass' | 'pro-monthly';

type PlanDef = {
  lookupKey: string;
  name: string;
  description: string;
  amount: number; // Bruttobetrag in Cent inkl. 19 % USt
  mode: 'payment' | 'subscription';
};

type JsonPlan = { id: string; name: string; cents: number; intervall: string; mode: string; features: string[] };
const ALL: JsonPlan[] = PRICES.privat.plans;
const KEYS: Record<Plan, string> = { 'credit-map': 'leaserun_credit_map', 'buyer-pass': 'leaserun_buyer_pass_90d', 'pro-monthly': 'leaserun_pro_monthly' };
// Frühere Tarife (nur noch zum Erkennen bestehender Käufe, nicht mehr buchbar).
const LEGACY_STARTER_SUB = 'leaserun_starter_monthly';
const PASS_MS = 90 * 24 * 60 * 60 * 1000;

export const PLANS = Object.fromEntries(
  (Object.keys(KEYS) as Plan[]).map((id) => {
    const p = ALL.find((x) => x.id === id);
    if (!p) throw new Error(`Preis fehlt in preise.json: ${id}`);
    // Der Betrag steckt im Lookup-Key: Eine Preisänderung legt bei Stripe automatisch einen neuen Preis an.
    return [id, { lookupKey: `${KEYS[id]}_${p.cents}`, name: `LeaseRun ${p.name}`, description: `${p.name} – ${p.intervall}.`, amount: p.cents, mode: p.mode === 'subscription' ? 'subscription' : 'payment' }];
  }),
) as Record<Plan, PlanDef>;

export const isPlan = (v: unknown): v is Plan => typeof v === 'string' && v in PLANS;

export function billingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY) && process.env.BILLING_ENABLED === 'true';
}

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY fehlt');
  if (!client) client = new Stripe(key, { timeout: 20000, maxNetworkRetries: 1 });
  return client;
}

// Testkauf im Web-Admin: eigener Testschlüssel (STRIPE_TEST_SECRET_KEY) – oder der Hauptschlüssel, falls er ein Testschlüssel ist.
// Testkäufe laufen über ein getrenntes Stripe-Testkonto und schalten nie echte Leistungen frei.
let testClient: Stripe | null = null;
export function testKeyMode(): 'test-key' | 'main-is-test' | null {
  if ((process.env.STRIPE_TEST_SECRET_KEY || '').startsWith('sk_test_')) return 'test-key';
  if ((process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')) return 'main-is-test';
  return null;
}
export function testStripe(): Stripe {
  const mode = testKeyMode();
  if (!mode) throw new Error('Kein Stripe-Testschlüssel');
  if (!testClient) testClient = new Stripe(mode === 'test-key' ? String(process.env.STRIPE_TEST_SECRET_KEY) : String(process.env.STRIPE_SECRET_KEY));
  return testClient;
}

// Preis per lookup_key holen oder einmalig anlegen.
export async function ensurePrice(plan: Plan, s: Stripe = stripe()): Promise<string> {
  const def = PLANS[plan];
  const found = await s.prices.list({ lookup_keys: [def.lookupKey], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await s.prices.create({
    currency: 'eur',
    unit_amount: def.amount,
    tax_behavior: 'inclusive',
    lookup_key: def.lookupKey,
    product_data: { name: def.name, metadata: { leaserun_plan: plan } },
    ...(def.mode === 'subscription' ? { recurring: { interval: 'month' as const } } : {}),
    metadata: { leaserun_plan: plan },
  });
  return price.id;
}

// Zusatzprodukt (Order-Bump) zu Kreditmappe oder Käufer-Pass: Notar-Checkliste & Banken-Verhandlungsleitfaden.
type JsonAddon = { id: string; name: string; cents: number };
const ADDONS: JsonAddon[] = ((PRICES.privat as unknown as { addons?: JsonAddon[] }).addons) || [];
export const ADDON_LEITFADEN = ADDONS.find((a) => a.id === 'leitfaden') || null;
export async function ensureAddonPrice(s: Stripe = stripe()): Promise<string | null> {
  const a = ADDON_LEITFADEN;
  if (!a) return null;
  const key = `leaserun_addon_leitfaden_${a.cents}`;
  const found = await s.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await s.prices.create({ currency: 'eur', unit_amount: a.cents, tax_behavior: 'inclusive', lookup_key: key, product_data: { name: `LeaseRun ${a.name}`, metadata: { leaserun_addon: 'leitfaden' } }, metadata: { leaserun_addon: 'leitfaden' } });
  return price.id;
}

// Steuersatz 19 % USt (inklusive) holen oder anlegen, damit Rechnungen die Umsatzsteuer ausweisen.
export async function ensureTaxRate(s: Stripe = stripe()): Promise<string> {
  const list = await s.taxRates.list({ active: true, inclusive: true, limit: 100 });
  const hit = list.data.find((t) => t.metadata?.leaserun === 'ust19');
  if (hit) return hit.id;
  const t = await s.taxRates.create({
    display_name: 'USt',
    description: 'Umsatzsteuer 19 %',
    percentage: 19,
    inclusive: true,
    country: 'DE',
    jurisdiction: 'DE',
    metadata: { leaserun: 'ust19' },
  });
  return t.id;
}

// Genau einen Stripe-Kunden je Supabase-Nutzer verwenden.
// Kunde je Nutzer 10 Minuten merken: Tarif, Rechnungen und Zahlungsmittel fragen ihn oft gleichzeitig ab.
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
    preferred_locales: ['de'],
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

// Freischaltungen = Stripe-Käufe + manuelle Freischaltung durch den Web-Admin (lr_access_grants).
// Die höhere Stufe gewinnt; Kreditmappen-Guthaben werden addiert. Ohne Stripe gilt nur die manuelle Freischaltung.
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
    // Stripe-Fehler (Zeitüberschreitung, Limit) dürfen eine manuelle Freischaltung nie aufheben.
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

// Kurzer Zwischenspeicher je Nutzer (30 s, nur im laufenden Server): Konto, Angebote und Navigation fragen den
// Tarif oft gleichzeitig ab – so wartet die Seite nicht mehrfach auf Stripe. Höchstens 8 s auf Stripe warten.
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

// Freischaltungen aus Stripe ableiten (bezahlte Checkout-Sessions und aktive Abos).
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
  // Jede Kreditmappe und jeder Käufer-Pass (enthält 1 Mappe) gibt ein Kreditmappen-Guthaben.
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
