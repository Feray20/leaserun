import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { panicState } from '@/lib/security/panic';
import { effectiveTier, publicPartner, type B2BAccount } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]{3,40}$/;

// Öffentliche Angaben eines Partners: zuerst Unternehmenskonten (mit gebuchtem Tarif),
// sonst die manuell gepflegten Co-Branding-Partner. Keine Steuer-, Register- oder Kontaktdaten außer dem Terminlink.
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'Partner nicht gefunden.' }, { status: 404 });
  if (!allowRequest(`partner:${anonymizedIpHash(req) ?? 'x'}`, 60, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht verfügbar.' }, { status: 503 });
  if ((await panicState()).active) return NextResponse.json({ error: 'Vorübergehend nicht verfügbar (Wartung).' }, { status: 503 });
  const db = supabaseAdmin();
  const { data: acc } = await db.from('lr_b2b_accounts').select('*').eq('slug', slug).maybeSingle();
  if (acc) {
    const a = acc as B2BAccount;
    const live = a.status === 'active' && Boolean(a.verified_at) && Boolean(effectiveTier(a)) && a.widget_active;
    if (!live) return NextResponse.json({ error: 'Partner nicht gefunden.' }, { status: 404 });
    // Widget nur auf freigegebenen Websites (Herkunft aus dem einbettenden Dokument; ergänzt den Einwilligungsschutz).
    const host = (new URL(req.url).searchParams.get('host') ?? '').toLowerCase();
    if (new URL(req.url).searchParams.get('embed') === '1' && a.allowed_domains.length) {
      const ok = a.allowed_domains.some((d) => (d.startsWith('*.') ? host === d.slice(2) || host.endsWith(d.slice(1)) : host === d || host === `www.${d}`));
      if (!ok) return NextResponse.json({ error: 'Dieses Widget ist für diese Website nicht freigegeben.' }, { status: 403 });
    }
    return NextResponse.json({ ...publicPartner(a), b2b: true, leads: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const { data } = await db.from('lr_partners').select('slug, name, kind').eq('slug', slug).eq('active', true).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Partner nicht gefunden.' }, { status: 404 });
  return NextResponse.json({ ...data, b2b: false, leads: false }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
