import { suppressionKeys } from '@/lib/marketing/suppression';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { hashToken, newToken } from '@/lib/b2b/core';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { guardSubmission } from '@/lib/security/antispam';
import { hasLink, mailToAllowed } from '@/lib/security/durable-limit';
import { CONSENT_B2B, CONSENT_B2C, CONSENT_B2C_BOX, unsubId, unsubToken } from '@/lib/marketing/consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Neuigkeiten für Berater (B2B) bzw. Kunden (B2C) per E-Mail – nur mit Double-Opt-in (Bestätigungslink),
// jederzeit abbestellbar. Grundlage für jede werbliche E-Mail aus der Werbungszentrale.
// Herkunftsseite der Anmeldebox als „box:/pfad“ (Rücksprung nach der Bestätigung, Auswertung je Seite).
const BOX = /^box:(\/[a-z0-9/-]{0,55})$/;
const boxPath = (src?: string | null) => (src && BOX.exec(src)?.[1]) || null;
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).optional().default(''),
  company: z.string().trim().max(160).optional().default(''),
  segment: z.enum(['b2b', 'b2c']).default('b2b'),
  source: z.string().trim().max(60).optional().default(''),
  consent: z.literal(true),
  // Anmeldebox „Kauf-Checkliste + Zins-Update“ (public/src/newsletter-box.mjs); source = Seite der Anmeldung
  box: z.boolean().optional().default(false),
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
  if (b.box) { b.segment = 'b2c'; b.source = `box:${/^\/[a-z0-9/-]{0,55}$/.test(b.source) ? b.source : '/'}`; }
  const g = await guardSubmission({ email: b.email, name: b.name, message: '', website: b.website, ts: b.ts, bucket: 'newsletter' });
  if (g.action === 'drop') return j({ ok: true });
  if (g.action === 'reject') return j({ error: g.error }, 400);
  if (hasLink(b.name || '') || hasLink(b.company || '')) return j({ error: 'Bitte Name und Firma ohne Internetadressen angeben.' }, 400);
  if (!(await mailToAllowed('newsletter', b.email))) return j({ ok: true });
  const db = supabaseAdmin();
  const token = newToken();
  const { data: cur } = await db.from('lr_newsletter').select('id, confirmed_at, unsubscribed_at').eq('email', b.email).maybeSingle();
  if (cur?.confirmed_at && !cur.unsubscribed_at) return j({ ok: true, already: true });
  const row = { email: b.email, name: b.name || null, company: b.company || null, segment: b.segment, source: b.source || null, token_hash: hashToken(token), confirmed_at: null, unsubscribed_at: null, consent_text: b.box ? CONSENT_B2C_BOX : b.segment === 'b2b' ? CONSENT_B2B : CONSENT_B2C, ip_hash: ip };
  const r = cur ? await db.from('lr_newsletter').update(row).eq('id', cur.id) : await db.from('lr_newsletter').insert(row);
  if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  const url = `${new URL(req.url).origin}/api/newsletter?confirm=${token}`;
  const sent = mailConfigured() && (b.box
    ? await sendMail(b.email, 'Bitte bestätigen: Ihre Kauf-Checkliste von LeaseRun', 'Guten Tag,\n\nbitte bestätigen Sie Ihre Anmeldung zum LeaseRun-Newsletter (monatliches Zins-Update). Direkt nach der Bestätigung erhalten Sie den Link zur Kauf-Checkliste als PDF. Ohne Bestätigung senden wir Ihnen nichts.', [], { title: 'Anmeldung bestätigen', button: { label: 'Anmeldung bestätigen', url }, note: 'Sie haben sich nicht angemeldet? Dann ignorieren Sie diese E-Mail einfach.' })
    : await sendMail(b.email, 'Bitte bestätigen: Neuigkeiten von LeaseRun', `Guten Tag${b.name ? ' ' + b.name : ''},\n\nbitte bestätigen Sie, dass Sie Neuigkeiten von LeaseRun per E-Mail erhalten möchten. Ohne Bestätigung senden wir Ihnen nichts.`, [], { title: 'Anmeldung bestätigen', button: { label: 'Anmeldung bestätigen', url }, note: 'Sie haben sich nicht angemeldet? Dann ignorieren Sie diese E-Mail einfach.' }));
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
    const { data: row } = await db.from('lr_newsletter').update({ unsubscribed_at: new Date().toISOString() }).eq('id', id).select('segment').maybeSingle();
    return NextResponse.redirect(`${origin}${row?.segment === 'b2c' ? '/' : '/business'}?newsletter=abgemeldet`, 303);
  }
  const t = q.get('confirm') || '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(t) || !adminConfigured()) return NextResponse.redirect(`${origin}/b2b?newsletter=ungueltig`, 303);
  const { data } = await db.from('lr_newsletter').select('id, segment, email, source, confirmed_at').eq('token_hash', hashToken(t)).maybeSingle();
  // Neue, ausdrückliche Einwilligung per Double-Opt-in hebt eine frühere Abmeldung für diese Adresse auf.
  if (data?.email) { const ks = await suppressionKeys({ email: data.email }).catch(() => []); if (ks.length) await db.from('lr_suppression').delete().in('key_hash', ks.map((k) => k.key)).eq('reason', 'abmeldung'); }
  const box = boxPath(data?.source);
  const back = box || (data?.segment === 'b2c' ? '/' : '/business');
  if (!data) return NextResponse.redirect(`${origin}${back}?newsletter=ungueltig`, 303);
  await db.from('lr_newsletter').update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null }).eq('id', data.id);
  // Anmeldebox: Checkliste erst nach der Bestätigung ausliefern – einmalig (erneutes Klicken auf den Link schickt nichts nochmal).
  if (box && !data.confirmed_at && mailConfigured()) {
    const unsub = `${origin}/api/newsletter?unsub=${unsubToken(data.id)}`;
    await sendMail(data.email, 'Ihre Kauf-Checkliste von LeaseRun', 'Guten Tag,\n\ndanke für Ihre Bestätigung. Hier ist Ihre Kauf-Checkliste als PDF: alle Unterlagen, die Banken für eine Immobilienfinanzierung typischerweise sehen wollen. Einmal im Monat erhalten Sie außerdem unser Zins-Update.', [], {
      title: 'Ihre Kauf-Checkliste', button: { label: 'Checkliste herunterladen', url: `${origin}/api/newsletter/checkliste` },
      note: `Sie erhalten diese E-Mail, weil Sie den LeaseRun-Newsletter bestellt haben. Abmelden: ${unsub}`,
      headers: { 'List-Unsubscribe': `<${origin}/api/newsletter/unsub?t=${unsubToken(data.id)}>, <mailto:support@leaserun.com?subject=Abmelden>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }).catch(() => false);
  }
  return NextResponse.redirect(`${origin}${back}?newsletter=bestaetigt`, 303);
}
