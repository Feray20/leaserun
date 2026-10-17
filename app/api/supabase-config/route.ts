import { NextResponse } from 'next/server';

// Liefert nur die öffentliche (publishable/anon) Konfiguration an den Browser.
export function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase ist noch nicht konfiguriert.' }, { status: 503 });
  return NextResponse.json({ url, key });
}
