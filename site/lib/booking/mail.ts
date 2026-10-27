import { esc, htmlToText, renderBrief, wrapDocument } from '@/lib/mail/template';
import { supportInbox } from '@/lib/notify/inbox';
import { mailboxAddress, resendSend } from '@/lib/mail/resend';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { guestLabel, icsFile } from '@/lib/booking/core';

// Status values stay as stored in the database (angefragt = requested, bestaetigt = confirmed, abgelehnt = declined, abgesagt = canceled).
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
export const manageUrl = (b: Booking) => `${SITE}/book?b=${encodeURIComponent(b.token)}`;
void mailboxAddress; void adminList;

// tz: the guest's time zone when known (right after the request); otherwise Eastern time with CT/MT/PT.
function content(kind: Booking['status'], b: Booking, tz?: string | null): { subject: string; body: string } {
  const label = guestLabel(new Date(b.starts_at), tz);
  const when = esc(label);
  const dur = Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000);
  const facts = box([['When', when], ['Length', `${dur} minutes`], ['Topic', esc(b.topic || 'Meeting')], ['Where', kind === 'bestaetigt' && b.teams_url ? 'Microsoft Teams (online)' : 'Online via Microsoft Teams']]);
  const hi = P(`Hi ${first(b.name)},`);
  const short = new Date(b.starts_at).toLocaleDateString('en-US', { timeZone: tz || 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
  if (kind === 'angefragt') return { subject: `Your meeting request with LeaseRun – ${short}`, body: hi + P('thanks for requesting a meeting. We will review it and get back to you shortly with a confirmation and the Microsoft Teams link.') + facts + btn(manageUrl(b), 'View or cancel your request') };
  if (kind === 'bestaetigt') return { subject: `Meeting confirmed: ${short}`, body: hi + P('your meeting is confirmed – looking forward to talking with you. The calendar invite is attached; just open it to add the meeting to your calendar.') + facts
    + (b.teams_url ? btn(b.teams_url, 'Join the Teams meeting', '#5059c9') + P('<span style="font-size:13px;color:#64748b">Don’t have Teams installed? The link also opens the meeting right in your browser.</span>') : '')
    + P(`Can’t make it? <a href="${esc(manageUrl(b))}" style="color:#0284c7">Cancel or book a new time</a>.`) };
  if (kind === 'abgelehnt') return { subject: 'Your meeting request with LeaseRun', body: hi + P('unfortunately, the time you requested doesn’t work for us.') + (b.note ? P(esc(b.note).replace(/\n/g, '<br>')) : '') + P('Please pick another open time:') + btn(`${SITE}/book`, 'Pick a new time') };
  return { subject: `Meeting canceled: ${short}`, body: hi + P('the following meeting has been canceled.') + facts + (b.note ? P(esc(b.note).replace(/\n/g, '<br>')) : '') + P('You’re welcome to pick a new time whenever it suits you:') + btn(`${SITE}/book`, 'Pick a new time') };
}

export async function sendBookingMail(kind: Booking['status'], b: Booking, tz?: string | null): Promise<boolean> {
  const { subject, body } = content(kind, b, tz);
  const html = wrapDocument(subject, renderBrief({ body, unsubUrl: null }), htmlToText(body).slice(0, 140));
  // Always attach the calendar entry (Microsoft does not send its own invitation to the guest).
  const files = (kind === 'bestaetigt' || kind === 'abgesagt')
    ? [{ filename: kind === 'abgesagt' ? 'cancellation.ics' : 'leaserun-meeting.ics', content_type: 'text/calendar; charset=utf-8', content: Buffer.from(icsFile({ uid: b.id, start: new Date(b.starts_at), end: new Date(b.ends_at), title: `LeaseRun: ${b.topic || 'Meeting'}`, description: `Meeting with LeaseRun${b.teams_url ? `\nTeams: ${b.teams_url}` : ''}\nManage: ${manageUrl(b)}`, url: b.teams_url, method: kind === 'abgesagt' ? 'CANCEL' : 'PUBLISH' })).toString('base64') }]
    : [];
  const r = await resendSend({ to: [b.email], subject, html, text: htmlToText(body), unsubUrl: null, files, idemKey: `booking-${b.id}-${kind}-${b.ms_event_id || ''}` , log: 'termin' });
  if (!r.ok) console.error('booking_mail', r.error);
  return r.ok;
}

export async function notifyAdmins(subject: string, text: string) {
  if (!mailConfigured()) return;
  for (const adm of [supportInbox()]) { await sendMail(adm, subject, `${text}\n\nOpen in the Web-Admin:\n${SITE}/internal/web-admin#termine`).catch(() => false); }
}
