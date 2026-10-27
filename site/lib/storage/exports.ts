import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Große Downloads (über 4,5 MB passen nicht in eine Funktionsantwort): Datei in den privaten Export-Speicher legen
// und einen 10 Minuten gültigen, signierten Link zurückgeben. Der tägliche Lauf löscht Exporte nach 24 Stunden.
export const EXPORT_BUCKET = 'immo-exports';

export async function storeExport(folder: string, filename: string, bytes: Uint8Array, contentType: 'application/pdf' | 'application/zip'): Promise<string> {
  const db = supabaseAdmin();
  const path = `${folder}/${randomUUID()}/${filename.replace(/[^\w.-]+/g, '_')}`;
  const up = await db.storage.from(EXPORT_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (up.error) throw new Error('Export konnte nicht abgelegt werden.');
  const s = await db.storage.from(EXPORT_BUCKET).createSignedUrl(path, 600, { download: filename });
  if (s.error || !s.data) throw new Error('Download-Link konnte nicht erstellt werden.');
  return s.data.signedUrl;
}

export async function cleanupExports(): Promise<number> {
  const db = supabaseAdmin();
  const store = db.storage.from(EXPORT_BUCKET);
  const cutoff = Date.now() - 864e5;
  let removed = 0;
  for (const folder of ['gesamt', 'datev']) {
    const { data: dirs } = await store.list(folder, { limit: 1000 });
    for (const d of dirs ?? []) {
      const { data: files } = await store.list(`${folder}/${d.name}`, { limit: 10 });
      const old = (files ?? []).filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff).map((f) => `${folder}/${d.name}/${f.name}`);
      if (old.length) { await store.remove(old); removed += old.length; }
    }
  }
  return removed;
}
