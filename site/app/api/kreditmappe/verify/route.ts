import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Öffentliche Echtheitsprüfung: liefert zu einer Versions-Kennung nur Erstellungszeitpunkt,
// Versionsnummer und Prüfsumme – keine personen- oder objektbezogenen Daten.
export async function POST(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: 'Prüfung nicht verfügbar.' }, { status: 503 });
  if (!allowRequest(`verify:${anonymizedIpHash(req) ?? 'x'}`, 30, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { versionId?: unknown } | null;
  const id = typeof body?.versionId === 'string' ? body.versionId : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return NextResponse.json({ error: 'Ungültige Kennung.' }, { status: 400 });
  const { data } = await supabaseAdmin()
    .from('lr_kreditmappe_versions')
    .select('version_no, sha256, byte_size, created_at, b2b_account_id')
    .eq('id', id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'Zu dieser Kennung ist keine Kreditmappe registriert.' }, { status: 404 });
  // Aufruf zählen (für die Betreiber-Statistik; nur Kennung, Konto und gekürzter IP-Hash).
  await supabaseAdmin().from('lr_verify_views').insert({ version_id: id, b2b_account_id: data.b2b_account_id ?? null, ip_hash: anonymizedIpHash(req) }).then(() => null, () => null);
  return NextResponse.json(
    { versionNo: data.version_no, sha256: data.sha256, byteSize: data.byte_size, createdAt: data.created_at, viaPartner: Boolean(data.b2b_account_id) },
    { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
  );
}
