// End-to-End-Test der LeaseRun API gegen eine laufende Instanz (echte Datenbank, echter Speicher).
// Aufruf:  API_BASE=https://leaserun.com/api/v1  API_KEY=test_…  [WEBHOOK_URL=https://…]  [BYPASS=<vercel-protection-bypass>]  node scripts/api-e2e.mjs
// Voraussetzung: Test-Schlüssel mit allen Scopes eines Enterprise-Mandanten (Web-Admin → API Management → API Keys).
// Der Test arbeitet ausschließlich in der Testumgebung und löscht seine Daten am Ende wieder.
const BASE = (process.env.API_BASE || 'http://localhost:3000/api/v1').replace(/\/+$/, '');
let KEY = process.env.API_KEY || '';
const HOOK = process.env.WEBHOOK_URL || '';
const extra = process.env.BYPASS ? { 'x-vercel-protection-bypass': process.env.BYPASS } : {};
if (!KEY.startsWith('test_')) { console.error('API_KEY muss ein test_-Schlüssel sein.'); process.exit(2); }

const results = [];
const ok = (name, cond, info = '') => { results.push({ name, ok: Boolean(cond), info }); console.log(`${cond ? '✔' : '✖'} ${name}${info ? ' – ' + info : ''}`); };
async function call(method, path, { key = KEY, body, headers = {}, form } = {}) {
  const t = Date.now();
  const r = await fetch(BASE + path, { method, headers: { ...extra, ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, json, headers: r.headers, ms: Date.now() - t };
}
const minimalPdf = () => {
  const text = 'BT /F1 18 Tf 72 720 Td (TEST-UNTERLAGE E2E) Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new Blob([out], { type: 'application/pdf' });
};
const TEST_CASE = {
  external_reference: `TEST-E2E-${Date.now().toString(36).toUpperCase()}`,
  customer: { first_name: 'Test', last_name: 'Person (TEST)', email: 'test.person@example.com' },
  applicants: [{ first_name: 'Test', last_name: 'Person (TEST)', employment_type: 'employed', monthly_net_income: 6000 }],
  property: { property_type: 'apartment', usage: 'owner_occupied', address: { postal_code: '64354', city: 'Reinheim', state: 'hessen' }, purchase_price: 450000 },
  household: { monthly_net_income: 6000, monthly_expenses: 2200, adults: 1 },
  equity: { amount: 100000, available_amount: 100000 },
  loan: { requested_amount: 350000, repayment_rate: 2, interest_rate: 3.8 },
  metadata: { source: 'e2e', test: true },
};

(async () => {
  // Health (öffentlich)
  const h = await call('GET', '/health', { key: null });
  ok('Health erreichbar', [200, 503].includes(h.status) && h.json?.components, `${h.status} ${h.json?.status}`);

  // Authentifizierung
  ok('Ohne Schlüssel → 401 UNAUTHENTICATED', (await call('GET', '/cases', { key: null })).json?.code === 'UNAUTHENTICATED');
  ok('Ungültiger Schlüssel → 401 INVALID_API_KEY', (await call('GET', '/cases', { key: 'test_AAAAAAAA_' + 'A'.repeat(43) })).json?.code === 'INVALID_API_KEY');

  // Fall anlegen (mit Idempotenz)
  const idem = 'idem_e2e_' + Date.now();
  const c1 = await call('POST', '/cases', { body: TEST_CASE, headers: { 'Idempotency-Key': idem } });
  ok('CREATE CASE → 201', c1.status === 201 && c1.json?.id, `${c1.status} ${c1.json?.code || ''}`);
  ok('Rate-Limit-Header vorhanden', c1.headers.get('x-ratelimit-limit') && c1.headers.get('x-ratelimit-remaining') && c1.headers.get('x-ratelimit-reset'));
  ok('X-Request-Id vorhanden', /^req_/.test(c1.headers.get('x-request-id') || ''));
  const caseId = c1.json?.id;
  const c2 = await call('POST', '/cases', { body: TEST_CASE, headers: { 'Idempotency-Key': idem } });
  ok('Idempotenz: gleiche Anfrage → gleiche Antwort, kein Duplikat', c2.status === 201 && c2.json?.id === caseId && c2.headers.get('idempotent-replayed') === 'true');
  const c3 = await call('POST', '/cases', { body: { ...TEST_CASE, external_reference: 'ANDERS' }, headers: { 'Idempotency-Key': idem } });
  ok('Idempotenz: anderer Body → 409 IDEMPOTENCY_CONFLICT', c3.status === 409 && c3.json?.code === 'IDEMPOTENCY_CONFLICT');
  ok('Unbekanntes Feld → 422 VALIDATION_ERROR', (await call('POST', '/cases', { body: { foo: 1 } })).json?.code === 'VALIDATION_ERROR');

  // Lesen, Liste, Paginierung, Isolation
  const g = await call('GET', `/cases/${caseId}`);
  ok('CASE GET → 200', g.status === 200 && g.json?.property?.purchase_price === 450000 && g.json?.test === true);
  const l = await call('GET', '/cases?limit=1');
  ok('Liste mit Cursor-Paginierung', l.status === 200 && Array.isArray(l.json?.data) && 'pagination' in l.json);
  ok('Fremde/unbekannte Fall-ID → 404', (await call('GET', '/cases/00000000-0000-4000-8000-000000000000')).status === 404);

  // Vorprüfung
  const v1 = await call('GET', `/cases/${caseId}/validate`);
  ok('VALIDATION → 200 mit Checks', v1.status === 200 && Array.isArray(v1.json?.checks) && typeof v1.json?.completeness_score === 'number', `score ${v1.json?.completeness_score}, readiness ${v1.json?.bank_readiness}`);
  ok('Prüfpunkte maschinenlesbar', (v1.json?.checks || []).every((c) => ['code', 'severity', 'category', 'message', 'field', 'requires_action', 'value', 'threshold'].every((k) => k in c)));
  ok('Testfall: FINANCING_GAP erkannt', (v1.json?.errors || []).some((e) => e.code === 'FINANCING_GAP'));
  const vg = await call('GET', `/cases/${caseId}/validations/${v1.json?.validation_id}`);
  ok('VIEW VALIDATION → 200', vg.status === 200 && vg.json?.status === 'completed');

  // Unterlage
  const fd = new FormData(); fd.append('file', minimalPdf(), 'TEST-Unterlage.pdf'); fd.append('type', 'identity');
  const d1 = await call('POST', `/cases/${caseId}/documents`, { form: fd });
  ok('DOCUMENT UPLOAD → 201, formal geprüft', d1.status === 201 && d1.json?.verification_status === 'formally_verified' && /^[0-9a-f]{64}$/.test(d1.json?.sha256 || ''), `${d1.status} ${d1.json?.code || d1.json?.status || ''}`);
  const bad = new FormData(); bad.append('file', new Blob(['<html>x</html>'], { type: 'application/pdf' }), 'fake.pdf'); bad.append('type', 'identity');
  ok('Gefälschtes PDF (Signatur) → 415', (await call('POST', `/cases/${caseId}/documents`, { form: bad })).status === 415);
  const dg = await call('GET', `/cases/${caseId}/documents/${d1.json?.id}`);
  ok('Dokument mit signiertem Link', dg.status === 200 && /^https:\/\//.test(dg.json?.download_url || ''));
  const v2 = await call('POST', `/cases/${caseId}/validations`, { body: {}, headers: { 'Idempotency-Key': 'idem_e2e_v2_' + Date.now() } });
  ok('VALIDATION AGAIN → 201, Unterlage berücksichtigt', v2.status === 201 && !(v2.json?.missing_documents || []).includes('identity'));

  // Bericht
  const r1 = await call('POST', `/cases/${caseId}/reports`, { body: {} });
  ok('REPORT CREATE → 202 queued', r1.status === 202 && r1.json?.report_id && ['queued', 'processing', 'completed'].includes(r1.json?.status));
  let rs = null;
  for (let i = 0; i < 20; i++) { await new Promise((res) => setTimeout(res, 1500)); rs = await call('GET', `/cases/${caseId}/reports/${r1.json?.report_id}`); if (['completed', 'failed'].includes(rs.json?.status)) break; }
  ok('REPORT STATUS → completed', rs?.json?.status === 'completed', rs?.json?.status);
  if (rs?.json?.download_url) {
    const pdf = await fetch(rs.json.download_url);
    const buf = Buffer.from(await pdf.arrayBuffer());
    ok('Bericht-Download ist ein PDF', pdf.ok && buf.subarray(0, 5).toString() === '%PDF-', `${buf.length} Byte`);
  }

  // Webhooks
  const w = await call('POST', '/webhooks', { body: { url: HOOK || 'https://example.com/leaserun-e2e', events: ['validation.completed', 'report.completed'], description: 'E2E' } });
  if (w.status === 403) ok('Webhooks: Tarif ohne Webhooks → 403 PLAN_NOT_ENTITLED', w.json?.code === 'PLAN_NOT_ENTITLED');
  else {
    ok('WEBHOOK CREATE → 201 mit einmaligem Geheimnis', w.status === 201 && /^whsec_/.test(w.json?.secret || ''), `${w.status} ${w.json?.code || ''}`);
    ok('SSRF: interne Ziel-URL → 422', (await call('POST', '/webhooks', { body: { url: 'https://127.0.0.1/x', events: ['report.completed'] } })).json?.code === 'UNSAFE_WEBHOOK_URL');
    const wt = await call('POST', `/webhooks/${w.json?.id}/test`);
    ok('WEBHOOK TEST ausgeführt', wt.status === 200 && wt.json?.delivery_id, `zugestellt: ${wt.json?.delivered} (HTTP ${wt.json?.response_status ?? '–'})`);
    const dl = await call('GET', `/webhooks/${w.json?.id}/deliveries`);
    ok('DELIVERY LOG enthält die Zustellung', dl.status === 200 && (dl.json?.data || []).some((x) => x.delivery_id === wt.json?.delivery_id));
    ok('Webhook ohne Geheimnis abrufbar', !('secret' in ((await call('GET', `/webhooks/${w.json?.id}`)).json || {})));
    await call('DELETE', `/webhooks/${w.json?.id}`);
  }

  // Nutzung
  const u = await call('GET', '/usage?range=24h');
  ok('API USAGE → 200 mit Anfragen', u.status === 200 && u.json?.totals?.requests > 0, `${u.json?.totals?.requests} Anfragen`);

  // Scopes und Schlüssel-Lebenszyklus
  const k1 = await call('POST', '/api-keys', { body: { name: 'E2E nur lesen', scopes: ['cases:read'] } });
  ok('Schlüssel mit eingeschränktem Scope angelegt', k1.status === 201 && /^test_/.test(k1.json?.secret || ''));
  const ro = k1.json?.secret;
  ok('Falscher Scope → 403 INSUFFICIENT_SCOPE', (await call('POST', '/cases', { key: ro, body: TEST_CASE })).json?.code === 'INSUFFICIENT_SCOPE');
  ok('Eskalation verhindert: Lese-Schlüssel kann keine Schlüssel anlegen', [403].includes((await call('POST', '/api-keys', { key: ro, body: { name: 'x', scopes: ['cases:write'] } })).status));
  const rot = await call('POST', `/api-keys/${k1.json?.id}/rotate`);
  ok('ROTATE KEY → neuer Schlüssel', rot.status === 201 && rot.json?.secret && rot.json.secret !== ro);
  ok('Alter Schlüssel → 401 API_KEY_REVOKED', (await call('GET', '/cases', { key: ro })).json?.code === 'API_KEY_REVOKED');
  ok('Neuer Schlüssel funktioniert', (await call('GET', `/cases/${caseId}`, { key: rot.json?.secret })).status === 200);
  const rv = await call('POST', `/api-keys/${rot.json?.id}/revoke`, { body: { reason: 'E2E' } });
  ok('Widerruf → Schlüssel ungültig', rv.status === 200 && (await call('GET', '/cases', { key: rot.json?.secret })).status === 401);

  // Aufräumen (nur Testumgebung)
  const del = await call('DELETE', `/cases/${caseId}`);
  ok('Testdaten gelöscht (204), danach 404', del.status === 204 && (await call('GET', `/cases/${caseId}`)).status === 404);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
