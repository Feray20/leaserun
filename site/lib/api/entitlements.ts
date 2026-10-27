// Central server-side plan and access logic of the API. Only here is it decided what a tenant may do.
// Basis: effective plan (effectiveTier), enablement in the Web-Admin (api_tenant_policies) and module overrides.
import { effectiveTier, type B2BAccount, type Tier } from '@/lib/b2b/core';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const SCOPES = [
  'cases:read', 'cases:write',
  'validation:read', 'validation:execute',
  'documents:read', 'documents:write',
  'reports:read', 'reports:create',
  'webhooks:read', 'webhooks:write', 'webhooks:test',
  'usage:read',
  'api_keys:read', 'api_keys:write',
] as const;
export type Scope = (typeof SCOPES)[number];
export const isScope = (s: unknown): s is Scope => typeof s === 'string' && (SCOPES as readonly string[]).includes(s);

export const FEATURES = [
  'api.access', 'api.validation', 'api.documents', 'api.reports', 'api.webhooks',
  'api.white_label', 'api.routing', 'api.advanced_usage', 'api.playground', 'api.sandbox',
] as const;
export type Feature = (typeof FEATURES)[number];

// Welcher Scope welche Tariffunktion voraussetzt.
export const SCOPE_FEATURE: Record<Scope, Feature> = {
  'cases:read': 'api.access', 'cases:write': 'api.access',
  'validation:read': 'api.validation', 'validation:execute': 'api.validation',
  'documents:read': 'api.documents', 'documents:write': 'api.documents',
  'reports:read': 'api.reports', 'reports:create': 'api.reports',
  'webhooks:read': 'api.webhooks', 'webhooks:write': 'api.webhooks', 'webhooks:test': 'api.webhooks',
  'usage:read': 'api.access',
  'api_keys:read': 'api.access', 'api_keys:write': 'api.access',
};

// Plan matrix (see preise.json "REST API v1"): Basic without API, Pro standard API, Enterprise full.
const PLAN: Record<Tier, { features: Feature[]; rateLimit: number; maxDocumentBytes: number }> = {
  BASIC: { features: [], rateLimit: 0, maxDocumentBytes: 0 },
  PRO: { features: ['api.access', 'api.validation', 'api.documents', 'api.reports', 'api.playground', 'api.sandbox'], rateLimit: 60, maxDocumentBytes: 4 * 1024 * 1024 },
  ENTERPRISE: { features: [...FEATURES], rateLimit: 300, maxDocumentBytes: 4 * 1024 * 1024 },
};

export type PolicyRow = {
  tenant_id: string; enabled: boolean; live_enabled: boolean; rate_limit: number | null; burst_limit: number | null;
  max_document_bytes: number | null; webhooks_allowed: boolean | null; white_label_allowed: boolean | null; routing_enabled: boolean;
  note?: string | null; updated_at?: string; updated_by?: string | null;
};

export type TenantApiPolicy = {
  tenant_id: string;
  enabled: boolean;            // API nutzbar (Tarif + Admin-Freischaltung + Konto aktiv)
  admin_enabled: boolean;      // Schalter im Web-Admin
  live_enabled: boolean;
  plan: Tier | null;
  plan_includes_api: boolean;
  rate_limit: number;          // Anfragen pro Minute
  burst_limit: number;         // Anfragen pro 10 Sekunden
  max_document_size: number;   // Byte
  allowed_scopes: Scope[];
  features: Feature[];
  webhook_enabled: boolean;
  white_label_enabled: boolean;
  routing_enabled: boolean;
  sandbox_enabled: boolean;
  reason: 'OK' | 'PLAN' | 'NOT_ENABLED' | 'LOCKED';
};

// Pure calculation (testable): account + admin policy → effective API policy.
export function computePolicy(account: Pick<B2BAccount, 'id' | 'status' | 'plan_tier' | 'plan_until' | 'has_whitelabel'>, row: PolicyRow | null): TenantApiPolicy {
  const plan = effectiveTier(account as B2BAccount);
  const base = plan ? PLAN[plan] : PLAN.BASIC;
  const planIncludes = base.features.includes('api.access');
  const features = new Set<Feature>(base.features);
  // Admin overrides can only add or block webhooks/white label within an API plan.
  if (planIncludes && row?.webhooks_allowed === true) features.add('api.webhooks');
  if (row?.webhooks_allowed === false) features.delete('api.webhooks');
  if (planIncludes && (row?.white_label_allowed === true || account.has_whitelabel)) features.add('api.white_label');
  if (row?.white_label_allowed === false) features.delete('api.white_label');
  if (planIncludes && row?.routing_enabled) features.add('api.routing');
  const locked = account.status === 'locked';
  const adminEnabled = Boolean(row?.enabled);
  const enabled = planIncludes && adminEnabled && !locked;
  const rate = Math.max(1, row?.rate_limit ?? base.rateLimit ?? 60);
  const allowed = enabled ? SCOPES.filter((s) => features.has(SCOPE_FEATURE[s])) : [];
  return {
    tenant_id: account.id,
    enabled,
    admin_enabled: adminEnabled,
    live_enabled: enabled && Boolean(row?.live_enabled),
    plan,
    plan_includes_api: planIncludes,
    rate_limit: rate,
    burst_limit: Math.max(1, row?.burst_limit ?? Math.max(10, Math.ceil(rate / 3))),
    max_document_size: Math.min(4 * 1024 * 1024, row?.max_document_bytes ?? (base.maxDocumentBytes || 4 * 1024 * 1024)),
    allowed_scopes: allowed,
    features: enabled ? [...features] : [],
    webhook_enabled: enabled && features.has('api.webhooks'),
    white_label_enabled: enabled && features.has('api.white_label'),
    routing_enabled: enabled && features.has('api.routing'),
    sandbox_enabled: enabled && features.has('api.sandbox'),
    reason: locked ? 'LOCKED' : !planIncludes ? 'PLAN' : !adminEnabled ? 'NOT_ENABLED' : 'OK',
  };
}

export async function loadTenant(tenantId: string): Promise<{ account: B2BAccount; row: PolicyRow | null } | null> {
  const db = supabaseAdmin();
  const [{ data: account }, { data: row }] = await Promise.all([
    db.from('lr_b2b_accounts').select('*').eq('id', tenantId).maybeSingle(),
    db.from('api_tenant_policies').select('*').eq('tenant_id', tenantId).maybeSingle(),
  ]);
  if (!account) return null;
  return { account: account as B2BAccount, row: (row as PolicyRow | null) ?? null };
}

export async function getTenantApiPolicy(tenantId: string): Promise<TenantApiPolicy | null> {
  const t = await loadTenant(tenantId);
  return t ? computePolicy(t.account, t.row) : null;
}

export async function hasEntitlement(tenantId: string, feature: Feature): Promise<boolean> {
  const p = await getTenantApiPolicy(tenantId);
  return Boolean(p?.enabled && p.features.includes(feature));
}
