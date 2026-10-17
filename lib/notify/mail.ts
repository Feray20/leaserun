// E-Mail-Versand über Resend – jede E-Mail im ImmoAdv-Design (Logo, Absendername „ImmoAdv“, Fußzeile mit Anbieterangaben).
// Ohne RESEND_API_KEY und NOTIFY_FROM_EMAIL (bzw. CANCEL_FROM_EMAIL) wird nichts versendet.
const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const html = (t: string) => t.replace(/[&<>"]/g, (c) => ENT[c] ?? c);

const SITE = 'https://immoadv.de';
const LOGO = `${SITE}/brand/immoadv-mail-logo.png`;

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && (process.env.NOTIFY_FROM_EMAIL || process.env.CANCEL_FROM_EMAIL));
}

// Absender immer als „ImmoAdv <adresse>“ – auch wenn in Vercel nur die Adresse eingetragen ist.
export function fromAddress(): string {
  const raw = (process.env.NOTIFY_FROM_EMAIL || process.env.CANCEL_FROM_EMAIL || '').trim();
  if (!raw) return '';
  if (/<[^>]+>/.test(raw)) return raw.replace(/^[^<]*</, 'ImmoAdv <');
  return `ImmoAdv <${raw}>`;
}

export type Attachment = { filename: string; content: Uint8Array | Buffer };
export type MailButton = { label: string; url: string };

// Text in gebrandetes HTML umwandeln: Absätze, Links klickbar, alleinstehende ImmoAdv-Links als Knopf.
function bodyHtml(text: string): string {
  const linkify = (s: string) => html(s).replace(/(https:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#0284C7;text-decoration:underline">${u}</a>`);
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.length === 1 && /^https:\/\/immoadv\.de\S*$/.test(lines[0].trim())) {
      return buttonHtml({ label: 'Öffnen', url: lines[0].trim() });
    }
    // Zeilen im Stil „Bezeichnung: Wert“ als kompakte Liste
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

function buttonHtml(b: MailButton): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="border-radius:10px;background:#0F2C59"><a href="${html(b.url)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${html(b.label)}</a></td></tr></table>`;
}

// Vollständiges gebrandetes E-Mail-HTML.
export function brandedHtml({ title, text, button, note }: { title?: string; text: string; button?: MailButton; note?: string }): string {
  const pre = html((text.split('\n').find((l) => l.trim()) || '').slice(0, 120));
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${html(title || 'ImmoAdv')}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0">
<tr><td style="padding:26px 28px 18px;border-bottom:3px solid #0F2C59"><a href="${SITE}" style="text-decoration:none"><img src="${LOGO}" width="180" height="36" alt="ImmoAdv" style="display:block;border:0;width:180px;height:auto"></a></td></tr>
<tr><td style="padding:28px 28px 8px">
${title ? `<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#0F2C59">${html(title)}</h1>` : ''}
${bodyHtml(text)}
${button ? buttonHtml(button) : ''}
${note ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.55;color:#64748B">${html(note)}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px 24px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;line-height:1.6;color:#64748B">
<strong style="color:#0F2C59">ImmoAdv</strong> · Feray Korkmaz (Head of Operations) · Georg-August-Zinn-Str. 25 · 64354 Reinheim<br>
<a href="mailto:support@immoadv.de" style="color:#64748B">support@immoadv.de</a> · <a href="${SITE}/impressum" style="color:#64748B">Impressum</a> · <a href="${SITE}/datenschutz" style="color:#64748B">Datenschutz</a><br>
Technisches Analyse- und Vorbereitungswerkzeug – keine Kreditvermittlung, keine Anlage-, Steuer- oder Rechtsberatung.
</td></tr></table></td></tr></table></body></html>`;
}

export type MailOptions = { title?: string; button?: MailButton; note?: string; replyTo?: string; headers?: Record<string, string> };

export async function sendMail(to: string, subject: string, text: string, attachments: Attachment[] = [], opts: MailOptions = {}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = fromAddress();
  if (!key || !from) return false;
  const plain = text + (opts.button ? `\n\n${opts.button.label}: ${opts.button.url}` : '') + '\n\n—\nImmoAdv · Georg-August-Zinn-Str. 25 · 64354 Reinheim · support@immoadv.de · https://immoadv.de/impressum';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [to], subject, text: plain,
        html: brandedHtml({ title: opts.title, text, button: opts.button, note: opts.note }),
        reply_to: opts.replyTo || 'support@immoadv.de',
        ...(opts.headers ? { headers: opts.headers } : {}),
        ...(attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {}),
      }),
      signal: AbortSignal.timeout(attachments.length ? 30000 : 8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
