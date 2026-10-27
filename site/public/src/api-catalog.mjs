// Catalog of the LeaseRun API v1 – one source for the playground, the Web-Admin documentation and OpenAPI generation
// (scripts/build-openapi.mjs). A test checks that every entry matches a real route.

export const TEST_CASE_BODY = {
  external_reference: 'TEST-0001',
  customer: { first_name: 'Test', last_name: 'Person (TEST)', email: 'test.person@example.com', phone: '+1 555 010 0000' },
  applicants: [{ first_name: 'Test', last_name: 'Person (TEST)', employment_type: 'employed', employed_since: '2018-04-01', monthly_gross_income: 10000, monthly_net_income: 7400 }],
  property: { property_type: 'apartment', usage: 'owner_occupied', address: { street: '100 Test St Unit 1 (TEST)', postal_code: '78701', city: 'Austin', state: 'TX' }, purchase_price: 450000, land_value: 90000, renovation_cost: 0, closing_costs: 13500, annual_property_tax: 8100, annual_insurance: 1800, monthly_hoa: 250, living_area: 990, year_built: 2004 },
  household: { monthly_gross_income: 10000, monthly_net_income: 7400, monthly_debt_payments: 450, monthly_expenses: 2200, adults: 1, dependants: 0 },
  equity: { amount: 100000, available_amount: 100000 },
  loan: { requested_amount: 350000, term_years: 30, interest_rate: 6.5, loan_program: 'conventional' },
  metadata: { source: 'leaserun-playground', test: true },
};

export const SECTIONS = [
  ['cases', 'Cases'], ['validation', 'Validation'], ['documents', 'Documents'], ['reports', 'Reports'], ['webhooks', 'Webhooks'], ['usage', 'Usage'], ['keys', 'API Keys'], ['health', 'Health'],
];

const LIST = 'Cursor pagination: ?limit=1–100 (default 25) and ?cursor=<next_cursor>. Response: { object: "list", data: [...], pagination: { has_more, next_cursor } }.';

export const ENDPOINTS = [
  { id: 'case-create', section: 'cases', method: 'POST', path: '/api/v1/cases', scope: 'cases:write', idempotent: true, summary: 'Create a case', status: 201,
    desc: 'Creates a financing case. Unknown fields are rejected (422 VALIDATION_ERROR). external_reference is unique per environment. Amounts in USD, state as a two-letter code (e.g. TX), living_area in square feet.', body: TEST_CASE_BODY, capture: { caseId: 'id' }, errors: [401, 403, 409, 422, 429] },
  { id: 'case-list', section: 'cases', method: 'GET', path: '/api/v1/cases', scope: 'cases:read', summary: 'List cases', status: 200, desc: `Cases of the tenant in the key\'s environment. Filters: ?status=open|action_required|completed, ?external_reference=. ${LIST}`, query: { limit: 25 }, errors: [400, 401, 403, 429] },
  { id: 'case-get', section: 'cases', method: 'GET', path: '/api/v1/cases/{id}', scope: 'cases:read', summary: 'Retrieve a case', status: 200, desc: 'A case of your own tenant. Foreign or unknown IDs return 404.', errors: [401, 403, 404, 429] },
  { id: 'case-update', section: 'cases', method: 'PATCH', path: '/api/v1/cases/{id}', scope: 'cases:write', summary: 'Update a case', status: 200, desc: 'Partial update: fields are deep-merged, null removes a value.', body: { household: { monthly_debt_payments: 400 }, loan: { requested_amount: 363500 } }, errors: [401, 403, 404, 409, 422, 429] },
  { id: 'case-delete', section: 'cases', method: 'DELETE', path: '/api/v1/cases/{id}', scope: 'cases:write', summary: 'Delete a case', status: 204, desc: 'Permanently deletes the case with its documents, validation runs and reports (supports consumer deletion requests under state privacy laws).', errors: [401, 403, 404, 429] },
  { id: 'validate', section: 'validation', method: 'GET', path: '/api/v1/cases/{id}/validate', scope: 'validation:execute', summary: 'Run pre-check now', status: 200, capture: { validationId: 'validation_id' },
    desc: 'Runs the pre-check synchronously: completeness_score, missing_documents, warnings, errors, checks (code, severity, category, message, field, requires_action, value, threshold), bank_readiness and figures (PITIA, LTV, back-end DTI, DSCR). Not a credit decision.', errors: [401, 403, 404, 429] },
  { id: 'validation-create', section: 'validation', method: 'POST', path: '/api/v1/cases/{id}/validations', scope: 'validation:execute', idempotent: true, summary: 'Create a validation run', status: 201, body: {}, capture: { validationId: 'validation_id' }, desc: 'Like /validate, as a resource with Location header and Idempotency-Key.', errors: [401, 403, 404, 409, 422, 429] },
  { id: 'validation-list', section: 'validation', method: 'GET', path: '/api/v1/cases/{id}/validations', scope: 'validation:read', summary: 'List validation runs', status: 200, desc: LIST, errors: [401, 403, 404, 429] },
  { id: 'validation-get', section: 'validation', method: 'GET', path: '/api/v1/cases/{id}/validations/{validationId}', scope: 'validation:read', summary: 'Retrieve a validation run', status: 200, desc: 'Status pending | processing | completed | failed and result.', errors: [401, 403, 404, 429] },
  { id: 'document-upload', section: 'documents', method: 'POST', path: '/api/v1/cases/{id}/documents', scope: 'documents:write', idempotent: true, multipart: true, summary: 'Upload a document', status: 201, capture: { documentId: 'id' },
    desc: 'multipart/form-data with "file" (PDF, JPG/JPEG, PNG, TIFF) and "type". Checked: file signature (magic bytes), extension, MIME type, size, SHA-256 after storage and – if connected – malware scan. verification_status "formally_verified" means checked formally, not for content. Do not upload documents containing full Social Security numbers unless required by the lender.', form: { type: 'identity' }, errors: [401, 403, 404, 409, 413, 415, 422, 429] },
  { id: 'document-list', section: 'documents', method: 'GET', path: '/api/v1/cases/{id}/documents', scope: 'documents:read', summary: 'List documents', status: 200, desc: LIST, errors: [401, 403, 404, 429] },
  { id: 'document-get', section: 'documents', method: 'GET', path: '/api/v1/cases/{id}/documents/{documentId}', scope: 'documents:read', summary: 'Retrieve a document', status: 200, desc: 'Metadata and a signed download link (valid for 5 minutes). Files are stored only in private storage.', errors: [401, 403, 404, 429] },
  { id: 'document-delete', section: 'documents', method: 'DELETE', path: '/api/v1/cases/{id}/documents/{documentId}', scope: 'documents:write', summary: 'Delete a document', status: 204, desc: 'Removes the file and the record.', errors: [401, 403, 404, 429] },
  { id: 'report-create', section: 'reports', method: 'POST', path: '/api/v1/cases/{id}/reports', scope: 'reports:create', idempotent: true, summary: 'Create a report (asynchronous)', status: 202, body: {}, capture: { reportId: 'report_id' },
    desc: 'Responds 202 with report_id and status "queued". Branding: white_label on the Enterprise plan, otherwise leaserun. Test environment: TEST watermark.', errors: [401, 403, 404, 409, 422, 429] },
  { id: 'report-list', section: 'reports', method: 'GET', path: '/api/v1/cases/{id}/reports', scope: 'reports:read', summary: 'List reports', status: 200, desc: LIST, errors: [401, 403, 404, 429] },
  { id: 'report-get', section: 'reports', method: 'GET', path: '/api/v1/cases/{id}/reports/{reportId}', scope: 'reports:read', summary: 'Report status and download', status: 200, desc: 'queued | processing | completed | failed. When completed: download_url (signed, 5 minutes).', errors: [401, 403, 404, 429] },
  { id: 'webhook-create', section: 'webhooks', method: 'POST', path: '/api/v1/webhooks', scope: 'webhooks:write', idempotent: true, summary: 'Create a webhook', status: 201, capture: { webhookId: 'id' }, enterprise: true,
    desc: 'Enterprise only. https, port 443, public targets (SSRF protection). The secret (whsec_…) appears only in this response.', body: { url: 'https://webhook.site/your-id', events: ['case.completed', 'case.action_required', 'document.verified', 'validation.completed', 'report.completed'], description: 'Playground' }, errors: [401, 403, 409, 422, 429] },
  { id: 'webhook-list', section: 'webhooks', method: 'GET', path: '/api/v1/webhooks', scope: 'webhooks:read', summary: 'List webhooks', status: 200, enterprise: true, desc: LIST, errors: [401, 403, 429] },
  { id: 'webhook-get', section: 'webhooks', method: 'GET', path: '/api/v1/webhooks/{webhookId}', scope: 'webhooks:read', summary: 'Retrieve a webhook', status: 200, enterprise: true, desc: 'Without the secret (secret_prefix only).', errors: [401, 403, 404, 429] },
  { id: 'webhook-update', section: 'webhooks', method: 'PATCH', path: '/api/v1/webhooks/{webhookId}', scope: 'webhooks:write', summary: 'Update a webhook', status: 200, enterprise: true, body: { enabled: true }, desc: 'Change URL, events, description or enabled.', errors: [401, 403, 404, 422, 429] },
  { id: 'webhook-delete', section: 'webhooks', method: 'DELETE', path: '/api/v1/webhooks/{webhookId}', scope: 'webhooks:write', summary: 'Delete a webhook', status: 204, enterprise: true, desc: 'Deletes the endpoint and its delivery history.', errors: [401, 403, 404, 429] },
  { id: 'webhook-test', section: 'webhooks', method: 'POST', path: '/api/v1/webhooks/{webhookId}/test', scope: 'webhooks:test', summary: 'Send a test event', status: 200, enterprise: true, desc: 'Immediately sends a signed "webhook.test" event and returns the delivery result.', errors: [401, 403, 404, 429] },
  { id: 'webhook-deliveries', section: 'webhooks', method: 'GET', path: '/api/v1/webhooks/{webhookId}/deliveries', scope: 'webhooks:read', summary: 'Delivery history', status: 200, enterprise: true, desc: `Attempts, status, HTTP code, duration. ${LIST}`, errors: [401, 403, 404, 429] },
  { id: 'usage', section: 'usage', method: 'GET', path: '/api/v1/usage', scope: 'usage:read', summary: 'Usage', status: 200, query: { range: '30d' }, desc: 'Requests, 4xx, 5xx, rate limit events and latencies (avg, P95, P99) for 24h | 7d | 30d | 90d.', errors: [400, 401, 403, 429] },
  { id: 'key-list', section: 'keys', method: 'GET', path: '/api/v1/api-keys', scope: 'api_keys:read', summary: 'List API keys', status: 200, desc: `Prefix only, never the secret. ${LIST}`, errors: [401, 403, 429] },
  { id: 'key-create', section: 'keys', method: 'POST', path: '/api/v1/api-keys', scope: 'api_keys:write', idempotent: true, summary: 'Create an API key', status: 201, capture: { keyId: 'id' }, body: { name: 'CRM Integration', scopes: ['cases:read', 'cases:write', 'validation:execute', 'validation:read'] }, desc: 'Same environment as the calling key; scopes at most its own. The secret is returned only once.', errors: [401, 403, 409, 422, 429] },
  { id: 'key-get', section: 'keys', method: 'GET', path: '/api/v1/api-keys/{keyId}', scope: 'api_keys:read', summary: 'Retrieve an API key', status: 200, desc: 'Status active | disabled | expired | revoked.', errors: [401, 403, 404, 429] },
  { id: 'key-rotate', section: 'keys', method: 'POST', path: '/api/v1/api-keys/{keyId}/rotate', scope: 'api_keys:write', idempotent: true, summary: 'Rotate an API key', status: 201, desc: 'New key with the same properties; the old one stops working immediately (401 API_KEY_REVOKED).', errors: [401, 403, 404, 409, 429] },
  { id: 'key-revoke', section: 'keys', method: 'POST', path: '/api/v1/api-keys/{keyId}/revoke', scope: 'api_keys:write', summary: 'Revoke an API key', status: 200, body: { reason: 'no longer needed' }, desc: 'Permanent; cannot be undone.', errors: [401, 403, 404, 409, 429] },
  { id: 'health', section: 'health', method: 'GET', path: '/api/v1/health', scope: null, summary: 'Health', status: 200, desc: 'Public, no key required: status per component (operational | degraded | unavailable), no internal details.', errors: [429, 503] },
];

export const ERRORS = [
  [400, 'BAD_REQUEST, INVALID_JSON, INVALID_CURSOR, IDEMPOTENCY_KEY_INVALID'],
  [401, 'UNAUTHENTICATED, INVALID_API_KEY, API_KEY_REVOKED, API_KEY_EXPIRED, API_KEY_DISABLED'],
  [403, 'API_NOT_ENABLED, PLAN_NOT_ENTITLED, LIVE_NOT_ENABLED, TENANT_LOCKED, INSUFFICIENT_SCOPE, IP_NOT_ALLOWED'],
  [404, 'RESOURCE_NOT_FOUND (also for resources of other tenants)'],
  [409, 'IDEMPOTENCY_CONFLICT, IDEMPOTENCY_IN_PROGRESS, CONFLICT'],
  [413, 'PAYLOAD_TOO_LARGE'],
  [415, 'UNSUPPORTED_MEDIA_TYPE'],
  [422, 'VALIDATION_ERROR, UNSAFE_WEBHOOK_URL'],
  [429, 'RATE_LIMIT_EXCEEDED (with Retry-After)'],
  [500, 'INTERNAL_ERROR (include the request_id)'],
  [503, 'SERVICE_UNAVAILABLE, CONFIGURATION_REQUIRED'],
];

export const SCOPE_LIST = ['cases:read', 'cases:write', 'validation:read', 'validation:execute', 'documents:read', 'documents:write', 'reports:read', 'reports:create', 'webhooks:read', 'webhooks:write', 'webhooks:test', 'usage:read', 'api_keys:read', 'api_keys:write'];
export const EVENTS = ['case.completed', 'case.action_required', 'document.verified', 'validation.completed', 'report.completed'];
