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

// Updates for professionals (B2B) and consumers (B2C) by email – double opt-in only (confirmation link), unsubscribe any
// time. The basis for every marketing email from the Marketing center. Every marketing email carries an unsubscribe link,
// List-Unsubscribe headers and the company postal address (CAN-SPAM).
// Source page of the signup box as "box:/path" (redirect after confirmation, stats per page).
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
  // Signup box "Home-buying checklist + rate update" (public/src/newsletter-box.mjs); source = signup page
  box: z.boolean().optional().default(false),
  website: z.string().optional().default(''),
  ts: z.coerce.number().optional(),
});

export async function POST(req: Request) {
  if (!adminConfigured()) return j({ error: 'Not available.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`nl:${ip}`, 5, 10 * 60_000)) return j({ error: 'Too many requests.' }, 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: String(p.error.issues[0]?.path[0]) === 'consent' ? 'Please agree to receive emails.' : 'Please check your email address.' }, 400);
  const b = p.data;
  if (b.box) { b.segment = 'b2c'; b.source = `box:${/^\/[a-z0-9/-]{0,55}$/.test(b.source) ? b.source : '/'}`; }
  const g = await guardSubmission({ email: b.email, name: b.name, message: '', website: b.website, ts: b.ts, bucket: 'newsletter' });
  if (g.action === 'drop') return j({ ok: true });
  if (g.action === 'reject') return j({ error: g.error }, 400);
  if (hasLink(b.name || '') || hasLink(b.company || '')) return j({ error: 'Please enter your name and company without web addresses.' }, 400);
  if (!(await mailToAllowed('newsletter', b.email))) return j({ ok: true });
  const db = supabaseAdmin();
  const token = newToken();
  const { data: cur } = await db.from('lr_newsletter').select('id, confirmed_at, unsubscribed_at').eq('email', b.email).maybeSingle();
  if (cur?.confirmed_at && !cur.unsubscribed_at) return j({ ok: true, already: true });
  const row = { email: b.email, name: b.name || null, company: b.company || null, segment: b.segment, source: b.source || null, token_hash: hashToken(token), confirmed_at: null, unsubscribed_at: null, consent_text: b.box ? CONSENT_B2C_BOX : b.segment === 'b2b' ? CONSENT_B2B : CONSENT_B2C, ip_hash: ip };
  const r = cur ? await db.from('lr_newsletter').update(row).eq('id', cur.id) : await db.from('lr_newsletter').insert(row);
  if (r.error) return j({ error: 'Saving failed.' }, 500);
  const url = `${new URL(req.url).origin}/api/newsletter?confirm=${token}`;
  const sent = mailConfigured() && (b.box
    ? await sendMail(b.email, 'Please confirm: your home-buying checklist from LeaseRun', "Hi there,\n\nplease confirm your subscription to the LeaseRun newsletter (monthly mortgage rate update). Right after you confirm, you'll get the link to the home-buying checklist PDF. We won't send anything until you confirm.", [], { title: 'Confirm your subscription', button: { label: 'Confirm subscription', url }, note: "Didn't sign up? Just ignore this email." })
    : await sendMail(b.email, 'Please confirm: updates from LeaseRun', `Hi${b.name ? ' ' + b.name : ' there'},\n\nplease confirm that you'd like to receive updates from LeaseRun by email. We won't send anything until you confirm.`, [], { title: 'Confirm your subscription', button: { label: 'Confirm subscription', url }, note: "Didn't sign up? Just ignore this email." }));
  return j({ ok: true, mailed: Boolean(sent) });
}

// Confirm (?confirm=) or unsubscribe (?unsub=) – links from the emails.
// The ?newsletter= values (bestaetigt = confirmed, abgemeldet = unsubscribed, ungueltig = invalid) are read by the pages – do not rename.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const origin = new URL(req.url).origin;
  const db = supabaseAdmin();
  const un = q.get('unsub');
  if (un) {
    const id = adminConfigured() ? unsubId(un) : null;
    if (!id) return NextResponse.redirect(`${origin}/business?newsletter=ungueltig`, 303);
    const { data: row } = await db.from('lr_newsletter').update({ unsubscribed_at: new Date().toISOString() }).eq('id', id).select('segment').maybeSingle();
    return NextResponse.redirect(`${origin}${row?.segment === 'b2c' ? '/' : '/business'}?newsletter=abgemeldet`, 303);
  }
  const t = q.get('confirm') || '';
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(t) || !adminConfigured()) return NextResponse.redirect(`${origin}/business?newsletter=ungueltig`, 303);
  const { data } = await db.from('lr_newsletter').select('id, segment, email, source, confirmed_at').eq('token_hash', hashToken(t)).maybeSingle();
  // A new, explicit double opt-in lifts an earlier unsubscribe for this address.
  if (data?.email) { const ks = await suppressionKeys({ email: data.email }).catch(() => []); if (ks.length) await db.from('lr_suppression').delete().in('key_hash', ks.map((k) => k.key)).eq('reason', 'abmeldung'); }
  const box = boxPath(data?.source);
  const back = box || (data?.segment === 'b2c' ? '/' : '/business');
  if (!data) return NextResponse.redirect(`${origin}${back}?newsletter=ungueltig`, 303);
  await db.from('lr_newsletter').update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null }).eq('id', data.id);
  // Signup box: deliver the checklist only after confirmation – once (clicking the link again sends nothing more).
  if (box && !data.confirmed_at && mailConfigured()) {
    const unsub = `${origin}/api/newsletter?unsub=${unsubToken(data.id)}`;
    await sendMail(data.email, 'Your home-buying checklist from LeaseRun', 'Hi there,\n\nthanks for confirming. Here is your home-buying checklist as a PDF: every document lenders typically ask for when you apply for a mortgage. Once a month you will also get our mortgage rate update.', [], {
      title: 'Your home-buying checklist', button: { label: 'Download the checklist', url: `${origin}/api/newsletter/checkliste` },
      note: `You're receiving this email because you signed up for the LeaseRun newsletter. Unsubscribe: ${unsub}`, marketing: true,
      headers: { 'List-Unsubscribe': `<${origin}/api/newsletter/unsub?t=${unsubToken(data.id)}>, <mailto:support@leaserun.com?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }).catch(() => false);
  }
  return NextResponse.redirect(`${origin}${back}?newsletter=bestaetigt`, 303);
}
