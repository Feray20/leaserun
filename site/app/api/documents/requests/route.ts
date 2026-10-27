import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABEL, isCategory } from '@/lib/documents/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Open document requests for the signed-in owner.
export async function GET(req: Request) {
  if (!adminConfigured()) return json({ requests: [] });
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  const { data, error } = await supabaseAdmin()
    .from('lr_document_requests')
    .select('id, object_ref, category, note, status, created_at')
    .eq('owner_id', user.id)
    .eq('status', 'offen')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return json({ error: 'Couldn’t load requests.' }, 502);
  return json({ requests: (data ?? []).map((r) => ({ ...r, label: isCategory(r.category) ? CATEGORY_LABEL[r.category] : r.category })) });
}

// Mark a request as done.
export async function PATCH(req: Request) {
  if (!adminConfigured()) return json({ error: 'Not available.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Invalid request.' }, 400);
  const { data, error } = await supabaseAdmin()
    .from('lr_document_requests')
    .update({ status: 'erledigt', resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_id', user.id)
    .eq('status', 'offen')
    .select('id');
  if (error) return json({ error: 'Saving failed.' }, 502);
  if (!data?.length) return json({ error: 'Request not found.' }, 404);
  return json({ ok: true });
}
