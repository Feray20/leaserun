// Cache-Busting beim Build: Alle Verweise auf /src/*.js|mjs|css in den HTML-Seiten und alle Modul-Importe
// innerhalb von public/src bekommen dieselbe Versionsnummer (?v=…). So mischt der Browser nach einem Update nie
// alte und neue Skriptteile (Ursache für „Seite bleibt leer“ bis der Zwischenspeicher abläuft).
// Läuft automatisch vor `next build` (prebuild). Mehrfaches Ausführen ist unschädlich.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUB = new URL('../public/', import.meta.url).pathname;
const SRC = join(PUB, 'src');

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    if (n === 'vendor' || n === 'node_modules') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

const srcFiles = walk(SRC).filter((f) => /\.(m?js|css)$/.test(f));
// Version: Inhalts-Hash aller Skripte und Styles (ohne vorhandene ?v=-Marken), damit sie stabil ist.
const h = createHash('sha256');
for (const f of srcFiles.sort()) h.update(readFileSync(f, 'utf8').replace(/\?v=[a-z0-9]+/g, ''));
const V = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8) || h.digest('hex').slice(0, 8);

let html = 0, mods = 0;
for (const f of walk(PUB).filter((x) => x.endsWith('.html'))) {
  const s = readFileSync(f, 'utf8');
  const t = s.replace(/((?:src|href)="\/src\/[a-z0-9-]+\.(?:m?js|css))(?:\?v=[a-z0-9]+)?"/g, `$1?v=${V}"`);
  if (t !== s) { writeFileSync(f, t); html++; }
}
for (const f of srcFiles.filter((x) => /\.m?js$/.test(x))) {
  const s = readFileSync(f, 'utf8');
  const t = s.replace(/((?:from\s*|import\()\s*['"])((?:\.\/|\/src\/)[a-z0-9-]+\.mjs)(?:\?v=[a-z0-9]+)?(['"])/g, `$1$2?v=${V}$3`);
  if (t !== s) { writeFileSync(f, t); mods++; }
}
console.log(`version-assets: v=${V} · ${html} HTML-Dateien · ${mods} Skripte`);
