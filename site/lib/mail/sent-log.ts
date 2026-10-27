import { randomUUID } from 'node:crypto';

// Copy of every email LeaseRun sends automatically (account, booking, business portal, receipts …) in the support@ mailbox
// under "Sent" – so the owner sees everything that goes out from leaserun.com. Nothing is sent again (no loop, no cost).
// Emails with credentials or personal links (password, sign-in link, confirmation) are stored only as a note without
// content, so no usable access links sit in the mailbox.
const SENSITIVE = /password|passcode|sign-?in link|log-?in link|magic link|credentials|temporary password|one-?time code|verification code|confirmation code|confirm|verify your|passwort|kennwort|anmeldelink|zugangsdaten|startpasswort|einmalcode|bestätigungscode|bitte bestätigen/i;
export const isSensitiveMail = (subject: string, text: string) => SENSITIVE.test(subject) || SENSITIVE.test(text.slice(0, 4000));

export async function logSent(o: { to: string[]; cc?: string[]; from: string; subject: string; html: string; text: string; source: string; files?: string[] }): Promise<void> {
  try {
    const { adminConfigured, supabaseAdmin } = await import('@/lib/supabase/admin');
    if (!adminConfigured() || !o.to.length) return;
    const id = randomUUID(), now = new Date().toISOString();
    const hidden = isSensitiveMail(o.subject, o.text);
    const note = `Sent automatically by LeaseRun to ${o.to.join(', ')}.${o.files?.length ? ` Attachment: ${o.files.join(', ')}.` : ''}`;
    const text = hidden ? `${note}\n\nContent not stored for security reasons – the email contains credentials or a personal link.` : o.text;
    const html = hidden
      ? `<!doctype html><html lang="en"><body style="margin:0;padding:24px;font:15px/1.6 Helvetica,Arial,sans-serif;color:#1e293b;background:#f8fafc"><p style="margin:0 0 8px"><strong>${esc(o.subject)}</strong></p><p style="margin:0 0 8px">${esc(note)}</p><p style="margin:0;color:#64748b">Content not stored for security reasons – the email contains credentials or a personal link.</p></body></html>`
      : o.html;
    const from = (/<([^>]+)>/.exec(o.from)?.[1] || o.from).trim().toLowerCase().slice(0, 320);
    await supabaseAdmin().from('lr_mail_messages').insert({
      id, thread_id: id, direction: 'out', folder: 'sent', status: 'gesendet', design: 'system', from_email: from,
      to_emails: o.to.map((x) => x.toLowerCase()), cc_emails: (o.cc || []).map((x) => x.toLowerCase()), bcc_emails: [], subject: o.subject.slice(0, 500),
      html: html.slice(0, 1_900_000), text_body: text.slice(0, 450_000), snippet: text.replace(/\s+/g, ' ').slice(0, 220), attachments: [], with_unsub: false,
      source: o.source.slice(0, 60), sent_at: now, sent_by: 'system', read_at: now, updated_at: now,
    });
  } catch (e) { console.warn('[mail] Copy for "Sent" not stored:', (e as Error).message); }
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string); }
