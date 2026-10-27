// Builds the original LeaseRun company pages (home, properties, property management, about/contact)
// with the Python generator in legacy/ and copies them into public/ before the Next.js build.
// The investor software (calculators, learn, portals, Web-Admin) lives in public/ and app/ as usual.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legacy = join(root, 'legacy');
const dist = join(legacy, 'dist');
const pub = join(root, 'public');

let python = 'python3';
try { execFileSync(python, ['--version'], { stdio: 'ignore' }); } catch { python = 'python'; }
rmSync(dist, { recursive: true, force: true });
execFileSync(python, ['build.py'], { cwd: legacy, stdio: 'inherit' });

// Company pages: keep their content exactly as built.
const PAGES = [['index.html', 'index.html'], ['properties.html', 'properties/index.html'], ['property-management.html', 'property-management/index.html'], ['about-contact.html', 'about-contact/index.html']];
for (const [from, to] of PAGES) {
  const src = join(dist, from);
  if (!existsSync(src)) throw new Error(`legacy page missing: ${from}`);
  mkdirSync(dirname(join(pub, to)), { recursive: true });
  const html = readFileSync(src, 'utf8')
    .replace(/(href|src)="\/(styles\.css|app\.js|logo\.png|logo-mark\.png|og-image\.jpg|favicon\.png)"/g, '$1="/company/$2"');
  writeFileSync(join(pub, to), html);
}
// Assets the company pages use (namespaced so nothing of the software is overwritten).
mkdirSync(join(pub, 'company'), { recursive: true });
for (const f of ['styles.css', 'app.js', 'logo.png', 'logo-mark.png', 'og-image.jpg', 'favicon.png']) {
  if (existsSync(join(legacy, f))) cpSync(join(legacy, f), join(pub, 'company', f));
}
console.log('legacy company pages copied');
