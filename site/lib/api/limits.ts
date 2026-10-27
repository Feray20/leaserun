// Rate limit (fixed windows, atomic in Postgres – applies across all server instances) and idempotency.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { allowRequest } from '@/lib/security/rate-limit';
import { ApiError } from '@/lib/api/errors';

export type RateResult = { limit: number; remaining: number; reset: number; ok: boolean };

async function take(bucket: string, windowSeconds: number, limit: number): Promise<{ used: number; reset: number }> {
  const { data, error } = await supabaseAdmin().rpc('api_rate_take', { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    // Database unreachable: limit per instance instead (never let requests through unlimited).
    const ok = allowRequest(`apirl:${bucket}`, limit, windowSeconds * 1000);
    return { used: ok ? 1 : limit + 1, reset: Math.ceil(Date.now() / 1000) + windowSeconds };
  }
  return { used: Number(row.used), reset: Math.floor(new Date(row.reset_at).getTime() / 1000) };
}

// Per-minute limit per plan plus burst limit per 10 seconds; counters per tenant and environment.
export async function checkRate(tenantId: string, env: string, perMinute: number, burst: number): Promise<RateResult> {
  const [m, b] = await Promise.all([take(`${tenantId}:${env}:m`, 60, perMinute), take(`${tenantId}:${env}:b`, 10, burst)]);
  const okM = m.used <= perMinute, okB = b.used <= burst;
  return { limit: perMinute, remaining: Math.max(0, perMinute - m.used), reset: okB ? m.reset : Math.min(m.reset, b.reset), ok: okM && okB };
}

export const rateHeaders = (r: RateResult): Record<string, string> => ({
  'X-RateLimit-Limit': String(r.limit),
  'X-RateLimit-Remaining': String(r.remaining),
  'X-RateLimit-Reset': String(r.reset),
});

// ---------- Idempotenz ----------
const IDEM_RE = /^[A-Za-z0-9_.:-]{8,120}$/;
export type IdemHit = { replay: { status: number; body: unknown } } | { claimed: true } ;

export async function claimIdempotency(o: { tenantId: string; env: string; key: string; method: string; route: string; hash: string }): Promise<IdemHit> {
  if (!IDEM_RE.test(o.key)) throw new ApiError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 8–120 characters (A–Z, a–z, 0–9, _ . : -).');
  const db = supabaseAdmin();
  const ins = await db.from('api_idempotency_keys').insert({ tenant_id: o.tenantId, environment: o.env, idem_key: o.key, method: o.method, route: o.route, request_hash: o.hash });
  if (!ins.error) return { claimed: true };
  if (ins.error.code !== '23505') throw new ApiError('SERVICE_UNAVAILABLE', 'Idempotency store unavailable.');
  const { data } = await db.from('api_idempotency_keys').select('request_hash, method, route, status, response, created_at').eq('tenant_id', o.tenantId).eq('environment', o.env).eq('idem_key', o.key).maybeSingle();
  if (!data) throw new ApiError('IDEMPOTENCY_IN_PROGRESS');
  if (data.request_hash !== o.hash || data.method !== o.method || data.route !== o.route) throw new ApiError('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request.');
  if (data.status == null) {
    // Release aborted processing (e.g. timeout) after 2 minutes.
    if (Date.now() - new Date(data.created_at).getTime() > 120_000) {
      await db.from('api_idempotency_keys').delete().eq('tenant_id', o.tenantId).eq('environment', o.env).eq('idem_key', o.key).is('status', null);
      return claimIdempotency(o);
    }
    throw new ApiError('IDEMPOTENCY_IN_PROGRESS');
  }
  return { replay: { status: data.status, body: data.response } };
}

export async function finishIdempotency(o: { tenantId: string; env: string; key: string }, status: number, body: unknown): Promise<void> {
  const db = supabaseAdmin();
  // Do not store errors (except 4xx validation) so a retry runs again.
  if (status >= 500) { await db.from('api_idempotency_keys').delete().eq('tenant_id', o.tenantId).eq('environment', o.env).eq('idem_key', o.key); return; }
  await db.from('api_idempotency_keys').update({ status, response: body as object }).eq('tenant_id', o.tenantId).eq('environment', o.env).eq('idem_key', o.key);
}
