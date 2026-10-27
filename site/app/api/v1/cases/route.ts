import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute } from '@/lib/api/pipeline';
import { ApiError, zodErrors } from '@/lib/api/errors';
import { CaseInput } from '@/lib/api/schemas';
import { createCase } from '@/lib/api/service';
import { publicCase, type CaseRow } from '@/lib/api/serialize';
import { cursorFilter, pageOf, pageParams } from '@/lib/api/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/cases – the tenant's cases (cursor pagination, optional ?status= and ?external_reference=)
export const GET = apiRoute({ route: '/api/v1/cases', scope: 'cases:read' }, async (ctx) => {
  const { limit, cursor } = pageParams(ctx.url);
  let q = supabaseAdmin().from('api_cases').select('*').eq('tenant_id', ctx.tenantId).eq('environment', ctx.env).is('deleted_at', null)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  const status = ctx.url.searchParams.get('status');
  if (status) {
    if (!['open', 'action_required', 'completed'].includes(status)) throw new ApiError('BAD_REQUEST', 'status must be open, action_required or completed.');
    q = q.eq('status', status);
  }
  const ext = ctx.url.searchParams.get('external_reference');
  if (ext) q = q.eq('external_reference', ext.slice(0, 120));
  if (cursor) q = q.or(cursorFilter(cursor));
  const { data, error } = await q;
  if (error) throw new ApiError('SERVICE_UNAVAILABLE');
  const page = pageOf((data ?? []) as CaseRow[], limit, (r) => r.created_at);
  return { status: 200, body: { object: 'list', data: page.data.map(publicCase), pagination: page.pagination } };
});

// POST /api/v1/cases – create a case (Idempotency-Key recommended)
export const POST = apiRoute({ route: '/api/v1/cases', scope: 'cases:write', idempotent: true }, async (ctx) => {
  const p = CaseInput.safeParse(ctx.body ?? {});
  if (!p.success) throw new ApiError('VALIDATION_ERROR', 'The request contains invalid data.', { errors: zodErrors(p.error.issues) });
  const row = await createCase({ tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId, keyId: ctx.key.id }, p.data);
  return { status: 201, body: publicCase(row), headers: { Location: `/api/v1/cases/${row.id}` } };
});
