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

// Right to know / data portability (CCPA/CPRA and other state privacy laws): all data stored for the account as JSON.
// Files themselves can be downloaded one by one in the account; this export lists metadata and checksums.
export async function GET(req: Request) {
  if (!adminConfigured()) return json({ error: 'Not configured.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  if (!allowRequest(`export:${user.id}`, 3, 60_000)) return json({ error: 'Too many requests. Please wait a moment.' }, 429);
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
    exported_at: new Date().toISOString(),
    note: 'Copy of your personal data (right to know / data portability). Uploaded files can be downloaded one by one in your account; payment data is held by Stripe.',
    account: { id: user.id, email: user.email },
    profile_and_properties: ud.data ?? null,
    documents: docs.data ?? [],
    document_events: events.data ?? [],
    data_room_shares: shares.data ?? [],
    data_room_access_log: roomLog.data ?? [],
    lender_package_versions: versions.data ?? [],
    lender_package_credits: credits.data ?? [],
    document_requests: requests.data ?? [],
    plan: ent.data ?? null,
    business_account: b2bAcc ? { ...b2bAcc, widget_key: undefined, leads: b2bLeads ?? [], invoices: b2bInvoices ?? [] } : null,
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="LeaseRun_data_export_${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

// Delete account (right to delete): permanently remove files, records and the login.
export async function DELETE(req: Request) {
  if (!adminConfigured()) return json({ error: 'Not configured.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  if (!allowRequest(`delete:${user.id}`, 3, 60_000)) return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  const b = (await req.json().catch(() => null)) as { confirm?: unknown; cancelSub?: unknown } | null;
  // 'DELETE' (US UI); the legacy value is still accepted from older clients.
  if (b?.confirm !== 'DELETE' && b?.confirm !== 'L\u00d6SCHEN') return json({ error: 'Please type DELETE to confirm.' }, 400);

  // An active subscription must be canceled first so no further charges occur.
  if (billingEnabled()) {
    try {
      const ent = await entitlementsFor(user.id, user.email);
      if (ent.pro && ent.proSource === 'subscription') {
        return json({ error: 'Please cancel your Investor Pro subscription first (Plan & billing → "Manage billing" or the "Cancel subscription" page).' }, 409);
      }
    } catch {
      return json({ error: 'We could not check your subscription status. Please try again later.' }, 502);
    }
  }

  const db = supabaseAdmin();
  // Business account with an active subscription: cancel first (invoices are kept for tax records).
  const { data: b2b } = await db.from('lr_b2b_accounts').select('id, plan_source, plan_tier, plan_until, stripe_subscription_id').eq('owner_id', user.id).maybeSingle();
  if (b2b?.plan_source === 'stripe' && b2b.plan_tier && b2b.stripe_subscription_id && !b2b.plan_until) {
    // Deletion from the business portal: cancel the subscription immediately on explicit request so nothing else is charged.
    if (b?.cancelSub !== true || !billingEnabled()) return json({ error: 'Please cancel the business account subscription first (Business portal → Plan & billing → Manage subscription).' }, 409);
    try { await stripe().subscriptions.cancel(b2b.stripe_subscription_id as string); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/No such subscription|canceled/i.test(msg)) { console.error('account_delete_cancel', msg); return json({ error: 'The subscription could not be canceled. Please try again or contact support@leaserun.com.' }, 502); }
    }
  }
  try {
    await purgeUser(user.id, b2b?.id || null, user.email);
  } catch (e) {
    console.error('account_delete_error', e instanceof Error ? e.message : e);
    return json({ error: 'Deletion could not be completed. Please contact support@leaserun.com.' }, 500);
  }
  return json({ deleted: true });
}
