// Email sending via Resend – every email in the LeaseRun design (sharp logo, sender name "LeaseRun", uniform footer).
// Footer without a personal name: company emails only show LeaseRun, support@leaserun.com and leaserun.com.
// Commercial emails (newsletter, marketing – opts.marketing) additionally show the physical postal address
// (COMPANY_POSTAL_ADDRESS, CAN-SPAM); transactional emails never do.
// Without RESEND_API_KEY and NOTIFY_FROM_EMAIL (or CANCEL_FROM_EMAIL) nothing is sent.
// Delivery: the recipient is validated and normalized; on 429/5xx exactly one retry with the same idempotency key
// (no double delivery). Errors are logged without the recipient address.
import { createHash, randomUUID } from 'node:crypto';
import { postalAddress, previewText } from '@/lib/mail/template';
const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const html = (t: string) => t.replace(/[&<>"]/g, (c) => ENT[c] ?? c);

const SITE = 'https://leaserun.com';
// Logo at 4x resolution (720 px for 180 px display) – crisp on Retina/3x screens too.
// New file name so Gmail & co. do not show an old cached version.
const LOGO = `${SITE}/brand/leaserun-mail-logo-4x.png`;

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && (process.env.NOTIFY_FROM_EMAIL || process.env.CANCEL_FROM_EMAIL));
}

// Sender always as "LeaseRun <address>" – even if only the address is set in Vercel.
// Business customers (area 'b2b') receive emails as "LeaseRun Business" – separate from the consumer area.
export type MailArea = 'b2c' | 'b2b';
export function fromAddress(area: MailArea = 'b2c'): string {
  const raw = (process.env.NOTIFY_FROM_EMAIL || process.env.CANCEL_FROM_EMAIL || '').trim();
  if (!raw) return '';
  const name = area === 'b2b' ? 'LeaseRun Business' : 'LeaseRun';
  if (/<[^>]+>/.test(raw)) return raw.replace(/^[^<]*</, `${name} <`);
  return `${name} <${raw}>`;
}

export type Attachment = { filename: string; content: Uint8Array | Buffer };
export type MailButton = { label: string; url: string };

// Turn text into branded HTML: paragraphs, clickable links, standalone LeaseRun links become a button.
function bodyHtml(text: string): string {
  const linkify = (s: string) => html(s).replace(/(https:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#0284C7;text-decoration:underline">${u}</a>`);
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.length === 1 && /^https:\/\/leaserun\.com\S*$/.test(lines[0].trim())) {
      return buttonHtml({ label: 'Open', url: lines[0].trim() });
    }
    // Lines in the style "Label: value" as a compact list
    if (lines.length > 2 && lines.filter((l) => /^[^:]{2,40}:\s/.test(l)).length >= lines.length - 1) {
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 16px">${lines.map((l) => {
        const m = /^([^:]{2,40}):\s(.*)$/.exec(l);
        return m ? `<tr><td style="padding:5px 12px 5px 0;color:#64748B;font-size:14px;vertical-align:top;white-space:nowrap">${html(m[1])}</td><td style="padding:5px 0;color:#0F172A;font-size:14px;font-weight:600">${linkify(m[2])}</td></tr>`
          : `<tr><td colspan="2" style="padding:8px 0 4px;color:#0F2C59;font-size:13px;font-weight:700;letter-spacing:.04em">${linkify(l)}</td></tr>`;
      }).join('')}</table>`;
    }
    return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1E293B">${lines.map(linkify).join('<br>')}</p>`;
  }).join('');
}

// Button plus a small fallback link below (for clients that hide buttons or rewrite links).
function buttonHtml(b: MailButton, accent = '#0F2C59'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td style="border-radius:10px;background:${accent}"><a href="${html(b.url)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${html(b.label)}</a></td></tr></table>
<p style="margin:0 0 22px;font-size:12px;line-height:1.5;color:#64748B;word-break:break-all">If the button doesn't work: <a href="${html(b.url)}" style="color:#64748B">${html(b.url.replace(/^https:\/\//, ''))}</a></p>`;
}

// Complete branded email HTML.
// accent: brand color of a business customer (co-branded client invitation), valid hex colors only.
// marketing: commercial email (newsletter, campaign) – adds the physical postal address to the footer (CAN-SPAM).
export function brandedHtml({ title, text, button, note, area = 'b2c', accent, marketing = false }: { title?: string; text: string; button?: MailButton; note?: string; area?: MailArea; accent?: string; marketing?: boolean }): string {
  const biz = area === 'b2b';
  const ac = accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#0F2C59';
  const pre = html(previewText(text, title || '')) + '&#8199;&#65279;&#847;'.repeat(30);
  const addr = marketing ? postalAddress() : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${html(title || 'LeaseRun')}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0">
<tr><td height="6" bgcolor="${ac}" style="height:6px;line-height:6px;font-size:0;background-color:${ac};background-image:linear-gradient(90deg,${ac} 0%,#0369A1 55%,#38BDF8 100%)">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 18px;border-bottom:1px solid #E2E8F0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><a href="${biz ? `${SITE}/business-portal` : SITE}" style="text-decoration:none"><img src="${LOGO}" width="180" height="34" alt="LeaseRun" style="display:block;border:0;outline:none;width:180px;height:34px;max-width:180px;-ms-interpolation-mode:bicubic"></a></td>${biz ? '<td align="right" style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#0369A1;text-transform:uppercase">Business Portal</td>' : ''}</tr></table></td></tr>
<tr><td style="padding:28px 28px 8px">
${title ? `<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#0F2C59">${html(title)}</h1>` : ''}
${bodyHtml(text)}
${button ? buttonHtml(button, ac) : ''}
${note ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.55;color:#64748B">${html(note)}</p>` : ''}
</td></tr>
<tr><td style="padding:0 28px"><div style="height:1px;line-height:1px;font-size:0;background:#E2E8F0">&nbsp;</div></td></tr>
<tr><td style="padding:16px 28px 4px;font-size:12px;line-height:1.6;color:#64748B"><strong style="color:#0F2C59">LeaseRun${biz ? ' Business' : ''}</strong> · Questions? <a href="mailto:support@leaserun.com" style="color:#0284C7;text-decoration:none">support@leaserun.com</a> · <a href="${SITE}" style="color:#0284C7;text-decoration:none">leaserun.com</a></td></tr>
${addr ? `<tr><td style="padding:0 28px 4px;font-size:11px;line-height:1.6;color:#94A3B8">LeaseRun · ${html(addr)}</td></tr>` : ''}
<tr><td style="padding:0 28px 6px;font-size:11px;line-height:1.6;color:#94A3B8">${biz ? `<a href="${SITE}/business-portal" style="color:#94A3B8;text-decoration:underline">Business Portal</a> · ` : ''}<a href="https://leaserun.com/privacy" style="color:#94A3B8;text-decoration:underline">Privacy</a> · <a href="https://leaserun.com/terms" style="color:#94A3B8;text-decoration:underline">Terms</a></td></tr>
<tr><td style="padding:0 28px 20px;font-size:10px;line-height:1.5;color:#94A3B8">
LeaseRun is planning and analysis software – not a lender or mortgage broker, and not financial, tax or legal advice.
</td></tr></table></td></tr></table></body></html>`;
}

// sender: display name "<Company> via LeaseRun" (the address stays LeaseRun's); accent: brand color in the HTML.
// marketing: commercial email (newsletter, campaign) – footer shows the postal address (CAN-SPAM). Callers must also
// include an unsubscribe link (note) and List-Unsubscribe headers.
export type MailOptions = { title?: string; button?: MailButton; note?: string; replyTo?: string; headers?: Record<string, string>; area?: MailArea; sender?: string; accent?: string; marketing?: boolean };

// Validate the recipient (one address, no header injection) and normalize it.
export function normalizeRecipient(to: string): string | null {
  const t = String(to || '').trim().toLowerCase();
  return /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,190}\.[a-z0-9-]{2,63}$/.test(t) ? t : null;
}

export async function sendMail(to: string, subject: string, text: string, attachments: Attachment[] = [], opts: MailOptions = {}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const base = fromAddress(opts.area);
  const sn = (opts.sender || '').replace(/["<>\r\n,;\\]/g, '').trim().slice(0, 60);
  const from = sn && base ? base.replace(/^[^<]*</, `"${sn} via LeaseRun" <`) : base;
  const rcpt = normalizeRecipient(to);
  const subj = subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
  // Notifications to our own mailbox (support@leaserun.com): write them straight into the Web-Admin inbox – visible right away
  // in the Web-Admin and the app, without going through email delivery (an email to ourselves would not arrive reliably).
  if (rcpt && isOwnInbox(rcpt)) return postToInbox(rcpt, subj, text, attachments, opts);
  if (!key || !from || !rcpt) return false;
  const addr = opts.marketing ? postalAddress() : '';
  const plain = text + (opts.button ? `\n\n${opts.button.label}: ${opts.button.url}` : '') + (opts.note ? `\n\n${opts.note}` : '') + '\n\n—\n' + (opts.area === 'b2b' ? 'LeaseRun Business · Business Portal: https://leaserun.com/business-portal\n' : '') + 'LeaseRun · support@leaserun.com · https://leaserun.com' + (addr ? `\nLeaseRun · ${addr}` : '');
  const html = brandedHtml({ title: opts.title, text, button: opts.button, note: opts.note, area: opts.area, accent: opts.accent, marketing: opts.marketing });
  const body = JSON.stringify({
    from, to: [rcpt], subject: subj, text: plain,
    html,
    reply_to: opts.replyTo || 'support@leaserun.com',
    ...(opts.headers ? { headers: opts.headers } : {}),
    ...(attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {}),
  });
  // The same email to the same address within 10 minutes is delivered only once by Resend.
  const idem = createHash('sha256').update(`${rcpt}\n${subj}\n${text}\n${Math.floor(Date.now() / 600000)}`).digest('hex').slice(0, 48);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem },
        body,
        signal: AbortSignal.timeout(attachments.length ? 30000 : 8000),
      });
      if (r.ok) {
        // Copy in the support@ mailbox under "Sent" (lib/mail/sent-log.ts) – sensitive emails only as a note.
        const { logSent } = await import('@/lib/mail/sent-log');
        await logSent({ to: [rcpt], from, subject: subj, html, text: plain, source: `system-${opts.area || 'b2c'}`, files: attachments.map((a) => a.filename) });
        return true;
      }
      if (attempt === 0 && (r.status === 429 || r.status >= 500)) { await new Promise((res) => setTimeout(res, 800)); continue; }
      console.warn(`[mail] Sending failed: HTTP ${r.status} (${subj.slice(0, 60)})`);
      return false;
    } catch (e) {
      if (attempt === 0) { await new Promise((res) => setTimeout(res, 800)); continue; }
      console.warn(`[mail] Sending failed: ${(e as Error)?.name || 'error'} (${subj.slice(0, 60)})`);
      return false;
    }
  }
  return false;
}

// ---------- Own mailbox ----------
function isOwnInbox(addr: string): boolean {
  const own = [process.env.SUPPORT_INBOX || 'support@leaserun.com', process.env.MAILBOX_FROM_EMAIL || 'support@leaserun.com']
    .map((x) => x.replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase());
  return own.includes(addr);
}

async function postToInbox(rcpt: string, subj: string, text: string, attachments: Attachment[], opts: MailOptions): Promise<boolean> {
  try {
    const { adminConfigured, supabaseAdmin } = await import('@/lib/supabase/admin');
    if (!adminConfigured()) return false;
    const db = supabaseAdmin();
    const id = randomUUID(), now = new Date().toISOString();
    const files: { name: string; type: string; size: number; path: string }[] = [];
    for (const a of attachments) {
      const name = a.filename.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'attachment';
      const path = `in/${id}/${files.length + 1}-${name}`;
      const type = /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'application/octet-stream';
      const up = await db.storage.from('mail').upload(path, Buffer.from(a.content), { contentType: type, upsert: true });
      if (!up.error) files.push({ name, type, size: a.content.byteLength, path });
    }
    const customer = opts.replyTo && !isOwnInbox(opts.replyTo.toLowerCase()) ? opts.replyTo.toLowerCase() : null;
    const row = {
      id, thread_id: id, direction: 'in', folder: 'inbox', status: null, design: 'eingang',
      // If the message comes from a customer (contact form, request): "Reply" goes straight to that address.
      from_email: customer || 'system@leaserun.com',
      from_name: customer ? `${opts.title || 'Request'} · via leaserun.com` : `LeaseRun · ${opts.title || 'Notification'}`,
      to_emails: [rcpt], cc_emails: [], subject: subj,
      html: brandedHtml({ title: opts.title, text, button: opts.button, note: opts.note, area: opts.area, accent: opts.accent }),
      text_body: text, snippet: text.replace(/\s+/g, ' ').trim().slice(0, 220), attachments: files,
      auth: { system: true }, source: 'system', received_at: now, created_at: now, updated_at: now,
    };
    const r = await db.from('lr_mail_messages').insert(row);
    if (r.error) { console.warn('[mail] Mailbox entry failed:', r.error.message); return false; }
    return true;
  } catch (e) {
    console.warn('[mail] Mailbox entry failed:', (e as Error)?.message);
    return false;
  }
}
