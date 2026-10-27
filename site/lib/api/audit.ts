// Audit-Ereignisse der API (Hash-Kette in der Datenbank, Tabelle nur anhängbar).
import { supabaseAdmin } from '@/lib/supabase/admin';

export type AuditAction =
  | 'api.access.enabled' | 'api.access.disabled' | 'api.policy.updated'
  | 'api_key.created' | 'api_key.rotated' | 'api_key.revoked' | 'api_key.disabled' | 'api_key.enabled' | 'api_key.expired'
  | 'case.created' | 'case.updated' | 'case.deleted'
  | 'validation.started' | 'validation.completed' | 'validation.failed'
  | 'document.uploaded' | 'document.verified' | 'document.rejected' | 'document.deleted'
  | 'report.requested' | 'report.generated' | 'report.failed'
  | 'webhook.created' | 'webhook.updated' | 'webhook.deleted' | 'webhook.tested' | 'webhook.delivery_failed' | 'webhook.delivery_retried'
  | 'sandbox.reset' | 'sandbox.seeded';

export async function apiAudit(e: {
  tenantId: string | null; environment?: string | null; actor: string; action: AuditAction; resourceType?: string; resourceId?: string | null;
  requestId?: string | null; result?: 'success' | 'failure'; meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin().from('api_audit_events').insert({
      tenant_id: e.tenantId, environment: e.environment ?? null, actor: e.actor.slice(0, 120), action: e.action,
      resource_type: e.resourceType ?? null, resource_id: e.resourceId ?? null, request_id: e.requestId ?? null,
      result: e.result ?? 'success', meta: e.meta ?? {},
    });
  } catch (err) {
    console.error('api_audit_failed', e.action, err instanceof Error ? err.message : err);
  }
}
