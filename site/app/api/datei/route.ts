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

// Öffentliche Seite /files#<Link>: Empfangen (Absender lädt hoch) oder Abholen (Empfänger lädt herunter).
// Der Link selbst ist der Schlüssel (12–18 Zufallsbytes). LeaseRun: leaserun.com/datei#…, persönlich: feray.cloud/…
const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: H });
const OWNER = { leaserun: 'LeaseRun', feray: 'Feray Korkmaz' } as const;
// Auf der persönlichen Domain gelten nur persönliche Links (und umgekehrt) – so verrät keine Adresse die andere.
const personalHost = (req: Request) => /feray[.-]cloud/i.test((req.headers.get('host') || '').split(':')[0]);
const fits = (req: Request, style: string) => (style === 'feray') === personalHost(req) || (style === 'feray' && !process.env.FERAY_CLOUD_HOST);
const fail = (e: unknown) => j({ error: e instanceof DriveConsentError ? 'Der Dateiempfang ist gerade nicht erreichbar. Bitte später erneut versuchen.' : 'Gerade nicht möglich. Bitte später erneut versuchen.' }, 503);

export async function GET(req: Request) {
  const ip = anonymizedIpHash(req) || 'x';
  if (!allowRequest(`datei:${ip}`, 60, 60_000)) return j({ error: 'Zu viele Anfragen.' }, 429);
  const u = new URL(req.url), l = await linkFor(u.searchParams.get('k') || '');
  if (!l || !fits(req, l.style)) return j({ error: 'Dieser Link ist nicht (mehr) gültig.' }, 404);
  const f = u.searchParams.get('f');
  try {
    if (f) {
      if (l.mode !== 'out') return j({ error: 'Nicht verfügbar.' }, 404);
      return NextResponse.redirect(await downloadUrl(f, l), { status: 302, headers: H });
    }
    const files = l.mode === 'out' ? (await listFiles([l])).filter((x) => !x.virus).map(({ id, name, size }) => ({ id, name, size })) : [];
    return j({ style: l.style, mode: l.mode || 'in', owner: OWNER[l.style], files, max: MAX_BYTES, cats: l.mode === 'out' ? [] : CATS[l.style] });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const ip = anonymizedIpHash(req) || 'x';
  if (!allowRequest(`datei:up:${ip}`, 30, 60_000)) return j({ error: 'Zu viele Anfragen.' }, 429);
  const b = (await req.json().catch(() => ({}))) as { k?: string; name?: string; size?: number; cat?: string; done?: string[]; cats?: string[] };
  const l = await linkFor(String(b.k || ''));
  if (!l || l.mode === 'out' || !fits(req, l.style)) return j({ error: 'Dieser Link ist nicht (mehr) gültig.' }, 404);
  // Fertig hochgeladen: kurze Mitteilung an Feray (nur Anzahl und Link-Name, keine Inhalte).
  if (Array.isArray(b.done)) {
    const n = Math.min(b.done.length, 500);
    const cats = [...new Set((Array.isArray(b.cats) ? b.cats : []).map((c) => catOk(l, c)).filter(Boolean))].join(', ');
    // Virenprüfung der gerade hochgeladenen Dateien; Funde werden gelöscht und dem Absender gemeldet.
    const sc = (await durableAllow(`datei:scan:${l.id}`, 60, 4)) ? await scanRecent(l).catch(() => ({ checked: 0, removed: [] as string[] })) : { checked: 0, removed: [] as string[] };
    if (n && (await durableAllow(`datei:push:${l.id}`, 600, 3))) await pushAdmins('mail', 'Neue Dateien', `${l.label}: ${n} ${n === 1 ? 'Datei' : 'Dateien'}${cats ? ` · ${cats}` : ''}${sc.removed.length ? ` · ${sc.removed.length} wegen Virenverdacht gelöscht` : ''}`, 'datei').catch(() => null);
    return j({ ok: true, removed: sc.removed });
  }
  const size = Number(b.size || 0);
  if (!b.name || !(size > 0)) return j({ error: 'Datei fehlt.' }, 400);
  if (size > MAX_BYTES) return j({ error: 'Datei zu groß (höchstens 20 GB).' }, 413);
  if (blockedType(String(b.name))) return j({ error: 'Dieser Dateityp ist aus Sicherheitsgründen nicht erlaubt.' }, 415);
  const cat = catOk(l, b.cat);
  if (!cat) return j({ error: 'Bitte auswählen, worum es geht.' }, 400);
  if (!(await durableAllow(`datei:files:${l.id}`, 86400, 500))) return j({ error: 'Für heute sind genug Dateien eingegangen.' }, 429);
  try { return j({ uploadUrl: await uploadSession(l, String(b.name), size, cat) }); } catch (e) { return fail(e); }
}
