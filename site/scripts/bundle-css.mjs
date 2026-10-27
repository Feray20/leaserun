// Fasst die Stylesheets der statischen Seiten zu einer Datei zusammen (eine Anfrage statt fünf).
// Läuft automatisch vor `npm run build` (prebuild). Reihenfolge = Kaskade, nicht ändern.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = ['styles.css', 'routes.css', 'enhancement.css', 'responsive-web.css', 'institutional.css', 'landing.css', 'b2b-landing.css', 'brand.css'];
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

// ---------------------------------------------------------------------------------------------
// Seiten-Stylesheets für Startseite und /b2b: nur die Regeln, deren Klassen/IDs in der Seite oder
// in ihren Skripten (inkl. nachgeladener Module) vorkommen. Bewusst großzügig (Token-Abgleich statt
// Laufzeitmessung), damit auch Zustände wie offene Menüs, Dialoge oder Fehlermeldungen gestylt bleiben.
// Spart auf diesen Seiten rund zwei Drittel des CSS, das vor dem ersten Bild geladen werden muss.
const pub = new URL('../public/', import.meta.url);
const read = (rel) => { try { return readFileSync(new URL(rel.replace(/^\//, ''), pub), 'utf8'); } catch { return ''; } };
function graph(entries) {
  const seen = new Set(); const queue = [...entries]; let text = '';
  while (queue.length) {
    const f = queue.shift(); if (seen.has(f)) continue; seen.add(f);
    const src = read(f); text += '\n' + src;
    const base = f.replace(/[^/]*$/, '');
    // Versionsanhang (?v=…) zulassen – sonst werden nachgeladene Module (z. B. Kaufdialog) übersehen und ihre Styles fehlen.
    for (const m of src.matchAll(/(?:import\(\s*|from\s+|src\s*=\s*)['"]([^'"?]+\.m?js)(?:\?[^'"]*)?['"]|['"](\/src\/[\w-]+\.m?js)(?:\?[^'"]*)?['"]/g)) {
      const p = m[1] || m[2]; queue.push(p.startsWith('/') ? p : (base + p).replace(/\/\.\//g, '/'));
    }
  }
  return text;
}
function cssBlocks(s) {
  const out = []; let depth = 0, start = 0, q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { out.push(s.slice(start, i + 1)); start = i + 1; }
  }
  return out;
}
function subset(css, text) {
  const tokens = new Set(text.match(/[A-Za-z_][\w-]*/g));
  const prefixes = [...tokens].filter((t) => t.endsWith('-') || t.endsWith('_'));
  const known = (n) => tokens.has(n) || prefixes.some((p) => n.startsWith(p));
  const keep = (sel) => sel.split(',').some((one) => [...one.replace(/\[[^\]]*\]/g, '').replace(/:(not|is|where)\([^()]*\)/g, '').matchAll(/[.#]([A-Za-z_][\w-]*)/g)].every((m) => known(m[1])));
  const walk = (s) => cssBlocks(s).map((b) => {
    const head = b.slice(0, b.indexOf('{')).trim();
    if (/^@(media|supports)/.test(head)) { const inner = walk(b.slice(b.indexOf('{') + 1, -1)); return inner ? `${head}{${inner}}` : ''; }
    return head.startsWith('@') || keep(head) ? b.trim() : '';
  }).filter(Boolean).join('\n');
  return walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
}
const scriptsOf = (html) => [...html.matchAll(/<script[^>]*\ssrc="(\/src\/[^"]+)"/g)].map((m) => m[1]);
const always = ['/src/menu.js', '/src/track.js', '/src/contact-widget.mjs', '/src/klapp.js', '/src/hinweis.js', '/src/app.js'];
const PAGES = [
  { out: 'home.css', html: 'index.html', css: ['site.css'] },
  { out: 'b2b-page.css', html: 'b2b/index.html', css: ['site.css', 'b2b.css'], extra: ['/src/routes.js'] },
  // Creator-Bereich: Website- und Portal-Stile nur, soweit Seite und Creator-Skripte sie verwenden (creator.css bleibt vollständig).
  { out: 'creator-page.css', html: 'creator/index.html', css: ['site.css', 'b2b.css'] },
];
// Alle übrigen Inhaltsseiten (Rechner, Wissen, Rechtstexte …) mit dem Standard-Skriptsatz teilen sich pages.css.
import { readdirSync, statSync } from 'node:fs';
const STD = new Set(['/src/klapp.js', '/src/hinweis.js', '/src/menu.js', '/src/routes.js', '/src/app.js', '/src/content.js', '/src/tools.mjs', '/src/ratgeber.mjs', '/src/ratgeber-index.js']);
const htmlFiles = (rel = '') => readdirSync(new URL(rel || '.', pub)).flatMap((n) => {
  const r = rel + n; if (statSync(new URL(r, pub)).isDirectory()) return htmlFiles(r + '/');
  return n === 'index.html' && r !== 'index.html' && r !== 'b2b/index.html' ? [r] : [];
});
export const STANDARD_PAGES = htmlFiles().filter((f) => { const h = read(f); return /\/src\/(site|pages)\.css/.test(h) && scriptsOf(h).every((x) => STD.has(x.split('?')[0])); });
PAGES.push({ out: 'pages.css', html: STANDARD_PAGES, css: ['site.css'], extra: [...STD] });
for (const pg of PAGES) {
  const html = [].concat(pg.html).map(read).join('\n');
  const text = html + graph([...scriptsOf(html), ...always, ...(pg.extra || [])]);
  const css = pg.css.map((f) => `/* aus ${f} */\n` + subset(readFileSync(new URL(f, dir), 'utf8'), text)).join('\n');
  writeFileSync(new URL(pg.out, dir), `/* Automatisch erzeugt (scripts/bundle-css.mjs) – nicht direkt bearbeiten. */\n${css}\n`);
  console.log(`${pg.out}: ${css.length} Zeichen`);
}
