import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BRAND_IMAGES, resendSend, mailboxAddress, type OutAttachment } from '@/lib/mail/resend';
import { esc, fillTemplate, htmlToText, renderBrief, sanitizeBody, SIG_IMG, splitGreeting, wrapDocument } from '@/lib/mail/template';
import { isSuppressed } from '@/lib/marketing/suppression';
import { declinedRecipients } from '@/lib/mail/decline';
import { repairDraftHtml } from '@/lib/mail/draft-repair';
import { ctaBlock, ctaText, parseCta } from '@/lib/mail/cta';
import { blockDraft, legalCheck, missingUnsub } from '@/lib/mail/legal-gate';

// Ausgehende Nachricht aus einem Entwurf bauen und senden.
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
  // Standard: eigenes Termin-Portal (Teams-Link bei Annahme); ein eigener Link im Postfach überschreibt das.
  return typeof data?.value === 'string' && /^https:\/\//.test(data.value) ? data.value : 'https://leaserun.com/book';
}

// Abmeldelink je Empfänger (nur bei genau einem Empfänger, sonst ohne Link).
export async function ensureToken(m: MailRow): Promise<string | null> {
  if (!m.with_unsub || m.to_emails.length !== 1) return null;
  const email = m.to_emails[0];
  if (m.token) return m.token;
  const db = supabaseAdmin();
  const { data } = await db.from('lr_outreach_links').select('token').eq('email', email).is('opted_out_at', null).limit(1);
  const t = (data?.[0]?.token as string) || randomBytes(18).toString('base64url');
  if (!data?.[0]) await db.from('lr_outreach_links').insert({ token: t, email, label: m.subject.slice(0, 160) || 'E-Mail' });
  await db.from('lr_mail_messages').update({ token: t }).eq('id', m.id);
  return t;
}

export async function quoteOf(m: MailRow) {
  if (!m.in_reply_to) return null;
  const { data } = await supabaseAdmin().from('lr_mail_messages').select('from_email, from_name, text_body, received_at, sent_at, created_at').eq('message_id', m.in_reply_to).limit(1);
  const q = data?.[0];
  if (!q) return null;
  const d = new Date((q.received_at || q.sent_at || q.created_at) as string);
  return { from: q.from_name ? `${q.from_name} <${q.from_email}>` : (q.from_email as string), date: d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }), text: String(q.text_body || '') };
}

// Fertiges HTML + Text. preview=true: Bilder über öffentliche Adressen statt cid (für die Vorschau im Browser).
export async function buildOutgoing(m: MailRow, preview = false): Promise<{ html: string; text: string; unsub: string | null; token: string | null }> {
  // Kopie einer automatisch versendeten Systemmail (lib/mail/sent-log.ts): unverändert anzeigen.
  if (m.design === 'system') return { html: m.html || '', text: m.text_body || '', unsub: null, token: null };
  const token = preview ? m.token : await ensureToken(m);
  const unsub = token ? unsubUrl(token) : null;
  let inner: string, text: string;
  if (m.design === 'fertig') {
    // Ältere Entwürfe automatisch auf den aktuellen Standard bringen (scharfes Logo, Unterschrift, Fußzeile).
    inner = fillTemplate(repairDraftHtml(m.html || ''), await bookingUrl(), m.termin_fallback);
    inner = inner.replace(/<img src="cid:att2"[^>]*>/g, SIG_IMG);
    if (token && m.token && token !== m.token) inner = inner.split(m.token).join(token);
    text = m.text_body || htmlToText(inner);
  } else {
    let body = sanitizeBody(m.html || '');
    // Keine alten Nachrichten unter der Antwort (Wunsch Feray, 27.10.2026): Der Verlauf bleibt über die Mail-Header
    // (In-Reply-To/References) beim Empfänger zusammen, wird aber nicht mehr als Zitat angehängt.

    // Endet der Text mit einer Grußformel („Mit freundlichen Grüßen“ bei förmlichen Mails), wird sie als Gruß über der
    // Signatur verwendet statt zusätzlich zu „Viele Grüße“.
    const sg = splitGreeting(body);
    body = sg.body;
    const greeting = sg.greeting;
    // Knopf (Spalte cta): führt auf /book bzw. /request – bleibt erhalten, auch wenn der Text überarbeitet wurde.
    const cta = m.direction === 'out' ? parseCta(m.cta) : null;
    inner = renderBrief({ body, greeting, unsubUrl: unsub, quote: null, cta: cta ? ctaBlock(cta, token) : undefined });
    text = `${htmlToText(body)}${cta ? `\n\n${ctaText(cta, token)}` : ''}\n\n${greeting}\nFeray Korkmaz\nHead of Operations · LeaseRun\nhttps://leaserun.com · ${mailboxAddress()}\n\nImpressum: https://leaserun.com/impressum${unsub ? `\nKeine E-Mails mehr erhalten? Abmelden: ${unsub}` : ''}`;
  }
  let html = wrapDocument(m.subject, inner, text);
  if (preview) for (const a of BRAND_IMAGES) html = html.split(`cid:${a.content_id}`).join(a.path);
  return { html, text, unsub, token };
}

export async function sendRow(m: MailRow, actor: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const db = supabaseAdmin();
  if (m.direction !== 'out' || m.status === 'gesendet') return { ok: false, error: 'Diese E-Mail wurde bereits gesendet.', status: 409 };
  m = { ...m, to_emails: m.to_emails || [], cc_emails: m.cc_emails || [], bcc_emails: m.bcc_emails || [], subject: String(m.subject || ''), attachments: m.attachments || [] };
  if (!m.to_emails.length) return { ok: false, error: 'Bitte einen Empfänger angeben.', status: 400 };
  if (!m.subject.trim()) return { ok: false, error: 'Bitte einen Betreff angeben.', status: 400 };
  const blocked = await isSuppressed(m.to_emails.map((email) => ({ email }))).catch(() => m.to_emails.map(() => false));
  const bad = m.to_emails.filter((_e, i) => blocked[i]);
  if (bad.length) { await db.from('lr_mail_messages').update({ status: 'gesperrt', error: `Abgemeldet/Widerspruch: ${bad.join(', ')}`.slice(0, 500) }).eq('id', m.id); await adminAuditSafe(actor, m.id, 'Widerspruch'); return { ok: false, error: `Nicht gesendet – abgemeldet bzw. Werbewiderspruch: ${bad.join(', ')}`, status: 409 }; }
  // Anschreiben (werblich, keine Antwort auf eine Mail): nicht an Kontakte mit Absage oder Widerspruch – niemand wird
  // wiederholt angeschrieben. Persönliche Antworten in einem Verlauf bleiben möglich.
  if (m.with_unsub && !m.in_reply_to) {
    const no = await declinedRecipients([...m.to_emails, ...m.cc_emails, ...(m.bcc_emails || [])]).catch(() => [] as string[]);
    if (no.length) { await db.from('lr_mail_messages').update({ status: 'gesperrt', error: `Absage/Widerspruch: ${no.join(', ')} – nicht erneut anschreiben`.slice(0, 500) }).eq('id', m.id); await adminAuditSafe(actor, m.id, 'Absage/Widerspruch'); return { ok: false, error: `Nicht gesendet – ${no.join(', ')} hat abgesagt bzw. widersprochen.`, status: 409 }; }
  }
  // Rechtsgrundlage je Empfänger (Einwilligung, Widerspruch, Kaltakquise) – ohne Grundlage geht nichts raus.
  const legal = await legalCheck(m as MailRow & { source?: string | null });
  if (legal.basis === 'fehlt') { await blockDraft(m.id, legal.reason || 'keine Rechtsgrundlage', actor); return { ok: false, error: `Nicht gesendet – gesperrt: ${legal.reason || 'keine Rechtsgrundlage'}.`, status: 409 }; }
  const { html, text, unsub, token } = await buildOutgoing(m);
  if (missingUnsub(legal, m, html, unsub)) { await blockDraft(m.id, 'Abmeldelink fehlt', actor); return { ok: false, error: 'Nicht gesendet – gesperrt: Abmeldelink fehlt (Werbung nur an genau einen Empfänger mit Abmeldelink).', status: 409 }; }
  const files: OutAttachment[] = [];
  for (const a of m.attachments || []) {
    const { data } = await db.storage.from('mail').download(a.path);
    if (data) files.push({ filename: a.name, content: Buffer.from(await data.arrayBuffer()).toString('base64'), content_type: a.type });
  }
  const res = await resendSend({ to: m.to_emails, cc: m.cc_emails, bcc: m.bcc_emails || [], subject: m.subject, html, text, unsubUrl: unsub, inReplyTo: m.in_reply_to, references: m.refs, files, idemKey: `mail:${m.id}`, log: false });
  if (!res.ok) { await db.from('lr_mail_messages').update({ status: 'fehler', error: res.error.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', m.id); return { ok: false, error: res.error, status: 502 }; }
  const now = new Date().toISOString();
  await db.from('lr_mail_messages').update({ status: 'gesendet', folder: 'sent', error: null, resend_id: res.id, sent_at: now, sent_by: actor, updated_at: now, from_email: mailboxAddress(), snippet: text.replace(/\s+/g, ' ').slice(0, 220) }).eq('id', m.id);
  // Akquise: Kontakt anlegen bzw. fortschreiben und Verlauf protokollieren.
  for (const email of m.to_emails) {
    const { data: cs } = await db.from('lr_crm_contacts').select('id, status').ilike('email', email);
    let ids = (cs ?? []).map((c) => c.id as string);
    if (!ids.length) {
      const ins = await db.from('lr_crm_contacts').insert({ kind: 'sonstige', company: (email.split('@')[1] || email).slice(0, 160), email, status: 'angeschrieben', source: 'E-Mail aus dem Postfach', next_at: new Date(Date.now() + 7 * 864e5).toISOString() }).select('id').single();
      if (ins.data) ids = [ins.data.id as string];
    } else await db.from('lr_crm_contacts').update({ status: 'angeschrieben', updated_at: now }).in('id', ids).eq('status', 'neu');
    if (ids.length) await db.from('lr_crm_activities').insert(ids.map((cid) => ({ contact_id: cid, type: 'email', note: `Gesendet: ${m.subject}`.slice(0, 1000), actor })));
    if (ids[0] && !m.contact_id) await db.from('lr_mail_messages').update({ contact_id: ids[0] }).eq('id', m.id);
  }
  // Keine automatische Kopie beim Senden (Wunsch Feray, 27.10.2026). Die Adresse in mail_copy_to dient nur noch
  // „Vorschau an mich“ – dort sieht sie vor dem Senden, wie die Mail beim Empfänger ankommt.
  void html; void text; void token; void files;
  return { ok: true };
}

// Jede Sperre ins Protokoll (Entwurfs-ID und Grund, ohne Mailinhalt und ohne Adressen).
async function adminAuditSafe(actor: string, id: string, grund: string) {
  const { adminAudit } = await import('@/lib/b2b/core');
  await adminAudit(actor, 'mail_gesperrt', id, { grund }).catch(() => null);
}

// Kopie/Vorschau an die eigene Adresse (Einstellung mail_copy_to). Der Empfänger-Token wird unbrauchbar gemacht,
// damit ein Klick in der Kopie weder den Empfänger abmeldet noch eine Antwort in seinem Namen zuordnet.
const COPY_KEY = 'mail_copy_to';
export async function copyAddress(): Promise<string | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', COPY_KEY).maybeSingle();
  const v = typeof data?.value === 'string' ? data.value.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v) ? v : null;
}
export async function sendCopy(m: MailRow, built: { html: string; text: string; token: string | null }, kind: 'kopie' | 'vorschau', files: OutAttachment[] = []): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const to = await copyAddress();
  if (!to) return { ok: false, error: 'Keine Adresse für Kopien hinterlegt (Web-Admin → Einrichtung).' };
  const neutral = (s: string) => (built.token ? s.split(built.token).join('vorschau') : s);
  const subject = `${kind === 'kopie' ? 'Kopie' : 'Vorschau'}: ${m.subject}`.slice(0, 300);
  const r = await resendSend({ to: [to], subject, html: neutral(built.html), text: neutral(built.text), unsubUrl: null, files, idemKey: `${kind}:${m.id}:${Date.now()}`, log: false });
  return r.ok ? { ok: true, to } : { ok: false, error: r.error };
}
export async function previewToMe(m: MailRow): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  m = { ...m, to_emails: m.to_emails || [], cc_emails: m.cc_emails || [], subject: String(m.subject || ''), attachments: m.attachments || [] };
  return sendCopy(m, await buildOutgoing(m), 'vorschau');
}

export const escHtml = esc;
