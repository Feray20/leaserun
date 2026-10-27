import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { isValidShareToken, sha256Token } from '@/lib/security/share-token';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABEL, isCategory } from '@/lib/documents/files';
import { sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Empfänger eines geöffneten Datenraums fordert eine fehlende Unterlage beim Eigentümer an.
// Je Freigabe und Kategorie ist höchstens eine offene Anfrage möglich.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Datenraum nicht verfügbar.' }, 503);
  const ipHash = anonymizedIpHash(req) ?? 'unknown';
  if (!allowRequest(`roomreq:${ipHash}`, 10, 60 * 60_000)) return json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429);
  const body = (await req.json().catch(() => null)) as { token?: unknown; category?: unknown; note?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const note = typeof body?.note === 'string' ? body.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) : '';
  if (!isValidShareToken(token) || !isCategory(body?.category)) return json({ error: 'Bitte eine Kategorie wählen.' }, 400);
  const category = body!.category as keyof typeof CATEGORY_LABEL;

  const db = supabaseAdmin();
  const { data: share } = await db
    .from('lr_data_room_shares')
    .select('id, owner_id, object_ref, expires_at, revoked_at, view_count')
    .eq('token_hash', sha256Token(token))
    .maybeSingle();
  if (!share || !share.object_ref || share.revoked_at || new Date(share.expires_at).getTime() <= Date.now() || !(Number(share.view_count) >= 1)) {
    return json({ error: 'Link ungültig, widerrufen oder abgelaufen.' }, 404);
  }

  const ins = await db.from('lr_document_requests').insert({ share_id: share.id, owner_id: share.owner_id, object_ref: share.object_ref, category, note });
  if (ins.error) {
    if (ins.error.code === '23505') return json({ ok: true, duplicate: true, message: 'Diese Unterlage ist bereits angefordert.' });
    return json({ error: 'Anfrage konnte nicht gespeichert werden.' }, 502);
  }
  await db.from('lr_data_room_access_log').insert({
    share_id: share.id, owner_id: share.owner_id, actor_type: 'viewer', action: 'request', ip_hash: ipHash,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 160), metadata: { category },
  });

  // Eigentümer benachrichtigen (nur wenn E-Mail-Versand konfiguriert ist). Kein Inhalt der Notiz im Betreff.
  let notified = false;
  try {
    const { data: u } = await db.auth.admin.getUserById(share.owner_id);
    const to = u?.user?.email;
    if (to) {
      notified = await sendMail(to, 'LeaseRun: Unterlage angefordert',
        `Über Ihren Freigabelink wurde eine Unterlage angefordert:\n\nKategorie: ${CATEGORY_LABEL[category]}\n${note ? `Hinweis: ${note}\n` : ''}\nSie können die Unterlage in Ihrem Konto unter „Unterlagen & Datenraum“ hochladen und die Anfrage dort als erledigt markieren:\nhttps://leaserun.com/app/dashboard`);
    }
  } catch {
    notified = false;
  }
  return json({ ok: true, notified }, 201);
}
