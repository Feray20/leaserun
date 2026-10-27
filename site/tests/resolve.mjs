import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function resolve(specifier, context, next) {
  let s = specifier;
  if (s.startsWith('@/')) s = pathToFileURL(path.join(root, s.slice(2))).href;
  if ((s.startsWith('.') || s.startsWith('file:')) && !/\.[cm]?[jt]sx?$/.test(s)) {
    const base = s.startsWith('file:') ? fileURLToPath(s) : path.resolve(path.dirname(fileURLToPath(context.parentURL)), s);
    for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
  }
  return next(s, context);
}

// JSON-Module (z. B. public/data/preise.json) ohne Import-Attribute laden, wie es der Next.js-Bundler erlaubt.
import { readFileSync } from 'node:fs';
export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    return { format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')};`, shortCircuit: true };
  }
  return next(url, context);
}
