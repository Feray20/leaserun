// Fasst die Stylesheets der statischen Seiten zu einer Datei zusammen (eine Anfrage statt fünf).
// Läuft automatisch vor `npm run build` (prebuild). Reihenfolge = Kaskade, nicht ändern.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = ['styles.css', 'routes.css', 'enhancement.css', 'responsive-web.css', 'institutional.css'];
const dir = new URL('../public/src/', import.meta.url);

const strip = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

const out = SRC.map((f) => `/* ${f} */\n` + strip(readFileSync(new URL(f, dir), 'utf8'))).join('\n');
writeFileSync(new URL('site.css', dir), `/* Automatisch erzeugt aus ${SRC.join(', ')} – nicht direkt bearbeiten. */\n${out}\n`);
console.log(`site.css: ${out.length} Zeichen aus ${SRC.length} Dateien`);
