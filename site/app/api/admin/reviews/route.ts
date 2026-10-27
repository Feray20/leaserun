import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { REVIEW_KEY, clearReviewCache, reviewInfo } from '@/lib/reviews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'support');
  if (auth instanceof NextResponse) return auth;
  clearReviewCache();
  return j({ ...(await reviewInfo()), apiKey: Boolean(process.env.GOOGLE_PLACES_API_KEY) });
}

const In = z.object({
  reviewUrl: z.string().trim().max(300).refine((u) => u === '' || /^https:\/\/(g\.page|search\.google\.com|www\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)\//.test(u), 'Bitte den Google-Bewertungslink (https://g.page/r/… oder https://search.google.com/local/writereview?…) eintragen.'),
  placeId: z.string().trim().max(200).regex(/^$|^[A-Za-z0-9_-]{10,200}$/, 'Place-ID ungültig.'),
});

export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'support');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = In.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Ungültig.' }, 400);
  const value = { reviewUrl: p.data.reviewUrl || null, placeId: p.data.placeId || null };
  const r = await supabaseAdmin().from('lr_settings').upsert({ key: REVIEW_KEY, value, updated_at: new Date().toISOString(), updated_by: auth.user.email });
  if (r.error) return j({ error: r.error.message }, 500);
  clearReviewCache();
  await adminAudit(auth.user.email, 'reviews_config', null, { url: Boolean(value.reviewUrl), placeId: Boolean(value.placeId) });
  return j({ ok: true, ...(await reviewInfo()) });
}
