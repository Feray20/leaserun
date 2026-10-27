import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';
import { checkEmailShape, honeypotTripped } from '@/lib/security/antispam';
import { authApi, creatorAuthEmail, isCreatorAuthEmail, sessionFor } from '@/lib/creator/identity';
import { logSecurity } from '@/lib/security/seclog';
import { durableAllow, keyOf } from '@/lib/security/durable-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Anmeldung im Creator-Bereich – eigene Konten, getrennt von Kundenbereich und Unternehmensportal (siehe lib/creator/identity).
// Die Seite schickt die echte E-Mail-Adresse; der Server arbeitet mit der internen Kennung des Creator-Kontos.
//   login   – E-Mail + Passwort → Sitzung
//   signup  – Konto anlegen; Bestätigungslink geht an die echte Adresse
//   recover – Link zum Zurücksetzen des Passworts an die echte Adresse
//   oauth   – nach „Weiter mit Google/Apple/Microsoft“: eigenes Creator-Konto zur bestätigten Adresse holen/anlegen → Sitzung
const SITE = 'https://leaserun.com';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const DONE = { ok: true };
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) }),
  z.object({ action: z.literal('signup'), email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(8).max(72), website: z.string().optional() }),
  z.object({ action: z.literal('recover'), email: z.string().trim().toLowerCase().email().max(200) }),
  z.object({ action: z.literal('oauth'), access_token: z.string().min(20).max(4000) }),
]);
const confirmUrl = (hash: string, type: string) => `${SITE}/auth/confirm?th=${encodeURIComponent(hash)}&type=${type}&next=%2Fcreator`;

export async function POST(req: Request) {
  if (!adminConfigured()) return j({ error: 'Nicht verfügbar.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    return j({ error: f === 'password' ? 'Bitte ein Passwort mit mindestens 8 Zeichen wählen.' : 'Bitte E-Mail-Adresse und Passwort prüfen.' }, 400);
  }
  const b = p.data;
  const admin = supabaseAdmin().auth.admin;

  if (b.action === 'login') {
    if (!allowRequest(`crlogin:${ip}`, 20, 10 * 60_000) || !allowRequest(`crlogin:${b.email}`, 10, 10 * 60_000)) return j({ error: 'Zu viele Anmeldeversuche. Bitte einige Minuten warten.' }, 429);
    // Dauerhafte Grenze über alle Server hinweg: je Konto 15 Fehlversuche pro Stunde (Schutz gegen Passwort-Raten).
    if (!(await durableAllow(`crlogin:${keyOf(b.email)}`, 3600, 15))) return j({ error: 'Zu viele Anmeldeversuche für dieses Konto. Bitte in einer Stunde erneut versuchen oder das Passwort zurücksetzen.' }, 429);
    const r = await authApi('/token?grant_type=password', { email: creatorAuthEmail(b.email), password: b.password });
    if (!r.ok) {
      logSecurity('login_flood', `crlogin:${ip}`, { ipHash: ip === 'x' ? null : ip, detail: 'Anmeldung Creator-Bereich' });
      const msg = String(r.data.error_description || r.data.msg || '');
      if (/not confirmed/i.test(msg)) return j({ error: 'Bitte bestätige zuerst deine E-Mail-Adresse über den Link in unserer E-Mail.', code: 'not_confirmed' }, 400);
      return j({ error: 'Falsche Anmeldedaten: E-Mail oder Passwort stimmt nicht. Hinweis: Der Creator-Bereich hat eigene Konten – ein Konto aus dem Kundenbereich oder Unternehmensportal gilt hier nicht.', code: 'invalid' }, 400);
    }
    return j({ session: r.data });
  }

  if (!mailConfigured()) return j({ error: 'Der E-Mail-Versand ist noch nicht eingerichtet.', code: 'no_mail' }, 503);
  if (b.action !== 'oauth' && (!allowRequest(`crmail:${ip}`, 8, 10 * 60_000) || !allowRequest(`crmail:${b.email}`, 4, 10 * 60_000))) {
    return j({ error: 'Zu viele Anfragen. Bitte einige Minuten warten.' }, 429);
  }

  if (b.action === 'signup') {
    if (honeypotTripped(b.website)) return j(DONE);
    const shape = checkEmailShape(b.email);
    if (!shape.ok) return j({ error: shape.reason === 'wegwerf' ? 'Bitte keine Wegwerf-E-Mail-Adresse verwenden.' : shape.reason === 'tippfehler' ? `Meintest du ${shape.suggestion}?` : 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
    const { data, error } = await admin.generateLink({ type: 'signup', email: creatorAuthEmail(b.email), password: b.password, options: { data: { area: 'creator', contact_email: b.email } } });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) {
        await sendMail(b.email, 'Du hast bereits ein Creator-Konto',
          'Hallo,\n\nmit dieser E-Mail-Adresse wollte sich gerade jemand neu als Creator registrieren, vermutlich du. Ein Konto gibt es dafür schon.\n\nMelde dich einfach an. Falls du das Passwort nicht mehr weißt, kannst du es zurücksetzen.',
          [], { title: 'Dein Creator-Konto besteht bereits', button: { label: 'Zur Anmeldung', url: `${SITE}/creator/anmelden` }, note: 'Wenn du das nicht warst, kannst du diese E-Mail ignorieren.' }).catch(() => false);
        return j(DONE);
      }
      if (/password/i.test(error.message)) return j({ error: 'Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen mit Buchstaben und Zahlen wählen.' }, 400);
      console.error('creator_signup', error.message);
      return j({ error: 'Registrierung fehlgeschlagen. Bitte erneut versuchen.' }, 502);
    }
    const hash = data.properties?.hashed_token;
    if (!hash) return j({ error: 'Registrierung fehlgeschlagen.' }, 502);
    const ok = await sendMail(b.email, 'Bitte bestätige deine E-Mail-Adresse – LeaseRun Creator',
      'Hallo,\n\nbitte bestätige kurz deine E-Mail-Adresse. Danach kannst du direkt deine Bewerbung ausfüllen.',
      [], { title: 'E-Mail-Adresse bestätigen', button: { label: 'E-Mail-Adresse bestätigen', url: confirmUrl(hash, 'signup') }, note: 'Der Link ist 24 Stunden gültig und kann nur einmal verwendet werden. Wenn du dich nicht registriert hast, ignoriere diese E-Mail einfach.' }).catch(() => false);
    return ok ? j(DONE) : j({ error: 'Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.' }, 502);
  }

  if (b.action === 'recover') {
    const { data, error } = await admin.generateLink({ type: 'recovery', email: creatorAuthEmail(b.email) });
    // Keine Auskunft, ob ein Konto besteht.
    if (error || !data.properties?.hashed_token) return j(DONE);
    await sendMail(b.email, 'Passwort zurücksetzen – LeaseRun Creator',
      'Hallo,\n\ndu hast ein neues Passwort für deinen LeaseRun Creator-Zugang angefordert.',
      [], { title: 'Neues Passwort festlegen', button: { label: 'Neues Passwort festlegen', url: confirmUrl(data.properties.hashed_token, 'recovery') }, note: 'Der Link ist nur kurze Zeit gültig und kann nur einmal verwendet werden. Wenn du das nicht angefordert hast, ignoriere diese E-Mail.' }).catch(() => false);
    return j(DONE);
  }

  // oauth: Konto beim Anbieter (Google & Co.) ist bestätigt → eigenes Creator-Konto zu dieser Adresse holen oder anlegen.
  if (!allowRequest(`croauth:${ip}`, 20, 10 * 60_000)) return j({ error: 'Zu viele Anfragen. Bitte einige Minuten warten.' }, 429);
  const { data: who, error: werr } = await supabaseAdmin().auth.getUser(b.access_token);
  const ext = who?.user;
  // Sicherheit: Nur echte Anmeldungen bei Apple, Google oder Microsoft zählen – und nur die vom Anbieter bestätigte
  // Login-Adresse. user_metadata (z. B. contact_email) kann jeder Nutzer selbst ändern und wird hier nie verwendet,
  // sonst könnte ein beliebiges Kundenkonto ein fremdes Creator-Konto übernehmen.
  const provider = String(ext?.app_metadata?.provider || '');
  const providers = Array.isArray(ext?.app_metadata?.providers) ? (ext?.app_metadata?.providers as string[]) : [provider];
  const viaSso = ['apple', 'google', 'azure'].includes(provider) && providers.some((p) => ['apple', 'google', 'azure'].includes(p));
  if (werr || !ext?.email || isCreatorAuthEmail(ext.email) || !ext.email_confirmed_at || !viaSso) {
    if (ext && !viaSso) logSecurity('creator_oauth_reject', `croauth:${ip}`, { detail: `Anbieter ${provider || 'keiner'}` });
    return j({ error: 'Die Anmeldung konnte nicht bestätigt werden. Bitte erneut versuchen.' }, 401);
  }
  const real = ext.email.toLowerCase();
  const authEmail = creatorAuthEmail(real);
  const created = await admin.createUser({ email: authEmail, email_confirm: true, password: randomBytes(24).toString('base64url'), user_metadata: { area: 'creator', contact_email: real, oauth_provider: provider } });
  if (created.error && !/already|exists|registered/i.test(created.error.message)) {
    console.error('creator_oauth_create', created.error.message);
    return j({ error: 'Creator-Konto konnte nicht angelegt werden.' }, 502);
  }
  const session = await sessionFor(authEmail);
  if (!session) return j({ error: 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.' }, 502);
  // Die Anbieter-Sitzung wird nicht weiter gebraucht (sie gehört nicht zum Creator-Bereich).
  await authApi('/logout?scope=local', {}, b.access_token).catch(() => null);
  // Hat erst diese Anmeldung das Anbieter-Konto angelegt (kein Kunden- oder Unternehmenskonto), wird es wieder entfernt –
  // so entsteht durch „Weiter mit Google“ im Creator-Bereich kein Konto in den anderen Portalen.
  try {
    const fresh = Date.now() - new Date(ext.created_at).getTime() < 3 * 60_000 && !ext.user_metadata?.area;
    if (fresh) {
      const db = supabaseAdmin();
      const [m, d] = await Promise.all([
        db.from('lr_b2b_members').select('user_id').eq('user_id', ext.id).maybeSingle(),
        db.from('lr_user_data').select('user_id').eq('user_id', ext.id).maybeSingle(),
      ]);
      if (!m.data && !d.data) await admin.deleteUser(ext.id);
    }
  } catch (e) { console.warn('creator_oauth_cleanup', e instanceof Error ? e.message : e); }
  return j({ session });
}
