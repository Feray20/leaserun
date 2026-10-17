import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABEL, isCategory } from '@/lib/documents/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Offene Unterlagen-Anforderungen des angemeldeten Eigentümers.
export async function GET(req: Request) {
  if (!adminConfigured()) return json({ requests: [] });
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  const { data, error } = await supabaseAdmin()
    .from('immo_document_requests')
    .select('id, object_ref, category, note, status, created_at')
    .eq('owner_id', user.id)
    .eq('status', 'offen')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return json({ error: 'Anfragen konnten nicht geladen werden.' }, 502);
  return json({ requests: (data ?? []).map((r) => ({ ...r, label: isCategory(r.category) ? CATEGORY_LABEL[r.category] : r.category })) });
}

// Anfrage als erledigt markieren.
export async function PATCH(req: Request) {
  if (!adminConfigured()) return json({ error: 'Nicht verfügbar.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Ungültige Anfrage.' }, 400);
  const { data, error } = await supabaseAdmin()
    .from('immo_document_requests')
    .update({ status: 'erledigt', resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_id', user.id)
    .eq('status', 'offen')
    .select('id');
  if (error) return json({ error: 'Speichern fehlgeschlagen.' }, 502);
  if (!data?.length) return json({ error: 'Anfrage nicht gefunden.' }, 404);
  return json({ ok: true });
}
