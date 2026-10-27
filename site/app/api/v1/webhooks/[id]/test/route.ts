import { apiRoute } from '@/lib/api/pipeline';
import { apiAudit } from '@/lib/api/audit';
import { sendTest } from '@/lib/api/webhooks';
import { loadWebhook } from '@/lib/api/webhook-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/v1/webhooks/{id}/test – sendet sofort ein signiertes Testereignis (type "webhook.test").
export const POST = apiRoute({ route: '/api/v1/webhooks/{id}/test', scope: 'webhooks:test' }, async (ctx) => {
  const w = await loadWebhook(ctx);
  const r = await sendTest(ctx.tenantId, ctx.env, w.id);
  await apiAudit({ tenantId: ctx.tenantId, environment: ctx.env, actor: ctx.actor, action: 'webhook.tested', resourceType: 'webhook', resourceId: w.id, requestId: ctx.requestId, result: r.ok ? 'success' : 'failure', meta: { status: r.status } });
  return { status: 200, body: { object: 'webhook_test', webhook_id: w.id, delivery_id: r.delivery_id, delivered: r.ok, response_status: r.status || null, error: r.error ?? null } };
});
