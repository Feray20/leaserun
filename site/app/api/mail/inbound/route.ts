import { NextResponse } from 'next/server';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { verifyWebhook } from '@/lib/mail/resend';
import { ingestReceived } from '@/lib/mail/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Belege (PDF lesen, Link abrufen, einordnen) können bei Sammel-Weiterleitungen länger dauern; Server in Frankfurt (nah an der Datenbank).
export const maxDuration = 300;
export const preferredRegion = 'fra1';

// Eingang aller E-Mails an @leaserun.com (Resend Receiving, Webhook „email.received“).
// Signatur wird geprüft (RESEND_INBOUND_SECRET); Inhalt und Anhänge werden über die Receiving-API geholt und
// im privaten Speicher „mail“ abgelegt. Doppelte Zustellung desselben Webhooks legt nichts doppelt an.

export async function POST(req: Request) {
  const secret = process.env.RESEND_INBOUND_SECRET || process.env.RESEND_WEBHOOK_SECRET || '';
  const body = await req.text();
  if (!secret || !verifyWebhook(body, req.headers, secret)) return NextResponse.json({ error: 'Signatur ungültig.' }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht konfiguriert.' }, { status: 503 });
  let ev: { type?: string; data?: { email_id?: string } } = {};
  try { ev = JSON.parse(body); } catch { return NextResponse.json({ ok: true }); }
  // Zustellstatus gesendeter E-Mails (Resend-Ereignisse email.delivered / opened / bounced / complained):
  // im Postfach (Web-Admin und App) als „Zugestellt“, „Geöffnet“ bzw. „Nicht zustellbar“ sichtbar.
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
  // Letzten Webhook-Eingang merken (Sicherheits-Check im Web-Admin zeigt, ob Resend uns erreicht).
  try { await supabaseAdmin().from('lr_settings').upsert({ key: 'mail_webhook_last', value: { at: new Date().toISOString(), ok: res !== 'error' }, updated_at: new Date().toISOString(), updated_by: 'system' }); } catch { /* nur Anzeige */ }
  if (res === 'error') return NextResponse.json({ error: 'Verarbeitung fehlgeschlagen.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
