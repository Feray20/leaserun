import type Stripe from 'stripe';
import { CHECKOUT_BRANDING, EMBED_MODE, embedKey, type KasseSummary } from '@/lib/billing/checkout-params';

// Zahlungsmittel ändern – direkt auf leaserun.com/kasse statt im Stripe-Kundenportal.
// Ablauf: Stripe-Checkout im Einrichtungsmodus (mode: 'setup', eingebettet) → Kunde hinterlegt Karte, PayPal, SEPA …
// → das neue Zahlungsmittel wird Standard für künftige Rechnungen und alle laufenden Abos des Kunden.
// Es wird dabei nichts berechnet. Welche Zahlarten erscheinen, steuert das Stripe-Konto (Einstellungen → Zahlungsmethoden).
export const PM_PURPOSE = 'pm_update';

// Zahlungsmittel für Privatkunden hinterlegen: nur in Deutschland übliche, wiederverwendbare Zahlarten
// (Karte, SEPA-Lastschrift, PayPal, Apple Pay, Google Pay). Keine fremden Länder-Zahlarten wie Pix oder Amazon Pay.
// Eigene Stripe-Konfiguration, einmal angelegt und danach wiederverwendet; schlägt das fehl, gilt die Standard-Konfiguration.
const B2C_PM_NAME = 'LeaseRun Zahlungsmittel (Privat)';
let b2cPmc: string | null = null;
export async function ensureB2CSetupConfig(s: Stripe): Promise<string | undefined> {
  if (b2cPmc) return b2cPmc;
  try {
    const list = await s.paymentMethodConfigurations.list({ limit: 100 });
    const hit = list.data.find((c) => c.name === B2C_PM_NAME && c.active);
    if (hit) return (b2cPmc = hit.id);
    const on = { display_preference: { preference: 'on' as const } };
    const off = { display_preference: { preference: 'off' as const } };
    const c = await s.paymentMethodConfigurations.create({
      name: B2C_PM_NAME,
      card: on, sepa_debit: on, paypal: on, apple_pay: on, google_pay: on,
      link: off, klarna: off, amazon_pay: off, pix: off, bancontact: off, eps: off, kakao_pay: off, naver_pay: off, payco: off, samsung_pay: off, satispay: off, mb_way: off,
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
    mode: 'setup', customer: o.customer, currency: 'eur', locale: 'de', ui_mode: EMBED_MODE, return_url: o.returnUrl,
    metadata, setup_intent_data: { metadata },
    ...(o.paymentMethodConfiguration ? { payment_method_configuration: o.paymentMethodConfiguration } : {}),
  } as unknown as Stripe.Checkout.SessionCreateParams;
  let session: Stripe.Checkout.Session;
  const plain = { ...(base as unknown as Record<string, unknown>) }; delete plain.payment_method_configuration;
  try {
    // Gleiches Erscheinungsbild wie die Bezahlseite (LeaseRun-Logo, Markenblau, Inter, Pillen-Knöpfe).
    session = await s.checkout.sessions.create({ ...base, ...CHECKOUT_BRANDING });
  } catch (e) {
    // Ältere API-Versionen kennen das Gestaltungsfeld im Einrichtungsmodus evtl. nicht – dann ohne.
    console.warn('pm_session_branding_fallback', e instanceof Error ? e.message : e);
    try { session = await s.checkout.sessions.create(base); }
    catch { session = await s.checkout.sessions.create(plain as unknown as Stripe.Checkout.SessionCreateParams); }
  }
  if (!session.client_secret) return null;
  return {
    clientSecret: session.client_secret, publishableKey: pk,
    summary: { title: 'Zahlungsmittel ändern', lines: [], total: null, interval: null, net: o.area === 'b2b', back: o.back, area: o.area, kind: 'setup' },
  };
}

// Nach erfolgreicher Einrichtung: neues Zahlungsmittel als Standard setzen (Kunde + laufende Abos).
// Prüft, dass die Sitzung zu genau diesem Kunden gehört. Mehrfacher Aufruf (Rückkehr + Webhook) ist unschädlich.
export async function applyPaymentMethod(s: Stripe, sessionOrId: string | Stripe.Checkout.Session, customerId?: string): Promise<{ ok: boolean; label?: string; error?: string }> {
  const session = typeof sessionOrId === 'string' ? await s.checkout.sessions.retrieve(sessionOrId, { expand: ['setup_intent'] }) : sessionOrId;
  const cust = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (session.mode !== 'setup' || session.metadata?.purpose !== PM_PURPOSE) return { ok: false, error: 'Unbekannter Vorgang.' };
  if (!cust || (customerId && cust !== customerId)) return { ok: false, error: 'Dieser Vorgang gehört nicht zu Ihrem Konto.' };
  if (session.status !== 'complete') return { ok: false, error: 'Das Zahlungsmittel wurde noch nicht bestätigt.' };
  let si = session.setup_intent as Stripe.SetupIntent | string | null;
  if (typeof si === 'string') si = await s.setupIntents.retrieve(si);
  const pm = si && typeof si === 'object' ? (typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id) : null;
  if (!pm) return { ok: false, error: 'Kein Zahlungsmittel erhalten.' };
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

// Kurzbezeichnung für die Bestätigung: „Visa •••• 4242“, „PayPal“, „SEPA-Lastschrift •••• 3000“ …
async function pmLabel(s: Stripe, id: string): Promise<string> {
  const pm = await s.paymentMethods.retrieve(id);
  if (pm.card) return `${pm.card.brand ? pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1) : 'Karte'} •••• ${pm.card.last4}`;
  if (pm.sepa_debit) return `SEPA-Lastschrift •••• ${pm.sepa_debit.last4}`;
  if (pm.type === 'paypal') return 'PayPal';
  if (pm.type === 'link') return 'Link';
  return pm.type.replace(/_/g, ' ');
}
