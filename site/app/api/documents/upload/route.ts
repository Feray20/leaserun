import { logSecurity } from '@/lib/security/seclog';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';
import { cleanupIncoming } from '@/lib/documents/cleanup';
import { MAX_DIRECT_BYTES, MAX_DOCUMENTS_PER_USER, checkFile, isCategory, safeFilename } from '@/lib/documents/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const OBJ_RE = /^[A-Za-z0-9_-]{4,40}$/;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];
const incoming = (userId: string, id: string) => `${userId}/incoming/${id}`;

// Schritt 1: signierte Upload-URL ausstellen. Die Datei geht direkt in den privaten Speicher
// (nicht durch die Funktion), daher sind bis 50 MB möglich.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Dokumentenspeicher nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`upload:${user.id}`, 20, 60_000)) return json({ error: 'Zu viele Uploads. Bitte kurz warten.' }, 429);
  const b = (await req.json().catch(() => null)) as { objectRef?: unknown; category?: unknown; size?: unknown; type?: unknown } | null;
  if (!b || typeof b.objectRef !== 'string' || !OBJ_RE.test(b.objectRef)) return json({ error: 'Objekt fehlt.' }, 400);
  if (!isCategory(b.category)) return json({ error: 'Bitte eine Kategorie wählen.' }, 400);
  const size = Number(b.size);
  if (!Number.isFinite(size) || size <= 0) return json({ error: 'Die Datei ist leer.' }, 400);
  if (size > MAX_DIRECT_BYTES) return json({ error: 'Die Datei ist größer als 50 MB.' }, 413);
  if (typeof b.type !== 'string' || !ALLOWED.includes(b.type)) return json({ error: 'Erlaubt sind PDF, JPG, PNG und TIFF.' }, 415);

  const db = supabaseAdmin();
  const { count } = await db.from('lr_documents').select('id', { count: 'exact', head: true }).eq('owner_id', user.id);
  if ((count ?? 0) >= MAX_DOCUMENTS_PER_USER) return json({ error: `Maximal ${MAX_DOCUMENTS_PER_USER} Dokumente je Konto.` }, 409);

  // Liegengebliebene, nicht abgeschlossene Uploads dieses Nutzers nebenbei entfernen.
  await cleanupIncoming(user.id).catch(() => 0);
  const id = randomUUID();
  const { data, error } = await db.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(incoming(user.id, id));
  if (error || !data) return json({ error: 'Upload konnte nicht vorbereitet werden.' }, 502);
  return json({ id, signedUrl: data.signedUrl });
}

// Schritt 2: Datei serverseitig prüfen (Magic Bytes, Größe, SHA-256), an den endgültigen Ort
// verschieben und erfassen. Ungültige Dateien werden sofort gelöscht.
export async function PUT(req: Request) {
  if (!adminConfigured()) return json({ error: 'Dokumentenspeicher nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  const b = (await req.json().catch(() => null)) as { id?: unknown; objectRef?: unknown; category?: unknown; filename?: unknown } | null;
  if (!b || typeof b.id !== 'string' || !ID_RE.test(b.id)) return json({ error: 'Ungültige Anfrage.' }, 400);
  if (typeof b.objectRef !== 'string' || !OBJ_RE.test(b.objectRef)) return json({ error: 'Objekt fehlt.' }, 400);
  if (!isCategory(b.category)) return json({ error: 'Bitte eine Kategorie wählen.' }, 400);

  const db = supabaseAdmin();
  const src = incoming(user.id, b.id);
  const dl = await db.storage.from(DOCUMENT_BUCKET).download(src);
  if (dl.error || !dl.data) return json({ error: 'Hochgeladene Datei nicht gefunden.' }, 404);
  const bytes = Buffer.from(await dl.data.arrayBuffer());
  const checked = checkFile(bytes, dl.data.type, MAX_DIRECT_BYTES);
  if (!checked.ok) {
    await db.storage.from(DOCUMENT_BUCKET).remove([src]);
    logSecurity('upload_rejected', `docs:${anonymizedIpHash(req) ?? 'x'}`, { detail: 'Dokument-Upload: ' + String(checked.reason).slice(0, 80) });
    return json({ error: checked.reason }, 415);
  }
  const f = checked.file;
  const path = `${user.id}/${b.id}.${f.ext}`;
  const mv = await db.storage.from(DOCUMENT_BUCKET).move(src, path);
  if (mv.error) {
    await db.storage.from(DOCUMENT_BUCKET).remove([src]);
    return json({ error: 'Speichern fehlgeschlagen.' }, 502);
  }
  const row = {
    id: b.id,
    owner_id: user.id,
    object_ref: b.objectRef,
    category: b.category,
    filename: safeFilename(typeof b.filename === 'string' ? b.filename : ''),
    mime_type: f.mime,
    size_bytes: f.size,
    storage_key: path,
    sha256: f.sha256,
    classification: b.category,
    status: 'HOCHGELADEN',
    extraction: { ocr: 'not_configured', note: 'Inhaltliche Auswertung (OCR) ist noch nicht angebunden.' },
  };
  const ins = await db.from('lr_documents').insert(row);
  if (ins.error) {
    await db.storage.from(DOCUMENT_BUCKET).remove([path]);
    return json({ error: 'Speichern fehlgeschlagen.' }, 502);
  }
  await db.from('lr_document_events').insert({ document_id: b.id, owner_id: user.id, event_type: 'upload', metadata: { sha256: f.sha256, size: f.size, mime: f.mime, via: 'signed_url' } });
  return json({ document: { id: b.id, filename: row.filename, category: row.category, sha256: f.sha256, size_bytes: f.size, status: row.status } }, 201);
}
