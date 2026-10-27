// API changelog (also in docs/api/CHANGELOG.md). Newest entries first; breaking changes only with a new major version (/api/v2).
export const CHANGELOG = [
  {
    version: '1.0.0',
    date: '2026-10-27',
    status: 'Early access',
    changes: [
      'First version of the LeaseRun API: cases, pre-check, documents, reports, webhooks, usage, API keys.',
      'Authentication with bearer keys (test_… / live_…), scopes per key, IP allowlist.',
      'Rate limit per plan with X-RateLimit headers, Idempotency-Key for all create requests.',
      'Webhooks with HMAC-SHA-256 signature, retries with exponential backoff and delivery history.',
      'Test environment via test_ keys, strictly separated from live data.',
      'US underwriting model: PITIA, front-end and back-end DTI on gross income, LTV/PMI, cash to close, reserves and DSCR; US state codes.',
    ],
    deprecated: [] as string[],
    breaking: [] as string[],
  },
];

// For future deprecations: endpoints with date (RFC 9745 "Deprecation", RFC 8594 "Sunset").
export const DEPRECATIONS: Record<string, { deprecation: string; sunset: string; link?: string }> = {};

export function deprecationHeaders(route: string): Record<string, string> {
  const d = DEPRECATIONS[route];
  if (!d) return {};
  return { Deprecation: `@${Math.floor(new Date(d.deprecation).getTime() / 1000)}`, Sunset: new Date(d.sunset).toUTCString(), ...(d.link ? { Link: `<${d.link}>; rel="deprecation"` } : {}) };
}
