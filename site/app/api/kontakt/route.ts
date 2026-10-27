import { z } from 'zod';
import { pushAdmins } from '@/lib/admin/push';
import { supportInbox } from '@/lib/notify/inbox';
import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { guardSubmission } from '@/lib/security/antispam';
import { intakeClosed } from '@/lib/security/panic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kontakt-Widget für Privatkunden (unten rechts auf der Website). Anfragen von Unternehmen laufen über /api/b2b/contact.
const Schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  topic: z.enum(['frage', 'konto', 'zahlung', 'kreditmappe', 'sonstiges']).default('frage'),
  message: z.string().trim().min(10).max(2000),
  page: z.string().trim().max(200).optional().default(''),
  privacy: z.literal(true),
  website: z.string().optional().default(''),
  ts: z.coerce.number().optional(),
});
const TOPIC: Record<string, string> = { frage: 'Allgemeine Frage', konto: 'Konto & Anmeldung', zahlung: 'Zahlung & Rechnung', kreditmappe: 'Kreditmappe', sonstiges: 'Sonstiges' };
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  if (await intakeClosed()) return json({ error: 'Vorübergehend nicht möglich. Bitte schreiben Sie an support@leaserun.com.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`kontakt:${ip}`, 3, 10 * 60_000)) return json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429);
  const p = Schema.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    const msg = f === 'privacy' ? 'Bitte die Datenschutzhinweise bestätigen.' : f === 'message' ? 'Bitte beschreiben Sie Ihr Anliegen in mindestens 10 Zeichen.' : f === 'email' ? 'Bitte eine gültige E-Mail-Adresse angeben.' : 'Bitte die Angaben prüfen.';
    return json({ error: msg, field: f }, 400);
  }
  const b = p.data;
  const guard = await guardSubmission({ email: b.email, name: b.name, message: b.message, website: b.website, ts: b.ts, bucket: 'kontakt' });
  if (guard.action === 'drop') return json({ ok: true }, 201);
  if (guard.action === 'reject') return json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, 400);
  const admins = [supportInbox()];
  if (!mailConfigured() || !admins.length) return json({ error: 'Das Formular ist gerade nicht erreichbar. Bitte schreiben Sie an support@leaserun.com.' }, 503);
  const flag = guard.flagged ? ' [Spam-Verdacht]' : '';
  let sent = false;
  for (const to of admins) {
    sent = (await sendMail(to, `Kontakt Privatkunde${flag}: ${TOPIC[b.topic]}`, `${b.name} · ${b.email}\nThema: ${TOPIC[b.topic]}${b.page ? `\nSeite: ${b.page}` : ''}\n\n${b.message}`, [], { replyTo: b.email, title: 'Neue Kontaktanfrage' })) || sent;
  }
  if (sent) await pushAdmins('mail', 'Neue Kontaktanfrage', 'Im Postfach wartet eine neue Anfrage.', 'anfrage').catch(() => {});
  if (!sent) return json({ error: 'Die Nachricht konnte gerade nicht gesendet werden. Bitte schreiben Sie an support@leaserun.com.' }, 502);
  return json({ ok: true }, 201);
}
