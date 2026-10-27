import { isPublicIp } from '@/lib/api/net';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Outgoing webhook to the business's CRM (e.g. on a new lead).
// Signature: header X-LeaseRun-Signature = sha256=HMAC(secret, "<timestamp>.<body>"), X-LeaseRun-Timestamp.

export { newWebhookSecret, signPayload, isPrivateIp } from '@/lib/b2b/webhook-sign';
import { isPrivateIp, signPayload } from '@/lib/b2b/webhook-sign';

export async function safeTarget(url: string): Promise<string | null> {
  let u: URL;
  try { u = new URL(url); } catch { return 'Invalid URL.'; }
  if (u.protocol !== 'https:') return 'Only https URLs are allowed.';
  if (u.username || u.password) return 'Credentials in the URL are not allowed.';
  if (u.port && u.port !== '443') return 'Only port 443 is allowed.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return 'Internal addresses are not allowed.';
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address) || !isPublicIp(a.address))) return 'Internal addresses are not allowed.';
  } catch {
    return 'The host name could not be resolved.';
  }
  return null;
}

export async function sendWebhook(account: { id: string; webhook_url?: string | null; webhook_secret?: string | null }, event: string, data: unknown): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!account.webhook_url || !account.webhook_secret) return { ok: false, error: 'not configured' };
  const bad = await safeTarget(account.webhook_url);
  let res: { ok: boolean; status?: number; error?: string };
  if (bad) res = { ok: false, error: bad };
  else {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ event, created: new Date().toISOString(), data });
    try {
      const r = await fetch(account.webhook_url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'LeaseRun-Webhook/1', 'X-LeaseRun-Event': event, 'X-LeaseRun-Timestamp': ts, 'X-LeaseRun-Signature': signPayload(account.webhook_secret, ts, body) },
        body,
        signal: AbortSignal.timeout(5000),
      });
      res = { ok: r.ok, status: r.status, error: r.ok ? undefined : `HTTP ${r.status}` };
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'Error' };
    }
  }
  await supabaseAdmin().from('lr_webhook_log').insert({ account_id: account.id, event, status: res.status ?? null, error: res.error ?? null }).then(() => null, () => null);
  return res;
}
