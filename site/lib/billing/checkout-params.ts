import type Stripe from 'stripe';
import { PLANS, type Plan } from '@/lib/billing/stripe';

// Gemeinsame Einstellungen der Bezahlseite (echter Kauf und Testkauf im Web-Admin).
// Zahlarten werden bewusst NICHT festgelegt: Stripe zeigt automatisch alle im Stripe-Konto aktivierten Zahlarten
// (Karte, PayPal, Apple Pay, Google Pay, Klarna, SEPA …). Logo und Farben kommen aus Stripe → Einstellungen → Branding.
// Stripe-Feld ist evtl. noch nicht in den SDK-Typen, daher als Spread.
// Bezahlseite im LeaseRun-Stil: LeaseRun-Logo, Markenblau für den Bestellknopf, heller Hintergrund wie die Website,
// Pillen-Knöpfe und Schrift Inter. Logo liegt öffentlich unter /img/stripe-logo.png (PNG, transparent).
export const CHECKOUT_BRANDING = { branding_settings: {
  display_name: 'LeaseRun', button_color: '#0F2C59', background_color: '#F1F5F9', border_style: 'pill', font_family: 'inter',
  logo: { type: 'url', url: 'https://leaserun.com/img/stripe-logo.png' },
} } as unknown as Partial<Stripe.Checkout.SessionCreateParams>;
export const NO_MANAGED_PAYMENTS = { managed_payments: { enabled: false } } as unknown as Partial<Stripe.Checkout.SessionCreateParams>;

// Zahlungsmittel speichern: Kunden können Karte/PayPal/SEPA für spätere Käufe hinterlegen; bei der nächsten Bezahlung
// zeigt Stripe das gespeicherte Zahlungsmittel automatisch an (gleicher Stripe-Kunde). Abos speichern ohnehin.
export function savePaymentMethod(mode: 'payment' | 'subscription' | 'setup'): Partial<Stripe.Checkout.SessionCreateParams> {
  return (mode === 'payment'
    ? { saved_payment_method_options: { payment_method_save: 'enabled', allow_redisplay_filters: ['always', 'limited', 'unspecified'] } }
    : { saved_payment_method_options: { allow_redisplay_filters: ['always', 'limited', 'unspecified'] } }) as unknown as Partial<Stripe.Checkout.SessionCreateParams>;
}

// Rücksprungziel nach „Zurück“ auf der Kasse: nur eigene Pfade, nie fremde Domains.
export function safeBack(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\/(?!\/)[A-Za-z0-9\-._~\/#?=&%]{0,200}$/.test(s) && !/^\/(kasse|auth|api)\b/.test(s) ? s : fallback;
}

// Wortlaut der Zustimmung im Kaufdialog (identisch mit public/src/buy.mjs) – wird als Nachweis mit Zeitpunkt in den
// Metadaten der Zahlung gespeichert (Beleg für das Erlöschen des Widerrufsrechts bzw. den Wertersatz).
export const CONSENT_TEXT: Record<Plan, string> = {
  'pro-monthly': 'Ich verlange, dass LeaseRun vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass ich bei einem Widerruf für die bis dahin erbrachte Leistung anteilig Wertersatz zahle.',
  'buyer-pass': 'Ich verlange, dass LeaseRun vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass mein Widerrufsrecht für die enthaltene Kreditmappe mit deren Bereitstellung erlischt und ich bei einem Widerruf des Zugangs anteilig Wertersatz zahle.',
  'credit-map': 'Ich stimme ausdrücklich zu, dass LeaseRun vor Ablauf der Widerrufsfrist mit der Bereitstellung beginnt. Mir ist bekannt, dass ich dadurch mein Widerrufsrecht verliere.',
};

// Bestellknopf (§ 312j Abs. 3 BGB): Stripe beschriftet ihn bei Abos sonst mit „Abonnieren“. Mit submit_type „pay“
// steht dort „Bezahlen“ – eindeutig zahlungspflichtig. Lehnt Stripe den Wert ab, wird ohne ihn erneut angelegt,
// damit ein Kauf nie scheitert (der Hinweis am Knopf bleibt in jedem Fall).
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

export function checkoutParams(o: {
  plan: Plan; customer: string; clientRef: string; price: string; taxRate: string;
  metadata: Record<string, string>; successUrl: string; cancelUrl: string; addonPrice?: string | null;
}): Stripe.Checkout.SessionCreateParams {
  const def = PLANS[o.plan];
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: def.mode,
    customer: o.customer,
    client_reference_id: o.clientRef,
    line_items: [{ price: o.price, quantity: 1, tax_rates: [o.taxRate] }, ...(o.addonPrice && def.mode === 'payment' ? [{ price: o.addonPrice, quantity: 1, tax_rates: [o.taxRate] }] : [])],
    locale: 'de',
    // Gutscheincode-Feld auf der Bezahlseite: Aktionscodes (z. B. für Kooperationspartner) werden im Stripe-Dashboard angelegt;
    // Einlösungen je Code sind dort auswertbar (Grundlage für Partnerprovisionen).
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    // Button-Lösung (§ 312j Abs. 3 BGB): Hinweis direkt am Bestellknopf der Bezahlseite.
    custom_text: {
      submit: { message: 'Mit Klick auf den Button schließen Sie einen zahlungspflichtigen Vertrag mit LeaseRun ab.' },
      after_submit: { message: 'Danke! Sie werden gleich zu LeaseRun zurückgeleitet. Rechnung und Beleg erhalten Sie per E-Mail.' },
    },
    // Managed Payments (Stripe als Händler) ist im Stripe-Konto standardmäßig an und verträgt sich nicht mit
    // custom_text, eigenen Steuersätzen und eigener Rechnung. LeaseRun verkauft selbst → pro Anfrage ausschalten.
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
        rendering_options: { amount_tax_display: 'include_inclusive_tax' },
        footer: 'LeaseRun · Feray Korkmaz · Georg-August-Zinn-Str. 25 · 64354 Reinheim · USt-IdNr. DE348036700',
      },
    };
    params.payment_intent_data = { metadata: o.metadata, description: def.description };
  } else {
    params.submit_type = 'pay' as Stripe.Checkout.SessionCreateParams.SubmitType;
    params.subscription_data = { metadata: o.metadata, description: def.description };
  }
  return params;
}

// ---------- Eingebettete Bezahlung (leaserun.com/kasse) ----------
// Das Stripe-Zahlformular läuft direkt auf der LeaseRun-Seite (eigenes Layout, Kopf, Übersicht); Kunden verlassen leaserun.com nicht.
// Benötigt STRIPE_PUBLISHABLE_KEY (pk_live_… zu sk_live_…, pk_test_… zu sk_test_…). Fehlt er oder passt er nicht,
// bleibt es bei der Stripe-Bezahlseite (Weiterleitung) – nichts bricht.
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
  // Eingebettete Kasse: Stripe lehnt ein eigenes Logo ab (die Seite rund um das Formular zeigt das LeaseRun-Logo ohnehin).
  const r = rest as unknown as Record<string, unknown>;
  const bs = r.branding_settings as Record<string, unknown> | undefined;
  if (bs && 'logo' in bs) { const { logo: _l, ...b2 } = bs; void _l; r.branding_settings = b2; }
  if (bs && 'icon' in bs) { const b3 = { ...(r.branding_settings as Record<string, unknown>) }; delete b3.icon; r.branding_settings = b3; }
  // Stripe hat den Modus „embedded“ durch „embedded_page“ ersetzt (ältere Bezeichnung wird abgelehnt).
  return { ...r, ui_mode: EMBED_MODE, return_url: returnUrl } as unknown as T;
}
export type KasseSummary = { title: string; lines: { label: string; amount: number }[]; total: number | null; interval: string | null; net: boolean; back: string; area: 'b2c' | 'b2b'; kind?: 'pay' | 'setup' };
