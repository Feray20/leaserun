import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { guardSubmission } from '@/lib/security/antispam';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { anonymizedIpHash } from '@/lib/supabase/admin';
import { hasLink, mailToAllowed } from '@/lib/security/durable-limit';
import { logSecurity } from '@/lib/security/seclog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Request a refund" (LeaseRun refund policy, see /refund): available without login; the confirmation with content and
// time of receipt is sent right away by email. No reason is required. There is no statutory withdrawal right in the US –
// this is LeaseRun's own, voluntary policy.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`widerruf:${ip}`, 5, 60_000)) return j({ error: 'Too many requests. Please try again in a minute.' }, 429);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return j({ error: 'Invalid request.' }, 400);
  const name = clean(body.name, 120), email = clean(body.email, 200).toLowerCase();
  const contract = clean(body.contract, 120) || 'LeaseRun purchase', ref = clean(body.ref, 80);
  const reason = clean(body.reason, 1000);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(clean(body.date, 10)) ? clean(body.date, 10) : '';
  if (name.length < 2 || !EMAIL_RE.test(email)) return j({ error: 'Please enter your name and a valid email address.' }, 400);
  // A refund request is a customer request: only drop clear bot signals, never reject because of content.
  const guard = await guardSubmission({ email, name, message: '', website: body.website, ts: undefined, bucket: 'widerruf' }); // timestamp deliberately not checked: a page left open for long must never silently drop a request – only the bot field counts
  if (guard.action === 'drop') return j({ ok: true, receivedAt: '' });
  if (!mailConfigured()) return j({ error: 'Online refund requests are temporarily unavailable. Please email support@leaserun.com – that works just as well.' }, 503);

  const receivedAt = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'long', timeZone: 'America/New_York' }).format(new Date());
  const text = [
    'Refund request',
    '',
    'I am requesting a refund for the following purchase.',
    '',
    `Received: ${receivedAt}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Purchase: ${contract}`,
    ref ? `Receipt or order number: ${ref}` : '',
    date ? `Purchased on: ${new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC' })}` : '',
    reason ? `Comment: ${reason}` : '',
  ].filter(Boolean).join('\n');
  if (hasLink(name) || hasLink(contract) || hasLink(ref)) return j({ error: 'Please enter the details without web addresses.' }, 400);
  if (!(await mailToAllowed('widerruf', email))) { logSecurity('mail_abuse', `widerruf:${ip}`, { detail: 'limit per recipient' }); return j({ error: 'We already received refund requests for this address today. If you need anything else, please email support@leaserun.com.' }, 429); }
  const to = process.env.CANCEL_TO_EMAIL || 'support@leaserun.com';
  try {
    if (!(await sendMail(to, `Refund request: ${contract} – ${name}`, text, [], { title: 'New refund request' }))) throw Error('mail');
    if (!(await sendMail(email, 'We received your LeaseRun refund request',
      `Hi ${name},\n\nWe received your refund request. This email confirms receipt; it is not yet the decision on the refund. We review every request within 2 business days under our Refund Policy (leaserun.com/refund). Approved refunds go back to your original payment method; banks usually post them within 5–10 business days.\n\n${text}`,
      [], { title: 'Your refund request was received' }))) throw Error('mail');
  } catch {
    return j({ error: 'Your refund request could not be sent. Please email support@leaserun.com.' }, 502);
  }
  return j({ ok: true, receivedAt });
}
