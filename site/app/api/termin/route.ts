import { NextResponse } from 'next/server';
import { hasLink, mailToAllowed } from '@/lib/security/durable-limit';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveMx } from 'node:dns/promises';
import { secretFor } from '@/lib/security/secrets';
import { sendMail } from '@/lib/notify/mail';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { allowRequest } from '@/lib/security/rate-limit';
import { berlinLabel, freeSlots, getBookingConfig, guestLabel, validTz } from '@/lib/booking/core';
import { graphCancelMeeting, graphReady } from '@/lib/booking/graph';
import { notifyAdmins, sendBookingMail, type Booking } from '@/lib/booking/mail';
import { pushAdmins } from '@/lib/admin/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public booking portal (leaserun.com/book): open times, submit a request, view/cancel your own request (via token).
const noStore = { 'Cache-Control': 'no-store' };
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const ip = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'x';
const pub = (b: Booking) => ({ name: b.name, topic: b.topic, starts_at: b.starts_at, ends_at: b.ends_at, status: b.status, teams_url: b.status === 'bestaetigt' ? b.teams_url : null, note: b.status === 'abgelehnt' ? b.note : null });
// Fixed request types for the US site (in addition to topics configured in the Web-Admin).
const OTHER = 'Other';

export async function GET(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: 'Not available.' }, { status: 503, headers: noStore });
  const u = new URL(req.url);
  const t = u.searchParams.get('b');
  if (t) {
    if (!TOKEN.test(t) || !allowRequest(`termin-get:${ip(req)}`, 60, 10 * 60_000)) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404, headers: noStore });
    const { data } = await supabaseAdmin().from('lr_bookings').select('*').eq('token', t).maybeSingle();
    if (!data) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404, headers: noStore });
    return NextResponse.json({ booking: pub(data as Booking) }, { headers: noStore });
  }
  if (!allowRequest(`termin-slots:${ip(req)}`, 60, 10 * 60_000)) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: noStore });
  const cfg = await getBookingConfig();
  const slots = await freeSlots(cfg);
  return NextResponse.json({ active: cfg.active, durationMin: cfg.durationMin, topics: cfg.topics, intro: cfg.intro, slots }, { headers: noStore });
}

const Req = z.object({
  name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200),
  company: z.string().trim().max(160).optional().default(''), phone: z.string().trim().max(40).optional().default(''),
  topic: z.string().trim().max(120).optional().default(''), message: z.string().trim().max(2000).optional().default(''),
  start: z.string().datetime(), consent: z.literal(true), website: z.string().max(0).optional(), t0: z.number().optional(),
  topics: z.array(z.string().trim().min(2).max(60)).max(8).optional().default([]), code: z.string().regex(/^\d{6}$/).optional(), t: z.string().max(64).optional(),
  // Visitor's time zone (IANA) – only used to show times in emails; slots are always UTC instants.
  tz: z.string().max(60).optional(),
});

// Email code verification (against prank bookings and bots): stateless code, valid about 45 minutes, bound to email + slot.
// Visitors arriving via the personal link from our email (token matches the address) don't need a code.
const bucket = () => Math.floor(Date.now() / (15 * 60_000));
const codeFor = (email: string, start: string, b: number) => String(parseInt(createHmac('sha256', secretFor('internal')).update(`termin|${email}|${Date.parse(start)}|${b}`).digest('hex').slice(0, 10), 16) % 1_000_000).padStart(6, '0');
const codeOk = (email: string, start: string, code: string) => [0, 1, 2].some((k) => { const a = Buffer.from(codeFor(email, start, bucket() - k)), b = Buffer.from(code); return a.length === b.length && timingSafeEqual(a, b); });
const THROWAWAY = /@(?:mailinator|guerrillamail|10minutemail|trashmail|tempmail|temp-mail|yopmail|sharklasers|getnada|dispostable|maildrop|fakeinbox|throwawaymail|mintemail|emailondeck|mohmal|moakt|spamgourmet)\./i;
async function mailboxExists(email: string): Promise<boolean> {
  const dom = email.split('@')[1] || '';
  try { const mx = await resolveMx(dom); return mx.some((m) => m.exchange && m.exchange !== '.'); } catch (e) { return (e as { code?: string }).code !== 'ENOTFOUND' && (e as { code?: string }).code !== 'ENODATA'; }
}
const Cancel = z.object({ action: z.literal('cancel'), token: z.string().regex(TOKEN), reason: z.string().trim().max(500).optional().default('') });

export async function POST(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: 'Not available.' }, { status: 503, headers: noStore });
  const raw = await req.json().catch(() => null);
  const db = supabaseAdmin();

  if (raw && raw.action === 'cancel') {
    const p = Cancel.safeParse(raw);
    if (!p.success || !allowRequest(`termin-cancel:${ip(req)}`, 10, 10 * 60_000)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore });
    const { data } = await db.from('lr_bookings').select('*').eq('token', p.data.token).maybeSingle();
    const b = data as Booking | null;
    if (!b) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404, headers: noStore });
    if (b.status === 'abgesagt' || b.status === 'abgelehnt') return NextResponse.json({ booking: pub(b) }, { headers: noStore });
    if (b.ms_event_id && (await graphReady())) await graphCancelMeeting(b.ms_event_id, 'The guest canceled this meeting.').catch((e) => console.error('booking_cancel', (e as Error).message));
    const note = p.data.reason ? `Canceled by guest: ${p.data.reason}` : 'Canceled by guest';
    const { data: upd } = await db.from('lr_bookings').update({ status: 'abgesagt', note, decided_at: new Date().toISOString(), decided_by: 'gast' }).eq('id', b.id).select('*').single();
    await notifyAdmins(`Meeting canceled: ${b.name}`, `${b.name} <${b.email}> canceled the meeting on ${berlinLabel(new Date(b.starts_at))}.${p.data.reason ? `\nReason: ${p.data.reason}` : ''}`);
    return NextResponse.json({ booking: pub(upd as Booking) }, { headers: noStore });
  }

  const p = Req.safeParse(raw);
  if (!p.success) return NextResponse.json({ error: 'Please enter your name, a valid email, a time and your consent.' }, { status: 400, headers: noStore });
  const d = p.data;
  const tz = validTz(d.tz);
  // Bots: hidden field filled in or form sent in under 3 seconds → silently accept, store nothing.
  if (d.website || (d.t0 && Date.now() - d.t0 < 3000)) return NextResponse.json({ ok: true }, { headers: noStore });
  if (!allowRequest(`termin-try:${ip(req)}`, 20, 60 * 60_000)) return NextResponse.json({ error: 'Too many requests. Please try again later or email support@leaserun.com.' }, { status: 429, headers: noStore });
  if (hasLink(d.name) || hasLink(d.company || '')) return NextResponse.json({ error: 'Please enter your name and company without web addresses.' }, { status: 400, headers: noStore });
  const cfg = await getBookingConfig();
  if (!cfg.active) return NextResponse.json({ error: 'Online booking is paused right now.' }, { status: 409, headers: noStore });
  const all = Object.values(await freeSlots(cfg)).flat();
  const slot = all.find((s) => Date.parse(s.start) === Date.parse(d.start));
  if (!slot) return NextResponse.json({ error: 'Sorry, this time is no longer available. Please pick another one.', taken: true }, { status: 409, headers: noStore });
  const { count } = await db.from('lr_bookings').select('id', { count: 'exact', head: true }).eq('email', d.email).eq('status', 'angefragt');
  if ((count ?? 0) >= 2) return NextResponse.json({ error: 'You already have open requests. We’ll get back to you shortly.' }, { status: 409, headers: noStore });
  // Request type: at least one; for "Other" (or nothing selected) a few words on what it's about.
  const topics = [...new Set([...(d.topics || []), d.topic].filter(Boolean))].slice(0, 6) as string[];
  if (!topics.length) return NextResponse.json({ error: 'Please choose what your request is about.' }, { status: 400, headers: noStore });
  if ((topics.includes(OTHER) || topics.length === 0) && d.message.length < 15) return NextResponse.json({ error: 'Please briefly describe your request (one sentence is enough).' }, { status: 400, headers: noStore });
  // Verify the email address.
  let trusted = false;
  if (d.t && /^[A-Za-z0-9_-]{16,64}$/.test(d.t)) { const { data: l } = await db.from('lr_outreach_links').select('email').eq('token', d.t).maybeSingle(); trusted = String(l?.email || '').toLowerCase() === d.email; }
  if (!trusted) {
    if (THROWAWAY.test(d.email) || !(await mailboxExists(d.email))) return NextResponse.json({ error: 'Please use a reachable, permanent email address.' }, { status: 400, headers: noStore });
    if (!d.code) {
      if (!allowRequest(`termin-code-send:${d.email}`, 3, 60 * 60_000)) return NextResponse.json({ error: 'Several codes have already been sent. Please check your inbox (and spam folder).' }, { status: 429, headers: noStore });
      const code = codeFor(d.email, slot.start, bucket());
      const sent = await sendMail(d.email, `Your verification code: ${code}`, `Hi ${d.name.split(' ')[0]},\n\nYour code to confirm your meeting request with LeaseRun is:\n\n${code}\n\nThe code is valid for 45 minutes. If you didn't request a meeting, you can ignore this email.\n\nLeaseRun`, [], { title: 'Confirm your meeting request' });
      if (!sent) return NextResponse.json({ error: 'We couldn’t send the code. Please check your email address.' }, { status: 400, headers: noStore });
      return NextResponse.json({ verify: true }, { headers: noStore });
    }
    if (!allowRequest(`termin-code-try:${d.email}`, 6, 30 * 60_000) || !codeOk(d.email, slot.start, d.code)) return NextResponse.json({ error: 'The code is incorrect or has expired.', verify: true }, { status: 400, headers: noStore });
  }
  if (!allowRequest(`termin-new:${ip(req)}`, 4, 60 * 60_000) || !allowRequest(`termin-mail:${d.email}`, 3, 24 * 3600_000)) return NextResponse.json({ error: 'Too many requests. Please try again later or email support@leaserun.com.' }, { status: 429, headers: noStore });
  if (!(await mailToAllowed('termin', d.email))) return NextResponse.json({ error: 'There are already requests from this address today. We’ll get back to you shortly.' }, { status: 429, headers: noStore });
  const token = randomBytes(24).toString('base64url');
  const { data, error } = await db.from('lr_bookings').insert({
    token, name: d.name, email: d.email, company: d.company || null, phone: d.phone || null, topic: topics.join(', ').slice(0, 120) || null, message: d.message || null,
    starts_at: slot.start, ends_at: slot.end, status: 'angefragt', ip_hash: anonymizedIpHash(req),
  }).select('*').single();
  if (error || !data) {
    if (error?.code === '23505') return NextResponse.json({ error: 'This time was just taken. Please pick another one.', taken: true }, { status: 409, headers: noStore });
    console.error('booking_insert', error?.message);
    return NextResponse.json({ error: 'We couldn’t save your request.' }, { status: 500, headers: noStore });
  }
  const b = data as Booking;
  await sendBookingMail('angefragt', b, tz);
  await pushAdmins('booking', 'New meeting request', 'A request is waiting in the Web-Admin.');
  await notifyAdmins(`New meeting request: ${b.name}`, `${b.name}${b.company ? ` (${b.company})` : ''} <${b.email}>${b.phone ? `, ${b.phone}` : ''}\nWhen: ${berlinLabel(new Date(b.starts_at))}${tz ? `\nGuest's local time: ${guestLabel(new Date(b.starts_at), tz)}` : ''}\nTopic: ${b.topic || '–'}${b.message ? `\n\n${b.message}` : ''}`);
  return NextResponse.json({ ok: true, token, booking: pub(b) }, { headers: noStore });
}
