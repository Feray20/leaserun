import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BRAND_IMAGES, resendSend, mailboxAddress, type OutAttachment } from '@/lib/mail/resend';
import { esc, fillTemplate, htmlToText, postalAddress, renderBrief, sanitizeBody, SIG_IMG, splitGreeting, wrapDocument } from '@/lib/mail/template';
import { isSuppressed } from '@/lib/marketing/suppression';
import { declinedRecipients } from '@/lib/mail/decline';
import { repairDraftHtml } from '@/lib/mail/draft-repair';
import { ctaBlock, ctaText, parseCta } from '@/lib/mail/cta';
import { blockDraft, legalCheck, missingUnsub } from '@/lib/mail/legal-gate';

// Build and send an outgoing message from a draft.
// Internal status values (stored in the DB, do not rename): entwurf = draft, gesendet = sent, fehler = failed, gesperrt = blocked.
// design: frei = written in the editor, fertig = finished designed draft, eingang = received, system = copy of an automatic email.
export type MailRow = {
  id: string; thread_id: string; direction: 'in' | 'out'; folder: string; status: string | null; design: 'frei' | 'fertig' | 'eingang' | 'system';
  from_email: string; from_name: string | null; to_emails: string[]; cc_emails: string[]; bcc_emails?: string[] | null; subject: string; html: string | null; text_body: string | null;
  termin_fallback: string | null; token: string | null; with_unsub: boolean; message_id: string | null; in_reply_to: string | null; refs: string | null;
  attachments: { name: string; type: string; size: number; path: string; cid?: string | null; inline?: boolean }[]; contact_id: string | null;
  created_at: string; sent_at: string | null; received_at: string | null; snippet: string | null; read_at: string | null; starred: boolean;
  cta?: unknown;
};
const BOOKING = 'outreach_booking_url';
export const unsubUrl = (t: string | null) => (t ? `https://leaserun.com/api/abmelden?t=${t}` : null);

export async function bookingUrl(): Promise<string | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', BOOKING).maybeSingle();
  // Default: our own booking page (Teams link once accepted); a custom link set in the mailbox overrides it.
  return typeof data?.value === 'string' && /^https:\/\//.test(data.value) ? data.value : 'https://leaserun.com/book';
}

// Unsubscribe link per recipient (only with exactly one recipient, otherwise no link).
export async function ensureToken(m: MailRow): Promise<string | null> {
  if (!m.with_unsub || m.to_emails.length !== 1) return null;
  const email = m.to_emails[0];
  if (m.token) return m.token;
  const db = supabaseAdmin();
  const { data } = await db.from('lr_outreach_links').select('token').eq('email', email).is('opted_out_at', null).limit(1);
  const t = (data?.[0]?.token as string) || randomBytes(18).toString('base64url');
  if (!data?.[0]) await db.from('lr_outreach_links').insert({ token: t, email, label: m.subject.slice(0, 160) || 'Email' });
  await db.from('lr_mail_messages').update({ token: t }).eq('id', m.id);
  return t;
}

export async function quoteOf(m: MailRow) {
  if (!m.in_reply_to) return null;
  const { data } = await supabaseAdmin().from('lr_mail_messages').select('from_email, from_name, text_body, received_at, sent_at, created_at').eq('message_id', m.in_reply_to).limit(1);
  const q = data?.[0];
  if (!q) return null;
  const d = new Date((q.received_at || q.sent_at || q.created_at) as string);
  return { from: q.from_name ? `${q.from_name} <${q.from_email}>` : (q.from_email as string), date: d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }), text: String(q.text_body || '') };
}

// Final HTML + text. preview=true: images via public URLs instead of cid (for the in-browser preview).
export async function buildOutgoing(m: MailRow, preview = false): Promise<{ html: string; text: string; unsub: string | null; token: string | null }> {
  // Copy of an automatically sent system email (lib/mail/sent-log.ts): show unchanged.
  if (m.design === 'system') return { html: m.html || '', text: m.text_body || '', unsub: null, token: null };
  const token = preview ? m.token : await ensureToken(m);
  const unsub = token ? unsubUrl(token) : null;
  let inner: string, text: string;
  if (m.design === 'fertig') {
    // Bring older drafts up to the current standard automatically (sharp logo, signature, footer).
    inner = fillTemplate(repairDraftHtml(m.html || ''), await bookingUrl(), m.termin_fallback);
    inner = inner.replace(/<img src="cid:att2"[^>]*>/g, SIG_IMG);
    if (token && m.token && token !== m.token) inner = inner.split(m.token).join(token);
    text = m.text_body || htmlToText(inner);
  } else {
    let body = sanitizeBody(m.html || '');
    // No old messages below the reply (owner's wish, Oct 27, 2026): the thread stays together for the recipient through the
    // mail headers (In-Reply-To/References), but it is no longer appended as a quote.

    // If the text ends with a sign-off ("Sincerely" in formal mail), it is used above the signature instead of
    // adding "Best regards" on top.
    const sg = splitGreeting(body);
    body = sg.body;
    const greeting = sg.greeting;
    // Button (cta column): leads to /book or /request – kept even when the text was rewritten.
    const cta = m.direction === 'out' ? parseCta(m.cta) : null;
    inner = renderBrief({ body, greeting, unsubUrl: unsub, quote: null, cta: cta ? ctaBlock(cta, token) : undefined });
    const addr = unsub ? postalAddress() : '';
    text = `${htmlToText(body)}${cta ? `\n\n${ctaText(cta, token)}` : ''}\n\n${greeting}\nLeaseRun · Head of Operations\nhttps://leaserun.com · ${mailboxAddress()}${addr ? `\n\nLeaseRun · ${addr}` : ''}\n\nPrivacy: https://leaserun.com/privacy${unsub ? `\nDon't want these emails? Unsubscribe: ${unsub}` : ''}`;
  }
  let html = wrapDocument(m.subject, inner, text);
  if (preview) for (const a of BRAND_IMAGES) html = html.split(`cid:${a.content_id}`).join(a.path);
  return { html, text, unsub, token };
}

export async function sendRow(m: MailRow, actor: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const db = supabaseAdmin();
  if (m.direction !== 'out' || m.status === 'gesendet') return { ok: false, error: 'This email has already been sent.', status: 409 };
  m = { ...m, to_emails: m.to_emails || [], cc_emails: m.cc_emails || [], bcc_emails: m.bcc_emails || [], subject: String(m.subject || ''), attachments: m.attachments || [] };
  if (!m.to_emails.length) return { ok: false, error: 'Please add a recipient.', status: 400 };
  if (!m.subject.trim()) return { ok: false, error: 'Please add a subject.', status: 400 };
  const blocked = await isSuppressed(m.to_emails.map((email) => ({ email }))).catch(() => m.to_emails.map(() => false));
  const bad = m.to_emails.filter((_e, i) => blocked[i]);
  if (bad.length) { await db.from('lr_mail_messages').update({ status: 'gesperrt', error: `Unsubscribed/opted out: ${bad.join(', ')}`.slice(0, 500) }).eq('id', m.id); await adminAuditSafe(actor, m.id, 'opt-out'); return { ok: false, error: `Not sent – unsubscribed or opted out of marketing: ${bad.join(', ')}`, status: 409 }; }
  // Outreach (commercial, not a reply): never to contacts who declined or opted out – nobody is contacted again and again.
  // Personal replies within a thread stay possible.
  if (m.with_unsub && !m.in_reply_to) {
    const no = await declinedRecipients([...m.to_emails, ...m.cc_emails, ...(m.bcc_emails || [])]).catch(() => [] as string[]);
    if (no.length) { await db.from('lr_mail_messages').update({ status: 'gesperrt', error: `Declined/opted out: ${no.join(', ')} – do not contact again`.slice(0, 500) }).eq('id', m.id); await adminAuditSafe(actor, m.id, 'declined/opt-out'); return { ok: false, error: `Not sent – ${no.join(', ')} declined or opted out.`, status: 409 }; }
  }
  // Sending basis per recipient (opt-out, CAN-SPAM requirements) – nothing goes out without it.
  const legal = await legalCheck(m as MailRow & { source?: string | null });
  if (legal.basis === 'fehlt') { await blockDraft(m.id, legal.reason || 'no sending basis', actor); return { ok: false, error: `Not sent – blocked: ${legal.reason || 'no sending basis'}.`, status: 409 }; }
  const { html, text, unsub, token } = await buildOutgoing(m);
  if (missingUnsub(legal, m, html, unsub)) { await blockDraft(m.id, 'unsubscribe link missing', actor); return { ok: false, error: 'Not sent – blocked: unsubscribe link missing (commercial email only to exactly one recipient, with an unsubscribe link).', status: 409 }; }
  // CAN-SPAM: commercial email must show a valid physical postal address. Not configured → nothing commercial goes out.
  if (legal.kind === 'werbung' && !postalAddress()) { await blockDraft(m.id, 'postal address missing (COMPANY_POSTAL_ADDRESS)', actor); return { ok: false, error: 'Not sent – blocked: commercial emails need the company postal address (set COMPANY_POSTAL_ADDRESS in Vercel).', status: 409 }; }
  const files: OutAttachment[] = [];
  for (const a of m.attachments || []) {
    const { data } = await db.storage.from('mail').download(a.path);
    if (data) files.push({ filename: a.name, content: Buffer.from(await data.arrayBuffer()).toString('base64'), content_type: a.type });
  }
  const res = await resendSend({ to: m.to_emails, cc: m.cc_emails, bcc: m.bcc_emails || [], subject: m.subject, html, text, unsubUrl: unsub, inReplyTo: m.in_reply_to, references: m.refs, files, idemKey: `mail:${m.id}`, log: false });
  if (!res.ok) { await db.from('lr_mail_messages').update({ status: 'fehler', error: res.error.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', m.id); return { ok: false, error: res.error, status: 502 }; }
  const now = new Date().toISOString();
  await db.from('lr_mail_messages').update({ status: 'gesendet', folder: 'sent', error: null, resend_id: res.id, sent_at: now, sent_by: actor, updated_at: now, from_email: mailboxAddress(), snippet: text.replace(/\s+/g, ' ').slice(0, 220) }).eq('id', m.id);
  // Outreach CRM: create or update the contact and log the activity.
  for (const email of m.to_emails) {
    const { data: cs } = await db.from('lr_crm_contacts').select('id, status').ilike('email', email);
    let ids = (cs ?? []).map((c) => c.id as string);
    if (!ids.length) {
      const ins = await db.from('lr_crm_contacts').insert({ kind: 'sonstige', company: (email.split('@')[1] || email).slice(0, 160), email, status: 'angeschrieben', source: 'Email from the mailbox', next_at: new Date(Date.now() + 7 * 864e5).toISOString() }).select('id').single();
      if (ins.data) ids = [ins.data.id as string];
    } else await db.from('lr_crm_contacts').update({ status: 'angeschrieben', updated_at: now }).in('id', ids).eq('status', 'neu');
    if (ids.length) await db.from('lr_crm_activities').insert(ids.map((cid) => ({ contact_id: cid, type: 'email', note: `Sent: ${m.subject}`.slice(0, 1000), actor })));
    if (ids[0] && !m.contact_id) await db.from('lr_mail_messages').update({ contact_id: ids[0] }).eq('id', m.id);
  }
  // No automatic copy to self when sending (owner's wish, Oct 27, 2026). The address in mail_copy_to is only used for
  // "Preview to me" – it shows before sending how the email will look for the recipient.
  void html; void text; void token; void files;
  return { ok: true };
}

// Log every block (draft ID and reason, no mail content and no addresses).
async function adminAuditSafe(actor: string, id: string, grund: string) {
  const { adminAudit } = await import('@/lib/b2b/core');
  await adminAudit(actor, 'mail_gesperrt', id, { grund }).catch(() => null);
}

// Copy/preview to our own address (setting mail_copy_to). The recipient token is neutralized so that a click in the copy
// neither unsubscribes the recipient nor records a response in their name.
const COPY_KEY = 'mail_copy_to';
export async function copyAddress(): Promise<string | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', COPY_KEY).maybeSingle();
  const v = typeof data?.value === 'string' ? data.value.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v) ? v : null;
}
export async function sendCopy(m: MailRow, built: { html: string; text: string; token: string | null }, kind: 'kopie' | 'vorschau', files: OutAttachment[] = []): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const to = await copyAddress();
  if (!to) return { ok: false, error: 'No preview address set (Web-Admin → Setup).' };
  const neutral = (s: string) => (built.token ? s.split(built.token).join('preview') : s);
  const subject = `${kind === 'kopie' ? 'Copy' : 'Preview'}: ${m.subject}`.slice(0, 300);
  const r = await resendSend({ to: [to], subject, html: neutral(built.html), text: neutral(built.text), unsubUrl: null, files, idemKey: `${kind}:${m.id}:${Date.now()}`, log: false });
  return r.ok ? { ok: true, to } : { ok: false, error: r.error };
}
export async function previewToMe(m: MailRow): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  m = { ...m, to_emails: m.to_emails || [], cc_emails: m.cc_emails || [], subject: String(m.subject || ''), attachments: m.attachments || [] };
  return sendCopy(m, await buildOutgoing(m), 'vorschau');
}

export const escHtml = esc;
