import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { cleanupAllIncoming } from '@/lib/documents/cleanup';
import { runReminders } from '@/lib/reminders/run';
import { effectiveTier, TIER_LIMITS, type B2BAccount } from '@/lib/b2b/core';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { cleanupExports } from '@/lib/storage/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Täglicher Lauf (Vercel Cron): abgebrochene Uploads aufräumen, Fristen-Erinnerungen versenden. Vercel sendet "Authorization: Bearer $CRON_SECRET".
// Ohne gesetztes CRON_SECRET bleibt die Route gesperrt.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get('authorization') || '';
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!adminConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const cleanup = await cleanupAllIncoming().catch((e) => ({ error: String(e instanceof Error ? e.message : e) }));
  const origin = process.env.PUBLIC_SITE_URL || 'https://immoadv.de';
  const reminders = await runReminders(origin).catch((e) => ({ error: String(e instanceof Error ? e.message : e) }));
  console.log('cron_daily', { cleanup, reminders });
  // Fällige, unbezahlte Rechnungen als überfällig markieren; abgelaufene Einladungen entfernen.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
  const db = supabaseAdmin();
  const overdue = await db.from('immo_invoices').update({ payment_status: 'OVERDUE' }).eq('payment_status', 'PENDING').lt('due_date', today).select('id').then((r) => r.data?.length ?? 0, () => -1);
  await db.from('immo_b2b_invites').delete().lt('expires_at', new Date(Date.now() - 30 * 864e5).toISOString()).then(() => null, () => null);
  const exportsRemoved = await cleanupExports().catch(() => -1);
  const retention = await leadRetention().catch((e) => ({ error: String(e instanceof Error ? e.message : e) }));
  const radar = await radarNotify(today).catch((e) => ({ error: String(e instanceof Error ? e.message : e) }));
  return NextResponse.json({ ok: true, cleanup, reminders, overdue, retention, exportsRemoved, radar }, { headers: { 'Cache-Control': 'no-store' } });
}

// Bestandskunden-Radar: Am 1. jedes Monats erhält jedes Unternehmen mit Radar-Tarif eine Übersicht der Kunden,
// deren Zinsbindung in 36, 24, 12, 6 oder 3 Monaten endet – nur für Kunden mit ausdrücklicher Radar-Einwilligung.
const RADAR_STEPS = [36, 24, 12, 6, 3];
async function radarNotify(today: string): Promise<Record<string, unknown>> {
  if (!mailConfigured()) return { skipped: 'E-Mail nicht eingerichtet' };
  if (!today.endsWith('-01')) return { skipped: 'nicht fällig' };
  const ym = today.slice(0, 7);
  const db = supabaseAdmin();
  const { data: accs } = await db.from('immo_b2b_accounts').select('*').eq('status', 'active').limit(2000);
  let sent = 0;
  for (const acc of accs ?? []) {
    const t = effectiveTier(acc as B2BAccount);
    if (!t || !TIER_LIMITS[t].radar) continue;
    const tag = `radar:${acc.id}:${ym}`;
    const { data: done } = await db.from('immo_admin_audit').select('id').eq('action', 'radar_notify').eq('target', tag).limit(1);
    if (done?.length) continue;
    const { data: cl } = await db.from('immo_b2b_clients').select('client_name, client_email, client_user_id').eq('account_id', acc.id).eq('status', 'verbunden').not('radar_consent_at', 'is', null).limit(1000);
    const ids = (cl ?? []).map((c) => c.client_user_id).filter(Boolean) as string[];
    if (!ids.length) continue;
    const { data: ud } = await db.from('immo_user_data').select('user_id, progress').in('user_id', ids);
    const [y, m] = ym.split('-').map(Number);
    const hits: string[] = [];
    for (const c of cl ?? []) {
      const s = (ud ?? []).find((u) => u.user_id === c.client_user_id)?.progress as { summary?: { fixEnds?: string[] } } | null;
      for (const e of s?.summary?.fixEnds ?? []) {
        if (!/^\d{4}-\d{2}$/.test(String(e))) continue;
        const [ey, em] = String(e).split('-').map(Number);
        const diff = (ey - y) * 12 + (em - m);
        if (RADAR_STEPS.includes(diff)) hits.push(`- ${c.client_name || c.client_email}: Zinsbindung endet ${String(em).padStart(2, '0')}/${ey} (in ${diff} Monaten)${diff <= 60 && diff > 6 ? ' – Forward-Darlehen möglich' : ''}`);
      }
    }
    if (!hits.length) continue;
    const ok = await sendMail(acc.email, `Bestandskunden-Radar ${ym}: ${hits.length} Anschlussfinanzierung${hits.length === 1 ? '' : 'en'} in Sicht`,
      `Guten Tag${acc.advisor_name ? ' ' + acc.advisor_name : ''},\n\nbei diesen Kunden endet die Zinsbindung demnächst (nur Kunden, die dem Radar zugestimmt haben):\n\n${hits.join('\n')}\n\nAlle Details im Portal unter „Kunden“.\n\nDiese E-Mail wurde automatisch erstellt.`,
      [], { title: 'Bestandskunden-Radar', button: { label: 'Kunden im Portal öffnen', url: (process.env.PUBLIC_SITE_URL || 'https://immoadv.de') + '/b2b-portal#kunden' } });
    await db.from('immo_admin_audit').insert({ actor_email: 'cron', action: 'radar_notify', target: tag, meta: { count: hits.length, sent: ok } });
    if (ok) sent++;
  }
  return { sent };
}

// Speicherbegrenzung (Art. 5 Abs. 1 lit. e DSGVO): Anfragen nach der vom Unternehmen gewählten Frist löschen (Standard 24 Monate).
async function leadRetention(): Promise<Record<string, number>> {
  const db = supabaseAdmin();
  const { data: accs } = await db.from('immo_b2b_accounts').select('id, lead_retention_months').limit(5000);
  let deleted = 0;
  for (const a of accs ?? []) {
    const cutoff = new Date(Date.now() - (a.lead_retention_months || 24) * 30.44 * 864e5).toISOString();
    const r = await db.from('immo_b2b_leads').delete().eq('account_id', a.id).lt('created_at', cutoff).select('id');
    deleted += r.data?.length ?? 0;
  }
  await db.from('immo_security_log').delete().lt('created_at', new Date(Date.now() - 30 * 864e5).toISOString());
  // Akquise-Kontakte ohne Geschäftsbeziehung: nach 3 Jahren ohne Kontakt löschen (Sperrvermerke bei Widerspruch bleiben).
  await db.from('immo_crm_contacts').delete().lt('updated_at', new Date(Date.now() - 3 * 365 * 864e5).toISOString()).not('status', 'in', '(kunde,widerspruch)');
  await db.from('immo_analytics').delete().lt('ts', new Date(Date.now() - 425 * 864e5).toISOString());
  await db.from('immo_webhook_log').delete().lt('created_at', new Date(Date.now() - 90 * 864e5).toISOString());
  // Admin-Protokoll nach 90 Tagen löschen; Rechnungs- und Vertragsvorgänge bleiben (handels-/steuerrechtliche Aufbewahrung).
  await db.from('immo_admin_audit').delete().lt('created_at', new Date(Date.now() - 90 * 864e5).toISOString())
    .not('action', 'like', 'invoice%').not('action', 'in', '(b2b_register,b2b_onboarding,datev_export,b2b_create)');
  // Verifizierungsnachweise 90 Tage nach der Entscheidung (freigeschaltet oder abgelehnt) löschen.
  let verifDocs = 0;
  const cutoff90 = new Date(Date.now() - 90 * 864e5).toISOString();
  const { data: decided } = await db.from('immo_b2b_accounts').select('id').in('verification_status', ['geprueft', 'abgelehnt']).lt('verification_decided_at', cutoff90).limit(2000);
  for (const a of decided ?? []) {
    const { data: docs } = await db.from('immo_b2b_verification_docs').select('id, storage_path').eq('account_id', a.id);
    if (!docs?.length) continue;
    await db.storage.from('b2b-verify').remove(docs.map((d) => d.storage_path));
    await db.from('immo_b2b_verification_docs').delete().in('id', docs.map((d) => d.id));
    verifDocs += docs.length;
  }
  // Nachweise aus Kontoanfragen, aus denen kein Konto wurde: nach 180 Tagen löschen.
  const { data: oldReq } = await db.from('immo_b2b_contact').select('id, proof_path').not('proof_path', 'is', null).lt('created_at', new Date(Date.now() - 180 * 864e5).toISOString()).limit(500);
  if (oldReq?.length) {
    await db.storage.from('b2b-verify').remove(oldReq.map((r) => r.proof_path as string));
    await db.from('immo_b2b_contact').update({ proof_path: null }).in('id', oldReq.map((r) => r.id));
    verifDocs += oldReq.length;
  }
  return { deleted, verifDocs };
}
