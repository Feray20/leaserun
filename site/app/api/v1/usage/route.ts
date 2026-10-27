import { supabaseAdmin } from '@/lib/supabase/admin';
import { apiRoute } from '@/lib/api/pipeline';
import { ApiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RANGES: Record<string, { ms: number; bucket: 'hour' | 'day' }> = { '24h': { ms: 864e5, bucket: 'hour' }, '7d': { ms: 7 * 864e5, bucket: 'day' }, '30d': { ms: 30 * 864e5, bucket: 'day' }, '90d': { ms: 90 * 864e5, bucket: 'day' } };

// GET /api/v1/usage?range=24h|7d|30d|90d – Nutzung der eigenen Umgebung (Grundlage für spätere nutzungsbasierte Abrechnung).
export const GET = apiRoute({ route: '/api/v1/usage', scope: 'usage:read' }, async (ctx) => {
  const range = ctx.url.searchParams.get('range') || '30d';
  const R = RANGES[range];
  if (!R) throw new ApiError('BAD_REQUEST', 'range must be 24h, 7d, 30d or 90d.');
  const from = new Date(Date.now() - R.ms).toISOString();
  const { data, error } = await supabaseAdmin().rpc('api_usage_series', { p_tenant: ctx.tenantId, p_env: ctx.env, p_from: from, p_bucket: R.bucket });
  if (error) throw new ApiError('SERVICE_UNAVAILABLE');
  const rows = (data ?? []) as { bucket: string; requests: number; errors_4xx: number; errors_5xx: number; rate_limited: number; avg_ms: number | null; p95_ms: number | null; p99_ms: number | null }[];
  const sum = (k: 'requests' | 'errors_4xx' | 'errors_5xx' | 'rate_limited') => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const total = sum('requests');
  return { status: 200, body: {
    object: 'usage', environment: ctx.env, range, from, plan: ctx.policy.plan, rate_limit_per_minute: ctx.policy.rate_limit,
    totals: { requests: total, errors_4xx: sum('errors_4xx'), errors_5xx: sum('errors_5xx'), rate_limited: sum('rate_limited'), error_rate: total ? Math.round(((sum('errors_4xx') + sum('errors_5xx')) / total) * 10000) / 100 : 0 },
    series: rows.map((r) => ({ ...r, requests: Number(r.requests), errors_4xx: Number(r.errors_4xx), errors_5xx: Number(r.errors_5xx), rate_limited: Number(r.rate_limited), avg_ms: r.avg_ms == null ? null : Number(r.avg_ms), p95_ms: r.p95_ms == null ? null : Number(r.p95_ms), p99_ms: r.p99_ms == null ? null : Number(r.p99_ms) })),
  } };
});
