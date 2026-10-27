import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { customerScope, scopeError } from '@/lib/admin/scope';
import { FeedbackAdmin } from '@/lib/feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// Web-Admin → Improvement suggestions: only suggestions for the selected area (B2C or B2B).
export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'support');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Not configured.' }, 503);
  const scope = customerScope(req);
  if (!scope) return j(scopeError, 400);
  const db = supabaseAdmin();
  const { data, error } = await db.from('lr_feedback').select('*').eq('area', scope).order('created_at', { ascending: false }).limit(500);
  if (error) return j({ error: error.message }, 500);
  const rows = data ?? [];
  // Sender: account email, for businesses also the company name.
  const ids = [...new Set(rows.map((r) => String(r.user_id)))];
  const emails = new Map<string, string>();
  await Promise.all(ids.slice(0, 200).map(async (id) => { const { data: u } = await db.auth.admin.getUserById(id); if (u?.user?.email) emails.set(id, u.user.email); }));
  const accIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))] as string[];
  const firms = new Map<string, string>();
  if (accIds.length) { const { data: a } = await db.from('lr_b2b_accounts').select('id, company_name').in('id', accIds); (a ?? []).forEach((x) => firms.set(x.id, x.company_name)); }
  return j({ scope, items: rows.map((r) => ({ ...r, email: emails.get(String(r.user_id)) || null, company: r.account_id ? firms.get(r.account_id) || null : null })) });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin(req, 'support');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Not configured.' }, 503);
  const scope = customerScope(req);
  if (!scope) return j(scopeError, 400);
  const p = FeedbackAdmin.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Invalid input.' }, 400);
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.data.status) upd.status = p.data.status;
  if (p.data.adminRating !== undefined) upd.admin_rating = p.data.adminRating;
  if (p.data.adminNote !== undefined) upd.admin_note = p.data.adminNote || null;
  if (p.data.answer !== undefined) upd.answer = p.data.answer || null;
  const { data, error } = await supabaseAdmin().from('lr_feedback').update(upd).eq('id', p.data.id).eq('area', scope).select('id').maybeSingle();
  if (error) return j({ error: error.message }, 500);
  if (!data) return j({ error: 'Not found (different area?).' }, 404);
  await adminAudit(auth.user.email, 'feedback_update', p.data.id, { scope, status: p.data.status, rating: p.data.adminRating });
  return j({ ok: true });
}
