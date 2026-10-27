import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { groupIban } from '@/lib/creator/iban';
import { open, vaultConfigured } from '@/lib/creator/vault';
import { audit, currentPayout, j, maskedPayout, requireCreatorAdmin, UUID_RE } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Geschützte Zahlungsdaten.
//   reveal – vollständige IBAN anzeigen: nur Rollen mit „bank.reveal“ (Super/Finance), nur per POST (kein Cache, kein Verlauf).
//            Zuerst wird der Zugriff protokolliert (BANK_DETAILS_VIEWED); scheitert das Protokoll, wird nichts herausgegeben.
//   verify – Zahlungsdaten als geprüft markieren (z. B. nach Rückfrage bei einer Änderung).
const Input = z.object({ action: z.enum(['reveal', 'verify']) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return j({ error: 'Nicht gefunden.' }, 404);
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültige Aktion.' }, 400);

  if (p.data.action === 'reveal') {
    const a = await requireCreatorAdmin(req, 'bank.reveal', id);
    if (!('role' in a)) {
      return a;
    }
    if (!vaultConfigured()) return j({ error: 'Tresor nicht konfiguriert (CREATOR_PII_KEY).' }, 503);
    const pay = await currentPayout(id);
    if (!pay) return j({ error: 'Keine Zahlungsdaten hinterlegt.' }, 404);
    const logged = await audit('BANK_DETAILS_VIEWED', id, a.actor, 'SUCCESS', { payout: pay.id.slice(0, 8), status: pay.status });
    if (!logged) return j({ error: 'Zugriff konnte nicht protokolliert werden. Aus Sicherheitsgründen werden keine Daten angezeigt.' }, 503);
    let iban: string;
    try { iban = open(pay.iban_enc, id); } catch {
      await audit('BANK_DETAILS_VIEWED', id, a.actor, 'FAILED', { reason: 'decrypt' });
      return j({ error: 'Zahlungsdaten konnten nicht entschlüsselt werden.' }, 500);
    }
    return j({ holder_name: pay.holder_name, iban: groupIban(iban), bic: pay.bic, status: pay.status, shown_at: new Date().toISOString(), hide_after_seconds: 60 });
  }

  const a = await requireCreatorAdmin(req, 'bank.verify', id);
  if (!('role' in a)) return a;
  const pay = await currentPayout(id);
  if (!pay) return j({ error: 'Keine Zahlungsdaten hinterlegt.' }, 404);
  if (pay.status === 'VERIFIED') return j({ ok: true, payout: maskedPayout(pay) });
  const { data, error } = await supabaseAdmin().from('lr_creator_payout_accounts')
    .update({ status: 'VERIFIED', verified_at: new Date().toISOString(), verified_by: a.actor.ref })
    .eq('id', pay.id).eq('status', pay.status).select('id');
  if (error || !data?.length) return j({ error: 'Status wurde inzwischen geändert. Bitte neu laden.' }, 409);
  await audit('BANK_DATA_VERIFIED', id, a.actor, 'SUCCESS', { from: pay.status });
  return j({ ok: true, payout: maskedPayout(await currentPayout(id)) });
}
