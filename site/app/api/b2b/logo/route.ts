import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { canCobrand, type B2BAccount } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { staticScan, threatMessage } from '@/lib/security/filescan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'b2b-logos';
const MAX = 1024 * 1024;

function sniff(b: Buffer): 'image/png' | 'image/jpeg' | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

// Öffentlich: Logo eines Partners mit Co-Branding-Berechtigung (für Partnerseite und Widget).
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!/^[a-z0-9-]{3,40}$/.test(slug) || !adminConfigured()) return new NextResponse(null, { status: 404 });
  if (!allowRequest(`logo:${anonymizedIpHash(req) ?? 'x'}`, 120, 60_000)) return new NextResponse(null, { status: 429 });
  const db = supabaseAdmin();
  const { data } = await db.from('lr_b2b_accounts').select('*').eq('slug', slug).eq('status', 'active').maybeSingle();
  if (!data || !data.logo_path || !canCobrand(data as B2BAccount)) return new NextResponse(null, { status: 404 });
  const dl = await db.storage.from(BUCKET).download(data.logo_path);
  if (dl.error || !dl.data) return new NextResponse(null, { status: 404 });
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const type = sniff(buf);
  if (!type) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}

// Logo hochladen (PNG oder JPEG, max. 1 MB). Rohdaten im Body.
export async function POST(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-logo', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX) return json({ error: 'Das Logo ist größer als 1 MB.' }, 413);
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return json({ error: 'Die Datei ist leer.' }, 400);
  if (buf.length > MAX) return json({ error: 'Das Logo ist größer als 1 MB.' }, 413);
  const type = sniff(buf);
  if (!type) return json({ error: 'Bitte PNG oder JPEG hochladen.' }, 415);
  const scan = staticScan(buf);
  if (!scan.clean) return json({ error: threatMessage(scan) }, 422);
  const db = supabaseAdmin();
  const path = `${ctx.account.id}/logo.${type === 'image/png' ? 'png' : 'jpg'}`;
  if (ctx.account.logo_path && ctx.account.logo_path !== path) await db.storage.from(BUCKET).remove([ctx.account.logo_path]);
  const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: true });
  if (up.error) return json({ error: 'Speichern fehlgeschlagen.' }, 502);
  await db.from('lr_b2b_accounts').update({ logo_path: path, updated_at: new Date().toISOString() }).eq('id', ctx.account.id);
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-logo', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const db = supabaseAdmin();
  if (ctx.account.logo_path) await db.storage.from(BUCKET).remove([ctx.account.logo_path]);
  await db.from('lr_b2b_accounts').update({ logo_path: null }).eq('id', ctx.account.id);
  return json({ ok: true });
}
