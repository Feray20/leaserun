import { esc, htmlToText, renderBrief, wrapDocument } from '@/lib/mail/template';
import { supportInbox } from '@/lib/notify/inbox';
import { mailboxAddress, resendSend } from '@/lib/mail/resend';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { berlinLabel, icsFile } from '@/lib/booking/core';

export type Booking = {
  id: string; token: string; name: string; email: string; company: string | null; phone: string | null; topic: string | null; message: string | null;
  starts_at: string; ends_at: string; status: 'angefragt' | 'bestaetigt' | 'abgelehnt' | 'abgesagt'; teams_url: string | null; ms_event_id: string | null; note: string | null; created_at: string;
};
const SITE = 'https://leaserun.com';
const F = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const P = (t: string) => `<p style="margin:0 0 16px;${F};font-size:16px;line-height:24px;color:#1e293b">${t}</p>`;
const btn = (href: string, label: string, bg = '#0f2c59') => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px"><tr><td bgcolor="${bg}" style="background-color:${bg};border-radius:999px"><a href="${esc(href)}" style="display:inline-block;padding:13px 26px;${F};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${label}</a></td></tr></table>`;
const box = (rows: [string, string][]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F1F5F9" style="background-color:#f1f5f9;border-radius:12px;margin:0 0 18px"><tr><td style="padding:14px 18px">${rows.map(([k, v]) => `<p style="margin:0 0 6px;${F};font-size:14px;line-height:21px;color:#334155"><strong style="color:#0f2c59">${esc(k)}:</strong> ${v}</p>`).join('')}</td></tr></table>`;
const first = (n: string) => esc(n.trim().split(/\s+/)[0] || n);
export const manageUrl = (b: Booking) => `${SITE}/termin?b=${encodeURIComponent(b.token)}`;

function content(kind: Booking['status'], b: Booking): { subject: string; body: string } {
  const when = esc(berlinLabel(new Date(b.starts_at)));
  const dur = Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000);
  const facts = box([['Termin', when], ['Dauer', `${dur} Minuten`], ['Thema', esc(b.topic || 'Gespräch')], ['Ort', kind === 'bestaetigt' && b.teams_url ? 'Microsoft Teams (online)' : 'Online per Microsoft Teams']]);
  const hi = P(`Hallo ${first(b.name)},`);
  if (kind === 'angefragt') return { subject: `Ihre Terminanfrage bei LeaseRun – ${berlinLabel(new Date(b.starts_at))}`, body: hi + P('vielen Dank für Ihre Terminanfrage. Wir prüfen sie und melden uns in Kürze mit der Bestätigung und dem Microsoft-Teams-Link.') + facts + btn(manageUrl(b), 'Anfrage ansehen oder absagen') };
  if (kind === 'bestaetigt') return { subject: `Termin bestätigt: ${berlinLabel(new Date(b.starts_at))}`, body: hi + P('Ihr Termin ist bestätigt – ich freue mich auf unser Gespräch. Den Kalendereintrag finden Sie im Anhang – einfach öffnen und in Ihren Kalender übernehmen.') + facts
    + (b.teams_url ? btn(b.teams_url, 'An Teams-Besprechung teilnehmen', '#5059c9') + P('<span style="font-size:13px;color:#64748b">Kein Teams installiert? Der Link öffnet die Besprechung auch direkt im Browser.</span>') : '')
    + P(`Sie können nicht? <a href="${esc(manageUrl(b))}" style="color:#0284c7">Termin absagen oder neu buchen</a>.`) };
  if (kind === 'abgelehnt') return { subject: 'Ihre Terminanfrage bei LeaseRun', body: hi + P('leider passt der gewünschte Termin nicht.') + (b.note ? P(esc(b.note).replace(/\n/g, '<br>')) : '') + P('Bitte wählen Sie einfach einen anderen freien Termin:') + btn(`${SITE}/termin`, 'Neuen Termin wählen') };
  return { subject: `Termin abgesagt: ${berlinLabel(new Date(b.starts_at))}`, body: hi + P('der folgende Termin wurde abgesagt.') + facts + (b.note ? P(esc(b.note).replace(/\n/g, '<br>')) : '') + P('Gern können Sie jederzeit einen neuen Termin wählen:') + btn(`${SITE}/termin`, 'Neuen Termin wählen') };
}

export async function sendBookingMail(kind: Booking['status'], b: Booking): Promise<boolean> {
  const { subject, body } = content(kind, b);
  const html = wrapDocument(subject, renderBrief({ body, unsubUrl: null }), htmlToText(body).slice(0, 140));
  // Kalendereintrag immer im Anhang (Microsoft verschickt keine eigene Einladung an den Gast).
  const files = (kind === 'bestaetigt' || kind === 'abgesagt')
    ? [{ filename: kind === 'abgesagt' ? 'absage.ics' : 'termin-leaserun.ics', content_type: 'text/calendar; charset=utf-8', content: Buffer.from(icsFile({ uid: b.id, start: new Date(b.starts_at), end: new Date(b.ends_at), title: `LeaseRun: ${b.topic || 'Gespräch'}`, description: `Gespräch mit LeaseRun${b.teams_url ? `\nTeams: ${b.teams_url}` : ''}\nVerwalten: ${manageUrl(b)}`, url: b.teams_url, method: kind === 'abgesagt' ? 'CANCEL' : 'PUBLISH' })).toString('base64') }]
    : [];
  const r = await resendSend({ to: [b.email], subject, html, text: htmlToText(body), unsubUrl: null, files, idemKey: `booking-${b.id}-${kind}-${b.ms_event_id || ''}` , log: 'termin' });
  if (!r.ok) console.error('booking_mail', r.error);
  return r.ok;
}

export async function notifyAdmins(subject: string, text: string) {
  if (!mailConfigured()) return;
  for (const adm of [supportInbox()]) { await sendMail(adm, subject, `${text}\n\nIm Web-Admin öffnen:\n${SITE}/intern/web-admin#termine`).catch(() => false); }
}
