// Fachlogik der API (Fälle, Vorprüfung, Unterlagen, Berichte). Jede Abfrage ist auf Mandant und Umgebung begrenzt.
import { createElement } from 'react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api/errors';
import { apiAudit } from '@/lib/api/audit';
import { emit } from '@/lib/api/webhooks';
import { evaluateCase, type DocInfo } from '@/lib/api/validation-engine';
import { API_BUCKET, API_ENGINE_VERSION, SIGNED_URL_SECONDS } from '@/lib/api/config';
import { sha256Hex } from '@/lib/api/crypto';
import { detectMime } from '@/lib/documents/files';
import { DOCUMENT_TYPES, type CaseData, type DocumentType } from '@/lib/api/schemas';
import { type CaseRow, type DocumentRow, type ReportRow, type ValidationRow } from '@/lib/api/serialize';
import { scanUpload } from '@/lib/security/filescan';

export type Scope = { tenantId: string; env: string; actor: string; requestId?: string | null };

const db = () => supabaseAdmin();

export async function getCase(s: Scope, id: string): Promise<CaseRow> {
  const { data } = await db().from('api_cases').select('*').eq('id', id).eq('tenant_id', s.tenantId).eq('environment', s.env).is('deleted_at', null).maybeSingle();
  if (!data) throw new ApiError('RESOURCE_NOT_FOUND', 'Case not found.');
  return data as CaseRow;
}

export async function createCase(s: Scope & { keyId?: string | null }, input: CaseData): Promise<CaseRow> {
  const { external_reference, metadata, ...data } = input;
  const { data: row, error } = await db().from('api_cases').insert({
    tenant_id: s.tenantId, environment: s.env, external_reference: external_reference ?? null, data,
    metadata: { ...(metadata ?? {}), ...(s.env === 'test' ? { test: true } : {}) }, created_by_key: s.keyId ?? null,
  }).select('*').single();
  if (error?.code === '23505') throw new ApiError('CONFLICT', 'A case with this external_reference already exists.', { errors: [{ field: 'external_reference', code: 'duplicate', message: 'already exists' }] });
  if (error || !row) throw new ApiError('SERVICE_UNAVAILABLE', 'Case could not be stored.');
  await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'case.created', resourceType: 'case', resourceId: row.id, requestId: s.requestId });
  return row as CaseRow;
}

export async function updateCase(s: Scope, c: CaseRow, next: CaseData): Promise<CaseRow> {
  const { external_reference, metadata, ...data } = next;
  const { data: row, error } = await db().from('api_cases').update({
    data, external_reference: external_reference ?? null, metadata: { ...(metadata ?? {}), ...(s.env === 'test' ? { test: true } : {}) }, updated_at: new Date().toISOString(),
  }).eq('id', c.id).eq('tenant_id', s.tenantId).eq('environment', s.env).select('*').single();
  if (error?.code === '23505') throw new ApiError('CONFLICT', 'A case with this external_reference already exists.');
  if (error || !row) throw new ApiError('SERVICE_UNAVAILABLE', 'Case could not be updated.');
  await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'case.updated', resourceType: 'case', resourceId: c.id, requestId: s.requestId });
  return row as CaseRow;
}

// Löschen: Datensatz samt Unterlagen, Prüfläufen und Berichten endgültig entfernen (Datensparsamkeit, Art. 17 DSGVO).
export async function deleteCase(s: Scope, c: CaseRow): Promise<void> {
  const [{ data: docs }, { data: reps }] = await Promise.all([
    db().from('api_documents').select('storage_path').eq('case_id', c.id).eq('tenant_id', s.tenantId),
    db().from('api_reports').select('storage_path').eq('case_id', c.id).eq('tenant_id', s.tenantId),
  ]);
  const paths = [...(docs ?? []), ...(reps ?? [])].map((x) => x.storage_path).filter(Boolean) as string[];
  if (paths.length) await db().storage.from(API_BUCKET).remove(paths);
  await db().from('api_cases').delete().eq('id', c.id).eq('tenant_id', s.tenantId).eq('environment', s.env);
  await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'case.deleted', resourceType: 'case', resourceId: c.id, requestId: s.requestId, meta: { files: paths.length } });
}

async function docInfos(s: Scope, caseId: string): Promise<DocInfo[]> {
  const { data } = await db().from('api_documents').select('id, type, sha256, status, verification_status, malware_scan').eq('case_id', caseId).eq('tenant_id', s.tenantId).is('deleted_at', null);
  return (data ?? []) as DocInfo[];
}

// Vorprüfung ausführen (synchron, typ. < 200 ms) und Ereignisse auslösen.
export async function runValidation(s: Scope, c: CaseRow): Promise<ValidationRow> {
  const started = Date.now();
  const { data: run, error } = await db().from('api_validation_runs').insert({ tenant_id: s.tenantId, environment: s.env, case_id: c.id, status: 'processing', engine_version: API_ENGINE_VERSION }).select('*').single();
  if (error || !run) throw new ApiError('SERVICE_UNAVAILABLE', 'Validation could not be started.');
  await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'validation.started', resourceType: 'validation', resourceId: run.id, requestId: s.requestId, meta: { case_id: c.id } });
  try {
    const out = evaluateCase(c.data, await docInfos(s, c.id));
    const { data: done } = await db().from('api_validation_runs').update({
      status: 'completed', completeness_score: out.completeness_score, result: out, duration_ms: Date.now() - started, evaluated_at: new Date().toISOString(),
    }).eq('id', run.id).select('*').single();
    const newStatus = out.errors.length ? 'action_required' : out.bank_readiness === 'ready' ? 'completed' : 'open';
    if (newStatus !== c.status) await db().from('api_cases').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', c.id).eq('tenant_id', s.tenantId);
    await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'validation.completed', resourceType: 'validation', resourceId: run.id, requestId: s.requestId, meta: { case_id: c.id, completeness: out.completeness_score, readiness: out.bank_readiness } });
    const v = done as ValidationRow;
    await emit(s.tenantId, s.env, 'validation.completed', { case_id: c.id, validation_id: v.id, status: v.status, completeness_score: out.completeness_score, bank_readiness: out.bank_readiness, errors: out.errors.length, warnings: out.warnings.length }, v.id);
    if (newStatus !== c.status && newStatus === 'action_required') await emit(s.tenantId, s.env, 'case.action_required', { case_id: c.id, validation_id: v.id, errors: out.errors.map((e) => ({ code: e.code, field: e.field })) }, `${c.id}:${v.id}`);
    if (newStatus !== c.status && newStatus === 'completed') await emit(s.tenantId, s.env, 'case.completed', { case_id: c.id, validation_id: v.id, completeness_score: out.completeness_score }, `${c.id}:${v.id}`);
    return v;
  } catch (e) {
    await db().from('api_validation_runs').update({ status: 'failed', duration_ms: Date.now() - started, evaluated_at: new Date().toISOString() }).eq('id', run.id);
    await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'validation.failed', resourceType: 'validation', resourceId: run.id, requestId: s.requestId, result: 'failure' });
    throw e;
  }
}

export async function getValidation(s: Scope, caseId: string, id: string): Promise<ValidationRow> {
  const { data } = await db().from('api_validation_runs').select('*').eq('id', id).eq('case_id', caseId).eq('tenant_id', s.tenantId).eq('environment', s.env).maybeSingle();
  if (!data) throw new ApiError('RESOURCE_NOT_FOUND', 'Validation not found.');
  return data as ValidationRow;
}

// ---------- Unterlagen ----------
const EXT: Record<string, string[]> = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/tiff': ['tif', 'tiff'] };
const LABEL: Partial<Record<DocumentType, string>> = { identity: 'Ausweisdokument', income_proof: 'Einkommensnachweis', equity_proof: 'Eigenkapitalnachweis', expose: 'Exposé', land_register: 'Grundbuchauszug', floor_plan: 'Grundriss', energy_certificate: 'Energieausweis', self_disclosure: 'Selbstauskunft', purchase_contract_draft: 'Kaufvertragsentwurf' };

async function malwareScan(bytes: Buffer): Promise<'not_configured' | 'clean' | 'infected' | 'error'> {
  // Statische Virenprüfung immer; externer Scanner zusätzlich, wenn MALWARE_SCAN_URL eingetragen ist.
  const r = await scanUpload(bytes);
  if (r.clean) return 'clean';
  return /nicht möglich/.test(r.threat) ? 'error' : 'infected';
}

export async function uploadDocument(s: Scope, c: CaseRow, form: FormData, maxBytes: number): Promise<DocumentRow> {
  const file = form.get('file');
  const type = String(form.get('type') || '');
  const errs = [];
  if (!(file instanceof File)) errs.push({ field: 'file', code: 'required', message: 'multipart field "file" is required' });
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) errs.push({ field: 'type', code: 'invalid_enum', message: `one of: ${DOCUMENT_TYPES.join(', ')}` });
  if (errs.length || !(file instanceof File)) throw new ApiError('VALIDATION_ERROR', 'The upload is invalid.', { errors: errs });
  if (file.size > maxBytes) throw new ApiError('PAYLOAD_TOO_LARGE', `Maximum document size is ${maxBytes} bytes.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length) throw new ApiError('VALIDATION_ERROR', 'The file is empty.', { errors: [{ field: 'file', code: 'empty', message: 'empty file' }] });
  const name = (file.name || 'dokument').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const declared = (file.type || '').toLowerCase();
  const detected = detectMime(bytes);
  // Inhalt (Magic Bytes), Dateiendung und angegebener MIME-Typ müssen zusammenpassen.
  if (!detected) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Only PDF, JPEG, PNG and TIFF files are accepted (content signature check).');
  if (!EXT[detected.mime].includes(ext)) throw new ApiError('VALIDATION_ERROR', 'File extension does not match the file content.', { errors: [{ field: 'file', code: 'extension_mismatch', message: `expected .${EXT[detected.mime].join(' / .')}` }] });
  if (declared && declared !== 'application/octet-stream' && declared !== detected.mime && !(declared === 'image/jpg' && detected.mime === 'image/jpeg')) throw new ApiError('VALIDATION_ERROR', 'Declared MIME type does not match the file content.', { errors: [{ field: 'file', code: 'mime_mismatch', message: `content is ${detected.mime}` }] });
  const sha = sha256Hex(bytes);
  const id = crypto.randomUUID();
  const path = `${s.tenantId}/${s.env}/${c.id}/${id}.${detected.ext}`;
  const up = await db().storage.from(API_BUCKET).upload(path, bytes, { contentType: detected.mime, upsert: false });
  if (up.error) throw new ApiError('SERVICE_UNAVAILABLE', 'File could not be stored.');
  const { data: row, error } = await db().from('api_documents').insert({
    id, tenant_id: s.tenantId, environment: s.env, case_id: c.id, type, filename: name, mime_type: detected.mime, size: bytes.length, sha256: sha,
    status: 'processing', storage_path: path,
  }).select('*').single();
  if (error || !row) { await db().storage.from(API_BUCKET).remove([path]); throw new ApiError('SERVICE_UNAVAILABLE', 'Document could not be stored.'); }
  await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'document.uploaded', resourceType: 'document', resourceId: id, requestId: s.requestId, meta: { case_id: c.id, type, size: bytes.length, sha256: sha } });
  // Prüfkette: Virenscan (falls angebunden) → Klassifizierung nach angegebenem Typ → formale Prüfung.
  const scan = await malwareScan(bytes);
  // Kontrolle nach dem Speichern: gespeicherte Datei erneut laden und Prüfsumme vergleichen.
  const back = await db().storage.from(API_BUCKET).download(path);
  const intact = !back.error && back.data ? sha256Hex(Buffer.from(await back.data.arrayBuffer())) === sha : false;
  const rejected = scan === 'infected' || !intact;
  const { data: done } = await db().from('api_documents').update({
    malware_scan: scan, classification: LABEL[type as DocumentType] ?? type,
    status: rejected ? 'rejected' : 'verified', verification_status: rejected ? 'rejected' : 'formally_verified',
  }).eq('id', id).select('*').single();
  if (!rejected) {
    await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: 'system:documents', action: 'document.verified', resourceType: 'document', resourceId: id, requestId: s.requestId, meta: { scan } });
    await emit(s.tenantId, s.env, 'document.verified', { case_id: c.id, document_id: id, type, sha256: sha, verification_status: 'formally_verified' }, id);
  } else {
    await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: 'system:documents', action: 'document.rejected', resourceType: 'document', resourceId: id, requestId: s.requestId, result: 'failure', meta: { scan, intact } });
  }
  return (done ?? row) as DocumentRow;
}

export async function getDocument(s: Scope, caseId: string, id: string): Promise<DocumentRow> {
  const { data } = await db().from('api_documents').select('*').eq('id', id).eq('case_id', caseId).eq('tenant_id', s.tenantId).eq('environment', s.env).is('deleted_at', null).maybeSingle();
  if (!data) throw new ApiError('RESOURCE_NOT_FOUND', 'Document not found.');
  return data as DocumentRow;
}

export async function deleteDocument(s: Scope, d: DocumentRow): Promise<void> {
  await db().storage.from(API_BUCKET).remove([d.storage_path]);
  await db().from('api_documents').delete().eq('id', d.id).eq('tenant_id', s.tenantId);
  await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'document.deleted', resourceType: 'document', resourceId: d.id, requestId: s.requestId });
}

export async function signedUrl(path: string): Promise<{ url: string; expires_at: string } | null> {
  const { data } = await db().storage.from(API_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  return data?.signedUrl ? { url: data.signedUrl, expires_at: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() } : null;
}

// ---------- Berichte (asynchron) ----------
export async function createReport(s: Scope, c: CaseRow, branding: 'leaserun' | 'white_label', validationId?: string): Promise<ReportRow> {
  if (validationId) await getValidation(s, c.id, validationId);
  const { data: row, error } = await db().from('api_reports').insert({ tenant_id: s.tenantId, environment: s.env, case_id: c.id, validation_id: validationId ?? null, status: 'queued', branding }).select('*').single();
  if (error || !row) throw new ApiError('SERVICE_UNAVAILABLE', 'Report could not be queued.');
  await apiAudit({ tenantId: s.tenantId, environment: s.env, actor: s.actor, action: 'report.requested', resourceType: 'report', resourceId: row.id, requestId: s.requestId, meta: { case_id: c.id, branding } });
  return row as ReportRow;
}

export async function getReport(s: Scope, caseId: string, id: string): Promise<ReportRow> {
  const { data } = await db().from('api_reports').select('*').eq('id', id).eq('case_id', caseId).eq('tenant_id', s.tenantId).eq('environment', s.env).maybeSingle();
  if (!data) throw new ApiError('RESOURCE_NOT_FOUND', 'Report not found.');
  return data as ReportRow;
}

const eur = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €` : '–');

export async function processReport(reportId: string): Promise<void> {
  const { data: claimed } = await db().from('api_reports').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', reportId).eq('status', 'queued').select('*').maybeSingle();
  if (!claimed) return;
  const r = claimed as ReportRow & { tenant_id: string; attempts: number };
  const s: Scope = { tenantId: r.tenant_id, env: r.environment, actor: 'system:reports' };
  try {
    const c = await getCase(s, r.case_id);
    let v: ValidationRow | null = null;
    if (r.validation_id) v = await getValidation(s, r.case_id, r.validation_id).catch(() => null);
    if (!v) v = await runValidation(s, c);
    const res = (v.result ?? {}) as { checks?: { code: string; severity: string; message: string; category: string }[]; figures?: Record<string, number | null>; bank_readiness?: string; missing_documents?: string[]; disclaimer?: string };
    const f = res.figures ?? {};
    const { data: acc } = await db().from('lr_b2b_accounts').select('company_name, brand_color').eq('id', r.tenant_id).maybeSingle();
    const d = c.data;
    const READY: Record<string, string> = { ready: 'Bankreif', needs_attention: 'Nacharbeit nötig', not_ready: 'Nicht bankreif' };
    const SEV: Record<string, string> = { error: 'Fehler', warning: 'Hinweis', info: 'OK' };
    const { ReportDocument } = await import('@/lib/pdf/report');
    const { renderToBuffer } = await import('@react-pdf/renderer');
    const input = {
      title: `Fallanalyse${c.external_reference ? ` ${c.external_reference}` : ''}`,
      subtitle: [d.property?.address?.city, d.property?.property_type, `Vorprüfung vom ${new Date(v.evaluated_at || v.created_at).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`].filter(Boolean).join(' · '),
      chips: [['Kaufpreis', eur(f.purchase_price)], ['Gesamtkosten', eur(f.total_cost)], ['Darlehen', eur(f.loan)], ['Monatsrate', eur(f.monthly_rate)],
        ['Vollständigkeit', `${v.completeness_score ?? 0} %`], ['Bank-Readiness', READY[res.bank_readiness || ''] || '–'], ['Eigenkapital', eur(f.equity)], ['Nebenkosten', eur(f.ancillary_costs)]] as [string, string][],
      sections: [
        { title: 'Prüfpunkte', rows: (res.checks ?? []).filter((x) => x.severity !== 'info').slice(0, 14).map((x) => [x.message.slice(0, 110), SEV[x.severity] || x.severity] as [string, string]) },
        { title: 'Erfüllt', rows: (res.checks ?? []).filter((x) => x.severity === 'info').slice(0, 14).map((x) => [x.message.slice(0, 110), 'OK'] as [string, string]) },
        ...(res.missing_documents?.length ? [{ title: 'Fehlende Unterlagen', rows: res.missing_documents.slice(0, 14).map((m) => [m, 'fehlt'] as [string, string]) }] : []),
      ].filter((x) => x.rows.length),
      hints: [res.disclaimer || 'Vorprüfung – keine Kreditzusage.', 'Erstellt über die LeaseRun API v1 aus den übermittelten Angaben; Unterlagen formal (Dateityp, Signatur, Prüfsumme) geprüft, nicht inhaltlich.'],
      note: 'Strukturierte Fallanalyse zur Vorbereitung. Die Kreditentscheidung liegt beim jeweiligen Kreditinstitut.',
    };
    const partner = r.branding === 'white_label' && acc ? { name: acc.company_name as string, color: (acc.brand_color as string | null) ?? null, whitelabel: true } : null;
    const el = createElement(ReportDocument, { r: input, reportId: r.id.slice(0, 8), createdAt: new Date().toISOString(), partner, reportType: 'Fallanalyse · Vorprüfung', watermark: r.environment === 'test' ? 'TEST – SANDBOX – KEINE ECHTDATEN' : undefined, clean: r.environment !== 'test' }) as unknown as Parameters<typeof renderToBuffer>[0];
    const pdf = await renderToBuffer(el);
    const path = `${r.tenant_id}/${r.environment}/${r.case_id}/reports/${r.id}.pdf`;
    const up = await db().storage.from(API_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    if (up.error) throw new Error('storage_upload_failed');
    const sha = sha256Hex(pdf);
    await db().from('api_reports').update({ status: 'completed', storage_path: path, sha256: sha, size: pdf.length, completed_at: new Date().toISOString(), validation_id: v.id, error: null }).eq('id', r.id);
    await apiAudit({ tenantId: r.tenant_id, environment: r.environment, actor: 'system:reports', action: 'report.generated', resourceType: 'report', resourceId: r.id, meta: { case_id: r.case_id, sha256: sha, size: pdf.length } });
    await emit(r.tenant_id, r.environment, 'report.completed', { case_id: r.case_id, report_id: r.id, sha256: sha, size: pdf.length }, r.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'error';
    const retry = (r.attempts ?? 0) < 2;
    await db().from('api_reports').update({ status: retry ? 'queued' : 'failed', attempts: (r.attempts ?? 0) + 1, error: retry ? null : 'Report generation failed.' }).eq('id', r.id);
    await apiAudit({ tenantId: r.tenant_id, environment: r.environment, actor: 'system:reports', action: 'report.failed', resourceType: 'report', resourceId: r.id, result: 'failure', meta: { error: msg, retry } });
    if (retry) await processReport(r.id);
  }
}

// Hängengebliebene Berichte (z. B. Funktionsabbruch) erneut einreihen und abarbeiten.
export async function processReportQueue(limit = 5): Promise<number> {
  const stale = new Date(Date.now() - 5 * 60_000).toISOString();
  await db().from('api_reports').update({ status: 'queued' }).eq('status', 'processing').lt('started_at', stale);
  const { data } = await db().from('api_reports').select('id').eq('status', 'queued').order('created_at').limit(limit);
  for (const x of data ?? []) await processReport(x.id);
  return (data ?? []).length;
}
