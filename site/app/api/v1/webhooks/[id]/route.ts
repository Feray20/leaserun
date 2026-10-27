import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute } from '@/lib/api/pipeline';
import { ApiError, zodErrors } from '@/lib/api/errors';
import { WebhookPatch } from '@/lib/api/schemas';
import { checkWebhookUrl } from '@/lib/api/net';
import { apiAudit } from '@/lib/api/audit';
import { publicWebhook, type WebhookRow } from '@/lib/api/serialize';
import { loadWebhook } from '@/lib/api/webhook-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const GET = apiRoute({ route: '/api/v1/webhooks/{id}', scope: 'webhooks:read' }, async (ctx) => ({ status: 200, body: publicWebhook(await loadWebhook(ctx)) }));

export const PATCH = apiRoute({ route: '/api/v1/webhooks/{id}', scope: 'webhooks:write' }, async (ctx) => {
  const w = await loadWebhook(ctx);
  const p = WebhookPatch.safeParse(ctx.body ?? {});
  if (!p.success) throw new ApiError('VALIDATION_ERROR', 'The request contains invalid data.', { errors: zodErrors(p.error.issues) });
  const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.data.url !== undefined) {
    const chk = checkWebhookUrl(p.data.url);
    if (!chk.ok) throw new ApiError('UNSAFE_WEBHOOK_URL', chk.reason, { errors: [{ field: 'url', code: 'unsafe_url', message: chk.reason }] });
    up.url = chk.url.toString();
  }
  if (p.data.events !== undefined) up.events = [...new Set(p.data.events)];
  if (p.data.description !== undefined) up.description = p.data.description || null;
  if (p.data.enabled !== undefined) { up.enabled = p.data.enabled; if (p.data.enabled) up.failure_count = 0; }
  const { data, error } = await supabaseAdmin().from('api_webhook_endpoints').update(up).eq('id', w.id).eq('tenant_id', ctx.tenantId).select('*').single();
  if (error || !data) throw new ApiError('SERVICE_UNAVAILABLE');
  await apiAudit({ tenantId: ctx.tenantId, environment: ctx.env, actor: ctx.actor, action: 'webhook.updated', resourceType: 'webhook', resourceId: w.id, requestId: ctx.requestId, meta: { fields: Object.keys(up).filter((k) => k !== 'updated_at') } });
  return { status: 200, body: publicWebhook(data as WebhookRow) };
});

export const DELETE = apiRoute({ route: '/api/v1/webhooks/{id}', scope: 'webhooks:write' }, async (ctx) => {
  const w = await loadWebhook(ctx);
  await supabaseAdmin().from('api_webhook_endpoints').delete().eq('id', w.id).eq('tenant_id', ctx.tenantId);
  await apiAudit({ tenantId: ctx.tenantId, environment: ctx.env, actor: ctx.actor, action: 'webhook.deleted', resourceType: 'webhook', resourceId: w.id, requestId: ctx.requestId });
  return new Response(null, { status: 204 });
});
