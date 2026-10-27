import { after } from 'next/server';
import { z } from 'zod';
import { reportServerError } from '@/lib/admin/server-error';
import type Stripe from 'stripe';
import { billingEnabled, stripe } from '@/lib/billing/stripe';
import { VERIFY_MSG } from '@/lib/b2b/core';
import { accountBranches, findPlan, getCatalog } from '@/lib/b2b/catalog';
import { json, requireMember } from '@/lib/b2b/http';
import { ensureAddonPrice, ensureB2BCustomer, ensureB2BPaymentConfig, ensureB2BPrice, ensureTaxRateExclusive, parseExtras } from '@/lib/b2b/stripe-b2b';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CHECKOUT_BRANDING, embedKey, NO_MANAGED_PAYMENTS, savePaymentMethod, toEmbedded, type KasseSummary } from '@/lib/billing/checkout-params';
import { intakeClosed } from '@/lib/security/panic';
import { applyPaymentMethod, createPaymentMethodSession } from '@/lib/billing/payment-method';
import { testCustomer, testStripeFor } from '@/lib/billing/testmode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ plan: z.string(), terms: z.literal(true), extras: z.array(z.enum(['vermittler', 'makler', 'finanzberater', 'allgemein'])).max(3).optional(), embedded: z.boolean().optional() });

// Tarif für das Unternehmenskonto buchen (Kontoinhaber). Netto zzgl. USt, kein Widerrufsrecht (B2B).
export async function POST(req: Request) {
  if (await intakeClosed()) return json({ error: 'Vorübergehend nicht möglich (Wartung). Bitte später erneut versuchen.' }, 503);
  if (!billingEnabled()) return json({ error: 'Tarife sind noch nicht buchbar. Für einen Testzugang bitte an support@leaserun.com schreiben.' }, 503);
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-checkout', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Bitte den Nutzungsbedingungen für Unternehmen zustimmen.' }, 400);
  const a = ctx.account;
  const cat = await getCatalog(true);
  const f = findPlan(cat, p.data.plan);
  const branches = accountBranches(a);
  // Pakete gibt es nur für die eigene Branche; Wechsel der Branche nur über den Support.
  if (!f || !f.plan.active) return json({ error: 'Unbekannter Tarif.' }, 400);
  if (f.branche !== branches[0]) return json({ error: `Dieses Paket gehört zu einer anderen Branche. Ihr Konto ist für „${cat.branchen[branches[0]].label}“ freigeschaltet – ein Wechsel ist über support@leaserun.com möglich.` }, 403);
  if (!cat.branchen[f.branche].selfService) return json({ error: 'Für Ihre Branche erstellen wir ein individuelles Angebot. Bitte wenden Sie sich an support@leaserun.com.' }, 403);
  const extras = [...new Set((p.data.extras || []).filter((x) => x !== branches[0]))];
  if (extras.length && !cat.addon.active) return json({ error: 'Zusatzbranchen sind derzeit nicht buchbar.' }, 400);
  if (!a.verified_at) return json({ error: VERIFY_MSG }, 403);
  if (a.plan_source === 'stripe' && a.plan_tier && a.stripe_subscription_id) {
    return json({ error: 'Es besteht bereits ein Abo. Wechsel und Kündigung über „Abo verwalten“.' }, 409);
  }
  try {
    // Testkauf-Schalter an (nur Administratoren): Abo im Stripe-Testmodus mit dem echten Nettopreis, ohne Freischaltung.
    const ts = await testStripeFor(ctx.user.email);
    if (ts) {
      const origin = new URL(req.url).origin;
      const tax = (await ts.taxRates.list({ active: true, limit: 50 })).data.find((t) => t.percentage === 19 && !t.inclusive)?.id
        || (await ts.taxRates.create({ display_name: 'USt', percentage: 19, inclusive: false, country: 'DE', jurisdiction: 'DE' })).id;
      const x = await ts.checkout.sessions.create({
        mode: 'subscription', customer: await testCustomer(ts, ctx.user.email), locale: 'de', billing_address_collection: 'required', tax_id_collection: { enabled: true },
        customer_update: { address: 'auto', name: 'auto' },
        line_items: [{ quantity: 1, tax_rates: [tax], price_data: { currency: 'eur', unit_amount: f.cents, tax_behavior: 'exclusive', recurring: { interval: f.interval }, product_data: { name: `LeaseRun ${f.plan.name} (Testkauf)` } } }],
        metadata: { leaserun_test: '1', plan: p.data.plan, admin: ctx.user.email },
        success_url: `${origin}/b2b-portal?checkout=test#tarif`, cancel_url: `${origin}/b2b-portal#tarif`,
      });
      return json({ url: x.url, test: true });
    }
    const [customer, pr, tax, pmc] = await Promise.all([ensureB2BCustomer(a), ensureB2BPrice(p.data.plan), ensureTaxRateExclusive(), ensureB2BPaymentConfig()]);
    const addon = extras.length ? await ensureAddonPrice(pr.interval) : null;
    const metadata = { b2b_account_id: a.id, plan: p.data.plan, tier: pr.tier, branche: branches[0], extras: extras.join(','), terms_accepted: new Date().toISOString() };
    const origin = new URL(req.url).origin;
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      customer,
      client_reference_id: a.id,
      line_items: [{ price: pr.price, quantity: 1, tax_rates: [tax] }, ...(addon ? [{ price: addon, quantity: extras.length, tax_rates: [tax] }] : [])],
      locale: 'de',
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      allow_promotion_codes: true,
      // Button-Lösung (§ 312j Abs. 3 BGB): Hinweis direkt am Bestellknopf der Bezahlseite.
      custom_text: { submit: { message: 'Mit Klick auf den Button schließen Sie einen zahlungspflichtigen Vertrag mit LeaseRun ab.' } },
      ...NO_MANAGED_PAYMENTS,
      ...CHECKOUT_BRANDING,
      ...(pmc ? { payment_method_configuration: pmc } : {}),
      ...savePaymentMethod('subscription'),
      metadata,
      subscription_data: { metadata, description: `${pr.name}${extras.length ? ` + ${extras.length} Zusatzbranche(n)` : ''}` },
      success_url: `${origin}/b2b-portal?checkout=success#tarif`,
      cancel_url: `${origin}/b2b-portal?checkout=cancel#tarif`,
    };
    const pk = p.data.embedded ? embedKey() : null;
    if (pk) {
      const session = await stripe().checkout.sessions.create({ ...toEmbedded(params, `${origin}/b2b-portal?checkout=success#tarif`), expand: ['line_items'] }).catch((e) => { console.error('b2b_checkout_embed_fallback', e instanceof Error ? e.message : e); after(() => reportServerError('b2b_checkout_embed_fallback', e, '/api/b2b/checkout', 'ausweichen')); return null; });
      if (!session) { const hosted = await stripe().checkout.sessions.create(params); return json({ url: hosted.url }); }
      const summary: KasseSummary = {
        title: pr.name, interval: pr.interval === 'year' ? 'jährlich' : 'monatlich', net: true, back: '/business-portal#tarif', area: 'b2b',
        lines: (session.line_items?.data || []).map((l) => ({ label: `${l.description || pr.name}${(l.quantity || 1) > 1 ? ` × ${l.quantity}` : ''}`, amount: l.amount_total })), total: session.amount_total,
      };
      return json({ clientSecret: session.client_secret, publishableKey: pk, summary });
    }
    const session = await stripe().checkout.sessions.create(params);
    return json({ url: session.url });
  } catch (e) {
    console.error('b2b_checkout_error', e instanceof Error ? e.message : e);
    after(() => reportServerError('b2b_checkout_error', e, '/api/b2b/checkout'));
    return json({ error: 'Bezahlseite konnte nicht geöffnet werden.' }, 502);
  }
}

// Abo verwalten (Zahlungsmittel, Rechnungen, Kündigung) über das Stripe-Kundenportal.
export async function PUT(req: Request) {
  if (!billingEnabled()) return json({ error: 'Nicht verfügbar.' }, 503);
  const ctx = await requireMember(req, { owner: true, allowLocked: true, bucket: 'b2b-checkout', limit: 10 });
  if (ctx instanceof Response) return ctx;
  if (!ctx.account.stripe_customer_id) return json({ error: 'Noch kein Abo vorhanden.' }, 404);
  const body = (await req.json().catch(() => ({}))) as { flow?: unknown; confirm?: unknown };
  const origin = new URL(req.url).origin;
  // Rückkehr nach „Zahlungsmittel ändern“: neues Zahlungsmittel als Standard für Abo und Rechnungen setzen.
  if (typeof body.confirm === 'string') {
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(body.confirm)) return json({ error: 'Ungültige Anfrage.' }, 400);
    try {
      const r = await applyPaymentMethod(stripe(), body.confirm, ctx.account.stripe_customer_id);
      return json(r, r.ok ? 200 : 409);
    } catch (e) {
      console.error('b2b_pm_apply_error', e instanceof Error ? e.message : e);
      return json({ error: 'Das Zahlungsmittel konnte nicht übernommen werden. Bitte erneut versuchen.' }, 502);
    }
  }
  // Zahlungsmittel ändern: auf leaserun.com/kasse im LeaseRun-Stil (Zahlarten für Unternehmen: Karte, SEPA-Lastschrift).
  if (body.flow === 'payment') {
    const pm = await createPaymentMethodSession(stripe(), {
      customer: ctx.account.stripe_customer_id, area: 'b2b', back: '/business-portal#tarif',
      metadata: { b2b_pm_account_id: String(ctx.account.id) }, paymentMethodConfiguration: await ensureB2BPaymentConfig(),
      returnUrl: `${origin}/b2b-portal?zahlungsmittel=1&session_id={CHECKOUT_SESSION_ID}#tarif`,
    }).catch((e) => { console.warn('b2b_pm_session_error', e instanceof Error ? e.message : e); return null; });
    if (pm) return json(pm);
  }
  const s = await stripe().billingPortal.sessions.create({ customer: ctx.account.stripe_customer_id, locale: 'de', return_url: `${origin}/b2b-portal#tarif` });
  return json({ url: s.url });
}

// Aktueller Abopreis (netto) aus den Positionen des Stripe-Abos: Paket + Zusatzbranchen.
type SubPrice = { interval: 'month' | 'year'; netCents: number; grossCents: number; lines: { label: string; qty: number; netCents: number }[]; nextAt: string | null };
function subPrice(sub: Stripe.Subscription): SubPrice {
  let interval: 'month' | 'year' = 'month';
  const lines = sub.items.data.map((i) => {
    const pr = i.price; const qty = i.quantity || 1;
    if (pr?.recurring?.interval === 'year') interval = 'year';
    const prod = pr?.product && typeof pr.product === 'object' && 'name' in pr.product ? pr.product.name : '';
    const label = pr?.metadata?.leaserun_b2b_addon ? 'Zusatzbranche' : (prod || pr?.nickname || 'Paket');
    return { label, qty, netCents: (pr?.unit_amount || 0) * qty };
  });
  const netCents = lines.reduce((t, l) => t + l.netCents, 0);
  const end = (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items.data[0]?.current_period_end;
  return { interval, netCents, grossCents: Math.round(netCents * 1.19), lines, nextAt: end ? new Date(end * 1000).toISOString() : null };
}

// Aktuellen Abopreis abrufen (Anzeige „Aktueller Tarif“ im Portal).
export async function GET(req: Request) {
  const ctx = await requireMember(req, { owner: true, allowLocked: true, bucket: 'b2b-price', limit: 60 });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  if (!billingEnabled() || a.plan_source !== 'stripe' || !a.stripe_subscription_id) return json({ price: null });
  try {
    const sub = await stripe().subscriptions.retrieve(a.stripe_subscription_id, { expand: ['items.data.price.product'] });
    return json({ price: subPrice(sub) }, 200);
  } catch (e) {
    console.error('b2b_price_error', e instanceof Error ? e.message : e);
    return json({ price: null });
  }
}

// Zusatzbranche zu einem laufenden Abo dazubuchen (anteilig berechnet). Nur Kontoinhaber, nur mit Stripe-Abo.
const AddBody = z.object({ branche: z.enum(['vermittler', 'makler', 'finanzberater', 'allgemein']), terms: z.literal(true) });
export async function PATCH(req: Request) {
  if (!billingEnabled()) return json({ error: 'Nicht verfügbar.' }, 503);
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-checkout', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const p = AddBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Bitte Branche wählen und den Bedingungen zustimmen.' }, 400);
  const a = ctx.account;
  const cat = await getCatalog(true);
  if (!cat.addon.active) return json({ error: 'Zusatzbranchen sind derzeit nicht buchbar.' }, 400);
  const branches = accountBranches(a);
  if (branches.includes(p.data.branche)) return json({ error: 'Diese Branche ist bereits freigeschaltet.' }, 409);
  if (a.plan_source !== 'stripe' || !a.stripe_subscription_id) return json({ error: 'Zusatzbranchen lassen sich mit einem gebuchten Abo dazubuchen. Bei Rechnungskauf bitte an support@leaserun.com wenden.' }, 409);
  try {
    const s = stripe();
    const sub = await s.subscriptions.retrieve(a.stripe_subscription_id);
    const interval = sub.items.data.find((i) => !i.price?.metadata?.leaserun_b2b_addon)?.price?.recurring?.interval === 'year' ? 'year' : 'month';
    const addon = await ensureAddonPrice(interval);
    const extras = [...parseExtras(sub.metadata?.extras), p.data.branche];
    const existing = sub.items.data.find((i) => i.price?.metadata?.leaserun_b2b_addon === 'branche');
    if (existing && existing.price.id === addon) await s.subscriptionItems.update(existing.id, { quantity: extras.length, proration_behavior: 'create_prorations' });
    else {
      if (existing) await s.subscriptionItems.del(existing.id, { proration_behavior: 'create_prorations' });
      const tax = await ensureTaxRateExclusive();
      await s.subscriptionItems.create({ subscription: sub.id, price: addon, quantity: extras.length, tax_rates: [tax], proration_behavior: 'create_prorations' });
    }
    await s.subscriptions.update(sub.id, { metadata: { ...sub.metadata, extras: extras.join(',') } });
    await supabaseAdmin().from('lr_b2b_accounts').update({ extra_branches: extras, updated_at: new Date().toISOString() }).eq('id', a.id);
    // Neuen Abopreis sofort zurückgeben, damit das Konto ihn ohne Neuladen anzeigt.
    const fresh = await s.subscriptions.retrieve(sub.id, { expand: ['items.data.price.product'] }).catch(() => null);
    return json({ ok: true, extras, price: fresh ? subPrice(fresh) : null });
  } catch (e) {
    console.error('b2b_addon_error', e instanceof Error ? e.message : e);
    return json({ error: 'Zusatzbranche konnte nicht gebucht werden.' }, 502);
  }
}
