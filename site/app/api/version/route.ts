import { NextResponse } from 'next/server';

// Kennung der aktuell ausgelieferten Version. Die Seiten vergleichen sie mit der zuletzt gesehenen und leeren nach einem
// Update automatisch den Zwischenspeicher (kein manuelles „Cache leeren“ mehr nötig).
export const dynamic = 'force-dynamic';
export function GET() {
  const v = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'dev';
  return NextResponse.json({ v: String(v).slice(0, 64) }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
