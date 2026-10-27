import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { billingEnabled } from '@/lib/billing/stripe';
import { customerScope, scopeError } from '@/lib/admin/scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Betreiber-Übersicht: nur Zählwerte, keine personenbezogenen Inhalte.
export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'stats');
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
  const scope = customerScope(req);
  if (!scope) return NextResponse.json(scopeError, { status: 400 });
  const config = { billing: billingEnabled(), mail: Boolean(process.env.RESEND_API_KEY && (process.env.NOTIFY_FROM_EMAIL || process.env.CANCEL_FROM_EMAIL)), cron: Boolean(process.env.CRON_SECRET) };
  if (scope === 'b2b') {
    // Nur Unternehmensdaten.
    const [b2b, b2bActive, leads, contactsOpen, versions, submissions, partners] = await Promise.all([
      count('lr_b2b_accounts'),
      count('lr_b2b_accounts', (q) => q.eq('status', 'active').not('plan_tier', 'is', null)),
      count('lr_b2b_leads'),
      count('lr_b2b_contact', (q) => q.eq('status', 'offen')),
      count('lr_kreditmappe_versions', (q) => q.not('b2b_account_id', 'is', null)),
      count('lr_b2b_submissions'),
      count('lr_partners', (q) => q.eq('active', true)),
    ]);
    return NextResponse.json({ scope, b2b, b2bActive, leads, contactsOpen, versions, submissions, partners, config }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // Nur Privatkunden (Konto-Daten der Anwendung, Kreditmappen ohne Unternehmen). Nutzer, die einem Unternehmen
  // angehören, werden ausgeschlossen, damit keine B2B-Zahlen in die B2C-Ansicht rutschen.
  const { data: mem } = await db.from('lr_b2b_members').select('user_id').limit(10000);
  const biz = [...new Set((mem ?? []).map((m) => String(m.user_id)))];
  const notBiz = (col: string) => (q: any) => (biz.length ? q.not(col, 'in', `(${biz.join(',')})`) : q); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [users, users7, docs, shares, sharesActive, versions, reminders, requestsOpen] = await Promise.all([
    count('lr_user_data', notBiz('user_id')),
    count('lr_user_data', (q) => notBiz('user_id')(q.gte('created_at', since(7)))),
    count('lr_documents', notBiz('owner_id')),
    count('lr_data_room_shares'),
    count('lr_data_room_shares', (q) => q.is('revoked_at', null).gt('expires_at', new Date().toISOString())),
    count('lr_kreditmappe_versions', (q) => q.is('b2b_account_id', null)),
    count('lr_user_data', (q) => notBiz('user_id')(q.eq('profile->>reminders', 'true'))),
    count('lr_document_requests', (q) => q.eq('status', 'offen')),
  ]);
  // Objekte: Summe der Objektlisten (nur Anzahl)
  const { data: od } = await notBiz('user_id')(db.from('lr_user_data').select('objects')).limit(5000);
  const objects = ((od ?? []) as { objects?: unknown }[]).reduce((s: number, r) => s + (Array.isArray(r.objects) ? r.objects.length : 0), 0);
  return NextResponse.json({ scope, users, users7, objects, docs, shares, sharesActive, versions, reminders, requestsOpen, config },
    { headers: { 'Cache-Control': 'no-store' } });
}
