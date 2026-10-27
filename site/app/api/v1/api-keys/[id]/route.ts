import { apiRoute } from '@/lib/api/pipeline';
import { ApiError } from '@/lib/api/errors';
import { loadKey } from '@/lib/api/key-admin';
import { publicKey } from '@/lib/api/keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiRoute({ route: '/api/v1/api-keys/{id}', scope: 'api_keys:read' }, async (ctx) => {
  const k = await loadKey(ctx.tenantId, ctx.params.id);
  if (k.environment !== ctx.env) throw new ApiError('RESOURCE_NOT_FOUND', 'API key not found.');
  return { status: 200, body: publicKey(k) };
});
