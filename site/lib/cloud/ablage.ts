import { drive } from '@/lib/booking/graph';
import { blockedType } from '@/lib/cloud/inbox';

// Meine Ablage (Web-Admin → System): Ferays eigener Speicher für wichtige Dokumente und Bilder. Liegt im verbundenen
// OneDrive im Ordner „Meine Ablage“ – nur im Web-Admin erreichbar, keine öffentlichen Links. Hoch- und Herunterladen läuft
// direkt zwischen Browser und Microsoft (nicht über den LeaseRun-Server). Gelöscht wird hier nichts.
export const ABLAGE = 'Meine Ablage';
export const START_FOLDERS = ['Dokumente', 'Bilder', 'Verträge', 'Steuer & Finanzen', 'Ausweise & Urkunden', 'Sonstiges'];

const clean = (s: string) => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
// Unterpfad innerhalb der Ablage: jede Ebene bereinigt, „..“ und leere Teile entfallen – nie außerhalb von „Meine Ablage“.
export const subPath = (p: unknown) => String(p || '').split('/').map(clean).filter((x) => x && x !== '..').slice(0, 8).join('/');
const full = (sub: string) => (sub ? `${ABLAGE}/${sub}` : ABLAGE);
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export type AblageItem = { id: string; name: string; folder: boolean; count: number; size: number; at: string; mime: string | null; thumb: string | null; virus: string | null; web: string | null };
type GItem = { id: string; name: string; webUrl?: string; size?: number; lastModifiedDateTime?: string; file?: { mimeType?: string }; folder?: { childCount?: number }; malware?: { description?: string }; thumbnails?: { medium?: { url?: string } }[] };

async function ensureRoot(): Promise<void> {
  try { await drive(`/root:/${enc(ABLAGE)}`); return; } catch (e) { if ((e as { status?: number }).status !== 404) throw e; }
  await drive('/root/children', { method: 'POST', body: JSON.stringify({ name: ABLAGE, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) }).catch(() => null);
  for (const n of START_FOLDERS) await drive(`/root:/${enc(ABLAGE)}:/children`, { method: 'POST', body: JSON.stringify({ name: n, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) }).catch(() => null);
}

export async function listAblage(p: unknown): Promise<{ path: string; items: AblageItem[]; web: string | null }> {
  const sub = subPath(p);
  await ensureRoot();
  const [meta, j] = await Promise.all([
    drive<{ webUrl?: string }>(`/root:/${enc(full(sub))}`).catch(() => ({ webUrl: undefined })),
    drive<{ value?: GItem[] }>(`/root:/${enc(full(sub))}:/children?$top=500&$expand=thumbnails($select=medium)&$select=id,name,size,lastModifiedDateTime,file,folder,malware,webUrl`),
  ]);
  const items = (j.value || []).map((f): AblageItem => ({
    id: f.id, name: f.name, folder: Boolean(f.folder), count: Number(f.folder?.childCount || 0), size: Number(f.size || 0), at: f.lastModifiedDateTime || '',
    mime: f.file?.mimeType || null, thumb: f.thumbnails?.[0]?.medium?.url || null, virus: f.malware ? f.malware.description || 'Schadsoftware erkannt' : null, web: f.webUrl || null,
  }));
  items.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name, 'de') : a.folder ? -1 : 1));
  return { path: sub, items, web: meta.webUrl || null };
}

export async function newFolder(p: unknown, name: unknown): Promise<void> {
  const n = clean(String(name || ''));
  if (!n) throw new TypeError('Bitte einen Ordnernamen angeben.');
  await ensureRoot();
  await drive(`/root:/${enc(full(subPath(p)))}:/children`, { method: 'POST', body: JSON.stringify({ name: n, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }) });
}

export async function ablageUpload(p: unknown, name: unknown): Promise<string> {
  const n = clean(String(name || ''));
  if (!n) throw new TypeError('Datei fehlt.');
  if (blockedType(n)) throw new TypeError('Dieser Dateityp ist aus Sicherheitsgründen nicht erlaubt.');
  await ensureRoot();
  const j = await drive<{ uploadUrl?: string }>(`/root:/${enc(`${full(subPath(p))}/${n}`)}:/createUploadSession`, { method: 'POST', body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' }, deferCommit: false }) });
  if (!j.uploadUrl) throw new Error('Microsoft hat keine Hochladeadresse geliefert.');
  return j.uploadUrl;
}

async function inAblage(id: string): Promise<{ '@microsoft.graph.downloadUrl'?: string; malware?: { description?: string } }> {
  if (!/^[A-Za-z0-9!_.-]{6,80}$/.test(id)) throw new Error('Ungültige Datei.');
  const j = await drive<{ '@microsoft.graph.downloadUrl'?: string; parentReference?: { path?: string }; malware?: { description?: string } }>(`/items/${encodeURIComponent(id)}`);
  if (!/\/root:\/Meine Ablage(\/|$)/.test(decodeURIComponent(j.parentReference?.path || ''))) throw new Error('Datei nicht in Meine Ablage.');
  return j;
}

// Umbenennen (Datei oder Ordner) – nur innerhalb der Ablage. Die Dateiendung bleibt erhalten, wenn sie weggelassen wurde.
export async function renameItem(itemId: unknown, name: unknown, old: unknown): Promise<void> {
  const id = String(itemId || '');
  await inAblage(id);
  let n = clean(String(name || ''));
  if (!n) throw new TypeError('Bitte einen Namen angeben.');
  const ext = /\.[A-Za-z0-9]{1,6}$/.exec(String(old || ''))?.[0];
  if (ext && !/\.[A-Za-z0-9]{1,6}$/.test(n)) n += ext;
  if (blockedType(n)) throw new TypeError('Dieser Dateityp ist aus Sicherheitsgründen nicht erlaubt.');
  await drive(`/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: n, '@microsoft.graph.conflictBehavior': 'rename' }) });
}

// Kurzlebige Download-Adresse – nur für Dateien, die wirklich in „Meine Ablage“ liegen.
export async function ablageFile(itemId: unknown): Promise<string> {
  const j = await inAblage(String(itemId || ''));
  if (j.malware) throw new Error('Virus gefunden – Download gesperrt.');
  if (!j['@microsoft.graph.downloadUrl']) throw new Error('Download-Adresse nicht verfügbar.');
  return j['@microsoft.graph.downloadUrl'];
}
