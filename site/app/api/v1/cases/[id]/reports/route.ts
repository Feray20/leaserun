import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute, background } from '@/lib/api/pipeline';
import { ApiError, zodErrors } from '@/lib/api/errors';
import { ReportInput } from '@/lib/api/schemas';
import { createReport, getCase, processReport } from '@/lib/api/service';
import { publicReport, type ReportRow } from '@/lib/api/serialize';
import { cursorFilter, pageOf, pageParams } from '@/lib/api/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/v1/cases/{id}/reports – Bericht asynchron erzeugen (Antwort 202, Status über GET abfragen).
export const POST = apiRoute({ route: '/api/v1/cases/{id}/reports', scope: 'reports:create', idempotent: true }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  const p = ReportInput.safeParse(ctx.body ?? {});
  if (!p.success) throw new ApiError('VALIDATION_ERROR', 'The request contains invalid data.', { errors: zodErrors(p.error.issues) });
  const c = await getCase(s, ctx.params.id);
  const r = await createReport(s, c, ctx.policy.white_label_enabled ? 'white_label' : 'leaserun', p.data.validation_id);
  background(() => processReport(r.id));
  return { status: 202, body: publicReport(r), headers: { Location: `/api/v1/cases/${c.id}/reports/${r.id}` } };
});

export const GET = apiRoute({ route: '/api/v1/cases/{id}/reports', scope: 'reports:read' }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  await getCase(s, ctx.params.id);
  const { limit, cursor } = pageParams(ctx.url);
  let q = supabaseAdmin().from('api_reports').select('*').eq('tenant_id', ctx.tenantId).eq('environment', ctx.env).eq('case_id', ctx.params.id)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (cursor) q = q.or(cursorFilter(cursor));
  const { data, error } = await q;
  if (error) throw new ApiError('SERVICE_UNAVAILABLE');
  const page = pageOf((data ?? []) as ReportRow[], limit, (r) => r.created_at);
  return { status: 200, body: { object: 'list', data: page.data.map((r) => publicReport(r)), pagination: page.pagination } };
});
