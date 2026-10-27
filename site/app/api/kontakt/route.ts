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

// Contact widget for consumers (bottom right on the website). Business inquiries go through /api/b2b/contact.
// Topic keys are internal (stored/sent by the widget) – do not rename.
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
const TOPIC: Record<string, string> = { frage: 'General question', konto: 'Account & sign-in', zahlung: 'Payment & billing', kreditmappe: 'Lender Package', sonstiges: 'Other' };
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  if (await intakeClosed()) return json({ error: 'Temporarily unavailable. Please email support@leaserun.com.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`kontakt:${ip}`, 3, 10 * 60_000)) return json({ error: 'Too many requests. Please try again later.' }, 429);
  const p = Schema.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    const msg = f === 'privacy' ? 'Please confirm that you read the privacy notice.' : f === 'message' ? 'Please describe your request in at least 10 characters.' : f === 'email' ? 'Please enter a valid email address.' : 'Please check your entries.';
    return json({ error: msg, field: f }, 400);
  }
  const b = p.data;
  const guard = await guardSubmission({ email: b.email, name: b.name, message: b.message, website: b.website, ts: b.ts, bucket: 'kontakt' });
  if (guard.action === 'drop') return json({ ok: true }, 201);
  if (guard.action === 'reject') return json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, 400);
  const admins = [supportInbox()];
  if (!mailConfigured() || !admins.length) return json({ error: 'The form is unavailable right now. Please email support@leaserun.com.' }, 503);
  const flag = guard.flagged ? ' [suspected spam]' : '';
  let sent = false;
  for (const to of admins) {
    sent = (await sendMail(to, `Consumer contact${flag}: ${TOPIC[b.topic]}`, `${b.name} · ${b.email}\nTopic: ${TOPIC[b.topic]}${b.page ? `\nPage: ${b.page}` : ''}\n\n${b.message}`, [], { replyTo: b.email, title: 'New contact request' })) || sent;
  }
  if (sent) await pushAdmins('mail', 'New contact request', 'A new request is waiting in the Inbox.', 'anfrage').catch(() => {});
  if (!sent) return json({ error: "Your message couldn't be sent right now. Please email support@leaserun.com." }, 502);
  return json({ ok: true }, 201);
}
