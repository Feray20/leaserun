import { createHash, randomBytes } from 'node:crypto';
import PRICES from '@/public/data/preise.json';
import { supabaseAdmin } from '@/lib/supabase/admin';

// B2B-Konten (Makler, Vermittler, Banken): Tarif-Grenzen, Kontozugriff und Hilfsfunktionen.

export type Tier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type InstitutionType = 'BANK' | 'BROKER' | 'REALTOR' | 'OTHER';

// Geschäftsfunktionen (Kreditmappen-Kontingent, Partnerseite/Widget, Anfragen, Tarifbuchung) erst nach geprüftem
// Gewerbenachweis (Freischaltung durch ImmoAdv im Admin-Bereich).
export const isVerified = (a: { verified_at?: string | null } | null | undefined): boolean => Boolean(a?.verified_at);
export const VERIFY_MSG = 'Ihr Unternehmenskonto ist noch nicht freigeschaltet. Bitte laden Sie im Portal unter „Verifizierung“ Ihren Gewerbenachweis hoch – nach der Prüfung schalten wir alle Funktionen frei.';

export type B2BAccount = {
  id: string;
  owner_id: string;
  customer_number: string;
  company_name: string;
  legal_form: string;
  institution_type: InstitutionType;
  register_number: string | null;
  tax_id: string | null;
  advisor_name: string;
  email: string;
  phone: string | null;
  street: string | null;
  postal_code: string;
  city: string;
  plan_tier: Tier | null;
  plan_source: 'stripe' | 'manual' | null;
  plan_until: string | null;
  billing_interval: 'month' | 'year' | null;
  status: 'pending' | 'active' | 'locked';
  lock_reason: string | null;
  verified_at: string | null;
  verification_status?: 'offen' | 'eingereicht' | 'geprueft' | 'abgelehnt';
  verification_note?: string | null;
  verification_submitted_at?: string | null;
  verification_decided_at?: string | null;
  dossier_bonus: number;
  has_whitelabel: boolean;
  allow_invoice_payment: boolean;
  invoice_limit_cents: number | null;
  payment_terms_days: number;
  unternehmer_confirmed_at: string;
  avv_accepted_at: string | null;
  avv_version: string | null;
  referral: string | null;
  logo_path: string | null;
  brand_color: string | null;
  brand_color2?: string | null;
  brand_font?: string | null;
  doc_title?: string | null;
  doc_sender?: string | null;
  doc_footer?: string | null;
  booking_url: string | null;
  slug: string | null;
  widget_key: string | null;
  widget_active: boolean;
  allowed_domains: string[];
  lead_gate: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  support_access_until?: string | null;
  accept_submissions?: boolean;
  custom_disclaimer?: string | null;
  lead_retention_months?: number;
  webhook_url?: string | null;
  webhook_secret?: string | null;
  created_at: string;
};

// fall = Fall-Analysen (Unterlagen-Paket eines Kunden), praes = Kunden-Präsentationen je Kalendermonat (null = unbegrenzt).
// whitelabel = Unterlagen komplett im eigenen Erscheinungsbild (ohne ImmoAdv); radar = Bestandskunden-Radar.
export const TIER_LIMITS: Record<Tier, { seats: number; dossiersPerMonth: number | null; cobranding: boolean; merger: boolean; landing: boolean; fall: number | null; praes: number | null; whitelabel: boolean; radar: boolean }> = {
  BASIC: { seats: 1, dossiersPerMonth: 20, cobranding: false, merger: false, landing: false, fall: 10, praes: 3, whitelabel: false, radar: false },
  PRO: { seats: 3, dossiersPerMonth: null, cobranding: true, merger: true, landing: true, fall: 100, praes: null, whitelabel: false, radar: true },
  ENTERPRISE: { seats: 10, dossiersPerMonth: null, cobranding: true, merger: true, landing: true, fall: null, praes: null, whitelabel: true, radar: true },
};
// Ohne gebuchten Tarif (nach Freischaltung): zum Ausprobieren je Monat.
export const TRIAL_LIMITS = { fall: 2, praes: 1 };

export const AVV_VERSION = '2026-10';

type B2BPlanJson = { id: string; tier: Tier; name: string; netto_cents: number; intervall: string; interval: 'month' | 'year' };
export const B2B_PLANS: B2BPlanJson[] = (PRICES as unknown as { b2b: { plans: B2BPlanJson[] } }).b2b.plans;
export const isB2BPlan = (v: unknown): v is string => typeof v === 'string' && B2B_PLANS.some((p) => p.id === v);

// Wirksamer Tarif: nur bei aktivem, nicht gesperrtem Konto und nicht abgelaufener Laufzeit.
export function effectiveTier(a: Pick<B2BAccount, 'status' | 'plan_tier' | 'plan_until'> | null): Tier | null {
  if (!a || a.status !== 'active' || !a.plan_tier) return null;
  if (a.plan_until && new Date(a.plan_until).getTime() < Date.now()) return null;
  return a.plan_tier;
}

export function canCobrand(a: B2BAccount): boolean {
  const t = effectiveTier(a);
  return Boolean(a.has_whitelabel || (t && TIER_LIMITS[t].cobranding));
}

export async function membershipFor(userId: string): Promise<{ account: B2BAccount; role: 'owner' | 'advisor' } | null> {
  const db = supabaseAdmin();
  const { data: m } = await db.from('immo_b2b_members').select('account_id, role').eq('user_id', userId).maybeSingle();
  if (!m) return null;
  const { data: a } = await db.from('immo_b2b_accounts').select('*').eq('id', m.account_id).maybeSingle();
  if (!a) return null;
  return { account: a as B2BAccount, role: m.role as 'owner' | 'advisor' };
}

// Objekte, für die das Konto im laufenden Kalendermonat (UTC) Kreditmappen erstellt hat.
// Erneutes Erstellen für dasselbe Objekt (Korrekturen) zählt nicht doppelt.
export async function dossierObjectsThisMonth(accountId: string): Promise<Set<string>> {
  const now = new Date();
  // Monatsbeginn in deutscher Zeit (1. des Monats, 00:00 MEZ/MESZ).
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).format(now);
  const noon = new Date(`${ym}-01T12:00:00Z`);
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(noon));
  const start = new Date(`${ym}-01T00:00:00+0${h - 12}:00`).toISOString();
  const { data } = await supabaseAdmin()
    .from('immo_kreditmappe_versions')
    .select('owner_id, object_ref')
    .eq('b2b_account_id', accountId)
    .gte('created_at', start)
    .limit(5000);
  return new Set((data ?? []).map((r) => `${r.owner_id}:${r.object_ref}`));
}
export const dossiersThisMonth = async (accountId: string) => (await dossierObjectsThisMonth(accountId)).size;

export type DossierAllowance = { allowed: boolean; accountId: string | null; reason?: string; used?: number; limit?: number | null };

// Prüft, ob ein B2B-Mitglied eine Kreditmappe erstellen darf. Null = kein B2B-Tarif, es gelten die Privat-Regeln.
export async function b2bDossierAllowance(userId: string, objectRef?: string): Promise<DossierAllowance | null> {
  const m = await membershipFor(userId);
  if (!m) return null;
  const a = m.account;
  if (a.status === 'locked') return { allowed: false, accountId: a.id, reason: 'Das Unternehmenskonto ist gesperrt.' };
  if (!isVerified(a)) return { allowed: false, accountId: a.id, reason: VERIFY_MSG };
  const tier = effectiveTier(a);
  if (!tier) return null;
  const limit = TIER_LIMITS[tier].dossiersPerMonth;
  if (limit === null) return { allowed: true, accountId: a.id, limit: null };
  const used = await dossierObjectsThisMonth(a.id);
  const total = limit + (a.dossier_bonus || 0);
  if (objectRef && used.has(`${userId}:${objectRef}`)) return { allowed: true, accountId: a.id, used: used.size, limit: total };
  if (used.size >= total) return { allowed: false, accountId: a.id, used: used.size, limit: total, reason: `Monatskontingent erreicht (${used.size} von ${total} Kreditmappen).` };
  return { allowed: true, accountId: a.id, used: used.size, limit: total };
}

export const newWidgetKey = () => 'wk_' + randomBytes(18).toString('base64url');
export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(`immoadv-invite:${t}`).digest('hex');

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export const INSTITUTION_LABEL: Record<InstitutionType, string> = {
  BANK: 'Kreditinstitut', BROKER: 'Finanzierungsvermittler', REALTOR: 'Immobilienmakler', OTHER: 'Sonstiges Unternehmen',
};

// Öffentliche Sicht eines Partners (keine Steuer- oder Registerdaten).
export function publicPartner(a: B2BAccount) {
  const tier = effectiveTier(a);
  const brand = canCobrand(a);
  return {
    slug: a.slug,
    name: a.company_name,
    kind: INSTITUTION_LABEL[a.institution_type],
    advisor: tier && TIER_LIMITS[tier].landing ? a.advisor_name : null,
    city: a.city,
    color: brand ? a.brand_color : null,
    logo: brand && a.logo_path ? `/api/b2b/logo?slug=${encodeURIComponent(a.slug || '')}` : null,
    booking: tier && TIER_LIMITS[tier].landing ? a.booking_url : null,
    leadGate: a.lead_gate,
    verified: Boolean(a.verified_at),
    disclaimer: (tier === 'ENTERPRISE' || a.has_whitelabel) && a.custom_disclaimer ? a.custom_disclaimer : null,
  };
}

// Protokoll: Personen-Kennungen (E-Mail) werden vor dem Speichern pseudonymisiert (siehe lib/security/pseudo.ts).
export async function adminAudit(actor: string, action: string, target: string | null, meta: Record<string, unknown> = {}) {
  const { pseudo, scrubMeta } = await import('@/lib/security/pseudo');
  const [a, t, m] = await Promise.all([pseudo(actor).catch(() => 'ps:unbekannt'), target && target.includes('@') ? pseudo(target).catch(() => 'ps:unbekannt') : Promise.resolve(target), scrubMeta(meta).catch(() => ({}))]);
  await supabaseAdmin().from('immo_admin_audit').insert({ actor_email: a, action, target: t, meta: m });
}
