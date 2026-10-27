import type Stripe from 'stripe';
import { CHECKOUT_BRANDING, EMBED_MODE, embedKey, type KasseSummary } from '@/lib/billing/checkout-params';

// Update payment method – directly on leaserun.com/checkout instead of the Stripe customer portal.
// Flow: Stripe Checkout in setup mode (mode: 'setup', embedded) → customer adds a card, Apple Pay, Google Pay, Link or a
// US bank account (ACH, optional) → the new method becomes the default for future invoices and all of the customer's
// active subscriptions. Nothing is charged. Which methods appear is controlled by the payment method configuration below.
export const PM_PURPOSE = 'pm_update';

// Payment methods for personal accounts: common US methods only – card, Apple Pay, Google Pay, Link and, if enabled
// (STRIPE_ACH_ENABLED=true), ACH bank debit. No SEPA, giropay, Sofort, Klarna or other foreign methods.
// Own Stripe configuration, created once and reused; if that fails, the default configuration applies.
const achOn = () => process.env.STRIPE_ACH_ENABLED === 'true';
const B2C_PM_NAME = () => `LeaseRun payment methods (personal, US${achOn() ? ', ACH' : ''})`;
let b2cPmc: string | null = null;
export async function ensureB2CSetupConfig(s: Stripe): Promise<string | undefined> {
  if (b2cPmc) return b2cPmc;
  try {
    const list = await s.paymentMethodConfigurations.list({ limit: 100 });
    const hit = list.data.find((c) => c.name === B2C_PM_NAME() && c.active);
    if (hit) return (b2cPmc = hit.id);
    const on = { display_preference: { preference: 'on' as const } };
    const off = { display_preference: { preference: 'off' as const } };
    const c = await s.paymentMethodConfigurations.create({
      name: B2C_PM_NAME(),
      card: on, apple_pay: on, google_pay: on, link: on, us_bank_account: achOn() ? on : off,
      sepa_debit: off, giropay: off, sofort: off, klarna: off, paypal: off, amazon_pay: off, cashapp: off, affirm: off, afterpay_clearpay: off,
      pix: off, bancontact: off, eps: off, kakao_pay: off, naver_pay: off, payco: off, samsung_pay: off, satispay: off, mb_way: off,
    } as Stripe.PaymentMethodConfigurationCreateParams);
    return (b2cPmc = c.id);
  } catch (e) {
    console.error('b2c_pmc_error', e instanceof Error ? e.message : e);
    return undefined;
  }
}

export async function createPaymentMethodSession(s: Stripe, o: {
  customer: string; returnUrl: string; back: string; area: 'b2c' | 'b2b'; metadata?: Record<string, string>; paymentMethodConfiguration?: string;
}): Promise<{ clientSecret: string; publishableKey: string; summary: KasseSummary } | null> {
  const pk = embedKey();
  if (!pk) return null;
  if (o.area === 'b2c' && !o.paymentMethodConfiguration) o = { ...o, paymentMethodConfiguration: await ensureB2CSetupConfig(s) };
  const metadata = { purpose: PM_PURPOSE, area: o.area, ...(o.metadata || {}) };
  const base = {
    mode: 'setup', customer: o.customer, currency: 'usd', locale: 'en', ui_mode: EMBED_MODE, return_url: o.returnUrl,
    metadata, setup_intent_data: { metadata },
    ...(o.paymentMethodConfiguration ? { payment_method_configuration: o.paymentMethodConfiguration } : {}),
  } as unknown as Stripe.Checkout.SessionCreateParams;
  let session: Stripe.Checkout.Session;
  const plain = { ...(base as unknown as Record<string, unknown>) }; delete plain.payment_method_configuration;
  try {
    // Same look as the checkout page (LeaseRun logo, brand navy, Inter, pill buttons).
    session = await s.checkout.sessions.create({ ...base, ...CHECKOUT_BRANDING });
  } catch (e) {
    // Older API versions may not know the branding field in setup mode – then without it.
    console.warn('pm_session_branding_fallback', e instanceof Error ? e.message : e);
    try { session = await s.checkout.sessions.create(base); }
    catch { session = await s.checkout.sessions.create(plain as unknown as Stripe.Checkout.SessionCreateParams); }
  }
  if (!session.client_secret) return null;
  return {
    clientSecret: session.client_secret, publishableKey: pk,
    summary: { title: 'Update payment method', lines: [], total: null, interval: null, net: o.area === 'b2b', back: o.back, area: o.area, kind: 'setup' },
  };
}

// After successful setup: make the new method the default (customer + active subscriptions).
// Checks that the session belongs to exactly this customer. Calling it twice (return + webhook) is harmless.
export async function applyPaymentMethod(s: Stripe, sessionOrId: string | Stripe.Checkout.Session, customerId?: string): Promise<{ ok: boolean; label?: string; error?: string }> {
  const session = typeof sessionOrId === 'string' ? await s.checkout.sessions.retrieve(sessionOrId, { expand: ['setup_intent'] }) : sessionOrId;
  const cust = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (session.mode !== 'setup' || session.metadata?.purpose !== PM_PURPOSE) return { ok: false, error: 'Unknown request.' };
  if (!cust || (customerId && cust !== customerId)) return { ok: false, error: 'This request does not belong to your account.' };
  if (session.status !== 'complete') return { ok: false, error: 'The payment method has not been confirmed yet.' };
  let si = session.setup_intent as Stripe.SetupIntent | string | null;
  if (typeof si === 'string') si = await s.setupIntents.retrieve(si);
  const pm = si && typeof si === 'object' ? (typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id) : null;
  if (!pm) return { ok: false, error: 'No payment method received.' };
  await s.customers.update(cust, { invoice_settings: { default_payment_method: pm } });
  for (const status of ['active', 'trialing', 'past_due'] as const) {
    const subs = await s.subscriptions.list({ customer: cust, status, limit: 20 });
    for (const sub of subs.data) {
      const cur = typeof sub.default_payment_method === 'string' ? sub.default_payment_method : sub.default_payment_method?.id;
      if (cur !== pm) await s.subscriptions.update(sub.id, { default_payment_method: pm });
    }
  }
  return { ok: true, label: await pmLabel(s, pm).catch(() => undefined) };
}

// Short label for the confirmation: "Visa •••• 4242", "Bank account •••• 6789", "Link" …
async function pmLabel(s: Stripe, id: string): Promise<string> {
  const pm = await s.paymentMethods.retrieve(id);
  if (pm.card) return `${pm.card.brand ? pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1) : 'Card'} •••• ${pm.card.last4}`;
  if (pm.us_bank_account) return `${pm.us_bank_account.bank_name || 'Bank account'} •••• ${pm.us_bank_account.last4}`;
  if (pm.type === 'link') return 'Link';
  return pm.type.replace(/_/g, ' ');
}
