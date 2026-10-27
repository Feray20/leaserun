import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { computePolicy, SCOPES, type PolicyRow, type Scope } from '@/lib/api/entitlements';
import { publicKey, type KeyRow } from '@/lib/api/keys';
import { createKey, rotateKey, setKeyState } from '@/lib/api/key-admin';
import { apiAudit } from '@/lib/api/audit';
import { healthCheck } from '@/lib/api/health';
import { apiBaseUrl, configIssues, API_BUCKET, API_VERSION } from '@/lib/api/config';
import { CHANGELOG } from '@/lib/api/changelog';
import { deliver, maskExcerpt, sendTest } from '@/lib/api/webhooks';
import { ApiError } from '@/lib/api/errors';
import { createCase } from '@/lib/api/service';
import { TEST_CASE } from '@/lib/api/testdata';
import { publicWebhook, type WebhookRow } from '@/lib/api/serialize';
import type { B2BAccount } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Web-Admin → API Management. Administrators only (ADMIN_EMAILS + second factor). Every change is audited.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const uuid = z.string().uuid();
const TEST_REFERRAL = 'api-test';

async function tenantWithPolicy(id: string) {
  const db = supabaseAdmin();
  const [{ data: a }, { data: p }] = await Promise.all([
    db.from('lr_b2b_accounts').select('*').eq('id', id).maybeSingle(),
    db.from('api_tenant_policies').select('*').eq('tenant_id', id).maybeSingle(),
  ]);
  if (!a) return null;
  return { account: a as B2BAccount, row: (p as PolicyRow | null) ?? null, policy: computePolicy(a as B2BAccount, (p as PolicyRow | null) ?? null) };
}

function overviewStatus(policy: ReturnType<typeof computePolicy>, issues: string[], errorRate: number, health: string | null) {
  if (issues.length) return 'Configuration Required';
  if (!policy.enabled) return 'Disabled';
  if (health === 'degraded' || health === 'unavailable' || errorRate >= 5) return 'Degraded';
  return 'Operational';
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const u = new URL(req.url);
  const view = u.searchParams.get('view') || 'tenants';
  const tenant = u.searchParams.get('tenant');
  const db = supabaseAdmin();
  try {
    if (view === 'tenants') {
      const [{ data: accs }, { data: pols }, { data: keys }] = await Promise.all([
        db.from('lr_b2b_accounts').select('id, company_name, customer_number, plan_tier, plan_until, status, has_whitelabel, referral, verified_at').order('created_at', { ascending: false }).limit(500),
        db.from('api_tenant_policies').select('*'),
        db.from('api_keys').select('tenant_id, environment, revoked_at, expires_at, disabled_at'),
      ]);
      const pm = new Map((pols ?? []).map((p) => [p.tenant_id, p as PolicyRow]));
      return j({
        config: configIssues(), base_url: apiBaseUrl(), version: API_VERSION,
        tenants: (accs ?? []).map((a) => {
          const pol = computePolicy(a as B2BAccount, pm.get(a.id) ?? null);
          const ks = (keys ?? []).filter((k) => k.tenant_id === a.id && !k.revoked_at && !k.disabled_at && (!k.expires_at || new Date(k.expires_at).getTime() > Date.now()));
          return { id: a.id, company: a.company_name, customer_number: a.customer_number, status: a.status, plan: pol.plan, test_tenant: a.referral === TEST_REFERRAL, policy: pol, active_keys: ks.length };
        }),
      });
    }
    if (view === 'health') return j(await healthCheck());
    if (view === 'changelog') return j({ version: API_VERSION, changelog: CHANGELOG });
    if (!tenant || !uuid.safeParse(tenant).success) return j({ error: 'Please choose a tenant.' }, 400);
    const t = await tenantWithPolicy(tenant);
    if (!t) return j({ error: 'Tenant not found.' }, 404);

    if (view === 'overview') {
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const since24 = new Date(Date.now() - 864e5).toISOString();
      const [today, month, last24, last, keys, hooks, health] = await Promise.all([
        db.from('api_requests').select('id', { head: true, count: 'exact' }).eq('tenant_id', tenant).gte('created_at', dayStart.toISOString()),
        db.from('api_requests').select('id', { head: true, count: 'exact' }).eq('tenant_id', tenant).gte('created_at', monthStart.toISOString()),
        db.rpc('api_usage_series', { p_tenant: tenant, p_env: null, p_from: since24, p_bucket: 'day' }),
        db.from('api_requests').select('created_at, route, method, status, environment').eq('tenant_id', tenant).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('api_keys').select('id, environment, revoked_at, expires_at, disabled_at').eq('tenant_id', tenant),
        db.from('api_webhook_endpoints').select('id', { head: true, count: 'exact' }).eq('tenant_id', tenant).eq('enabled', true),
        healthCheck(),
      ]);
      const rows = (last24.data ?? []) as { requests: number; errors_4xx: number; errors_5xx: number; avg_ms: number | null }[];
      const req24 = rows.reduce((s, r) => s + Number(r.requests), 0);
      const err24 = rows.reduce((s, r) => s + Number(r.errors_5xx) + Number(r.errors_4xx), 0);
      const avg = req24 ? rows.reduce((s, r) => s + Number(r.avg_ms || 0) * Number(r.requests), 0) / req24 : null;
      const errorRate = req24 ? Math.round((err24 / req24) * 10000) / 100 : 0;
      const active = (keys.data ?? []).filter((k) => !k.revoked_at && !k.disabled_at && (!k.expires_at || new Date(k.expires_at).getTime() > Date.now()));
      return j({
        tenant: { id: t.account.id, company: t.account.company_name, customer_number: t.account.customer_number, status: t.account.status, test_tenant: t.account.referral === TEST_REFERRAL },
        status: overviewStatus(t.policy, configIssues(), errorRate, health.status), policy: t.policy, row: t.row,
        metrics: { active_keys: active.length, active_test_keys: active.filter((k) => k.environment === 'test').length, active_live_keys: active.filter((k) => k.environment === 'live').length,
          requests_today: today.count ?? 0, requests_month: month.count ?? 0, error_rate_24h: errorRate, avg_latency_ms_24h: avg == null ? null : Math.round(avg),
          active_webhooks: hooks.count ?? 0, last_request: last.data ?? null },
        health: { status: health.status }, config: configIssues(), base_url: apiBaseUrl(),
      });
    }
    if (view === 'keys') {
      const { data } = await db.from('api_keys').select('*').eq('tenant_id', tenant).order('created_at', { ascending: false }).limit(200);
      return j({ keys: (data ?? []).map((k) => publicKey(k as KeyRow)), scopes: SCOPES, allowed_scopes: t.policy.allowed_scopes });
    }
    if (view === 'requests') {
      const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') || 100)));
      let q = db.from('api_requests').select('id, request_id, created_at, method, route, status, duration_ms, response_bytes, error_code, key_prefix, environment').eq('tenant_id', tenant).order('id', { ascending: false }).limit(limit);
      const st = u.searchParams.get('status'); const route = u.searchParams.get('route'); const key = u.searchParams.get('key'); const from = u.searchParams.get('from'); const to = u.searchParams.get('to'); const before = u.searchParams.get('before');
      if (st === '2xx') q = q.lt('status', 300); else if (st === '4xx') q = q.gte('status', 400).lt('status', 500); else if (st === '5xx') q = q.gte('status', 500); else if (st && /^\d{3}$/.test(st)) q = q.eq('status', Number(st));
      if (route) q = q.ilike('route', `%${route.replace(/[%_]/g, '')}%`);
      if (key && /^(test|live)_[A-Za-z0-9]{8}$/.test(key)) q = q.eq('key_prefix', key);
      if (from && !Number.isNaN(Date.parse(from))) q = q.gte('created_at', new Date(from).toISOString());
      if (to && !Number.isNaN(Date.parse(to))) q = q.lte('created_at', new Date(to).toISOString());
      if (u.searchParams.get('env') === 'test' || u.searchParams.get('env') === 'live') q = q.eq('environment', u.searchParams.get('env'));
      if (before && /^\d+$/.test(before)) q = q.lt('id', Number(before));
      const { data } = await q;
      return j({ requests: data ?? [], next_before: (data ?? []).length === limit ? data![data!.length - 1].id : null });
    }
    if (view === 'usage') {
      const range = u.searchParams.get('range') || '7d';
      const R: Record<string, [number, string]> = { '24h': [864e5, 'hour'], '7d': [7 * 864e5, 'day'], '30d': [30 * 864e5, 'day'], '90d': [90 * 864e5, 'day'] };
      const r = R[range] ?? R['7d'];
      const e = u.searchParams.get('env');
      const { data } = await db.rpc('api_usage_series', { p_tenant: tenant, p_env: e === 'test' || e === 'live' ? e : null, p_from: new Date(Date.now() - r[0]).toISOString(), p_bucket: r[1] });
      return j({ range, bucket: r[1], series: data ?? [] });
    }
    if (view === 'webhooks') {
      const [{ data: eps }, { data: dels }] = await Promise.all([
        db.from('api_webhook_endpoints').select('*').eq('tenant_id', tenant).order('created_at', { ascending: false }),
        db.from('api_webhook_deliveries').select('id, endpoint_id, event, status, attempts, last_status, last_error, response_excerpt, duration_ms, is_test, created_at, delivered_at, next_attempt_at, environment').eq('tenant_id', tenant).order('created_at', { ascending: false }).limit(100),
      ]);
      return j({ webhooks: (eps ?? []).map((w) => publicWebhook(w as WebhookRow)), deliveries: (dels ?? []).map((d) => ({ ...d, response_excerpt: d.response_excerpt ? maskExcerpt(d.response_excerpt) : null })) });
    }
    if (view === 'audit') {
      const { data } = await db.from('api_audit_events').select('id, created_at, actor, action, resource_type, resource_id, request_id, result, environment, hash, prev_hash').eq('tenant_id', tenant).order('id', { ascending: false }).limit(200);
      return j({ events: data ?? [] });
    }
    if (view === 'sandbox') {
      const [cases, docs, reps, vals, dels] = await Promise.all(['api_cases', 'api_documents', 'api_reports', 'api_validation_runs', 'api_webhook_deliveries'].map((tb) => db.from(tb).select('id', { head: true, count: 'exact' }).eq('tenant_id', tenant).eq('environment', 'test')));
      const { data: list } = await db.from('api_cases').select('id, external_reference, status, created_at').eq('tenant_id', tenant).eq('environment', 'test').order('created_at', { ascending: false }).limit(50);
      return j({ counts: { cases: cases.count ?? 0, documents: docs.count ?? 0, reports: reps.count ?? 0, validations: vals.count ?? 0, deliveries: dels.count ?? 0 }, cases: list ?? [] });
    }
    return j({ error: 'Unbekannte Ansicht.' }, 400);
  } catch (e) {
    console.error('admin_api_get', view, e instanceof Error ? e.message : e);
    return j({ error: 'Data could not be loaded.' }, 500);
  }
}

const PolicyBody = z.object({
  enabled: z.boolean().optional(), live_enabled: z.boolean().optional(),
  rate_limit: z.number().int().min(1).max(100000).nullable().optional(), burst_limit: z.number().int().min(1).max(100000).nullable().optional(),
  max_document_bytes: z.number().int().min(1024).max(4194304).nullable().optional(),
  webhooks_allowed: z.boolean().nullable().optional(), white_label_allowed: z.boolean().nullable().optional(), routing_enabled: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
}).strict();

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.action !== 'string') return j({ error: 'Invalid request.' }, 400);
  const actor = `admin:${auth.user.email}`;
  const db = supabaseAdmin();
  try {
    // Test tenant: own business account (Enterprise, manual) for sandbox, playground and E2E test.
    if (b.action === 'test_tenant') {
      const { data: existing } = await db.from('lr_b2b_accounts').select('id').eq('referral', TEST_REFERRAL).limit(1).maybeSingle();
      let id = existing?.id as string | undefined;
      if (!id) {
        const email = `api-test+${randomBytes(4).toString('hex')}@leaserun.com`;
        const user = await db.auth.admin.createUser({ email, email_confirm: true, password: randomBytes(24).toString('base64url'), user_metadata: { purpose: 'LeaseRun API test tenant (no sign-in)' } });
        if (user.error || !user.data.user) return j({ error: 'The test user could not be created.' }, 500);
        const now = new Date().toISOString();
        const ins = await db.from('lr_b2b_accounts').insert({
          owner_id: user.data.user.id, company_name: 'LeaseRun API Test Tenant (TEST)', legal_form: 'Test', institution_type: 'OTHER', tax_id: 'TEST-0000',
          advisor_name: 'API Test', email, postal_code: '78701', city: 'Austin', street: '100 Test St (TEST)', status: 'active', plan_tier: 'ENTERPRISE', plan_source: 'manual',
          referral: TEST_REFERRAL, verified_at: now, verification_status: 'geprueft', verification_decided_at: now, verification_note: 'Internal API test tenant, no real data.',
          unternehmer_confirmed_at: now, avv_accepted_at: now, avv_version: 'TEST',
        }).select('id').single();
        if (ins.error || !ins.data) { await db.auth.admin.deleteUser(user.data.user.id).catch(() => null); return j({ error: 'The test tenant could not be created.' }, 500); }
        id = ins.data.id as string;
        await db.from('api_tenant_policies').upsert({ tenant_id: id, enabled: true, live_enabled: false, updated_by: actor, updated_at: now, note: 'Testmandant: nur Testumgebung.' });
        await apiAudit({ tenantId: id, actor, action: 'api.access.enabled', resourceType: 'tenant', resourceId: id, meta: { test_tenant: true } });
      }
      return j({ ok: true, tenant: id });
    }

    const tenant = typeof b.tenant === 'string' && uuid.safeParse(b.tenant).success ? b.tenant : null;
    if (!tenant) return j({ error: 'Please choose a tenant.' }, 400);
    const t = await tenantWithPolicy(tenant);
    if (!t) return j({ error: 'Tenant not found.' }, 404);

    if (b.action === 'policy') {
      const p = PolicyBody.safeParse(b.policy ?? {});
      if (!p.success) return j({ error: 'Invalid settings.', details: p.error.issues.map((i) => i.path.join('.')) }, 422);
      const before = t.row;
      const next = { tenant_id: tenant, enabled: before?.enabled ?? false, live_enabled: before?.live_enabled ?? false, rate_limit: before?.rate_limit ?? null, burst_limit: before?.burst_limit ?? null, max_document_bytes: before?.max_document_bytes ?? null, webhooks_allowed: before?.webhooks_allowed ?? null, white_label_allowed: before?.white_label_allowed ?? null, routing_enabled: before?.routing_enabled ?? false, note: before?.note ?? null, ...p.data, updated_at: new Date().toISOString(), updated_by: actor };
      if (next.enabled && !t.policy.plan_includes_api) return j({ error: 'The tenant\'s plan does not include API access (Pro or Enterprise required).' }, 409);
      const { error } = await db.from('api_tenant_policies').upsert(next);
      if (error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
      const changed = Object.keys(p.data).filter((k) => (before as Record<string, unknown> | null)?.[k] !== (p.data as Record<string, unknown>)[k]);
      if (p.data.enabled !== undefined && p.data.enabled !== (before?.enabled ?? false)) await apiAudit({ tenantId: tenant, actor, action: p.data.enabled ? 'api.access.enabled' : 'api.access.disabled', resourceType: 'tenant', resourceId: tenant });
      await apiAudit({ tenantId: tenant, actor, action: 'api.policy.updated', resourceType: 'tenant', resourceId: tenant, meta: { changed, values: p.data } });
      return j({ ok: true, policy: computePolicy(t.account, next as PolicyRow) });
    }
    if (b.action === 'key_create') {
      const K = z.object({ name: z.string().trim().min(1).max(80), environment: z.enum(['test', 'live']), scopes: z.array(z.enum(SCOPES)).min(1), expires_at: z.string().datetime({ offset: true }).nullable().optional(), allowed_ips: z.array(z.string().max(50)).max(20).optional() }).strict();
      const p = K.safeParse(b.key ?? {});
      if (!p.success) return j({ error: 'Please enter a name, environment and at least one scope.' }, 422);
      const r = await createKey({ tenantId: tenant, env: p.data.environment, name: p.data.name, scopes: p.data.scopes as Scope[], expiresAt: p.data.expires_at ?? null, allowedIps: p.data.allowed_ips, createdBy: actor, policy: t.policy });
      return j({ ok: true, key: r.key, secret: r.secret });
    }
    if (['key_rotate', 'key_revoke', 'key_disable', 'key_enable', 'key_expire'].includes(b.action)) {
      if (typeof b.id !== 'string' || !uuid.safeParse(b.id).success) return j({ error: 'Key is missing.' }, 400);
      if (b.action === 'key_rotate') { const r = await rotateKey({ tenantId: tenant, id: b.id, actor, policy: t.policy }); return j({ ok: true, key: r.key, secret: r.secret }); }
      const action = (b.action as string).slice(4) as 'revoke' | 'disable' | 'enable' | 'expire';
      return j({ ok: true, key: await setKeyState({ tenantId: tenant, id: b.id, actor, action, reason: typeof b.reason === 'string' ? b.reason : 'Web-Admin' }) });
    }
    if (b.action === 'delivery_retry') {
      if (typeof b.id !== 'string' || !uuid.safeParse(b.id).success) return j({ error: 'Zustellung fehlt.' }, 400);
      const { data: d } = await db.from('api_webhook_deliveries').select('*').eq('id', b.id).eq('tenant_id', tenant).maybeSingle();
      if (!d) return j({ error: 'Delivery not found.' }, 404);
      if (d.status === 'delivered') return j({ error: 'Bereits zugestellt.' }, 409);
      const r = await deliver(d as never, { manual: true });
      await apiAudit({ tenantId: tenant, environment: d.environment, actor, action: 'webhook.delivery_retried', resourceType: 'webhook_delivery', resourceId: d.id, result: r.ok ? 'success' : 'failure', meta: { status: r.status } });
      return j({ ok: r.ok, status: r.status, error: r.error ?? null });
    }
    if (b.action === 'webhook_test' || b.action === 'webhook_toggle') {
      if (typeof b.id !== 'string' || !uuid.safeParse(b.id).success) return j({ error: 'Webhook fehlt.' }, 400);
      const { data: w } = await db.from('api_webhook_endpoints').select('*').eq('id', b.id).eq('tenant_id', tenant).maybeSingle();
      if (!w) return j({ error: 'Webhook not found.' }, 404);
      if (b.action === 'webhook_toggle') {
        await db.from('api_webhook_endpoints').update({ enabled: !w.enabled, updated_at: new Date().toISOString(), ...(!w.enabled ? { failure_count: 0 } : {}) }).eq('id', w.id);
        await apiAudit({ tenantId: tenant, environment: w.environment, actor, action: 'webhook.updated', resourceType: 'webhook', resourceId: w.id, meta: { enabled: !w.enabled } });
        return j({ ok: true, enabled: !w.enabled });
      }
      const r = await sendTest(tenant, w.environment, w.id);
      await apiAudit({ tenantId: tenant, environment: w.environment, actor, action: 'webhook.tested', resourceType: 'webhook', resourceId: w.id, result: r.ok ? 'success' : 'failure', meta: { status: r.status } });
      return j({ ...r });
    }
    if (b.action === 'sandbox_seed') {
      if (!t.policy.enabled) return j({ error: 'Enable the API for this tenant first.' }, 409);
      const n = Math.min(5, Math.max(1, Number(b.count || 1)));
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const c = await createCase({ tenantId: tenant, env: 'test', actor, requestId: null }, { ...TEST_CASE, external_reference: `TEST-${Date.now().toString(36).toUpperCase()}-${i + 1}` });
        ids.push(c.id);
      }
      await apiAudit({ tenantId: tenant, environment: 'test', actor, action: 'sandbox.seeded', resourceType: 'tenant', resourceId: tenant, meta: { cases: ids.length } });
      return j({ ok: true, cases: ids });
    }
    if (b.action === 'sandbox_reset') {
      // Test environment only: environment = 'test' is fixed in every query.
      const keys = b.include_keys === true;
      const [{ data: docs }, { data: reps }] = await Promise.all([
        db.from('api_documents').select('storage_path').eq('tenant_id', tenant).eq('environment', 'test'),
        db.from('api_reports').select('storage_path').eq('tenant_id', tenant).eq('environment', 'test'),
      ]);
      const paths = [...(docs ?? []), ...(reps ?? [])].map((x) => x.storage_path).filter((p): p is string => typeof p === 'string' && p.startsWith(`${tenant}/test/`));
      for (let i = 0; i < paths.length; i += 100) await db.storage.from(API_BUCKET).remove(paths.slice(i, i + 100));
      const del = async (tb: string) => (await db.from(tb).delete({ count: 'exact' }).eq('tenant_id', tenant).eq('environment', 'test')).count ?? 0;
      const deliveries = await del('api_webhook_deliveries');
      const cases = await del('api_cases'); // documents, validation runs, reports follow via foreign key (ON DELETE CASCADE)
      const idem = await del('api_idempotency_keys');
      const webhooks = b.include_webhooks === true ? await del('api_webhook_endpoints') : 0;
      let revoked = 0;
      if (keys) revoked = (await db.from('api_keys').update({ revoked_at: new Date().toISOString(), revoked_reason: 'sandbox_reset' }, { count: 'exact' }).eq('tenant_id', tenant).eq('environment', 'test').is('revoked_at', null)).count ?? 0;
      await apiAudit({ tenantId: tenant, environment: 'test', actor, action: 'sandbox.reset', resourceType: 'tenant', resourceId: tenant, meta: { cases, files: paths.length, deliveries, idem, webhooks, revoked_keys: revoked } });
      return j({ ok: true, deleted: { cases, files: paths.length, deliveries, idempotency_keys: idem, webhooks, revoked_keys: revoked } });
    }
    return j({ error: 'Unbekannte Aktion.' }, 400);
  } catch (e) {
    if (e instanceof ApiError) return j({ error: e.message, code: e.code }, e.status);
    console.error('admin_api_post', b.action, e instanceof Error ? e.message : e);
    return j({ error: 'Aktion fehlgeschlagen.' }, 500);
  }
}

