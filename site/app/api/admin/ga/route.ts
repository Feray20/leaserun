import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';

// Web-Admin → Analyse: Google Analytics 4 (Mess-ID G-…) eintragen und ein-/ausschalten. Nur der Inhaber.
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
export async function GET(req: Request) {
  const a = await requireAdmin(req, 'stats'); if (a instanceof NextResponse) return a;
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'ga4').maybeSingle();
  const v = (data?.value || {}) as { id?: string; on?: boolean; at?: string };
  return NextResponse.json({ id: v.id || '', on: Boolean(v.on), at: v.at || null }, { headers: noStore });
}
const Body = z.object({ id: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^G-[A-Z0-9]{4,14}$/)]), on: z.boolean() });
export async function POST(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'Die Mess-ID beginnt mit „G-“, z. B. G-AB12CD34EF (Google Analytics → Verwaltung → Datenstreams).' }, { status: 400, headers: noStore });
  if (p.data.on && !p.data.id) return NextResponse.json({ error: 'Zum Einschalten zuerst die Mess-ID eintragen.' }, { status: 400, headers: noStore });
  const value = { id: p.data.id, on: p.data.on, at: new Date().toISOString() };
  const w = await supabaseAdmin().from('lr_settings').upsert({ key: 'ga4', value, updated_by: a.user.email });
  if (w.error) return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500, headers: noStore });
  await adminAudit(a.user.email, 'ga4_settings', null, { id: p.data.id, on: p.data.on });
  return NextResponse.json({ ...value, message: p.data.on ? 'Google Analytics ist eingeschaltet – Besucher werden vorher um Einwilligung gebeten (wirkt in wenigen Minuten).' : 'Google Analytics ist ausgeschaltet.' }, { headers: noStore });
}
