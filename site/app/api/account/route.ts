import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { billingEnabled, entitlementsFor, stripe } from '@/lib/billing/stripe';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { purgeUser } from '@/lib/account/purge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Datenauskunft und Datenübertragbarkeit (Art. 15, 20 DSGVO): alle zum Konto gespeicherten Daten als JSON.
// Dateien selbst sind im Konto einzeln abrufbar; hier stehen Metadaten und Prüfsummen.
export async function GET(req: Request) {
  if (!adminConfigured()) return json({ error: 'Nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`export:${user.id}`, 3, 60_000)) return json({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, 429);
  const db = supabaseAdmin();
  const own = (table: string, cols: string, key = 'owner_id') => db.from(table).select(cols).eq(key, user.id).limit(5000);
  const [ud, docs, events, shares, roomLog, versions, credits, requests, ent] = await Promise.all([
    db.from('lr_user_data').select('email, profile, objects, progress, created_at, updated_at').eq('user_id', user.id).maybeSingle(),
    own('lr_documents', 'id, object_ref, category, filename, mime_type, size_bytes, sha256, status, created_at'),
    own('lr_document_events', 'document_id, event_type, metadata, created_at'),
    own('lr_data_room_shares', 'id, object_ref, permissions, expires_at, revoked_at, max_views, view_count, max_downloads, download_count, created_at'),
    own('lr_data_room_access_log', 'share_id, actor_type, action, document_id, created_at'),
    own('lr_kreditmappe_versions', 'id, object_ref, version_no, sha256, byte_size, created_at'),
    own('lr_kreditmappe_credits', 'object_ref, created_at'),
    own('lr_document_requests', 'object_ref, category, note, status, created_at, resolved_at'),
    db.from('lr_entitlements').select('plan, status, valid_until, created_at').eq('user_id', user.id).maybeSingle(),
  ]);
  const { data: b2bAcc } = await db.from('lr_b2b_accounts').select('*').eq('owner_id', user.id).maybeSingle();
  const b2bLeads = b2bAcc ? (await db.from('lr_b2b_leads').select('*').eq('account_id', b2bAcc.id).limit(5000)).data : null;
  const b2bInvoices = b2bAcc ? (await db.from('lr_invoices').select('invoice_number, kind, issue_date, net_cents, vat_cents, gross_cents, payment_status').eq('account_id', b2bAcc.id).limit(5000)).data : null;
  const body = {
    exportiert_am: new Date().toISOString(),
    hinweis: 'Datenauskunft gem. Art. 15 und Art. 20 DSGVO. Hochgeladene Dateien sind im Konto einzeln abrufbar; Zahlungsdaten liegen bei Stripe.',
    konto: { id: user.id, email: user.email },
    profil_und_objekte: ud.data ?? null,
    dokumente: docs.data ?? [],
    dokument_ereignisse: events.data ?? [],
    datenraum_freigaben: shares.data ?? [],
    datenraum_zugriffe: roomLog.data ?? [],
    kreditmappe_versionen: versions.data ?? [],
    kreditmappe_freischaltungen: credits.data ?? [],
    unterlagen_anforderungen: requests.data ?? [],
    tarif: ent.data ?? null,
    unternehmenskonto: b2bAcc ? { ...b2bAcc, widget_key: undefined, anfragen: b2bLeads ?? [], rechnungen: b2bInvoices ?? [] } : null,
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="LeaseRun_Datenexport_${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

// Konto löschen (Art. 17 DSGVO): Dateien, Datensätze und Zugang endgültig entfernen.
export async function DELETE(req: Request) {
  if (!adminConfigured()) return json({ error: 'Nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`delete:${user.id}`, 3, 60_000)) return json({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, 429);
  const b = (await req.json().catch(() => null)) as { confirm?: unknown; cancelSub?: unknown } | null;
  if (b?.confirm !== 'LÖSCHEN') return json({ error: 'Bitte zur Bestätigung LÖSCHEN eingeben.' }, 400);

  // Laufendes Abo zuerst kündigen lassen, damit nicht weiter abgebucht wird.
  if (billingEnabled()) {
    try {
      const ent = await entitlementsFor(user.id, user.email);
      if (ent.pro && ent.proSource === 'subscription') {
        return json({ error: 'Bitte kündigen Sie zuerst Ihr Pro-Abo (Abrechnung → „Rechnungen, Zahlungsmittel und Abo verwalten“ oder „Verträge hier kündigen“).' }, 409);
      }
    } catch {
      return json({ error: 'Abo-Status konnte nicht geprüft werden. Bitte später erneut versuchen.' }, 502);
    }
  }

  const db = supabaseAdmin();
  // Unternehmenskonto mit laufendem Abo: erst kündigen (Rechnungen bleiben nach § 147 AO erhalten).
  const { data: b2b } = await db.from('lr_b2b_accounts').select('id, plan_source, plan_tier, plan_until, stripe_subscription_id').eq('owner_id', user.id).maybeSingle();
  if (b2b?.plan_source === 'stripe' && b2b.plan_tier && b2b.stripe_subscription_id && !b2b.plan_until) {
    // Löschen aus dem Unternehmensportal: Abo auf ausdrücklichen Wunsch sofort kündigen, damit nichts weiter abgebucht wird.
    if (b?.cancelSub !== true || !billingEnabled()) return json({ error: 'Bitte zuerst das Abo des Unternehmenskontos kündigen (Unternehmensportal → Tarif & Rechnungen → Abo verwalten).' }, 409);
    try { await stripe().subscriptions.cancel(b2b.stripe_subscription_id as string); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/No such subscription|canceled/i.test(msg)) { console.error('account_delete_cancel', msg); return json({ error: 'Das Abo konnte nicht gekündigt werden. Bitte erneut versuchen oder an support@leaserun.com wenden.' }, 502); }
    }
  }
  try {
    await purgeUser(user.id, b2b?.id || null, user.email);
  } catch (e) {
    console.error('account_delete_error', e instanceof Error ? e.message : e);
    return json({ error: 'Löschen nicht vollständig möglich. Bitte an support@leaserun.com wenden.' }, 500);
  }
  return json({ deleted: true });
}
