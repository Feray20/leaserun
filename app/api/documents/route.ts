import { logSecurity } from '@/lib/security/seclog';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORIES, MAX_DOCUMENTS_PER_USER, checkFile, isCategory, safeFilename } from '@/lib/documents/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const OBJ_RE = /^[A-Za-z0-9_-]{4,40}$/;

// Liste der eigenen Dokumente, optional je Objekt.
export async function GET(req: Request) {
  if (!adminConfigured()) return json({ error: 'Dokumentenspeicher nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  const objectRef = new URL(req.url).searchParams.get('objectRef');
  let q = supabaseAdmin()
    .from('immo_documents')
    .select('id, object_ref, category, filename, mime_type, size_bytes, sha256, status, created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (objectRef && OBJ_RE.test(objectRef)) q = q.eq('object_ref', objectRef);
  const { data, error } = await q;
  if (error) return json({ error: 'Dokumente konnten nicht geladen werden.' }, 502);
  return json({ documents: data ?? [], categories: CATEGORIES });
}

// Upload: Dateityp über Magic Bytes, Größe, SHA-256; Original wird unveränderbar abgelegt.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Dokumentenspeicher nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`upload:${user.id}`, 20, 60_000)) return json({ error: 'Zu viele Uploads. Bitte kurz warten.' }, 429);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'Upload fehlgeschlagen (maximal 4 MB je Datei).' }, 400);
  }
  const file = form.get('file');
  const objectRef = String(form.get('objectRef') ?? '');
  const category = form.get('category');
  if (!(file instanceof File)) return json({ error: 'Keine Datei übermittelt.' }, 400);
  if (!OBJ_RE.test(objectRef)) return json({ error: 'Objekt fehlt.' }, 400);
  if (!isCategory(category)) return json({ error: 'Bitte eine Kategorie wählen.' }, 400);

  const db = supabaseAdmin();
  const { count } = await db.from('immo_documents').select('id', { count: 'exact', head: true }).eq('owner_id', user.id);
  if ((count ?? 0) >= MAX_DOCUMENTS_PER_USER) return json({ error: `Maximal ${MAX_DOCUMENTS_PER_USER} Dokumente je Konto.` }, 409);

  const checked = checkFile(Buffer.from(await file.arrayBuffer()), file.type);
  if (!checked.ok) { logSecurity('upload_rejected', `docs:${anonymizedIpHash(req) ?? 'x'}`, { detail: 'Dokument-Upload: ' + String(checked.reason).slice(0, 80) }); return json({ error: checked.reason }, 415); }
  const f = checked.file;

  const id = randomUUID();
  const path = `${user.id}/${id}.${f.ext}`;
  const up = await db.storage.from(DOCUMENT_BUCKET).upload(path, f.bytes, { contentType: f.mime, upsert: false });
  if (up.error) return json({ error: 'Speichern fehlgeschlagen.' }, 502);

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
    extraction: { ocr: 'not_configured', note: 'Inhaltliche Auswertung (OCR) ist noch nicht angebunden.' },
  };
  const ins = await db.from('immo_documents').insert(row);
  if (ins.error) {
    await db.storage.from(DOCUMENT_BUCKET).remove([path]);
    return json({ error: 'Speichern fehlgeschlagen.' }, 502);
  }
  await db.from('immo_document_events').insert({ document_id: id, owner_id: user.id, event_type: 'upload', metadata: { sha256: f.sha256, size: f.size, mime: f.mime } });
  return json({ document: { id, filename: row.filename, category, sha256: f.sha256, size_bytes: f.size, status: row.status } }, 201);
}

// Löschen (DSGVO): Datei und Datensatz entfernen.
export async function DELETE(req: Request) {
  if (!adminConfigured()) return json({ error: 'Dokumentenspeicher nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Ungültige Anfrage.' }, 400);
  const db = supabaseAdmin();
  const { data } = await db.from('immo_documents').select('storage_key').eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (!data) return json({ error: 'Dokument nicht gefunden.' }, 404);
  if (data.storage_key) await db.storage.from(DOCUMENT_BUCKET).remove([data.storage_key]);
  await db.from('immo_documents').delete().eq('id', id).eq('owner_id', user.id);
  return json({ deleted: true });
}
