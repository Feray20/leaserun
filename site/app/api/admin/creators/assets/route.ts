import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ASSET_BUCKET, audit, j, requireCreatorAdmin } from '@/lib/creator/server';
import { ensureCreatorKit } from '@/lib/creator/kit';
import { staticScan, threatMessage } from '@/lib/security/filescan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Asset Library pflegen. Dateien gehen direkt vom Browser in den privaten Speicher (signierter Upload-Link,
// einmalig gültig) – so funktionieren auch große Videos. Erst nach der Prüfung (finalize) wird das Asset sichtbar.
const MIME: Record<string, { kind: string[]; max: number }> = {
  'image/png': { kind: ['image', 'logo'], max: 25 << 20 }, 'image/jpeg': { kind: ['image', 'logo'], max: 25 << 20 }, 'image/webp': { kind: ['image', 'logo'], max: 25 << 20 },
  'video/mp4': { kind: ['video'], max: 500 << 20 }, 'video/quicktime': { kind: ['video'], max: 500 << 20 },
  'application/pdf': { kind: ['document'], max: 50 << 20 }, 'application/zip': { kind: ['document', 'logo', 'image'], max: 200 << 20 },
};
const fileName = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '').slice(-120) || 'datei';

const Base = { campaign_id: z.string().uuid().nullable().optional(), title: z.string().trim().min(2).max(140), description: z.string().trim().max(1000).nullable().optional(), usage_notes: z.string().trim().max(1000).nullable().optional() };
const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upload'), kind: z.enum(['image', 'video', 'document', 'logo']), filename: z.string().min(1).max(200), mime: z.string().max(100), size: z.number().int().positive(), ...Base }),
  z.object({ action: z.literal('finalize'), id: z.string().uuid() }),
  z.object({ action: z.literal('text'), text_body: z.string().trim().min(3).max(8000), ...Base }),
  z.object({ action: z.literal('toggle'), id: z.string().uuid(), active: z.boolean() }),
]);

export async function GET(req: Request) {
  const a = await requireCreatorAdmin(req, 'creators.list');
  if (!('role' in a)) return a;
  await ensureCreatorKit(new URL(req.url).origin).catch(() => null);
  const { data } = await supabaseAdmin().from('lr_creator_assets').select('id, campaign_id, title, description, kind, mime, size_bytes, text_body, usage_notes, active, created_at, storage_path').order('created_at', { ascending: false }).limit(500);
  return j({ assets: ((data ?? []) as { storage_path: string | null }[]).map(({ storage_path, ...x }) => ({ ...x, file: storage_path ? storage_path.split('/').pop() : null })) });
}

export async function POST(req: Request) {
  const a = await requireCreatorAdmin(req, 'campaigns.manage');
  if (!('role' in a)) return a;
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Ungültig.' }, 400);
  const d = p.data, db = supabaseAdmin();

  if (d.action === 'upload') {
    const rule = MIME[d.mime];
    if (!rule || !rule.kind.includes(d.kind)) return j({ error: 'Dateityp nicht erlaubt (PNG, JPG, WebP, MP4, MOV, PDF, ZIP).' }, 400);
    if (d.size > rule.max) return j({ error: `Datei zu groß (max. ${Math.round(rule.max / 1048576)} MB).` }, 400);
    const id = randomUUID();
    const path = `assets/${id}/${fileName(d.filename)}`;
    const up = await db.storage.from(ASSET_BUCKET).createSignedUploadUrl(path);
    if (up.error || !up.data) return j({ error: 'Upload gerade nicht möglich.' }, 502);
    const ins = await db.from('lr_creator_assets').insert({ id, campaign_id: d.campaign_id ?? null, title: d.title, description: d.description || null, usage_notes: d.usage_notes || null, kind: d.kind, storage_path: path, mime: d.mime, size_bytes: d.size, active: false, created_by: a.actor.ref });
    if (ins.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
    return j({ id, upload_url: up.data.signedUrl, token: up.data.token });
  }

  if (d.action === 'finalize') {
    const { data: row } = await db.from('lr_creator_assets').select('id, storage_path, mime, size_bytes, title').eq('id', d.id).maybeSingle();
    if (!row?.storage_path) return j({ error: 'Nicht gefunden.' }, 404);
    const [dir, name] = [row.storage_path.split('/').slice(0, -1).join('/'), row.storage_path.split('/').pop()];
    const { data: files } = await db.storage.from(ASSET_BUCKET).list(dir, { limit: 5 });
    const f = (files ?? []).find((x: { name: string }) => x.name === name) as { metadata?: { size?: number; mimetype?: string } } | undefined;
    const size = Number(f?.metadata?.size ?? 0), mime = String(f?.metadata?.mimetype ?? '');
    // Hochgeladene Datei muss zur Anmeldung passen (Typ und Größe), sonst wird sie verworfen.
    if (!f || mime !== row.mime || !size || size > Number(row.size_bytes) * 1.01 + 1024) {
      await db.storage.from(ASSET_BUCKET).remove([row.storage_path]);
      return j({ error: 'Die hochgeladene Datei passt nicht zur Anmeldung und wurde verworfen.' }, 400);
    }
    // Virenprüfung: bis 80 MB die ganze Datei, größere Videos über die ersten 2 MB (Programm-/Signaturprüfung).
    {
      let buf: Buffer | null = null;
      if (size <= 80 * 1024 * 1024) { const dl = await db.storage.from(ASSET_BUCKET).download(row.storage_path); buf = dl.data ? Buffer.from(await dl.data.arrayBuffer()) : null; }
      else { const su = await db.storage.from(ASSET_BUCKET).createSignedUrl(row.storage_path, 120); if (su.data) { const r = await fetch(su.data.signedUrl, { headers: { Range: 'bytes=0-2097151' }, signal: AbortSignal.timeout(20000) }).catch(() => null); buf = r && r.ok ? Buffer.from(await r.arrayBuffer()) : null; } }
      const scan = buf ? staticScan(buf) : { clean: false as const, threat: 'Datei nicht lesbar', engine: 'leaserun' };
      if (!scan.clean) { await db.storage.from(ASSET_BUCKET).remove([row.storage_path]); return j({ error: threatMessage(scan) }, 422); }
    }
    await db.from('lr_creator_assets').update({ active: true, size_bytes: size }).eq('id', d.id);
    await audit('ASSET_CHANGED', null, a.actor, 'SUCCESS', { asset: d.id.slice(0, 8), action: 'upload' });
    return j({ ok: true });
  }

  if (d.action === 'text') {
    const ins = await db.from('lr_creator_assets').insert({ campaign_id: d.campaign_id ?? null, title: d.title, description: d.description || null, usage_notes: d.usage_notes || null, kind: 'text', text_body: d.text_body, active: true, created_by: a.actor.ref }).select('id').single();
    if (ins.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
    await audit('ASSET_CHANGED', null, a.actor, 'SUCCESS', { asset: String((ins.data as { id: string }).id).slice(0, 8), action: 'text' });
    return j({ ok: true });
  }

  const { error } = await db.from('lr_creator_assets').update({ active: d.active }).eq('id', d.id);
  if (error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  await audit('ASSET_CHANGED', null, a.actor, 'SUCCESS', { asset: d.id.slice(0, 8), active: d.active });
  return j({ ok: true });
}
