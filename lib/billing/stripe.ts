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
const KEYS: Record<Plan, string> = { 'credit-map': 'immoadv_credit_map', 'buyer-pass': 'immoadv_buyer_pass_90d', 'pro-monthly': 'immoadv_pro_monthly' };
// Frühere Tarife (nur noch zum Erkennen bestehender Käufe, nicht mehr buchbar).
const LEGACY_STARTER_SUB = 'immoadv_starter_monthly';
const PASS_MS = 90 * 24 * 60 * 60 * 1000;

export const PLANS = Object.fromEntries(
  (Object.keys(KEYS) as Plan[]).map((id) => {
    const p = ALL.find((x) => x.id === id);
    if (!p) throw new Error(`Preis fehlt in preise.json: ${id}`);
    // Der Betrag steckt im Lookup-Key: Eine Preisänderung legt bei Stripe automatisch einen neuen Preis an.
    return [id, { lookupKey: `${KEYS[id]}_${p.cents}`, name: `ImmoAdv ${p.name}`, description: `${p.name} – ${p.intervall}.`, amount: p.cents, mode: p.mode === 'subscription' ? 'subscription' : 'payment' }];
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
  if (!client) client = new Stripe(key);
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
    product_data: { name: def.name, metadata: { immoadv_plan: plan } },
    ...(def.mode === 'subscription' ? { recurring: { interval: 'month' as const } } : {}),
    metadata: { immoadv_plan: plan },
  });
  return price.id;
}

// Steuersatz 19 % USt (inklusive) holen oder anlegen, damit Rechnungen die Umsatzsteuer ausweisen.
export async function ensureTaxRate(s: Stripe = stripe()): Promise<string> {
  const list = await s.taxRates.list({ active: true, inclusive: true, limit: 100 });
  const hit = list.data.find((t) => t.metadata?.immoadv === 'ust19');
  if (hit) return hit.id;
  const t = await s.taxRates.create({
    display_name: 'USt',
    description: 'Umsatzsteuer 19 %',
    percentage: 19,
    inclusive: true,
    country: 'DE',
    jurisdiction: 'DE',
    metadata: { immoadv: 'ust19' },
  });
  return t.id;
}

// Genau einen Stripe-Kunden je Supabase-Nutzer verwenden.
export async function findCustomer(userId: string, email: string): Promise<Stripe.Customer | null> {
  const list = await stripe().customers.list({ email, limit: 20 });
  return list.data.find((c) => c.metadata?.supabase_user_id === userId) ?? null;
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
};

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Freischaltungen aus Stripe ableiten (bezahlte Checkout-Sessions und aktive Abos).
export async function entitlementsFor(userId: string, email: string): Promise<Entitlements> {
  const customer = await findCustomer(userId, email);
  if (!customer) return { pro: false, proSource: null, proUntil: null, starter: false, starterUntil: null, tier: 'free', creditMaps: 0, hasCustomer: false };
  const s = stripe();

  const subs = await s.subscriptions.list({ customer: customer.id, status: 'all', limit: 20 });
  const live = subs.data.filter((x) => ['active', 'trialing', 'past_due'].includes(x.status));
  const subKey = (x: Stripe.Subscription) => x.items.data[0]?.price?.lookup_key || '';
  const activeSub = live.find((x) => !subKey(x).startsWith(LEGACY_STARTER_SUB));
  const starterSub = live.find((x) => subKey(x).startsWith(LEGACY_STARTER_SUB));

  const sessions = await s.checkout.sessions.list({ customer: customer.id, limit: 100 });
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

  if (activeSub) return { pro: true, proSource: 'subscription', proUntil: null, starter, starterUntil, tier: 'pro', creditMaps, hasCustomer: true };
  if (passes[0]) return { pro: true, proSource: 'pass', proUntil: new Date(passes[0]).toISOString(), starter, starterUntil, tier: 'pro', creditMaps, hasCustomer: true };
  return { pro: false, proSource: null, proUntil: null, starter, starterUntil, tier: starter ? 'starter' : 'free', creditMaps, hasCustomer: true };
}
