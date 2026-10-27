import type Stripe from 'stripe';
import { PLANS, stripeTaxEnabled, type Plan } from '@/lib/billing/stripe';

// Shared checkout settings (real purchase and Web-Admin test purchase).
// Payment methods are limited to US methods via a dedicated payment method configuration (see payment-method.ts):
// card, Apple Pay, Google Pay, Link and optionally ACH bank debit (STRIPE_ACH_ENABLED=true). No SEPA/giropay/Sofort/Klarna.
// Stripe field may not be in the SDK types yet, hence the spread.
// Checkout in the LeaseRun style: LeaseRun logo, brand navy for the pay button, light background like the website,
// pill buttons and Inter. The logo is public at /img/stripe-logo.png (PNG, transparent).
export const CHECKOUT_BRANDING = { branding_settings: {
  display_name: 'LeaseRun', button_color: '#0F2C59', background_color: '#F1F5F9', border_style: 'pill', font_family: 'inter',
  logo: { type: 'url', url: 'https://leaserun.com/img/stripe-logo.png' },
} } as unknown as Partial<Stripe.Checkout.SessionCreateParams>;
export const NO_MANAGED_PAYMENTS = { managed_payments: { enabled: false } } as unknown as Partial<Stripe.Checkout.SessionCreateParams>;

// Save payment method: customers can keep a card or bank account for later purchases; at the next checkout Stripe
// shows the saved method automatically (same Stripe customer). Subscriptions save it anyway.
export function savePaymentMethod(mode: 'payment' | 'subscription' | 'setup'): Partial<Stripe.Checkout.SessionCreateParams> {
  return (mode === 'payment'
    ? { saved_payment_method_options: { payment_method_save: 'enabled', allow_redisplay_filters: ['always', 'limited', 'unspecified'] } }
    : { saved_payment_method_options: { allow_redisplay_filters: ['always', 'limited', 'unspecified'] } }) as unknown as Partial<Stripe.Checkout.SessionCreateParams>;
}

// Return target for "Back" on the checkout page: own paths only, never other domains.
export function safeBack(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\/(?!\/)[A-Za-z0-9\-._~\/#?=&%]{0,200}$/.test(s) && !/^\/(kasse|checkout|auth|api)\b/.test(s) ? s : fallback;
}

// Wording of the consent in the purchase dialog (identical to public/src/buy.mjs) – stored with a timestamp in the
// payment metadata as proof of affirmative consent (terms, and for subscriptions the automatic-renewal terms).
export const CONSENT_TEXT: Record<Plan, string> = {
  'pro-monthly': 'I agree to the Terms of Service and authorize LeaseRun to charge $29.00 per month (plus applicable sales tax) to my payment method, starting today and renewing automatically every month until I cancel. I can cancel anytime online at leaserun.com/cancel; access continues until the end of the paid month.',
  'buyer-pass': 'I agree to the Terms of Service and the Refund Policy. This is a one-time charge of $49.00 for 90 days of access; it does not renew. Access starts immediately after payment.',
  'credit-map': 'I agree to the Terms of Service and the Refund Policy. This is a one-time charge of $39.00 for one property; it does not renew. The Lender Package is unlocked immediately after payment.',
};

// Pay button: for subscriptions Stripe would otherwise label it "Subscribe". With submit_type "pay" it reads "Pay".
// If Stripe rejects the value, the session is created again without it so a purchase never fails (the renewal
// disclosure next to the button stays in every case).
export async function createCheckoutSession(s: Stripe, params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session> {
  try { return await s.checkout.sessions.create(params); }
  catch (e) {
    if (params.submit_type && params.mode === 'subscription' && /submit_type/i.test(e instanceof Error ? e.message : '')) {
      const { submit_type: _t, ...rest } = params; void _t;
      console.warn('checkout_submit_type_fallback');
      return s.checkout.sessions.create(rest);
    }
    throw e;
  }
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export function checkoutParams(o: {
  plan: Plan; customer: string; clientRef: string; price: string; taxRate?: string | null;
  metadata: Record<string, string>; successUrl: string; cancelUrl: string; addonPrice?: string | null;
}): Stripe.Checkout.SessionCreateParams {
  const def = PLANS[o.plan];
  // A fixed tax rate only if one is passed (legacy); otherwise Stripe Tax (automatic_tax) or no tax at all.
  const tax = o.taxRate ? { tax_rates: [o.taxRate] } : {};
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: def.mode,
    customer: o.customer,
    client_reference_id: o.clientRef,
    line_items: [{ price: o.price, quantity: 1, ...tax }, ...(o.addonPrice && def.mode === 'payment' ? [{ price: o.addonPrice, quantity: 1, ...tax }] : [])],
    locale: 'en',
    currency: 'usd',
    // Promotion code field: codes (e.g. for partners) are created in the Stripe dashboard; redemptions per code can be
    // reported there (basis for partner commissions).
    allow_promotion_codes: true,
    // US: ZIP code is enough for card checks; a full address is only collected when Stripe Tax needs it.
    billing_address_collection: stripeTaxEnabled() ? 'required' : 'auto',
    ...(stripeTaxEnabled() ? { automatic_tax: { enabled: true } } : {}),
    customer_update: { address: 'auto', name: 'auto' },
    // Disclosure right next to the pay button (FTC negative option rule / state automatic-renewal laws for subscriptions).
    custom_text: {
      submit: { message: def.mode === 'subscription'
        ? `By clicking Pay, you start a subscription: ${usd(def.amount)} per month plus applicable sales tax, charged today and every month until you cancel. Cancel anytime online at leaserun.com/cancel.`
        : `By clicking Pay, you buy ${def.name} for a one-time charge of ${usd(def.amount)} plus applicable sales tax. No subscription.` },
      after_submit: { message: 'Thank you! You will be taken back to LeaseRun in a moment. Your receipt arrives by email.' },
    },
    // Managed Payments (Stripe as merchant of record) is on by default in the Stripe account and does not work with
    // custom_text and LeaseRun's own receipts. LeaseRun sells directly → switch it off per request.
    ...NO_MANAGED_PAYMENTS,
    ...CHECKOUT_BRANDING,
    ...savePaymentMethod(def.mode),
    metadata: { ...o.metadata, consent_text: CONSENT_TEXT[o.plan].slice(0, 490) },
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
  };
  if (def.mode === 'payment') {
    params.submit_type = 'pay';
    params.invoice_creation = {
      enabled: true,
      invoice_data: {
        description: def.description,
        metadata: o.metadata,
        // Receipt footer: company name and support contact only (no VAT ID, no bank details, no owner address).
        footer: 'LeaseRun · leaserun.com · support@leaserun.com · Questions about this receipt? Just reply or email us.',
      },
    };
    params.payment_intent_data = { metadata: o.metadata, description: def.description };
  } else {
    params.submit_type = 'pay' as Stripe.Checkout.SessionCreateParams.SubmitType;
    params.subscription_data = { metadata: o.metadata, description: def.description };
  }
  return params;
}

// ---------- Embedded checkout (leaserun.com/checkout) ----------
// The Stripe payment form runs directly on the LeaseRun page (own layout, header, summary); customers never leave leaserun.com.
// Requires STRIPE_PUBLISHABLE_KEY (pk_live_… with sk_live_…, pk_test_… with sk_test_…). If it is missing or does not
// match, the hosted Stripe checkout (redirect) is used – nothing breaks.
export function embedKey(secret = process.env.STRIPE_SECRET_KEY || ''): string | null {
  const pk = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
  if (!/^pk_(live|test)_[A-Za-z0-9]+$/.test(pk)) return null;
  const live = /^(sk|rk)_live_/.test(secret.trim());
  return pk.startsWith(live ? 'pk_live_' : 'pk_test_') ? pk : null;
}
export const EMBED_MODE = 'embedded_page';
export function toEmbedded<T extends { success_url?: string; cancel_url?: string }>(params: T, returnUrl: string): T {
  const { success_url: _s, cancel_url: _c, ...rest } = params;
  void _s; void _c;
  // Embedded checkout: Stripe rejects a custom logo (the page around the form shows the LeaseRun logo anyway).
  const r = rest as unknown as Record<string, unknown>;
  const bs = r.branding_settings as Record<string, unknown> | undefined;
  if (bs && 'logo' in bs) { const { logo: _l, ...b2 } = bs; void _l; r.branding_settings = b2; }
  if (bs && 'icon' in bs) { const b3 = { ...(r.branding_settings as Record<string, unknown>) }; delete b3.icon; r.branding_settings = b3; }
  // Stripe replaced the "embedded" mode with "embedded_page" (the old name is rejected).
  return { ...r, ui_mode: EMBED_MODE, return_url: returnUrl } as unknown as T;
}
export type KasseSummary = { title: string; lines: { label: string; amount: number }[]; total: number | null; interval: string | null; net: boolean; back: string; area: 'b2c' | 'b2b'; kind?: 'pay' | 'setup' };
