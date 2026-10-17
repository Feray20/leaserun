import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { isValidShareToken, sha256Token } from '@/lib/security/share-token';
import { adminConfigured, anonymizedIpHash, DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Einzelnes Dokument aus einem Datenraum: prüft Freigabe (ohne Zähler zu erhöhen), protokolliert,
// und liefert einen signierten Link mit 120 Sekunden Gültigkeit.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Datenraum nicht verfügbar.' }, 503);
  const ipHash = anonymizedIpHash(req) ?? 'unknown';
  if (!allowRequest(`roomfile:${ipHash}`, 60, 60_000)) return json({ error: 'Zu viele Anfragen.' }, 429);
  const body = (await req.json().catch(() => null)) as { token?: unknown; documentId?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const documentId = typeof body?.documentId === 'string' ? body.documentId : '';
  if (!isValidShareToken(token) || !/^[0-9a-f-]{36}$/.test(documentId)) return json({ error: 'Ungültige Anfrage.' }, 400);

  const db = supabaseAdmin();
  const { data: share } = await db
    .from('immo_data_room_shares')
    .select('id, owner_id, object_ref, permissions, expires_at, revoked_at, view_count')
    .eq('token_hash', sha256Token(token))
    .maybeSingle();
  // Download nur nach geöffnetem Datenraum (Abruf gezählt) und nur innerhalb der Laufzeit.
  if (!share || !share.object_ref || share.revoked_at || new Date(share.expires_at).getTime() <= Date.now() || !(Number(share.view_count) >= 1)) {
    return json({ error: 'Link ungültig, widerrufen oder abgelaufen.' }, 404);
  }
  const categories = Array.isArray((share.permissions as { categories?: unknown })?.categories)
    ? ((share.permissions as { categories: unknown[] }).categories as string[])
    : [];
  const { data: doc } = await db
    .from('immo_documents')
    .select('id, storage_key, category, filename')
    .eq('id', documentId)
    .eq('owner_id', share.owner_id)
    .eq('object_ref', share.object_ref)
    .maybeSingle();
  if (!doc || !doc.storage_key || !categories.includes(doc.category ?? '')) return json({ error: 'Dokument nicht freigegeben.' }, 403);

  const signed = await db.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.storage_key, 120, { download: doc.filename });
  if (signed.error || !signed.data) return json({ error: 'Dokument nicht verfügbar.' }, 502);
  await db.from('immo_data_room_access_log').insert({
    share_id: share.id, owner_id: share.owner_id, actor_type: 'viewer', action: 'download', document_id: doc.id, ip_hash: ipHash,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 160), metadata: {},
  });
  return json({ url: signed.data.signedUrl });
}
