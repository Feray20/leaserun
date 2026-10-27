import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit, j, requireCreatorAdmin, UUID_RE } from '@/lib/creator/server';
import { contactEmail } from '@/lib/creator/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → Creator Operations: Creator-Konto endgültig löschen.
// - Ohne Abrechnungsgeschichte: Creator samt Profil, Social, Beiträgen, Kampagnen und Zugang wird vollständig gelöscht.
// - Mit Abrechnungsgeschichte (Provisionen, Abrechnungen, Gutschriften, Auszahlungen): diese bleiben wegen der
//   gesetzlichen Aufbewahrung (§ 147 AO, § 257 HGB) erhalten. Gelöscht werden Zugang, Social, Beiträge und Zahlungsdaten;
//   der Creator wird pausiert und vom Konto getrennt (user_id = null), sein Link wirkt nicht mehr.
// - Offene Abrechnungen oder Auszahlungen müssen vorher abgeschlossen werden.
// Bestätigung: die Kontakt-E-Mail des Creators muss genau eingegeben werden.
const Body = z.object({ confirmEmail: z.string().trim().toLowerCase().max(200) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return j({ error: 'Nicht gefunden.' }, 404);
  const a = await requireCreatorAdmin(req, 'creators.suspend', id);
  if (!('role' in a)) return a;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Bitte die E-Mail-Adresse des Creators eingeben.' }, 400);

  const db = supabaseAdmin();
  const { data: c } = await db.from('lr_creators').select('id, user_id, status').eq('id', id).maybeSingle();
  if (!c) return j({ error: 'Nicht gefunden.' }, 404);
  let email = '';
  if (c.user_id) {
    const { data: u } = await db.auth.admin.getUserById(c.user_id as string);
    if (u?.user) email = (await contactEmail(u.user)).toLowerCase();
  }
  if (!email || p.data.confirmEmail !== email) return j({ error: 'Zur Bestätigung bitte die E-Mail-Adresse des Creators genau eingeben.' }, 400);

  // Offenes Geld zuerst klären.
  const [st, po] = await Promise.all([
    db.from('lr_creator_statements').select('id', { count: 'exact', head: true }).eq('creator_id', id).in('status', ['READY', 'INVOICED', 'APPROVED']),
    db.from('lr_creator_payouts').select('id', { count: 'exact', head: true }).eq('creator_id', id).in('status', ['READY', 'APPROVED', 'EXPORTED']),
  ]);
  if ((st.count ?? 0) > 0 || (po.count ?? 0) > 0) return j({ error: 'Es gibt noch eine offene Abrechnung oder Auszahlung. Bitte zuerst abschließen (Creator Billing), dann löschen.' }, 409);

  const userId = c.user_id as string;
  // 1) Vollständig löschen versuchen (scheitert bewusst, wenn Abrechnungsdaten aufbewahrt werden müssen).
  const full = await db.from('lr_creators').delete().eq('id', id);
  let mode: 'full' | 'retained' = 'full';
  if (full.error) {
    if (full.error.code !== '23503') { console.error('creator_delete', full.error.message); return j({ error: 'Löschen fehlgeschlagen.' }, 500); }
    mode = 'retained';
    // 2) Aufbewahrung: persönliche Zusatzdaten entfernen, vom Konto trennen, pausieren.
    for (const t of ['lr_creator_socials', 'lr_creator_content', 'lr_creator_campaign_members', 'lr_creator_benefits', 'lr_creator_payout_accounts']) {
      const r = await db.from(t).delete().eq('creator_id', id);
      if (r.error) console.warn('creator_delete_part', t, r.error.code);
    }
    const up = await db.from('lr_creators').update({ user_id: null, status: 'SUSPENDED', phone: null, bio: null, website: null, info_request: null }).eq('id', id);
    if (up.error) { console.error('creator_delete_retain', up.error.message); return j({ error: 'Löschen fehlgeschlagen.' }, 500); }
  }
  // 3) Zugang löschen (eigenes Creator-Konto, unabhängig von Kunden- oder Unternehmenskonten).
  const del = await db.auth.admin.deleteUser(userId);
  if (del.error && !/not.?found/i.test(del.error.message)) console.error('creator_delete_auth', del.error.message);
  await audit('CREATOR_ACCOUNT_DELETED', id, a.actor, 'SUCCESS', { mode });
  return j({ ok: true, mode });
}
