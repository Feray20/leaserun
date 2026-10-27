import { NextResponse } from 'next/server';
import { BRANCHEN, getCatalog, TOOL_LABEL } from '@/lib/b2b/catalog';
import { adminConfigured } from '@/lib/supabase/admin';
import { DEFAULT_CATALOG } from '@/lib/b2b/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Öffentliche Pakete und Preise je Branche (für /business und das Unternehmensportal).
export async function GET() {
  const cat = adminConfigured() ? await getCatalog() : DEFAULT_CATALOG;
  const branchen = Object.fromEntries(BRANCHEN.map((b) => {
    const c = cat.branchen[b];
    return [b, { label: c.label, short: c.short, desc: c.desc, selfService: c.selfService, plans: c.plans.filter((p) => p.active), enterprise: c.enterprise.active ? c.enterprise : null }];
  }));
  return NextResponse.json({ order: ['makler', 'vermittler', 'finanzberater', 'allgemein', 'bank'], branchen, addon: cat.addon.active ? cat.addon : null, tools: TOOL_LABEL }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } });
}
