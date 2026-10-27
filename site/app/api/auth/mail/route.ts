import { NextResponse } from 'next/server';
import { mailToAllowed } from '@/lib/security/durable-limit';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';
import { checkEmailShape, honeypotTripped } from '@/lib/security/antispam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Konto-E-Mails (Registrierung bestätigen, Passwort zurücksetzen, Bestätigung erneut senden) verschickt LeaseRun selbst –
// im LeaseRun-Design und mit Absender „LeaseRun“. Supabase erzeugt nur den sicheren Einmal-Schlüssel (generateLink),
// verschickt selbst keine E-Mail. Der Link führt auf leaserun.com/auth/confirm; dort wird der Schlüssel eingelöst.
// Ohne eingerichteten Versand (RESEND_API_KEY, NOTIFY_FROM_EMAIL) antwortet die Route mit 503 – die Seite nutzt dann
// übergangsweise den Supabase-Versand.
const SITE = 'https://leaserun.com';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({
  action: z.enum(['signup', 'recover', 'resend', 'magic']),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200).optional(),
  ref: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
  campaign: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
  website: z.string().optional(),
  next: z.enum(['/business-portal', '/creators']).optional(),
});
const confirmUrl = (hash: string, type: string, next?: string) => `${SITE}/auth/confirm?th=${encodeURIComponent(hash)}&type=${type}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
const DONE = { ok: true };

export async function POST(req: Request) {
  if (!mailConfigured() || !adminConfigured()) return j({ error: 'Versand nicht eingerichtet.', code: 'no_mail' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Bitte E-Mail-Adresse und Passwort prüfen.' }, 400);
  const { action, email, password, ref, campaign, website, next } = p.data;
  // Unternehmensportal und Privatkundenbereich sind getrennt: eigene Texte, eigener Absender, Links ins jeweilige Portal.
  const biz = next === '/business-portal';
  const area = biz ? 'b2b' as const : 'b2c' as const;
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
    const { data, error } = await admin.generateLink({ type: 'signup', email, password, options: { redirectTo: `${SITE}/auth/login`, data: ref ? { partner_ref: ref, ...(campaign ? { partner_campaign: campaign } : {}) } : undefined } });
    if (error) {
      // Konto existiert bereits: Hinweis per E-Mail an die Adresse (keine Auskunft auf der Seite, ob ein Konto besteht).
      if (/already|exists|registered/i.test(error.message)) {
        await sendMail(email, 'Sie haben bereits ein LeaseRun-Konto',
          'Guten Tag,\n\nmit dieser E-Mail-Adresse wollte sich gerade jemand neu registrieren, vermutlich Sie. Ein Konto gibt es dafür schon.\n\nMelden Sie sich einfach an. Falls Sie das Passwort nicht mehr wissen, können Sie es zurücksetzen.',
          [], { area, title: 'Ihr Konto besteht bereits', button: { label: 'Zur Anmeldung', url: biz ? `${SITE}/b2b-portal` : `${SITE}/auth/login` }, note: `Passwort vergessen? ${SITE}/auth/forgot${biz ? '?bereich=b2b' : ''} – Wenn Sie das nicht waren, können Sie diese E-Mail ignorieren.` });
        return j(DONE);
      }
      if (/password/i.test(error.message)) return j({ error: 'Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen mit Buchstaben und Zahlen wählen.', code: 'weak_password' }, 400);
      console.error('authmail_signup', error.message);
      return j({ error: 'Registrierung fehlgeschlagen. Bitte erneut versuchen.' }, 502);
    }
    const hash = data.properties?.hashed_token;
    if (!hash) return j({ error: 'Registrierung fehlgeschlagen.' }, 502);
    // Creator-Link: Kundenkonto dem Creator zuordnen (nie blockierend).
    if (ref && data.user?.id) await import('@/lib/creator/attribution').then((x) => x.recordSignupAttribution(data.user!.id, ref, campaign)).catch((e) => console.warn('creator_attribution', e instanceof Error ? e.message : e));
    const ok = await sendMail(email, biz ? 'Bitte bestätigen Sie Ihre E-Mail-Adresse – LeaseRun Unternehmensportal' : 'Bitte bestätigen Sie Ihre E-Mail-Adresse – LeaseRun',
      biz ? 'Guten Tag,\n\nbitte bestätigen Sie kurz Ihre E-Mail-Adresse. Danach richten Sie Ihr Unternehmenskonto ein; Sie brauchen dafür Ihre Firmendaten und den Gewerbenachweis.'
        : 'Guten Tag,\n\nbitte bestätigen Sie kurz Ihre E-Mail-Adresse. Danach ist Ihr Konto freigeschaltet und Sie können direkt Ihr erstes Objekt durchrechnen.',
      [], { area, title: 'E-Mail-Adresse bestätigen', button: { label: 'E-Mail-Adresse bestätigen', url: confirmUrl(hash, 'signup', next) }, note: 'Der Link ist 24 Stunden gültig und kann nur einmal verwendet werden. Wenn Sie sich nicht registriert haben, ignorieren Sie diese E-Mail einfach.' });
    return ok ? j(DONE) : j({ error: 'Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.' }, 502);
  }

  if (action === 'recover') {
    const { data, error } = await admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${SITE}/auth/reset` } });
    // Gleiche Antwort, ob ein Konto besteht oder nicht (kein Rückschluss auf registrierte Adressen).
    if (error || !data.properties?.hashed_token) return j(DONE);
    await sendMail(email, biz ? 'Passwort zurücksetzen – LeaseRun Unternehmensportal' : 'Passwort zurücksetzen – LeaseRun',
      biz ? 'Guten Tag,\n\nSie möchten Ihr Passwort für das LeaseRun-Unternehmensportal zurücksetzen. Mit dem Button unten legen Sie ein neues fest und sind danach direkt im Portal.'
        : 'Guten Tag,\n\nSie möchten Ihr LeaseRun-Passwort zurücksetzen. Mit dem Button unten legen Sie ein neues fest.',
      [], { area, title: 'Neues Passwort festlegen', button: { label: 'Neues Passwort festlegen', url: confirmUrl(data.properties.hashed_token, 'recovery', next) }, note: 'Der Link ist nur kurze Zeit gültig und kann einmal verwendet werden. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail – Ihr Passwort bleibt unverändert.' });
    return j(DONE);
  }

  // magic: Anmeldung ohne Passwort per Einmal-Link – nur für bestehende Konten (kein Konto ohne Registrierung und AGB).
  if (action === 'magic') {
    const { data, error } = await admin.generateLink({ type: 'magiclink', email, options: { redirectTo: biz ? `${SITE}/b2b-portal` : `${SITE}/app/dashboard` } });
    if (error || !data.properties?.hashed_token) return j(DONE);
    const u = data.user;
    // Falls Supabase dabei ein neues Konto angelegt hat: sofort wieder entfernen und nichts senden (gleiche Antwort für alle Adressen).
    if (u && !u.last_sign_in_at && !u.email_confirmed_at && Date.now() - new Date(u.created_at).getTime() < 5_000) { await admin.deleteUser(u.id).catch(() => null); return j(DONE); }
    await sendMail(email, biz ? 'Ihr Anmeldelink – LeaseRun Unternehmensportal' : 'Ihr Anmeldelink – LeaseRun',
      biz ? 'Guten Tag,\n\nhier ist Ihr Anmeldelink für das LeaseRun-Unternehmensportal. Ein Klick, und Sie sind angemeldet.' : 'Guten Tag,\n\nhier ist Ihr Anmeldelink für LeaseRun. Ein Klick, und Sie sind angemeldet.',
      [], { area, title: 'Jetzt anmelden', button: { label: 'Bei LeaseRun anmelden', url: confirmUrl(data.properties.hashed_token, 'magiclink', next) }, note: 'Der Link ist nur kurze Zeit gültig und kann einmal verwendet werden. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail – Ihr Konto bleibt geschützt.' });
    return j(DONE);
  }

  // resend: Bestätigung erneut senden (Anmeldelink bestätigt die Adresse zugleich).
  const { data, error } = await admin.generateLink({ type: 'magiclink', email, options: { redirectTo: biz ? `${SITE}/b2b-portal` : `${SITE}/app/dashboard` } });
  if (error || !data.properties?.hashed_token) return j(DONE);
  // Wie bei „magic“: Hat Supabase dabei erst ein Konto angelegt, sofort entfernen und nichts senden – kein Konto ohne Registrierung.
  { const u = data.user; if (u && !u.last_sign_in_at && !u.email_confirmed_at && Date.now() - new Date(u.created_at).getTime() < 5_000) { await admin.deleteUser(u.id).catch(() => null); return j(DONE); } }
  if (!(await mailToAllowed('auth-resend', email))) return j(DONE);
  await sendMail(email, biz ? 'Ihr Bestätigungslink – LeaseRun Unternehmensportal' : 'Ihr Bestätigungslink – LeaseRun',
    biz ? 'Guten Tag,\n\nhier ist Ihr neuer Link. Er bestätigt Ihre E-Mail-Adresse und meldet Sie direkt im Unternehmensportal an.' : 'Guten Tag,\n\nhier ist Ihr neuer Link. Er bestätigt Ihre E-Mail-Adresse und meldet Sie direkt bei LeaseRun an.',
    [], { area, title: 'E-Mail-Adresse bestätigen', button: { label: 'Bestätigen und anmelden', url: confirmUrl(data.properties.hashed_token, 'magiclink', next) }, note: 'Der Link ist nur kurze Zeit gültig und kann einmal verwendet werden.' });
  return j(DONE);
}
