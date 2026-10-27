import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// AutoPilot by link: at the signed-in user's request, fetches exactly one page or listing PDF (like a browser)
// so LeaseRun can read the key facts. Nothing is stored or published.
// Large listing portals (Zillow, Redfin, Realtor.com, Trulia, Homes.com, …) are not fetched automatically (their terms of use);
// for those there is the one-click import in the user's own browser, pasting the text, or the PDF upload.
const PORTALS: [RegExp, string][] = [
  [/(^|\.)zillow\.com$/i, 'Zillow'], [/(^|\.)redfin\.com$/i, 'Redfin'], [/(^|\.)realtor\.com$/i, 'Realtor.com'], [/(^|\.)trulia\.com$/i, 'Trulia'],
  [/(^|\.)homes\.com$/i, 'Homes.com'], [/(^|\.)movoto\.com$/i, 'Movoto'], [/(^|\.)loopnet\.com$/i, 'LoopNet'], [/(^|\.)crexi\.com$/i, 'Crexi'],
  [/(^|\.)auction\.com$/i, 'Auction.com'], [/(^|\.)hotpads\.com$/i, 'HotPads'], [/(^|\.)apartments\.com$/i, 'Apartments.com'], [/(^|\.)craigslist\.org$/i, 'Craigslist'],
];
const UA = 'Mozilla/5.0 (compatible; LeaseRun-Fetch/1.0; +https://leaserun.com/privacy) - single fetch on user request';
const MAX = 15 * 1024 * 1024;
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// No requests to internal networks (protection against server-side request forgery).
function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}
async function safeUrl(raw: string): Promise<URL | string> {
  let u: URL;
  try { u = new URL(raw); } catch { return 'Please enter a complete link (starting with https://).'; }
  if (u.protocol !== 'https:') return 'Please enter a secure link starting with https://.';
  if (u.username || u.password || (u.port && u.port !== '443')) return 'Dieser Link kann nicht abgerufen werden.';
  const host = u.hostname.replace(/\.$/, '');
  if (isIP(host) || /^(localhost|.*\.local|.*\.internal)$/i.test(host)) return 'Dieser Link kann nicht abgerufen werden.';
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return 'Dieser Link kann nicht abgerufen werden.';
  } catch { return 'The address was not found. Please check the link.'; }
  return u;
}

// Respect robots.txt (simple match of the Disallow rules for all agents).
async function robotsAllowed(u: URL): Promise<boolean> {
  try {
    const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(4000) });
    if (!r.ok) return true;
    const txt = (await r.text()).slice(0, 100_000);
    let applies = false; const dis: string[] = []; const allow: string[] = [];
    for (const line of txt.split(/\r?\n/)) {
      const [k, ...rest] = line.replace(/#.*/, '').split(':'); const v = rest.join(':').trim(); const key = k.trim().toLowerCase();
      if (key === 'user-agent') applies = v === '*' || /leaserun/i.test(v);
      else if (applies && key === 'disallow' && v) dis.push(v);
      else if (applies && key === 'allow' && v) allow.push(v);
    }
    const p = u.pathname + u.search;
    const best = (list: string[]) => Math.max(-1, ...list.filter((x) => p.startsWith(x.replace(/\*.*$/, ''))).map((x) => x.length));
    return best(allow) >= best(dis);
  } catch { return true; }
}

function htmlToText(html: string) {
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).join('\n').slice(0, 8000);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|dt|dd|td|th|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const dec = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&euro;/g, '€').replace(/&dollar;/g, '$').replace(/&sup2;/g, '²').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü').replace(/&szlig;/g, 'ß')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  const text = dec(body).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 30000);
  return { t: text, ti: dec(title).slice(0, 200), j: ld };
}

export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Please sign in.' }, 401);
  if (!allowRequest(`expose-link:${user.id}`, 10, 60_000)) return j({ error: 'Too many requests. Please wait a moment.' }, 429);
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const raw = String(body?.url || '').trim().slice(0, 2000);
  const first = await safeUrl(raw);
  if (typeof first === 'string') return j({ error: first }, 400);
  let target: URL = first;
  const portal = PORTALS.find(([re]) => re.test(target.hostname))?.[1];
  if (portal) return j({ code: 'portal', portal, error: `${portal} does not allow automated fetching. Use the one-click import in your own browser, paste the listing text, or upload the listing as a PDF.` }, 422);
  if (!(await robotsAllowed(target))) return j({ code: 'robots', error: 'This site does not allow automated fetching. Please upload the listing as a PDF or enter the numbers.' }, 422);

  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(target.toString(), { headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'manual', signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!res) return j({ error: 'The site is not responding. Please try again later or upload the listing as a PDF.' }, 502);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = await safeUrl(new URL(res.headers.get('location')!, target).toString());
      if (typeof next === 'string') return j({ error: next }, 400);
      if (PORTALS.some(([re]) => re.test(next.hostname))) return j({ code: 'portal', error: 'The link leads to a portal that does not allow automated fetching. Please use the one-click import or the PDF upload.' }, 422);
      target = next; continue;
    }
    break;
  }
  if (!res || !res.ok) return j({ error: `The page could not be loaded (${res?.status ?? 'no response'}).` }, 502);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX) return j({ error: 'The file is larger than 15 MB.' }, 413);
  const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX) { await reader.cancel(); return j({ error: 'The file is larger than 15 MB.' }, 413); } chunks.push(value); }
  const buf = Buffer.concat(chunks);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/pdf') || buf.subarray(0, 5).toString() === '%PDF-') {
    return new NextResponse(buf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Source-Url': encodeURI(target.toString()).slice(0, 1500) } });
  }
  if (!type.includes('html') && !type.includes('text')) return j({ error: 'This link is neither a web page nor a PDF.' }, 415);
  const charset = /charset=([\w-]+)/.exec(type)?.[1] || 'utf-8';
  let html: string;
  try { html = new TextDecoder(charset).decode(buf); } catch { html = buf.toString('utf8'); }
  return j({ kind: 'html', u: target.toString(), ...htmlToText(html) });
}
