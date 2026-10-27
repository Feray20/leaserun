import { supabaseAdmin } from '@/lib/supabase/admin';
import { j, rangeOf, requireActiveCreator } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Eigene Kennzahlen (nur Summen, keine Kundendaten). Provision und Auszahlungsstatus folgen mit der Abrechnung.
export async function GET(req: Request) {
  const g = await requireActiveCreator(req, 'perf', 60);
  if (!('creator' in g)) return g;
  const r = rangeOf(new URL(req.url).searchParams.get('range'));
  const { data, error } = await supabaseAdmin().rpc('lr_creator_performance', { p_creator: g.creator.id, p_from: r.from.toISOString(), p_to: r.to.toISOString() });
  if (error) return j({ error: 'Kennzahlen konnten nicht geladen werden.' }, 500);
  return j({ range: r.key, from: r.from.toISOString(), to: r.to.toISOString(), ...(data as Record<string, unknown>) });
}
