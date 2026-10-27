import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { drive } from '@/lib/booking/graph';
import { staticScan } from '@/lib/security/filescan';

// File exchange ("Send" links): senders only see "Add files"; the files go straight into the owner's connected OneDrive
// (folder "LeaseRun Inbox/<link name>"). The file travels from the sender's browser directly to Microsoft – not through
// our server – so files of several GB are possible. Downloading happens in the Web-Admin.
// LeaseRun has a single, LeaseRun-branded file exchange (no personal variant).
export type Style = 'leaserun';
// mode "in": the sender uploads (the owner downloads). mode "out": the owner uploads in the Web-Admin, the recipient downloads.
export type Mode = 'in' | 'out';
export type SendLink = { id: string; label: string; style: Style; mode?: Mode; at: string; active: boolean; until: string | null };
export type InboxFile = { id: string; name: string; size: number; at: string; link: string; cat: string | null; virus: string | null };

// Categories: the sender picks what the files are – they land in the matching subfolder.
export const CATS: Record<Style, string[]> = {
  leaserun: ['ID', 'Pay stubs', 'W-2', '1099', 'Tax returns', 'Bank statements', 'Purchase agreement', 'Leases', 'Insurance', 'LLC documents', 'Appraisal', 'Inspection report', 'HOA documents', 'Title documents', 'Other'],
};
export const catOk = (l: SendLink, c: unknown): string | null => (typeof c === 'string' && (CATS[l.style] || CATS.leaserun).includes(c) ? c : null);

// Malware protection, level 1: executables, scripts and macro documents are not accepted at all.
// Level 2: Microsoft Defender scans every file in OneDrive; a detection blocks the download.
const BLOCK = /\.(exe|com|scr|pif|bat|cmd|msi|msp|msc|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|dll|sys|gadget|application|appref-ms|scf|inf|docm|xlsm|pptm|dotm|xltm|iso|img|vhd|vhdx)$/i;
export const blockedType = (name: string) => BLOCK.test(String(name || '').trim());

const KEY = 'cloud_send_links';
export const ROOT = 'LeaseRun Inbox';
export const ROOT_OUT = 'LeaseRun Outbox';
export const MAX_BYTES = 20 * 1024 ** 3; // 20 GB per file
const cleanName = (s: string) => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 180) || 'file';
export const folderOf = (l: SendLink) => cleanName(`${l.label} (${l.id.slice(0, 6)})`);
export const pathOf = (l: SendLink) => `${l.mode === 'out' ? ROOT_OUT : ROOT}/${folderOf(l)}`;
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

// Raw list as stored (kept intact when saving – nothing is dropped from the stored data).
async function loadAll(): Promise<(Omit<SendLink, 'style'> & { style: string })[]> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  return Array.isArray(data?.value) ? (data!.value as (Omit<SendLink, 'style'> & { style: string })[]) : [];
}
// Only LeaseRun-branded links are used; any other stored style is ignored (not served, not listed).
export async function loadLinks(): Promise<SendLink[]> {
  return (await loadAll()).filter((l) => l.style === 'leaserun') as SendLink[];
}
const saveLinks = (v: unknown[]) => supabaseAdmin().from('lr_settings').upsert({ key: KEY, value: v });

export async function createLink(label: string, style: Style, days: number | null, mode: Mode = 'in'): Promise<SendLink> {
  void style;
  const l: SendLink = { id: randomBytes(12).toString('base64url'), label: String(label || 'Files').trim().slice(0, 60) || 'Files', style: 'leaserun', mode: mode === 'out' ? 'out' : 'in', at: new Date().toISOString(), active: true, until: days ? new Date(Date.now() + days * 864e5).toISOString() : null };
  await saveLinks([l, ...(await loadAll())].slice(0, 200));
  return l;
}
export async function updateLink(id: string, patch: Partial<Pick<SendLink, 'active' | 'label'>>): Promise<void> {
  const all = await loadAll();
  await saveLinks(all.map((l) => (l.id === id && l.style === 'leaserun' ? { ...l, ...patch, label: (patch.label ?? l.label).slice(0, 60) } : l)));
}
// Removing a link only removes the link – the files stay in OneDrive (nothing is deleted).
export async function removeLink(id: string): Promise<void> { await saveLinks((await loadAll()).filter((l) => !(l.id === id && l.style === 'leaserun'))); }

export async function linkFor(id: string): Promise<SendLink | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id)) return null;
  const l = (await loadLinks()).find((x) => x.id === id);
  if (!l || !l.active || (l.until && Date.parse(l.until) < Date.now())) return null;
  return l;
}

// Upload session at Microsoft: returns a pre-authorized address the browser sends the file to in chunks.
export async function uploadSession(l: SendLink, name: string, size: number, cat: string | null = null): Promise<string> {
  if (blockedType(name)) throw new TypeError('This file type isn’t allowed for security reasons.');
  const path = `${pathOf(l)}${cat ? `/${cleanName(cat)}` : ''}/${cleanName(name)}`;
  const j = await drive<{ uploadUrl?: string }>(`/root:/${enc(path)}:/createUploadSession`, { method: 'POST', body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' }, deferCommit: false }) });
  if (!j.uploadUrl) throw new Error('Microsoft didn’t return an upload address.');
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
      const push = (f: Item, cat: string | null) => { if (f.file) out.push({ id: f.id, name: f.name, size: Number(f.size || 0), at: f.createdDateTime || '', link: l.id, cat, virus: f.malware ? f.malware.description || 'Malware detected' : null }); };
      const subs: Item[] = [];
      for (const f of j.value || []) { if (f.folder) subs.push(f); else push(f, null); }
      // Subfolder = category (one level)
      await Promise.all(subs.map(async (d) => { const k = await drive<{ value?: Item[] }>(`/items/${encodeURIComponent(d.id)}/children?${SEL}`); for (const f of k.value || []) push(f, d.name); }));
    } catch (e) { if ((e as { status?: number }).status !== 404) throw e; }
  }));
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// Short-lived, pre-authorized download address from Microsoft (doesn't go through our server).
// Without a link (Web-Admin): any file from Inbox/Outbox. With a link (recipient): only files from exactly that folder.
export async function downloadUrl(itemId: string, only?: SendLink): Promise<string> {
  if (!/^[A-Za-z0-9!_.-]{6,80}$/.test(itemId)) throw new Error('Invalid file.');
  const j = await drive<{ '@microsoft.graph.downloadUrl'?: string; parentReference?: { path?: string }; malware?: { description?: string } }>(`/items/${encodeURIComponent(itemId)}`);
  if (j.malware) throw new Error('Malware found – download blocked.');
  const parent = decodeURIComponent(j.parentReference?.path || '');
  const ok = only ? parent.endsWith(`/${pathOf(only)}`) : parent.includes(`/${ROOT}/`) || parent.includes(`/${ROOT_OUT}/`);
  if (!ok) throw new Error('File not shared.');
  if (!j['@microsoft.graph.downloadUrl']) throw new Error('Download address not available.');
  return j['@microsoft.graph.downloadUrl'];
}

export async function webFolderUrl(): Promise<string | null> {
  try { return (await drive<{ webUrl?: string }>(`/root:/${enc(ROOT)}`)).webUrl || null; } catch { return null; }
}

// After uploading: also scan the link's new files (last 30 min) ourselves (executables, macros, scripts,
// PDF actions, ZIP contents). A hit → the file is deleted immediately (OneDrive recycle bin). Defender checks large files.
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
