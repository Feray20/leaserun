import { suppress } from '@/lib/marketing/suppression';
import { NextResponse } from 'next/server';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { unsubId } from '@/lib/marketing/consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ein-Klick-Abmeldung aus dem E-Mail-Programm (RFC 8058: List-Unsubscribe-Post).
export async function POST(req: Request) {
  const t = new URL(req.url).searchParams.get('t') || '';
  const id = adminConfigured() ? unsubId(t) : null;
  if (id) {
    const { data: row } = await supabaseAdmin().from('lr_newsletter').update({ unsubscribed_at: new Date().toISOString() }).eq('id', id).select('email').maybeSingle();
    if (row?.email) await suppress({ email: row.email }, 'abmeldung').catch(() => null);
  }
  return new NextResponse(null, { status: 204 });
}
