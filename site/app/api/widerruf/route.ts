import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { guardSubmission } from '@/lib/security/antispam';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { anonymizedIpHash } from '@/lib/supabase/admin';
import { hasLink, mailToAllowed } from '@/lib/security/durable-limit';
import { logSecurity } from '@/lib/security/seclog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Widerrufsfunktion nach § 356a BGB (seit 19.06.2026): Widerruf ohne Anmeldung; Eingangsbestätigung mit Inhalt
// und Zeitpunkt unverzüglich auf einem dauerhaften Datenträger (E-Mail). Es wird kein Grund abgefragt.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`widerruf:${ip}`, 5, 60_000)) return j({ error: 'Zu viele Anfragen. Bitte in einer Minute erneut versuchen.' }, 429);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return j({ error: 'Ungültige Anfrage.' }, 400);
  const name = clean(body.name, 120), email = clean(body.email, 200).toLowerCase();
  const contract = clean(body.contract, 120) || 'LeaseRun-Vertrag', ref = clean(body.ref, 80);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(clean(body.date, 10)) ? clean(body.date, 10) : '';
  if (name.length < 2 || !EMAIL_RE.test(email)) return j({ error: 'Bitte Name und gültige E-Mail-Adresse angeben.' }, 400);
  // Widerruf ist eine Erklärung: nur eindeutige Bot-Signale verwerfen, nie wegen Inhalt ablehnen.
  const guard = await guardSubmission({ email, name, message: '', website: body.website, ts: undefined, bucket: 'widerruf' }); // Zeitstempel bewusst nicht prüfen: eine lange offene Seite darf eine Erklärung nie still verwerfen – nur das Bot-Feld zählt
  if (guard.action === 'drop') return j({ ok: true, receivedAt: '' });
  if (!mailConfigured()) return j({ error: 'Die Online-Widerrufsfunktion ist gerade nicht erreichbar. Bitte widerrufen Sie formlos per E-Mail an support@leaserun.com – das ist ebenso wirksam.' }, 503);

  const receivedAt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Berlin' }).format(new Date()) + ' Uhr (MEZ/MESZ)';
  const text = [
    'Widerrufserklärung',
    '',
    'Hiermit widerrufe ich den von mir abgeschlossenen Vertrag.',
    '',
    `Eingang: ${receivedAt}`,
    `Name: ${name}`,
    `E-Mail: ${email}`,
    `Vertrag: ${contract}`,
    ref ? `Rechnungs-/Bestellnummer: ${ref}` : '',
    date ? `Bestellt am: ${new Date(date + 'T12:00:00Z').toLocaleDateString('de-DE')}` : '',
  ].filter(Boolean).join('\n');
  if (hasLink(name) || hasLink(contract) || hasLink(ref)) return j({ error: 'Bitte die Angaben ohne Internetadressen eintragen.' }, 400);
  if (!(await mailToAllowed('widerruf', email))) { logSecurity('mail_abuse', `widerruf:${ip}`, { detail: 'Grenze je Empfänger' }); return j({ error: 'Für diese Adresse sind heute schon Widerrufe eingegangen. Bitte bei Bedarf an support@leaserun.com schreiben.' }, 429); }
  const to = process.env.CANCEL_TO_EMAIL || 'support@leaserun.com';
  try {
    if (!(await sendMail(to, `Widerruf: ${contract} – ${name}`, text, [], { title: 'Neuer Widerruf' }))) throw Error('mail');
    if (!(await sendMail(email, 'Eingangsbestätigung Ihres Widerrufs bei LeaseRun',
      `Guten Tag ${name},\n\nwir haben Ihren Widerruf erhalten. Diese E-Mail ist Ihre Eingangsbestätigung (§ 356a BGB); sie bestätigt den Eingang, nicht bereits die Prüfung des Widerrufs. Steht Ihnen ein Widerrufsrecht zu, erstatten wir bereits gezahlte Beträge nach den gesetzlichen Regeln unverzüglich, spätestens binnen 14 Tagen, über das ursprüngliche Zahlungsmittel.\n\n${text}`,
      [], { title: 'Ihr Widerruf ist eingegangen' }))) throw Error('mail');
  } catch {
    return j({ error: 'Der Widerruf konnte nicht übermittelt werden. Bitte widerrufen Sie per E-Mail an support@leaserun.com.' }, 502);
  }
  return j({ ok: true, receivedAt });
}
