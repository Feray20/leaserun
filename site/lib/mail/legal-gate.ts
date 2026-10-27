import { supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { isSuppressed } from '@/lib/marketing/suppression';
import { declinedRecipients } from '@/lib/mail/decline';
import type { MailRow } from '@/lib/mail/compose';

// Send gate for the mailbox (CAN-SPAM Act, 15 U.S.C. 7701 ff., plus state law; lowest-risk reading).
// Before every send from the mailbox (single send, "Send all", approvals) each recipient is checked:
//  a) Unsubscribed / opted out (suppression list or CRM "widerspruch") → always blocked. Opt-outs are honored immediately
//     (CAN-SPAM allows 10 business days; we never send again).
//  b) Commercial email to a confirmed newsletter subscriber (double opt-in in lr_newsletter) → allowed ("consent").
//  c) Commercial email to a business address (company domain) without consent → allowed under CAN-SPAM's opt-out model
//     ("business outreach"), but only with a working unsubscribe link and the company's physical postal address.
//  d) Commercial email to a personal/free-mail address (gmail, yahoo, outlook …) without consent → blocked. Cold
//     marketing to consumers is the riskier case (state laws, spam complaints), so LeaseRun does not do it.
//  e) Commercial email without an unsubscribe link in the final HTML, or without COMPANY_POSTAL_ADDRESS → blocked
//     (checked in sendRow after the email is assembled).
// Replies within an existing thread without promotional wording count as transactional/relationship messages.
// Blocked drafts stay unchanged in "Drafts" (status "gesperrt" + reason); nothing is deleted.
// Internal values (stored and read elsewhere, do not rename): kind 'werbung' = commercial, 'transaktion' = transactional;
// basis 'einwilligung' = consent, 'antwort' = reply/transactional, 'b2b' = business outreach (opt-out model), 'fehlt' = none.
export type LegalKind = 'werbung' | 'transaktion';
export type LegalCheck = { kind: LegalKind; basis: 'einwilligung' | 'bestandskunde' | 'antwort' | 'b2b' | 'fehlt'; consentAt: string | null; reason: string | null; label: string };

// Typical promotional wording in subject/body (deliberately broad – when in doubt, "commercial"). German terms stay
// recognized for drafts written before the port.
const AD = /(newsletter|special offer|discount|coupon|promo(tion)?|limited time|free trial|try (it )?(for )?free|sign up (now|today)|buy now|book (a|your) (demo|call)|\bdemo\b|partnership|partner with|collaborat|introduc(e|ing) (you|leaserun|our)|press (release|inquiry)|new feature|webinar|invitation|schedule a (call|meeting)|no obligation|win-win|angebot|rabatt|gutschein|kostenlos (testen|ausprobieren)|kooperation|zusammenarbeit)/i;
const FREEMAIL = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|comcast|verizon|att|sbcglobal|bellsouth|cox|charter|earthlink|web|t-online|freenet|posteo)\./i;
const usDate = (t: string) => new Date(t).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const recipientsOf = (m: Pick<MailRow, 'to_emails' | 'cc_emails' | 'bcc_emails'>) => [...new Set([...(m.to_emails || []), ...(m.cc_emails || []), ...(m.bcc_emails || [])].map((e) => String(e).trim().toLowerCase()).filter(Boolean))];

type Row = Pick<MailRow, 'id' | 'to_emails' | 'cc_emails' | 'bcc_emails' | 'subject' | 'text_body' | 'in_reply_to' | 'with_unsub' | 'design'> & { source?: string | null; werbung?: boolean | null; cta?: unknown };
type Facts = { consent: Map<string, string>; objection: Set<string>; wroteUs: Set<string> };

// Commercial: explicitly flagged, promotional wording, unsubscribe link/template/button, or first contact (not a reply and the
// recipient never wrote to us). Replies in an existing thread without promotional wording count as transactional/reply.
export function isAdvertising(m: Row, wroteUs: Set<string>): boolean {
  if (m.werbung === true) return true;
  if (m.in_reply_to) return false;
  if (m.with_unsub || m.design === 'fertig' || m.source === 'gmail-entwurf' || m.cta) return true;
  if (AD.test(`${m.subject || ''}\n${String(m.text_body || '').slice(0, 6000)}`)) return true;
  return !recipientsOf(m).every((e) => wroteUs.has(e));
}

// Load all facts for many drafts at once (consents, opt-outs, previous exchange).
async function loadFacts(emails: string[]): Promise<Facts> {
  const db = supabaseAdmin(), list = [...new Set(emails)];
  const consent = new Map<string, string>(), objection = new Set<string>(), wroteUs = new Set<string>();
  if (!list.length) return { consent, objection, wroteUs };
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const [nl, supp, dec, inb] = await Promise.all([
      db.from('lr_newsletter').select('email, confirmed_at').in('email', part).not('confirmed_at', 'is', null).is('unsubscribed_at', null),
      isSuppressed(part.map((email) => ({ email }))),
      declinedRecipients(part),
      db.from('lr_mail_messages').select('from_email').eq('direction', 'in').in('from_email', part).limit(2000),
    ]);
    if (nl.error || inb.error) throw new Error('Sending basis could not be checked');
    for (const r of nl.data ?? []) consent.set(String(r.email).toLowerCase(), r.confirmed_at as string);
    part.forEach((e, k) => { if (supp[k]) objection.add(e); });
    // Opt-out and "not interested" both block outreach; personal replies are handled by declinedRecipients' callers.
    for (const e of dec) objection.add(e);
    for (const r of inb.data ?? []) wroteUs.add(String(r.from_email).toLowerCase());
  }
  return { consent, objection, wroteUs };
}

function judge(m: Row, f: Facts): LegalCheck {
  const rcp = recipientsOf(m);
  const kind: LegalKind = isAdvertising(m, f.wroteUs) ? 'werbung' : 'transaktion';
  const objected = rcp.filter((e) => f.objection.has(e));
  if (objected.length) return { kind, basis: 'fehlt', consentAt: null, reason: `opted out (${objected.join(', ')})`, label: 'Sending basis: none (opted out)' };
  if (kind === 'transaktion') return { kind, basis: 'antwort', consentAt: null, reason: null, label: 'Sending basis: reply/transactional' };
  const missing = rcp.filter((e) => !f.consent.has(e));
  if (!missing.length) {
    const at = rcp.map((e) => f.consent.get(e) as string).sort()[0];
    return { kind, basis: 'einwilligung', consentAt: at, reason: null, label: `Sending basis: opt-in consent from ${usDate(at)}` };
  }
  // Consumers / personal inboxes without consent: no cold marketing (lowest-risk choice).
  const personal = missing.filter((e) => FREEMAIL.test(e) && !f.wroteUs.has(e));
  if (personal.length) return { kind, basis: 'fehlt', consentAt: null, reason: `no consent – personal email address (${personal.join(', ')}); LeaseRun does not send cold marketing to consumers`, label: 'Sending basis: none' };
  return { kind, basis: 'b2b', consentAt: null, reason: null, label: 'Sending basis: business outreach (CAN-SPAM opt-out, unsubscribe link + postal address required)' };
}

export async function legalChecks(rows: Row[]): Promise<Map<string, LegalCheck>> {
  const f = await loadFacts(rows.flatMap((r) => recipientsOf(r)));
  return new Map(rows.map((r) => [r.id, judge(r, f)]));
}
export async function legalCheck(m: Row): Promise<LegalCheck> {
  return (await legalChecks([m])).get(m.id) as LegalCheck;
}

// Commercial email without an unsubscribe link in the final HTML (e). The link is per recipient – with Cc/Bcc the others
// would not have their own.
export const missingUnsub = (c: LegalCheck, m: Pick<MailRow, 'cc_emails' | 'bcc_emails'>, html: string, unsub: string | null) =>
  c.kind === 'werbung' && (!(unsub && html.includes(unsub)) || (m.cc_emails || []).length > 0 || (m.bcc_emails || []).length > 0);

// Block: the draft is kept, gets status "gesperrt" + reason; the log contains no mail content.
export async function blockDraft(id: string, reason: string, actor: string): Promise<void> {
  await supabaseAdmin().from('lr_mail_messages').update({ status: 'gesperrt', error: `Blocked: ${reason}`.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', id).neq('status', 'gesendet');
  await adminAudit(actor, 'mail_gesperrt', id, { grund: reason.replace(/\s*\([^)]*@[^)]*\)/g, '').slice(0, 120) }).catch(() => null);
}

// One-time classification of all waiting drafts (read and flag only – nothing is sent or deleted).
// Result in lr_settings "mail_legal_check" for the legal agent in Headquarters.
const KEY = 'mail_legal_check';
export type LegalSummary = { at: string; total: number; transaktion: number; werbung_ok: number; gesperrt: number };
export async function loadLegalSummary(): Promise<LegalSummary | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  const v = data?.value as LegalSummary | null;
  return v && typeof v.total === 'number' ? v : null;
}
export async function classifyWaitingDrafts(actor = 'recht'): Promise<LegalSummary> {
  const db = supabaseAdmin();
  const { data, error } = await db.from('lr_mail_messages').select('id, to_emails, cc_emails, bcc_emails, subject, text_body, in_reply_to, with_unsub, design, source, cta').eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf').limit(1000);
  if (error) throw new Error('Drafts could not be read');
  const rows = (data ?? []) as unknown as Row[];
  const checks = await legalChecks(rows);
  const s: LegalSummary = { at: new Date().toISOString(), total: rows.length, transaktion: 0, werbung_ok: 0, gesperrt: 0 };
  for (const r of rows) {
    const c = checks.get(r.id) as LegalCheck;
    // Commercial email without an unsubscribe link in the draft (several recipients or link switched off) can never go out.
    const noUnsub = c.kind === 'werbung' && c.basis !== 'fehlt' && (!r.with_unsub || (r.to_emails || []).length !== 1 || (r.cc_emails || []).length || (r.bcc_emails || []).length);
    if (c.basis === 'fehlt' || noUnsub) { s.gesperrt++; await blockDraft(r.id, c.reason || 'unsubscribe link missing', actor); }
    else if (c.kind === 'werbung') s.werbung_ok++;
    else s.transaktion++;
  }
  await db.from('lr_settings').upsert({ key: KEY, value: s, updated_at: s.at, updated_by: 'recht' });
  await adminAudit(actor, 'mail_rechtsgrundlage_einordnung', null, { total: s.total, transaktion: s.transaktion, werbung_ok: s.werbung_ok, gesperrt: s.gesperrt }).catch(() => null);
  return s;
}
