// IndexNow: Nach einem Produktions-Build die URLs aus der Sitemap an Bing, Yandex u. a. melden (schnellere Aufnahme).
// Google nutzt IndexNow nicht; dort gilt die Sitemap in der Search Console. Fehler brechen den Build nie ab.
import { readFileSync } from 'node:fs';
const KEY = '30d502cd27ad4c3135591f7a120330be';
if (process.env.VERCEL_ENV !== 'production') process.exit(0);
try {
  const xml = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, 10000);
  const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: 'leaserun.com', key: KEY, keyLocation: `https://leaserun.com/${KEY}.txt`, urlList }), signal: AbortSignal.timeout(8000) });
  console.log('IndexNow:', r.status, urlList.length, 'URLs');
} catch (e) { console.log('IndexNow übersprungen:', e instanceof Error ? e.message : e); }
