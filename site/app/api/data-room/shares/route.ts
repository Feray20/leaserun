import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { generateShareToken, sha256Token } from '@/lib/security/share-token';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORIES } from '@/lib/documents/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const CreateSchema = z.object({
  objectRef: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/),
  categories: z.array(z.enum(CATEGORIES)).min(1),
  days: z.union([z.literal(2), z.literal(7), z.literal(30)]),
  maxViews: z.number().int().min(1).max(100).nullable(),
  label: z.string().max(80).optional(),
});

// Eigene Freigaben mit Zugriffsprotokoll.
export async function GET(req: Request) {
  if (!adminConfigured()) return json({ error: 'Datenraum nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  const db = supabaseAdmin();
  const objectRef = new URL(req.url).searchParams.get('objectRef');
  let q = db
    .from('lr_data_room_shares')
    .select('id, object_ref, permissions, expires_at, revoked_at, created_at, max_views, view_count')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (objectRef) q = q.eq('object_ref', objectRef);
  const { data: shares, error } = await q;
  if (error) return json({ error: 'Freigaben konnten nicht geladen werden.' }, 502);
  const { data: log } = await db
    .from('lr_data_room_access_log')
    .select('share_id, action, document_id, created_at, metadata')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  return json({ shares: shares ?? [], log: log ?? [] });
}

// Neue Freigabe: 256-Bit-Token, in der Datenbank nur als SHA-256-Hash.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Datenraum nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`share:${user.id}`, 10, 60_000)) return json({ error: 'Zu viele Anfragen.' }, 429);
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Bitte Kategorien und Laufzeit wählen.' }, 400);
  const p = parsed.data;

  const token = generateShareToken();
  const expiresAt = new Date(Date.now() + p.days * 24 * 3600 * 1000).toISOString();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('lr_data_room_shares')
    .insert({
      owner_id: user.id,
      created_by: user.id,
      object_ref: p.objectRef,
      token_hash: sha256Token(token),
      permissions: { categories: p.categories, label: p.label ?? null },
      expires_at: expiresAt,
      max_views: p.maxViews,
    })
    .select('id')
    .single();
  if (error || !data) return json({ error: 'Freigabe konnte nicht erstellt werden.' }, 502);
  await db.from('lr_data_room_access_log').insert({ share_id: data.id, owner_id: user.id, actor_type: 'owner', action: 'share_created', metadata: { categories: p.categories, days: p.days, maxViews: p.maxViews } });

  // Token steht im Fragment (#), damit es nicht in Server-Logs oder Referrern landet.
  const url = `${new URL(req.url).origin}/datenraum#t=${token}`;
  const qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0F172A', light: '#FFFFFF' } });
  return json({ id: data.id, url, qrSvg, expiresAt }, 201);
}

// Sofortiger Widerruf.
export async function DELETE(req: Request) {
  if (!adminConfigured()) return json({ error: 'Datenraum nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Ungültige Anfrage.' }, 400);
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('lr_data_room_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_id', user.id)
    .is('revoked_at', null)
    .select('id');
  if (error) return json({ error: 'Widerruf fehlgeschlagen.' }, 502);
  if (!data?.length) return json({ error: 'Freigabe nicht gefunden oder bereits widerrufen.' }, 404);
  await db.from('lr_data_room_access_log').insert({ share_id: id, owner_id: user.id, actor_type: 'owner', action: 'share_revoked', metadata: {} });
  return json({ revoked: true });
}
