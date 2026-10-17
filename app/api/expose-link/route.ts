import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// AutoPilot per Link: lädt auf Wunsch des angemeldeten Nutzers genau eine Seite bzw. ein Exposé-PDF
// (wie ein Browser), damit ImmoAdv die Eckdaten auslesen kann. Nichts wird gespeichert oder veröffentlicht.
// Große Immobilienportale werden nicht automatisiert abgerufen (deren Nutzungsbedingungen) – dafür gibt es
// die Ein-Klick-Übernahme im eigenen Browser oder den PDF-Upload.
const PORTALS: [RegExp, string][] = [
  [/(^|\.)immobilienscout24\.(de|at|ch)$/i, 'ImmoScout24'], [/(^|\.)immowelt\.(de|at|ch)$/i, 'Immowelt'], [/(^|\.)immonet\.de$/i, 'Immonet'],
  [/(^|\.)kleinanzeigen\.de$/i, 'Kleinanzeigen'], [/(^|\.)ebay-kleinanzeigen\.de$/i, 'Kleinanzeigen'], [/(^|\.)immobilien\.de$/i, 'immobilien.de'],
  [/(^|\.)ohne-makler\.net$/i, 'ohne-makler.net'], [/(^|\.)wohnungsboerse\.net$/i, 'Wohnungsbörse'],
];
const UA = 'Mozilla/5.0 (compatible; ImmoAdv-Abruf/1.0; +https://immoadv.de/datenschutz) – Einzelabruf auf Nutzeranfrage';
const MAX = 15 * 1024 * 1024;
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// Keine Anfragen an interne Netze (Schutz vor Server-Side Request Forgery).
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
  try { u = new URL(raw); } catch { return 'Bitte einen vollständigen Link angeben (beginnt mit https://).'; }
  if (u.protocol !== 'https:') return 'Bitte einen sicheren Link mit https:// angeben.';
  if (u.username || u.password || (u.port && u.port !== '443')) return 'Dieser Link kann nicht abgerufen werden.';
  const host = u.hostname.replace(/\.$/, '');
  if (isIP(host) || /^(localhost|.*\.local|.*\.internal)$/i.test(host)) return 'Dieser Link kann nicht abgerufen werden.';
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return 'Dieser Link kann nicht abgerufen werden.';
  } catch { return 'Die Adresse wurde nicht gefunden. Bitte den Link prüfen.'; }
  return u;
}

// robots.txt beachten (einfacher Abgleich der Disallow-Regeln für alle Agenten).
async function robotsAllowed(u: URL): Promise<boolean> {
  try {
    const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(4000) });
    if (!r.ok) return true;
    const txt = (await r.text()).slice(0, 100_000);
    let applies = false; const dis: string[] = []; const allow: string[] = [];
    for (const line of txt.split(/\r?\n/)) {
      const [k, ...rest] = line.replace(/#.*/, '').split(':'); const v = rest.join(':').trim(); const key = k.trim().toLowerCase();
      if (key === 'user-agent') applies = v === '*' || /immoadv/i.test(v);
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
  const dec = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&euro;/g, '€').replace(/&sup2;/g, '²').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü').replace(/&szlig;/g, 'ß')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  const text = dec(body).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 30000);
  return { t: text, ti: dec(title).slice(0, 200), j: ld };
}

export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Bitte anmelden.' }, 401);
  if (!allowRequest(`expose-link:${user.id}`, 10, 60_000)) return j({ error: 'Zu viele Abrufe. Bitte kurz warten.' }, 429);
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const raw = String(body?.url || '').trim().slice(0, 2000);
  const first = await safeUrl(raw);
  if (typeof first === 'string') return j({ error: first }, 400);
  let target: URL = first;
  const portal = PORTALS.find(([re]) => re.test(target.hostname))?.[1];
  if (portal) return j({ code: 'portal', portal, error: `${portal} erlaubt keinen automatischen Abruf. Nutzen Sie die Ein-Klick-Übernahme im eigenen Browser oder laden Sie das Exposé als PDF hoch.` }, 422);
  if (!(await robotsAllowed(target))) return j({ code: 'robots', error: 'Diese Seite erlaubt keinen automatischen Abruf. Bitte das Exposé als PDF hochladen oder die Werte eintragen.' }, 422);

  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(target.toString(), { headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5', 'Accept-Language': 'de-DE,de;q=0.9' }, redirect: 'manual', signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!res) return j({ error: 'Die Seite antwortet nicht. Bitte später erneut versuchen oder das Exposé als PDF hochladen.' }, 502);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = await safeUrl(new URL(res.headers.get('location')!, target).toString());
      if (typeof next === 'string') return j({ error: next }, 400);
      if (PORTALS.some(([re]) => re.test(next.hostname))) return j({ code: 'portal', error: 'Der Link führt zu einem Portal ohne automatischen Abruf. Bitte die Ein-Klick-Übernahme oder den PDF-Upload nutzen.' }, 422);
      target = next; continue;
    }
    break;
  }
  if (!res || !res.ok) return j({ error: `Die Seite konnte nicht geladen werden (${res?.status ?? 'keine Antwort'}).` }, 502);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX) return j({ error: 'Die Datei ist größer als 15 MB.' }, 413);
  const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX) { await reader.cancel(); return j({ error: 'Die Datei ist größer als 15 MB.' }, 413); } chunks.push(value); }
  const buf = Buffer.concat(chunks);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/pdf') || buf.subarray(0, 5).toString() === '%PDF-') {
    return new NextResponse(buf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Source-Url': encodeURI(target.toString()).slice(0, 1500) } });
  }
  if (!type.includes('html') && !type.includes('text')) return j({ error: 'Unter diesem Link liegt weder eine Webseite noch ein PDF.' }, 415);
  const charset = /charset=([\w-]+)/.exec(type)?.[1] || 'utf-8';
  let html: string;
  try { html = new TextDecoder(charset).decode(buf); } catch { html = buf.toString('utf8'); }
  return j({ kind: 'html', u: target.toString(), ...htmlToText(html) });
}
