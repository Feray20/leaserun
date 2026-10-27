import { randomUUID } from 'node:crypto';

// Kopie jeder Mail, die LeaseRun automatisch verschickt (Konto, Termin, Kanzlei, DATEV …), im Postfach von support@ unter
// „Gesendet“ – so sieht Feray lückenlos, was über leaserun.com rausgeht. Es wird nichts erneut versendet (keine Schleife,
// keine Kosten). Mails mit Zugangsdaten oder persönlichen Links (Passwort, Anmeldelink, Bestätigung) werden nur als
// Vermerk ohne Inhalt abgelegt, damit im Postfach keine nutzbaren Zugänge herumliegen.
const SENSITIVE = /passwort|kennwort|password|anmeldelink|zugangsdaten|startpasswort|einmalcode|bestätigungscode|bitte bestätigen|e-mail bestätigen|confirm/i;
export const isSensitiveMail = (subject: string, text: string) => SENSITIVE.test(subject) || SENSITIVE.test(text.slice(0, 4000));

export async function logSent(o: { to: string[]; cc?: string[]; from: string; subject: string; html: string; text: string; source: string; files?: string[] }): Promise<void> {
  try {
    const { adminConfigured, supabaseAdmin } = await import('@/lib/supabase/admin');
    if (!adminConfigured() || !o.to.length) return;
    const id = randomUUID(), now = new Date().toISOString();
    const hidden = isSensitiveMail(o.subject, o.text);
    const note = `Automatisch von LeaseRun gesendet an ${o.to.join(', ')}.${o.files?.length ? ` Anhang: ${o.files.join(', ')}.` : ''}`;
    const text = hidden ? `${note}\n\nInhalt aus Sicherheitsgründen nicht gespeichert – die Mail enthält Zugangsdaten oder einen persönlichen Link.` : o.text;
    const html = hidden
      ? `<!doctype html><html lang="de"><body style="margin:0;padding:24px;font:15px/1.6 Helvetica,Arial,sans-serif;color:#1e293b;background:#f8fafc"><p style="margin:0 0 8px"><strong>${esc(o.subject)}</strong></p><p style="margin:0 0 8px">${esc(note)}</p><p style="margin:0;color:#64748b">Inhalt aus Sicherheitsgründen nicht gespeichert – die Mail enthält Zugangsdaten oder einen persönlichen Link.</p></body></html>`
      : o.html;
    const from = (/<([^>]+)>/.exec(o.from)?.[1] || o.from).trim().toLowerCase().slice(0, 320);
    await supabaseAdmin().from('lr_mail_messages').insert({
      id, thread_id: id, direction: 'out', folder: 'sent', status: 'gesendet', design: 'system', from_email: from,
      to_emails: o.to.map((x) => x.toLowerCase()), cc_emails: (o.cc || []).map((x) => x.toLowerCase()), bcc_emails: [], subject: o.subject.slice(0, 500),
      html: html.slice(0, 1_900_000), text_body: text.slice(0, 450_000), snippet: text.replace(/\s+/g, ' ').slice(0, 220), attachments: [], with_unsub: false,
      source: o.source.slice(0, 60), sent_at: now, sent_by: 'system', read_at: now, updated_at: now,
    });
  } catch (e) { console.warn('[mail] Kopie für „Gesendet“ nicht gespeichert:', (e as Error).message); }
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string); }
