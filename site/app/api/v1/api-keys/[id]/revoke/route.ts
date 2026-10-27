import { apiRoute } from '@/lib/api/pipeline';
import { ApiError } from '@/lib/api/errors';
import { loadKey, setKeyState } from '@/lib/api/key-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = apiRoute({ route: '/api/v1/api-keys/{id}/revoke', scope: 'api_keys:write' }, async (ctx) => {
  const k = await loadKey(ctx.tenantId, ctx.params.id);
  if (k.environment !== ctx.env) throw new ApiError('RESOURCE_NOT_FOUND', 'API key not found.');
  const reason = ctx.body && typeof ctx.body === 'object' && typeof (ctx.body as { reason?: unknown }).reason === 'string' ? (ctx.body as { reason: string }).reason : undefined;
  return { status: 200, body: await setKeyState({ tenantId: ctx.tenantId, id: k.id, actor: ctx.actor, action: 'revoke', reason, requestId: ctx.requestId }) };
});
