import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeRecipient } from '@/lib/notify/mail';

// Resend: Versand (Markenbilder gehostet, Dateianhänge eingebettet) und Empfang (Receiving-API + Webhook „email.received“).
const SITE = 'https://leaserun.com';
export const BRAND_IMAGES = [
  { content_id: 'att0', filename: 'feray-korkmaz.png', path: `${SITE}/img/mail/foto.png?v=2` },
  { content_id: 'att1', filename: 'leaserun.png', path: `${SITE}/brand/leaserun-mail-logo-4x.png` },
  { content_id: 'att2', filename: 'unterschrift.png', path: `${SITE}/img/mail/unterschrift.png` },
];

export const mailboxAddress = () => (process.env.MAILBOX_FROM_EMAIL || 'support@leaserun.com').replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
export const mailboxFrom = () => `${process.env.MAILBOX_FROM_NAME || 'Support | LeaseRun'} <${mailboxAddress()}>`;

export type OutAttachment = { filename: string; content: string /* base64 */; content_type?: string };

export async function resendSend(o: {
  to: string[]; cc?: string[]; bcc?: string[]; subject: string; html: string; text: string; unsubUrl: string | null;
  inReplyTo?: string | null; references?: string | null; files?: OutAttachment[]; brandImages?: boolean; idemKey: string;
  // Kopie unter „Gesendet“ im Postfach (lib/mail/sent-log.ts). false = nicht ablegen (Postfach speichert selbst).
  log?: string | false;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY fehlt).' };
  const to = o.to.map(normalizeRecipient).filter(Boolean) as string[];
  const cc = (o.cc || []).map(normalizeRecipient).filter(Boolean) as string[];
  // Bcc: für alle anderen Empfänger unsichtbar (steht nicht im Kopf der E-Mail).
  const bcc = (o.bcc || []).map(normalizeRecipient).filter(Boolean) as string[];
  if (!to.length) return { ok: false, error: 'Bitte mindestens einen gültigen Empfänger angeben.' };
  if (to.length + cc.length + bcc.length > 20) return { ok: false, error: 'Höchstens 20 Empfänger je E-Mail.' };
  const headers: Record<string, string> = {};
  if (o.unsubUrl) {
    headers['List-Unsubscribe'] = `<${o.unsubUrl}>, <mailto:${mailboxAddress()}?subject=Abmelden>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  if (o.inReplyTo) headers['In-Reply-To'] = o.inReplyTo;
  if (o.references) headers.References = o.references.slice(0, 7900);
  // Logo, Foto und Unterschrift als gehostete Bilder (https://leaserun.com/…) statt als eingebettete Anhänge: So zeigen
  // Gmail, Apple Mail/iOS, Outlook und Android keine Anhang-Chips wie „unterschrift.png“ und keine Büroklammer an,
  // und der Empfänger sieht in der Übersicht direkt Betreff und Vorschautext.
  let html = o.html;
  if (o.brandImages !== false) for (const a of BRAND_IMAGES) html = html.split(`cid:${a.content_id}`).join(a.path.replace(/&/g, '&amp;'));
  const attachments = [
    ...(o.files || []).map((f) => ({ filename: f.filename, content: f.content, ...(f.content_type ? { content_type: f.content_type } : {}) })),
  ];
  const body = JSON.stringify({
    from: mailboxFrom(), to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}), subject: o.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 300),
    html, text: o.text, reply_to: mailboxAddress(), headers, attachments,
  });
  const idem = createHash('sha256').update(o.idemKey).digest('hex').slice(0, 48);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem }, body, signal: AbortSignal.timeout(30000),
      });
      const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
      if (r.ok && j.id) {
        if (o.log !== false) { const { logSent } = await import('@/lib/mail/sent-log'); await logSent({ to, cc, from: mailboxFrom(), subject: o.subject, html, text: o.text, source: o.log || 'system', files: (o.files || []).map((f) => f.filename) }); }
        return { ok: true, id: j.id };
      }
      if (attempt === 0 && (r.status === 429 || r.status >= 500)) { await new Promise((res) => setTimeout(res, 900)); continue; }
      return { ok: false, error: `Versand abgelehnt (HTTP ${r.status})${j.message ? `: ${String(j.message).slice(0, 200)}` : ''}` };
    } catch (e) {
      if (attempt === 0) { await new Promise((res) => setTimeout(res, 900)); continue; }
      return { ok: false, error: `Versand fehlgeschlagen: ${(e as Error)?.name || 'Fehler'}` };
    }
  }
  return { ok: false, error: 'Versand fehlgeschlagen.' };
}

// ---------- Empfang ----------
export type Received = {
  id: string; from: string; to: string[]; cc?: string[]; subject: string; html: string | null; text: string | null;
  headers?: Record<string, string> | { name: string; value: string }[] | null; message_id?: string | null; reply_to?: string[] | null;
  received_for?: string[]; created_at?: string; authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
};
export async function resendGetReceived(id: string): Promise<Received | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !/^[A-Za-z0-9-]{8,80}$/.test(id)) return null;
  const r = await fetch(`https://api.resend.com/emails/receiving/${id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  return r.ok ? ((await r.json()) as Received) : null;
}
export async function resendListReceivedAttachments(id: string): Promise<{ id: string; filename: string; size: number; content_type: string; content_disposition?: string; content_id?: string | null; download_url: string }[]> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return [];
  const r = await fetch(`https://api.resend.com/emails/receiving/${id}/attachments`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: { id: string; filename: string; size: number; content_type: string; content_disposition?: string; content_id?: string | null; download_url: string }[] };
  return j.data || [];
}

// Webhook-Signatur (Svix-Verfahren, wie von Resend verwendet): HMAC-SHA256 über „id.timestamp.body“.
export function verifyWebhook(body: string, h: Headers, secret: string): boolean {
  const id = h.get('svix-id') || h.get('webhook-id');
  const ts = h.get('svix-timestamp') || h.get('webhook-timestamp');
  const sig = h.get('svix-signature') || h.get('webhook-signature');
  if (!id || !ts || !sig || !secret) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  return sig.split(' ').some((part) => {
    const [, v] = part.split(',');
    if (!v) return false;
    const got = Buffer.from(v, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export function headerValue(h: Received['headers'], name: string): string | null {
  if (!h) return null;
  const n = name.toLowerCase();
  if (Array.isArray(h)) { const x = h.find((e) => e?.name?.toLowerCase() === n); return x ? String(x.value) : null; }
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === n) return Array.isArray(v) ? String(v[0]) : String(v);
  return null;
}

// „Name <adresse>“ zerlegen.
export function parseAddress(s: string): { email: string; name: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s || '');
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() || null };
  return { email: String(s || '').trim().toLowerCase(), name: null };
}
