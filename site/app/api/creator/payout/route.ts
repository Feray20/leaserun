import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendMail } from '@/lib/notify/mail';
import { bicRequired, checkIban, IBAN_ERROR, maskIban, normalizeBic, validBic } from '@/lib/creator/iban';
import { creatorCanEdit } from '@/lib/creator/model';
import { PayoutInput, firstIssue } from '@/lib/creator/schema';
import { fingerprint, seal, vaultConfigured } from '@/lib/creator/vault';
import { audit, creatorActor, currentPayout, j, maskedPayout, ownCreator, requireCreatorUser } from '@/lib/creator/server';
import { contactEmail } from '@/lib/creator/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Zahlungsdaten hinterlegen oder ändern.
//  * IBAN wird serverseitig erneut geprüft (Format, Land, Länge, Prüfziffer) – Fehlertexte nennen die IBAN nie.
//  * Gespeichert werden nur Chiffrat (AES-256-GCM, an den Creator gebunden), letzte 4 Ziffern, Land, Fingerabdruck.
//  * Eine Änderung legt einen neuen Datensatz an und löst den alten ab (atomar in der Datenbank).
//  * Änderung bei aktivem Creator → „Prüfung erforderlich“ (abschaltbar über lr_settings), Hinweis-Mail an den Creator.
//  * Dasselbe Konto bei einem anderen Creator → immer „Prüfung erforderlich“ (Betrugsschutz), ohne das dem Creator offenzulegen.
export async function POST(req: Request) {
  const g = await requireCreatorUser(req, 'payout', 8);
  if (!('user' in g)) return g;
  if (!vaultConfigured()) return j({ error: 'Zahlungsdaten können gerade nicht gespeichert werden. Bitte später erneut versuchen.' }, 503);
  const c = await ownCreator(g.user.id);
  if (!c) return j({ error: 'Bitte zuerst die Bewerbung beginnen.' }, 404);
  if (!creatorCanEdit(c.status, 'payout')) return j({ error: 'Deine Zahlungsdaten können in diesem Moment nicht geändert werden.' }, 409);

  const p = PayoutInput.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    const e = firstIssue(p.error);
    return j(e.field === 'iban' ? { error: IBAN_ERROR, field: 'iban' } : e, 400);
  }
  const chk = checkIban(p.data.iban);
  if (!chk.ok) return j({ error: IBAN_ERROR, field: 'iban' }, 400);
  const bic = normalizeBic(p.data.bic);
  if (bic && !validBic(bic)) return j({ error: 'Bitte überprüfe die BIC.', field: 'bic' }, 400);
  if (!bic && bicRequired(chk.country)) return j({ error: 'Für Konten außerhalb des SEPA-Raums wird die BIC benötigt.', field: 'bic' }, 400);

  const db = supabaseAdmin();
  const before = await currentPayout(c.id);
  const fp = fingerprint(chk.iban);
  if (before && before.iban_fingerprint === fp && before.holder_name === p.data.holder_name && (before.bic || null) === bic) {
    return j({ ok: true, unchanged: true, payout: maskedPayout(before) });
  }

  const { data: dup } = await db.from('lr_creator_payout_accounts').select('creator_id').eq('iban_fingerprint', fp).neq('creator_id', c.id).neq('status', 'SUPERSEDED').limit(1);
  const duplicate = Boolean(dup?.length);
  const { data: setting } = await db.from('lr_settings').select('value').eq('key', 'creator_bank_change_requires_review').maybeSingle();
  const changeNeedsReview = setting?.value !== false;
  const status = duplicate || (before && c.status === 'ACTIVE' && changeNeedsReview) ? 'VERIFICATION_REQUIRED' : 'PROVIDED';

  const { error } = await db.rpc('lr_creator_payout_replace', {
    p_creator: c.id, p_holder: p.data.holder_name, p_enc: seal(chk.iban, c.id), p_last4: chk.last4,
    p_country: chk.country, p_fingerprint: fp, p_bic: bic, p_status: status,
  });
  if (error) {
    await audit(before ? 'BANK_DATA_CHANGED' : 'BANK_DATA_ADDED', c.id, creatorActor(), 'FAILED');
    return j({ error: 'Speichern fehlgeschlagen. Bitte erneut versuchen.' }, 500);
  }
  await audit(before ? 'BANK_DATA_CHANGED' : 'BANK_DATA_ADDED', c.id, creatorActor(), 'SUCCESS', { status, country: chk.country, duplicate, creator_status: c.status });

  // Sicherheits-Hinweis bei Änderung (nie mit vollständiger IBAN).
  if (before) {
    await sendMail(await contactEmail(g.user), 'Deine Zahlungsdaten bei LeaseRun wurden geändert',
      `Hallo${c.first_name ? ' ' + c.first_name : ''},\n\nim LeaseRun Creator-Portal wurden soeben deine Zahlungsdaten geändert. Neues Konto: ${maskIban(chk.country, chk.last4)}.\n\nWenn du das nicht selbst warst, antworte bitte sofort auf diese E-Mail oder schreibe an support@leaserun.com. Ausstehende Auszahlungen halten wir bis zur Klärung an.`,
      [], { title: 'Zahlungsdaten geändert' }).catch(() => false);
  }
  return j({ ok: true, payout: maskedPayout(await currentPayout(c.id)), review_required: status === 'VERIFICATION_REQUIRED' });
}
