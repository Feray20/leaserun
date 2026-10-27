import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/security/admin';
import { berlinLabel, DEFAULT_BOOKING, getBookingConfig, OWNER_ZONES, validTz, type BookingConfig } from '@/lib/booking/core';
import { graphAccount, graphEvents, graphCancelMeeting, graphCreateMeeting, graphReady, graphSelfTest, graphDiagnose, graphFix, linkStart, linkFinish, loginPending, loginPoll, loginStart, logout } from '@/lib/booking/graph';
import { sendBookingMail, manageUrl, type Booking } from '@/lib/booking/mail';
import { esc } from '@/lib/mail/template';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

// Web-Admin → Appointments: accept requests (Teams meeting in the Outlook calendar + confirmation), decline, cancel; working hours.
export async function GET(req: Request) {
  const a = await requireAdmin(req, 'termine'); if (a instanceof NextResponse) return a;
  const u = new URL(req.url);
  // Calendar view: Outlook events + LeaseRun bookings in the range.
  const cf = u.searchParams.get('from'), ct = u.searchParams.get('to');
  if (cf && ct) {
    const from = new Date(cf), to = new Date(ct);
    if (isNaN(+from) || isNaN(+to) || +to <= +from || +to - +from > 45 * 864e5) return NextResponse.json({ error: 'Invalid date range.' }, { status: 400, headers: noStore });
    const { data: bk } = await supabaseAdmin().from('lr_bookings').select('id,name,company,topic,starts_at,ends_at,status,teams_url,ms_event_id').in('status', ['angefragt', 'bestaetigt']).lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString());
    let events: Awaited<ReturnType<typeof graphEvents>> = [], calError: string | null = null;
    if (await graphReady()) { try { events = await graphEvents(from, to); } catch (e) { calError = (e as Error).message; } }
    const linked = new Set((bk ?? []).map((b) => b.ms_event_id).filter(Boolean));
    return NextResponse.json({ events: events.filter((e) => !linked.has(e.id)), bookings: bk ?? [], connected: await graphReady(), calError }, { headers: noStore });
  }
  if (u.searchParams.get('check')) return NextResponse.json({ checks: await graphDiagnose() }, { headers: noStore });
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data } = await supabaseAdmin().from('lr_bookings').select('*').gte('starts_at', since).order('starts_at', { ascending: true }).limit(400);
  const [acc, pending] = await Promise.all([graphAccount(), loginPending()]);
  const graph = u.searchParams.get('test') ? await graphSelfTest() : { ok: Boolean(acc.mode), message: acc.mode ? `Connected to ${acc.account}${acc.name ? ` (${acc.name})` : ''}.` : 'Not connected to Microsoft yet.' };
  return NextResponse.json({ bookings: data ?? [], config: await getBookingConfig(), defaults: DEFAULT_BOOKING, zones: OWNER_ZONES, graph: { ...graph, mode: acc.mode, account: acc.account, pending: acc.mode ? null : pending } }, { headers: noStore });
}

const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Cfg = z.object({
  active: z.boolean(), durationMin: z.number().int().min(10).max(240), bufferMin: z.number().int().min(0).max(120),
  leadHours: z.number().int().min(0).max(336), daysAhead: z.number().int().min(1).max(120),
  days: z.record(z.enum(['0', '1', '2', '3', '4', '5', '6']), z.array(z.tuple([HM, HM])).max(6)),
  topics: z.array(z.string().trim().min(1).max(120)).max(12), intro: z.string().trim().max(400),
  timeZone: z.string().max(60).optional(),
});
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), id: z.string().uuid(), teamsUrl: z.string().url().max(2000).optional() }),
  z.object({ action: z.literal('decline'), id: z.string().uuid(), note: z.string().trim().max(1000).optional().default('') }),
  z.object({ action: z.literal('cancel'), id: z.string().uuid(), note: z.string().trim().max(1000).optional().default('') }),
  z.object({ action: z.literal('config'), config: Cfg.nullable() }),
  z.object({ action: z.literal('icsToken'), renew: z.boolean().optional() }),
  z.object({ action: z.literal('msLogin') }), z.object({ action: z.literal('msPoll') }), z.object({ action: z.literal('msLogout') }),
  z.object({ action: z.literal('msLink') }), z.object({ action: z.literal('msLinkDone'), url: z.string().trim().min(4).max(4000) }),
  z.object({ action: z.literal('msFix'), ids: z.array(z.string().max(40)).max(10) }),
]);

export async function POST(req: Request) {
  const a = await requireAdmin(req, 'termine'); if (a instanceof NextResponse) return a;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400, headers: noStore });
  const db = supabaseAdmin(), d = p.data, actor = a.user.email;
  if (a.role !== 'owner' && ['config', 'msLogin', 'msPoll', 'msLogout', 'msLink', 'msLinkDone', 'msFix'].includes(d.action)) return NextResponse.json({ error: 'Only the owner can change the calendar connection and working hours.' }, { status: 403, headers: noStore });

  // Calendar subscription: show or renew the secret link (renewing invalidates the old link).
  if (d.action === 'icsToken') {
    const { data: cur } = await db.from('lr_settings').select('value').eq('key', 'termine_ics_token').maybeSingle();
    let tok = String(cur?.value || '');
    if (!tok || d.renew) {
      tok = (await import('node:crypto')).randomBytes(32).toString('base64url');
      const w = await db.from('lr_settings').upsert({ key: 'termine_ics_token', value: tok, updated_at: new Date().toISOString(), updated_by: actor });
      if (w.error) return NextResponse.json({ error: 'Saving failed.' }, { status: 500, headers: noStore });
    }
    return NextResponse.json({ url: `https://leaserun.com/api/termine-feed?k=${tok}` }, { headers: noStore });
  }
  if (d.action === 'msLogin') { try { return NextResponse.json(await loginStart(), { headers: noStore }); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502, headers: noStore }); } }
  if (d.action === 'msPoll') { try { return NextResponse.json(await loginPoll(), { headers: noStore }); } catch (e) { return NextResponse.json({ status: 'error', message: (e as Error).message }, { headers: noStore }); } }
  if (d.action === 'msLogout') { await logout(); return NextResponse.json({ ok: true }, { headers: noStore }); }
  if (d.action === 'msLink') return NextResponse.json(await linkStart(), { headers: noStore });
  if (d.action === 'msLinkDone') { try { const r = await linkFinish(d.url); if (r.ok) await adminAudit(actor, 'ms_login', null, { via: 'link', account: r.account }); return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: noStore }); } catch (e) { return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 502, headers: noStore }); } }
  if (d.action === 'msFix') { const done = await graphFix(d.ids); return NextResponse.json({ done, checks: await graphDiagnose() }, { headers: noStore }); }

  if (d.action === 'config') {
    if (d.config) for (const r of Object.values(d.config.days)) for (const [s, e] of r) if (s >= e) return NextResponse.json({ error: `Time range ${s}–${e}: the end must be after the start.` }, { status: 400, headers: noStore });
    if (d.config) { if (d.config.timeZone && !validTz(d.config.timeZone)) return NextResponse.json({ error: 'Unknown time zone.' }, { status: 400, headers: noStore }); d.config.timeZone = validTz(d.config.timeZone) || DEFAULT_BOOKING.timeZone; }
    if (d.config) await db.from('lr_settings').upsert({ key: 'booking_config', value: d.config as BookingConfig });
    else await db.from('lr_settings').delete().eq('key', 'booking_config');
    return NextResponse.json({ config: await getBookingConfig() }, { headers: noStore });
  }

  const { data } = await db.from('lr_bookings').select('*').eq('id', d.id).maybeSingle();
  const b = data as Booking | null;
  if (!b) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404, headers: noStore });
  const now = new Date().toISOString();

  if (d.action === 'accept') {
    if (b.status !== 'angefragt') return NextResponse.json({ error: 'Only open requests can be accepted.' }, { status: 409, headers: noStore });
    let teams = d.teamsUrl || null, ev: string | null = null;
    if (await graphReady()) {
      try {
        const html = `<p>Meeting with LeaseRun${b.topic ? ` – ${esc(b.topic)}` : ''}.</p><p><strong>${esc(b.name)}</strong>${b.company ? `, ${esc(b.company)}` : ''}<br>${esc(b.email)}${b.phone ? `<br>${esc(b.phone)}` : ''}</p>${b.message ? `<p>${esc(b.message).replace(/\n/g, '<br>')}</p>` : ''}<p>Manage meeting: <a href="${manageUrl(b)}">${manageUrl(b)}</a></p>`;
        const m = await graphCreateMeeting({ subject: `LeaseRun: ${b.topic || 'Meeting'} – ${b.name}`, start: new Date(b.starts_at), end: new Date(b.ends_at), html });
        ev = m.id; teams = m.joinUrl || teams;
      } catch (e) { return NextResponse.json({ error: `Couldn't create the Teams meeting: ${(e as Error).message}` }, { status: 502, headers: noStore }); }
    }
    const { data: upd } = await db.from('lr_bookings').update({ status: 'bestaetigt', teams_url: teams, ms_event_id: ev, decided_at: now, decided_by: actor }).eq('id', b.id).select('*').single();
    const mailed = await sendBookingMail('bestaetigt', upd as Booking);
    return NextResponse.json({ booking: upd, mailed, message: `Confirmed for ${berlinLabel(new Date(b.starts_at))}${teams ? ' – Teams link sent.' : ' – without a Teams link (Microsoft not connected).'}` }, { headers: noStore });
  }

  if (d.action === 'decline') {
    if (b.status !== 'angefragt') return NextResponse.json({ error: 'Only open requests can be declined.' }, { status: 409, headers: noStore });
    const { data: upd } = await db.from('lr_bookings').update({ status: 'abgelehnt', note: d.note || null, decided_at: now, decided_by: actor }).eq('id', b.id).select('*').single();
    const mailed = await sendBookingMail('abgelehnt', upd as Booking);
    return NextResponse.json({ booking: upd, mailed, message: 'Declined – the guest has been notified.' }, { headers: noStore });
  }

  if (b.status !== 'bestaetigt' && b.status !== 'angefragt') return NextResponse.json({ error: 'This meeting is already closed.' }, { status: 409, headers: noStore });
  if (b.ms_event_id && (await graphReady())) await graphCancelMeeting(b.ms_event_id, d.note || 'This meeting has been canceled.').catch((e) => console.error('booking_cancel', (e as Error).message));
  const { data: upd } = await db.from('lr_bookings').update({ status: 'abgesagt', note: d.note || null, decided_at: now, decided_by: actor }).eq('id', b.id).select('*').single();
  const mailed = await sendBookingMail('abgesagt', upd as Booking);
  return NextResponse.json({ booking: upd, mailed, message: 'Canceled – the guest has been notified.' }, { headers: noStore });
}
