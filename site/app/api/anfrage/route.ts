import { z } from 'zod';
import { NextResponse } from 'next/server';
import { pushAdmins } from '@/lib/admin/push';
import { supportInbox } from '@/lib/notify/inbox';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { guardSubmission } from '@/lib/security/antispam';
import { intakeClosed } from '@/lib/security/panic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Replies via /request (buttons in personal outreach emails: materials, partnership, creator or trial access).
// Arrives as an email in the inbox (reply-to = sender) and as a history entry on the outreach contact.
// The token t is the same as in the email's unsubscribe link; it tells us which email was answered.
const ART: Record<string, { label: string; opts: Record<string, string> }> = {
  unterlagen: { label: 'Materials', opts: { keyfacts: 'Company profile & key facts', zahlen: 'Numbers & worked example', muster: 'Sample documents', beitrag: 'Topic pitch / outline / guest article', interview: 'Interview / expert source' } },
  kooperation: { label: 'Business partnership', opts: { unterlagen: 'Materials & terms', testzugang: 'Trial account', rueckruf: 'Callback' } },
  creator: { label: 'Creator access', opts: { zugang: 'Personal access (Investor Pro)', code: 'Own discount code', provision: 'Commission & payout info' } },
  zugang: { label: 'Trial account', opts: { zugang: 'Investor Pro trial', demo: 'Product demo via Teams', community: 'Offer for members / community' } },
};
const Schema = z.object({
  art: z.enum(['unterlagen', 'kooperation', 'creator', 'zugang']),
  opts: z.array(z.string().max(20)).min(1).max(6),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  org: z.string().trim().max(160).optional().default(''),
  message: z.string().trim().max(2000).optional().default(''),
  t: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional().or(z.literal('')).default(''),
  privacy: z.literal(true),
  website: z.string().optional().default(''),
  ts: z.coerce.number().optional(),
});
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  if (await intakeClosed()) return json({ error: 'Temporarily unavailable. Please just reply to our email.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`anfrage:${ip}`, 4, 10 * 60_000)) return json({ error: 'Too many requests. Please try again later.' }, 429);
  const p = Schema.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    const msg = f === 'privacy' ? 'Please accept the Privacy Policy.' : f === 'email' ? 'Please enter a valid email address.' : f === 'opts' ? 'Please check at least one item.' : f === 'name' ? 'Please enter your name.' : 'Please check your entries.';
    return json({ error: msg, field: f }, 400);
  }
  const b = p.data, art = ART[b.art];
  const wishes = b.opts.map((o) => art.opts[o]).filter(Boolean);
  if (!wishes.length) return json({ error: 'Please check at least one item.', field: 'opts' }, 400);
  const guard = await guardSubmission({ email: b.email, name: b.name, message: `${b.message} ${b.org}`.trim() || wishes.join(', '), website: b.website, ts: b.ts, bucket: 'anfrage' });
  if (guard.action === 'drop') return json({ ok: true }, 201);
  if (guard.action === 'reject') return json({ error: guard.error, field: guard.field }, 400);

  // Reference: which email was answered (subject, original recipient) – only with a valid token.
  let ref: { email: string; label: string | null } | null = null;
  if (b.t && adminConfigured()) {
    const { data } = await supabaseAdmin().from('lr_outreach_links').select('email, label').eq('token', b.t).maybeSingle();
    if (data) ref = { email: String(data.email), label: (data.label as string) || null };
  }
  if (!mailConfigured()) return json({ error: 'The form is unavailable right now. Please just reply to our email.' }, 503);
  const flag = guard.flagged ? ' [possible spam]' : '';
  const who = b.org || b.name;
  const text = [
    `${b.name} · ${b.email}${b.org ? ` · ${b.org}` : ''}`,
    `Wants: ${wishes.join(', ')}`,
    ref ? `Reply to: "${ref.label || 'outreach email'}" (sent to ${ref.email})` : 'Not linked to a specific email',
    b.message ? `\n${b.message}` : '',
  ].join('\n');
  const sent = await sendMail(supportInbox(), `Reply via request page${flag}: ${art.label} – ${who}`.slice(0, 200), text, [], { replyTo: b.email, title: `New reply: ${art.label}` });
  if (!sent) return json({ error: 'Your request couldn’t be sent right now. Please just reply to our email.' }, 502);
  await pushAdmins('mail', `Reply: ${art.label}`, `${who} wants: ${wishes.join(', ')}`.slice(0, 160), 'anfrage').catch(() => {});

  // History on the outreach contact (if any) – errors here must not block the reply.
  if (ref && adminConfigured()) {
    try {
      const db = supabaseAdmin();
      const { data: cs } = await db.from('lr_crm_contacts').select('id').ilike('email', ref.email).limit(3);
      if (cs?.length) await db.from('lr_crm_activities').insert(cs.map((c) => ({ contact_id: c.id, type: 'notiz', note: `Reply via request page (${art.label}): ${wishes.join(', ')} – ${b.name} <${b.email}>`.slice(0, 1000), actor: 'anfrage-seite' })));
    } catch { /* history is optional */ }
  }
  return json({ ok: true }, 201);
}
