import { supabaseAdmin } from '@/lib/supabase/admin';
import { converse, gate } from '@/lib/admin/hq-ai';
import { pushAdmins } from '@/lib/admin/push';
import { htmlToText, sanitizeBody } from '@/lib/mail/template';
import { mailboxAddress } from '@/lib/mail/resend';
import { snippetOf } from '@/lib/mail/store';

// Automatic reply draft (owner's wish, Oct 27, 2026): when an email arrives that needs an answer, Claude writes a draft in
// the thread right away – in the sender's language and level of formality, addressing every question. Nothing is ever sent
// automatically: the Head of Operations reads it, edits if needed and sends it herself ("Open draft & send").
// Layout, sign-off, signature and footer are added by the mailbox when sending – the draft only contains the text (no images,
// no signature), so nothing appears twice and no image can fail to load.

export const NO_REPLY = /(^|[._-])(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|bounce|notifications?|newsletter|news|info-?mail|system|alerts?|billing|invoice|receipts?|statements?)([._+-]|@)/i;
// Auto-replies, delivery reports and receipts (English plus common German/other-language variants, since mail comes from anywhere).
export const AUTO_SUBJ = /(automatic reply|auto(matic)?-?reply|out of (the )?office|ooo:|away from (the )?office|on vacation|delivery status|undeliverable|delivery (has )?failed|returned mail|read receipt|your order|order confirmation|order #|invoice #|receipt from|your receipt|payment received|has shipped|shipped:|delivered:|automatische antwort|abwesenheit|ich bin (derzeit )?nicht im büro|unzustellbar|zustellung fehlgeschlagen|lesebestätigung|ihre bestellung|rechnung nr)/i;
const AUTO_BODY = /(this is an automated|automatically generated|please do not reply|do not reply to this (e-?mail|message)|this mailbox is not monitored|we can'?t respond to every|nicht jede anfrage persönlich beantworten|automatisch generiert|bitte antworten sie nicht auf diese)/i;

type Row = { id: string; thread_id: string; direction: 'in' | 'out'; folder: string; status: string | null; from_email: string; from_name: string | null; subject: string; text_body: string | null; message_id: string | null; refs: string | null; auth: { unsub?: unknown } | null; created_at: string; received_at: string | null; sent_at: string | null };

const SYSTEM = `You write reply drafts for the LeaseRun mailbox (leaserun.com, support@leaserun.com). The sender is the LeaseRun team; the mailbox owner's title is Head of Operations. Never sign with a personal name.

About LeaseRun (use only these facts, never invent anything):
- Online software for U.S. home buyers and small rental-property investors: before talking to a lender it runs the numbers a lender looks at – monthly budget, closing costs, down payment and cash to close, LTV, DTI, DSCR for rentals, PITIA, an interest-rate stress test – and turns them into a ready-to-share Lender Package (PDF).
- LeaseRun is software for education and planning. It is not a lender, mortgage broker, financial advisor, tax advisor, law firm or appraiser. It does not arrange loans and takes no fees or commissions from lenders. It is paid for by the users who buy full access.
- User data is not sold or shared with lenders or brokers. Privacy questions: point to https://leaserun.com/privacy.
- Results are estimates, not a loan approval, rate quote or commitment, and not financial, tax or legal advice.
- LeaseRun currently has no budget for paid placements, ads or sponsored posts: decline politely and offer a free alternative that benefits both sides (win-win).
- Never say where the company or its team is located.

Rules for the draft:
- Reply in the same language as the last incoming email. In English use a friendly, professional U.S. business tone. In languages with formal and informal address (e.g. German du/Sie), mirror the sender's choice.
- Address every question and request in the last email specifically. If questions are numbered or listed, answer each one. If the sender asks for a format (e.g. keep the questions as they are, plain text), follow it.
- Never invent numbers, dates, prices, names, testimonials or commitments. If a piece of information only the owner can know is missing, put a short placeholder in double brackets exactly there, e.g. ⟦add date⟧. Use as few placeholders as possible.
- Never mention anyone's home address or private details. Never mention that the text was written by AI.
- Clear, friendly, to the point. No filler, no marketing speak, no emojis.
- Start with the salutation. End the text WITHOUT a sign-off and WITHOUT a name or signature – the mailbox adds the sign-off, signature and footer automatically. Exception: for very formal emails the last line may be "Sincerely" (or the equivalent in the sender's language).
- No images, no links except https://leaserun.com when it really helps.

Answer with JSON only, no code block:
{"antworten": true|false, "grund": "short reason why a reply is (not) needed", "absaetze": ["Paragraph 1", "Paragraph 2", ...]}
"antworten" is false for auto-replies, out-of-office notes, newsletters, ads, notifications, confirmations without a question, simple thank-you emails with nothing open, and spam.`;

export async function autoDraftFor(mailId: string, manual = false): Promise<{ ok: boolean; why: string; draftId?: string }> {
  const db = supabaseAdmin();
  const { data: m } = await db.from('lr_mail_messages').select('id, thread_id, direction, folder, status, from_email, from_name, subject, text_body, message_id, refs, auth, created_at, received_at, sent_at').eq('id', mailId).maybeSingle<Row>();
  if (!m || m.direction !== 'in' || (!manual && m.folder !== 'inbox')) return { ok: false, why: 'not an incoming email in the inbox' };
  const from = String(m.from_email || '').toLowerCase();
  if (!from || from.endsWith('@' + (mailboxAddress().split('@')[1] || 'leaserun.com'))) return { ok: false, why: 'own address' };
  if (!manual && (NO_REPLY.test(from) || m.auth?.unsub || AUTO_SUBJ.test(m.subject || '') || AUTO_BODY.test(m.text_body || ''))) return { ok: false, why: 'automated email / newsletter' };
  const { data: thread } = await db.from('lr_mail_messages').select('id, direction, status, from_email, from_name, subject, text_body, created_at, received_at, sent_at').eq('thread_id', m.thread_id).neq('folder', 'trash').order('created_at', { ascending: true }).limit(20);
  const rows = (thread ?? []) as Row[];
  // Already a draft in the thread created after this email? Then do not create a second one.
  const mAt = Date.parse(m.received_at || m.created_at);
  if (rows.some((x) => x.direction === 'out' && x.status === 'entwurf' && Date.parse(x.created_at) >= mAt - 1000)) return { ok: false, why: 'draft already exists' };

  const g = await gate(manual ? 'user' : 'auto');
  if (!g.ok) return { ok: false, why: g.reason };

  // Thread as plain text with older quotes cut off, so the model only reads what matters.
  const cut = (t: string) => String(t || '').split(/\n(?:Am .{5,80} schrieb|On .{5,80} wrote|Von: |From: |-----Original|_{5,})/)[0].replace(/\n{3,}/g, '\n\n').trim().slice(0, 9000);
  const hist = rows.filter((x) => x.direction === 'in' || x.status === 'gesendet').slice(-6).map((x) => `### ${x.direction === 'in' ? `Received from ${x.from_name ? `${x.from_name} <${x.from_email}>` : x.from_email}` : 'Sent by us'} · ${x.subject || ''}\n${cut(x.text_body || '')}`).join('\n\n');
  const r = await converse({ agent: 'postfach', model: g.settings.rest, system: SYSTEM, messages: [{ role: 'user', content: `Thread (oldest first; reply to the last incoming email):\n\n${hist}` }], tools: [], grund: 'antwort-entwurf', maxTurns: 2, maxTokens: 8000, timeoutMs: 120_000 });
  let j: { antworten?: boolean; grund?: string; absaetze?: unknown } = {};
  try { j = JSON.parse((/\{[\s\S]*\}/.exec(r.text) || ['{}'])[0]); } catch { return { ok: false, why: 'response not readable' }; }
  if (!j.antworten && !manual) return { ok: false, why: `no reply needed: ${String(j.grund || '').slice(0, 120)}` };
  const paras = (Array.isArray(j.absaetze) ? j.absaetze : []).map((p) => String(p || '').trim()).filter(Boolean).slice(0, 60);
  if (!paras.length) return { ok: false, why: 'empty draft' };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Text paragraphs only – sanitizeBody applies the LeaseRun font; images or foreign HTML never get into the draft.
  const body = sanitizeBody(paras.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
  const text = htmlToText(body);
  const subj = /^(re|aw|antw):/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`.trim();
  const id = crypto.randomUUID();
  const ins = await db.from('lr_mail_messages').insert({
    id, thread_id: m.thread_id, direction: 'out', folder: 'drafts', status: 'entwurf', design: 'frei', from_email: mailboxAddress(),
    to_emails: [from], cc_emails: [], bcc_emails: [], subject: subj.slice(0, 300), html: body, text_body: text, snippet: snippetOf(text),
    with_unsub: false, in_reply_to: m.message_id, refs: [m.refs, m.message_id].filter(Boolean).join(' ').slice(-7900) || null, attachments: [], source: 'claude-auto',
  });
  if (ins.error) return { ok: false, why: ins.error.message };
  const open = (text.match(/⟦/g) || []).length;
  await pushAdmins('mail', 'Reply draft ready', `${m.from_name || from}: ${String(m.subject || '').slice(0, 60)}${open ? ` – ${open} spot${open === 1 ? '' : 's'} to fill in` : ' – ready to send'}`, 'mail_draft').catch(() => null);
  return { ok: true, why: 'draft created', draftId: id };
}
