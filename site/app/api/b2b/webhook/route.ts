import { supabaseAdmin } from '@/lib/supabase/admin';
import { json, requireMember } from '@/lib/b2b/http';
import { sendWebhook } from '@/lib/b2b/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Letzte Webhook-Zustellungen ansehen.
export async function GET(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-wh' });
  if (ctx instanceof Response) return ctx;
  const { data } = await supabaseAdmin().from('lr_webhook_log').select('event, status, error, created_at').eq('account_id', ctx.account.id).order('created_at', { ascending: false }).limit(20);
  return json({ log: data ?? [] });
}

// Testereignis senden.
export async function POST(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-wh', limit: 10 });
  if (ctx instanceof Response) return ctx;
  if (!ctx.account.webhook_url) return json({ error: 'Bitte zuerst eine Webhook-Adresse speichern.' }, 400);
  const r = await sendWebhook(ctx.account, 'ping', { message: 'Testereignis von LeaseRun', account: ctx.account.customer_number });
  return json(r, r.ok ? 200 : 502);
}
