import { NextResponse } from 'next/server';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { verifyWebhook } from '@/lib/mail/resend';
import { ingestReceived } from '@/lib/mail/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Large attachments can take a while; run in the default US region (iad1, see vercel.json) close to the database.
export const maxDuration = 300;

// Inbound for all emails to @leaserun.com (Resend Receiving, webhook "email.received").
// The signature is verified (RESEND_INBOUND_SECRET); content and attachments are fetched through the Receiving API and
// stored in the private bucket "mail". A webhook delivered twice does not create duplicates.

export async function POST(req: Request) {
  const secret = process.env.RESEND_INBOUND_SECRET || process.env.RESEND_WEBHOOK_SECRET || '';
  const body = await req.text();
  if (!secret || !verifyWebhook(body, req.headers, secret)) return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  let ev: { type?: string; data?: { email_id?: string } } = {};
  try { ev = JSON.parse(body); } catch { return NextResponse.json({ ok: true }); }
  // Delivery status of sent emails (Resend events email.delivered / opened / bounced / complained):
  // shown in the mailbox (Web-Admin and app) as "Delivered", "Opened" or "Bounced".
  const DELIVERY: Record<string, string> = { 'email.delivered': 'delivered_at', 'email.opened': 'opened_at', 'email.bounced': 'bounced_at', 'email.complained': 'complained_at' };
  if (ev.type && DELIVERY[ev.type] && ev.data?.email_id) {
    const db = supabaseAdmin();
    const { data: m } = await db.from('lr_mail_messages').select('id, auth').eq('resend_id', ev.data.email_id).maybeSingle();
    if (m) {
      const a = (m.auth as Record<string, unknown> | null) || {};
      const d = (a.delivery as Record<string, string> | undefined) || {};
      const key = DELIVERY[ev.type];
      if (!d[key]) await db.from('lr_mail_messages').update({ auth: { ...a, delivery: { ...d, [key]: (ev as { created_at?: string }).created_at || new Date().toISOString() } } }).eq('id', m.id);
    }
    return NextResponse.json({ ok: true });
  }
  if (ev.type !== 'email.received' || !ev.data?.email_id) return NextResponse.json({ ok: true });
  let res: 'ok' | 'duplicate' | 'error' = 'error';
  try { res = await ingestReceived(ev.data.email_id); } catch (e) { console.error('mail_inbound', (e as Error).message); }
  // Remember the last webhook delivery (the security check in the Web-Admin shows whether Resend reaches us).
  try { await supabaseAdmin().from('lr_settings').upsert({ key: 'mail_webhook_last', value: { at: new Date().toISOString(), ok: res !== 'error' }, updated_at: new Date().toISOString(), updated_by: 'system' }); } catch { /* display only */ }
  if (res === 'error') return NextResponse.json({ error: 'Processing failed.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
