import { NextResponse } from 'next/server';
import { reviewInfo } from '@/lib/reviews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public: link to the Google review form and – if set up – average rating and number of Google reviews.
export async function GET() {
  const v = await reviewInfo().catch(() => null);
  return NextResponse.json(v ? { url: v.reviewUrl, rating: v.rating, count: v.count, mapsUrl: v.mapsUrl, at: v.at } : { url: null }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
}
