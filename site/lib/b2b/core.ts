import { createHash, randomBytes } from 'node:crypto';
import PRICES from '@/public/data/preise.json';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Business accounts (agents, mortgage brokers, lenders): plan limits, account access and helpers.

export type Tier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type InstitutionType = 'BANK' | 'BROKER' | 'REALTOR' | 'ADVISOR' | 'OTHER';

// Business features (lender package allowance, partner page/widget, leads, plan purchase) unlock only after the
// business verification documents have been reviewed (approval by LeaseRun in the Web-Admin).
export const isVerified = (a: { verified_at?: string | null } | null | undefined): boolean => Boolean(a?.verified_at);
export const VERIFY_MSG = 'Your business account is not verified yet. Please upload your business verification (license or registration) in the portal under "Verification" – once we have reviewed it, all features are unlocked.';

export type B2BAccount = {
  id: string;
  owner_id: string;
  customer_number: string;
  company_name: string;
  legal_form: string;
  institution_type: InstitutionType;
  branche?: string | null;
  extra_branches?: string[] | null;
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
  modules?: ModuleOverrides | null;
  created_at: string;
};

// fall = client analyses (quick check of a document package), praes = client presentations per calendar month (null = unlimited).
// clients = maximum number of active (connected or invited) clients; null = unlimited.
// Fair use: quick checks and leads are unlimited on every plan; only finished PDF exports (lender packages, presentations) are capped.
// whitelabel = documents fully in the partner's own branding (no LeaseRun); radar = client radar (rate/ARM reset dates).
export const TIER_LIMITS: Record<Tier, { seats: number; clients: number | null; dossiersPerMonth: number | null; cobranding: boolean; merger: boolean; landing: boolean; fall: number | null; praes: number | null; whitelabel: boolean; radar: boolean }> = {
  BASIC: { seats: 1, clients: 25, dossiersPerMonth: 20, cobranding: false, merger: false, landing: false, fall: null, praes: 3, whitelabel: false, radar: false },
  PRO: { seats: 3, clients: null, dossiersPerMonth: null, cobranding: true, merger: true, landing: true, fall: null, praes: null, whitelabel: false, radar: true },
  ENTERPRISE: { seats: 10, clients: null, dossiersPerMonth: null, cobranding: true, merger: true, landing: true, fall: null, praes: null, whitelabel: true, radar: true },
};
// Modules LeaseRun can additionally enable ("on") or disable ("off") per business account in the Web-Admin.
// Without an entry the purchased plan applies. Only the Web-Admin changes these values (column lr_b2b_accounts.modules).
export const MODULES = {
  schnellrechner: 'Quick calculator & client analyses',
  kreditmappe: 'Lender Package',
  stresstest: 'Stress test generator',
  whitelabel: 'White-label export',
  crm: 'CRM & client management',
} as const;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];
export type ModuleOverrides = Partial<Record<ModuleKey, 'on' | 'off'>>;
export function moduleOverrides(a: { modules?: unknown } | null | undefined): ModuleOverrides {
  const m = (a?.modules && typeof a.modules === 'object' ? a.modules : {}) as Record<string, unknown>;
  const out: ModuleOverrides = {};
  for (const k of MODULE_KEYS) if (m[k] === 'on' || m[k] === 'off') out[k] = m[k] as 'on' | 'off';
  return out;
}
export const moduleState = (a: { modules?: unknown } | null | undefined, k: ModuleKey): 'on' | 'off' | null => moduleOverrides(a)[k] ?? null;

// Without a purchased plan (after verification): trial allowance per month.
export const TRIAL_LIMITS = { fall: 2, praes: 1 };

export const AVV_VERSION = '2026-10-US';

// Time zone for monthly allowances and business billing periods.
export const BILLING_TZ = 'America/New_York';

type B2BPlanJson = { id: string; tier: Tier; name: string; netto_cents: number; intervall: string; interval: 'month' | 'year' };
export const B2B_PLANS: B2BPlanJson[] = (PRICES as unknown as { b2b: { plans: B2BPlanJson[] } }).b2b.plans;
export const isB2BPlan = (v: unknown): v is string => typeof v === 'string' && B2B_PLANS.some((p) => p.id === v);

// Effective plan: only for an active, unlocked account whose term has not expired.
export function effectiveTier(a: Pick<B2BAccount, 'status' | 'plan_tier' | 'plan_until'> | null): Tier | null {
  if (!a || a.status !== 'active' || !a.plan_tier) return null;
  if (a.plan_until && new Date(a.plan_until).getTime() < Date.now()) return null;
  return a.plan_tier;
}

export function canCobrand(a: B2BAccount): boolean {
  const wl = moduleState(a, 'whitelabel');
  if (wl) return wl === 'on';
  const t = effectiveTier(a);
  return Boolean(a.has_whitelabel || (t && TIER_LIMITS[t].cobranding));
}

export async function membershipFor(userId: string): Promise<{ account: B2BAccount; role: 'owner' | 'advisor' } | null> {
  const db = supabaseAdmin();
  const { data: m } = await db.from('lr_b2b_members').select('account_id, role').eq('user_id', userId).maybeSingle();
  if (!m) return null;
  const { data: a } = await db.from('lr_b2b_accounts').select('*').eq('id', m.account_id).maybeSingle();
  if (!a) return null;
  return { account: a as B2BAccount, role: m.role as 'owner' | 'advisor' };
}

// Properties for which the account created lender packages in the current calendar month (US Eastern time).
// Re-creating a package for the same property (corrections) does not count twice.
export async function dossierObjectsThisMonth(accountId: string): Promise<Set<string>> {
  const now = new Date();
  // Start of the month in US Eastern time (1st of the month, 00:00 EST/EDT).
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: BILLING_TZ, year: 'numeric', month: '2-digit' }).format(now);
  const noon = new Date(`${ym}-01T12:00:00Z`);
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: BILLING_TZ, hour: '2-digit', hour12: false }).format(noon));
  const start = new Date(new Date(`${ym}-01T00:00:00Z`).getTime() - (h - 12) * 3600_000).toISOString();
  const { data } = await supabaseAdmin()
    .from('lr_kreditmappe_versions')
    .select('owner_id, object_ref')
    .eq('b2b_account_id', accountId)
    .gte('created_at', start)
    .limit(5000);
  return new Set((data ?? []).map((r) => `${r.owner_id}:${r.object_ref}`));
}
export const dossiersThisMonth = async (accountId: string) => (await dossierObjectsThisMonth(accountId)).size;

export type DossierAllowance = { allowed: boolean; accountId: string | null; reason?: string; used?: number; limit?: number | null };

// Checks whether a business member may create a lender package. Null = no business plan, consumer rules apply.
export async function b2bDossierAllowance(userId: string, objectRef?: string): Promise<DossierAllowance | null> {
  const m = await membershipFor(userId);
  if (!m) return null;
  const a = m.account;
  if (a.status === 'locked') return { allowed: false, accountId: a.id, reason: 'This business account is locked.' };
  if (!isVerified(a)) return { allowed: false, accountId: a.id, reason: VERIFY_MSG };
  const km = moduleState(a, 'kreditmappe');
  if (km === 'off') return { allowed: false, accountId: a.id, reason: 'The Lender Package is not enabled for your business account. Please contact support@leaserun.com.' };
  if (km === 'on') return { allowed: true, accountId: a.id, limit: null };
  const tier = effectiveTier(a);
  if (!tier) return null;
  const limit = TIER_LIMITS[tier].dossiersPerMonth;
  if (limit === null) return { allowed: true, accountId: a.id, limit: null };
  const used = await dossierObjectsThisMonth(a.id);
  const total = limit + (a.dossier_bonus || 0);
  if (objectRef && used.has(`${userId}:${objectRef}`)) return { allowed: true, accountId: a.id, used: used.size, limit: total };
  if (used.size >= total) return { allowed: false, accountId: a.id, used: used.size, limit: total, reason: `Monthly allowance reached (${used.size} of ${total} lender packages).` };
  return { allowed: true, accountId: a.id, used: used.size, limit: total };
}

export const newWidgetKey = () => 'wk_' + randomBytes(18).toString('base64url');
export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(`leaserun-invite:${t}`).digest('hex');

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export const INSTITUTION_LABEL: Record<InstitutionType, string> = {
  BANK: 'Lender, bank or credit union', BROKER: 'Mortgage broker / loan officer', REALTOR: 'Real estate agent / brokerage', ADVISOR: 'CPA / financial advisor', OTHER: 'Property manager / other firm',
};

// Public view of a partner (no tax or license data).
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

// Audit log: personal identifiers (email) are pseudonymized before storage (see lib/security/pseudo.ts).
export async function adminAudit(actor: string, action: string, target: string | null, meta: Record<string, unknown> = {}) {
  const { pseudo, scrubMeta } = await import('@/lib/security/pseudo');
  const [a, t, m] = await Promise.all([pseudo(actor).catch(() => 'ps:unknown'), target && target.includes('@') ? pseudo(target).catch(() => 'ps:unknown') : Promise.resolve(target), scrubMeta(meta).catch(() => ({}))]);
  await supabaseAdmin().from('lr_admin_audit').insert({ actor_email: a, action, target: t, meta: m });
}
