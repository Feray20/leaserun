import '@/lib/env-alias';
import { NextResponse } from 'next/server';
import { sendMail } from '@/lib/notify/mail';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { BUDGET_USD, USAGE_KEY, kostenUsd, minuten, monatJetzt, safeEq, verifyRetell, warnStufe, zusammenfassung, type RetellCall, type Usage } from '@/lib/telefon/assistent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Retell-Webhook: nach jedem Anruf (Ereignis „call_analyzed“) eine Zusammenfassung an support@leaserun.com.
// Zugelassen nur mit gültiger Retell-Signatur (RETELL_API_KEY) oder dem geheimen Token ?k=… (TELEFON_WEBHOOK_TOKEN).
// Gespeichert wird nur der Minutenzähler für das Monatsbudget – keine Gesprächsinhalte.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const POSTFACH = 'support@leaserun.com';

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 512_000) return j({ error: 'Zu groß.' }, 413);
  const tok = (process.env.TELEFON_WEBHOOK_TOKEN || '').trim();
  const k = new URL(req.url).searchParams.get('k') || '';
  const ok = verifyRetell(raw, req.headers.get('x-retell-signature'), process.env.RETELL_API_KEY) || (tok.length >= 24 && safeEq(tok, k));
  if (!ok) return j({ error: 'Nicht erlaubt.' }, 401);

  let body: { event?: string; call?: RetellCall } = {};
  try { body = JSON.parse(raw); } catch { return j({ error: 'Ungültig.' }, 400); }
  // Nur das Ereignis mit fertiger Auswertung verarbeiten; alle anderen bestätigen, damit Retell nicht wiederholt.
  if (body.event !== 'call_analyzed' || !body.call) return j({ ok: true, skip: body.event || 'unbekannt' });
  const call = body.call;

  // Minutenzähler fürs Budget (lr_settings, ein Eintrag pro Monat)
  let warn: 0 | 80 | 100 = 0, usage: Usage | null = null;
  if (adminConfigured()) {
    const db = supabaseAdmin();
    const { data } = await db.from('lr_settings').select('value').eq('key', USAGE_KEY).maybeSingle();
    const m = monatJetzt();
    const prev = data?.value as Usage | undefined;
    usage = prev && prev.monat === m ? { ...prev } : { monat: m, minuten: 0, anrufe: 0 };
    usage.minuten += minuten(call); usage.anrufe += 1;
    warn = warnStufe(usage);
    if (warn) usage.gewarnt = warn;
    await db.from('lr_settings').upsert({ key: USAGE_KEY, value: usage, updated_at: new Date().toISOString(), updated_by: 'telefon' });
  }

  const z = zusammenfassung(call);
  // Werbe-/Spam-Anrufe ohne E-Mail – sie zählen nur für das Budget.
  if (!z.spam) await sendMail(POSTFACH, z.subject, z.text, [], { title: z.dringend ? 'Dringender Anruf' : 'Neuer Anruf', note: 'Zusammenfassung des Telefon-Assistenten. Kein Mitschnitt gespeichert.' });
  if (warn && usage) {
    const k$ = kostenUsd(usage);
    await sendMail(POSTFACH, `Telefon-Assistent: ${warn} % des Monatsbudgets erreicht`, `Diesen Monat: ${usage.anrufe} Anrufe, ${usage.minuten} Minuten, geschätzt ${k$.toLocaleString('de-DE')} $ von ${BUDGET_USD} $.\n\n${warn === 100 ? 'Das Budget ist erreicht. Ist bei Retell kein Guthaben mehr da, kann der Assistent keine Anrufe mehr annehmen. Wenn er weiterlaufen soll: bei Retell Guthaben nachladen.' : 'Bei gleichbleibenden Anrufen wird das Budget in diesem Monat knapp.'}`, [], { title: 'Budget-Hinweis' });
  }
  return j({ ok: true });
}
