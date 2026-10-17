import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AVV_VERSION, adminAudit } from '@/lib/b2b/core';
import { avvEvidence } from '@/lib/b2b/avv-evidence';
import { json, requireMember } from '@/lib/b2b/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ersteinrichtung nach dem ersten Login: Passwort wurde im Browser geändert (Supabase); hier werden die Erklärungen
// des Inhabers gespeichert (§ 14 BGB, AVV, Nutzungsbedingungen) und die Pflicht zum Passwortwechsel aufgehoben.
const Body = z.object({ passwordChanged: z.literal(true), unternehmer: z.boolean().optional(), avv: z.boolean().optional(), agb: z.boolean().optional() });

export async function POST(req: Request) {
  const ctx = await requireMember(req, { allowLocked: true, onboarding: true, bucket: 'b2b-onboard', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Bitte zuerst ein neues Passwort festlegen.' }, 400);
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const a = ctx.account;
  if (ctx.role === 'owner' && (!a.unternehmer_confirmed_at || !a.avv_accepted_at)) {
    if (!p.data.unternehmer || !p.data.avv || !p.data.agb) return json({ error: 'Bitte alle drei Erklärungen bestätigen.' }, 400);
    await db.from('immo_b2b_accounts').update({ unternehmer_confirmed_at: a.unternehmer_confirmed_at || now, avv_accepted_at: a.avv_accepted_at || now, avv_version: a.avv_accepted_at ? a.avv_version : AVV_VERSION, ...(a.avv_accepted_at ? {} : { avv_evidence: avvEvidence(req, { userId: ctx.user.id, email: ctx.user.email, name: a.advisor_name, role: ctx.role }) }) }).eq('id', a.id);
  }
  const { data: u } = await db.auth.admin.getUserById(ctx.user.id);
  await db.auth.admin.updateUserById(ctx.user.id, { user_metadata: { ...(u?.user?.user_metadata || {}), must_change_password: false, onboarded_at: now } });
  await adminAudit(ctx.user.email, 'b2b_onboarding', a.id, { role: ctx.role, avv: AVV_VERSION, unternehmer: Boolean(p.data.unternehmer) });
  return json({ ok: true });
}
