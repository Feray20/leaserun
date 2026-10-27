import { after, NextResponse } from 'next/server';
import { sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';
import { isValidShareToken, sha256Token } from '@/lib/security/share-token';
import { adminConfigured, anonymizedIpHash, loadOwnerObject, supabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABEL, isCategory, type Category } from '@/lib/documents/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

type ShareRow = { id: string; owner_id: string; object_ref: string | null; permissions: { categories?: unknown[] } | null; expires_at: string; view_count: number; max_views: number | null };

// Öffnet einen Datenraum per Token. Gültigkeit, Ablauf, Widerruf und Abrufzähler werden atomar geprüft.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Datenraum nicht verfügbar.' }, 503);
  const ipHash = anonymizedIpHash(req) ?? 'unknown';
  if (!allowRequest(`room:${ipHash}`, 20, 60_000)) return json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429);

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!isValidShareToken(token)) return json({ error: 'Ungültiger oder abgelaufener Link.' }, 404);

  const db = supabaseAdmin();
  const { data, error } = await db.rpc('lr_consume_share', { p_token_hash: sha256Token(token) });
  const share = (Array.isArray(data) ? data[0] : null) as ShareRow | null;
  if (error || !share || !share.object_ref) return json({ error: 'Ungültiger, widerrufener oder abgelaufener Link.' }, 404);

  const categories = (share.permissions?.categories ?? []).filter(isCategory) as Category[];
  const { data: docs } = await db
    .from('lr_documents')
    .select('id, category, filename, mime_type, size_bytes, sha256, status, created_at')
    .eq('owner_id', share.owner_id)
    .eq('object_ref', share.object_ref)
    .in('category', categories.length ? categories : ['__none__'])
    .order('category')
    .order('created_at', { ascending: false });

  const obj = categories.includes('objekt') ? await loadOwnerObject(share.owner_id, share.object_ref) : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const object = obj
    ? {
        name: typeof obj.name === 'string' ? obj.name : 'Objekt',
        price: num(obj.price), rent: num(obj.rent), area: num(obj.area), yearBuilt: num(obj.yearBuilt),
        loan: num(obj.loan), interestPct: num(obj.interestPct), repaymentPct: num(obj.repaymentPct), lendingValue: num(obj.lendingValue),
      }
    : null;

  await db.from('lr_data_room_access_log').insert({
    share_id: share.id, owner_id: share.owner_id, actor_type: 'viewer', action: 'open', ip_hash: ipHash,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 160), metadata: { view: share.view_count },
  });

  // Beim ersten Öffnen den Eigentümer benachrichtigen (nach der Antwort, nur wenn E-Mail-Versand konfiguriert ist).
  if (share.view_count === 1) {
    const objName = obj && typeof obj.name === 'string' ? obj.name : null;
    after(async () => {
      try {
        const { data: u } = await db.auth.admin.getUserById(share.owner_id);
        const to = u?.user?.email;
        if (to) {
          await sendMail(to, 'LeaseRun: Ihr Datenraum wurde geöffnet',
            `Ihr Freigabelink${objName ? ` für „${objName}“` : ''} wurde soeben zum ersten Mal geöffnet.\n\nGültig bis: ${new Date(share.expires_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}\n${share.max_views ? `Verbleibende Aufrufe: ${Math.max(0, share.max_views - share.view_count)}\n` : ''}\nAlle Zugriffe sehen Sie im Konto unter „Unterlagen & Datenraum“. Dort können Sie den Link jederzeit sofort widerrufen:\nhttps://leaserun.com/app/dashboard\n\nWaren Sie das nicht oder haben Sie den Link nicht weitergegeben? Widerrufen Sie ihn bitte umgehend.`);
        }
      } catch {
        /* Benachrichtigung ist optional */
      }
    });
  }

  return json({
    expiresAt: share.expires_at,
    viewsLeft: share.max_views === null ? null : Math.max(0, share.max_views - share.view_count),
    categories: categories.map((c) => ({ key: c, label: CATEGORY_LABEL[c] })),
    object,
    documents: docs ?? [],
  });
}
