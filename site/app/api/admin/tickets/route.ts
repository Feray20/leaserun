import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { customerScope } from '@/lib/admin/scope';
import { SUP_STATUS, SupportAdmin, ticketNo } from '@/lib/support';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin "Technical problems": reports for the active area (B2C or B2B) with screenshots (signed links, 10 minutes).
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'support');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Not configured.' }, 503);
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

// Set status, answer (optionally with an email to the customer), internal note.
export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'support');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Not configured.' }, 503);
  const p = SupportAdmin.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Invalid.' }, 400);
  const d = p.data, db = supabaseAdmin();
  const { data: cur } = await db.from('lr_support_tickets').select('id, no, area, user_email, title, answer, status').eq('id', d.id).maybeSingle();
  if (!cur) return j({ error: 'Report not found.' }, 404);
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
    mailed = await sendMail(cur.user_email, `Update on your report ${ref}`, `Hi there,\n\nthere's an answer to your report "${cur.title}" (${ref}):\n\n${d.answer}\n\nStatus: ${st}\n\nBest regards,\nThe LeaseRun team`, [], {
      area: cur.area as 'b2c' | 'b2b', title: `Update on ${ref}`, button: { label: 'View report', url: cur.area === 'b2b' ? 'https://leaserun.com/business-portal#support' : 'https://leaserun.com/app/dashboard#konto' },
    }).catch(() => false);
  }
  return j({ ok: true, mailed });
}
