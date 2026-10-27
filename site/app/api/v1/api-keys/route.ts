import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute } from '@/lib/api/pipeline';
import { ApiError, zodErrors } from '@/lib/api/errors';
import { KeyInput } from '@/lib/api/schemas';
import { createKey } from '@/lib/api/key-admin';
import { publicKey, type KeyRow } from '@/lib/api/keys';
import { cursorFilter, pageOf, pageParams } from '@/lib/api/pagination';
import type { Scope } from '@/lib/api/entitlements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/api-keys – Schlüssel der eigenen Umgebung (nur Präfix, nie das Geheimnis)
export const GET = apiRoute({ route: '/api/v1/api-keys', scope: 'api_keys:read' }, async (ctx) => {
  const { limit, cursor } = pageParams(ctx.url);
  let q = supabaseAdmin().from('api_keys').select('*').eq('tenant_id', ctx.tenantId).eq('environment', ctx.env)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (cursor) q = q.or(cursorFilter(cursor));
  const { data, error } = await q;
  if (error) throw new ApiError('SERVICE_UNAVAILABLE');
  const page = pageOf((data ?? []) as KeyRow[], limit, (r) => r.created_at);
  return { status: 200, body: { object: 'list', data: page.data.map(publicKey), pagination: page.pagination } };
});

// POST /api/v1/api-keys – neuer Schlüssel in derselben Umgebung; Scopes höchstens die des aufrufenden Schlüssels.
export const POST = apiRoute({ route: '/api/v1/api-keys', scope: 'api_keys:write', idempotent: true }, async (ctx) => {
  const p = KeyInput.safeParse(ctx.body ?? {});
  if (!p.success) throw new ApiError('VALIDATION_ERROR', 'The request contains invalid data.', { errors: zodErrors(p.error.issues) });
  if (p.data.environment && p.data.environment !== ctx.env) throw new ApiError('INSUFFICIENT_SCOPE', 'A key can only create keys for its own environment.');
  const beyond = p.data.scopes.filter((s) => !ctx.key.scopes.includes(s));
  if (beyond.length) throw new ApiError('INSUFFICIENT_SCOPE', `Cannot grant scopes the calling key does not have: ${beyond.join(', ')}.`);
  const r = await createKey({ tenantId: ctx.tenantId, env: ctx.env, name: p.data.name, scopes: p.data.scopes as Scope[], expiresAt: p.data.expires_at ?? null, allowedIps: p.data.allowed_ips, createdBy: ctx.actor, policy: ctx.policy, requestId: ctx.requestId });
  return { status: 201, body: { ...r.key, secret: r.secret, secret_notice: 'Store this key now – it will not be shown again.' } };
});
