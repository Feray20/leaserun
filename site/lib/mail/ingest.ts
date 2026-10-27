import { handleDecline } from '@/lib/mail/decline';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blockedName, staticScan } from '@/lib/security/filescan';
import { headerValue, mailboxAddress, parseAddress, resendGetReceived, resendListReceivedAttachments } from '@/lib/mail/resend';
import { contactFor, findThread, snippetOf } from '@/lib/mail/store';
import { htmlToText } from '@/lib/mail/template';
import { pushAdmins } from '@/lib/admin/push';
import { assessMail, unsubInfo } from '@/lib/mail/threat';

// Take an email received by Resend into the mailbox (webhook or polling). Duplicates are skipped.
const MAX_FILE = 20 * 1024 * 1024;
export async function ingestReceived(rid: string, notify = true): Promise<'ok' | 'duplicate' | 'error'> {
  const db = supabaseAdmin();
  const { data: dup } = await db.from('lr_mail_messages').select('id').eq('resend_id', rid).maybeSingle();
  if (dup) return 'duplicate';

  const m = await resendGetReceived(rid);
  if (!m) return 'error';
  const from = parseAddress(m.from);
  const to = (m.to || []).map((x) => parseAddress(x).email).filter(Boolean);
  const cc = (m.cc || []).map((x) => parseAddress(x).email).filter(Boolean);
  const messageId = m.message_id || headerValue(m.headers, 'message-id');
  const inReplyTo = headerValue(m.headers, 'in-reply-to');
  const refs = headerValue(m.headers, 'references');
  const text = m.text || htmlToText(m.html || '');
  const a = m.authentication || {};
  const failed = (v?: string) => typeof v === 'string' && /fail/i.test(v);
  // ImmoAdv routed receipts to a tax-bookkeeping folder ("belege"); LeaseRun has no such feature, so this stays off.
  const taxMail = false;
  const threadId = await findThread({ inReplyTo, refs, subject: m.subject || '', counterpart: from.email });
  const id = crypto.randomUUID();

  // Store attachments (Resend download links expire).
  const files: { name: string; type: string; size: number; path: string; cid: string | null; inline: boolean }[] = [];
  const blocked: string[] = [];
  try {
    for (const att of await resendListReceivedAttachments(rid)) {
      if (!att.download_url || att.size > MAX_FILE) continue;
      const r = await fetch(att.download_url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const safe = (att.filename || 'attachment').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'attachment';
      // Malware check: never store dangerous attachments (scripts in PDFs, hidden programs).
      // Every attachment is scanned (PDF, images, Office, ZIP, text); executable file types are never stored.
      // allowEInvoice stays false: embedded e-invoice XML (a German/EU format) is only relevant for tax bookkeeping.
      if (blockedName(safe)) { blocked.push(`${safe}: executable file type`); continue; }
      const sc = staticScan(buf, { allowEInvoice: taxMail });
      if (!sc.clean) { blocked.push(`${safe}: ${sc.threat}`); continue; }
      const path = `in/${id}/${files.length}-${safe}`;
      const up = await db.storage.from('mail').upload(path, buf, { contentType: att.content_type || 'application/octet-stream', upsert: true });
      if (up.error) continue;
      files.push({ name: safe, type: att.content_type || 'application/octet-stream', size: buf.length, path, cid: att.content_id ? String(att.content_id).replace(/^<|>$/g, '') : null, inline: att.content_disposition === 'inline' });
    }
  } catch (e) { console.error('mail_inbound_att', (e as Error).message); }

  // Hacker/phishing filter: suspicious emails go straight to "Spam" with the reasons; remember newsletter unsubscribe info.
  const threat = assessMail({ fromEmail: from.email, fromName: from.name, subject: m.subject || '', text, html: m.html || null, auth: a, files, replyTo: headerValue(m.headers, 'reply-to') });
  if (blocked.length) { threat.reasons.push(...blocked.map((b) => `Attachment removed by malware check – ${b}`)); threat.spam = true; }
  const spam = threat.spam || (failed(a.dmarc) && (failed(a.spf) || failed(a.dkim)));
  const unsub = unsubInfo(headerValue(m.headers, 'list-unsubscribe'), headerValue(m.headers, 'list-unsubscribe-post'));
  const authInfo = { ...a, threat: threat.reasons.length ? { score: threat.score, reasons: threat.reasons } : undefined, unsub: unsub || undefined };
  // Sender we already unsubscribed from: further emails go to Archive instead of the inbox.
  const unsubbed = Boolean((await db.from('lr_settings').select('key').eq('key', `mail_unsub:${from.email}`.slice(0, 200)).maybeSingle()).data);
  const contactId = await contactFor(from.email);
  const ins = await db.from('lr_mail_messages').insert({
    id, thread_id: threadId, direction: 'in', folder: spam ? 'spam' : taxMail ? 'belege' : unsubbed ? 'archive' : 'inbox', design: 'eingang',
    from_email: from.email.slice(0, 320), from_name: from.name, to_emails: to, cc_emails: cc, subject: (m.subject || '(no subject)').slice(0, 500),
    html: m.html ? m.html.slice(0, 2_000_000) : null, text_body: text.slice(0, 500_000), snippet: snippetOf(text),
    message_id: messageId, in_reply_to: inReplyTo, refs, resend_id: rid, attachments: files, auth: authInfo, contact_id: contactId,
    received_at: m.created_at || new Date().toISOString(), source: 'resend-inbound',
  });
  if (ins.error) { console.error('mail_inbound_insert', ins.error.message); return 'error'; }
  if (contactId) await db.from('lr_crm_activities').insert({ contact_id: contactId, type: 'email', note: `Received: ${(m.subject || '').slice(0, 200)}`, actor: 'postfach' });
  const ownSystem = from.email.endsWith('@' + (mailboxAddress().split('@')[1] || 'leaserun.com'));
  // Decline or "please stop emailing" in reply to outreach → end the contact, send nothing more.
  if (!spam && !ownSystem && !taxMail) await handleDecline(from.email, text, m.subject || '').catch((e) => console.error('mail_decline', (e as Error).message));
  if (notify && !spam && !unsubbed && !ownSystem && !taxMail) await pushAdmins('mail', 'New email', 'A new message is waiting in the Inbox.', 'mail_new');
  // Prepare a reply draft automatically (after answering Resend, so the webhook does not wait). Nothing is ever sent
  // automatically – the owner reads and sends it herself.
  if (!spam && !unsubbed && !ownSystem && !taxMail) {
    const job = () => import('@/lib/mail/autodraft').then((x) => x.autoDraftFor(id)).then((r) => console.log('mail_autodraft', id, r.why)).catch((e) => console.error('mail_autodraft', (e as Error).message));
    try { const { after } = await import('next/server'); after(job); } catch { void job(); }
  }
  if (notify && threat.spam) await pushAdmins('security', 'Suspicious email caught', `${threat.reasons[0] || 'Suspected phishing'} – moved to Spam.`, 'mail_threat');

  // The alert arrives as a notification in the LeaseRun app (no extra forwarding to private addresses).
  return 'ok';
}

// Polling: fetch the latest received emails from Resend (in case a webhook was missed or failed).
// A single broken email no longer blocks polling: it is skipped and counted.
// The result of every poll is stored in lr_settings "mail_sync_status" (for the security check in the Web-Admin).
export type SyncStatus = { at: string; ok: boolean; listed: number; fetched: number; failed: number; error: string | null };
async function saveSync(st: SyncStatus): Promise<void> {
  try { await supabaseAdmin().from('lr_settings').upsert({ key: 'mail_sync_status', value: st, updated_at: st.at, updated_by: 'system' }); } catch { /* display only */ }
}
export async function syncReceivedDetailed(limit = 50): Promise<SyncStatus> {
  const at = new Date().toISOString();
  const key = process.env.RESEND_API_KEY;
  if (!key) { const st = { at, ok: false, listed: 0, fetched: 0, failed: 0, error: 'RESEND_API_KEY is missing in Vercel.' }; await saveSync(st); return st; }
  let r: Response | null = null;
  try { r = await fetch(`https://api.resend.com/emails/receiving?limit=${limit}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }); } catch (e) { r = null; console.error('mail_sync_fetch', (e as Error).message); }
  if (!r?.ok) {
    const body = r ? ((await r.json().catch(() => ({}))) as { message?: string }) : {};
    const why = !r ? 'Resend is not reachable.' : r.status === 401 || r.status === 403 ? `Resend refused the request (HTTP ${r.status}) – the API key needs "Full access" (not just "Sending").` : `Resend polling failed (HTTP ${r.status})${body.message ? `: ${String(body.message).slice(0, 160)}` : ''}.`;
    const st = { at, ok: false, listed: 0, fetched: 0, failed: 0, error: why }; await saveSync(st); return st;
  }
  const j = (await r.json().catch(() => ({}))) as { data?: { id: string }[] };
  const ids = (j.data || []).map((x) => x.id);
  let fetched = 0, failed = 0;
  if (ids.length) {
    const { data: have } = await supabaseAdmin().from('lr_mail_messages').select('resend_id').in('resend_id', ids);
    const known = new Set((have ?? []).map((x) => x.resend_id));
    for (const id of ids.filter((x) => !known.has(x)).reverse()) {
      try { if ((await ingestReceived(id, false)) === 'ok') fetched++; else failed++; }
      catch (e) { failed++; console.error('mail_sync_item', id, (e as Error).message); }
    }
  }
  const st = { at, ok: failed === 0, listed: ids.length, fetched, failed, error: failed ? `${failed} email${failed === 1 ? '' : 's'} could not be imported.` : null };
  await saveSync(st);
  return st;
}
export async function syncReceived(limit = 50): Promise<number> {
  return (await syncReceivedDetailed(limit)).fetched;
}
