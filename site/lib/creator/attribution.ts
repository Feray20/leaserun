import type Stripe from 'stripe';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { decide, normCampaign, normRef, netCents, type AttributionRef, type BenefitRef, type CreatorRef } from '@/lib/creator/attribution-rules';
import { audit } from '@/lib/creator/server';

// Anbindung der Zuordnungsregeln an Registrierung und Stripe. Fehler hier dürfen NIE eine Registrierung
// oder einen Zahlungs-Webhook scheitern lassen – die aufrufenden Stellen fangen alles ab.

const SYSTEM = { kind: 'system' as const, ref: 'system:attribution', role: 'SYSTEM' as const };

async function creatorByCode(code: string): Promise<CreatorRef | null> {
  const { data } = await supabaseAdmin().from('lr_creators').select('id, user_id, status, ref_code').eq('ref_code', code).maybeSingle();
  return (data as CreatorRef) ?? null;
}

// Registrierung über einen Creator-Link: Kundenkonto einmalig zuordnen (erster Creator gewinnt).
export async function recordSignupAttribution(userId: string, ref: unknown, campaign: unknown): Promise<void> {
  const code = normRef(ref);
  if (!adminConfigured() || !code) return;
  const c = await creatorByCode(code);
  if (!c || c.status !== 'ACTIVE' || c.user_id === userId) return;
  const camp = normCampaign(campaign);
  await supabaseAdmin().from('lr_creator_attributions').upsert(
    { user_id: userId, creator_id: c.id, campaign_slug: camp },
    { onConflict: 'user_id', ignoreDuplicates: true },
  );
}

// Fallback für Registrierungen ohne Server-Mail (Google-Anmeldung, direkte Supabase-Registrierung):
// Code aus den Kontodaten (user_metadata.partner_ref) übernehmen – mit dem Registrierungszeitpunkt des Kontos.
async function attributionFor(userId: string): Promise<AttributionRef | null> {
  const db = supabaseAdmin();
  const { data } = await db.from('lr_creator_attributions').select('creator_id, campaign_slug, created_at').eq('user_id', userId).maybeSingle();
  if (data) return data as AttributionRef;
  const { data: u } = await db.auth.admin.getUserById(userId);
  const meta = (u?.user?.user_metadata ?? {}) as { partner_ref?: unknown; partner_campaign?: unknown };
  const code = normRef(meta.partner_ref);
  if (!code) return null;
  const c = await creatorByCode(code);
  if (!c || c.status !== 'ACTIVE' || c.user_id === userId) return null;
  const row = { user_id: userId, creator_id: c.id, campaign_slug: normCampaign(meta.partner_campaign), created_at: u?.user?.created_at ?? new Date().toISOString() };
  await db.from('lr_creator_attributions').upsert(row, { onConflict: 'user_id', ignoreDuplicates: true });
  return row;
}

// Eingelöste Aktionscodes einer Checkout-Sitzung (verträgt ID- und Objekt-Form sowie ältere/neuere API-Felder).
async function promoCodesOf(stripe: Stripe, sessionId: string): Promise<string[]> {
  const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['total_details.breakdown'] });
  const out: string[] = [];
  const list = ((s.total_details as unknown as { breakdown?: { discounts?: { discount?: Record<string, unknown> }[] } })?.breakdown?.discounts) ?? [];
  for (const d of list) {
    const disc = d.discount ?? {};
    const pc = (disc.promotion_code ?? (disc.source as { promotion_code?: unknown } | undefined)?.promotion_code) as string | { code?: string } | null | undefined;
    if (!pc) continue;
    if (typeof pc === 'string') {
      try { const p = await stripe.promotionCodes.retrieve(pc); if (p.code) out.push(p.code); } catch { /* Code nicht lesbar → ignorieren */ }
    } else if (pc.code) out.push(pc.code);
  }
  return out;
}

export async function recordCheckoutConversion(stripe: Stripe, s: Stripe.Checkout.Session): Promise<void> {
  if (!adminConfigured()) return;
  const userId = typeof s.client_reference_id === 'string' && /^[0-9a-f-]{36}$/i.test(s.client_reference_id) ? s.client_reference_id : null;
  const paid = s.payment_status === 'paid';
  const facts = {
    paid,
    // Testkäufe (Web-Admin) und Stripe-Testmodus zählen nicht – außer ausdrücklich für Tests freigeschaltet.
    test: s.metadata?.leaserun_test === '1' || (s.livemode === false && process.env.CREATOR_COUNT_TEST_PAYMENTS !== '1'),
    b2b: Boolean(s.metadata?.b2b_account_id), userId,
    promoCodes: paid && userId ? await promoCodesOf(stripe, s.id).catch(() => []) : [],
    occurredAt: new Date((s.created || Math.floor(Date.now() / 1000)) * 1000),
  };
  if (!facts.paid || facts.test || facts.b2b || !userId) return;

  const db = supabaseAdmin();
  const codes = facts.promoCodes.map((c) => c.toUpperCase()).filter((c) => /^[A-Z0-9]{3,20}$/.test(c));
  const [benefitRows, attribution, setting] = await Promise.all([
    codes.length ? db.from('lr_creator_benefits').select('id, creator_id, code, active, starts_at, ends_at, lr_creator_campaigns(slug)').in('code', codes) : Promise.resolve({ data: [] }),
    attributionFor(userId),
    db.from('lr_settings').select('value').eq('key', 'creator_attribution_window_days').maybeSingle(),
  ]);
  const benefits: BenefitRef[] = ((benefitRows.data ?? []) as (Omit<BenefitRef, 'campaign_slug'> & { lr_creator_campaigns?: { slug?: string } | null })[])
    .map((b) => ({ ...b, campaign_slug: b.lr_creator_campaigns?.slug ?? null }));
  const ids = [...new Set([...benefits.map((b) => b.creator_id), ...(attribution ? [attribution.creator_id] : [])])];
  const creators = new Map<string, CreatorRef>();
  if (ids.length) {
    const { data } = await db.from('lr_creators').select('id, user_id, status, ref_code').in('id', ids);
    for (const c of (data ?? []) as CreatorRef[]) creators.set(c.id, c);
  }
  const windowDays = typeof setting.data?.value === 'number' ? setting.data.value : undefined;
  const d = decide(facts, { benefits, attribution, creators, windowDays });
  if (!d.attribute) return;

  const amount = netCents(s.amount_total, s.total_details?.amount_tax);
  const { data: ins, error } = await db.from('lr_creator_conversions').upsert({
    creator_id: d.creatorId, user_id: userId, campaign_slug: d.campaignSlug, source: d.source, benefit_id: d.benefitId,
    stripe_session_id: s.id, stripe_payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null,
    plan: s.metadata?.plan ?? null, currency: (s.currency || 'eur').toLowerCase(), amount_net_cents: amount, occurred_at: facts.occurredAt.toISOString(),
  }, { onConflict: 'stripe_session_id', ignoreDuplicates: true }).select('id');
  if (error) throw new Error('conversion_insert_failed');
  if (ins?.length) await audit('CONVERSION_RECORDED', d.creatorId, SYSTEM, 'SUCCESS', { source: d.source, amount_net_cents: amount, plan: s.metadata?.plan ?? null });
}

// Erstattung (charge.refunded kommt auch bei Teilerstattungen): Erstattungsstand anteilig netto übernehmen,
// bei vollständiger Erstattung die Conversion zurücknehmen. Verrechnet wird beim nächsten Monatsabschluss.
export async function reverseForCharge(charge: Stripe.Charge): Promise<void> {
  if (!adminConfigured() || !(charge.amount_refunded > 0)) return;
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return;
  const db = supabaseAdmin();
  const { data, error } = await db.rpc('lr_creator_record_refund', { p_payment_intent: pi, p_charge: charge.id, p_amount: charge.amount, p_refunded: charge.amount_refunded });
  if (!error) {
    for (const r of (data ?? []) as { creator_id: string; refunded_net_cents: number; full: boolean }[]) {
      if (r.full) await audit('CONVERSION_REVERSED', r.creator_id, SYSTEM, 'SUCCESS', { reason: 'refund' });
      else if (r.refunded_net_cents > 0) await audit('REFUND_RECORDED', r.creator_id, SYSTEM, 'SUCCESS', { refunded_net_cents: r.refunded_net_cents });
    }
    return;
  }
  // Rückfall ohne Phase-4-Migration: nur vollständige Erstattungen nehmen die Conversion zurück.
  if (!charge.refunded) return;
  const { data: rows } = await db.from('lr_creator_conversions').update({ status: 'REVERSED', reversed_at: new Date().toISOString() })
    .eq('stripe_payment_intent', pi).eq('status', 'PENDING').select('id, creator_id');
  for (const r of (rows ?? []) as { id: string; creator_id: string }[]) await audit('CONVERSION_REVERSED', r.creator_id, SYSTEM, 'SUCCESS', { reason: 'refund' });
}
