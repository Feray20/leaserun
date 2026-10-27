import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit, j, requireCreatorAdmin, uniqueRefCode } from '@/lib/creator/server';
import { createB2BLogin } from '@/lib/b2b/provision';
import { creatorAuthEmail } from '@/lib/creator/identity';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → Creator Operations: Creator-Konto direkt anlegen (eigener Login für den Creator-Bereich).
// Zugriff:
//   APPLY  – der Creator meldet sich an und füllt die Bewerbung aus; danach wie gewohnt prüfen und freigeben.
//   ACTIVE – sofort freigeschaltet (persönlicher Link wird vergeben). Rechnungs- und Auszahlungsdaten ergänzt der
//            Creator im Portal; ohne sie gibt es keine Auszahlung.
// Passwort: vom Admin gewählt oder automatisch erzeugt (einmalig angezeigt). Anmeldung: https://leaserun.com/creators/anmelden
const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(2).max(80).optional().or(z.literal('')),
  password: z.string().max(72).optional().nullable(),
  access: z.enum(['APPLY', 'ACTIVE']).default('APPLY'),
  sendMail: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const a = await requireCreatorAdmin(req, 'creators.review');
  if (!('role' in a)) return a;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    const label: Record<string, string> = { email: 'E-Mail', firstName: 'Vorname', lastName: 'Nachname', displayName: 'Anzeigename (mind. 2 Zeichen)' };
    return j({ error: `Bitte „${label[f] || f}“ prüfen.`, field: f }, 400);
  }
  const b = p.data;
  const name = `${b.firstName} ${b.lastName}`;
  // Creator-Bereich hat keinen Zwang zur Passwortänderung beim ersten Login: Passwort ändern geht über „Passwort vergessen“.
  // Eigenes Creator-Konto (interne Kennung), unabhängig von Kunden- oder Unternehmenskonten mit derselben Adresse.
  const login = await createB2BLogin(creatorAuthEmail(b.email), name, 'creator', { password: b.password, mustChange: false, meta: { contact_email: b.email } });
  if (!login.ok) return j({ error: login.error }, login.status);

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const active = b.access === 'ACTIVE';
  const row: Record<string, unknown> = {
    user_id: login.userId, status: active ? 'ACTIVE' : 'DRAFT',
    first_name: b.firstName, last_name: b.lastName, display_name: b.displayName || name,
  };
  if (active) Object.assign(row, { ref_code: await uniqueRefCode(), approved_at: now, reviewed_at: now });
  const ins = await db.from('lr_creators').insert(row).select('id').single();
  if (ins.error || !ins.data) {
    await db.auth.admin.deleteUser(login.userId).catch(() => null);
    console.error('admin_creator_create', ins.error?.message);
    return j({ error: 'Creator-Konto konnte nicht angelegt werden.' }, 500);
  }
  const id = ins.data.id as string;
  await audit('CREATOR_CREATED', id, a.actor, 'SUCCESS', { by_admin: true, access: b.access, own_password: Boolean(b.password) });
  if (active) {
    await db.from('lr_creator_reviews').insert({ creator_id: id, action: 'APPROVE', message: 'Bei Anlage durch LeaseRun freigeschaltet.', visible_to_creator: false, actor_ref: a.actor.ref });
    await audit('CREATOR_APPROVED', id, a.actor, 'SUCCESS', { from: 'DRAFT', to: 'ACTIVE', by_admin_create: true });
  }

  const url = 'https://leaserun.com/creators/anmelden';
  let mailed = false;
  if (b.sendMail && mailConfigured()) {
    mailed = await sendMail(b.email, 'Dein Zugang zum LeaseRun Creator-Bereich',
      `Hallo ${b.firstName},\n\ndein Zugang zum LeaseRun Creator-Bereich ist eingerichtet.\n\nAnmeldung: ${url}\nBenutzername: ${b.email}\nPasswort: ${login.password}\n\n${active ? 'Dein Zugang ist bereits freigeschaltet. Bitte ergänze im Portal noch deine Rechnungs- und Auszahlungsdaten.' : 'Nach der Anmeldung füllst du deine Bewerbung aus; danach prüfen wir sie.'}\n\nDein Passwort kannst du jederzeit über „Passwort vergessen“ ändern.`,
      [], { title: 'Dein Creator-Zugang ist eingerichtet', button: { label: 'Jetzt anmelden', url }, note: 'Bitte gib dein Passwort nicht weiter. Fragen: support@leaserun.com' }).catch(() => false);
  }
  return j({ ok: true, id, email: b.email, password: login.password, access: b.access, url, mailed });
}
