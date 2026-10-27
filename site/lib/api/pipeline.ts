// Gemeinsame Anfrage-Pipeline aller /api/v1-Endpunkte. Reihenfolge (fest):
// Request-ID → Authentifizierung → Schlüssel-Lookup → Schlüsselstatus → Mandant → Entitlement → Scope → IP-Allowlist
// → Rate-Limit → Anfragekörper → Idempotenz → Handler → Audit (im Handler) → Antwort + Anfrageprotokoll.
import { randomBytes } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { supabaseAdmin, anonymizedIpHash, adminConfigured } from '@/lib/supabase/admin';
import { API_VERSION, keyPepper } from '@/lib/api/config';
import { ApiError, problem, type ErrorCode } from '@/lib/api/errors';
import { bearer, hashKey, keyState, parseKey, type Env, type KeyRow } from '@/lib/api/keys';
import { computePolicy, isScope, type PolicyRow, type Scope, type TenantApiPolicy } from '@/lib/api/entitlements';
import { clientIp, ipAllowed } from '@/lib/api/net';
import { checkRate, claimIdempotency, finishIdempotency, rateHeaders, type RateResult } from '@/lib/api/limits';
import { canonicalHash, sha256Hex } from '@/lib/api/crypto';
import { allowRequest } from '@/lib/security/rate-limit';
import type { B2BAccount } from '@/lib/b2b/core';
import { deprecationHeaders } from '@/lib/api/changelog';

export type ApiCtx = {
  req: Request;
  requestId: string;
  url: URL;
  params: Record<string, string>;
  tenantId: string;
  env: Env;
  key: KeyRow;
  account: B2BAccount;
  policy: TenantApiPolicy;
  actor: string;
  ip: string | null;
  raw: Buffer;
  contentType: string;
  body: unknown;
};
export type ApiResult = { status: number; body?: unknown; headers?: Record<string, string> } | Response;

export const newRequestId = () => 'req_' + randomBytes(12).toString('base64url');

// Hintergrundarbeit nach der Antwort (Vercel: läuft innerhalb der Funktionslaufzeit weiter).
export function background(task: () => Promise<unknown>): void {
  const run = () => task().catch((e) => console.error('api_background', e instanceof Error ? e.message : e));
  try { after(run); } catch { void run(); }
}

function baseHeaders(requestId: string, rate?: RateResult | null): Record<string, string> {
  return { 'X-Request-Id': requestId, 'API-Version': API_VERSION, 'Cache-Control': 'no-store', ...(rate ? rateHeaders(rate) : {}) };
}

export function errorResponse(code: ErrorCode, requestId: string, detail?: string, opts: { errors?: ApiError['errors']; headers?: Record<string, string>; rate?: RateResult | null } = {}): NextResponse {
  const body = problem(code, requestId, detail, opts.errors ?? []);
  return NextResponse.json(body, { status: body.status, headers: { ...baseHeaders(requestId, opts.rate), 'Content-Type': 'application/problem+json', ...(opts.headers ?? {}) } });
}

function logRequest(o: { requestId: string; tenantId?: string | null; key?: KeyRow | null; env?: Env | null; method: string; route: string; status: number; started: number; bytes?: number; code?: string | null; ipHash: string | null }) {
  if (!adminConfigured()) return;
  background(async () => {
    await supabaseAdmin().from('api_requests').insert({
      request_id: o.requestId, tenant_id: o.tenantId ?? null, key_id: o.key?.id ?? null, key_prefix: o.key?.key_prefix ?? null,
      environment: o.env ?? null, method: o.method, route: o.route, status: o.status, duration_ms: Math.max(0, Math.round(performance.now() - o.started)),
      response_bytes: o.bytes ?? null, error_code: o.code ?? null, ip_hash: o.ipHash,
    });
  });
}

export type RouteOpts = { route: string; scope: Scope; idempotent?: boolean; maxBody?: number; multipart?: boolean };
type RouteCtx = { params: Promise<Record<string, string>> };

export function apiRoute(opts: RouteOpts, handler: (ctx: ApiCtx) => Promise<ApiResult>) {
  if (!isScope(opts.scope)) throw new Error(`unknown scope ${opts.scope}`);
  return async (req: Request, routeCtx: RouteCtx): Promise<Response> => {
    const started = performance.now();
    const requestId = newRequestId();
    const ipHash = anonymizedIpHash(req);
    let key: KeyRow | null = null, tenantId: string | null = null, env: Env | null = null, rate: RateResult | null = null;
    const fail = (code: ErrorCode, detail?: string, extra: { errors?: ApiError['errors']; headers?: Record<string, string> } = {}) => {
      const res = errorResponse(code, requestId, detail, { ...extra, rate });
      logRequest({ requestId, tenantId, key, env, method: req.method, route: opts.route, status: res.status, started, code, ipHash });
      return res;
    };
    try {
      const pepper = keyPepper();
      if (!pepper || !adminConfigured()) return fail('CONFIGURATION_REQUIRED', 'The API is not configured on this server.');
      // 1) Authentifizierung
      const secret = bearer(req);
      if (!secret) return fail('UNAUTHENTICATED', 'Send the API key as "Authorization: Bearer <key>".', { headers: { 'WWW-Authenticate': 'Bearer realm="LeaseRun API"' } });
      const parsed = parseKey(secret);
      if (!parsed) {
        if (!allowRequest(`apibad:${ipHash ?? 'x'}`, 20, 60_000)) return fail('RATE_LIMIT_EXCEEDED', 'Too many invalid API keys from this source.', { headers: { 'Retry-After': '60' } });
        return fail('INVALID_API_KEY', undefined, { headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } });
      }
      // 2) Schlüssel-Lookup (Hash, eindeutiger Index)
      const db = supabaseAdmin();
      const { data: k, error: kErr } = await db.from('api_keys').select('*').eq('key_hash', hashKey(secret, pepper)).maybeSingle();
      if (kErr) return fail('SERVICE_UNAVAILABLE', 'Key store unavailable.');
      if (!k || k.key_prefix !== parsed.prefix) {
        // Schutz gegen Durchprobieren: viele ungültige Schlüssel von derselben Quelle → vorübergehend 429.
        if (!allowRequest(`apibad:${ipHash ?? 'x'}`, 20, 60_000)) return fail('RATE_LIMIT_EXCEEDED', 'Too many invalid API keys from this source.', { headers: { 'Retry-After': '60' } });
        return fail('INVALID_API_KEY', undefined, { headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } });
      }
      key = k as KeyRow;
      env = key.environment;
      tenantId = key.tenant_id;
      // 3) Schlüsselstatus
      const st = keyState(key);
      if (st === 'revoked') return fail('API_KEY_REVOKED');
      if (st === 'expired') return fail('API_KEY_EXPIRED');
      if (st === 'disabled') return fail('API_KEY_DISABLED');
      // 4) Mandant + 5) Entitlement
      const [{ data: account }, { data: row }] = await Promise.all([
        db.from('lr_b2b_accounts').select('*').eq('id', key.tenant_id).maybeSingle(),
        db.from('api_tenant_policies').select('*').eq('tenant_id', key.tenant_id).maybeSingle(),
      ]);
      if (!account) return fail('INVALID_API_KEY');
      const policy = computePolicy(account as B2BAccount, (row as PolicyRow | null) ?? null);
      if (policy.reason === 'LOCKED') return fail('TENANT_LOCKED', 'The account is locked. Contact support@leaserun.com.');
      if (policy.reason === 'PLAN') return fail('PLAN_NOT_ENTITLED', 'API access requires the Pro or Enterprise plan.');
      if (policy.reason === 'NOT_ENABLED') return fail('API_NOT_ENABLED', 'API access has not been enabled for this account yet.');
      if (env === 'live' && !policy.live_enabled) return fail('LIVE_NOT_ENABLED', 'Live keys are not enabled for this account yet. Use a test key.');
      if (!policy.allowed_scopes.includes(opts.scope)) return fail('PLAN_NOT_ENTITLED', `Your plan does not include ${opts.scope}.`);
      // 6) Scope des Schlüssels
      if (!key.scopes.includes(opts.scope)) return fail('INSUFFICIENT_SCOPE', `This endpoint requires the scope ${opts.scope}.`);
      // 7) IP-Allowlist
      const ip = clientIp(req);
      if (!ipAllowed(ip, key.allowed_ips)) return fail('IP_NOT_ALLOWED');
      // 8) Rate-Limit
      rate = await checkRate(key.tenant_id, env, policy.rate_limit, policy.burst_limit);
      if (!rate.ok) return fail('RATE_LIMIT_EXCEEDED', `Limit: ${policy.rate_limit} requests per minute (burst ${policy.burst_limit} per 10 s).`, { headers: { 'Retry-After': String(Math.max(1, rate.reset - Math.floor(Date.now() / 1000))) } });
      // 9) Anfragekörper
      const max = opts.maxBody ?? 256 * 1024;
      const len = Number(req.headers.get('content-length') || 0);
      if (len > max) return fail('PAYLOAD_TOO_LARGE', `Maximum body size is ${max} bytes.`);
      const raw = ['GET', 'HEAD', 'DELETE'].includes(req.method) ? Buffer.alloc(0) : Buffer.from(await req.arrayBuffer());
      if (raw.length > max) return fail('PAYLOAD_TOO_LARGE', `Maximum body size is ${max} bytes.`);
      const contentType = (req.headers.get('content-type') || '').toLowerCase();
      let body: unknown = undefined;
      if (raw.length && !opts.multipart) {
        if (!contentType.includes('application/json')) return fail('UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
        try { body = JSON.parse(raw.toString('utf8')); } catch { return fail('INVALID_JSON'); }
      }
      if (opts.multipart && raw.length && !contentType.startsWith('multipart/form-data')) return fail('UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: multipart/form-data.');
      const params = (routeCtx?.params ? await routeCtx.params : {}) ?? {};
      for (const [k2, v] of Object.entries(params)) if (/id$/i.test(k2) && !/^[0-9a-f-]{36}$/i.test(v)) return fail('RESOURCE_NOT_FOUND');
      // 10) Idempotenz
      const idemKey = req.headers.get('idempotency-key');
      let idem: { tenantId: string; env: string; key: string } | null = null;
      if (opts.idempotent && idemKey) {
        const route = opts.route.replace(/\{(\w+)\}/g, (_, n) => params[n] ?? '');
        const hash = opts.multipart ? sha256Hex(Buffer.concat([Buffer.from(`${req.method} ${route} `), raw])) : canonicalHash(req.method, route, body);
        const hit = await claimIdempotency({ tenantId: key.tenant_id, env, key: idemKey, method: req.method, route, hash });
        if ('replay' in hit) {
          const res = NextResponse.json(hit.replay.body, { status: hit.replay.status, headers: { ...baseHeaders(requestId, rate), 'Idempotent-Replayed': 'true' } });
          logRequest({ requestId, tenantId, key, env, method: req.method, route: opts.route, status: res.status, started, ipHash });
          return res;
        }
        idem = { tenantId: key.tenant_id, env, key: idemKey };
      }
      // Zuletzt-genutzt höchstens einmal pro Minute schreiben.
      if (!key.last_used_at || Date.now() - new Date(key.last_used_at).getTime() > 60_000) {
        const kid = key.id;
        background(async () => { await db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', kid); });
      }
      const ctx: ApiCtx = { req, requestId, url: new URL(req.url), params, tenantId: key.tenant_id, env, key, account: account as B2BAccount, policy, actor: `api_key:${key.key_prefix}`, ip, raw, contentType, body };
      let result: ApiResult;
      try {
        result = await handler(ctx);
      } catch (e) {
        if (idem) await finishIdempotency(idem, e instanceof ApiError ? e.status : 500, e instanceof ApiError ? problem(e.code, requestId, e.message, e.errors) : null).catch(() => null);
        throw e;
      }
      const res = result instanceof Response ? result : NextResponse.json(result.body ?? null, { status: result.status, headers: result.headers });
      for (const [h, v] of Object.entries({ ...baseHeaders(requestId, rate), ...deprecationHeaders(opts.route) })) res.headers.set(h, v);
      if (idem && !(result instanceof Response)) await finishIdempotency(idem, result.status, result.body ?? null);
      logRequest({ requestId, tenantId, key, env, method: req.method, route: opts.route, status: res.status, started, bytes: Number(res.headers.get('content-length') || 0) || undefined, ipHash });
      // Fällige Webhook-Zustellungen dieses Mandanten mitnehmen (Wiederholungen mit Backoff).
      const tid = key.tenant_id;
      background(async () => { const m = await import('@/lib/api/webhooks'); await m.processDue({ tenantId: tid, limit: 3 }); });
      return res;
    } catch (e) {
      if (e instanceof ApiError) return fail(e.code, e.message, { errors: e.errors, headers: e.headers });
      console.error('api_unhandled', opts.route, e instanceof Error ? e.stack || e.message : e);
      return fail('INTERNAL_ERROR', 'An unexpected error occurred. Quote the request_id when contacting support.');
    }
  };
}

// Unbekannte Methode auf bekanntem Pfad.
export function methodNotAllowed(allowed: string[]) {
  return async () => {
    const rid = newRequestId();
    return errorResponse('METHOD_NOT_ALLOWED', rid, `Allowed: ${allowed.join(', ')}`, { headers: { Allow: allowed.join(', ') } });
  };
}
