import { apiRoute } from '@/lib/api/pipeline';
import { getCase, runValidation } from '@/lib/api/service';
import { publicValidation } from '@/lib/api/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/cases/{id}/validate – führt die Vorprüfung sofort aus und liefert das Ergebnis (synchron).
export const GET = apiRoute({ route: '/api/v1/cases/{id}/validate', scope: 'validation:execute' }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  const v = await runValidation(s, await getCase(s, ctx.params.id));
  return { status: 200, body: publicValidation(v) };
});
