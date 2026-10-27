import { apiRoute } from '@/lib/api/pipeline';
import { getCase, getValidation } from '@/lib/api/service';
import { publicValidation } from '@/lib/api/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiRoute({ route: '/api/v1/cases/{id}/validations/{validationId}', scope: 'validation:read' }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  await getCase(s, ctx.params.id);
  return { status: 200, body: publicValidation(await getValidation(s, ctx.params.id, ctx.params.validationId)) };
});
