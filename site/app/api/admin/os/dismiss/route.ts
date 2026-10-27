import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Verworfene Entscheidungen (Agenten-Punkte, Hinweise) – gemeinsam für Web-Admin und Admin-App, je 24 Stunden.
const KEY = 'hq_dismissed';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
type Map = Record<string, number>;
async function load(): Promise<Map> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  const m = (data?.value && typeof data.value === 'object' ? data.value : {}) as Map, now = Date.now();
  for (const k of Object.keys(m)) if (!(m[k] > now)) delete m[k];
  return m;
}

export async function GET(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  return j({ dismissed: await load() });
}

export async function POST(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as { key?: string };
  const k = String(b.key || '').slice(0, 300);
  if (!k) return j({ error: 'Schlüssel fehlt.' }, 400);
  const m = await load();
  m[k] = Date.now() + 86400_000;
  const keys = Object.keys(m); if (keys.length > 500) for (const x of keys.slice(0, keys.length - 500)) delete m[x];
  await supabaseAdmin().from('lr_settings').upsert({ key: KEY, value: m });
  return j({ dismissed: m });
}
