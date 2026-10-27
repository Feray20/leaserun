import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export async function GET() {
  return NextResponse.json({ service: 'LeaseRun', status: 'ok', runtime: 'nodejs', timestamp: new Date().toISOString() });
}
