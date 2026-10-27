import { supabaseAdmin } from '@/lib/supabase/admin';
import { graphBusy, graphReady } from '@/lib/booking/graph';

// Termin-Portal: Arbeitszeiten (im Web-Admin änderbar), freie Slots in deutscher Zeit (Europe/Berlin).
export type DayRanges = [string, string][];
export type BookingConfig = {
  active: boolean; durationMin: number; bufferMin: number; leadHours: number; daysAhead: number;
  days: Record<'1' | '2' | '3' | '4' | '5' | '6' | '0', DayRanges>; topics: string[]; intro: string;
};
export const DEFAULT_BOOKING: BookingConfig = {
  active: true, durationMin: 30, bufferMin: 15, leadHours: 18, daysAhead: 21,
  days: { 1: [['09:00', '12:00'], ['13:30', '17:00']], 2: [['09:00', '12:00'], ['13:30', '17:00']], 3: [['09:00', '12:00'], ['13:30', '17:00']], 4: [['09:00', '12:00'], ['13:30', '17:00']], 5: [['09:00', '13:00']], 6: [], 0: [] },
  topics: ['Kennenlernen', 'Demo für Unternehmen', 'Presse & Kooperation', 'Fragen zu meiner Finanzierung'],
  intro: 'Wählen Sie einen freien Termin. Sie erhalten nach der Bestätigung einen Microsoft-Teams-Link per E-Mail.',
};
const TZ = 'Europe/Berlin';

export async function getBookingConfig(): Promise<BookingConfig> {
  try {
    const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'booking_config').maybeSingle();
    const v = data?.value as Partial<BookingConfig> | null;
    return v && typeof v === 'object' ? { ...DEFAULT_BOOKING, ...v, days: { ...DEFAULT_BOOKING.days, ...(v.days || {}) } } : DEFAULT_BOOKING;
  } catch { return DEFAULT_BOOKING; }
}

// Lokale Berliner Zeit (Datum + HH:MM) → UTC-Zeitpunkt (Sommer-/Winterzeit korrekt).
function tzOffsetMin(utc: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(utc).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utc.getTime()) / 60000);
}
export function berlinToUtc(date: string, hm: string): Date {
  const guess = new Date(`${date}T${hm}:00Z`);
  const off1 = tzOffsetMin(guess);
  const t = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMin(t);
  return off2 === off1 ? t : new Date(guess.getTime() - off2 * 60000);
}
export const berlinDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const berlinLabel = (d: Date) => d.toLocaleString('de-DE', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
const wd = (date: string) => String(new Date(`${date}T12:00:00Z`).getUTCDay()) as keyof BookingConfig['days'];

export type Slot = { start: string; end: string };
// Freie Slots: Arbeitszeiten minus angefragte/bestätigte Termine minus belegte Zeiten im Outlook-Kalender (falls verbunden).
export async function freeSlots(cfg: BookingConfig): Promise<Record<string, Slot[]>> {
  if (!cfg.active) return {};
  const now = Date.now(), earliest = now + cfg.leadHours * 3600_000;
  const dur = cfg.durationMin * 60_000, buf = cfg.bufferMin * 60_000;
  const days: string[] = [];
  for (let i = 0; i <= cfg.daysAhead; i++) days.push(berlinDate(new Date(now + i * 864e5)));
  const from = berlinToUtc(days[0], '00:00'), to = new Date(berlinToUtc(days[days.length - 1], '23:59').getTime() + 60_000);
  const { data: booked } = await supabaseAdmin().from('lr_bookings').select('starts_at, ends_at').in('status', ['angefragt', 'bestaetigt']).gte('ends_at', from.toISOString()).lte('starts_at', to.toISOString());
  const busy: [number, number][] = (booked ?? []).map((b) => [Date.parse(b.starts_at as string) - buf, Date.parse(b.ends_at as string) + buf]);
  if (await graphReady().catch(() => false)) { try { for (const [s, e] of await graphBusy(from, to)) busy.push([s - buf, e + buf]); } catch (e) { console.error('booking_busy', (e as Error).message); } }
  const out: Record<string, Slot[]> = {};
  for (const date of [...new Set(days)]) {
    const ranges = cfg.days[wd(date)] || [];
    const list: Slot[] = [];
    for (const [a, b] of ranges) {
      let t = berlinToUtc(date, a).getTime();
      const end = berlinToUtc(date, b).getTime();
      for (; t + dur <= end; t += dur + buf) {
        if (t < earliest) continue;
        if (busy.some(([s, e]) => t < e && t + dur > s)) continue;
        list.push({ start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() });
      }
    }
    if (list.length) out[date] = list;
  }
  return out;
}

// Kalendereintrag (.ics) für die Bestätigungs-E-Mail.
export function icsFile(o: { uid: string; start: Date; end: Date; title: string; description: string; url?: string | null; method?: 'PUBLISH' | 'REQUEST' | 'CANCEL' }): string {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  // Zeilen nach RFC 5545 auf 75 Byte falten (lange Teams-Links), sonst lehnen strenge Kalender die Datei ab.
  const fold = (l: string) => { const out: string[] = []; let cur = '', n = 0; for (const ch of l) { const b = Buffer.byteLength(ch); if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += b; } out.push(cur); return out.join('\r\n '); };
  const cancel = o.method === 'CANCEL';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LeaseRun//Termine//DE', 'CALSCALE:GREGORIAN', `METHOD:${o.method || 'PUBLISH'}`, 'BEGIN:VEVENT',
    `UID:${o.uid}@leaserun.com`, `SEQUENCE:${cancel ? 1 : 0}`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(o.start)}`, `DTEND:${f(o.end)}`, `SUMMARY:${esc(o.title)}`, `DESCRIPTION:${esc(o.description)}`,
    ...(o.url ? [`URL:${o.url}`, `LOCATION:${esc('Microsoft Teams: ' + o.url)}`] : ['LOCATION:Online (Microsoft Teams)']), 'ORGANIZER;CN=LeaseRun:mailto:support@leaserun.com', cancel ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    ...(cancel ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Termin mit LeaseRun', 'END:VALARM']), 'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
