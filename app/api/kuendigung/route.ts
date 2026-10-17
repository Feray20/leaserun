import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { guardSubmission } from '@/lib/security/antispam';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

// Kündigungsbutton nach § 312k BGB.
// Versand per E-Mail über Resend (https://resend.com), konfiguriert über:
//   RESEND_API_KEY      – API-Schlüssel
//   NOTIFY_FROM_EMAIL   – verifizierte Absenderadresse (Absendername wird immer „ImmoAdv“)
//   CANCEL_TO_EMAIL     – Empfänger beim Betreiber (Standard: support@immoadv.de)

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
async function send(to: string, subject: string, text: string, title: string) {
  if (!(await sendMail(to, subject, text, [], { title }))) throw new Error('Mailversand fehlgeschlagen');
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!allowRequest(`kuendigung:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Zu viele Anfragen. Bitte in einer Minute erneut versuchen.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const contract = clean(body.contract, 120) || 'ImmoAdv-Abo';
  const type = body.type === 'ausserordentlich' ? 'außerordentlich' : 'ordentlich';
  const reason = clean(body.reason, 2000);
  if (!name || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Bitte Name und gültige E-Mail-Adresse angeben.' }, { status: 400 });
  }
  // Bot-/Fake-Abwehr (Kündigung ist eine Erklärung – fälschliche Blockade vermeiden; nur eindeutige Signale).
  const guard = await guardSubmission({ email, name, message: reason, website: body.website, ts: body.ts, bucket: 'kuendigung' });
  if (guard.action === 'drop') return NextResponse.json({ ok: true });
  if (guard.action === 'reject') return NextResponse.json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, { status: 400 });

  const to = process.env.CANCEL_TO_EMAIL || 'support@immoadv.de';
  if (!mailConfigured()) {
    return NextResponse.json(
      { error: 'Die Online-Kündigung ist gerade nicht erreichbar. Bitte kündigen Sie formlos per E-Mail an support@immoadv.de – das ist ebenso wirksam.' },
      { status: 503 },
    );
  }

  const receivedAt = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Berlin',
  }).format(new Date()) + ' Uhr (MEZ/MESZ)';

  const text = [
    'Kündigungserklärung',
    '',
    `Eingang: ${receivedAt}`,
    `Name: ${name}`,
    `E-Mail: ${email}`,
    `Vertrag: ${contract}`,
    `Art: ${type} Kündigung, zum nächstmöglichen Zeitpunkt`,
    reason ? `Grund: ${reason}` : '',
  ].filter(Boolean).join('\n');

  try {
    await send(to, `Kündigung: ${contract} – ${name}`, text, 'Neue Kündigung');
    await send(email, 'Bestätigung Ihrer Kündigung bei ImmoAdv',
      `Guten Tag ${name},\n\nwir haben Ihre Kündigung erhalten. Diese E-Mail ist Ihre Eingangsbestätigung.\n\n${text}`, 'Ihre Kündigung ist eingegangen');
  } catch {
    return NextResponse.json(
      { error: 'Die Kündigung konnte nicht übermittelt werden. Bitte kündigen Sie per E-Mail an support@immoadv.de.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, receivedAt });
}
