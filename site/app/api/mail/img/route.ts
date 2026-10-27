import { isPublicIp } from '@/lib/api/net';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { verifyImg } from '@/lib/mail/img-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Image fetch for the mailbox (see lib/mail/img-proxy.ts): signed URLs only, public servers only, image files up to 6 MB,
// at most 3 redirects. Response without cookies, with a strict security policy.
const MAX = 6 * 1024 * 1024;
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i];
// Full list of non-public networks (incl. IPv4-in-IPv6, 198.18/15, documentation ranges) from lib/api/net.ts.
const isPrivate = (ip: string) => PRIVATE.some((r) => r.test(ip)) || !isPublicIp(ip);
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const empty = (status = 200) => new Response(PIXEL, { status, headers: { 'content-type': 'image/gif', 'cache-control': 'private, max-age=600' } });

async function safeHost(u: URL): Promise<boolean> {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (isIP(h)) return !isPrivate(h);
  try { const r = await lookup(h, { all: true }); return r.length > 0 && r.every((a) => !isPrivate(a.address)); } catch { return false; }
}

function sniff(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('ascii', 4, 12) === 'ftypavif') return 'image/avif';
  return null;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const raw = q.get('u') || '', sig = q.get('s') || '';
  if (!raw || !verifyImg(raw, sig)) return empty(403);
  let url: URL;
  try { url = new URL(raw); } catch { return empty(400); }
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await safeHost(url))) return empty(403);
    res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (LeaseRun Mail Image Proxy)', accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8' }, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res) return empty(502);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); continue; }
    break;
  }
  if (!res || !res.ok || !res.body) return empty(404);
  let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX) return empty(413);
  // Some senders deliver images as "application/octet-stream" or without a type: then detect the type from the first bytes.
  // Only real raster images pass – never HTML, scripts or SVG with a wrong type.
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX) return empty(413);
  if (!type.startsWith('image/')) { const t = sniff(buf); if (!t) return empty(415); type = t; }
  return new Response(buf, {
    headers: {
      'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-site',
    },
  });
}
