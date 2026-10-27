import { after } from 'next/server';
import { z } from 'zod';
import { reportServerError } from '@/lib/admin/server-error';
import type Stripe from 'stripe';
import { billingEnabled, stripe } from '@/lib/billing/stripe';
import { VERIFY_MSG } from '@/lib/b2b/core';
import { accountBranches, findPlan, getCatalog } from '@/lib/b2b/catalog';
import { json, requireMember } from '@/lib/b2b/http';
import { automaticTax, ensureAddonPrice, ensureB2BCustomer, ensureB2BPaymentConfig, ensureB2BPrice, ensureTaxRateExclusive, parseExtras, taxRatesFor } from '@/lib/b2b/stripe-b2b';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { CHECKOUT_BRANDING, embedKey, NO_MANAGED_PAYMENTS, savePaymentMethod, toEmbedded, type KasseSummary } from '@/lib/billing/checkout-params';
import { intakeClosed } from '@/lib/security/panic';
import { applyPaymentMethod, createPaymentMethodSession } from '@/lib/billing/payment-method';
import { testCustomer, testStripeFor } from '@/lib/billing/testmode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ plan: z.string(), terms: z.literal(true), extras: z.array(z.enum(['vermittler', 'makler', 'finanzberater', 'allgemein'])).max(3).optional(), embedded: z.boolean().optional() });

// Purchase a plan for the business account (account owner). Prices in USD; sales tax only if Stripe Tax is enabled.
export async function POST(req: Request) {
  if (await intakeClosed()) return json({ error: 'Temporarily unavailable (maintenance). Please try again later.' }, 503);
  if (!billingEnabled()) return json({ error: 'Plans cannot be purchased yet. For a trial account, email support@leaserun.com.' }, 503);
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-checkout', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Please accept the Business Terms of Service.' }, 400);
  const a = ctx.account;
  const cat = await getCatalog(true);
  const f = findPlan(cat, p.data.plan);
  const branches = accountBranches(a);
  // Plans are only available for the account's own industry; changing the industry goes through support.
  if (!f || !f.plan.active) return json({ error: 'Unknown plan.' }, 400);
  if (f.branche !== branches[0]) return json({ error: `This plan belongs to a different industry. Your account is set up for "${cat.branchen[branches[0]].label}" – to switch, contact support@leaserun.com.` }, 403);
  if (!cat.branchen[f.branche].selfService) return json({ error: 'For your industry we prepare a custom quote. Please contact support@leaserun.com.' }, 403);
  const extras = [...new Set((p.data.extras || []).filter((x) => x !== branches[0]))];
  if (extras.length && !cat.addon.active) return json({ error: 'Add-on industries are currently not available.' }, 400);
  if (!a.verified_at) return json({ error: VERIFY_MSG }, 403);
  if (a.plan_source === 'stripe' && a.plan_tier && a.stripe_subscription_id) {
    return json({ error: 'You already have a subscription. Change or cancel it under "Manage subscription".' }, 409);
  }
  try {
    // Test purchase switch on (admins only): subscription in Stripe test mode at the real price, without activation.
    const ts = await testStripeFor(ctx.user.email);
    if (ts) {
      const origin = new URL(req.url).origin;
      const x = await ts.checkout.sessions.create({
        mode: 'subscription', customer: await testCustomer(ts, ctx.user.email), locale: 'en', billing_address_collection: 'required',
        customer_update: { address: 'auto', name: 'auto' },
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: f.cents, tax_behavior: 'exclusive', recurring: { interval: f.interval }, product_data: { name: `LeaseRun ${f.plan.name} (test purchase)` } } }],
        metadata: { leaserun_test: '1', plan: p.data.plan, admin: ctx.user.email },
        success_url: `${origin}/business-portal?checkout=test#tarif`, cancel_url: `${origin}/business-portal#tarif`,
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
      line_items: [{ price: pr.price, quantity: 1, ...taxRatesFor(tax) }, ...(addon ? [{ price: addon, quantity: extras.length, ...taxRatesFor(tax) }] : [])],
      locale: 'en',
      billing_address_collection: 'required',
      ...automaticTax(),
      customer_update: { address: 'auto', name: 'auto' },
      allow_promotion_codes: true,
      // Clear auto-renewal disclosure right at the pay button (FTC negative option rule / state auto-renewal laws).
      custom_text: { submit: { message: `Your subscription renews automatically every ${pr.interval === 'year' ? 'year' : 'month'} until you cancel. You can cancel online at any time in the business portal.` } },
      ...NO_MANAGED_PAYMENTS,
      ...CHECKOUT_BRANDING,
      ...(pmc ? { payment_method_configuration: pmc } : {}),
      ...savePaymentMethod('subscription'),
      metadata,
      subscription_data: { metadata, description: `${pr.name}${extras.length ? ` + ${extras.length} add-on industr${extras.length === 1 ? 'y' : 'ies'}` : ''}` },
      success_url: `${origin}/business-portal?checkout=success#tarif`,
      cancel_url: `${origin}/business-portal?checkout=cancel#tarif`,
    };
    const pk = p.data.embedded ? embedKey() : null;
    if (pk) {
      const session = await stripe().checkout.sessions.create({ ...toEmbedded(params, `${origin}/business-portal?checkout=success#tarif`), expand: ['line_items'] }).catch((e) => { console.error('b2b_checkout_embed_fallback', e instanceof Error ? e.message : e); after(() => reportServerError('b2b_checkout_embed_fallback', e, '/api/b2b/checkout', 'ausweichen')); return null; });
      if (!session) { const hosted = await stripe().checkout.sessions.create(params); return json({ url: hosted.url }); }
      const summary: KasseSummary = {
        title: pr.name, interval: pr.interval === 'year' ? 'yearly' : 'monthly', net: true, back: '/business-portal#tarif', area: 'b2b',
        lines: (session.line_items?.data || []).map((l) => ({ label: `${l.description || pr.name}${(l.quantity || 1) > 1 ? ` × ${l.quantity}` : ''}`, amount: l.amount_total })), total: session.amount_total,
      };
      return json({ clientSecret: session.client_secret, publishableKey: pk, summary });
    }
    const session = await stripe().checkout.sessions.create(params);
    return json({ url: session.url });
  } catch (e) {
    console.error('b2b_checkout_error', e instanceof Error ? e.message : e);
    after(() => reportServerError('b2b_checkout_error', e, '/api/b2b/checkout'));
    return json({ error: 'The payment page could not be opened.' }, 502);
  }
}

// Manage subscription (payment method, invoices, cancellation) via the Stripe customer portal.
export async function PUT(req: Request) {
  if (!billingEnabled()) return json({ error: 'Not available.' }, 503);
  const ctx = await requireMember(req, { owner: true, allowLocked: true, bucket: 'b2b-checkout', limit: 10 });
  if (ctx instanceof Response) return ctx;
  if (!ctx.account.stripe_customer_id) return json({ error: 'No subscription yet.' }, 404);
  const body = (await req.json().catch(() => ({}))) as { flow?: unknown; confirm?: unknown };
  const origin = new URL(req.url).origin;
  // Return from "Change payment method": set the new payment method as default for subscription and invoices.
  if (typeof body.confirm === 'string') {
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(body.confirm)) return json({ error: 'Invalid request.' }, 400);
    try {
      const r = await applyPaymentMethod(stripe(), body.confirm, ctx.account.stripe_customer_id);
      return json(r, r.ok ? 200 : 409);
    } catch (e) {
      console.error('b2b_pm_apply_error', e instanceof Error ? e.message : e);
      return json({ error: 'The payment method could not be saved. Please try again.' }, 502);
    }
  }
  // Change payment method: on leaserun.com/checkout in LeaseRun style (business methods: card, ACH bank debit).
  if (body.flow === 'payment') {
    const pm = await createPaymentMethodSession(stripe(), {
      customer: ctx.account.stripe_customer_id, area: 'b2b', back: '/business-portal#tarif',
      metadata: { b2b_pm_account_id: String(ctx.account.id) }, paymentMethodConfiguration: await ensureB2BPaymentConfig(),
      returnUrl: `${origin}/business-portal?zahlungsmittel=1&session_id={CHECKOUT_SESSION_ID}#tarif`,
    }).catch((e) => { console.warn('b2b_pm_session_error', e instanceof Error ? e.message : e); return null; });
    if (pm) return json(pm);
  }
  const s = await stripe().billingPortal.sessions.create({ customer: ctx.account.stripe_customer_id, locale: 'en', return_url: `${origin}/business-portal#tarif` });
  return json({ url: s.url });
}

// Current subscription price (before tax) from the Stripe subscription items: plan + add-on industries.
type SubPrice = { interval: 'month' | 'year'; netCents: number; grossCents: number; lines: { label: string; qty: number; netCents: number }[]; nextAt: string | null };
function subPrice(sub: Stripe.Subscription): SubPrice {
  let interval: 'month' | 'year' = 'month';
  const lines = sub.items.data.map((i) => {
    const pr = i.price; const qty = i.quantity || 1;
    if (pr?.recurring?.interval === 'year') interval = 'year';
    const prod = pr?.product && typeof pr.product === 'object' && 'name' in pr.product ? pr.product.name : '';
    const label = pr?.metadata?.leaserun_b2b_addon ? 'Add-on industry' : (prod || pr?.nickname || 'Plan');
    return { label, qty, netCents: (pr?.unit_amount || 0) * qty };
  });
  const netCents = lines.reduce((t, l) => t + l.netCents, 0);
  const end = (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items.data[0]?.current_period_end;
  return { interval, netCents, grossCents: netCents, lines, nextAt: end ? new Date(end * 1000).toISOString() : null };
}

// Fetch the current subscription price ("Current plan" display in the portal).
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

// Add an industry to a running subscription (prorated). Account owner only, Stripe subscription only.
const AddBody = z.object({ branche: z.enum(['vermittler', 'makler', 'finanzberater', 'allgemein']), terms: z.literal(true) });
export async function PATCH(req: Request) {
  if (!billingEnabled()) return json({ error: 'Not available.' }, 503);
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-checkout', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const p = AddBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Please choose an industry and accept the terms.' }, 400);
  const a = ctx.account;
  const cat = await getCatalog(true);
  if (!cat.addon.active) return json({ error: 'Add-on industries are currently not available.' }, 400);
  const branches = accountBranches(a);
  if (branches.includes(p.data.branche)) return json({ error: 'This industry is already active.' }, 409);
  if (a.plan_source !== 'stripe' || !a.stripe_subscription_id) return json({ error: 'Add-on industries can be added to an active subscription. If you pay by invoice, please contact support@leaserun.com.' }, 409);
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
      await s.subscriptionItems.create({ subscription: sub.id, price: addon, quantity: extras.length, ...taxRatesFor(tax), proration_behavior: 'create_prorations' });
    }
    await s.subscriptions.update(sub.id, { metadata: { ...sub.metadata, extras: extras.join(',') } });
    await supabaseAdmin().from('lr_b2b_accounts').update({ extra_branches: extras, updated_at: new Date().toISOString() }).eq('id', a.id);
    // Return the new subscription price right away so the account shows it without reloading.
    const fresh = await s.subscriptions.retrieve(sub.id, { expand: ['items.data.price.product'] }).catch(() => null);
    return json({ ok: true, extras, price: fresh ? subPrice(fresh) : null });
  } catch (e) {
    console.error('b2b_addon_error', e instanceof Error ? e.message : e);
    return json({ error: 'The add-on industry could not be added.' }, 502);
  }
}
