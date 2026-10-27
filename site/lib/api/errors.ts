// Einheitliches Fehlermodell (RFC 9457 „Problem Details“) mit maschinenlesbarem Code.

export const ERROR_CODES = {
  BAD_REQUEST: { status: 400, title: 'Bad request' },
  INVALID_JSON: { status: 400, title: 'Invalid JSON body' },
  INVALID_CURSOR: { status: 400, title: 'Invalid pagination cursor' },
  IDEMPOTENCY_KEY_INVALID: { status: 400, title: 'Invalid Idempotency-Key' },
  UNAUTHENTICATED: { status: 401, title: 'Authentication required' },
  INVALID_API_KEY: { status: 401, title: 'Invalid API key' },
  API_KEY_REVOKED: { status: 401, title: 'API key revoked' },
  API_KEY_EXPIRED: { status: 401, title: 'API key expired' },
  API_KEY_DISABLED: { status: 401, title: 'API key disabled' },
  API_NOT_ENABLED: { status: 403, title: 'API access not enabled' },
  PLAN_NOT_ENTITLED: { status: 403, title: 'Plan does not include this feature' },
  LIVE_NOT_ENABLED: { status: 403, title: 'Live environment not enabled' },
  TENANT_LOCKED: { status: 403, title: 'Account locked' },
  INSUFFICIENT_SCOPE: { status: 403, title: 'Insufficient scope' },
  IP_NOT_ALLOWED: { status: 403, title: 'IP address not allowed' },
  RESOURCE_NOT_FOUND: { status: 404, title: 'Resource not found' },
  METHOD_NOT_ALLOWED: { status: 405, title: 'Method not allowed' },
  IDEMPOTENCY_CONFLICT: { status: 409, title: 'Idempotency key reused with a different request' },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, title: 'Request with this Idempotency-Key is still in progress' },
  CONFLICT: { status: 409, title: 'Conflict' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Payload too large' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Unsupported media type' },
  VALIDATION_ERROR: { status: 422, title: 'Validation failed' },
  UNSAFE_WEBHOOK_URL: { status: 422, title: 'Webhook URL not allowed' },
  RATE_LIMIT_EXCEEDED: { status: 429, title: 'Rate limit exceeded' },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error' },
  SERVICE_UNAVAILABLE: { status: 503, title: 'Service unavailable' },
  CONFIGURATION_REQUIRED: { status: 503, title: 'API not configured' },
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export type FieldError = { field: string; code: string; message: string };

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly errors: FieldError[];
  readonly headers: Record<string, string>;
  constructor(code: ErrorCode, detail?: string, opts: { errors?: FieldError[]; headers?: Record<string, string> } = {}) {
    super(detail || ERROR_CODES[code].title);
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.errors = opts.errors ?? [];
    this.headers = opts.headers ?? {};
  }
}

export function problem(code: ErrorCode, requestId: string, detail?: string, errors: FieldError[] = []) {
  const e = ERROR_CODES[code];
  return {
    type: `https://leaserun.com/docs/api/errors#${code.toLowerCase().replace(/_/g, '-')}`,
    title: e.title,
    status: e.status,
    code,
    detail: detail || e.title,
    request_id: requestId,
    errors,
  };
}

// Zod-Fehler → Feldliste (ohne Eingabewerte, damit keine Daten in Fehlermeldungen landen).
export function zodErrors(issues: { path: (string | number)[]; code: string; message: string }[]): FieldError[] {
  return issues.slice(0, 50).map((i) => ({ field: i.path.join('.') || '(body)', code: i.code, message: i.message }));
}
