// Katalog der LeaseRun API v1 – eine Quelle für Playground, Dokumentation im Web-Admin und OpenAPI-Erzeugung
// (scripts/build-openapi.mjs). Ein Test prüft, dass jeder Eintrag einer echten Route entspricht.

export const TEST_CASE_BODY = {
  external_reference: 'TEST-0001',
  customer: { first_name: 'Test', last_name: 'Person (TEST)', email: 'test.person@example.com', phone: '+49 000 0000000' },
  applicants: [{ first_name: 'Test', last_name: 'Person (TEST)', employment_type: 'employed', employed_since: '2018-04-01', monthly_net_income: 6000 }],
  property: { property_type: 'apartment', usage: 'owner_occupied', address: { street: 'Teststraße 1 (TEST)', postal_code: '64354', city: 'Reinheim', state: 'hessen' }, purchase_price: 450000, land_value: 90000, renovation_cost: 0, living_area: 92, year_built: 2004 },
  household: { monthly_net_income: 6000, monthly_expenses: 2200, adults: 1, dependants: 0 },
  equity: { amount: 100000, available_amount: 100000 },
  loan: { requested_amount: 350000, term_years: 30, repayment_rate: 2, interest_rate: 3.8 },
  metadata: { source: 'leaserun-playground', test: true },
};

export const SECTIONS = [
  ['cases', 'Cases'], ['validation', 'Validation'], ['documents', 'Documents'], ['reports', 'Reports'], ['webhooks', 'Webhooks'], ['usage', 'Usage'], ['keys', 'API Keys'], ['health', 'Health'],
];

const LIST = 'Cursor-Paginierung: ?limit=1–100 (Standard 25) und ?cursor=<next_cursor>. Antwort: { object: "list", data: [...], pagination: { has_more, next_cursor } }.';

export const ENDPOINTS = [
  { id: 'case-create', section: 'cases', method: 'POST', path: '/api/v1/cases', scope: 'cases:write', idempotent: true, summary: 'Fall anlegen', status: 201,
    desc: 'Legt einen Finanzierungsfall an. Unbekannte Felder werden abgelehnt (422 VALIDATION_ERROR). external_reference ist je Umgebung eindeutig.', body: TEST_CASE_BODY, capture: { caseId: 'id' }, errors: [401, 403, 409, 422, 429] },
  { id: 'case-list', section: 'cases', method: 'GET', path: '/api/v1/cases', scope: 'cases:read', summary: 'Fälle auflisten', status: 200, desc: `Fälle des Mandanten in der Umgebung des Schlüssels. Filter: ?status=open|action_required|completed, ?external_reference=. ${LIST}`, query: { limit: 25 }, errors: [400, 401, 403, 429] },
  { id: 'case-get', section: 'cases', method: 'GET', path: '/api/v1/cases/{id}', scope: 'cases:read', summary: 'Fall abrufen', status: 200, desc: 'Ein Fall des eigenen Mandanten. Fremde oder unbekannte IDs liefern 404.', errors: [401, 403, 404, 429] },
  { id: 'case-update', section: 'cases', method: 'PATCH', path: '/api/v1/cases/{id}', scope: 'cases:write', summary: 'Fall ändern', status: 200, desc: 'Teilaktualisierung: Felder werden verschachtelt zusammengeführt, null entfernt einen Wert.', body: { household: { monthly_expenses: 2000 }, loan: { requested_amount: 386000 } }, errors: [401, 403, 404, 409, 422, 429] },
  { id: 'case-delete', section: 'cases', method: 'DELETE', path: '/api/v1/cases/{id}', scope: 'cases:write', summary: 'Fall löschen', status: 204, desc: 'Löscht den Fall endgültig samt Unterlagen, Prüfläufen und Berichten (Art. 17 DSGVO).', errors: [401, 403, 404, 429] },
  { id: 'validate', section: 'validation', method: 'GET', path: '/api/v1/cases/{id}/validate', scope: 'validation:execute', summary: 'Vorprüfung sofort ausführen', status: 200, capture: { validationId: 'validation_id' },
    desc: 'Führt die Vorprüfung synchron aus: completeness_score, missing_documents, warnings, errors, checks (code, severity, category, message, field, requires_action, value, threshold), bank_readiness. Keine Kreditentscheidung.', errors: [401, 403, 404, 429] },
  { id: 'validation-create', section: 'validation', method: 'POST', path: '/api/v1/cases/{id}/validations', scope: 'validation:execute', idempotent: true, summary: 'Prüflauf anlegen', status: 201, body: {}, capture: { validationId: 'validation_id' }, desc: 'Wie /validate, als Ressource mit Location-Header und Idempotency-Key.', errors: [401, 403, 404, 409, 422, 429] },
  { id: 'validation-list', section: 'validation', method: 'GET', path: '/api/v1/cases/{id}/validations', scope: 'validation:read', summary: 'Prüfläufe auflisten', status: 200, desc: LIST, errors: [401, 403, 404, 429] },
  { id: 'validation-get', section: 'validation', method: 'GET', path: '/api/v1/cases/{id}/validations/{validationId}', scope: 'validation:read', summary: 'Prüflauf abrufen', status: 200, desc: 'Status pending | processing | completed | failed und Ergebnis.', errors: [401, 403, 404, 429] },
  { id: 'document-upload', section: 'documents', method: 'POST', path: '/api/v1/cases/{id}/documents', scope: 'documents:write', idempotent: true, multipart: true, summary: 'Unterlage hochladen', status: 201, capture: { documentId: 'id' },
    desc: 'multipart/form-data mit "file" (PDF, JPG/JPEG, PNG, TIFF) und "type". Geprüft werden Dateisignatur (Magic Bytes), Endung, MIME-Typ, Größe, SHA-256 nach dem Speichern und – falls angebunden – Virenscan. verification_status "formally_verified" bedeutet formal geprüft, nicht inhaltlich.', form: { type: 'identity' }, errors: [401, 403, 404, 409, 413, 415, 422, 429] },
  { id: 'document-list', section: 'documents', method: 'GET', path: '/api/v1/cases/{id}/documents', scope: 'documents:read', summary: 'Unterlagen auflisten', status: 200, desc: LIST, errors: [401, 403, 404, 429] },
  { id: 'document-get', section: 'documents', method: 'GET', path: '/api/v1/cases/{id}/documents/{documentId}', scope: 'documents:read', summary: 'Unterlage abrufen', status: 200, desc: 'Metadaten und signierter Download-Link (5 Minuten gültig). Dateien liegen ausschließlich in einem privaten Speicher.', errors: [401, 403, 404, 429] },
  { id: 'document-delete', section: 'documents', method: 'DELETE', path: '/api/v1/cases/{id}/documents/{documentId}', scope: 'documents:write', summary: 'Unterlage löschen', status: 204, desc: 'Entfernt Datei und Datensatz.', errors: [401, 403, 404, 429] },
  { id: 'report-create', section: 'reports', method: 'POST', path: '/api/v1/cases/{id}/reports', scope: 'reports:create', idempotent: true, summary: 'Bericht erzeugen (asynchron)', status: 202, body: {}, capture: { reportId: 'report_id' },
    desc: 'Antwort 202 mit report_id und status "queued". Branding: white_label im Enterprise-Tarif, sonst leaserun. Testumgebung: Wasserzeichen TEST.', errors: [401, 403, 404, 409, 422, 429] },
  { id: 'report-list', section: 'reports', method: 'GET', path: '/api/v1/cases/{id}/reports', scope: 'reports:read', summary: 'Berichte auflisten', status: 200, desc: LIST, errors: [401, 403, 404, 429] },
  { id: 'report-get', section: 'reports', method: 'GET', path: '/api/v1/cases/{id}/reports/{reportId}', scope: 'reports:read', summary: 'Berichtstatus und Download', status: 200, desc: 'queued | processing | completed | failed. Bei completed: download_url (signiert, 5 Minuten).', errors: [401, 403, 404, 429] },
  { id: 'webhook-create', section: 'webhooks', method: 'POST', path: '/api/v1/webhooks', scope: 'webhooks:write', idempotent: true, summary: 'Webhook anlegen', status: 201, capture: { webhookId: 'id' }, enterprise: true,
    desc: 'Nur Enterprise. https, Port 443, öffentliche Ziele (SSRF-Schutz). Das Geheimnis (whsec_…) erscheint nur in dieser Antwort.', body: { url: 'https://webhook.site/your-id', events: ['case.completed', 'case.action_required', 'document.verified', 'validation.completed', 'report.completed'], description: 'Playground' }, errors: [401, 403, 409, 422, 429] },
  { id: 'webhook-list', section: 'webhooks', method: 'GET', path: '/api/v1/webhooks', scope: 'webhooks:read', summary: 'Webhooks auflisten', status: 200, enterprise: true, desc: LIST, errors: [401, 403, 429] },
  { id: 'webhook-get', section: 'webhooks', method: 'GET', path: '/api/v1/webhooks/{webhookId}', scope: 'webhooks:read', summary: 'Webhook abrufen', status: 200, enterprise: true, desc: 'Ohne Geheimnis (nur secret_prefix).', errors: [401, 403, 404, 429] },
  { id: 'webhook-update', section: 'webhooks', method: 'PATCH', path: '/api/v1/webhooks/{webhookId}', scope: 'webhooks:write', summary: 'Webhook ändern', status: 200, enterprise: true, body: { enabled: true }, desc: 'URL, Ereignisse, Beschreibung oder enabled ändern.', errors: [401, 403, 404, 422, 429] },
  { id: 'webhook-delete', section: 'webhooks', method: 'DELETE', path: '/api/v1/webhooks/{webhookId}', scope: 'webhooks:write', summary: 'Webhook löschen', status: 204, enterprise: true, desc: 'Löscht Endpunkt und Zustellverlauf.', errors: [401, 403, 404, 429] },
  { id: 'webhook-test', section: 'webhooks', method: 'POST', path: '/api/v1/webhooks/{webhookId}/test', scope: 'webhooks:test', summary: 'Testereignis senden', status: 200, enterprise: true, desc: 'Sendet sofort ein signiertes Ereignis "webhook.test" und liefert das Zustellergebnis.', errors: [401, 403, 404, 429] },
  { id: 'webhook-deliveries', section: 'webhooks', method: 'GET', path: '/api/v1/webhooks/{webhookId}/deliveries', scope: 'webhooks:read', summary: 'Zustellverlauf', status: 200, enterprise: true, desc: `Versuche, Status, HTTP-Code, Dauer. ${LIST}`, errors: [401, 403, 404, 429] },
  { id: 'usage', section: 'usage', method: 'GET', path: '/api/v1/usage', scope: 'usage:read', summary: 'Nutzung', status: 200, query: { range: '30d' }, desc: 'Anfragen, 4xx, 5xx, Rate-Limit-Ereignisse und Latenzen (Ø, P95, P99) für 24h | 7d | 30d | 90d.', errors: [400, 401, 403, 429] },
  { id: 'key-list', section: 'keys', method: 'GET', path: '/api/v1/api-keys', scope: 'api_keys:read', summary: 'Schlüssel auflisten', status: 200, desc: `Nur Präfix, nie das Geheimnis. ${LIST}`, errors: [401, 403, 429] },
  { id: 'key-create', section: 'keys', method: 'POST', path: '/api/v1/api-keys', scope: 'api_keys:write', idempotent: true, summary: 'Schlüssel anlegen', status: 201, capture: { keyId: 'id' }, body: { name: 'CRM Integration', scopes: ['cases:read', 'cases:write', 'validation:execute', 'validation:read'] }, desc: 'Gleiche Umgebung wie der aufrufende Schlüssel; Scopes höchstens die eigenen. Geheimnis nur einmal in der Antwort.', errors: [401, 403, 409, 422, 429] },
  { id: 'key-get', section: 'keys', method: 'GET', path: '/api/v1/api-keys/{keyId}', scope: 'api_keys:read', summary: 'Schlüssel abrufen', status: 200, desc: 'Status active | disabled | expired | revoked.', errors: [401, 403, 404, 429] },
  { id: 'key-rotate', section: 'keys', method: 'POST', path: '/api/v1/api-keys/{keyId}/rotate', scope: 'api_keys:write', idempotent: true, summary: 'Schlüssel rotieren', status: 201, desc: 'Neuer Schlüssel mit gleichen Eigenschaften; der alte ist sofort ungültig (401 API_KEY_REVOKED).', errors: [401, 403, 404, 409, 429] },
  { id: 'key-revoke', section: 'keys', method: 'POST', path: '/api/v1/api-keys/{keyId}/revoke', scope: 'api_keys:write', summary: 'Schlüssel widerrufen', status: 200, body: { reason: 'nicht mehr benötigt' }, desc: 'Endgültig; nicht rückgängig zu machen.', errors: [401, 403, 404, 409, 429] },
  { id: 'health', section: 'health', method: 'GET', path: '/api/v1/health', scope: null, summary: 'Status', status: 200, desc: 'Öffentlich, ohne Schlüssel: Status je Komponente (operational | degraded | unavailable), keine internen Details.', errors: [429, 503] },
];

export const ERRORS = [
  [400, 'BAD_REQUEST, INVALID_JSON, INVALID_CURSOR, IDEMPOTENCY_KEY_INVALID'],
  [401, 'UNAUTHENTICATED, INVALID_API_KEY, API_KEY_REVOKED, API_KEY_EXPIRED, API_KEY_DISABLED'],
  [403, 'API_NOT_ENABLED, PLAN_NOT_ENTITLED, LIVE_NOT_ENABLED, TENANT_LOCKED, INSUFFICIENT_SCOPE, IP_NOT_ALLOWED'],
  [404, 'RESOURCE_NOT_FOUND (auch für Ressourcen anderer Mandanten)'],
  [409, 'IDEMPOTENCY_CONFLICT, IDEMPOTENCY_IN_PROGRESS, CONFLICT'],
  [413, 'PAYLOAD_TOO_LARGE'],
  [415, 'UNSUPPORTED_MEDIA_TYPE'],
  [422, 'VALIDATION_ERROR, UNSAFE_WEBHOOK_URL'],
  [429, 'RATE_LIMIT_EXCEEDED (mit Retry-After)'],
  [500, 'INTERNAL_ERROR (request_id angeben)'],
  [503, 'SERVICE_UNAVAILABLE, CONFIGURATION_REQUIRED'],
];

export const SCOPE_LIST = ['cases:read', 'cases:write', 'validation:read', 'validation:execute', 'documents:read', 'documents:write', 'reports:read', 'reports:create', 'webhooks:read', 'webhooks:write', 'webhooks:test', 'usage:read', 'api_keys:read', 'api_keys:write'];
export const EVENTS = ['case.completed', 'case.action_required', 'document.verified', 'validation.completed', 'report.completed'];
