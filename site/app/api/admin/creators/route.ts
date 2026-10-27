import { supabaseAdmin } from '@/lib/supabase/admin';
import { maskIban } from '@/lib/creator/iban';
import { CREATOR_STATUSES } from '@/lib/creator/model';
import { can, permissionsOf, ROLE_LABEL } from '@/lib/creator/roles';
import { j, requireCreatorAdmin } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Creator Operations: Übersicht aller Creator mit Kennzahlen je Status.
// Felder werden je nach Rolle weggelassen (Kontaktdaten, Zahlungsdaten-Status).
export async function GET(req: Request) {
  const a = await requireCreatorAdmin(req, 'creators.list');
  if (!('role' in a)) return a;
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const db = supabaseAdmin();

  let query = db.from('lr_creators')
    .select('id, status, first_name, last_name, country, display_name, categories, submitted_at, approved_at, created_at, updated_at')
    .order('updated_at', { ascending: false }).limit(500);
  if (status === 'REVIEW') query = query.in('status', ['SUBMITTED', 'UNDER_REVIEW']);
  else if (status && (CREATOR_STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
  if (q) query = query.or(`display_name.ilike.%${q.replace(/[%,()*\\]/g, '')}%,last_name.ilike.%${q.replace(/[%,()*\\]/g, '')}%`);
  const [res, allRes] = await Promise.all([query, db.from('lr_creators').select('status')]);
  if (res.error) return j({ error: 'Liste konnte nicht geladen werden.' }, 500);
  type Row = { id: string; status: string; first_name: string | null; last_name: string | null; country: string | null; display_name: string | null; categories: string[]; submitted_at: string | null; approved_at: string | null; updated_at: string };
  const rows = (res.data ?? []) as Row[];
  const all = (allRes.data ?? []) as { status: string }[];

  type Pay = { creator_id: string; status: string; iban_country: string; iban_last4: string };
  const ids = rows.map((r) => r.id);
  const masked = can(a.role, 'bank.masked');
  let socRows: { creator_id: string; platform: string }[] = [];
  let payRows: Pay[] = [];
  if (ids.length) {
    const [soc, pay] = await Promise.all([
      db.from('lr_creator_socials').select('creator_id, platform').in('creator_id', ids),
      masked ? db.from('lr_creator_payout_accounts').select('creator_id, status, iban_country, iban_last4').in('creator_id', ids).neq('status', 'SUPERSEDED') : null,
    ]);
    socRows = (soc.data ?? []) as typeof socRows;
    payRows = ((pay?.data ?? []) as Pay[]);
  }
  const { count: bankReview } = await db.from('lr_creator_payout_accounts').select('id', { count: 'exact', head: true }).eq('status', 'VERIFICATION_REQUIRED');
  const platforms = new Map<string, string[]>();
  for (const s of socRows) platforms.set(s.creator_id, [...(platforms.get(s.creator_id) ?? []), s.platform]);
  const payouts = new Map(payRows.map((p) => [p.creator_id, p]));

  const counts: Record<string, number> = Object.fromEntries(CREATOR_STATUSES.map((s) => [s, 0]));
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const contact = can(a.role, 'creators.contact');

  return j({
    me: { role: a.role, role_label: ROLE_LABEL[a.role], permissions: permissionsOf(a.role) },
    counts,
    bank_review: masked ? bankReview ?? 0 : null,
    attention: (counts.SUBMITTED ?? 0) + (counts.UNDER_REVIEW ?? 0) + (masked ? bankReview ?? 0 : 0),
    creators: rows.map((r) => {
      const p = payouts.get(r.id);
      return {
        id: r.id, status: r.status, display_name: r.display_name,
        name: contact ? [r.first_name, r.last_name].filter(Boolean).join(' ') || null : null,
        country: r.country, categories: r.categories, platforms: platforms.get(r.id) ?? [],
        payout: masked ? (p ? { status: p.status, iban_masked: maskIban(p.iban_country, p.iban_last4) } : { status: 'MISSING' }) : null,
        submitted_at: r.submitted_at, approved_at: r.approved_at, updated_at: r.updated_at,
      };
    }),
  });
}
