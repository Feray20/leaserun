import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { DriveConsentError, graphReady } from '@/lib/booking/graph';
import { ablageFile, ablageUpload, listAblage, newFolder, renameItem } from '@/lib/cloud/ablage';
import { createLink, downloadUrl, listFiles, loadLinks, removeLink, updateLink, uploadSession, webFolderUrl, linkFor, type Mode, type Style } from '@/lib/cloud/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → System → Files ("My cloud"): manage links, download received files, upload files for pickup.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  const links = await loadLinks();
  if (!(await graphReady())) return j({ connected: false, links, files: [] });
  try {
    const [files, folder] = await Promise.all([listFiles(links), webFolderUrl()]);
    return j({ connected: true, links, files, folder });
  } catch (e) {
    return j({ connected: true, consent: e instanceof DriveConsentError, error: (e as Error).message, links, files: [] });
  }
}

export async function POST(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; label?: string; style?: Style; mode?: Mode; days?: number; active?: boolean; name?: string; size?: number; item?: string; path?: string; old?: string };
  try {
    switch (b.action) {
      case 'create': return j({ link: await createLink(String(b.label || ''), 'leaserun', b.days && b.days > 0 ? Math.min(365, b.days) : null, b.mode === 'out' ? 'out' : 'in'), links: await loadLinks() });
      case 'toggle': await updateLink(String(b.id), { active: Boolean(b.active) }); return j({ links: await loadLinks() });
      case 'remove': await removeLink(String(b.id)); return j({ links: await loadLinks() });
      case 'download': return j({ url: await downloadUrl(String(b.item || '')) });
      // Archive (own storage for documents and images)
      case 'ablage': return j(await listAblage(b.path));
      case 'ablage-folder': await newFolder(b.path, b.name); return j(await listAblage(b.path));
      case 'ablage-upload': return j({ uploadUrl: await ablageUpload(b.path, b.name) });
      case 'ablage-rename': await renameItem(b.item, b.name, b.old); return j(await listAblage(b.path));
      case 'ablage-open': return j({ url: await ablageFile(b.item) });
      case 'upload': {
        const l = await linkFor(String(b.id || ''));
        if (!l || l.mode !== 'out') return j({ error: 'Link not active.' }, 400);
        if (!b.name || !(Number(b.size) > 0)) return j({ error: 'File missing.' }, 400);
        return j({ uploadUrl: await uploadSession(l, String(b.name), Number(b.size)) });
      }
      default: return j({ error: 'Unknown action.' }, 400);
    }
  } catch (e) {
    if (e instanceof TypeError && /file type|folder name|File missing|enter a name/.test(e.message)) return j({ error: e.message }, 400);
    return j({ error: e instanceof DriveConsentError ? 'OneDrive access not granted yet – under Appointments, choose "Connect with Microsoft" once.' : (e as Error).message }, e instanceof DriveConsentError ? 409 : 500);
  }
}
