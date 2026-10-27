import { NextResponse } from 'next/server';
import { currentPricing, pricingHash, PRICING_VERSIONS } from '@/lib/cards/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

// Preis- und Leistungsverzeichnis als Daten (gleiche Quelle wie das PDF).
export async function GET() {
  const v = currentPricing();
  return NextResponse.json({ ...v, hash: pricingHash(v), history: PRICING_VERSIONS.map((x) => ({ version: x.version, status: x.status, effectiveFrom: x.effectiveFrom, createdAt: x.createdAt })) }, { headers: { 'Cache-Control': 'public, max-age=600', 'X-Robots-Tag': 'noindex' } });
}
