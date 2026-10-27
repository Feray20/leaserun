import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { canAccess } from '@/lib/security/roles';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
type Hit = { type: 'user' | 'company' | 'request' | 'invoice' | 'booking' | 'mail'; id: string; title: string; subtitle: string; target: string; targetId?: string };
const dmy = (d?: string | null) => (d ? new Date(d).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }) : '');
const eur = (c: number) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Globale Suche der Admin-App: Unternehmen, Konten, Anfragen, Rechnungen, Termine, E-Mails – je Rolle nur die erlaubten Bereiche.
// Höchstens 5 Treffer je Art; Suchbegriffe werden nicht protokolliert (nur die Anzahl der Treffer).
export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'stats');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Suche gerade nicht verfügbar.' }, 503);
  // Nur Buchstaben, Ziffern und wenige Zeichen – keine Filter-Syntax (Komma, Klammern, Sternchen) möglich.
  const raw = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 80);
  const q = raw.replace(/[^\p{L}\p{N}@.\-_ ]/gu, '').replace(/[%_]/g, '').trim();
  if (q.length < 2) return j({ results: [] });
  const pat = `%${q}%`;
  const db = supabaseAdmin();
  const role = auth.role, owner = role === 'owner';
  const rows = <T,>(p: PromiseLike<{ data: T[] | null }>) => Promise.resolve(p).then((r) => r.data ?? [], () => [] as T[]);
  const tasks: Promise<Hit[]>[] = [];

  if (owner) {
    tasks.push(rows<{ id: string; company_name: string; customer_number: string | null; city: string | null; plan_tier: string | null; status: string }>(
      UUID.test(q) ? db.from('lr_b2b_accounts').select('id, company_name, customer_number, city, plan_tier, status').eq('id', q).limit(1)
        : db.from('lr_b2b_accounts').select('id, company_name, customer_number, city, plan_tier, status').or(`company_name.ilike.${pat},customer_number.ilike.${pat},email.ilike.${pat}`).limit(5),
    ).then((r) => r.map((a) => ({ type: 'company' as const, id: a.id, title: a.company_name || 'Unternehmen', subtitle: [a.customer_number, a.city, a.plan_tier ? `Tarif ${a.plan_tier}` : 'ohne Tarif', a.status === 'locked' ? 'gesperrt' : null].filter(Boolean).join(' · '), target: 'unternehmen', targetId: a.id }))));
    tasks.push(rows<{ user_id: string; email: string; created_at: string }>(db.from('lr_user_data').select('user_id, email, created_at').ilike('email', pat).limit(5))
      .then((r) => r.map((u) => ({ type: 'user' as const, id: u.user_id, title: u.email, subtitle: `Konto seit ${dmy(u.created_at)}`, target: 'nutzer', targetId: u.email }))));
    tasks.push(rows<{ id: string; company: string | null; name: string | null; status: string; created_at: string }>(db.from('lr_b2b_contact').select('id, company, name, status, created_at').or(`company.ilike.${pat},name.ilike.${pat}`).order('created_at', { ascending: false }).limit(5))
      .then((r) => r.map((c) => ({ type: 'request' as const, id: c.id, title: c.company || c.name || 'Anfrage', subtitle: `Anfrage · ${c.status} · ${dmy(c.created_at)}`, target: 'anfragen' }))));
  }
  if (canAccess(role, 'finance')) {
    tasks.push(rows<{ id: string; invoice_number: string; gross_cents: number; payment_status: string; issue_date: string; account_id: string | null }>(db.from('lr_invoices').select('id, invoice_number, gross_cents, payment_status, issue_date, account_id').ilike('invoice_number', pat).order('issue_date', { ascending: false }).limit(5))
      .then((r) => r.map((i) => ({ type: 'invoice' as const, id: i.id, title: i.invoice_number, subtitle: `${eur(Number(i.gross_cents || 0))} · ${({ PAID: 'bezahlt', PENDING: 'offen', OVERDUE: 'überfällig' } as Record<string, string>)[i.payment_status] || i.payment_status} · ${i.account_id ? 'B2B' : 'B2C'}`, target: 'zahlungen' }))));
  }
  if (canAccess(role, 'termine')) {
    tasks.push(rows<{ id: string; name: string; company: string | null; starts_at: string; status: string }>(db.from('lr_bookings').select('id, name, company, starts_at, status').or(`name.ilike.${pat},company.ilike.${pat}`).order('starts_at', { ascending: false }).limit(5))
      .then((r) => r.map((b) => ({ type: 'booking' as const, id: b.id, title: b.company ? `${b.name} · ${b.company}` : b.name, subtitle: `Termin ${dmy(b.starts_at)} · ${b.status}`, target: 'termine' }))));
  }
  if (canAccess(role, 'mail')) {
    tasks.push(rows<{ id: string; subject: string | null; from_name: string | null; from_email: string; created_at: string }>(db.from('lr_mail_messages').select('id, subject, from_name, from_email, created_at').neq('folder', 'trash').or(`subject.ilike.${pat},from_email.ilike.${pat},from_name.ilike.${pat}`).order('created_at', { ascending: false }).limit(5))
      .then((r) => r.map((m) => ({ type: 'mail' as const, id: m.id, title: m.subject || '(ohne Betreff)', subtitle: `${m.from_name || m.from_email} · ${dmy(m.created_at)}`, target: 'mail', targetId: m.id }))));
  }
  const results = (await Promise.all(tasks)).flat();
  await adminAudit(auth.user.email, 'app_search', null, { results: results.length }).catch(() => null);
  return j({ results });
}
