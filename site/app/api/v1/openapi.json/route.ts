import { NextResponse } from 'next/server';
import spec from '@/openapi/leaserun-api.json';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

// GET /api/v1/openapi.json – OpenAPI-3.1-Beschreibung (öffentlich, ohne Geheimnisse).
export function GET() {
  return NextResponse.json(spec, { headers: { 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' } });
}
