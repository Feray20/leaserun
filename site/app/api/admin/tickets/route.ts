import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { customerScope } from '@/lib/admin/scope';
import { SUP_STATUS, SupportAdmin, ticketNo } from '@/lib/support';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin „Technische Probleme“: Meldungen des aktiven Bereichs (B2C bzw. B2B) mit Screenshots (signierte Links, 10 Minuten).
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'support');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const u = new URL(req.url);
  const scope = customerScope(req);
  const area = u.searchParams.get('area') === 'b2b' ? 'b2b' : u.searchParams.get('area') === 'b2c' ? 'b2c' : scope || null;
  const open = u.searchParams.get('open') === '1';
  const db = supabaseAdmin();
  let q = db.from('lr_support_tickets').select('*').order('created_at', { ascending: false }).limit(200);
  if (area) q = q.eq('area', area);
  if (open) q = q.in('status', ['neu', 'in_arbeit', 'rueckfrage']);
  const { data, error } = await q;
  if (error) return j({ error: error.message }, 500);
  const items = await Promise.all((data ?? []).map(async (t) => {
    const shots = await Promise.all(((t.shots as string[] | null) ?? []).map(async (p) => (await db.storage.from('support-shots').createSignedUrl(p, 600)).data?.signedUrl ?? null));
    let company: string | null = null;
    if (t.account_id) company = (await db.from('lr_b2b_accounts').select('company_name').eq('id', t.account_id).maybeSingle()).data?.company_name ?? null;
    return { ...t, ref: ticketNo(t.no), company, shotUrls: shots.filter(Boolean) };
  }));
  const openCount = items.filter((t) => ['neu', 'in_arbeit', 'rueckfrage'].includes(t.status)).length;
  return j({ items, open: openCount });
}

// Status setzen, antworten (optional mit E-Mail an den Kunden), interne Notiz.
export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'support');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = SupportAdmin.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const d = p.data, db = supabaseAdmin();
  const { data: cur } = await db.from('lr_support_tickets').select('id, no, area, user_email, title, answer, status').eq('id', d.id).maybeSingle();
  if (!cur) return j({ error: 'Meldung nicht gefunden.' }, 404);
  const now = new Date().toISOString();
  const up: Record<string, unknown> = { updated_at: now };
  if (d.status) { up.status = d.status; if (d.status === 'geloest' || d.status === 'geschlossen') up.resolved_at = now; }
  if (d.answer !== undefined) { up.answer = d.answer || null; if (d.answer && d.answer !== cur.answer) up.answered_at = now; }
  if (d.adminNote !== undefined) up.admin_note = d.adminNote || null;
  const r = await db.from('lr_support_tickets').update(up).eq('id', d.id);
  if (r.error) return j({ error: r.error.message }, 500);
  await adminAudit(auth.user.email, 'support_ticket', d.id, { status: d.status, antwort: d.answer ? 'ja' : undefined });
  let mailed = false;
  if (d.notify && d.answer && cur.user_email && mailConfigured()) {
    const ref = ticketNo(cur.no), st = SUP_STATUS[(d.status || cur.status) as keyof typeof SUP_STATUS] || '';
    mailed = await sendMail(cur.user_email, `Antwort zu Ihrer Meldung ${ref}`, `Guten Tag,\n\nzu Ihrer Meldung „${cur.title}“ (${ref}) gibt es eine Antwort:\n\n${d.answer}\n\nStatus: ${st}\n\nMit freundlichen Grüßen\nIhr LeaseRun-Team`, [], {
      area: cur.area as 'b2c' | 'b2b', title: `Antwort zu ${ref}`, button: { label: 'Meldung ansehen', url: cur.area === 'b2b' ? 'https://leaserun.com/business-portal#support' : 'https://leaserun.com/app/dashboard#konto' },
    }).catch(() => false);
  }
  return j({ ok: true, mailed });
}
