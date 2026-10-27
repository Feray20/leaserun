import { handleDecline } from '@/lib/mail/decline';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blockedName, staticScan } from '@/lib/security/filescan';
import { headerValue, mailboxAddress, parseAddress, resendGetReceived, resendListReceivedAttachments } from '@/lib/mail/resend';
import { contactFor, findThread, snippetOf } from '@/lib/mail/store';
import { htmlToText } from '@/lib/mail/template';
import { pushAdmins } from '@/lib/admin/push';
import { assessMail, unsubInfo } from '@/lib/mail/threat';

// Eine bei Resend empfangene E-Mail ins Postfach übernehmen (Webhook oder Abruf). Doppelte werden übersprungen.
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
  const taxMail = false;
  const threadId = await findThread({ inReplyTo, refs, subject: m.subject || '', counterpart: from.email });
  const id = crypto.randomUUID();

  // Anhänge sichern (Download-Links von Resend laufen ab).
  const files: { name: string; type: string; size: number; path: string; cid: string | null; inline: boolean }[] = [];
  const blocked: string[] = [];
  try {
    for (const att of await resendListReceivedAttachments(rid)) {
      if (!att.download_url || att.size > MAX_FILE) continue;
      const r = await fetch(att.download_url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const safe = (att.filename || 'anhang').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'anhang';
      // Virenprüfung: gefährliche Anhänge (Skripte in PDFs, versteckte Programme) gar nicht erst speichern.
      // Jeder Anhang wird geprüft (PDF, Bilder, Office, ZIP, Text); ausführbare Dateitypen werden nie gespeichert.
      if (blockedName(safe)) { blocked.push(`${safe}: ausführbarer Dateityp`); continue; }
      const sc = staticScan(buf, { allowEInvoice: taxMail });
      if (!sc.clean) { blocked.push(`${safe}: ${sc.threat}`); continue; }
      const path = `in/${id}/${files.length}-${safe}`;
      const up = await db.storage.from('mail').upload(path, buf, { contentType: att.content_type || 'application/octet-stream', upsert: true });
      if (up.error) continue;
      files.push({ name: safe, type: att.content_type || 'application/octet-stream', size: buf.length, path, cid: att.content_id ? String(att.content_id).replace(/^<|>$/g, '') : null, inline: att.content_disposition === 'inline' });
    }
  } catch (e) { console.error('mail_inbound_att', (e as Error).message); }

  // Hacker-/Phishing-Filter: verdächtige Mails direkt in „Spam“, mit Begründung; Newsletter-Abmeldung merken.
  const threat = assessMail({ fromEmail: from.email, fromName: from.name, subject: m.subject || '', text, html: m.html || null, auth: a, files, replyTo: headerValue(m.headers, 'reply-to') });
  if (blocked.length) { threat.reasons.push(...blocked.map((b) => `Anhang wegen Virenprüfung entfernt – ${b}`)); threat.spam = true; }
  const spam = threat.spam || (failed(a.dmarc) && (failed(a.spf) || failed(a.dkim)));
  const unsub = unsubInfo(headerValue(m.headers, 'list-unsubscribe'), headerValue(m.headers, 'list-unsubscribe-post'));
  const authInfo = { ...a, threat: threat.reasons.length ? { score: threat.score, reasons: threat.reasons } : undefined, unsub: unsub || undefined };
  // Bereits abbestellter Absender: weitere Mails landen im Archiv statt im Posteingang.
  const unsubbed = Boolean((await db.from('lr_settings').select('key').eq('key', `mail_unsub:${from.email}`.slice(0, 200)).maybeSingle()).data);
  const contactId = await contactFor(from.email);
  const ins = await db.from('lr_mail_messages').insert({
    id, thread_id: threadId, direction: 'in', folder: spam ? 'spam' : taxMail ? 'belege' : unsubbed ? 'archive' : 'inbox', design: 'eingang',
    from_email: from.email.slice(0, 320), from_name: from.name, to_emails: to, cc_emails: cc, subject: (m.subject || '(ohne Betreff)').slice(0, 500),
    html: m.html ? m.html.slice(0, 2_000_000) : null, text_body: text.slice(0, 500_000), snippet: snippetOf(text),
    message_id: messageId, in_reply_to: inReplyTo, refs, resend_id: rid, attachments: files, auth: authInfo, contact_id: contactId,
    received_at: m.created_at || new Date().toISOString(), source: 'resend-inbound',
  });
  if (ins.error) { console.error('mail_inbound_insert', ins.error.message); return 'error'; }
  if (contactId) await db.from('lr_crm_activities').insert({ contact_id: contactId, type: 'email', note: `Eingang: ${(m.subject || '').slice(0, 200)}`, actor: 'postfach' });
  const ownSystem = from.email.endsWith('@' + (mailboxAddress().split('@')[1] || 'leaserun.com'));
  // Absage oder „bitte keine Mails mehr“ auf ein Anschreiben → Kontakt beenden, nichts mehr senden.
  if (!spam && !ownSystem && !taxMail) await handleDecline(from.email, text, m.subject || '').catch((e) => console.error('mail_decline', (e as Error).message));
  if (notify && !spam && !unsubbed && !ownSystem && !taxMail) await pushAdmins('mail', 'Neue E-Mail', 'Im Postfach wartet eine neue Nachricht.', 'mail_new');
  // Antwort-Entwurf automatisch vorbereiten (nach der Antwort an Resend, damit der Webhook nicht wartet). Gesendet wird nie
  // automatisch – Feray liest und sendet selbst.
  if (!spam && !unsubbed && !ownSystem && !taxMail) {
    const job = () => import('@/lib/mail/autodraft').then((x) => x.autoDraftFor(id)).then((r) => console.log('mail_autodraft', id, r.why)).catch((e) => console.error('mail_autodraft', (e as Error).message));
    try { const { after } = await import('next/server'); after(job); } catch { void job(); }
  }
  if (notify && threat.spam) await pushAdmins('security', 'Verdächtige E-Mail abgefangen', `${threat.reasons[0] || 'Phishing-Verdacht'} – liegt im Spam-Ordner.`, 'mail_threat');

  // Hinweis kommt als Mitteilung in die LeaseRun-App (keine zusätzlichen Weiterleitungen an private Adressen).
  return 'ok';
}

// Abruf: neueste empfangene Mails bei Resend nachholen (falls ein Webhook fehlte oder ausfiel).
// Eine einzelne fehlerhafte Mail blockiert den Abruf nicht mehr: sie wird übersprungen und gezählt.
// Ergebnis jedes Abrufs steht in lr_settings „mail_sync_status“ (für den Sicherheits-Check im Web-Admin).
export type SyncStatus = { at: string; ok: boolean; listed: number; fetched: number; failed: number; error: string | null };
async function saveSync(st: SyncStatus): Promise<void> {
  try { await supabaseAdmin().from('lr_settings').upsert({ key: 'mail_sync_status', value: st, updated_at: st.at, updated_by: 'system' }); } catch { /* nur Anzeige */ }
}
export async function syncReceivedDetailed(limit = 50): Promise<SyncStatus> {
  const at = new Date().toISOString();
  const key = process.env.RESEND_API_KEY;
  if (!key) { const st = { at, ok: false, listed: 0, fetched: 0, failed: 0, error: 'RESEND_API_KEY fehlt in Vercel.' }; await saveSync(st); return st; }
  let r: Response | null = null;
  try { r = await fetch(`https://api.resend.com/emails/receiving?limit=${limit}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }); } catch (e) { r = null; console.error('mail_sync_fetch', (e as Error).message); }
  if (!r?.ok) {
    const body = r ? ((await r.json().catch(() => ({}))) as { message?: string }) : {};
    const why = !r ? 'Resend nicht erreichbar.' : r.status === 401 || r.status === 403 ? `Resend lehnt den Abruf ab (HTTP ${r.status}) – der API-Schlüssel braucht „Full access“ (nicht nur „Sending“).` : `Resend-Abruf fehlgeschlagen (HTTP ${r.status})${body.message ? `: ${String(body.message).slice(0, 160)}` : ''}.`;
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
  const st = { at, ok: failed === 0, listed: ids.length, fetched, failed, error: failed ? `${failed} E-Mail${failed === 1 ? '' : 's'} konnte${failed === 1 ? '' : 'n'} nicht übernommen werden.` : null };
  await saveSync(st);
  return st;
}
export async function syncReceived(limit = 50): Promise<number> {
  return (await syncReceivedDetailed(limit)).fetched;
}
