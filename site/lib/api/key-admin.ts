// Key management (shared by /api/v1/api-keys and the Web-Admin).
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api/errors';
import { apiAudit } from '@/lib/api/audit';
import { generateKey, keyState, publicKey, type Env, type KeyRow } from '@/lib/api/keys';
import { validCidr } from '@/lib/api/net';
import type { Scope, TenantApiPolicy } from '@/lib/api/entitlements';

export const MAX_KEYS_PER_TENANT = 25;

export async function createKey(o: {
  tenantId: string; env: Env; name: string; scopes: Scope[]; expiresAt?: string | null; allowedIps?: string[]; createdBy: string;
  policy: TenantApiPolicy; requestId?: string | null; rotatedFrom?: string | null; metadata?: Record<string, unknown>;
}): Promise<{ key: ReturnType<typeof publicKey>; secret: string }> {
  if (!o.policy.enabled) throw new ApiError('API_NOT_ENABLED', 'API access is not enabled for this account.');
  if (o.env === 'live' && !o.policy.live_enabled) throw new ApiError('LIVE_NOT_ENABLED', 'Live keys are not enabled for this account yet.');
  const notAllowed = o.scopes.filter((s) => !o.policy.allowed_scopes.includes(s));
  if (notAllowed.length) throw new ApiError('PLAN_NOT_ENTITLED', `Your plan does not include: ${notAllowed.join(', ')}.`, { errors: notAllowed.map((s) => ({ field: 'scopes', code: 'not_entitled', message: s })) });
  const ips = [...new Set((o.allowedIps ?? []).map((x) => x.trim()).filter(Boolean))];
  const bad = ips.filter((x) => !validCidr(x));
  if (bad.length) throw new ApiError('VALIDATION_ERROR', 'Invalid IP address or CIDR range.', { errors: bad.map((b) => ({ field: 'allowed_ips', code: 'invalid_cidr', message: b.slice(0, 50) })) });
  if (o.expiresAt && new Date(o.expiresAt).getTime() <= Date.now()) throw new ApiError('VALIDATION_ERROR', 'expires_at must be in the future.', { errors: [{ field: 'expires_at', code: 'in_past', message: 'must be in the future' }] });
  const db = supabaseAdmin();
  const { count } = await db.from('api_keys').select('id', { count: 'exact', head: true }).eq('tenant_id', o.tenantId).is('revoked_at', null);
  if ((count ?? 0) >= MAX_KEYS_PER_TENANT) throw new ApiError('CONFLICT', `At most ${MAX_KEYS_PER_TENANT} active keys per account. Revoke unused keys first.`);
  const g = generateKey(o.env);
  const { data, error } = await db.from('api_keys').insert({
    tenant_id: o.tenantId, environment: o.env, name: o.name, key_prefix: g.prefix, key_hash: g.hash, scopes: [...new Set(o.scopes)], allowed_ips: ips,
    metadata: o.metadata ?? {}, created_by: o.createdBy.slice(0, 120), expires_at: o.expiresAt ?? null, rotated_from: o.rotatedFrom ?? null,
  }).select('*').single();
  if (error || !data) throw new ApiError('SERVICE_UNAVAILABLE', 'Key could not be created.');
  await apiAudit({ tenantId: o.tenantId, environment: o.env, actor: o.createdBy, action: o.rotatedFrom ? 'api_key.rotated' : 'api_key.created', resourceType: 'api_key', resourceId: data.id, requestId: o.requestId, meta: { prefix: g.prefix, scopes: data.scopes, rotated_from: o.rotatedFrom ?? null } });
  return { key: publicKey(data as KeyRow), secret: g.secret };
}

export async function loadKey(tenantId: string, id: string): Promise<KeyRow> {
  const { data } = await supabaseAdmin().from('api_keys').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (!data) throw new ApiError('RESOURCE_NOT_FOUND', 'API key not found.');
  return data as KeyRow;
}

// Rotation: new key with the same properties, the old key is revoked immediately.
export async function rotateKey(o: { tenantId: string; id: string; actor: string; policy: TenantApiPolicy; requestId?: string | null }) {
  const old = await loadKey(o.tenantId, o.id);
  if (keyState(old) === 'revoked') throw new ApiError('CONFLICT', 'A revoked key cannot be rotated.');
  const scopes = old.scopes.filter((s) => o.policy.allowed_scopes.includes(s as Scope)) as Scope[];
  if (!scopes.length) throw new ApiError('PLAN_NOT_ENTITLED', 'None of the key scopes is included in the current plan.');
  const created = await createKey({
    tenantId: o.tenantId, env: old.environment, name: old.name, scopes, allowedIps: old.allowed_ips,
    expiresAt: old.expires_at && new Date(old.expires_at).getTime() > Date.now() ? old.expires_at : null, createdBy: o.actor, policy: o.policy,
    requestId: o.requestId, rotatedFrom: old.id, metadata: old.metadata,
  });
  await supabaseAdmin().from('api_keys').update({ revoked_at: new Date().toISOString(), revoked_reason: 'rotated' }).eq('id', old.id).eq('tenant_id', o.tenantId);
  return created;
}

export async function setKeyState(o: { tenantId: string; id: string; actor: string; action: 'revoke' | 'disable' | 'enable' | 'expire'; reason?: string; requestId?: string | null }) {
  const k = await loadKey(o.tenantId, o.id);
  if (k.revoked_at) throw new ApiError('CONFLICT', 'The key is already revoked.');
  const now = new Date().toISOString();
  const up = o.action === 'revoke' ? { revoked_at: now, revoked_reason: (o.reason || 'revoked').slice(0, 200) }
    : o.action === 'disable' ? { disabled_at: now } : o.action === 'enable' ? { disabled_at: null } : { expires_at: now };
  const { data } = await supabaseAdmin().from('api_keys').update(up).eq('id', k.id).eq('tenant_id', o.tenantId).select('*').single();
  const action = ({ revoke: 'api_key.revoked', disable: 'api_key.disabled', enable: 'api_key.enabled', expire: 'api_key.expired' } as const)[o.action];
  await apiAudit({ tenantId: o.tenantId, environment: k.environment, actor: o.actor, action, resourceType: 'api_key', resourceId: k.id, requestId: o.requestId, meta: { prefix: k.key_prefix } });
  return publicKey((data ?? k) as KeyRow);
}
