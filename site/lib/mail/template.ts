// LeaseRun letter template for every email sent from the Web-Admin mailbox.
// Table layout with inline styles (Gmail, Apple Mail, Outlook desktop/web, Android, iOS). Images are embedded placeholders
// (cid:att0 photo, cid:att1 logo at 4x, cid:att2 handwritten signature) that are replaced by hosted image URLs when sending;
// fixed light colors (color-scheme: light only).
//
// CAN-SPAM: every commercial email (it carries an unsubscribe link) also shows the company's physical postal address
// from COMPANY_POSTAL_ADDRESS. Transactional mail and replies never show it. Use a business mailbox / PO box, never a residence.
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const SITE = 'https://leaserun.com';
const F = 'font-family:Helvetica,Arial,sans-serif';

// ---------- Clean editor content (allowlist) and style it for email clients ----------
const STYLE: Record<string, string> = {
  p: `margin:0 0 16px;${F};font-size:16px;line-height:26px;color:#1e293b`,
  h2: `margin:8px 0 12px;${F};font-size:21px;line-height:28px;font-weight:800;color:#0f2c59`,
  h3: `margin:8px 0 10px;${F};font-size:17px;line-height:24px;font-weight:700;color:#0f2c59`,
  ul: `margin:0 0 16px;padding:0 0 0 22px;${F};font-size:16px;line-height:26px;color:#1e293b`,
  ol: `margin:0 0 16px;padding:0 0 0 22px;${F};font-size:16px;line-height:26px;color:#1e293b`,
  li: 'margin:0 0 6px',
  blockquote: `margin:0 0 16px;padding:12px 16px;border-left:3px solid #38bdf8;background-color:#f0f9ff;${F};font-size:15px;line-height:24px;color:#334155`,
  a: 'color:#0284c7;text-decoration:underline',
  strong: 'font-weight:700;color:#0f172a', b: 'font-weight:700;color:#0f172a', em: 'font-style:italic', i: 'font-style:italic', u: 'text-decoration:underline',
};
const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote']);
const BLOCK = new Set(['p', 'ul', 'ol', 'li', 'h2', 'h3', 'blockquote']);
const MAP: Record<string, string> = { div: 'p', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3' };

export function sanitizeBody(input: string): string {
  let s = String(input || '').slice(0, 400000);
  s = s.replace(/<(script|style|head|title|iframe|object|svg|math|template)[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const out: string[] = [];
  const stack: string[] = [];
  let autoP = false;
  const re = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[3] !== undefined) {
      if (!stack.length && m[3].trim()) { out.push(`<p style="${STYLE.p}">`); stack.push('p'); autoP = true; }
      out.push(m[3].replace(/</g, '&lt;').replace(/>/g, '&gt;')); continue;
    }
    const closing = m[0].startsWith('</');
    let tag = m[1].toLowerCase();
    tag = MAP[tag] || tag;
    if (!ALLOWED.has(tag)) continue;
    if (tag === 'br') { if (!closing && stack.length) out.push('<br>'); continue; }
    if (closing) {
      const i = stack.lastIndexOf(tag);
      if (i === -1) continue;
      while (stack.length > i) out.push(`</${stack.pop()}>`);
      continue;
    }
    let attrs = '';
    if (tag === 'a') {
      const h = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[2]);
      const href = (h ? (h[2] ?? h[3] ?? h[4] ?? '') : '').replace(/&amp;/g, '&').trim();
      if (!/^(https:\/\/|http:\/\/|mailto:|tel:)/i.test(href)) continue;
      attrs = ` href="${esc(href)}" target="_blank"`;
    }
    if (BLOCK.has(tag) && tag !== 'li' && stack[0] === 'p' && stack.length === 1 && autoP) { out.push('</p>'); stack.pop(); autoP = false; }
    if (!BLOCK.has(tag) && !stack.length) { out.push(`<p style="${STYLE.p}">`); stack.push('p'); autoP = true; }
    out.push(`<${tag}${attrs} style="${STYLE[tag] || ''}">`);
    stack.push(tag);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  // Wrap loose text in a paragraph, drop empty paragraphs.
  let html = out.join('').replace(/<p style="[^"]*">(\s|&nbsp;|<br>)*<\/p>/g, '');
  if (!/^\s*<(p|h2|h3|ul|ol|blockquote)\b/.test(html)) html = `<p style="${STYLE.p}">${html}</p>`;
  return html;
}

export function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h2|h3|blockquote|ul|ol|table)>/gi, '\n\n').replace(/<\/(li|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_x, href, t) => { const tt = t.replace(/<[^>]+>/g, ''); return href.startsWith('mailto:') || tt.includes(href) ? tt : `${tt} (${href})`; })
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Building blocks ----------
// Header: the same logo as in every other LeaseRun email, at 4x resolution (720 px for 180 px display) – sharp on every screen.
const HEADER = `<tr><td class="lr-pad" style="padding:22px 28px 18px"><a href="${SITE}" style="text-decoration:none"><img src="cid:att1" width="180" height="34" alt="LeaseRun" style="display:block;border:0;outline:none;width:180px;height:34px;max-width:180px;-ms-interpolation-mode:bicubic"></a></td></tr>
<tr><td height="1" style="height:1px;line-height:1px;font-size:0;background-color:#e2e8f0">&nbsp;</td></tr>`;

// Handwritten signature (3x resolution, displayed at 117×46).
// No alt text on purpose: with images blocked (Outlook default) the sender line would otherwise repeat – it is shown as text next to it.
export const SIG_IMG = '<img src="cid:att2" width="117" height="46" alt="" style="display:block;width:117px;height:46px;border:0;margin:0">';
// Signature (calm, trustworthy): handwritten signature right below the sign-off, then photo and sender block, then a compact
// LinkedIn button. No divider; support@ appears only once (in the footer). Spacing lives in the table cells, not on the image –
// compose.ts swaps the signature image when sending and must not change the layout.
// Identical in Outlook, Apple Mail, Gmail, iOS and Android. No personal name in company emails – role and company only.
export const SIGNATURE = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td colspan="2" style="padding:0 0 14px">${SIG_IMG}</td></tr><tr><td valign="middle" width="66" style="width:66px;min-width:66px;padding:0 14px 0 0;vertical-align:middle"><img src="cid:att0" width="52" height="52" alt="" style="display:block;width:52px;height:52px;max-width:52px;border:0;border-radius:26px;-ms-interpolation-mode:bicubic"></td><td valign="middle" style="vertical-align:middle"><p style="margin:0;${F};font-size:15px;line-height:20px;font-weight:700;color:#0f2c59">LeaseRun</p><p style="margin:0 0 2px;${F};font-size:13px;line-height:19px;color:#64748b">Head of Operations</p><p style="margin:0 0 8px;${F};font-size:13px;line-height:19px"><a href="${SITE}" style="color:#0284c7;text-decoration:none;font-weight:700">leaserun.com</a></p><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0A66C2" style="background-color:#0a66c2;border-radius:6px;mso-padding-alt:5px 11px"><a href="https://www.linkedin.com/company/leaserun/" target="_blank" style="display:inline-block;padding:5px 11px;${F};font-size:12px;line-height:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px"><span style="display:inline-block;background-color:#ffffff;color:#0a66c2;border-radius:3px;padding:0 4px;margin-right:6px;font-weight:800">in</span>LeaseRun on LinkedIn</a></td></tr></table></td></tr></table>`;
// Small note in the footer (e.g. "We found your address on your website …") – it does not belong in the letter body.
export const footerNote = (note: string) => `<p style="margin:0 0 6px;${F};font-size:11px;line-height:17px;color:#94a3b8">${note}</p>`;

// Physical postal address for commercial email (CAN-SPAM). Empty = not configured (commercial mail is blocked, see legal-gate.ts).
export const postalAddress = (): string => String(process.env.COMPANY_POSTAL_ADDRESS || '').replace(/[\r\n]+/g, ', ').replace(/\s+/g, ' ').trim().slice(0, 200);

// Footer as in every other LeaseRun email – no personal name. Commercial mail (unsubUrl set) adds the postal address and
// the unsubscribe link; transactional mail and replies show neither.
export function footer(unsubUrl: string | null, note?: string): string {
  const L = 'color:#94a3b8;text-decoration:underline';
  const addr = unsubUrl ? postalAddress() : '';
  return `<tr><td class="lr-pad" bgcolor="#F8FAFC" style="background-color:#f8fafc;border-top:1px solid #eef2f6;border-radius:0 0 17px 17px;padding:14px 28px 16px;${F}">${note ? footerNote(esc(note)) : ''}<p style="margin:0 0 4px;${F};font-size:12px;line-height:19px;color:#64748b"><strong style="color:#0f2c59">LeaseRun</strong> · Questions? <a href="mailto:support@leaserun.com" style="color:#0284c7;text-decoration:none">support@leaserun.com</a> · <a href="${SITE}" style="color:#0284c7;text-decoration:none">leaserun.com</a></p>${addr ? `<p style="margin:0 0 4px;${F};font-size:11px;line-height:17px;color:#94a3b8">LeaseRun · ${esc(addr)}</p>` : ''}<p style="margin:0;${F};font-size:11px;line-height:17px;color:#94a3b8"><a href="${SITE}/privacy" style="${L}">Privacy</a> · <a href="${SITE}/terms" style="${L}">Terms</a>${unsubUrl ? ` · <a href="${esc(unsubUrl)}" style="${L}">Unsubscribe</a>` : ''}</p></td></tr>`;
}

// Quoted previous message in replies (as text, so foreign HTML cannot break the layout). Currently not used: sent mails carry no quoted history.
export function quoteBlock(q: { from: string; date: string; text: string } | null): string {
  if (!q || !q.text) return '';
  const t = esc(q.text.slice(0, 6000)).replace(/\n/g, '<br>');
  return `<tr><td class="lr-pad" style="padding:0 28px 22px"><p style="margin:0 0 8px;${F};font-size:12px;line-height:18px;color:#64748b">On ${esc(q.date)}, ${esc(q.from)} wrote:</p><div style="margin:0;padding:10px 14px;border-left:3px solid #cbd5e1;${F};font-size:13px;line-height:20px;color:#64748b">${t}</div></td></tr>`;
}

// If the text ends with a sign-off ("Best regards", "Sincerely", also followed by a name on the next line), it is used as the
// sign-off above the signature – otherwise the sign-off would appear twice. German sign-offs are recognized too, because
// replies are written in the sender's language.
export const DEFAULT_GREETING = 'Best regards';
const SIGNOFF = /<p(?:\s[^>]*)?>\s*((?:Best|Kind|Warm|Warmest)(?: regards)?|Best wishes|Regards|Sincerely(?: yours)?|Yours sincerely|Yours truly|Thanks(?: again)?|Thank you|Many thanks|Cheers|(?:Viele|Beste|Herzliche|Liebe|Freundliche) Grüße|Mit (?:freundlichen|besten|herzlichen) Grüßen)[,.!]?\s*(?:<br\s*\/?>\s*(?:Feray(?: Korkmaz)?|The LeaseRun Team|LeaseRun(?: Team)?)\s*)?<\/p>\s*$/;
export function splitGreeting(body: string): { body: string; greeting: string } {
  const g = SIGNOFF.exec(body);
  return g ? { body: body.slice(0, g.index), greeting: g[1] } : { body, greeting: DEFAULT_GREETING };
}

// Complete letter (content from the editor).
export function renderBrief(o: { body: string; greeting?: string; unsubUrl: string | null; quote?: { from: string; date: string; text: string } | null; cta?: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7" style="background-color:#eef2f7"><tr><td class="lr-wrap" align="center" style="padding:26px 10px 34px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:600px;background-color:#ffffff;border-radius:18px;border:1px solid #e2e8f0;overflow:hidden">
<tr><td height="6" bgcolor="#0369A1" style="height:6px;line-height:6px;font-size:0;background-color:#0369a1;background-image:linear-gradient(90deg,#0f2c59 0%,#0369a1 55%,#38bdf8 100%);border-radius:18px 18px 0 0">&nbsp;</td></tr>
${HEADER}
<tr><td class="lr-pad" style="padding:28px 28px 6px">${o.body}</td></tr>
${o.cta ? `<tr><td class="lr-pad" style="padding:0 28px 10px">${o.cta}</td></tr>` : ''}
<tr><td class="lr-pad" style="padding:10px 28px 28px"><p style="margin:0 0 12px;${F};font-size:16px;line-height:24px;color:#1e293b">${esc(o.greeting || DEFAULT_GREETING)}</p>${SIGNATURE}</td></tr>
${quoteBlock(o.quote ?? null)}
${footer(o.unsubUrl)}
</table></td></tr></table>`;
}

// Preview text (line under the subject in Gmail, Apple Mail, Outlook): the first meaningful sentence –
// never logo/image text, salutation or company name. Otherwise mail apps show "LeaseRun", "Google" or file names first.
export function previewText(text: string, subject = ''): string {
  const skip = /^(leaserun( business)?|hi|hello|hey|dear|good (morning|afternoon|evening)|greetings|guten (tag|morgen|abend)|hallo|sehr geehrte|liebe|lieber|\[.*\]|image|photo|picture|logo|signature|bild|foto|unterschrift|google|linkedin|png|jpe?g)\b/i;
  const usable = String(text || '').split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 3 && !skip.test(l) && !/^https?:\/\//.test(l) && !/\.(png|jpe?g|gif|svg)\b/i.test(l));
  // Prefer a meaningful line; if none is long enough, the first usable short line rather than just the subject.
  return (usable.find((l) => l.length >= 18) || usable[0] || subject || '').slice(0, 140);
}

export function wrapDocument(subject: string, inner: string, preview: string): string {
  preview = previewText(preview, subject);
  return `<!doctype html><html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><meta name="format-detection" content="telephone=no,address=no,email=no,date=no"><title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,p,a,h2,h3,li{font-family:Arial,sans-serif!important;mso-line-height-rule:exactly}</style><![endif]-->
<style>:root{color-scheme:light only;supported-color-schemes:light}body{margin:0!important;padding:0!important;width:100%!important}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}@media (max-width:480px){.lr-pad{padding-left:18px!important;padding-right:18px!important}.lr-wrap{padding:12px 6px 20px!important}}</style></head>
<body style="margin:0;padding:0;background-color:#eef2f7;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preview.replace(/\s+/g, ' ').slice(0, 140))}${'&#8199;&#65279;&#847;'.repeat(30)}</div>
<!--[if mso]><table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
${inner}
<!--[if mso]></td></tr></table><![endif]-->
</body></html>`;
}

export function fillTemplate(html: string, termin: string | null, fallback: string | null): string {
  const url = termin || fallback || 'mailto:support@leaserun.com?subject=Meeting%20request';
  return html.split('{{TERMIN_URL}}').join(url.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
}
