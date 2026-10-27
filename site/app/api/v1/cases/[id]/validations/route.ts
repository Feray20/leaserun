import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute } from '@/lib/api/pipeline';
import { ApiError } from '@/lib/api/errors';
import { getCase, runValidation } from '@/lib/api/service';
import { publicValidation, type ValidationRow } from '@/lib/api/serialize';
import { cursorFilter, pageOf, pageParams } from '@/lib/api/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/v1/cases/{id}/validations – neuen Prüflauf anlegen (idempotent mit Idempotency-Key).
export const POST = apiRoute({ route: '/api/v1/cases/{id}/validations', scope: 'validation:execute', idempotent: true }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  if (ctx.body !== undefined && (typeof ctx.body !== 'object' || Array.isArray(ctx.body) || Object.keys(ctx.body as object).length)) throw new ApiError('VALIDATION_ERROR', 'The request body must be empty or {}.');
  const v = await runValidation(s, await getCase(s, ctx.params.id));
  return { status: 201, body: publicValidation(v), headers: { Location: `/api/v1/cases/${ctx.params.id}/validations/${v.id}` } };
});

// GET /api/v1/cases/{id}/validations – bisherige Prüfläufe
export const GET = apiRoute({ route: '/api/v1/cases/{id}/validations', scope: 'validation:read' }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  await getCase(s, ctx.params.id);
  const { limit, cursor } = pageParams(ctx.url);
  let q = supabaseAdmin().from('api_validation_runs').select('*').eq('tenant_id', ctx.tenantId).eq('environment', ctx.env).eq('case_id', ctx.params.id)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (cursor) q = q.or(cursorFilter(cursor));
  const { data, error } = await q;
  if (error) throw new ApiError('SERVICE_UNAVAILABLE');
  const page = pageOf((data ?? []) as ValidationRow[], limit, (r) => r.created_at);
  return { status: 200, body: { object: 'list', data: page.data.map(publicValidation), pagination: page.pagination } };
});
