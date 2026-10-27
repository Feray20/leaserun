import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute } from '@/lib/api/pipeline';
import { ApiError, zodErrors } from '@/lib/api/errors';
import { WebhookInput } from '@/lib/api/schemas';
import { checkWebhookUrl } from '@/lib/api/net';
import { encryptSecret, newWebhookSecret } from '@/lib/api/crypto';
import { apiAudit } from '@/lib/api/audit';
import { publicWebhook, type WebhookRow } from '@/lib/api/serialize';
import { cursorFilter, pageOf, pageParams } from '@/lib/api/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ENDPOINTS = 10;

// POST /api/v1/webhooks – create an endpoint. The signing secret is shown in full only in this response.
export const POST = apiRoute({ route: '/api/v1/webhooks', scope: 'webhooks:write', idempotent: true }, async (ctx) => {
  const p = WebhookInput.safeParse(ctx.body ?? {});
  if (!p.success) throw new ApiError('VALIDATION_ERROR', 'The request contains invalid data.', { errors: zodErrors(p.error.issues) });
  const chk = checkWebhookUrl(p.data.url);
  if (!chk.ok) throw new ApiError('UNSAFE_WEBHOOK_URL', chk.reason, { errors: [{ field: 'url', code: 'unsafe_url', message: chk.reason }] });
  const db = supabaseAdmin();
  const { count } = await db.from('api_webhook_endpoints').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('environment', ctx.env);
  if ((count ?? 0) >= MAX_ENDPOINTS) throw new ApiError('CONFLICT', `At most ${MAX_ENDPOINTS} webhook endpoints per environment.`);
  const secret = newWebhookSecret();
  const { data, error } = await db.from('api_webhook_endpoints').insert({
    tenant_id: ctx.tenantId, environment: ctx.env, url: chk.url.toString(), description: p.data.description ?? null, events: [...new Set(p.data.events)],
    enabled: p.data.enabled ?? true, secret_enc: encryptSecret(secret), secret_prefix: secret.slice(0, 12),
  }).select('*').single();
  if (error || !data) throw new ApiError('SERVICE_UNAVAILABLE');
  await apiAudit({ tenantId: ctx.tenantId, environment: ctx.env, actor: ctx.actor, action: 'webhook.created', resourceType: 'webhook', resourceId: data.id, requestId: ctx.requestId, meta: { events: data.events, host: chk.url.hostname } });
  return { status: 201, body: { ...publicWebhook(data as WebhookRow), secret, secret_notice: 'Store this secret now – it will not be shown again.' } };
});

export const GET = apiRoute({ route: '/api/v1/webhooks', scope: 'webhooks:read' }, async (ctx) => {
  const { limit, cursor } = pageParams(ctx.url);
  let q = supabaseAdmin().from('api_webhook_endpoints').select('*').eq('tenant_id', ctx.tenantId).eq('environment', ctx.env)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (cursor) q = q.or(cursorFilter(cursor));
  const { data, error } = await q;
  if (error) throw new ApiError('SERVICE_UNAVAILABLE');
  const page = pageOf((data ?? []) as WebhookRow[], limit, (r) => r.created_at);
  return { status: 200, body: { object: 'list', data: page.data.map(publicWebhook), pagination: page.pagination } };
});
