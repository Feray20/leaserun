import { after, NextResponse } from 'next/server';
import { sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';
import { isValidShareToken, sha256Token } from '@/lib/security/share-token';
import { adminConfigured, anonymizedIpHash, loadOwnerObject, supabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABEL, isCategory, PROPERTY_DATA_CATEGORIES, type Category } from '@/lib/documents/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

type ShareRow = { id: string; owner_id: string; object_ref: string | null; permissions: { categories?: unknown[] } | null; expires_at: string; view_count: number; max_views: number | null };

// Opens a data room by token. Validity, expiry, revocation and view counter are checked atomically.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Data room not available.' }, 503);
  const ipHash = anonymizedIpHash(req) ?? 'unknown';
  if (!allowRequest(`room:${ipHash}`, 20, 60_000)) return json({ error: 'Too many requests. Please try again later.' }, 429);

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!isValidShareToken(token)) return json({ error: 'Invalid or expired link.' }, 404);

  const db = supabaseAdmin();
  const { data, error } = await db.rpc('lr_consume_share', { p_token_hash: sha256Token(token) });
  const share = (Array.isArray(data) ? data[0] : null) as ShareRow | null;
  if (error || !share || !share.object_ref) return json({ error: 'Invalid, revoked or expired link.' }, 404);

  const categories = (share.permissions?.categories ?? []).filter(isCategory) as Category[];
  const { data: docs } = await db
    .from('lr_documents')
    .select('id, category, filename, mime_type, size_bytes, sha256, status, created_at')
    .eq('owner_id', share.owner_id)
    .eq('object_ref', share.object_ref)
    .in('category', categories.length ? categories : ['__none__'])
    .order('category')
    .order('created_at', { ascending: false });

  const obj = categories.some((c) => PROPERTY_DATA_CATEGORIES.includes(c)) ? await loadOwnerObject(share.owner_id, share.object_ref) : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const object = obj
    ? {
        name: typeof obj.name === 'string' ? obj.name : 'Property',
        price: num(obj.price), rent: num(obj.rent), area: num(obj.area), yearBuilt: num(obj.yearBuilt),
        loan: num(obj.loan), interestPct: num(obj.interestPct), repaymentPct: num(obj.repaymentPct), lendingValue: num(obj.lendingValue),
      }
    : null;

  await db.from('lr_data_room_access_log').insert({
    share_id: share.id, owner_id: share.owner_id, actor_type: 'viewer', action: 'open', ip_hash: ipHash,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 160), metadata: { view: share.view_count },
  });

  // Notify the owner on first open (after the response, only if email sending is configured).
  if (share.view_count === 1) {
    const objName = obj && typeof obj.name === 'string' ? obj.name : null;
    after(async () => {
      try {
        const { data: u } = await db.auth.admin.getUserById(share.owner_id);
        const to = u?.user?.email;
        if (to) {
          await sendMail(to, 'LeaseRun: Your data room was opened',
            `Your share link${objName ? ` for "${objName}"` : ''} was just opened for the first time.\n\nValid until: ${new Date(share.expires_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET\n${share.max_views ? `Views remaining: ${Math.max(0, share.max_views - share.view_count)}\n` : ''}\nYou can see every access in your account under "Documents & Data Room". You can also revoke the link there at any time, effective immediately:\nhttps://leaserun.com/app/dashboard\n\nWasn't this expected, or didn't you share the link? Please revoke it right away.`);
        }
      } catch {
        /* notification is optional */
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
