import { supabaseAdmin } from '@/lib/supabase/admin';
import { graphBusy, graphReady } from '@/lib/booking/graph';

// Booking portal: working hours (editable in the Web-Admin) are defined in the owner's time zone (cfg.timeZone).
// Free slots are returned as UTC instants; the public page shows them in the visitor's US time zone.
export type DayRanges = [string, string][];
export type BookingConfig = {
  active: boolean; durationMin: number; bufferMin: number; leadHours: number; daysAhead: number;
  days: Record<'1' | '2' | '3' | '4' | '5' | '6' | '0', DayRanges>; topics: string[]; intro: string;
  // IANA time zone of the owner's calendar / working hours (e.g. Europe/Berlin, America/New_York).
  timeZone: string;
};
// Owner time zone default: env BOOKING_OWNER_TZ, otherwise Europe/Berlin (where the owner's calendar runs).
export const OWNER_TZ = validTz(process.env.BOOKING_OWNER_TZ) || 'Europe/Berlin';
// Owner zones selectable in the Web-Admin.
export const OWNER_ZONES = ['Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'UTC'] as const;
// Default hours (owner time, Europe/Berlin): 3–8 PM Berlin = 9 AM–2 PM Eastern / 6–11 AM Pacific, Mon–Thu; Fri until 6 PM Berlin.
export const DEFAULT_BOOKING: BookingConfig = {
  active: true, durationMin: 30, bufferMin: 15, leadHours: 18, daysAhead: 21,
  days: { 1: [['15:00', '20:00']], 2: [['15:00', '20:00']], 3: [['15:00', '20:00']], 4: [['15:00', '20:00']], 5: [['15:00', '18:00']], 6: [], 0: [] },
  topics: ['Business partnership', 'Product demo', 'Support', 'Press'],
  intro: 'Pick an open time that works for you. Once we confirm, you will receive a Microsoft Teams link by email.',
  timeZone: OWNER_TZ,
};

export function validTz(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz || tz.length > 60 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0); return tz; } catch { return null; }
}

export async function getBookingConfig(): Promise<BookingConfig> {
  try {
    const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'booking_config').maybeSingle();
    const v = data?.value as Partial<BookingConfig> | null;
    if (!v || typeof v !== 'object') return DEFAULT_BOOKING;
    return { ...DEFAULT_BOOKING, ...v, timeZone: validTz(v.timeZone) || DEFAULT_BOOKING.timeZone, days: { ...DEFAULT_BOOKING.days, ...(v.days || {}) } };
  } catch { return DEFAULT_BOOKING; }
}

// Local wall time in a zone (date + HH:MM) → UTC instant (handles daylight saving time correctly).
function tzOffsetMin(utc: Date, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(utc).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utc.getTime()) / 60000);
}
// Name kept for compatibility: converts owner-zone wall time to UTC (tz defaults to the owner zone).
export function berlinToUtc(date: string, hm: string, tz: string = OWNER_TZ): Date {
  const guess = new Date(`${date}T${hm}:00Z`);
  const off1 = tzOffsetMin(guess, tz);
  const t = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMin(t, tz);
  return off2 === off1 ? t : new Date(guess.getTime() - off2 * 60000);
}
export const berlinDate = (d: Date, tz: string = OWNER_TZ) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
// Owner-side label (Web-Admin, owner notifications), e.g. "Tuesday, Nov 3, 2026, 3:00 PM CET".
export const berlinLabel = (d: Date, tz: string = OWNER_TZ) => d.toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

// Guest-side label. With a known zone: that zone. Without: Eastern time plus CT / MT / PT for US guests.
const US_LABEL_ZONES: [string, string][] = [['America/Chicago', 'CT'], ['America/Denver', 'MT'], ['America/Los_Angeles', 'PT']];
export function guestLabel(d: Date, tz?: string | null): string {
  const z = validTz(tz);
  if (z) return d.toLocaleString('en-US', { timeZone: z, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const t = (zone: string) => d.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `${day}, ${t('America/New_York')} ET (${US_LABEL_ZONES.map(([zone, abbr]) => `${t(zone)} ${abbr}`).join(' · ')})`;
}

// ---------- US federal holidays (5 U.S.C. 6103), incl. observed dates (Sat → Fri, Sun → Mon) ----------
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const nthWeekday = (y: number, m: number, wd: number, n: number) => { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((wd - first + 7) % 7) + (n - 1) * 7; };
const lastWeekday = (y: number, m: number, wd: number) => { const last = new Date(Date.UTC(y, m, 0)); return last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7); };
const holidayCache = new Map<number, Set<string>>();
export function usFederalHolidays(y: number): Set<string> {
  const hit = holidayCache.get(y); if (hit) return hit;
  const out = new Set<string>();
  const fixed = (m: number, d: number) => {
    out.add(iso(y, m, d));
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wd === 6) { const o = new Date(Date.UTC(y, m - 1, d - 1)); out.add(iso(o.getUTCFullYear(), o.getUTCMonth() + 1, o.getUTCDate())); }
    if (wd === 0) { const o = new Date(Date.UTC(y, m - 1, d + 1)); out.add(iso(o.getUTCFullYear(), o.getUTCMonth() + 1, o.getUTCDate())); }
  };
  fixed(1, 1); // New Year's Day
  out.add(iso(y, 1, nthWeekday(y, 1, 1, 3))); // Martin Luther King Jr. Day
  out.add(iso(y, 2, nthWeekday(y, 2, 1, 3))); // Washington's Birthday (Presidents Day)
  out.add(iso(y, 5, lastWeekday(y, 5, 1))); // Memorial Day
  fixed(6, 19); // Juneteenth
  fixed(7, 4); // Independence Day
  out.add(iso(y, 9, nthWeekday(y, 9, 1, 1))); // Labor Day
  out.add(iso(y, 10, nthWeekday(y, 10, 1, 2))); // Columbus Day
  fixed(11, 11); // Veterans Day
  out.add(iso(y, 11, nthWeekday(y, 11, 4, 4))); // Thanksgiving Day
  fixed(12, 25); // Christmas Day
  // Next year's New Year's Day observed on Dec 31 when Jan 1 falls on a Saturday.
  if (new Date(Date.UTC(y + 1, 0, 1)).getUTCDay() === 6) out.add(iso(y, 12, 31));
  holidayCache.set(y, out);
  return out;
}
export const isUsHoliday = (ymd: string) => usFederalHolidays(+ymd.slice(0, 4)).has(ymd);
// A slot is blocked when its date is a federal holiday in US Eastern time (the reference for US business days).
const etDate = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

const wd = (date: string) => String(new Date(`${date}T12:00:00Z`).getUTCDay()) as keyof BookingConfig['days'];

export type Slot = { start: string; end: string };
// Free slots: working hours minus requested/confirmed bookings minus busy times in the Outlook calendar (if connected)
// minus US federal holidays. Keys are dates in the owner zone; the client regroups by the visitor's zone.
export async function freeSlots(cfg: BookingConfig): Promise<Record<string, Slot[]>> {
  if (!cfg.active) return {};
  const tz = validTz(cfg.timeZone) || OWNER_TZ;
  const now = Date.now(), earliest = now + cfg.leadHours * 3600_000;
  const dur = cfg.durationMin * 60_000, buf = cfg.bufferMin * 60_000;
  const days: string[] = [];
  for (let i = 0; i <= cfg.daysAhead; i++) days.push(berlinDate(new Date(now + i * 864e5), tz));
  const from = berlinToUtc(days[0], '00:00', tz), to = new Date(berlinToUtc(days[days.length - 1], '23:59', tz).getTime() + 60_000);
  const { data: booked } = await supabaseAdmin().from('lr_bookings').select('starts_at, ends_at').in('status', ['angefragt', 'bestaetigt']).gte('ends_at', from.toISOString()).lte('starts_at', to.toISOString());
  const busy: [number, number][] = (booked ?? []).map((b) => [Date.parse(b.starts_at as string) - buf, Date.parse(b.ends_at as string) + buf]);
  if (await graphReady().catch(() => false)) { try { for (const [s, e] of await graphBusy(from, to)) busy.push([s - buf, e + buf]); } catch (e) { console.error('booking_busy', (e as Error).message); } }
  const out: Record<string, Slot[]> = {};
  for (const date of [...new Set(days)]) {
    const ranges = cfg.days[wd(date)] || [];
    const list: Slot[] = [];
    for (const [a, b] of ranges) {
      let t = berlinToUtc(date, a, tz).getTime();
      const end = berlinToUtc(date, b, tz).getTime();
      for (; t + dur <= end; t += dur + buf) {
        if (t < earliest) continue;
        if (isUsHoliday(etDate(t)) || isUsHoliday(etDate(t + dur - 1))) continue;
        if (busy.some(([s, e]) => t < e && t + dur > s)) continue;
        list.push({ start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() });
      }
    }
    if (list.length) out[date] = list;
  }
  return out;
}

// Calendar file (.ics) for the confirmation email.
export function icsFile(o: { uid: string; start: Date; end: Date; title: string; description: string; url?: string | null; method?: 'PUBLISH' | 'REQUEST' | 'CANCEL' }): string {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  // Fold lines at 75 bytes per RFC 5545 (long Teams links), otherwise strict calendars reject the file.
  const fold = (l: string) => { const out: string[] = []; let cur = '', n = 0; for (const ch of l) { const b = Buffer.byteLength(ch); if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += b; } out.push(cur); return out.join('\r\n '); };
  const cancel = o.method === 'CANCEL';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LeaseRun//Booking//EN', 'CALSCALE:GREGORIAN', `METHOD:${o.method || 'PUBLISH'}`, 'BEGIN:VEVENT',
    `UID:${o.uid}@leaserun.com`, `SEQUENCE:${cancel ? 1 : 0}`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(o.start)}`, `DTEND:${f(o.end)}`, `SUMMARY:${esc(o.title)}`, `DESCRIPTION:${esc(o.description)}`,
    ...(o.url ? [`URL:${o.url}`, `LOCATION:${esc('Microsoft Teams: ' + o.url)}`] : ['LOCATION:Online (Microsoft Teams)']), 'ORGANIZER;CN=LeaseRun:mailto:support@leaserun.com', cancel ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    ...(cancel ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Meeting with LeaseRun', 'END:VALARM']), 'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
