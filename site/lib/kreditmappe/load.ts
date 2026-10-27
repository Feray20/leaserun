import { ObjectSchema, ProfileSchema, type UploadedDoc } from '@/lib/kreditmappe/model';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import type { z } from 'zod';

export type MappeInput = { object: z.infer<typeof ObjectSchema>; profile: z.infer<typeof ProfileSchema>; uploads: UploadedDoc[] };

// Objekt und Profil mit dem Token des Nutzers laden (Row Level Security), Uploads serverseitig.
export async function loadMappeInput(req: Request, userId: string, objectId: string): Promise<{ ok: true; data: MappeInput } | { ok: false; status: number; error: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, status: 503, error: 'Datenbank nicht konfiguriert.' };
  const r = await fetch(`${url}/rest/v1/lr_user_data?select=profile,objects&user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
    headers: { apikey: key, Authorization: req.headers.get('authorization') || '' },
    cache: 'no-store',
  });
  if (!r.ok) return { ok: false, status: 502, error: 'Daten konnten nicht geladen werden.' };
  const rows = (await r.json()) as Array<{ profile?: unknown; objects?: unknown }>;
  const objects = Array.isArray(rows[0]?.objects) ? (rows[0]?.objects as unknown[]) : [];
  const raw = objects.find((x) => typeof x === 'object' && x !== null && (x as { id?: unknown }).id === objectId);
  const obj = ObjectSchema.safeParse(raw);
  if (!obj.success) return { ok: false, status: 422, error: 'Objekt nicht gefunden oder unvollständig. Bitte Kaufpreis und Pflichtangaben prüfen.' };
  const profile = ProfileSchema.safeParse(rows[0]?.profile ?? {});
  if (!profile.success) return { ok: false, status: 422, error: 'Profil unvollständig.' };

  let uploads: UploadedDoc[] = [];
  if (adminConfigured()) {
    const { data: docs } = await supabaseAdmin()
      .from('lr_documents')
      .select('filename, category, sha256, created_at')
      .eq('owner_id', userId)
      .eq('object_ref', objectId)
      .order('category');
    uploads = (docs ?? []).map((d) => ({ filename: String(d.filename), category: String(d.category ?? ''), sha256: String(d.sha256 ?? ''), createdAt: String(d.created_at) }));
  }
  return { ok: true, data: { object: obj.data, profile: profile.data, uploads } };
}
