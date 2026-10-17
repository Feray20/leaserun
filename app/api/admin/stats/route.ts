import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { billingEnabled } from '@/lib/billing/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Betreiber-Übersicht: nur Zählwerte, keine personenbezogenen Inhalte.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht konfiguriert.' }, { status: 503 });
  const db = supabaseAdmin();
  const since = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
  const count = async (table: string, f?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = db.from(table).select('*', { count: 'exact', head: true });
    if (f) q = f(q);
    const { count: c, error } = await q;
    return error ? null : c ?? 0;
  };
  const [users, users7, docs, shares, sharesActive, versions, reminders, requestsOpen, partners, b2b, b2bActive, leads, contactsOpen] = await Promise.all([
    count('immo_user_data'),
    count('immo_user_data', (q) => q.gte('created_at', since(7))),
    count('immo_documents'),
    count('immo_data_room_shares'),
    count('immo_data_room_shares', (q) => q.is('revoked_at', null).gt('expires_at', new Date().toISOString())),
    count('immo_kreditmappe_versions'),
    count('immo_user_data', (q) => q.eq('profile->>reminders', 'true')),
    count('immo_document_requests', (q) => q.eq('status', 'offen')),
    count('immo_partners', (q) => q.eq('active', true)),
    count('immo_b2b_accounts'),
    count('immo_b2b_accounts', (q) => q.eq('status', 'active').not('plan_tier', 'is', null)),
    count('immo_b2b_leads'),
    count('immo_b2b_contact', (q) => q.eq('status', 'offen')),
  ]);
  // Objekte: Summe der Objektlisten (nur Anzahl)
  const { data: od } = await db.from('immo_user_data').select('objects').limit(5000);
  const objects = (od ?? []).reduce((s, r) => s + (Array.isArray(r.objects) ? r.objects.length : 0), 0);
  return NextResponse.json({ users, users7, objects, docs, shares, sharesActive, versions, reminders, requestsOpen, partners, b2b, b2bActive, leads, contactsOpen,
    config: { billing: billingEnabled(), mail: Boolean(process.env.RESEND_API_KEY && (process.env.NOTIFY_FROM_EMAIL || process.env.CANCEL_FROM_EMAIL)), cron: Boolean(process.env.CRON_SECRET) } },
    { headers: { 'Cache-Control': 'no-store' } });
}
