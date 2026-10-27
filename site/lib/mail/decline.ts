import { supabaseAdmin } from '@/lib/supabase/admin';
import { suppress } from '@/lib/marketing/suppression';
import { pushAdmins } from '@/lib/admin/push';

// Detect declines in replies to outreach so nobody is contacted again and again (owner's wish, Oct 27, 2026).
// Two levels (internal status keys stay German, they are stored in the CRM):
//  - "widerspruch" (opt-out): explicitly no more emails / unsubscribe → permanent block (suppression list, CAN-SPAM opt-out).
//    Nothing is ever sent again.
//  - "kein_interesse" (not interested): polite decline → no outreach (commercial email) for 1 year, then at most one new
//    attempt; a personal reply stays possible at any time.
// Only the sender's own text counts (the quoted earlier email is cut off). English and German phrases are recognized.
const STOP = /(unsubscribe|opt(ed)? out|remove me|take me off|(remove|delete) (me|us|my (e-?mail|address)) from|stop (e-?mailing|contacting|sending)|do not (contact|e-?mail) (me|us)|don'?t (contact|e-?mail) (me|us)|no (more|further) (e-?mails?|messages|contact)|please (stop|cease)|keine (weiteren |zukünftigen )?(e-?mails?|nachrichten|zusendungen|anfragen)|nicht mehr (kontaktieren|anschreiben|schreiben)|(aus|von) (ihrem|eurem|dem|ihrer|der) (verteiler|liste|mailingliste)|bitte (streichen|löschen) sie|abmelden|abbestellen|widersprech|widerspruch)/i;
const NO = /((not|no longer) interested|we('| a)re not interested|i'?m not interested|no interest|no need (for|at)|not a (good )?fit|not the right fit|we('| wi)ll pass|we have to (pass|decline)|have to decline|must decline|not at this time|no thanks|no, thank you|kein(e|en)? (weiteres |großes )?interesse|nicht interessiert|kein bedarf|keinen bedarf|nicht in frage|kommt (für uns )?nicht in frage|keine kooperation|keine zusammenarbeit|müssen (ihnen |euch )?(leider )?absagen|sagen (ihnen |euch )?(leider )?ab|passt (leider )?nicht (zu uns|in unser))/i;

export function ownPart(text: string): string {
  const t = String(text || '').replace(/\r/g, '');
  // Up to the first quote line or "On … wrote …" / "-----Original" / "From:" (German variants too)
  const cut = t.search(/\n\s*(>|Am .{3,80} schrieb|On .{3,80} wrote|-{2,}\s*(Original|Ursprüngliche)|Von:\s|From:\s)/i);
  return (cut > 0 ? t.slice(0, cut) : t).slice(0, 2000);
}
export function declineKind(text: string): 'widerspruch' | 'kein_interesse' | null {
  const own = ownPart(text);
  if (STOP.test(own)) return 'widerspruch';
  if (NO.test(own)) return 'kein_interesse';
  return null;
}

// Check an incoming reply: only if we emailed this address before.
export const DECLINE_PAUSE_DAYS = 365;
const pauseUntil = () => new Date(Date.now() + DECLINE_PAUSE_DAYS * 864e5).toISOString().slice(0, 10);

export async function handleDecline(fromEmail: string, text: string, subject: string): Promise<void> {
  const email = String(fromEmail || '').trim().toLowerCase();
  if (!email.includes('@')) return;
  const kind = declineKind(text);
  if (!kind) return;
  const db = supabaseAdmin();
  const { count } = await db.from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('status', 'gesendet').contains('to_emails', [email]);
  if (!count) return;
  const now = new Date().toISOString();
  const { data: cs } = await db.from('lr_crm_contacts').select('id, status, email, company, postal_code').ilike('email', email);
  let ids = (cs ?? []).map((c) => c.id as string);
  if (!ids.length) {
    const ins = await db.from('lr_crm_contacts').insert({ kind: 'sonstige', company: (email.split('@')[1] || email).slice(0, 160), email, status: kind, source: 'Declined by email', next_at: kind === 'kein_interesse' ? pauseUntil() : null, ...(kind === 'widerspruch' ? { objection_at: now } : {}) }).select('id').single();
    if (ins.data) ids = [ins.data.id as string];
  } else {
    // Never downgrade an opt-out ("widerspruch").
    const up: Record<string, unknown> = { next_at: kind === 'kein_interesse' ? pauseUntil() : null, updated_at: now };
    if (kind === 'widerspruch') { up.status = 'widerspruch'; up.objection_at = now; }
    await db.from('lr_crm_contacts').update(up).in('id', ids);
    if (kind === 'kein_interesse') await db.from('lr_crm_contacts').update({ status: 'kein_interesse' }).in('id', ids).neq('status', 'widerspruch');
  }
  if (kind === 'widerspruch') await suppress({ email }, 'widerspruch_mail').catch(() => null);
  // Block outreach drafts still pending for this address (they stay visible as drafts but never go out).
  await db.from('lr_mail_messages').update({ status: 'gesperrt', error: kind === 'widerspruch' ? 'Opted out by email – never contact again' : 'Declined by email – do not contact again for 1 year', updated_at: now })
    .eq('direction', 'out').eq('status', 'entwurf').contains('to_emails', [email]).is('in_reply_to', null);
  if (ids.length) await db.from('lr_crm_activities').insert(ids.map((id) => ({ contact_id: id, type: 'status', note: `${kind === 'widerspruch' ? 'Opt-out' : 'Decline'} detected by email ("${subject.slice(0, 120)}") – ${kind === 'widerspruch' ? 'will never be contacted again' : `blocked until ${pauseUntil()}`}`, actor: 'postfach' })));
  await pushAdmins('mail', kind === 'widerspruch' ? 'Opt-out detected' : 'Decline detected', kind === 'widerspruch' ? `${email} will never be contacted again.` : `${email} is blocked for 1 year (until ${pauseUntil()}).`, 'mail_decline').catch(() => null);
}

// Before sending outreach (commercial email, not a reply): declined or opted out in the CRM?
export async function declinedRecipients(emails: string[]): Promise<string[]> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return [];
  const { data } = await supabaseAdmin().from('lr_crm_contacts').select('email, status, next_at, updated_at').in('status', ['kein_interesse', 'widerspruch']).in('email', list);
  const today = new Date().toISOString().slice(0, 10);
  // Opt-out: always blocked. Decline: blocked until next_at (without a date: 1 year from the last change).
  const blocked = (data ?? []).filter((c) => {
    if (c.status === 'widerspruch') return true;
    const until = c.next_at ? String(c.next_at).slice(0, 10) : new Date(new Date(String(c.updated_at || Date.now())).getTime() + DECLINE_PAUSE_DAYS * 864e5).toISOString().slice(0, 10);
    return until > today;
  });
  return [...new Set(blocked.map((c) => String(c.email || '').toLowerCase()))];
}
