// Erzeugt openapi/leaserun-api.json und openapi/leaserun-api.yaml (OpenAPI 3.1) aus dem Endpunkt-Katalog
// (public/src/api-catalog.mjs). Aufruf: node scripts/build-openapi.mjs
// tests/openapi.test.ts prüft, dass jeder dokumentierte Pfad als echte Route existiert und umgekehrt.
import { writeFileSync, mkdirSync } from 'node:fs';
import { ENDPOINTS, EVENTS, SCOPE_LIST, TEST_CASE_BODY } from '../public/src/api-catalog.mjs';

const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const money = { type: 'number', minimum: 0 };
const STATES = ['baden-wuerttemberg', 'bayern', 'berlin', 'brandenburg', 'bremen', 'hamburg', 'hessen', 'mecklenburg-vorpommern', 'niedersachsen', 'nordrhein-westfalen', 'rheinland-pfalz', 'saarland', 'sachsen', 'sachsen-anhalt', 'schleswig-holstein', 'thueringen'];
const DOC_TYPES = ['identity', 'income_proof', 'employment_contract', 'tax_assessment', 'annual_financials', 'bwa', 'equity_proof', 'bank_statement', 'existing_loans', 'expose', 'land_register', 'cadastral_map', 'floor_plan', 'living_area_calculation', 'energy_certificate', 'declaration_of_division', 'owners_meeting_minutes', 'service_charge_statement', 'rental_agreement', 'purchase_contract_draft', 'building_insurance', 'self_disclosure', 'other'];
const strict = (properties, extra = {}) => ({ type: 'object', additionalProperties: false, properties, ...extra });

const schemas = {
  CaseInput: strict({
    external_reference: { type: 'string', maxLength: 120 },
    customer: strict({ first_name: { type: 'string', maxLength: 80 }, last_name: { type: 'string', maxLength: 80 }, email: { type: 'string', format: 'email' }, phone: { type: 'string', pattern: '^[+0-9 ()/-]{5,30}$' } }),
    applicants: { type: 'array', maxItems: 4, items: strict({ first_name: { type: 'string' }, last_name: { type: 'string' }, employment_type: { enum: ['employed', 'civil_servant', 'self_employed', 'retired', 'other'] }, employed_since: { type: 'string', format: 'date' }, monthly_net_income: money }) },
    property: strict({
      property_type: { enum: ['apartment', 'single_family_house', 'two_family_house', 'multi_family_house', 'land', 'other'] }, usage: { enum: ['owner_occupied', 'rented', 'mixed'] },
      address: strict({ street: { type: 'string' }, postal_code: { type: 'string', pattern: '^\\d{5}$' }, city: { type: 'string' }, state: { enum: STATES } }),
      purchase_price: money, land_value: money, renovation_cost: money, living_area: money, year_built: { type: 'integer', minimum: 1500, maximum: 2100 }, monthly_cold_rent: money,
    }),
    household: strict({ monthly_net_income: money, monthly_expenses: money, adults: { type: 'integer', minimum: 1, maximum: 10 }, dependants: { type: 'integer', minimum: 0, maximum: 20 } }),
    equity: strict({ amount: money, available_amount: money }),
    loan: strict({ requested_amount: money, term_years: { type: 'integer', minimum: 1, maximum: 50 }, repayment_rate: { type: 'number', minimum: 0, maximum: 20, description: 'Anfängliche Tilgung in % p. a.' }, interest_rate: { type: 'number', minimum: 0, maximum: 20, description: 'Sollzins in % p. a. (Annahme 3,8 %, falls leer)' } }),
    metadata: { type: 'object', maxProperties: 20, additionalProperties: { type: ['string', 'number', 'boolean'] } },
  }),
  Case: { allOf: [ref('CaseInput'), { type: 'object', required: ['id', 'object', 'environment', 'status', 'created_at'], properties: { id: { type: 'string', format: 'uuid' }, object: { const: 'case' }, environment: { enum: ['test', 'live'] }, test: { type: 'boolean' }, status: { enum: ['open', 'action_required', 'completed'] }, created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' } } }] },
  Check: strict({ code: { type: 'string', examples: ['LIQUIDITY_GAP'] }, category: { type: 'string' }, severity: { enum: ['info', 'warning', 'error'] }, passed: { type: 'boolean' }, message: { type: 'string' }, field: { type: ['string', 'null'] }, requires_action: { type: 'boolean' }, value: { type: ['number', 'string', 'null'] }, threshold: { type: ['number', 'string', 'null'] } }, { required: ['code', 'category', 'severity', 'message', 'field', 'requires_action', 'value', 'threshold'] }),
  Validation: { type: 'object', required: ['validation_id', 'status', 'completeness_score', 'missing_documents', 'warnings', 'errors', 'checks', 'evaluated_at'], properties: {
    validation_id: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, object: { const: 'validation' }, case_id: { type: 'string', format: 'uuid' }, environment: { enum: ['test', 'live'] },
    status: { enum: ['pending', 'processing', 'completed', 'failed'] }, completeness_score: { type: ['integer', 'null'], minimum: 0, maximum: 100 }, bank_readiness: { enum: ['ready', 'needs_attention', 'not_ready', null] },
    missing_documents: { type: 'array', items: { enum: DOC_TYPES } }, missing_fields: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: ref('Check') }, errors: { type: 'array', items: ref('Check') }, checks: { type: 'array', items: ref('Check') },
    figures: { type: 'object', additionalProperties: { type: ['number', 'null'] } }, assumptions: { type: 'object' }, disclaimer: { type: 'string' },
    engine_version: { type: 'string' }, duration_ms: { type: ['integer', 'null'] }, created_at: { type: 'string', format: 'date-time' }, evaluated_at: { type: ['string', 'null'], format: 'date-time' } } },
  Document: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, object: { const: 'document' }, case_id: { type: 'string', format: 'uuid' }, type: { enum: DOC_TYPES }, filename: { type: 'string' }, mime_type: { enum: ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'] }, size: { type: 'integer' }, sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, status: { enum: ['uploaded', 'processing', 'classified', 'verified', 'rejected', 'failed'] }, classification: { type: ['string', 'null'] }, verification_status: { enum: ['pending', 'formally_verified', 'rejected'] }, malware_scan: { enum: ['not_configured', 'clean', 'infected', 'error'] }, uploaded_at: { type: 'string', format: 'date-time' }, download_url: { type: ['string', 'null'] }, download_expires_at: { type: ['string', 'null'], format: 'date-time' } } },
  Report: { type: 'object', required: ['report_id', 'status'], properties: { report_id: { type: 'string', format: 'uuid' }, id: { type: 'string', format: 'uuid' }, object: { const: 'report' }, case_id: { type: 'string', format: 'uuid' }, validation_id: { type: ['string', 'null'] }, status: { enum: ['queued', 'processing', 'completed', 'failed'] }, branding: { enum: ['leaserun', 'white_label'] }, sha256: { type: ['string', 'null'] }, size: { type: ['integer', 'null'] }, download_url: { type: ['string', 'null'] }, download_expires_at: { type: ['string', 'null'] }, created_at: { type: 'string', format: 'date-time' }, completed_at: { type: ['string', 'null'] } } },
  WebhookInput: strict({ url: { type: 'string', format: 'uri', pattern: '^https://' }, events: { type: 'array', minItems: 1, items: { enum: EVENTS } }, description: { type: 'string', maxLength: 200 }, enabled: { type: 'boolean' } }, { required: ['url', 'events'] }),
  Webhook: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, object: { const: 'webhook' }, url: { type: 'string' }, events: { type: 'array', items: { enum: EVENTS } }, enabled: { type: 'boolean' }, secret_prefix: { type: 'string' }, secret: { type: 'string', description: 'Nur in der Antwort auf POST /webhooks' }, failure_count: { type: 'integer' }, created_at: { type: 'string', format: 'date-time' }, last_delivery_at: { type: ['string', 'null'] } } },
  ApiKeyInput: strict({ name: { type: 'string', maxLength: 80 }, environment: { enum: ['test', 'live'] }, scopes: { type: 'array', minItems: 1, items: { enum: SCOPE_LIST } }, expires_at: { type: 'string', format: 'date-time' }, allowed_ips: { type: 'array', maxItems: 20, items: { type: 'string' } } }, { required: ['name', 'scopes'] }),
  ApiKey: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, object: { const: 'api_key' }, name: { type: 'string' }, environment: { enum: ['test', 'live'] }, prefix: { type: 'string' }, masked: { type: 'string' }, scopes: { type: 'array', items: { enum: SCOPE_LIST } }, allowed_ips: { type: 'array', items: { type: 'string' } }, status: { enum: ['active', 'disabled', 'expired', 'revoked'] }, secret: { type: 'string', description: 'Nur bei Anlage/Rotation' }, expires_at: { type: ['string', 'null'] }, last_used_at: { type: ['string', 'null'] } } },
  Usage: { type: 'object', properties: { object: { const: 'usage' }, range: { enum: ['24h', '7d', '30d', '90d'] }, totals: { type: 'object' }, series: { type: 'array', items: { type: 'object' } } } },
  Health: { type: 'object', properties: { status: { enum: ['operational', 'degraded', 'unavailable'] }, version: { type: 'string' }, components: { type: 'object', additionalProperties: { enum: ['operational', 'degraded', 'unavailable'] } } } },
  Pagination: { type: 'object', properties: { has_more: { type: 'boolean' }, next_cursor: { type: ['string', 'null'] } } },
  Problem: { type: 'object', required: ['type', 'title', 'status', 'code', 'detail', 'request_id', 'errors'], properties: { type: { type: 'string', format: 'uri' }, title: { type: 'string' }, status: { type: 'integer' }, code: { type: 'string', examples: ['VALIDATION_ERROR'] }, detail: { type: 'string' }, request_id: { type: 'string' }, errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } } } } } },
  WebhookEvent: { type: 'object', properties: { id: { type: 'string', format: 'uuid', description: 'Delivery-ID (= X-LeaseRun-Delivery)' }, object: { const: 'event' }, type: { enum: [...EVENTS, 'webhook.test'] }, created_at: { type: 'string', format: 'date-time' }, environment: { enum: ['test', 'live'] }, test: { type: 'boolean' }, attempt: { type: 'integer' }, data: { type: 'object' } } },
};

const RESP = { 'cases': 'Case', 'validation': 'Validation', 'documents': 'Document', 'reports': 'Report', 'webhooks': 'Webhook', 'usage': 'Usage', 'keys': 'ApiKey', 'health': 'Health' };
const rlHeaders = { 'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' }, 'X-RateLimit-Limit': { $ref: '#/components/headers/X-RateLimit-Limit' }, 'X-RateLimit-Remaining': { $ref: '#/components/headers/X-RateLimit-Remaining' }, 'X-RateLimit-Reset': { $ref: '#/components/headers/X-RateLimit-Reset' } };
const paths = {};
for (const e of ENDPOINTS) {
  const oaPath = e.path.replace('/api/v1', '');
  const params = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }));
  const isList = e.summary.toLowerCase().includes('auflisten') || e.id === 'webhook-deliveries';
  if (isList) params.push({ $ref: '#/components/parameters/limit' }, { $ref: '#/components/parameters/cursor' });
  if (e.idempotent) params.push({ $ref: '#/components/parameters/IdempotencyKey' });
  if (e.query && !isList) for (const k of Object.keys(e.query)) params.push({ name: k, in: 'query', required: false, schema: { type: 'string' } });
  if (e.id === 'case-list') params.push({ name: 'status', in: 'query', schema: { enum: ['open', 'action_required', 'completed'] } }, { name: 'external_reference', in: 'query', schema: { type: 'string' } });
  const schema = ref(RESP[e.section]);
  const okContent = e.status === 204 ? undefined : { 'application/json': { schema: isList ? { type: 'object', properties: { object: { const: 'list' }, data: { type: 'array', items: schema }, pagination: ref('Pagination') } } : e.id.startsWith('webhook-test') ? { type: 'object' } : schema } };
  const op = {
    operationId: e.id.replace(/-(\w)/g, (_, c) => c.toUpperCase()), summary: e.summary, description: e.desc, tags: [e.section],
    ...(e.scope ? { security: [{ bearerAuth: [] }], 'x-required-scope': e.scope } : { security: [] }),
    ...(e.enterprise ? { 'x-plan': 'ENTERPRISE' } : {}),
    parameters: params.length ? params : undefined,
    requestBody: e.multipart ? { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file', 'type'], properties: { file: { type: 'string', format: 'binary' }, type: { enum: DOC_TYPES } } } } } }
      : e.body !== undefined ? { required: e.method === 'POST' && e.id !== 'validation-create' && e.id !== 'report-create', content: { 'application/json': { schema: e.section === 'cases' ? ref('CaseInput') : e.section === 'webhooks' ? ref('WebhookInput') : e.section === 'keys' && e.id === 'key-create' ? ref('ApiKeyInput') : { type: 'object' }, example: e.body } } } : undefined,
    responses: {
      [String(e.status)]: { description: e.summary, headers: e.scope ? rlHeaders : undefined, content: okContent },
      ...Object.fromEntries(e.errors.map((s) => [String(s), { $ref: `#/components/responses/E${s}` }])),
    },
  };
  paths[oaPath] = { ...(paths[oaPath] || {}), [e.method.toLowerCase()]: JSON.parse(JSON.stringify(op)) };
}

const errorResp = (s, d) => ({ description: d, content: { 'application/problem+json': { schema: ref('Problem') } } });
const spec = {
  openapi: '3.1.0',
  info: { title: 'LeaseRun API', version: '1.0.0', summary: 'Vorprüfung, Plausibilisierung und Aufbereitung von Baufinanzierungsfällen.',
    description: 'REST-API der LeaseRun-Plattform für CRM-, Vermittler-, Bank- und ERP-Systeme. Die API liefert eine Vorprüfung und strukturierte Fallanalyse – keine Kreditzusage, keine Bonitätsentscheidung; die Kreditentscheidung trifft allein das finanzierende Institut.\n\nTarife: Basic ohne API · Pro Standard-API (60 Anfragen/Minute) · Enterprise vollständig inkl. Webhooks und White-Label.\n\nTestumgebung: test_-Schlüssel an derselben Basis-URL; Testdaten sind strikt von Live-Daten getrennt.',
    contact: { name: 'LeaseRun Support', email: 'support@leaserun.com', url: 'https://leaserun.com/business' } },
  servers: [{ url: 'https://leaserun.com/api/v1', description: 'Produktion (Test- und Live-Schlüssel)' }],
  tags: [['cases', 'Fälle'], ['validation', 'Vorprüfung'], ['documents', 'Unterlagen'], ['reports', 'Berichte'], ['webhooks', 'Webhooks (Enterprise)'], ['usage', 'Nutzung'], ['keys', 'API-Schlüssel'], ['health', 'Status']].map(([name, description]) => ({ name, description })),
  security: [{ bearerAuth: [] }],
  paths,
  webhooks: Object.fromEntries(EVENTS.map((ev) => [ev, { post: {
    summary: `Ereignis ${ev}`, description: 'Signatur prüfen: HMAC-SHA-256 über "<X-LeaseRun-Timestamp>.<roher Body>" mit dem Webhook-Geheimnis, Vergleich zeitkonstant mit dem Wert nach "v1=". Zeitstempel höchstens 5 Minuten alt (Replay-Schutz), Delivery-ID nur einmal verarbeiten. Antwort 2xx innerhalb von 8 Sekunden, sonst Wiederholung nach 1 min, 5 min, 30 min, 2 h, 12 h.',
    parameters: [['X-LeaseRun-Event', 'Ereignistyp'], ['X-LeaseRun-Delivery', 'Eindeutige Zustell-ID'], ['X-LeaseRun-Timestamp', 'Unix-Zeit in Sekunden'], ['X-LeaseRun-Signature', 'v1=<hex HMAC-SHA-256>']].map(([name, description]) => ({ name, in: 'header', required: true, description, schema: { type: 'string' } })),
    requestBody: { content: { 'application/json': { schema: ref('WebhookEvent') } } }, responses: { '200': { description: 'Empfang bestätigt' } } } }])),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'test_XXXXXXXX_… | live_XXXXXXXX_…', description: `Scopes je Schlüssel: ${SCOPE_LIST.join(', ')}. Der benötigte Scope steht je Operation in x-required-scope.` } },
    parameters: {
      limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
      cursor: { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'next_cursor der vorherigen Seite' },
      IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{8,120}$' }, description: 'Gleicher Schlüssel + gleiche Anfrage → gleiche Antwort ohne Duplikat (Header Idempotent-Replayed: true). Gleicher Schlüssel + andere Anfrage → 409 IDEMPOTENCY_CONFLICT. Gültig 24 Stunden.' },
    },
    headers: {
      'X-Request-Id': { schema: { type: 'string' }, description: 'Kennung der Anfrage (bei Support-Anfragen angeben)' },
      'X-RateLimit-Limit': { schema: { type: 'integer' }, description: 'Anfragen pro Minute laut Tarif' },
      'X-RateLimit-Remaining': { schema: { type: 'integer' } },
      'X-RateLimit-Reset': { schema: { type: 'integer' }, description: 'Unix-Zeit, zu der das Fenster zurückgesetzt wird' },
    },
    responses: {
      E400: errorResp(400, 'Ungültige Anfrage'), E401: errorResp(401, 'Nicht authentifiziert / Schlüssel ungültig, widerrufen, abgelaufen oder deaktiviert'),
      E403: errorResp(403, 'Nicht freigeschaltet, Tarif enthält die Funktion nicht, Scope fehlt oder IP nicht erlaubt'), E404: errorResp(404, 'Nicht gefunden (auch Ressourcen anderer Mandanten)'),
      E409: errorResp(409, 'Konflikt (z. B. IDEMPOTENCY_CONFLICT)'), E413: errorResp(413, 'Datei oder Body zu groß'), E415: errorResp(415, 'Dateityp oder Content-Type nicht unterstützt'),
      E422: errorResp(422, 'Validierung fehlgeschlagen'), E429: { ...errorResp(429, 'Rate-Limit überschritten'), headers: { 'Retry-After': { schema: { type: 'integer' } } } },
      E500: errorResp(500, 'Interner Fehler'), E503: errorResp(503, 'Dienst nicht verfügbar oder nicht konfiguriert'),
    },
    schemas,
  },
  'x-examples': { testCase: TEST_CASE_BODY },
};

// Minimaler YAML-Serialisierer (reicht für JSON-kompatible Strukturen).
function yaml(v, ind = '') {
  const q = (s) => (/^[\w./{}@ -]+$/.test(s) && !/^(true|false|null|yes|no|on|off|~|-|\d)/i.test(s) && !s.includes(': ') && s.trim() === s && !s.startsWith('{') ? s : JSON.stringify(s));
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? v.map((x) => `\n${ind}- ${typeof x === 'object' && x !== null ? yaml(x, ind + '  ').replace(/^\n\s*/, '') : yaml(x, ind + '  ')}`).join('') : '[]';
  if (typeof v === 'object') { const e = Object.entries(v); return e.length ? e.map(([k, x]) => `\n${ind}${q(k)}:${typeof x === 'object' && x !== null && (Array.isArray(x) ? x.length : Object.keys(x).length) ? yaml(x, ind + '  ') : ' ' + yaml(x, ind + '  ')}`).join('') : '{}'; }
  if (typeof v === 'string') return v.includes('\n') ? JSON.stringify(v) : q(v);
  return String(v);
}

mkdirSync(new URL('../openapi/', import.meta.url), { recursive: true });
writeFileSync(new URL('../openapi/leaserun-api.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');
writeFileSync(new URL('../openapi/leaserun-api.yaml', import.meta.url), `# Automatisch erzeugt aus public/src/api-catalog.mjs (node scripts/build-openapi.mjs) – nicht direkt bearbeiten.${yaml(spec)}\n`);
console.log(`openapi: ${Object.keys(paths).length} Pfade, ${ENDPOINTS.length} Operationen`);
