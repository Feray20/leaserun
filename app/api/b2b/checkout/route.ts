import { z } from 'zod';
import { billingEnabled, stripe } from '@/lib/billing/stripe';
import { B2B_PLANS, VERIFY_MSG } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { ensureB2BCustomer, ensureB2BPrice, ensureTaxRateExclusive } from '@/lib/b2b/stripe-b2b';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ plan: z.string(), terms: z.literal(true) });

// Tarif für das Unternehmenskonto buchen (Kontoinhaber). Netto zzgl. USt, kein Widerrufsrecht (B2B).
export async function POST(req: Request) {
  if (!billingEnabled()) return json({ error: 'Tarife sind noch nicht buchbar. Für einen Testzugang bitte an support@immoadv.de schreiben.' }, 503);
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-checkout', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Bitte den Nutzungsbedingungen für Unternehmen zustimmen.' }, 400);
  const plan = B2B_PLANS.find((x) => x.id === p.data.plan);
  if (!plan) return json({ error: 'Unbekannter Tarif.' }, 400);
  const a = ctx.account;
  if (!a.verified_at) return json({ error: VERIFY_MSG }, 403);
  if (a.plan_source === 'stripe' && a.plan_tier && a.stripe_subscription_id) {
    return json({ error: 'Es besteht bereits ein Abo. Wechsel und Kündigung über „Abo verwalten“.' }, 409);
  }
  try {
    const [customer, price, tax] = await Promise.all([ensureB2BCustomer(a), ensureB2BPrice(plan.id), ensureTaxRateExclusive()]);
    const metadata = { b2b_account_id: a.id, plan: plan.id, tier: plan.tier, terms_accepted: new Date().toISOString() };
    const origin = new URL(req.url).origin;
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: a.id,
      line_items: [{ price, quantity: 1, tax_rates: [tax] }],
      locale: 'de',
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      allow_promotion_codes: true,
      // Button-Lösung (§ 312j Abs. 3 BGB): Hinweis direkt am Bestellknopf der Bezahlseite.
      custom_text: { submit: { message: 'Mit Klick auf den Button schließen Sie einen zahlungspflichtigen Vertrag mit ImmoAdv ab.' } },
      metadata,
      subscription_data: { metadata, description: `${plan.name} – ${plan.intervall}` },
      success_url: `${origin}/b2b-portal?checkout=success#tarif`,
      cancel_url: `${origin}/b2b-portal?checkout=cancel#tarif`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error('b2b_checkout_error', e instanceof Error ? e.message : e);
    return json({ error: 'Bezahlseite konnte nicht geöffnet werden.' }, 502);
  }
}

// Abo verwalten (Zahlungsmittel, Rechnungen, Kündigung) über das Stripe-Kundenportal.
export async function PUT(req: Request) {
  if (!billingEnabled()) return json({ error: 'Nicht verfügbar.' }, 503);
  const ctx = await requireMember(req, { owner: true, allowLocked: true, bucket: 'b2b-checkout', limit: 10 });
  if (ctx instanceof Response) return ctx;
  if (!ctx.account.stripe_customer_id) return json({ error: 'Noch kein Abo vorhanden.' }, 404);
  const s = await stripe().billingPortal.sessions.create({ customer: ctx.account.stripe_customer_id, locale: 'de', return_url: `${new URL(req.url).origin}/b2b-portal#tarif` });
  return json({ url: s.url });
}
