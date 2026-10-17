import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { createB2BLogin } from '@/lib/b2b/provision';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin: Privatkonto (B2C) mit Startpasswort anlegen, z. B. für Kunden, die telefonisch bestellen.
// Das Startpasswort wird einmalig angezeigt; bei der ersten Anmeldung muss der Kunde ein eigenes Passwort festlegen.
// Es wird kein Tarif freigeschaltet – gebucht wird wie üblich über die Bezahlseite.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  sendMail: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: String(p.error.issues[0]?.path[0]) === 'email' ? 'Bitte eine gültige E-Mail-Adresse angeben.' : 'Bitte den Namen angeben.' }, 400);
  const b = p.data;
  const login = await createB2BLogin(b.email, b.name, 'app');
  if (!login.ok) return j({ error: login.error }, login.status);
  await adminAudit(auth.user.email, 'user_create', login.userId, { mailed: b.sendMail });
  let mailed = false;
  if (b.sendMail && mailConfigured()) {
    mailed = await sendMail(b.email, 'Ihr ImmoAdv-Konto ist eingerichtet',
      `Guten Tag ${b.name},\n\nIhr persönliches ImmoAdv-Konto ist eingerichtet.\n\nAnmeldung: https://immoadv.de/auth/login\nBenutzername: ${b.email}\nStartpasswort: ${login.password}\n\nBei der ersten Anmeldung legen Sie ein eigenes Passwort fest. Das Startpasswort ist danach ungültig.`,
      [], { title: 'Ihr Konto ist eingerichtet', button: { label: 'Jetzt anmelden', url: 'https://immoadv.de/auth/login' }, note: 'Bitte geben Sie das Startpasswort nicht weiter. Fragen: support@immoadv.de' });
  }
  return j({ ok: true, email: b.email, password: login.password, mailed });
}
