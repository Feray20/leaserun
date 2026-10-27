import { createHash } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { allowRequest } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Technische Fehlermeldungen aus dem Browser sammeln (für den Web-Admin). Keine IP, keine Nutzerkennung, keine Inhalte.
const Body = z.object({ m: z.string().min(1).max(300), s: z.string().max(200).optional(), l: z.number().int().min(0).max(1e7).optional(), c: z.number().int().min(0).max(1e7).optional(), p: z.string().max(120).optional() });
const ok = () => new NextResponse(null, { status: 204 });

function browserOf(ua: string): string {
  const mob = /Mobile|iPhone|Android/i.test(ua) ? ' mobil' : '';
  if (/Edg\//.test(ua)) return 'Edge' + mob;
  if (/Firefox\//.test(ua)) return 'Firefox' + mob;
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return 'Chrome' + mob;
  if (/Safari\//.test(ua)) return 'Safari' + mob;
  return 'andere' + mob;
}

export async function POST(req: Request) {
  if (!adminConfigured()) return ok();
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`client-error:${ip}`, 20, 10 * 60_000)) return ok();
  const raw = await req.text().catch(() => '');
  if (raw.length > 2048) return ok();
  let parsed: unknown = null; try { parsed = JSON.parse(raw); } catch { return ok(); }
  const p = Body.safeParse(parsed);
  if (!p.success) return ok();
  // E-Mail-Adressen und lange Zahlen aus Meldungen entfernen (falls ein Fehlertext Daten enthält).
  const clean = (t: string) => t.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[E-Mail]').replace(/\d{6,}/g, '[Zahl]');
  const msg = clean(p.data.m), src = (p.data.s || '').replace(/[?#].*$/, ''), page = (p.data.p || '/').replace(/[?#].*$/, '');
  const area = page.startsWith('/internal') ? 'admin' : page.startsWith('/business-portal') ? 'portal' : page.startsWith('/app') || page.startsWith('/auth') ? 'app' : 'website';
  const fp = createHash('sha256').update(`${msg}|${src}|${p.data.l || 0}`).digest('hex').slice(0, 40);
  await supabaseAdmin().rpc('lr_log_client_error', { fp, msg, src: src ? `${src}:${p.data.l || 0}:${p.data.c || 0}` : '', pg: page, ar: area, br: browserOf(req.headers.get('user-agent') || '') }).then(() => null, () => null);
  // Agent Tyler reagiert sofort (nach der Antwort, der Kunde wartet nicht): Ursache bestimmen, Harmloses abhaken,
  // echte Kundenfehler sofort aufs Gerät der Betreiberin melden.
  after(() => import('@/lib/admin/kundenreise').then((k) => k.reactNow(fp)).catch((e) => console.warn('kundenreise', (e as Error).message)));
  return ok();
}
