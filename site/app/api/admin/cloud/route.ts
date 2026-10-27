import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { DriveConsentError, graphReady } from '@/lib/booking/graph';
import { ablageFile, ablageUpload, listAblage, newFolder, renameItem } from '@/lib/cloud/ablage';
import { createLink, downloadUrl, listFiles, loadLinks, removeLink, updateLink, uploadSession, webFolderUrl, linkFor, type Mode, type Style } from '@/lib/cloud/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → System → Dateien: Links verwalten, empfangene Dateien herunterladen, Dateien zum Abholen hochladen.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  const links = await loadLinks(), personal = (process.env.FERAY_CLOUD_HOST || '').trim() || null;
  if (!(await graphReady())) return j({ connected: false, links, files: [], personal });
  try {
    const [files, folder] = await Promise.all([listFiles(links), webFolderUrl()]);
    return j({ connected: true, links, files, folder, personal });
  } catch (e) {
    return j({ connected: true, consent: e instanceof DriveConsentError, error: (e as Error).message, links, files: [], personal });
  }
}

export async function POST(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; label?: string; style?: Style; mode?: Mode; days?: number; active?: boolean; name?: string; size?: number; item?: string; path?: string; old?: string };
  try {
    switch (b.action) {
      case 'create': return j({ link: await createLink(String(b.label || ''), b.style === 'feray' ? 'feray' : 'leaserun', b.days && b.days > 0 ? Math.min(365, b.days) : null, b.mode === 'out' ? 'out' : 'in'), links: await loadLinks() });
      case 'toggle': await updateLink(String(b.id), { active: Boolean(b.active) }); return j({ links: await loadLinks() });
      case 'remove': await removeLink(String(b.id)); return j({ links: await loadLinks() });
      case 'download': return j({ url: await downloadUrl(String(b.item || '')) });
      // Meine Ablage (eigener Speicher für Dokumente und Bilder)
      case 'ablage': return j(await listAblage(b.path));
      case 'ablage-folder': await newFolder(b.path, b.name); return j(await listAblage(b.path));
      case 'ablage-upload': return j({ uploadUrl: await ablageUpload(b.path, b.name) });
      case 'ablage-rename': await renameItem(b.item, b.name, b.old); return j(await listAblage(b.path));
      case 'ablage-open': return j({ url: await ablageFile(b.item) });
      case 'upload': {
        const l = await linkFor(String(b.id || ''));
        if (!l || l.mode !== 'out') return j({ error: 'Link nicht aktiv.' }, 400);
        if (!b.name || !(Number(b.size) > 0)) return j({ error: 'Datei fehlt.' }, 400);
        return j({ uploadUrl: await uploadSession(l, String(b.name), Number(b.size)) });
      }
      default: return j({ error: 'Unbekannte Aktion.' }, 400);
    }
  } catch (e) {
    if (e instanceof TypeError && /Dateityp|Ordnername|Datei fehlt|Namen angeben/.test(e.message)) return j({ error: e.message }, 400);
    return j({ error: e instanceof DriveConsentError ? 'OneDrive noch nicht freigegeben – unter Termine einmal „Mit Microsoft anmelden“.' : (e as Error).message }, e instanceof DriveConsentError ? 409 : 500);
  }
}
