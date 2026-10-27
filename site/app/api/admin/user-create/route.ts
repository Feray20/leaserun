import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { createB2BLogin } from '@/lib/b2b/provision';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin: Privatkonto (B2C) mit Startpasswort anlegen, z. B. für Kunden, die telefonisch bestellen.
// Passwort: vom Admin gewählt oder automatisch erzeugt (einmalig angezeigt). Zugriff: optional sofort freischalten
// (Käufer-Pass oder Investor Pro, Kreditmappen, Leitfaden) – gespeichert wie die manuelle Freischaltung (lr_access_grants).
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  sendMail: z.boolean().optional().default(false),
  password: z.string().max(72).optional().nullable(),
  mustChange: z.boolean().optional().default(true),
  access: z.object({
    tier: z.enum(['free', 'starter', 'pro']).default('free'),
    creditMaps: z.number().int().min(0).max(1000).default(0),
    leitfaden: z.boolean().default(false),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).optional(),
});

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: String(p.error.issues[0]?.path[0]) === 'email' ? 'Bitte eine gültige E-Mail-Adresse angeben.' : 'Bitte den Namen angeben.' }, 400);
  const b = p.data;
  const login = await createB2BLogin(b.email, b.name, 'app', { password: b.password, mustChange: b.mustChange });
  if (!login.ok) return j({ error: login.error }, login.status);
  const acc = b.access;
  if (acc && acc.tier !== 'free') {
    const r = await supabaseAdmin().from('lr_access_grants').upsert({
      user_id: login.userId, tier: acc.tier, credit_maps: acc.creditMaps, leitfaden: acc.leitfaden,
      valid_until: acc.validUntil ? `${acc.validUntil}T23:59:59+01:00` : null, note: 'Bei Anlage durch LeaseRun freigeschaltet', granted_by: auth.user.email, updated_at: new Date().toISOString(),
    });
    if (r.error) console.error('admin_user_create_grant', r.error.message);
  }
  await adminAudit(auth.user.email, 'user_create', login.userId, { mailed: b.sendMail, ownPassword: Boolean(b.password), access: acc?.tier || 'free', credits: acc?.creditMaps || 0 });
  let mailed = false;
  if (b.sendMail && mailConfigured()) {
    mailed = await sendMail(b.email, 'Ihr LeaseRun-Konto ist eingerichtet',
      `Guten Tag ${b.name},\n\nIhr persönliches LeaseRun-Konto ist eingerichtet.\n\nAnmeldung: https://leaserun.com/auth/login\nBenutzername: ${b.email}\nPasswort: ${login.password}\n\n${b.password && !b.mustChange ? 'Sie können das Passwort jederzeit in Ihrem Konto ändern.' : 'Bei der ersten Anmeldung legen Sie ein eigenes Passwort fest. Das Startpasswort ist danach ungültig.'}`,
      [], { title: 'Ihr Konto ist eingerichtet', button: { label: 'Jetzt anmelden', url: 'https://leaserun.com/auth/login' }, note: 'Bitte geben Sie das Startpasswort nicht weiter. Fragen: support@leaserun.com' });
  }
  return j({ ok: true, email: b.email, password: login.password, mailed, access: acc?.tier || 'free' });
}
