import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute } from '@/lib/api/pipeline';
import { ApiError } from '@/lib/api/errors';
import { getCase, uploadDocument } from '@/lib/api/service';
import { publicDocument, type DocumentRow } from '@/lib/api/serialize';
import { cursorFilter, pageOf, pageParams } from '@/lib/api/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/v1/cases/{id}/documents – multipart/form-data mit den Feldern "file" und "type".
export const POST = apiRoute({ route: '/api/v1/cases/{id}/documents', scope: 'documents:write', idempotent: true, multipart: true, maxBody: 4_400_000 }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  const c = await getCase(s, ctx.params.id);
  if (!ctx.raw.length) throw new ApiError('VALIDATION_ERROR', 'Send the file as multipart/form-data (fields: file, type).');
  let form: FormData;
  try { form = await new Request('http://local/upload', { method: 'POST', headers: { 'content-type': ctx.req.headers.get('content-type') || '' }, body: new Uint8Array(ctx.raw) }).formData(); }
  catch { throw new ApiError('BAD_REQUEST', 'Malformed multipart body.'); }
  const d = await uploadDocument(s, c, form, ctx.policy.max_document_size);
  return { status: 201, body: publicDocument(d), headers: { Location: `/api/v1/cases/${c.id}/documents/${d.id}` } };
});

export const GET = apiRoute({ route: '/api/v1/cases/{id}/documents', scope: 'documents:read' }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  await getCase(s, ctx.params.id);
  const { limit, cursor } = pageParams(ctx.url);
  let q = supabaseAdmin().from('api_documents').select('*').eq('tenant_id', ctx.tenantId).eq('environment', ctx.env).eq('case_id', ctx.params.id).is('deleted_at', null)
    .order('uploaded_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (cursor) q = q.or(cursorFilter(cursor, 'uploaded_at'));
  const { data, error } = await q;
  if (error) throw new ApiError('SERVICE_UNAVAILABLE');
  const page = pageOf((data ?? []) as DocumentRow[], limit, (r) => r.uploaded_at);
  return { status: 200, body: { object: 'list', data: page.data.map(publicDocument), pagination: page.pagination } };
});
