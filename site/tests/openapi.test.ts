import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ENDPOINTS } from '../public/src/api-catalog.mjs';

const root = path.resolve(import.meta.dirname, '..');
const spec = JSON.parse(readFileSync(path.join(root, 'openapi/leaserun-api.json'), 'utf8'));

// Pfadvorlage → Routendatei (Platzhalter = beliebiges [segment]).
function routeFile(p: string): string | null {
  let dir = path.join(root, 'app');
  for (const seg of p.split('/').filter(Boolean)) {
    if (/^\{\w+\}$/.test(seg)) {
      const dyn = readdirSync(dir).find((d) => /^\[\w+\]$/.test(d));
      if (!dyn) return null;
      dir = path.join(dir, dyn);
    } else dir = path.join(dir, seg);
    if (!existsSync(dir)) return null;
  }
  const f = path.join(dir, 'route.ts');
  return existsSync(f) ? f : null;
}

test('OpenAPI: jede dokumentierte Operation existiert als echte Route mit passender Methode und Scope', () => {
  for (const [p, ops] of Object.entries(spec.paths as Record<string, Record<string, { 'x-required-scope'?: string }>>)) {
    const file = routeFile('/api/v1' + p);
    assert.ok(file, `Route fehlt: ${p}`);
    const src = readFileSync(file!, 'utf8');
    for (const [m, op] of Object.entries(ops)) {
      assert.match(src, new RegExp(`export (const|async function) ${m.toUpperCase()}\\b`), `${m.toUpperCase()} ${p} nicht exportiert`);
      if (op['x-required-scope']) assert.ok(src.includes(`'${op['x-required-scope']}'`), `${m.toUpperCase()} ${p}: Scope ${op['x-required-scope']} nicht in der Route`);
    }
  }
});

test('OpenAPI: jede /api/v1-Route ist dokumentiert (keine undokumentierten Endpunkte)', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'route.ts' ? [path.join(d, e.name)] : []));
  const documented = new Set(ENDPOINTS.map((e) => `${e.method} ${e.path.replace(/\{\w+\}/g, '{}')}`));
  for (const f of walk(path.join(root, 'app/api/v1'))) {
    const rel = '/' + path.relative(path.join(root, 'app'), path.dirname(f)).split(path.sep).join('/');
    if (rel === '/api/v1/openapi.json') continue;
    const src = readFileSync(f, 'utf8');
    for (const m of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
      if (new RegExp(`export (const|async function) ${m}\\b`).test(src)) assert.ok(documented.has(`${m} ${rel.replace(/\[\w+\]/g, '{}')}`), `undokumentiert: ${m} ${rel}`);
    }
  }
});

test('OpenAPI: Grundstruktur 3.1, Sicherheit, Webhook-Signatur, Fehlermodell', () => {
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
  assert.ok(spec.webhooks['report.completed'].post.parameters.some((p: { name: string }) => p.name === 'X-LeaseRun-Signature'));
  assert.deepEqual(spec.components.schemas.Problem.required, ['type', 'title', 'status', 'code', 'detail', 'request_id', 'errors']);
  const yaml = readFileSync(path.join(root, 'openapi/leaserun-api.yaml'), 'utf8');
  assert.ok(yaml.includes('openapi: 3.1.0') || yaml.includes('openapi: "3.1.0"'));
});
