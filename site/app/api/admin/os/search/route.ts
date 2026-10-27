import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadLinks } from '@/lib/cloud/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Firmen-OS: eine Suche über alles (Unternehmen, Kontakte, Rechnungen, E-Mails, Datei-Links).
// Nur lesend, je Bereich höchstens 5 Treffer; Apps und Agenten sucht der Browser selbst.
type Hit = { kind: string; title: string; sub: string; tab: string; sg?: string };
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  const q = (new URL(req.url).searchParams.get('q') || '').trim().replace(/[%_,()]/g, ' ').slice(0, 60);
  if (q.length < 2) return j({ hits: [] });
  const db = supabaseAdmin(), like = `%${q}%`;
  const safe = async <T,>(p: PromiseLike<unknown>): Promise<T[]> => { try { return ((await p) as { data: T[] | null }).data || []; } catch { return []; } };
  const [acc, crm, inv, mail, links] = await Promise.all([
    safe<{ company_name?: string; email?: string }>(db.from('lr_b2b_accounts').select('company_name, email').or(`company_name.ilike.${like},email.ilike.${like}`).limit(5)),
    safe<{ company?: string; contact_name?: string; email?: string; status?: string }>(db.from('lr_crm_contacts').select('company, contact_name, email, status').or(`company.ilike.${like},contact_name.ilike.${like},email.ilike.${like}`).limit(5)),
    safe<{ invoice_number?: string; payment_status?: string; gross_cents?: number }>(db.from('lr_invoices').select('invoice_number, payment_status, gross_cents').ilike('invoice_number', like).limit(5)),
    safe<{ subject?: string; from_name?: string; from_email?: string }>(db.from('lr_mail_messages').select('subject, from_name, from_email').or(`subject.ilike.${like},from_email.ilike.${like},from_name.ilike.${like}`).neq('folder', 'trash').order('created_at', { ascending: false }).limit(5)),
    loadLinks().catch(() => []),
  ]);
  const ql = q.toLowerCase();
  const hits: Hit[] = [
    ...acc.map((x) => ({ kind: 'Unternehmen', title: x.company_name || x.email || '–', sub: x.email || '', tab: 'partner', sg: 'b2b' })),
    ...crm.map((x) => ({ kind: 'Kontakt', title: x.company || x.contact_name || x.email || '–', sub: [x.contact_name, x.status].filter(Boolean).join(' · '), tab: 'akquise', sg: 'b2b' })),
    ...inv.map((x) => ({ kind: 'Rechnung', title: x.invoice_number || '–', sub: [x.payment_status, x.gross_cents != null ? `${(x.gross_cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}` : ''].filter(Boolean).join(' · '), tab: 'rechnungen', sg: 'b2b' })),
    ...mail.map((x) => ({ kind: 'E-Mail', title: x.subject || '(ohne Betreff)', sub: x.from_name || x.from_email || '', tab: 'postfach' })),
    ...links.filter((l) => l.label.toLowerCase().includes(ql)).slice(0, 5).map((l) => ({ kind: 'Dateien', title: l.label, sub: l.mode === 'out' ? 'Senden' : 'Empfangen', tab: 'system' })),
  ];
  return j({ hits });
}
