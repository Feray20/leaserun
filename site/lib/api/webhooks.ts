// Webhooks der API: Ereignisse erzeugen, signiert zustellen, mit Backoff wiederholen, Verlauf speichern.
// SSRF-Schutz: nur https/443, öffentliche Ziele; die IP wird beim Verbindungsaufbau geprüft (DNS-Rebinding-fest).
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decryptSecret, signWebhook } from '@/lib/api/crypto';
import { checkWebhookUrl, isPublicIp } from '@/lib/api/net';
import { apiAudit } from '@/lib/api/audit';
import { computePolicy, type PolicyRow } from '@/lib/api/entitlements';
import type { WebhookEvent } from '@/lib/api/schemas';
import type { B2BAccount } from '@/lib/b2b/core';

export const BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200]; // 1 min, 5 min, 30 min, 2 h, 12 h → max. 6 Versuche
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
const TIMEOUT_MS = 8000;

type Delivery = { id: string; tenant_id: string; environment: string; endpoint_id: string; event: string; payload: Record<string, unknown>; status: string; attempts: number; is_test: boolean; created_at: string };

// Pinned Lookup: jede aufgelöste Adresse muss öffentlich sein, sonst bricht die Verbindung ab.
function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, '', 0);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicIp(a.address))) {
      const e = new Error('blocked_private_address') as NodeJS.ErrnoException; e.code = 'EBLOCKED';
      return cb(e, '', 0);
    }
    if ((options as { all?: boolean }).all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

export function postSigned(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; excerpt: string; ms: number; error?: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const chk = checkWebhookUrl(url);
    if (!chk.ok) return resolve({ status: 0, excerpt: '', ms: 0, error: chk.reason });
    const u = chk.url;
    const req = httpsRequest({
      protocol: 'https:', hostname: u.hostname.replace(/^\[|\]$/g, ''), port: 443, path: `${u.pathname}${u.search}`, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() }, lookup: safeLookup as never, timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { if (size < 2048) { chunks.push(c); size += c.length; } });
      res.on('end', () => resolve({ status: res.statusCode || 0, excerpt: maskExcerpt(Buffer.concat(chunks).toString('utf8').slice(0, 500)), ms: Date.now() - started }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, excerpt: '', ms: Date.now() - started, error: (e as NodeJS.ErrnoException).code === 'EBLOCKED' ? 'Ziel löst auf eine interne Adresse auf.' : e.message.slice(0, 200) }));
    req.end(body);
  });
}

// Antworttexte der Empfänger kürzen und offensichtliche personenbezogene Daten maskieren.
export function maskExcerpt(s: string): string {
  return s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***').replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, '****IBAN****').replace(/\+?\d[\d\s/-]{7,}\d/g, '***').replace(/[\r\n\t]+/g, ' ').trim();
}

async function webhooksAllowed(tenantId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const [{ data: account }, { data: row }] = await Promise.all([
    db.from('lr_b2b_accounts').select('*').eq('id', tenantId).maybeSingle(),
    db.from('api_tenant_policies').select('*').eq('tenant_id', tenantId).maybeSingle(),
  ]);
  return Boolean(account && computePolicy(account as B2BAccount, row as PolicyRow | null).webhook_enabled);
}

export async function emit(tenantId: string, env: string, event: WebhookEvent, data: Record<string, unknown>, dedupeKey: string): Promise<number> {
  const db = supabaseAdmin();
  const { data: eps } = await db.from('api_webhook_endpoints').select('id, events').eq('tenant_id', tenantId).eq('environment', env).eq('enabled', true);
  const targets = (eps ?? []).filter((e) => (e.events as string[]).includes(event));
  if (!targets.length || !(await webhooksAllowed(tenantId))) return 0;
  let n = 0;
  for (const ep of targets) {
    const { data: row, error } = await db.from('api_webhook_deliveries').insert({
      tenant_id: tenantId, environment: env, endpoint_id: ep.id, event, dedupe_key: `${event}:${dedupeKey}`.slice(0, 200),
      payload: data, status: 'pending', next_attempt_at: new Date().toISOString(),
    }).select('*').maybeSingle();
    if (error?.code === '23505') continue; // Duplikatschutz: Ereignis wurde schon erzeugt
    if (row) { n++; await deliver(row as Delivery); }
  }
  return n;
}

export async function deliver(d: Delivery, opts: { manual?: boolean } = {}): Promise<{ ok: boolean; status: number; error?: string }> {
  const db = supabaseAdmin();
  // Gleichzeitige Zustellung derselben Lieferung verhindern (optimistische Sperre über attempts).
  const { data: locked } = await db.from('api_webhook_deliveries').update({ attempts: d.attempts + 1, next_attempt_at: new Date(Date.now() + 120_000).toISOString() })
    .eq('id', d.id).eq('attempts', d.attempts).in('status', opts.manual ? ['pending', 'retrying', 'failed'] : ['pending', 'retrying']).select('id').maybeSingle();
  if (!locked) return { ok: false, status: 0, error: 'Zustellung läuft bereits.' };
  const attempt = d.attempts + 1;
  const { data: ep } = await db.from('api_webhook_endpoints').select('*').eq('id', d.endpoint_id).maybeSingle();
  let res: { status: number; excerpt: string; ms: number; error?: string };
  if (!ep || !ep.enabled) res = { status: 0, excerpt: '', ms: 0, error: 'Endpunkt deaktiviert oder gelöscht.' };
  else {
    let secret = '';
    try { secret = decryptSecret(ep.secret_enc); } catch { secret = ''; }
    if (!secret) res = { status: 0, excerpt: '', ms: 0, error: 'Signaturschlüssel nicht lesbar (API_ENCRYPTION_KEY).' };
    else {
      const ts = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ id: d.id, object: 'event', type: d.event, created_at: d.created_at, environment: d.environment, test: d.is_test, attempt, data: d.payload });
      res = await postSigned(ep.url, {
        'Content-Type': 'application/json', 'User-Agent': 'LeaseRun-Webhooks/1.0',
        'X-LeaseRun-Event': d.event, 'X-LeaseRun-Delivery': d.id, 'X-LeaseRun-Timestamp': ts, 'X-LeaseRun-Signature': signWebhook(secret, ts, body),
      }, body);
    }
  }
  const ok = res.status >= 200 && res.status < 300;
  const final = !ok && attempt >= MAX_ATTEMPTS;
  await db.from('api_webhook_deliveries').update({
    status: ok ? 'delivered' : final ? 'failed' : 'retrying', last_status: res.status || null, last_error: ok ? null : (res.error || `HTTP ${res.status}`),
    response_excerpt: res.excerpt || null, duration_ms: res.ms, delivered_at: ok ? new Date().toISOString() : null,
    next_attempt_at: new Date(Date.now() + (ok || final ? 0 : BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)] * 1000)).toISOString(),
  }).eq('id', d.id);
  if (ep) await db.from('api_webhook_endpoints').update({ last_delivery_at: new Date().toISOString(), failure_count: ok ? 0 : (ep.failure_count ?? 0) + 1 }).eq('id', ep.id);
  if (final) await apiAudit({ tenantId: d.tenant_id, environment: d.environment, actor: 'system:webhooks', action: 'webhook.delivery_failed', resourceType: 'webhook_delivery', resourceId: d.id, result: 'failure', meta: { event: d.event, status: res.status, error: res.error ?? null } });
  return { ok, status: res.status, error: ok ? undefined : res.error || `HTTP ${res.status}` };
}

export async function processDue(o: { tenantId?: string; limit?: number } = {}): Promise<number> {
  let q = supabaseAdmin().from('api_webhook_deliveries').select('*').in('status', ['pending', 'retrying']).lte('next_attempt_at', new Date().toISOString()).order('next_attempt_at').limit(o.limit ?? 20);
  if (o.tenantId) q = q.eq('tenant_id', o.tenantId);
  const { data } = await q;
  let n = 0;
  for (const d of data ?? []) { await deliver(d as Delivery); n++; }
  return n;
}

// Testereignis (webhooks:test bzw. Web-Admin): geht sofort an genau diesen Endpunkt.
export async function sendTest(tenantId: string, env: string, endpointId: string): Promise<{ delivery_id: string; ok: boolean; status: number; error?: string }> {
  const db = supabaseAdmin();
  const { data: row, error } = await db.from('api_webhook_deliveries').insert({
    tenant_id: tenantId, environment: env, endpoint_id: endpointId, event: 'webhook.test', dedupe_key: `test:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    payload: { message: 'Testereignis aus LeaseRun. Keine echten Falldaten.', sample: { case_id: '00000000-0000-0000-0000-000000000000', status: 'completed' } },
    status: 'pending', is_test: true,
  }).select('*').single();
  if (error || !row) throw new Error('delivery_insert_failed');
  const r = await deliver(row as Delivery);
  return { delivery_id: row.id, ...r };
}
