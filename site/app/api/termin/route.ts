import { NextResponse } from 'next/server';
import { hasLink, mailToAllowed } from '@/lib/security/durable-limit';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveMx } from 'node:dns/promises';
import { secretFor } from '@/lib/security/secrets';
import { sendMail } from '@/lib/notify/mail';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { allowRequest } from '@/lib/security/rate-limit';
import { berlinLabel, freeSlots, getBookingConfig } from '@/lib/booking/core';
import { graphCancelMeeting, graphReady } from '@/lib/booking/graph';
import { notifyAdmins, sendBookingMail, type Booking } from '@/lib/booking/mail';
import { pushAdmins } from '@/lib/admin/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Öffentliches Termin-Portal (leaserun.com/termin): freie Zeiten, Anfrage stellen, eigene Anfrage ansehen/absagen (per Token).
const noStore = { 'Cache-Control': 'no-store' };
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const ip = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'x';
const pub = (b: Booking) => ({ name: b.name, topic: b.topic, starts_at: b.starts_at, ends_at: b.ends_at, status: b.status, teams_url: b.status === 'bestaetigt' ? b.teams_url : null, note: b.status === 'abgelehnt' ? b.note : null });

export async function GET(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht verfügbar.' }, { status: 503, headers: noStore });
  const u = new URL(req.url);
  const t = u.searchParams.get('b');
  if (t) {
    if (!TOKEN.test(t) || !allowRequest(`termin-get:${ip(req)}`, 60, 10 * 60_000)) return NextResponse.json({ error: 'Termin nicht gefunden.' }, { status: 404, headers: noStore });
    const { data } = await supabaseAdmin().from('lr_bookings').select('*').eq('token', t).maybeSingle();
    if (!data) return NextResponse.json({ error: 'Termin nicht gefunden.' }, { status: 404, headers: noStore });
    return NextResponse.json({ booking: pub(data as Booking) }, { headers: noStore });
  }
  if (!allowRequest(`termin-slots:${ip(req)}`, 60, 10 * 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429, headers: noStore });
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
});

// Bestätigung per E-Mail-Code (gegen Spaßbuchungen und Bots): Code ohne Datenbank, gültig ca. 45 Minuten, an E-Mail + Termin gebunden.
// Wer über den persönlichen Link aus unserer E-Mail kommt (Token passt zur Adresse), braucht keinen Code.
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
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht verfügbar.' }, { status: 503, headers: noStore });
  const raw = await req.json().catch(() => null);
  const db = supabaseAdmin();

  if (raw && raw.action === 'cancel') {
    const p = Cancel.safeParse(raw);
    if (!p.success || !allowRequest(`termin-cancel:${ip(req)}`, 10, 10 * 60_000)) return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400, headers: noStore });
    const { data } = await db.from('lr_bookings').select('*').eq('token', p.data.token).maybeSingle();
    const b = data as Booking | null;
    if (!b) return NextResponse.json({ error: 'Termin nicht gefunden.' }, { status: 404, headers: noStore });
    if (b.status === 'abgesagt' || b.status === 'abgelehnt') return NextResponse.json({ booking: pub(b) }, { headers: noStore });
    if (b.ms_event_id && (await graphReady())) await graphCancelMeeting(b.ms_event_id, 'Der Termin wurde vom Gast abgesagt.').catch((e) => console.error('booking_cancel', (e as Error).message));
    const note = p.data.reason ? `Absage durch Gast: ${p.data.reason}` : 'Absage durch Gast';
    const { data: upd } = await db.from('lr_bookings').update({ status: 'abgesagt', note, decided_at: new Date().toISOString(), decided_by: 'gast' }).eq('id', b.id).select('*').single();
    await notifyAdmins(`Termin abgesagt: ${b.name}`, `${b.name} <${b.email}> hat den Termin am ${berlinLabel(new Date(b.starts_at))} abgesagt.${p.data.reason ? `\nGrund: ${p.data.reason}` : ''}`);
    return NextResponse.json({ booking: pub(upd as Booking) }, { headers: noStore });
  }

  const p = Req.safeParse(raw);
  if (!p.success) return NextResponse.json({ error: 'Bitte Name, gültige E-Mail, Termin und Einwilligung angeben.' }, { status: 400, headers: noStore });
  const d = p.data;
  // Bots: verstecktes Feld ausgefüllt oder Formular in unter 3 Sekunden abgeschickt → still annehmen, nichts speichern.
  if (d.website || (d.t0 && Date.now() - d.t0 < 3000)) return NextResponse.json({ ok: true }, { headers: noStore });
  if (!allowRequest(`termin-try:${ip(req)}`, 20, 60 * 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut oder schreiben Sie an support@leaserun.com.' }, { status: 429, headers: noStore });
  if (hasLink(d.name) || hasLink(d.company || '')) return NextResponse.json({ error: 'Bitte Name und Firma ohne Internetadressen angeben.' }, { status: 400, headers: noStore });
  const cfg = await getBookingConfig();
  if (!cfg.active) return NextResponse.json({ error: 'Terminbuchung ist gerade pausiert.' }, { status: 409, headers: noStore });
  const all = Object.values(await freeSlots(cfg)).flat();
  const slot = all.find((s) => Date.parse(s.start) === Date.parse(d.start));
  if (!slot) return NextResponse.json({ error: 'Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie einen anderen.', taken: true }, { status: 409, headers: noStore });
  const { count } = await db.from('lr_bookings').select('id', { count: 'exact', head: true }).eq('email', d.email).eq('status', 'angefragt');
  if ((count ?? 0) >= 2) return NextResponse.json({ error: 'Sie haben bereits offene Anfragen. Wir melden uns in Kürze.' }, { status: 409, headers: noStore });
  // Anliegen: mindestens eines; bei „Sonstiges“ bzw. ohne Auswahl ein paar Worte, worum es geht.
  const topics = [...new Set([...(d.topics || []), d.topic].filter(Boolean))].slice(0, 6) as string[];
  if (!topics.length) return NextResponse.json({ error: 'Bitte wählen Sie aus, worum es geht.' }, { status: 400, headers: noStore });
  if ((topics.includes('Sonstiges') || topics.length === 0) && d.message.length < 15) return NextResponse.json({ error: 'Bitte beschreiben Sie kurz Ihr Anliegen (ein Satz genügt).' }, { status: 400, headers: noStore });
  // Bestätigung der E-Mail-Adresse.
  let trusted = false;
  if (d.t && /^[A-Za-z0-9_-]{16,64}$/.test(d.t)) { const { data: l } = await db.from('lr_outreach_links').select('email').eq('token', d.t).maybeSingle(); trusted = String(l?.email || '').toLowerCase() === d.email; }
  if (!trusted) {
    if (THROWAWAY.test(d.email) || !(await mailboxExists(d.email))) return NextResponse.json({ error: 'Bitte eine erreichbare, dauerhafte E-Mail-Adresse angeben.' }, { status: 400, headers: noStore });
    if (!d.code) {
      if (!allowRequest(`termin-code-send:${d.email}`, 3, 60 * 60_000)) return NextResponse.json({ error: 'Es wurden schon mehrere Codes gesendet. Bitte prüfen Sie Ihr Postfach (auch Spam).' }, { status: 429, headers: noStore });
      const code = codeFor(d.email, slot.start, bucket());
      const sent = await sendMail(d.email, `Ihr Bestätigungscode: ${code}`, `Guten Tag ${d.name.split(' ')[0]},\n\nIhr Code zur Bestätigung der Terminanfrage bei LeaseRun lautet:\n\n${code}\n\nDer Code gilt 45 Minuten. Falls Sie keinen Termin angefragt haben, können Sie diese E-Mail ignorieren.\n\nLeaseRun`, [], { title: 'Terminanfrage bestätigen' });
      if (!sent) return NextResponse.json({ error: 'Der Code konnte nicht gesendet werden. Bitte prüfen Sie die E-Mail-Adresse.' }, { status: 400, headers: noStore });
      return NextResponse.json({ verify: true }, { headers: noStore });
    }
    if (!allowRequest(`termin-code-try:${d.email}`, 6, 30 * 60_000) || !codeOk(d.email, slot.start, d.code)) return NextResponse.json({ error: 'Der Code stimmt nicht oder ist abgelaufen.', verify: true }, { status: 400, headers: noStore });
  }
  if (!allowRequest(`termin-new:${ip(req)}`, 4, 60 * 60_000) || !allowRequest(`termin-mail:${d.email}`, 3, 24 * 3600_000)) return NextResponse.json({ error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut oder schreiben Sie an support@leaserun.com.' }, { status: 429, headers: noStore });
  if (!(await mailToAllowed('termin', d.email))) return NextResponse.json({ error: 'Für diese Adresse gibt es heute schon Anfragen. Wir melden uns in Kürze.' }, { status: 429, headers: noStore });
  const token = randomBytes(24).toString('base64url');
  const { data, error } = await db.from('lr_bookings').insert({
    token, name: d.name, email: d.email, company: d.company || null, phone: d.phone || null, topic: topics.join(', ').slice(0, 120) || null, message: d.message || null,
    starts_at: slot.start, ends_at: slot.end, status: 'angefragt', ip_hash: anonymizedIpHash(req),
  }).select('*').single();
  if (error || !data) {
    if (error?.code === '23505') return NextResponse.json({ error: 'Dieser Termin wurde gerade vergeben. Bitte wählen Sie einen anderen.', taken: true }, { status: 409, headers: noStore });
    console.error('booking_insert', error?.message);
    return NextResponse.json({ error: 'Anfrage konnte nicht gespeichert werden.' }, { status: 500, headers: noStore });
  }
  const b = data as Booking;
  await sendBookingMail('angefragt', b);
  await pushAdmins('booking', 'Neue Terminanfrage', 'Im Web-Admin wartet eine Anfrage.');
  await notifyAdmins(`Neue Terminanfrage: ${b.name}`, `${b.name}${b.company ? ` (${b.company})` : ''} <${b.email}>${b.phone ? `, ${b.phone}` : ''}\nTermin: ${berlinLabel(new Date(b.starts_at))}\nThema: ${b.topic || '–'}${b.message ? `\n\n${b.message}` : ''}`);
  return NextResponse.json({ ok: true, token, booking: pub(b) }, { headers: noStore });
}
