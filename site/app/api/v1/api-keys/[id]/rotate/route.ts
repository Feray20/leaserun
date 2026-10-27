import { apiRoute } from '@/lib/api/pipeline';
import { ApiError } from '@/lib/api/errors';
import { loadKey, rotateKey } from '@/lib/api/key-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Rotation: returns the new key once; the old one is invalid immediately.
export const POST = apiRoute({ route: '/api/v1/api-keys/{id}/rotate', scope: 'api_keys:write', idempotent: true }, async (ctx) => {
  const k = await loadKey(ctx.tenantId, ctx.params.id);
  if (k.environment !== ctx.env) throw new ApiError('RESOURCE_NOT_FOUND', 'API key not found.');
  if (k.scopes.some((s) => !ctx.key.scopes.includes(s))) throw new ApiError('INSUFFICIENT_SCOPE', 'The calling key must have all scopes of the key it rotates.');
  const r = await rotateKey({ tenantId: ctx.tenantId, id: k.id, actor: ctx.actor, policy: ctx.policy, requestId: ctx.requestId });
  return { status: 201, body: { ...r.key, secret: r.secret, rotated_from: k.id, secret_notice: 'Store this key now – the previous key has been revoked.' } };
});
