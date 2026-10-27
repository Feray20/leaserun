// Standard-Material für Creator (Logos und Screenshots aus public/creator-kit): wird beim ersten Aufruf der
// Material-Seite einmalig in den privaten Speicher „creator-assets“ übernommen und dort wie hochgeladenes Material
// verwaltet (Admin kann es bearbeiten, deaktivieren oder ersetzen). Textvorlagen werden per Datenbank angelegt.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ASSET_BUCKET } from '@/lib/creator/server';

const KEY = 'creator_kit_v1';
const LOGO_NOTE = 'Nicht verzerren, umfärben oder mit Effekten versehen. Rundherum etwas Freiraum lassen.';
const SHOT_NOTE = 'Echte Ansicht von leaserun.com. Ausschnitte und Größenänderungen sind erlaubt, Inhalte bitte nicht verändern.';
const FILES: { file: string; title: string; kind: 'logo' | 'image'; description: string; usage_notes: string }[] = [
  { file: 'leaserun-logo-blau.png', title: 'LeaseRun Logo (blau)', kind: 'logo', description: 'Für helle Hintergründe. Transparent, 2400 px breit.', usage_notes: LOGO_NOTE },
  { file: 'leaserun-logo-weiss.png', title: 'LeaseRun Logo (weiß)', kind: 'logo', description: 'Für dunkle Hintergründe und Fotos. Transparent, 2400 px breit.', usage_notes: LOGO_NOTE },
  { file: 'leaserun-symbol.png', title: 'LeaseRun Symbol', kind: 'logo', description: 'Nur das Bildzeichen, z. B. für Profilbild-Overlays oder kleine Flächen. Transparent, 1024 px.', usage_notes: LOGO_NOTE },
  { file: 'screenshot-startseite-story.png', title: 'Screenshot Startseite (Story-Format)', kind: 'image', description: 'Hochformat für Stories, Reels und TikTok (1080 × 1920).', usage_notes: SHOT_NOTE },
  { file: 'screenshot-kaufnebenkosten-rechner-story.png', title: 'Screenshot Kaufnebenkosten-Rechner (Story-Format)', kind: 'image', description: 'Hochformat (1080 × 1920): Grunderwerbsteuer je Bundesland.', usage_notes: SHOT_NOTE },
  { file: 'screenshot-kreditmappe-beispiel-story.png', title: 'Screenshot Muster-Kreditmappe (Story-Format)', kind: 'image', description: 'Hochformat (1080 × 1920): So sieht die Kreditmappe aus (Musterfall).', usage_notes: SHOT_NOTE },
  { file: 'screenshot-startseite-desktop.png', title: 'Screenshot Startseite (Desktop)', kind: 'image', description: 'Querformat 1440 × 900, z. B. für YouTube und Präsentationen.', usage_notes: SHOT_NOTE },
  { file: 'screenshot-kaufnebenkosten-rechner-desktop.png', title: 'Screenshot Kaufnebenkosten-Rechner (Desktop)', kind: 'image', description: 'Querformat 1440 × 900.', usage_notes: SHOT_NOTE },
  { file: 'screenshot-kreditmappe-beispiel-desktop.png', title: 'Screenshot Muster-Kreditmappe (Desktop)', kind: 'image', description: 'Querformat 1440 × 900.', usage_notes: SHOT_NOTE },
];

export async function ensureCreatorKit(origin: string): Promise<void> {
  const db = supabaseAdmin();
  // Sperre: nur ein Aufruf legt das Material an; danach nie wieder.
  let lock = await db.from('lr_settings').insert({ key: KEY, value: 'running', updated_by: 'system:creator-kit' });
  if (lock.error) {
    // Abgebrochener Lauf (z. B. Zeitlimit): Sperre nach 5 Minuten freigeben und erneut versuchen.
    const { data: cur } = await db.from('lr_settings').select('value, updated_at').eq('key', KEY).maybeSingle();
    const stale = cur?.value === 'running' && Date.now() - new Date(cur.updated_at as string).getTime() > 5 * 60_000;
    if (!stale) return;
    await db.from('lr_settings').delete().eq('key', KEY);
    lock = await db.from('lr_settings').insert({ key: KEY, value: 'running', updated_by: 'system:creator-kit' });
    if (lock.error) return;
  }
  try {
    const { data: have } = await db.from('lr_creator_assets').select('title').eq('created_by', 'system:creator-kit');
    const done = new Set(((have ?? []) as { title: string }[]).map((x) => x.title));
    for (const f of FILES) {
      if (done.has(f.title)) continue; // bei einem zweiten Versuch keine Doppelungen
      // Zuerst aus dem Programmpaket lesen (siehe outputFileTracingIncludes), sonst über die Website laden.
      let buf: Buffer | null = await readFile(join(process.cwd(), 'public', 'creator-kit', f.file)).catch(() => null);
      if (!buf) {
        const r = await fetch(`${origin}/creator-kit/${f.file}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${f.file}: HTTP ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
      }
      const id = randomUUID(), path = `assets/${id}/${f.file}`;
      const up = await db.storage.from(ASSET_BUCKET).upload(path, buf, { contentType: 'image/png', upsert: false });
      if (up.error) throw new Error(`${f.file}: ${up.error.message}`);
      const ins = await db.from('lr_creator_assets').insert({ id, title: f.title, description: f.description, usage_notes: f.usage_notes, kind: f.kind, storage_path: path, mime: 'image/png', size_bytes: buf.length, active: true, created_by: 'system:creator-kit' });
      if (ins.error) throw new Error(`${f.file}: ${ins.error.message}`);
    }
    await db.from('lr_settings').update({ value: 'done', updated_at: new Date().toISOString() }).eq('key', KEY);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error('creator_kit', why);
    // Fehler für die Admin-Zentrale festhalten; beim nächsten Aufruf erneut versuchen (bereits übernommene Dateien bleiben).
    await db.from('lr_settings').upsert({ key: KEY + '_error', value: { at: new Date().toISOString(), error: why.slice(0, 300) }, updated_by: 'system:creator-kit' }).then(() => null, () => null);
    await db.from('lr_settings').delete().eq('key', KEY);
  }
}
