import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { allowRequest } from '@/lib/security/rate-limit';
import { graphEvents, graphReady } from '@/lib/booking/graph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

// Kalender-Abo (iPhone/iPad, Outlook, Google Kalender): alle LeaseRun-Termine als iCalendar-Feed.
// Zugriff nur mit geheimem Schlüssel (Web-Admin → Termine → Kalender-Abo); neuer Schlüssel macht alte Links ungültig.
const esc = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const stamp = (t: string | Date) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (line: string) => { const out: string[] = []; let l = line; while (l.length > 73) { out.push(l.slice(0, 73)); l = ' ' + l.slice(73); } out.push(l); return out.join('\r\n'); };

export async function GET(req: Request) {
  const k = new URL(req.url).searchParams.get('k') || '';
  const nf = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(k)) return nf();
  if (!allowRequest(`ics:${k.slice(0, 12)}`, 30, 60_000)) return new Response('Too many requests', { status: 429 });
  const db = supabaseAdmin();
  const { data: s } = await db.from('lr_settings').select('value').eq('key', 'termine_ics_token').maybeSingle();
  const want = String(s?.value || '');
  if (!want || want.length !== k.length || !timingSafeEqual(Buffer.from(want), Buffer.from(k))) return nf();
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const { data } = await db.from('lr_bookings').select('id,name,company,email,phone,topic,message,starts_at,ends_at,status,teams_url,created_at').in('status', ['angefragt', 'bestaetigt', 'abgesagt']).gte('starts_at', since).order('starts_at').limit(1000);
  const now = stamp(new Date());
  const ev = (data ?? []).map((b) => {
    const title = `${b.status === 'angefragt' ? 'Anfrage: ' : ''}${b.name}${b.company ? ` · ${b.company}` : ''}${b.topic ? ` – ${b.topic}` : ''}`;
    const desc = [b.topic, b.message, b.email && `E-Mail: ${b.email}`, b.phone && `Telefon: ${b.phone}`, b.teams_url && `Teams: ${b.teams_url}`, 'Verwalten: https://leaserun.com/internal/web-admin#termine'].filter(Boolean).join('\n');
    return ['BEGIN:VEVENT', `UID:${b.id}@leaserun.com`, `DTSTAMP:${now}`, `LAST-MODIFIED:${stamp(b.created_at || b.starts_at)}`, `DTSTART:${stamp(b.starts_at)}`, `DTEND:${stamp(b.ends_at)}`,
      `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, b.teams_url ? `LOCATION:${esc('Microsoft Teams')}` : '', b.teams_url ? `URL:${esc(b.teams_url)}` : '',
      `STATUS:${b.status === 'bestaetigt' ? 'CONFIRMED' : b.status === 'abgesagt' ? 'CANCELLED' : 'TENTATIVE'}`, 'TRANSP:OPAQUE',
      ...(b.status === 'bestaetigt' ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Termin in 15 Minuten', 'TRIGGER:-PT15M', 'END:VALARM'] : []), 'END:VEVENT'].filter(Boolean).map(fold).join('\r\n');
  });
  // Zusätzlich der verbundene Outlook-Kalender (Web-Admin → Termine → Mit Microsoft anmelden): so erscheinen auch
  // Termine, die direkt in Outlook/Teams angelegt wurden. Fehler hier blockieren das Abo nie.
  const teamsOfBookings = new Set((data ?? []).map((b) => b.teams_url).filter(Boolean));
  try {
    if (await graphReady()) {
      const out = await Promise.race([graphEvents(new Date(Date.now() - 30 * 864e5), new Date(Date.now() + 180 * 864e5)), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
      for (const e of out) {
        if (e.teams && teamsOfBookings.has(e.teams)) continue;
        const day = (t: string) => t.slice(0, 10).replace(/-/g, '');
        const when = e.allDay ? [`DTSTART;VALUE=DATE:${day(e.start)}`, `DTEND;VALUE=DATE:${day(e.end)}`] : [`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`];
        const uid = createHash('sha256').update(e.id).digest('hex').slice(0, 32);
        ev.push(['BEGIN:VEVENT', `UID:${uid}@outlook.leaserun.com`, `DTSTAMP:${now}`, ...when, `SUMMARY:${esc(e.subject)}`,
          e.location ? `LOCATION:${esc(e.location)}` : '', e.teams ? `URL:${esc(e.teams)}` : '', e.teams ? `DESCRIPTION:${esc(`Teams: ${e.teams}`)}` : '',
          `TRANSP:${e.showAs === 'free' ? 'TRANSPARENT' : 'OPAQUE'}`, 'END:VEVENT'].filter(Boolean).map(fold).join('\r\n'));
      }
    }
  } catch (e) { console.error('ics_outlook', (e as Error).message); }
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LeaseRun//Termine//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:LeaseRun Termine', 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Disposition': 'inline; filename="leaserun-termine.ics"' } });
}
