import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { BRANCHEN, DEFAULT_CATALOG, TOOL_IDS, TOOL_LABEL, getCatalog, saveCatalog, type Catalog } from '@/lib/b2b/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → Partners → Plans & pricing: maintain industry plans, prices (USD cents), features, tools and the add-on industry.
// Price changes apply to new purchases (new Stripe price); running subscriptions keep their price.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Tool = z.enum(TOOL_IDS);
const txt = (n: number) => z.string().trim().min(1).max(n);
const Cents = z.number().int().min(0).max(10_000_000);
const PlanS = z.object({ key: z.enum(['basic', 'pro']), tier: z.enum(['BASIC', 'PRO']), name: txt(80), monthCents: Cents, yearCents: Cents, seats: z.number().int().min(1).max(500), active: z.boolean(), tools: z.array(Tool).max(20), features: z.array(txt(300)).max(20) });
const BrS = z.object({
  label: txt(80), short: txt(40), desc: txt(200), selfService: z.boolean(), plans: z.array(PlanS).length(2),
  enterprise: z.object({ active: z.boolean(), name: txt(80), price: txt(80), tools: z.array(Tool).max(20), features: z.array(txt(300)).max(20) }),
});
const CatS = z.object({
  version: z.number().int(),
  addon: z.object({ active: z.boolean(), monthCents: Cents, yearCents: Cents, text: txt(300) }),
  branchen: z.object(Object.fromEntries(BRANCHEN.map((b) => [b, BrS])) as Record<(typeof BRANCHEN)[number], typeof BrS>),
});

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const { data: counts } = await supabaseAdmin().from('lr_b2b_accounts').select('branche, plan_tier, extra_branches').limit(5000);
  return j({ catalog: await getCatalog(true), defaults: DEFAULT_CATALOG, tools: TOOL_LABEL, accounts: counts ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const body = await req.json().catch(() => null);
  if (body?.reset === true) { await saveCatalog(DEFAULT_CATALOG, auth.user.email); await adminAudit(auth.user.email, 'b2b_catalog_reset', null); return j({ ok: true, catalog: DEFAULT_CATALOG }); }
  const p = CatS.safeParse(body?.catalog);
  if (!p.success) { const i = p.error.issues[0]; return j({ error: `Please check: ${i?.path.join(' → ')} (${i?.message})` }, 400); }
  const cat = { ...p.data, version: (p.data.version || 0) + 1 } as Catalog;
  for (const b of BRANCHEN) {
    const c = cat.branchen[b];
    if (c.selfService && !c.plans.some((x) => x.active) && !c.enterprise.active) return j({ error: `${c.label}: at least one plan must be available.` }, 400);
    if (c.plans.some((x) => x.active && x.monthCents < 100)) return j({ error: `${c.label}: the monthly price of active plans must be at least $1.` }, 400);
  }
  await saveCatalog(cat, auth.user.email);
  await adminAudit(auth.user.email, 'b2b_catalog_save', null, { version: cat.version });
  return j({ ok: true, catalog: cat });
}
