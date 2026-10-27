import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { guardSubmission } from '@/lib/security/antispam';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { anonymizedIpHash } from '@/lib/supabase/admin';
import { hasLink, mailToAllowed } from '@/lib/security/durable-limit';
import { logSecurity } from '@/lib/security/seclog';
import { billingEnabled, stripe } from '@/lib/billing/stripe';

// Online cancellation (FTC negative option rule / state automatic-renewal laws, e.g. California): customers can cancel
// online as easily as they signed up – no login required, only name and the account email for identification.
// If billing is active and a live subscription is found for that email, its renewal is stopped right away
// (cancel_at_period_end) – the customer keeps access until the end of the paid period and is not charged again.
// Email via Resend (https://resend.com), configured with:
//   RESEND_API_KEY      – API key
//   NOTIFY_FROM_EMAIL   – verified sender address (sender name is always "LeaseRun")
//   CANCEL_TO_EMAIL     – recipient at LeaseRun (default: support@leaserun.com)

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
async function send(to: string, subject: string, text: string, title: string) {
  if (!(await sendMail(to, subject, text, [], { title }))) throw new Error('mail_failed');
}

export async function POST(req: Request) {
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`kuendigung:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again in a minute.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const contract = clean(body.contract, 120) || 'LeaseRun subscription';
  // 'immediate' = stop now (no further access); default = at the end of the paid period. Old values stay accepted.
  const immediate = body.type === 'immediate' || body.type === 'ausserordentlich';
  const reason = clean(body.reason, 2000);
  if (!name || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter your name and a valid email address.' }, { status: 400 });
  }
  // Bot/fake protection (a cancellation is a request we must honor – avoid false blocks; only clear signals).
  const guard = await guardSubmission({ email, name, message: reason, website: body.website, ts: undefined, bucket: 'kuendigung' }); // timestamp deliberately not checked: a page left open for long must never silently drop a cancellation – only the bot field counts
  if (guard.action === 'drop') return NextResponse.json({ ok: true });
  if (guard.action === 'reject') return NextResponse.json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, { status: 400 });

  // Protection against abuse as a mail relay: no links in name/plan, durable limit per recipient.
  if (hasLink(name) || hasLink(contract)) return NextResponse.json({ error: 'Please enter name and plan without web addresses.' }, { status: 400 });
  if (!(await mailToAllowed('kuendigung', email))) { logSecurity('mail_abuse', `kuendigung:${ip}`, { detail: 'limit per recipient' }); return NextResponse.json({ error: 'We already received cancellations for this address today. If you need anything else, please email support@leaserun.com.' }, { status: 429 }); }
  const to = process.env.CANCEL_TO_EMAIL || 'support@leaserun.com';
  if (!mailConfigured()) {
    return NextResponse.json(
      { error: 'Online cancellation is temporarily unavailable. Please cancel by emailing support@leaserun.com – that works just as well.' },
      { status: 503 },
    );
  }

  const fmtDate = (d: Date) => new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'America/New_York' }).format(d);
  const receivedAt = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long', timeStyle: 'long', timeZone: 'America/New_York',
  }).format(new Date());

  // Find a live subscription for this email at Stripe and stop the renewal right away. The end date only goes into the
  // emails (the confirmation goes to exactly this address), never into the API response.
  let endDate = '';
  let stopped = false;
  if (billingEnabled() && EMAIL_RE.test(email)) {
    try {
      const cs = await stripe().customers.list({ email, limit: 5 });
      for (const c of cs.data) {
        const subs = await stripe().subscriptions.list({ customer: c.id, status: 'active', limit: 5 });
        for (const sub of subs.data) {
          const end = (sub.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
          // Only the reversible step runs automatically (stop renewal at period end; the confirmation goes to the account
          // email, so a request by someone else is noticed and can be undone). Immediate termination is handled by support.
          if (!sub.cancel_at_period_end) await stripe().subscriptions.update(sub.id, { cancel_at_period_end: true, metadata: { canceled_via: 'leaserun.com/cancel' } });
          stopped = true;
          if (end && !endDate) endDate = fmtDate(new Date(end * 1000));
        }
      }
    } catch (e) { console.warn('kuendigung_stripe', e instanceof Error ? e.message : e); }
  }

  const text = [
    'Cancellation request',
    '',
    `Received: ${receivedAt}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Plan: ${contract}`,
    `Type: ${immediate ? 'cancel immediately' : 'cancel at the end of the current billing period'}`,
    immediate
      ? 'Effective: immediately on request. Automatic renewal is stopped; our team ends access and reviews a prorated refund within 2 business days.'
      : endDate ? `Access until: ${endDate} (end of the paid period). You will not be charged again.` : 'Access until: the end of the current billing period. You will not be charged again; we will confirm the exact date shortly.',
    stopped ? 'Status: automatic renewal stopped.' : 'Status: we will process your cancellation and confirm it by email.',
    reason ? `Reason: ${reason}` : '',
  ].filter(Boolean).join('\n');

  try {
    await send(to, `Cancellation: ${contract} – ${name}`, text, 'New cancellation');
    await send(email, 'Your LeaseRun cancellation confirmation',
      `Hi ${name},\n\nWe received your cancellation. This email is your confirmation – please keep it for your records.\n\n${text.replace(/\nReason: [\s\S]*$/, '')}\n\nChanged your mind? You can subscribe again anytime at leaserun.com/pricing.`, 'Your cancellation was received');
  } catch {
    return NextResponse.json(
      { error: 'Your cancellation could not be sent. Please cancel by emailing support@leaserun.com.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, receivedAt });
}
