import { NextResponse } from 'next/server';
import { mailToAllowed } from '@/lib/security/durable-limit';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';
import { checkEmailShape, honeypotTripped } from '@/lib/security/antispam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Account emails (confirm sign-up, reset password, resend confirmation) are sent by LeaseRun itself –
// in the LeaseRun design with sender "LeaseRun". Supabase only creates the secure one-time token (generateLink) and sends
// nothing. The link goes to leaserun.com/auth/confirm, where the token is redeemed.
// Without mail delivery configured (RESEND_API_KEY, NOTIFY_FROM_EMAIL) the route answers 503 – the page then falls back
// to Supabase delivery.
const SITE = 'https://leaserun.com';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({
  action: z.enum(['signup', 'recover', 'resend', 'magic']),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200).optional(),
  ref: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
  campaign: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
  website: z.string().optional(),
  next: z.enum(['/business-portal', '/creators']).optional(),
});
const confirmUrl = (hash: string, type: string, next?: string) => `${SITE}/auth/confirm?th=${encodeURIComponent(hash)}&type=${type}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
const DONE = { ok: true };

export async function POST(req: Request) {
  if (!mailConfigured() || !adminConfigured()) return j({ error: 'Email delivery is not set up.', code: 'no_mail' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Please check your email address and password.' }, 400);
  const { action, email, password, ref, campaign, website, next } = p.data;
  // Business portal and consumer area are separate: own texts, own sender, links into the matching portal.
  const biz = next === '/business-portal';
  const area = biz ? 'b2b' as const : 'b2c' as const;
  if (honeypotTripped(website)) return j(DONE);
  if (!allowRequest(`authmail:${ip}`, 8, 10 * 60_000) || !allowRequest(`authmail:${email}`, 4, 10 * 60_000)) {
    return j({ error: 'Too many requests. Please wait a few minutes.', code: 'over_request_rate_limit' }, 429);
  }
  const shape = checkEmailShape(email);
  if (!shape.ok) {
    const why = shape.reason === 'wegwerf' ? 'Please do not use a disposable email address.' : shape.reason === 'tippfehler' ? `Did you mean ${shape.suggestion}?` : 'Please enter a valid email address.';
    return j({ error: why, suggestion: shape.suggestion }, 400);
  }
  const admin = supabaseAdmin().auth.admin;

  if (action === 'signup') {
    if (!password) return j({ error: 'Please choose a password with at least 8 characters.', code: 'weak_password' }, 400);
    const { data, error } = await admin.generateLink({ type: 'signup', email, password, options: { redirectTo: `${SITE}/auth/login`, data: ref ? { partner_ref: ref, ...(campaign ? { partner_campaign: campaign } : {}) } : undefined } });
    if (error) {
      // Account already exists: notify that address by email (the page never reveals whether an account exists).
      if (/already|exists|registered/i.test(error.message)) {
        await sendMail(email, 'You already have a LeaseRun account',
          'Hello,\n\nsomeone (probably you) just tried to sign up with this email address. There is already an account for it.\n\nJust sign in. If you forgot your password, you can reset it.',
          [], { area, title: 'Your account already exists', button: { label: 'Sign in', url: biz ? `${SITE}/business-portal` : `${SITE}/auth/login` }, note: `Forgot your password? ${SITE}/auth/forgot${biz ? '?bereich=b2b' : ''} – If this wasn't you, you can ignore this email.` });
        return j(DONE);
      }
      if (/password/i.test(error.message)) return j({ error: 'That password is too weak. Please use at least 8 characters with letters and numbers.', code: 'weak_password' }, 400);
      console.error('authmail_signup', error.message);
      return j({ error: 'Sign-up failed. Please try again.' }, 502);
    }
    const hash = data.properties?.hashed_token;
    if (!hash) return j({ error: 'Sign-up failed.' }, 502);
    // Creator link: attribute the customer account to the creator (never blocking).
    if (ref && data.user?.id) await import('@/lib/creator/attribution').then((x) => x.recordSignupAttribution(data.user!.id, ref, campaign)).catch((e) => console.warn('creator_attribution', e instanceof Error ? e.message : e));
    const ok = await sendMail(email, biz ? 'Please confirm your email address – LeaseRun Business Portal' : 'Please confirm your email address – LeaseRun',
      biz ? 'Hello,\n\nplease confirm your email address. Then you can set up your business account; you will need your company details and proof of business registration.'
        : 'Hello,\n\nplease confirm your email address. Your account is then active and you can run the numbers on your first property right away.',
      [], { area, title: 'Confirm your email address', button: { label: 'Confirm email address', url: confirmUrl(hash, 'signup', next) }, note: 'This link is valid for 24 hours and can be used once. If you did not sign up, simply ignore this email.' });
    return ok ? j(DONE) : j({ error: 'The email could not be sent. Please try again later.' }, 502);
  }

  if (action === 'recover') {
    const { data, error } = await admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${SITE}/auth/reset` } });
    // Same answer whether or not an account exists (no way to probe for registered addresses).
    if (error || !data.properties?.hashed_token) return j(DONE);
    await sendMail(email, biz ? 'Reset your password – LeaseRun Business Portal' : 'Reset your password – LeaseRun',
      biz ? 'Hello,\n\nyou asked to reset your password for the LeaseRun Business Portal. Use the button below to set a new one; you will then be signed in to the portal.'
        : 'Hello,\n\nyou asked to reset your LeaseRun password. Use the button below to set a new one.',
      [], { area, title: 'Set a new password', button: { label: 'Set new password', url: confirmUrl(data.properties.hashed_token, 'recovery', next) }, note: 'This link is valid for a short time and can be used once. If you did not request this, ignore this email – your password stays the same.' });
    return j(DONE);
  }

  // magic: passwordless sign-in via one-time link – existing accounts only (no account without sign-up and terms).
  if (action === 'magic') {
    const { data, error } = await admin.generateLink({ type: 'magiclink', email, options: { redirectTo: biz ? `${SITE}/business-portal` : `${SITE}/app/dashboard` } });
    if (error || !data.properties?.hashed_token) return j(DONE);
    const u = data.user;
    // If Supabase created a new account in the process: remove it immediately and send nothing (same answer for every address).
    if (u && !u.last_sign_in_at && !u.email_confirmed_at && Date.now() - new Date(u.created_at).getTime() < 5_000) { await admin.deleteUser(u.id).catch(() => null); return j(DONE); }
    await sendMail(email, biz ? 'Your sign-in link – LeaseRun Business Portal' : 'Your sign-in link – LeaseRun',
      biz ? 'Hello,\n\nhere is your sign-in link for the LeaseRun Business Portal. One click and you are signed in.' : 'Hello,\n\nhere is your sign-in link for LeaseRun. One click and you are signed in.',
      [], { area, title: 'Sign in now', button: { label: 'Sign in to LeaseRun', url: confirmUrl(data.properties.hashed_token, 'magiclink', next) }, note: 'This link is valid for a short time and can be used once. If you did not request it, ignore this email – your account stays protected.' });
    return j(DONE);
  }

  // resend: send the confirmation again (the sign-in link confirms the address at the same time).
  const { data, error } = await admin.generateLink({ type: 'magiclink', email, options: { redirectTo: biz ? `${SITE}/business-portal` : `${SITE}/app/dashboard` } });
  if (error || !data.properties?.hashed_token) return j(DONE);
  // As with "magic": if Supabase just created an account, remove it and send nothing – no account without sign-up.
  { const u = data.user; if (u && !u.last_sign_in_at && !u.email_confirmed_at && Date.now() - new Date(u.created_at).getTime() < 5_000) { await admin.deleteUser(u.id).catch(() => null); return j(DONE); } }
  if (!(await mailToAllowed('auth-resend', email))) return j(DONE);
  await sendMail(email, biz ? 'Your confirmation link – LeaseRun Business Portal' : 'Your confirmation link – LeaseRun',
    biz ? 'Hello,\n\nhere is your new link. It confirms your email address and signs you in to the Business Portal.' : 'Hello,\n\nhere is your new link. It confirms your email address and signs you in to LeaseRun.',
    [], { area, title: 'Confirm your email address', button: { label: 'Confirm and sign in', url: confirmUrl(data.properties.hashed_token, 'magiclink', next) }, note: 'This link is valid for a short time and can be used once.' });
  return j(DONE);
}
