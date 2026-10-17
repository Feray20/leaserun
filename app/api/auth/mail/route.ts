import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';
import { checkEmailShape, honeypotTripped } from '@/lib/security/antispam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Konto-E-Mails (Registrierung bestätigen, Passwort zurücksetzen, Bestätigung erneut senden) verschickt ImmoAdv selbst –
// im ImmoAdv-Design und mit Absender „ImmoAdv“. Supabase erzeugt nur den sicheren Einmal-Schlüssel (generateLink),
// verschickt selbst keine E-Mail. Der Link führt auf immoadv.de/auth/confirm; dort wird der Schlüssel eingelöst.
// Ohne eingerichteten Versand (RESEND_API_KEY, NOTIFY_FROM_EMAIL) antwortet die Route mit 503 – die Seite nutzt dann
// übergangsweise den Supabase-Versand.
const SITE = 'https://immoadv.de';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({
  action: z.enum(['signup', 'recover', 'resend']),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200).optional(),
  ref: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
  website: z.string().optional(),
  next: z.enum(['/b2b-portal']).optional(),
});
const confirmUrl = (hash: string, type: string, next?: string) => `${SITE}/auth/confirm?th=${encodeURIComponent(hash)}&type=${type}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
const DONE = { ok: true };

export async function POST(req: Request) {
  if (!mailConfigured() || !adminConfigured()) return j({ error: 'Versand nicht eingerichtet.', code: 'no_mail' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Bitte E-Mail-Adresse und Passwort prüfen.' }, 400);
  const { action, email, password, ref, website, next } = p.data;
  if (honeypotTripped(website)) return j(DONE);
  if (!allowRequest(`authmail:${ip}`, 8, 10 * 60_000) || !allowRequest(`authmail:${email}`, 4, 10 * 60_000)) {
    return j({ error: 'Zu viele Anfragen. Bitte einige Minuten warten.', code: 'over_request_rate_limit' }, 429);
  }
  const shape = checkEmailShape(email);
  if (!shape.ok) {
    const why = shape.reason === 'wegwerf' ? 'Bitte keine Wegwerf-E-Mail-Adresse verwenden.' : shape.reason === 'tippfehler' ? `Meinten Sie ${shape.suggestion}?` : 'Bitte eine gültige E-Mail-Adresse angeben.';
    return j({ error: why, suggestion: shape.suggestion }, 400);
  }
  const admin = supabaseAdmin().auth.admin;

  if (action === 'signup') {
    if (!password) return j({ error: 'Bitte ein Passwort mit mindestens 8 Zeichen wählen.', code: 'weak_password' }, 400);
    const { data, error } = await admin.generateLink({ type: 'signup', email, password, options: { redirectTo: `${SITE}/auth/login`, data: ref ? { partner_ref: ref } : undefined } });
    if (error) {
      // Konto existiert bereits: Hinweis per E-Mail an die Adresse (keine Auskunft auf der Seite, ob ein Konto besteht).
      if (/already|exists|registered/i.test(error.message)) {
        await sendMail(email, 'Sie haben bereits ein ImmoAdv-Konto',
          'Guten Tag,\n\njemand (vermutlich Sie) wollte mit dieser E-Mail-Adresse ein neues ImmoAdv-Konto anlegen. Für diese Adresse besteht bereits ein Konto.\n\nMelden Sie sich einfach an – oder setzen Sie Ihr Passwort zurück, falls Sie es vergessen haben.',
          [], { title: 'Ihr Konto besteht bereits', button: { label: 'Zur Anmeldung', url: `${SITE}/auth/login` }, note: `Passwort vergessen? ${SITE}/auth/forgot – Wenn Sie das nicht waren, können Sie diese E-Mail ignorieren.` });
        return j(DONE);
      }
      if (/password/i.test(error.message)) return j({ error: 'Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen mit Buchstaben und Zahlen wählen.', code: 'weak_password' }, 400);
      console.error('authmail_signup', error.message);
      return j({ error: 'Registrierung fehlgeschlagen. Bitte erneut versuchen.' }, 502);
    }
    const hash = data.properties?.hashed_token;
    if (!hash) return j({ error: 'Registrierung fehlgeschlagen.' }, 502);
    const ok = await sendMail(email, 'Bitte bestätigen Sie Ihre E-Mail-Adresse – ImmoAdv',
      'Willkommen bei ImmoAdv!\n\nBitte bestätigen Sie Ihre E-Mail-Adresse, damit wir Ihr Konto freischalten können. Danach können Sie sofort loslegen: Lernbereich, Rechner, RenditeRadar und BankReady.',
      [], { title: 'E-Mail-Adresse bestätigen', button: { label: 'E-Mail-Adresse bestätigen', url: confirmUrl(hash, 'signup', next) }, note: 'Der Link ist 24 Stunden gültig und kann nur einmal verwendet werden. Wenn Sie sich nicht registriert haben, ignorieren Sie diese E-Mail einfach.' });
    return ok ? j(DONE) : j({ error: 'Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.' }, 502);
  }

  if (action === 'recover') {
    const { data, error } = await admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${SITE}/auth/reset` } });
    // Gleiche Antwort, ob ein Konto besteht oder nicht (kein Rückschluss auf registrierte Adressen).
    if (error || !data.properties?.hashed_token) return j(DONE);
    await sendMail(email, 'Passwort zurücksetzen – ImmoAdv',
      'Guten Tag,\n\nSie haben angefordert, Ihr ImmoAdv-Passwort zurückzusetzen. Über den Knopf legen Sie ein neues Passwort fest.',
      [], { title: 'Neues Passwort festlegen', button: { label: 'Neues Passwort festlegen', url: confirmUrl(data.properties.hashed_token, 'recovery') }, note: 'Der Link ist nur kurze Zeit gültig und kann einmal verwendet werden. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail – Ihr Passwort bleibt unverändert.' });
    return j(DONE);
  }

  // resend: Bestätigung erneut senden (Anmeldelink bestätigt die Adresse zugleich).
  const { data, error } = await admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${SITE}/app/dashboard` } });
  if (error || !data.properties?.hashed_token) return j(DONE);
  await sendMail(email, 'Ihr Bestätigungslink – ImmoAdv',
    'Guten Tag,\n\nhier ist Ihr neuer Link. Er bestätigt Ihre E-Mail-Adresse und meldet Sie direkt bei ImmoAdv an.',
    [], { title: 'E-Mail-Adresse bestätigen', button: { label: 'Bestätigen und anmelden', url: confirmUrl(data.properties.hashed_token, 'magiclink') }, note: 'Der Link ist nur kurze Zeit gültig und kann einmal verwendet werden.' });
  return j(DONE);
}
