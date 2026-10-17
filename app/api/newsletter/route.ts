import { suppressionKeys } from '@/lib/marketing/suppression';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { hashToken, newToken } from '@/lib/b2b/core';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { guardSubmission } from '@/lib/security/antispam';
import { CONSENT_B2B, CONSENT_B2C, unsubId } from '@/lib/marketing/consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Neuigkeiten für Berater (B2B) bzw. Kunden (B2C) per E-Mail – nur mit Double-Opt-in (Bestätigungslink),
// jederzeit abbestellbar. Grundlage für jede werbliche E-Mail aus der Werbungszentrale.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).optional().default(''),
  company: z.string().trim().max(160).optional().default(''),
  segment: z.enum(['b2b', 'b2c']).default('b2b'),
  source: z.string().trim().max(60).optional().default(''),
  consent: z.literal(true),
  website: z.string().optional().default(''),
  ts: z.coerce.number().optional(),
});

export async function POST(req: Request) {
  if (!adminConfigured()) return j({ error: 'Nicht verfügbar.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`nl:${ip}`, 5, 10 * 60_000)) return j({ error: 'Zu viele Anfragen.' }, 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: String(p.error.issues[0]?.path[0]) === 'consent' ? 'Bitte der E-Mail-Zusendung zustimmen.' : 'Bitte die E-Mail-Adresse prüfen.' }, 400);
  const b = p.data;
  const g = await guardSubmission({ email: b.email, name: b.name, message: '', website: b.website, ts: b.ts, bucket: 'newsletter' });
  if (g.action === 'drop') return j({ ok: true });
  if (g.action === 'reject') return j({ error: g.error }, 400);
  const db = supabaseAdmin();
  const token = newToken();
  const { data: cur } = await db.from('immo_newsletter').select('id, confirmed_at, unsubscribed_at').eq('email', b.email).maybeSingle();
  if (cur?.confirmed_at && !cur.unsubscribed_at) return j({ ok: true, already: true });
  const row = { email: b.email, name: b.name || null, company: b.company || null, segment: b.segment, source: b.source || null, token_hash: hashToken(token), confirmed_at: null, unsubscribed_at: null, consent_text: b.segment === 'b2b' ? CONSENT_B2B : CONSENT_B2C, ip_hash: ip };
  const r = cur ? await db.from('immo_newsletter').update(row).eq('id', cur.id) : await db.from('immo_newsletter').insert(row);
  if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  const url = `${new URL(req.url).origin}/api/newsletter?confirm=${token}`;
  const sent = mailConfigured() && await sendMail(b.email, 'Bitte bestätigen: Neuigkeiten von ImmoAdv', `Guten Tag${b.name ? ' ' + b.name : ''},\n\nbitte bestätigen Sie, dass Sie Neuigkeiten von ImmoAdv per E-Mail erhalten möchten. Ohne Bestätigung senden wir Ihnen nichts.`, [], { title: 'Anmeldung bestätigen', button: { label: 'Anmeldung bestätigen', url }, note: 'Sie haben sich nicht angemeldet? Dann ignorieren Sie diese E-Mail einfach.' });
  return j({ ok: true, mailed: Boolean(sent) });
}

// Bestätigen (?confirm=) bzw. abbestellen (?unsub=) – Links aus den E-Mails.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const origin = new URL(req.url).origin;
  const db = supabaseAdmin();
  const un = q.get('unsub');
  if (un) {
    const id = adminConfigured() ? unsubId(un) : null;
    if (!id) return NextResponse.redirect(`${origin}/b2b?newsletter=ungueltig`, 303);
    const { data: row } = await db.from('immo_newsletter').update({ unsubscribed_at: new Date().toISOString() }).eq('id', id).select('segment').maybeSingle();
    return NextResponse.redirect(`${origin}${row?.segment === 'b2c' ? '/' : '/b2b'}?newsletter=abgemeldet`, 303);
  }
  const t = q.get('confirm') || '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(t) || !adminConfigured()) return NextResponse.redirect(`${origin}/b2b?newsletter=ungueltig`, 303);
  const { data } = await db.from('immo_newsletter').select('id, segment, email').eq('token_hash', hashToken(t)).maybeSingle();
  // Neue, ausdrückliche Einwilligung per Double-Opt-in hebt eine frühere Abmeldung für diese Adresse auf.
  if (data?.email) { const ks = await suppressionKeys({ email: data.email }).catch(() => []); if (ks.length) await db.from('immo_suppression').delete().in('key_hash', ks.map((k) => k.key)).eq('reason', 'abmeldung'); }
  const back = data?.segment === 'b2c' ? '/' : '/b2b';
  if (!data) return NextResponse.redirect(`${origin}${back}?newsletter=ungueltig`, 303);
  await db.from('immo_newsletter').update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null }).eq('id', data.id);
  return NextResponse.redirect(`${origin}${back}?newsletter=bestaetigt`, 303);
}
