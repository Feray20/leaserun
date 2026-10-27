import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { guardSubmission } from '@/lib/security/antispam';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { anonymizedIpHash } from '@/lib/supabase/admin';
import { hasLink, mailToAllowed } from '@/lib/security/durable-limit';
import { logSecurity } from '@/lib/security/seclog';
import { billingEnabled, stripe } from '@/lib/billing/stripe';

// Kündigungsbutton nach § 312k BGB.
// Versand per E-Mail über Resend (https://resend.com), konfiguriert über:
//   RESEND_API_KEY      – API-Schlüssel
//   NOTIFY_FROM_EMAIL   – verifizierte Absenderadresse (Absendername wird immer „LeaseRun“)
//   CANCEL_TO_EMAIL     – Empfänger beim Betreiber (Standard: support@leaserun.com)

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
async function send(to: string, subject: string, text: string, title: string) {
  if (!(await sendMail(to, subject, text, [], { title }))) throw new Error('Mailversand fehlgeschlagen');
}

export async function POST(req: Request) {
  const ip = anonymizedIpHash(req) ?? 'x';
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
  const contract = clean(body.contract, 120) || 'LeaseRun-Abo';
  const type = body.type === 'ausserordentlich' ? 'außerordentlich' : 'ordentlich';
  const reason = clean(body.reason, 2000);
  if (!name || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Bitte Name und gültige E-Mail-Adresse angeben.' }, { status: 400 });
  }
  // Bot-/Fake-Abwehr (Kündigung ist eine Erklärung – fälschliche Blockade vermeiden; nur eindeutige Signale).
  const guard = await guardSubmission({ email, name, message: reason, website: body.website, ts: undefined, bucket: 'kuendigung' }); // Zeitstempel bewusst nicht prüfen: eine lange offene Seite darf eine Erklärung nie still verwerfen – nur das Bot-Feld zählt
  if (guard.action === 'drop') return NextResponse.json({ ok: true });
  if (guard.action === 'reject') return NextResponse.json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, { status: 400 });

  // Schutz vor Missbrauch als Mail-Relais: keine Links in Name/Vertrag, dauerhafte Grenze je Empfänger.
  if (hasLink(name) || hasLink(contract)) return NextResponse.json({ error: 'Bitte Name und Vertrag ohne Internetadressen angeben.' }, { status: 400 });
  if (!(await mailToAllowed('kuendigung', email))) { logSecurity('mail_abuse', `kuendigung:${ip}`, { detail: 'Grenze je Empfänger' }); return NextResponse.json({ error: 'Für diese Adresse sind heute schon Kündigungen eingegangen. Bitte bei Bedarf an support@leaserun.com schreiben.' }, { status: 429 }); }
  const to = process.env.CANCEL_TO_EMAIL || 'support@leaserun.com';
  if (!mailConfigured()) {
    return NextResponse.json(
      { error: 'Die Online-Kündigung ist gerade nicht erreichbar. Bitte kündigen Sie formlos per E-Mail an support@leaserun.com – das ist ebenso wirksam.' },
      { status: 503 },
    );
  }

  const receivedAt = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Berlin',
  }).format(new Date()) + ' Uhr (MEZ/MESZ)';

  // Konkretes Vertragsende (§ 312k Abs. 4 BGB): laufendes Abo zu dieser E-Mail bei Stripe suchen; es endet zum Ende des
  // bezahlten Monats. Das Datum steht nur in den E-Mails (Bestätigung geht an genau diese Adresse), nicht in der Antwort.
  let endDate = '';
  if (billingEnabled() && EMAIL_RE.test(email)) {
    try {
      const cs = await stripe().customers.list({ email, limit: 5 });
      for (const c of cs.data) {
        const subs = await stripe().subscriptions.list({ customer: c.id, status: 'active', limit: 5 });
        for (const sub of subs.data) {
          const end = (sub.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
          if (end) { endDate = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'Europe/Berlin' }).format(new Date(end * 1000)); break; }
        }
        if (endDate) break;
      }
    } catch (e) { console.warn('kuendigung_enddate', e instanceof Error ? e.message : e); }
  }

  const text = [
    'Kündigungserklärung',
    '',
    `Eingang: ${receivedAt}`,
    `Name: ${name}`,
    `E-Mail: ${email}`,
    `Vertrag: ${contract}`,
    `Art: ${type} Kündigung${type === 'ordentlich' ? ', zum nächstmöglichen Zeitpunkt' : ''}`,
    type === 'außerordentlich' ? `Vertragsende: mit sofortiger Wirkung, sofern ein wichtiger Grund vorliegt; andernfalls ${endDate ? `zum ${endDate}` : 'zum Ende des laufenden Abrechnungszeitraums'}` : endDate ? `Vertragsende: ${endDate} (Ende des laufenden Abrechnungszeitraums; bis dahin bleibt der Zugang bestehen)` : 'Vertragsende: zum Ende des laufenden Abrechnungszeitraums; das genaue Datum teilen wir Ihnen nach Prüfung umgehend mit',
    reason ? `Grund: ${reason}` : '',
  ].filter(Boolean).join('\n');

  try {
    await send(to, `Kündigung: ${contract} – ${name}`, text, 'Neue Kündigung');
    await send(email, 'Bestätigung Ihrer Kündigung bei LeaseRun',
      `Guten Tag ${name},\n\nwir haben Ihre Kündigung erhalten. Diese E-Mail ist Ihre Eingangsbestätigung.\n\n${text.replace(/\nGrund: [\s\S]*$/, '')}`, 'Ihre Kündigung ist eingegangen');
  } catch {
    return NextResponse.json(
      { error: 'Die Kündigung konnte nicht übermittelt werden. Bitte kündigen Sie per E-Mail an support@leaserun.com.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, receivedAt });
}
