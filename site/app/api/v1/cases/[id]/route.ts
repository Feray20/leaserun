import { apiRoute, type ApiCtx } from '@/lib/api/pipeline';
import { ApiError, zodErrors } from '@/lib/api/errors';
import { CaseInput, mergeCase, type CaseData } from '@/lib/api/schemas';
import { deleteCase, getCase, updateCase } from '@/lib/api/service';
import { publicCase } from '@/lib/api/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scope = (ctx: ApiCtx) => ({ tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId });

export const GET = apiRoute({ route: '/api/v1/cases/{id}', scope: 'cases:read' }, async (ctx) => {
  return { status: 200, body: publicCase(await getCase(scope(ctx), ctx.params.id)) };
});

// PATCH: partial update (deep-merged; null removes a field).
export const PATCH = apiRoute({ route: '/api/v1/cases/{id}', scope: 'cases:write' }, async (ctx) => {
  if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw new ApiError('VALIDATION_ERROR', 'Send a JSON object with the fields to change.');
  const c = await getCase(scope(ctx), ctx.params.id);
  const current: CaseData = { ...c.data, ...(c.external_reference ? { external_reference: c.external_reference } : {}), ...(Object.keys(c.metadata ?? {}).length ? { metadata: Object.fromEntries(Object.entries(c.metadata).filter(([k]) => k !== 'test')) as CaseData['metadata'] } : {}) };
  const p = CaseInput.safeParse(mergeCase(current, ctx.body as Record<string, unknown>));
  if (!p.success) throw new ApiError('VALIDATION_ERROR', 'The request contains invalid data.', { errors: zodErrors(p.error.issues) });
  return { status: 200, body: publicCase(await updateCase(scope(ctx), c, p.data)) };
});

export const DELETE = apiRoute({ route: '/api/v1/cases/{id}', scope: 'cases:write' }, async (ctx) => {
  const c = await getCase(scope(ctx), ctx.params.id);
  await deleteCase(scope(ctx), c);
  return new Response(null, { status: 204 });
});
