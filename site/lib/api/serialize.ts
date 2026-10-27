// Öffentliche Darstellungen der Ressourcen (nur Felder, die der jeweilige Scope braucht).
import type { CaseData } from '@/lib/api/schemas';

export type CaseRow = { id: string; tenant_id: string; environment: string; external_reference: string | null; status: string; data: CaseData; metadata: Record<string, unknown>; created_at: string; updated_at: string; deleted_at: string | null };
export type ValidationRow = { id: string; case_id: string; environment: string; status: string; completeness_score: number | null; result: Record<string, unknown> | null; engine_version: string; duration_ms: number | null; created_at: string; evaluated_at: string | null };
export type DocumentRow = { id: string; case_id: string; environment: string; type: string; filename: string; mime_type: string; size: number; sha256: string; status: string; classification: string | null; verification_status: string; malware_scan: string; storage_path: string; uploaded_at: string; deleted_at: string | null };
export type ReportRow = { id: string; case_id: string; environment: string; validation_id: string | null; status: string; branding: string; storage_path: string | null; sha256: string | null; size: number | null; error: string | null; created_at: string; started_at: string | null; completed_at: string | null };
export type WebhookRow = { id: string; tenant_id: string; environment: string; url: string; description: string | null; secret_enc: string; secret_prefix: string; events: string[]; enabled: boolean; failure_count: number; created_at: string; updated_at: string; last_delivery_at: string | null };

export function publicCase(c: CaseRow) {
  const { external_reference: _x, metadata: _m, ...data } = c.data as CaseData & { metadata?: unknown };
  void _x; void _m;
  return {
    id: c.id, object: 'case', environment: c.environment, test: c.environment === 'test', status: c.status,
    external_reference: c.external_reference, ...data, metadata: c.metadata, created_at: c.created_at, updated_at: c.updated_at,
  };
}

export function publicValidation(v: ValidationRow) {
  const r = (v.result ?? {}) as Record<string, unknown>;
  return {
    validation_id: v.id, id: v.id, object: 'validation', case_id: v.case_id, environment: v.environment, status: v.status,
    completeness_score: v.completeness_score, bank_readiness: r.bank_readiness ?? null,
    missing_documents: r.missing_documents ?? [], missing_fields: r.missing_fields ?? [],
    warnings: r.warnings ?? [], errors: r.errors ?? [], checks: r.checks ?? [], figures: r.figures ?? {}, assumptions: r.assumptions ?? {},
    disclaimer: r.disclaimer ?? null, engine_version: v.engine_version, duration_ms: v.duration_ms, created_at: v.created_at, evaluated_at: v.evaluated_at,
  };
}

export function publicDocument(d: DocumentRow) {
  return {
    id: d.id, object: 'document', case_id: d.case_id, environment: d.environment, type: d.type, filename: d.filename, mime_type: d.mime_type,
    size: d.size, sha256: d.sha256, status: d.status, classification: d.classification, verification_status: d.verification_status,
    malware_scan: d.malware_scan, uploaded_at: d.uploaded_at,
  };
}

export function publicReport(r: ReportRow, downloadUrl?: string | null, expiresAt?: string | null) {
  return {
    report_id: r.id, id: r.id, object: 'report', case_id: r.case_id, environment: r.environment, validation_id: r.validation_id, status: r.status,
    branding: r.branding, sha256: r.sha256, size: r.size, error: r.status === 'failed' ? (r.error || 'Report generation failed.') : null,
    download_url: downloadUrl ?? null, download_expires_at: expiresAt ?? null,
    created_at: r.created_at, started_at: r.started_at, completed_at: r.completed_at,
  };
}

export function publicWebhook(w: WebhookRow) {
  return {
    id: w.id, object: 'webhook', environment: w.environment, url: w.url, description: w.description, events: w.events, enabled: w.enabled,
    secret_prefix: w.secret_prefix, failure_count: w.failure_count, created_at: w.created_at, updated_at: w.updated_at, last_delivery_at: w.last_delivery_at,
  };
}
