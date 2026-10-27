import { NextResponse } from 'next/server';
import { anonymizedIpHash } from '@/lib/supabase/admin';
import { allowRequest } from '@/lib/security/rate-limit';
import { durableAllow } from '@/lib/security/durable-limit';
import { DriveConsentError } from '@/lib/booking/graph';
import { blockedType, CATS, catOk, downloadUrl, linkFor, listFiles, MAX_BYTES, scanRecent, uploadSession } from '@/lib/cloud/inbox';
import { pushAdmins } from '@/lib/admin/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Public page /files#<link>: receive (sender uploads) or pickup (recipient downloads).
// The link itself is the key (12–18 random bytes): leaserun.com/files#…
const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: H });
const OWNER = 'LeaseRun';
const fail = (e: unknown) => j({ error: e instanceof DriveConsentError ? 'File exchange is unavailable right now. Please try again later.' : 'Not possible right now. Please try again later.' }, 503);

export async function GET(req: Request) {
  const ip = anonymizedIpHash(req) || 'x';
  if (!allowRequest(`datei:${ip}`, 60, 60_000)) return j({ error: 'Too many requests.' }, 429);
  const u = new URL(req.url), l = await linkFor(u.searchParams.get('k') || '');
  if (!l) return j({ error: 'This link is invalid or has expired.' }, 404);
  const f = u.searchParams.get('f');
  try {
    if (f) {
      if (l.mode !== 'out') return j({ error: 'Not available.' }, 404);
      return NextResponse.redirect(await downloadUrl(f, l), { status: 302, headers: H });
    }
    const files = l.mode === 'out' ? (await listFiles([l])).filter((x) => !x.virus).map(({ id, name, size }) => ({ id, name, size })) : [];
    return j({ style: 'leaserun', mode: l.mode || 'in', owner: OWNER, files, max: MAX_BYTES, cats: l.mode === 'out' ? [] : CATS.leaserun });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const ip = anonymizedIpHash(req) || 'x';
  if (!allowRequest(`datei:up:${ip}`, 30, 60_000)) return j({ error: 'Too many requests.' }, 429);
  const b = (await req.json().catch(() => ({}))) as { k?: string; name?: string; size?: number; cat?: string; done?: string[]; cats?: string[] };
  const l = await linkFor(String(b.k || ''));
  if (!l || l.mode === 'out') return j({ error: 'This link is invalid or has expired.' }, 404);
  // Upload finished: short notice to the owner (only count and link name, no contents).
  if (Array.isArray(b.done)) {
    const n = Math.min(b.done.length, 500);
    const cats = [...new Set((Array.isArray(b.cats) ? b.cats : []).map((c) => catOk(l, c)).filter(Boolean))].join(', ');
    // Malware check of the files just uploaded; detections are removed and reported back to the sender.
    const sc = (await durableAllow(`datei:scan:${l.id}`, 60, 4)) ? await scanRecent(l).catch(() => ({ checked: 0, removed: [] as string[] })) : { checked: 0, removed: [] as string[] };
    if (n && (await durableAllow(`datei:push:${l.id}`, 600, 3))) await pushAdmins('mail', 'New files', `${l.label}: ${n} ${n === 1 ? 'file' : 'files'}${cats ? ` · ${cats}` : ''}${sc.removed.length ? ` · ${sc.removed.length} removed (suspected malware)` : ''}`, 'datei').catch(() => null);
    return j({ ok: true, removed: sc.removed });
  }
  const size = Number(b.size || 0);
  if (!b.name || !(size > 0)) return j({ error: 'File missing.' }, 400);
  if (size > MAX_BYTES) return j({ error: 'File too large (20 GB max).' }, 413);
  if (blockedType(String(b.name))) return j({ error: 'This file type isn’t allowed for security reasons.' }, 415);
  const cat = catOk(l, b.cat);
  if (!cat) return j({ error: 'Please choose a document type.' }, 400);
  if (!(await durableAllow(`datei:files:${l.id}`, 86400, 500))) return j({ error: 'The daily file limit for this link has been reached.' }, 429);
  try { return j({ uploadUrl: await uploadSession(l, String(b.name), size, cat) }); } catch (e) { return fail(e); }
}
