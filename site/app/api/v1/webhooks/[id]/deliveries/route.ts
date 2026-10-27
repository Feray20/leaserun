import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute } from '@/lib/api/pipeline';
import { ApiError } from '@/lib/api/errors';
import { cursorFilter, pageOf, pageParams } from '@/lib/api/pagination';
import { loadWebhook } from '@/lib/api/webhook-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = { id: string; event: string; status: string; attempts: number; last_status: number | null; last_error: string | null; duration_ms: number | null; is_test: boolean; created_at: string; delivered_at: string | null; next_attempt_at: string };

// GET /api/v1/webhooks/{id}/deliveries – delivery history (without payloads and without receiver response bodies).
export const GET = apiRoute({ route: '/api/v1/webhooks/{id}/deliveries', scope: 'webhooks:read' }, async (ctx) => {
  const w = await loadWebhook(ctx);
  const { limit, cursor } = pageParams(ctx.url);
  let q = supabaseAdmin().from('api_webhook_deliveries').select('id, event, status, attempts, last_status, last_error, duration_ms, is_test, created_at, delivered_at, next_attempt_at')
    .eq('endpoint_id', w.id).eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (cursor) q = q.or(cursorFilter(cursor));
  const { data, error } = await q;
  if (error) throw new ApiError('SERVICE_UNAVAILABLE');
  const page = pageOf((data ?? []) as Row[], limit, (r) => r.created_at);
  return { status: 200, body: { object: 'list', data: page.data.map((d) => ({ object: 'webhook_delivery', delivery_id: d.id, ...d, next_attempt_at: d.status === 'retrying' ? d.next_attempt_at : null })), pagination: page.pagination } };
});
