import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { drive } from '@/lib/booking/graph';
import { staticScan } from '@/lib/security/filescan';

// Dateiempfang („Senden“-Links): Absender sehen nur „Anhang hinzufügen“, die Dateien landen direkt in Ferays OneDrive
// (Ordner „LeaseRun Eingang/<Name des Links>“). Die Datei läuft vom Browser des Absenders direkt zu Microsoft – nicht über
// unseren Server –, daher sind auch Dateien mit mehreren GB möglich. Heruntergeladen wird im Web-Admin.
export type Style = 'leaserun' | 'feray';
// mode „in“: Absender lädt hoch (Feray lädt herunter). mode „out“: Feray lädt im Web-Admin hoch, der Empfänger lädt herunter.
export type Mode = 'in' | 'out';
export type SendLink = { id: string; label: string; style: Style; mode?: Mode; at: string; active: boolean; until: string | null };
export type InboxFile = { id: string; name: string; size: number; at: string; link: string; cat: string | null; virus: string | null };

// Kategorien je Auftritt: der Absender wählt, worum es geht – die Datei landet im passenden Unterordner.
export const CATS: Record<Style, string[]> = {
  leaserun: ['Exposé', 'Grundbuch', 'Finanzierung', 'Vertrag', 'Rechnung', 'Fotos', 'Sonstiges'],
  feray: ['Lohn & Gehalt', 'Steuer', 'Vertrag', 'Rechnung', 'Bescheinigung', 'Bank', 'Sonstiges'],
};
export const catOk = (l: SendLink, c: unknown): string | null => (typeof c === 'string' && CATS[l.style].includes(c) ? c : null);

// Virenschutz, Stufe 1: ausführbare Programme, Skripte und Makro-Dokumente werden gar nicht angenommen.
// Stufe 2: Microsoft Defender prüft jede Datei in OneDrive; ein Fund sperrt den Download.
const BLOCK = /\.(exe|com|scr|pif|bat|cmd|msi|msp|msc|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|dll|sys|gadget|application|appref-ms|scf|inf|docm|xlsm|pptm|dotm|xltm|iso|img|vhd|vhdx)$/i;
export const blockedType = (name: string) => BLOCK.test(String(name || '').trim());

const KEY = 'cloud_send_links';
export const ROOT = 'LeaseRun Eingang';
export const ROOT_OUT = 'LeaseRun Ausgang';
export const MAX_BYTES = 20 * 1024 ** 3; // 20 GB je Datei
const cleanName = (s: string) => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 180) || 'datei';
export const folderOf = (l: SendLink) => cleanName(`${l.label} (${l.id.slice(0, 6)})`);
export const pathOf = (l: SendLink) => `${l.mode === 'out' ? ROOT_OUT : ROOT}/${folderOf(l)}`;
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export async function loadLinks(): Promise<SendLink[]> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  return Array.isArray(data?.value) ? (data!.value as SendLink[]) : [];
}
const saveLinks = (v: SendLink[]) => supabaseAdmin().from('lr_settings').upsert({ key: KEY, value: v });

export async function createLink(label: string, style: Style, days: number | null, mode: Mode = 'in'): Promise<SendLink> {
  const l: SendLink = { id: randomBytes(12).toString('base64url'), label: String(label || 'Dateien').trim().slice(0, 60) || 'Dateien', style: style === 'feray' ? 'feray' : 'leaserun', mode: mode === 'out' ? 'out' : 'in', at: new Date().toISOString(), active: true, until: days ? new Date(Date.now() + days * 864e5).toISOString() : null };
  await saveLinks([l, ...(await loadLinks())].slice(0, 200));
  return l;
}
export async function updateLink(id: string, patch: Partial<Pick<SendLink, 'active' | 'label'>>): Promise<void> {
  const all = await loadLinks();
  await saveLinks(all.map((l) => (l.id === id ? { ...l, ...patch, label: (patch.label ?? l.label).slice(0, 60) } : l)));
}
// Link entfernen löscht nur den Link – die Dateien bleiben in OneDrive (nichts wird gelöscht).
export async function removeLink(id: string): Promise<void> { await saveLinks((await loadLinks()).filter((l) => l.id !== id)); }

export async function linkFor(id: string): Promise<SendLink | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return null;
  const l = (await loadLinks()).find((x) => x.id === id);
  if (!l || !l.active || (l.until && Date.parse(l.until) < Date.now())) return null;
  return l;
}

// Hochladesitzung bei Microsoft: liefert eine vorab berechtigte Adresse, an die der Browser die Datei in Teilen schickt.
export async function uploadSession(l: SendLink, name: string, size: number, cat: string | null = null): Promise<string> {
  if (blockedType(name)) throw new TypeError('Dieser Dateityp ist aus Sicherheitsgründen nicht erlaubt.');
  const path = `${pathOf(l)}${cat ? `/${cleanName(cat)}` : ''}/${cleanName(name)}`;
  const j = await drive<{ uploadUrl?: string }>(`/root:/${enc(path)}:/createUploadSession`, { method: 'POST', body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' }, deferCommit: false }) });
  if (!j.uploadUrl) throw new Error('Microsoft hat keine Hochladeadresse geliefert.');
  void size;
  return j.uploadUrl;
}

type Item = { id: string; name: string; size?: number; createdDateTime?: string; file?: object; folder?: { childCount?: number }; malware?: { description?: string } };
const SEL = '$top=200&$select=id,name,size,createdDateTime,file,folder,malware';
export async function listFiles(links: SendLink[]): Promise<InboxFile[]> {
  const out: InboxFile[] = [];
  await Promise.all(links.map(async (l) => {
    try {
      const j = await drive<{ value?: Item[] }>(`/root:/${enc(pathOf(l))}:/children?${SEL}`);
      const push = (f: Item, cat: string | null) => { if (f.file) out.push({ id: f.id, name: f.name, size: Number(f.size || 0), at: f.createdDateTime || '', link: l.id, cat, virus: f.malware ? f.malware.description || 'Schadsoftware erkannt' : null }); };
      const subs: Item[] = [];
      for (const f of j.value || []) { if (f.folder) subs.push(f); else push(f, null); }
      // Unterordner = Kategorie (eine Ebene)
      await Promise.all(subs.map(async (d) => { const k = await drive<{ value?: Item[] }>(`/items/${encodeURIComponent(d.id)}/children?${SEL}`); for (const f of k.value || []) push(f, d.name); }));
    } catch (e) { if ((e as { status?: number }).status !== 404) throw e; }
  }));
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// Kurzlebige, vorab berechtigte Download-Adresse von Microsoft (läuft nicht über unseren Server).
// Ohne Link (Web-Admin): jede Datei aus Eingang/Ausgang. Mit Link (Empfänger): nur Dateien genau aus dessen Ordner.
export async function downloadUrl(itemId: string, only?: SendLink): Promise<string> {
  if (!/^[A-Za-z0-9!_.-]{6,80}$/.test(itemId)) throw new Error('Ungültige Datei.');
  const j = await drive<{ '@microsoft.graph.downloadUrl'?: string; parentReference?: { path?: string }; malware?: { description?: string } }>(`/items/${encodeURIComponent(itemId)}`);
  if (j.malware) throw new Error('Virus gefunden – Download gesperrt.');
  const parent = decodeURIComponent(j.parentReference?.path || '');
  const ok = only ? parent.endsWith(`/${pathOf(only)}`) : parent.includes(`/${ROOT}/`) || parent.includes(`/${ROOT_OUT}/`);
  if (!ok) throw new Error('Datei nicht freigegeben.');
  if (!j['@microsoft.graph.downloadUrl']) throw new Error('Download-Adresse nicht verfügbar.');
  return j['@microsoft.graph.downloadUrl'];
}

export async function webFolderUrl(): Promise<string | null> {
  try { return (await drive<{ webUrl?: string }>(`/root:/${enc(ROOT)}`)).webUrl || null; } catch { return null; }
}

// Nach dem Hochladen: neue Dateien des Links (letzte 30 Min.) zusätzlich selbst prüfen (Programme, Makros, Skripte,
// PDF-Funktionen, ZIP-Inhalte). Fund → Datei wird sofort gelöscht (OneDrive-Papierkorb). Große Dateien prüft Defender.
export async function scanRecent(l: SendLink): Promise<{ checked: number; removed: string[] }> {
  const since = Date.now() - 30 * 60_000, removed: string[] = [];
  let checked = 0, budget = 200 * 1024 * 1024;
  const files = (await listFiles([l])).filter((f) => Date.parse(f.at) >= since).slice(0, 25);
  for (const f of files) {
    if (f.virus) { await drive(`/items/${encodeURIComponent(f.id)}`, { method: 'DELETE' }).catch(() => null); removed.push(f.name); continue; }
    if (f.size > 60 * 1024 * 1024 || f.size > budget) continue;
    const it = await drive<{ '@microsoft.graph.downloadUrl'?: string }>(`/items/${encodeURIComponent(f.id)}`).catch(() => null);
    const url = it?.['@microsoft.graph.downloadUrl']; if (!url) continue;
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) }).catch(() => null);
    if (!r || !r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer()); budget -= buf.length; checked++;
    if (!staticScan(buf).clean) { await drive(`/items/${encodeURIComponent(f.id)}`, { method: 'DELETE' }).catch(() => null); removed.push(f.name); }
  }
  return { checked, removed };
}
