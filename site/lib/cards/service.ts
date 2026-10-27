// LeaseRun Card – Service-Schicht (nur Server). Die Oberfläche spricht ausschließlich über /api/karten mit diesem Modul.
// Alle schreibenden Vorgänge prüfen Anmeldung, Eigentum und Produktstatus serverseitig; Freigaben laufen über die
// atomaren SQL-Funktionen (lr_card_authorize/settle/refund). Fehlen die Tabellen noch, gilt „nicht eingerichtet“.
import { randomUUID } from 'node:crypto';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { available, limitAllowed, type CardStatus, type LimitState } from './limits';
import { programStatus } from './status';
import { benefitFor } from './benefits';

export type CardView = {
  id: string; type: 'debit' | 'charge' | 'business'; design: string; status: CardStatus; last4: string | null; isDemo: boolean;
  limit: { monthly: number; settled: number; reserved: number; refunded: number; deposit: number; available: number; resetAt: string } | null;
};
export const NOT_ACTIVE_MSG = 'Diese Funktion ist derzeit noch nicht aktiviert. Ihre Daten wurden nicht verändert.';
const missingTable = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || '')));
export const programActive = () => ['LIVE', 'SANDBOX'].includes(programStatus());

type LimitRow = { card_id: string; monthly_limit_cents: number; settled_cents: number; reserved_cents: number; refunded_cents: number; security_deposit_cents: number; refunds_release_limit: boolean; reset_at: string };
type CardRow = { id: string; type: 'debit' | 'charge' | 'business'; design: string; status: CardStatus; last4: string | null; is_demo: boolean; created_at: string };
const toState = (l: LimitRow): LimitState => ({ monthlyLimit: Number(l.monthly_limit_cents), settled: Number(l.settled_cents), reserved: Number(l.reserved_cents), refunded: Number(l.refunded_cents), securityDeposit: Number(l.security_deposit_cents), refundsReleaseLimit: l.refunds_release_limit });

// Übersicht für den angemeldeten Nutzer: nur eigene Karten; in Produktion nie Demo-Karten.
export async function overview(userId: string) {
  const empty = { cards: [] as CardView[], transactions: [] as unknown[], tablesReady: false, benefit: benefitFor([], programActive()) };
  if (!adminConfigured()) return empty;
  const db = supabaseAdmin();
  const { data: cards, error } = await db.from('lr_cards').select('id, type, design, status, last4, is_demo, created_at').eq('user_id', userId).order('created_at');
  if (error) { if (!missingTable(error)) console.warn('[karten] overview', error.code); return empty; }
  const real = (cards as CardRow[] ?? []).filter((c) => !c.is_demo || process.env.VERCEL_ENV !== 'production');
  const ids = real.map((c) => c.id);
  const [{ data: limits }, { data: tx }] = ids.length
    ? await Promise.all([
      db.from('lr_card_limits').select('*').in('card_id', ids),
      db.from('lr_card_transactions').select('id, card_id, kind, amount_cents, status, merchant, category, available_before_cents, available_after_cents, created_at').in('card_id', ids).order('created_at', { ascending: false }).limit(100),
    ])
    : [{ data: [] }, { data: [] }];
  const byCard = new Map((limits as LimitRow[] ?? []).map((l) => [l.card_id, l]));
  const view: CardView[] = real.map((c) => {
    const l = byCard.get(c.id);
    const s = l ? toState(l) : null;
    return { id: c.id, type: c.type, design: c.design, status: c.status, last4: c.last4, isDemo: c.is_demo,
      limit: l && s ? { monthly: s.monthlyLimit, settled: s.settled, reserved: s.reserved, refunded: s.refunded, deposit: s.securityDeposit, available: available(s), resetAt: l.reset_at } : null };
  });
  return { cards: view, transactions: tx ?? [], tablesReady: true, benefit: benefitFor(real, programActive()) };
}

async function ownCard(userId: string, cardId: string) {
  const db = supabaseAdmin();
  const { data, error } = await db.from('lr_cards').select('id, user_id, type, status, is_demo, provider_ref, stripe_account').eq('id', cardId).maybeSingle();
  if (error || !data || data.user_id !== userId) return null;
  return data as { id: string; user_id: string; type: 'debit' | 'charge' | 'business'; status: CardStatus; is_demo: boolean; provider_ref: string | null; stripe_account: string | null };
}

async function audit(cardId: string | null, userId: string | null, action: string, oldValue: unknown, newValue: unknown, ipHash: string | null) {
  await supabaseAdmin().from('lr_card_audit').insert({ card_id: cardId, user_id: userId, actor: userId ? 'user' : 'system', action, old_value: oldValue ?? null, new_value: newValue ?? null, ip_hash: ipHash, request_id: randomUUID() });
}

export type ActionResult = { ok: true; data?: unknown } | { ok: false; status: number; error: string; code?: string };

export async function updateLimit(userId: string, cardId: string, newLimit: number, ipHash: string | null): Promise<ActionResult> {
  if (!programActive() || !adminConfigured()) return { ok: false, status: 503, error: NOT_ACTIVE_MSG, code: 'NOT_CONFIGURED' };
  const card = await ownCard(userId, cardId);
  if (!card) return { ok: false, status: 404, error: 'Karte nicht gefunden.' };
  if (card.status === 'BLOCKED') return { ok: false, status: 409, error: 'Die Karte ist gesperrt. Das Limit kann nicht geändert werden.' };
  if (card.type === 'business') return { ok: false, status: 403, error: 'Das Limit einer Firmenkarte legt Ihr Unternehmen fest.' };
  const db = supabaseAdmin();
  const { data: l } = await db.from('lr_card_limits').select('*').eq('card_id', cardId).maybeSingle();
  if (!l) return { ok: false, status: 409, error: 'Für diese Karte ist noch kein Limit eingerichtet.' };
  const chk = limitAllowed(card.type, newLimit, Number((l as LimitRow).security_deposit_cents));
  if (!chk.ok) return { ok: false, status: 400, error: chk.reason };
  const { error } = await db.from('lr_card_limits').update({ monthly_limit_cents: newLimit, updated_at: new Date().toISOString() }).eq('card_id', cardId);
  if (error) { console.warn('[karten] limit', error.code); return { ok: false, status: 502, error: 'Die Änderung konnte momentan nicht übernommen werden. Bitte versuchen Sie es erneut.' }; }
  await audit(cardId, userId, 'limit_change', { monthly_limit_cents: (l as LimitRow).monthly_limit_cents }, { monthly_limit_cents: newLimit }, ipHash);
  return { ok: true };
}

export async function setFrozen(userId: string, cardId: string, on: boolean, ipHash: string | null): Promise<ActionResult> {
  if (!programActive() || !adminConfigured()) return { ok: false, status: 503, error: NOT_ACTIVE_MSG, code: 'NOT_CONFIGURED' };
  const card = await ownCard(userId, cardId);
  if (!card) return { ok: false, status: 404, error: 'Karte nicht gefunden.' };
  if (card.status === 'BLOCKED') return { ok: false, status: 409, error: 'Die Karte ist dauerhaft gesperrt.' };
  if (!on && card.status !== 'FROZEN') return { ok: true };
  if (on && card.status !== 'ACTIVE') return { ok: false, status: 409, error: 'Nur aktive Karten können vorübergehend gesperrt werden.' };
  // Beim Kartenpartner sperren; schlägt das fehl, bleibt der Status unverändert (keine scheinbare Sperre).
  if (!card.is_demo) {
    if (!card.provider_ref) return { ok: false, status: 409, error: 'Die Karte ist beim Kartenpartner noch nicht angelegt.' };
    const p = (process.env.CARD_PROVIDER || '').toLowerCase() === 'stripe'
      ? await (await import('./stripe-issuing')).setStripeCardStatus(card.provider_ref, on, card.stripe_account)
      : await (await (await import('./provider')).cardProvider()).freeze(card.provider_ref, on);
    if (!p.ok) return { ok: false, status: 503, error: p.message, code: p.code };
  }
  const next: CardStatus = on ? 'FROZEN' : 'ACTIVE';
  const { error } = await supabaseAdmin().from('lr_cards').update({ status: next, updated_at: new Date().toISOString() }).eq('id', cardId).eq('user_id', userId);
  if (error) return { ok: false, status: 502, error: 'Die Änderung konnte momentan nicht übernommen werden. Bitte versuchen Sie es erneut.' };
  await audit(cardId, userId, on ? 'card_freeze' : 'card_unfreeze', { status: card.status }, { status: next }, ipHash);
  return { ok: true, data: { status: next } };
}

// Autorisierung durch den Kartenherausgeber (Webhook). Atomar in der Datenbank; doppelte Anfragen gleicher ID werden nicht doppelt belastet.
export async function authorizeTransaction(input: { cardId: string; amountCents: number; idempotencyKey: string; merchant?: string; category?: string }): Promise<ActionResult> {
  if (!programActive() || !adminConfigured()) return { ok: false, status: 503, error: NOT_ACTIVE_MSG, code: 'NOT_CONFIGURED' };
  const { data, error } = await supabaseAdmin().rpc('lr_card_authorize', { p_card: input.cardId, p_amount: input.amountCents, p_key: input.idempotencyKey, p_merchant: input.merchant ?? null, p_category: input.category ?? null });
  if (error) {
    if (missingTable(error)) return { ok: false, status: 503, error: NOT_ACTIVE_MSG, code: 'NOT_CONFIGURED' };
    const code = /invalid_amount|invalid_idempotency_key/.test(error.message) ? 400 : /card_not_found/.test(error.message) ? 404 : 502;
    return { ok: false, status: code, error: code === 502 ? 'Autorisierung derzeit nicht möglich.' : error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, data: { status: row?.status, transactionId: row?.tx_id, availableAfterCents: row?.available_after_cents } };
}

// ---------- Stripe Issuing: Echtzeit-Freigabe und Folgeereignisse ----------
// Antwortzeit < 2 s (sonst entscheidet Stripe nach den Zeitüberschreitungs-Einstellungen). Bei jedem Fehler: ablehnen.
type StripeAuth = { id: string; card: { id: string; metadata?: Record<string, string> }; pending_request?: { amount: number; currency: string } | null; merchant_data?: { name?: string | null; category?: string | null } };

export async function cardIdForStripe(stripeCardId: string, metaId?: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data } = await db.from('lr_cards').select('id, provider_ref').eq('provider_ref', stripeCardId).maybeSingle();
  if (data) return data.id as string;
  // Metadaten nur als Hinweis – maßgeblich ist die gespeicherte Kartenreferenz.
  if (metaId) { const { data: d2 } = await db.from('lr_cards').select('id, provider_ref').eq('id', metaId).maybeSingle(); if (d2 && d2.provider_ref === stripeCardId) return d2.id as string; }
  return null;
}

export async function decideStripeAuthorization(a: StripeAuth): Promise<{ approved: boolean; reason: string }> {
  const req = a.pending_request;
  if (!req || req.currency?.toLowerCase() !== 'eur' || !(req.amount > 0)) return { approved: false, reason: 'invalid_request' };
  const cardId = await cardIdForStripe(a.card.id, a.card.metadata?.lr_card_id);
  if (!cardId) return { approved: false, reason: 'unknown_card' };
  const r = await authorizeTransaction({ cardId, amountCents: req.amount, idempotencyKey: a.id, merchant: a.merchant_data?.name?.slice(0, 120) || undefined, category: a.merchant_data?.category?.slice(0, 60) || undefined });
  if (!r.ok) return { approved: false, reason: r.code || 'error' };
  const st = (r.data as { status?: string }).status;
  return { approved: st === 'AUTHORIZED', reason: st || 'unknown' };
}

async function txByKey(cardId: string, key: string): Promise<{ id: string; status: string } | null> {
  const { data } = await supabaseAdmin().from('lr_card_transactions').select('id, status').eq('card_id', cardId).eq('idempotency_key', key).maybeSingle();
  return (data as { id: string; status: string } | null) ?? null;
}

// Abschluss (capture), Erstattung (refund) und verfallene/stornierte Freigaben gegen das eigene Limit buchen.
export async function applyStripeIssuingEvent(type: string, obj: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  if (type === 'issuing_transaction.created') {
    const t = obj as { id: string; type: string; amount: number; authorization?: string | null; card: string | { id: string } };
    const stripeCard = typeof t.card === 'string' ? t.card : t.card.id;
    const cardId = await cardIdForStripe(stripeCard); if (!cardId || !t.authorization) return;
    const parent = await txByKey(cardId, t.authorization); if (!parent) return;
    if (t.type === 'capture') { if (parent.status === 'AUTHORIZED') await db.rpc('lr_card_settle', { p_tx: parent.id, p_release: false }); return; }
    if (t.type === 'refund') { await db.rpc('lr_card_refund', { p_tx: parent.id, p_amount: Math.abs(t.amount), p_key: t.id }); return; }
  }
  if (type === 'issuing_authorization.updated' || type === 'issuing_authorization.created') {
    const a = obj as { id: string; status: string; card: { id: string } };
    if (!['reversed', 'expired'].includes(a.status) && !(a.status === 'closed' && (obj as { amount?: number }).amount === 0)) return;
    const cardId = await cardIdForStripe(a.card.id); if (!cardId) return;
    const tx = await txByKey(cardId, a.id);
    if (tx && tx.status === 'AUTHORIZED') await db.rpc('lr_card_settle', { p_tx: tx.id, p_release: true });
  }
  if (type === 'issuing_card.updated') {
    const c = obj as { id: string; status: string };
    const cardId = await cardIdForStripe(c.id); if (!cardId) return;
    const next = c.status === 'canceled' ? 'BLOCKED' : c.status === 'inactive' ? 'FROZEN' : c.status === 'active' ? 'ACTIVE' : null;
    if (next) await db.from('lr_cards').update({ status: next, updated_at: new Date().toISOString() }).eq('id', cardId);
  }
}

// Firmenkarte ausgeben (nur Web-Admin): Karte und Limit anlegen, beim Kartenpartner erzeugen, erst danach aktiv.
export async function issueBusinessCardForMember(input: {
  adminEmail: string; b2bAccountId: string; memberEmail: string; holderName: string; phone?: string;
  address: { line1: string; postalCode: string; city: string }; monthlyLimitCents: number; design: string; stripeAccount?: string | null; ipHash: string | null;
}): Promise<ActionResult> {
  if (!programActive() || !adminConfigured()) return { ok: false, status: 503, error: NOT_ACTIVE_MSG, code: 'NOT_CONFIGURED' };
  if ((process.env.CARD_PROVIDER || '').toLowerCase() !== 'stripe') return { ok: false, status: 503, error: 'Kein Kartenpartner eingerichtet.', code: 'NOT_CONFIGURED' };
  const db = supabaseAdmin();
  const { data: acc } = await db.from('lr_b2b_accounts').select('id, company_name, tax_id, status, verified_at').eq('id', input.b2bAccountId).maybeSingle();
  if (!acc) return { ok: false, status: 404, error: 'Unternehmenskonto nicht gefunden.' };
  if (acc.status !== 'active' || !acc.verified_at) return { ok: false, status: 409, error: 'Firmenkarten nur für aktive, verifizierte Unternehmenskonten.' };
  const { data: members } = await db.from('lr_b2b_members').select('user_id').eq('account_id', acc.id);
  let userId: string | null = null;
  for (const m of members ?? []) {
    const u = await db.auth.admin.getUserById(m.user_id as string);
    if (u.data.user?.email?.toLowerCase() === input.memberEmail.toLowerCase()) { userId = u.data.user.id; break; }
  }
  if (!userId) return { ok: false, status: 404, error: 'Diese E-Mail-Adresse gehört zu keinem Mitglied des Unternehmens.' };
  const chk = limitAllowed('business', input.monthlyLimitCents, 0);
  if (!chk.ok) return { ok: false, status: 400, error: chk.reason };
  const { data: card, error } = await db.from('lr_cards').insert({ user_id: userId, type: 'business', design: input.design, status: 'PENDING', provider: 'stripe', b2b_account_id: acc.id, stripe_account: input.stripeAccount || null }).select('id').single();
  if (error || !card) { if (missingTable(error)) return { ok: false, status: 503, error: 'Die Karten-Tabellen sind noch nicht eingerichtet.', code: 'NOT_CONFIGURED' }; return { ok: false, status: 500, error: 'Karte konnte nicht angelegt werden.' }; }
  const { nextReset } = await import('./limits');
  await db.from('lr_card_limits').insert({ card_id: card.id, monthly_limit_cents: input.monthlyLimitCents, reset_at: nextReset().toISOString() });
  const { issueBusinessCard } = await import('./stripe-issuing');
  const p = await issueBusinessCard({ immoCardId: card.id, b2bAccountId: acc.id, name: input.holderName, email: input.memberEmail, phone: input.phone, companyName: acc.company_name, taxId: acc.tax_id, address: input.address, stripeAccount: input.stripeAccount });
  if (!p.ok) { await db.from('lr_cards').delete().eq('id', card.id); return { ok: false, status: 502, error: p.message, code: p.code }; }
  await db.from('lr_cards').update({ status: 'ACTIVE', provider_ref: p.data.providerRef, cardholder_ref: p.data.cardholderRef, last4: p.data.last4, updated_at: new Date().toISOString() }).eq('id', card.id);
  await db.from('lr_card_audit').insert({ card_id: card.id, user_id: userId, actor: 'admin', action: 'card_issued', new_value: { type: 'business', limit: input.monthlyLimitCents, b2b_account_id: acc.id }, ip_hash: input.ipHash, request_id: randomUUID() });
  return { ok: true, data: { cardId: card.id, last4: p.data.last4 } };
}

// Limit einer Firmenkarte (Web-Admin bzw. später Inhaber des Unternehmenskontos).
export async function setBusinessLimit(cardId: string, b2bAccountId: string, limitCents: number, actor: string, ipHash: string | null): Promise<ActionResult> {
  if (!programActive() || !adminConfigured()) return { ok: false, status: 503, error: NOT_ACTIVE_MSG, code: 'NOT_CONFIGURED' };
  const db = supabaseAdmin();
  const { data: c } = await db.from('lr_cards').select('id, b2b_account_id, type').eq('id', cardId).maybeSingle();
  if (!c || c.b2b_account_id !== b2bAccountId || c.type !== 'business') return { ok: false, status: 404, error: 'Karte nicht gefunden.' };
  const chk = limitAllowed('business', limitCents, 0); if (!chk.ok) return { ok: false, status: 400, error: chk.reason };
  const { data: old } = await db.from('lr_card_limits').select('monthly_limit_cents').eq('card_id', cardId).maybeSingle();
  const { error } = await db.from('lr_card_limits').update({ monthly_limit_cents: limitCents, updated_at: new Date().toISOString() }).eq('card_id', cardId);
  if (error) return { ok: false, status: 502, error: 'Die Änderung konnte momentan nicht übernommen werden.' };
  await db.from('lr_card_audit').insert({ card_id: cardId, actor, action: 'limit_change', old_value: old, new_value: { monthly_limit_cents: limitCents }, ip_hash: ipHash, request_id: randomUUID() });
  return { ok: true };
}
