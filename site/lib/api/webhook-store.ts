import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api/errors';
import type { ApiCtx } from '@/lib/api/pipeline';
import type { WebhookRow } from '@/lib/api/serialize';

// Webhook-Endpunkt des Mandanten in der Umgebung des Schlüssels (fremde IDs → 404).
export async function loadWebhook(ctx: ApiCtx): Promise<WebhookRow> {
  const { data } = await supabaseAdmin().from('api_webhook_endpoints').select('*').eq('id', ctx.params.id).eq('tenant_id', ctx.tenantId).eq('environment', ctx.env).maybeSingle();
  if (!data) throw new ApiError('RESOURCE_NOT_FOUND', 'Webhook not found.');
  return data as WebhookRow;
}
