import { logSecurity } from '@/lib/security/seclog';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABEL, CURRENT_CATEGORIES, MAX_DOCUMENTS_PER_USER, checkFile, isCategory, safeFilename } from '@/lib/documents/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const OBJ_RE = /^[A-Za-z0-9_-]{4,40}$/;

// List of your own documents, optionally per property.
export async function GET(req: Request) {
  if (!adminConfigured()) return json({ error: 'Document storage not configured.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  const objectRef = new URL(req.url).searchParams.get('objectRef');
  let q = supabaseAdmin()
    .from('lr_documents')
    .select('id, object_ref, category, filename, mime_type, size_bytes, sha256, status, created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (objectRef && OBJ_RE.test(objectRef)) q = q.eq('object_ref', objectRef);
  const { data, error } = await q;
  if (error) return json({ error: 'Couldn’t load documents.' }, 502);
  return json({ documents: data ?? [], categories: CURRENT_CATEGORIES, labels: CATEGORY_LABEL });
}

// Upload: file type via magic bytes, size, SHA-256; the original is stored unchanged.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Document storage not configured.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  if (!allowRequest(`upload:${user.id}`, 20, 60_000)) return json({ error: 'Too many uploads. Please wait a moment.' }, 429);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'Upload failed (4 MB max per file).' }, 400);
  }
  const file = form.get('file');
  const objectRef = String(form.get('objectRef') ?? '');
  const category = form.get('category');
  if (!(file instanceof File)) return json({ error: 'No file received.' }, 400);
  if (!OBJ_RE.test(objectRef)) return json({ error: 'Property missing.' }, 400);
  if (!isCategory(category)) return json({ error: 'Please choose a category.' }, 400);

  const db = supabaseAdmin();
  const { count } = await db.from('lr_documents').select('id', { count: 'exact', head: true }).eq('owner_id', user.id);
  if ((count ?? 0) >= MAX_DOCUMENTS_PER_USER) return json({ error: `Up to ${MAX_DOCUMENTS_PER_USER} documents per account.` }, 409);

  const checked = checkFile(Buffer.from(await file.arrayBuffer()), file.type);
  if (!checked.ok) { logSecurity('upload_rejected', `docs:${anonymizedIpHash(req) ?? 'x'}`, { detail: 'Document upload: ' + String(checked.reason).slice(0, 80) }); return json({ error: checked.reason }, 415); }
  const f = checked.file;

  const id = randomUUID();
  const path = `${user.id}/${id}.${f.ext}`;
  const up = await db.storage.from(DOCUMENT_BUCKET).upload(path, f.bytes, { contentType: f.mime, upsert: false });
  if (up.error) return json({ error: 'Saving failed.' }, 502);

  const row = {
    id,
    owner_id: user.id,
    object_ref: objectRef,
    category,
    filename: safeFilename(file.name),
    mime_type: f.mime,
    size_bytes: f.size,
    storage_key: path,
    sha256: f.sha256,
    classification: category,
    status: 'HOCHGELADEN',
    extraction: { ocr: 'not_configured', note: 'Content extraction (OCR) is not connected yet.' },
  };
  const ins = await db.from('lr_documents').insert(row);
  if (ins.error) {
    await db.storage.from(DOCUMENT_BUCKET).remove([path]);
    return json({ error: 'Saving failed.' }, 502);
  }
  await db.from('lr_document_events').insert({ document_id: id, owner_id: user.id, event_type: 'upload', metadata: { sha256: f.sha256, size: f.size, mime: f.mime } });
  return json({ document: { id, filename: row.filename, category, sha256: f.sha256, size_bytes: f.size, status: row.status } }, 201);
}

// Delete (privacy right to deletion): remove file and record.
export async function DELETE(req: Request) {
  if (!adminConfigured()) return json({ error: 'Document storage not configured.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Invalid request.' }, 400);
  const db = supabaseAdmin();
  const { data } = await db.from('lr_documents').select('storage_key').eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (!data) return json({ error: 'Document not found.' }, 404);
  if (data.storage_key) await db.storage.from(DOCUMENT_BUCKET).remove([data.storage_key]);
  await db.from('lr_documents').delete().eq('id', id).eq('owner_id', user.id);
  return json({ deleted: true });
}
