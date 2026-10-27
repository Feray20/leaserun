// Darstellungs-Prüfung (Agent Noah · Optimierung): öffnet die Website wie ein Besucher in einem echten Browser –
// am Handy und am Computer – und findet, was ein reiner Abruf des HTML nicht sieht:
//   • Knöpfe/Hinweise, die sich überdecken (schwebende Elemente übereinander)
//   • zu kleine Schrift im Inhalt, Seiten breiter als der Bildschirm (Querscrollen)
//   • Skriptfehler, kaputte interne Links und Sprungmarken
//   • doppelte Einträge (gleiche Überschrift/gleicher Begriff zweimal), Nummerierung mit Lücken oder Sprüngen
//   • alte, eingebackene Klapp-/Sperr-Reste im ausgelieferten HTML
// Ergebnis: Liste mit Seite, Art, Schwere und Lösungshinweis – wird an /api/admin/hq/sitecheck gemeldet und erscheint
// im Headquarters. Was sicher automatisch reparierbar ist, repariert die Website zur Laufzeit selbst (klapp.js) bzw.
// meldet der Agent mit genauer Stelle.
//
// Aufruf:  node scripts/site-check.mjs https://leaserun.com [--report]
//   --report  Ergebnis an das Headquarters senden (braucht SITECHECK_TOKEN)
import pw from 'playwright';
const { chromium } = pw;

const BASE = (process.argv[2] || 'https://leaserun.com').replace(/\/$/, '');
const REPORT = process.argv.includes('--report');
const MAX_PAGES = Number(process.env.SITECHECK_PAGES || 120);
const VIEWS = [{ name: 'Handy', width: 390, height: 844 }, { name: 'Computer', width: 1280, height: 900 }];
const findings = [];
const add = (f) => { const id = `${f.kind}:${f.path}:${f.view || ''}:${(f.detail || '').slice(0, 40)}`; if (!findings.some((x) => x.id === id)) findings.push({ id, ...f }); };

async function sitemap() {
  try {
    const r = await fetch(`${BASE}/sitemap.xml`, { headers: { 'user-agent': 'LeaseRun-Darstellungspruefung/1.0' } });
    const urls = [...(await r.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    return ['/', ...urls.filter((u) => u !== '/')].slice(0, MAX_PAGES);
  } catch { return ['/']; }
}

// Läuft in der Seite: sammelt alle Auffälligkeiten.
function inspect() {
  const out = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const label = (e) => ((e.innerText || e.getAttribute('aria-label') || e.className || e.tagName) + '').replace(/\s+/g, ' ').trim().slice(0, 50);
  // 1. Querscrollen
  const ow = document.documentElement.scrollWidth - innerWidth;
  if (ow > 4) {
    const wide = [...document.querySelectorAll('main *')].find((e) => e.getBoundingClientRect().right > innerWidth + 4 && !e.closest('[style*="overflow"], .table-wrap, pre'));
    out.push({ kind: 'querscrollen', level: 'hoch', detail: `Seite ist ${ow}px breiter als der Bildschirm${wide ? ` – verursacht von „${label(wide)}“` : ''}.`, fix: 'Element mit fester Breite oder langem Wort umbrechen lassen (max-width:100%, overflow-wrap:anywhere).' });
  }
  // 2. Schwebende Elemente, die sich überdecken
  const fixed = [...document.querySelectorAll('body *')].filter((e) => { const p = getComputedStyle(e).position; return (p === 'fixed' || p === 'sticky') && vis(e) && !e.closest('header, .site-header, nav') && e.tagName !== 'HEADER'; });
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
    const a = fixed[i], b = fixed[j]; if (a.contains(b) || b.contains(a)) continue;
    const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
    const ix = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left), iy = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
    if (ix > 8 && iy > 8) out.push({ kind: 'ueberdeckung', level: 'hoch', detail: `„${label(a)}“ überdeckt „${label(b)}“.`, fix: 'Abstand/Position der schwebenden Elemente anpassen oder eines davon im Seitenfluss anzeigen.' });
  }
  // 3. Zu kleine Schrift im Inhalt (Fließtext ab 40 Zeichen unter 13 px)
  if (!/^\/(intern|app|b2b-portal)/.test(location.pathname)) {
    const small = [...document.querySelectorAll('main p, main li, main dd, main td')].filter((e) => vis(e) && (e.innerText || '').trim().length > 40 && parseFloat(getComputedStyle(e).fontSize) < 13 && !e.closest('footer, .footer, small, .form-note, .crumbs, .legal, .ia-legal'));
    if (small.length) out.push({ kind: 'kleine-schrift', level: small.length > 5 ? 'hoch' : 'mittel', detail: `${small.length} Textstelle(n) unter 13 px, z. B. „${label(small[0])}“ (${getComputedStyle(small[0]).fontSize}).`, fix: 'Schriftgröße für Inhaltstexte auf mindestens 15 px setzen.' });
  }
  // 4. Doppelte Einträge direkt untereinander (Überschriften, Begriffe, Fragen)
  for (const sel of ['main h2', 'main dt', 'main .route-q strong', 'main details > summary']) {
    const t = [...document.querySelectorAll(sel)].filter(vis).map((e) => (e.innerText || '').trim()).filter(Boolean);
    const seen = new Map(); for (const x of t) seen.set(x, (seen.get(x) || 0) + 1);
    const d = [...seen].filter(([, n]) => n > 1).map(([x]) => x);
    if (d.length) out.push({ kind: 'doppelt', level: 'hoch', detail: `Doppelt angezeigt: „${d.slice(0, 3).join('“, „')}“.`, fix: 'Quelle der Liste prüfen (doppelte Daten oder fehlerhaft eingebackenes HTML).' });
  }
  // 5. Nummerierung: fortlaufend ohne Sprünge
  const nums = [...document.querySelectorAll('main .route-q > span')].map((s) => parseInt(s.textContent, 10)).filter((n) => !isNaN(n));
  if (nums.length > 2 && nums.some((n, i) => n !== i + 1)) out.push({ kind: 'nummerierung', level: 'mittel', detail: `Nummern springen (Anfang: ${nums.slice(0, 12).join(', ')} …).`, fix: 'Einträge in Anzeigereihenfolge fortlaufend nummerieren.' });
  // 6. Sprungmarken ohne Ziel
  const bad = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !/^#(inhalt|top)$/.test(h) && !document.getElementById(decodeURIComponent(h.slice(1))));
  if (bad.length) out.push({ kind: 'sprungmarke', level: 'mittel', detail: `Sprunglinks ohne Ziel: ${[...new Set(bad)].slice(0, 5).join(', ')}.`, fix: 'Ziel-Kennung (id) ergänzen oder Link korrigieren.' });
  // 7. Leere Bereiche: Überschrift ohne Inhalt bis zur nächsten Überschrift
  const hs = [...document.querySelectorAll('main h2')].filter(vis);
  for (const h of hs) { let n = h.nextElementSibling, txt = 0; while (n && !/^H[12]$/.test(n.tagName)) { if (vis(n)) txt += (n.innerText || '').trim().length + n.querySelectorAll('img,svg,canvas,table,input,button').length * 50; n = n.nextElementSibling; } if (h.parentElement && txt === 0 && !h.nextElementSibling) continue; if (txt === 0 && h.nextElementSibling) out.push({ kind: 'leer', level: 'mittel', detail: `Abschnitt „${label(h)}“ ist leer.`, fix: 'Inhalt nachladen/ergänzen oder Abschnitt entfernen.' }); }
  return out;
}

async function main() {
  const paths = await sitemap();
  const b = await chromium.launch();
  const links = new Map();
  for (const v of VIEWS) {
    const ctx = await b.newContext({ viewport: { width: v.width, height: v.height }, userAgent: 'Mozilla/5.0 LeaseRun-Darstellungspruefung/1.0', serviceWorkers: 'block' });
    for (const path of paths) {
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      let raw = '';
      try {
        const resp = await p.goto(BASE + path, { waitUntil: 'load', timeout: 25000 });
        raw = resp ? await resp.text() : '';
        if (resp && resp.status() >= 400) { add({ path, view: v.name, kind: 'status', level: 'hoch', detail: `Seite antwortet mit ${resp.status()}.`, fix: 'Seite oder Weiterleitung reparieren.' }); await p.close(); continue; }
      } catch (e) { add({ path, view: v.name, kind: 'laden', level: 'hoch', detail: `Seite lädt nicht: ${String(e.message).slice(0, 80)}`, fix: 'Seite/Server prüfen.' }); await p.close(); continue; }
      await p.waitForTimeout(700);
      if (v.name === 'Handy') {
        if (/class="lr-kl-btn"|class="lr-gate-box"|class="lr-kasse-hint"/.test(raw)) add({ path, kind: 'eingebacken', level: 'hoch', detail: 'Im ausgelieferten HTML stecken alte Laufzeit-Reste (Klapp-/Sperrelemente). Sie verschieben Inhalte.', fix: 'Seite neu vorrendern (scripts/prerender.py); die Laufzeit räumt sie bereits selbst auf.' });
        for (const h of await p.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href').split('#')[0].split('?')[0]))) if (h && !/^\/(api|src|fonts|_next|intern|app|auth)\b/.test(h)) { if (!links.has(h)) links.set(h, path); }
      }
      for (const e of errs.slice(0, 2)) add({ path, view: v.name, kind: 'skriptfehler', level: 'hoch', detail: e.slice(0, 160), fix: 'Fehler im Seitenskript beheben.' });
      try { for (const f of await p.evaluate(inspect)) add({ path, view: v.name, ...f }); } catch { /* Seite hat während der Prüfung navigiert */ }
      await p.close();
    }
    await ctx.close();
  }
  // Interne Links (einmal je Ziel)
  const targets = [...links.keys()].filter((l) => !paths.includes(l)).slice(0, 200);
  await Promise.all(targets.map(async (l) => {
    try { const r = await fetch(BASE + l, { method: 'HEAD', redirect: 'manual' }); if (r.status === 404 || r.status >= 500) add({ path: links.get(l), kind: 'link', level: 'hoch', detail: `Kaputter Link auf ${l} (Status ${r.status}).`, fix: 'Linkziel korrigieren oder Weiterleitung anlegen.' }); } catch { /* Netz */ }
  }));
  await b.close();
  const order = { hoch: 0, mittel: 1, niedrig: 2 };
  findings.sort((a, c) => order[a.level] - order[c.level]);
  const report = { at: new Date().toISOString(), base: BASE, pages: paths.length, views: VIEWS.map((v) => v.name), findings: findings.slice(0, 150) };
  console.log(`${report.pages} Seiten × ${VIEWS.length} Ansichten geprüft – ${findings.length} Auffälligkeit(en).`);
  for (const f of report.findings.slice(0, 40)) console.log(`[${f.level}] ${f.path}${f.view ? ` (${f.view})` : ''} · ${f.kind}: ${f.detail}`);
  if (REPORT) {
    // GitHub-Ausweis erst jetzt holen – er gilt nur wenige Minuten, die Prüfung dauert länger.
    let tok = process.env.SITECHECK_TOKEN;
    if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
      try { const r = await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=leaserun-sitecheck`, { headers: { Authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } }); tok = (await r.json()).value || tok; } catch { /* älterer Ausweis */ }
    }
    if (!tok) { console.log('::error title=Darstellung::Kein Ausweis (SITECHECK_TOKEN) – Ergebnis nicht gemeldet.'); process.exit(1); }
    const r = await fetch(`${BASE}/api/admin/hq/sitecheck`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify(report) });
    const txt = (await r.text()).slice(0, 300);
    console.log(`An Headquarters gemeldet: ${r.status} ${txt}`);
    // Als Hinweis im GitHub-Lauf sichtbar (auch ohne Zugriff auf das Protokoll)
    console.log(r.ok ? `::notice title=Darstellung::${report.pages} Seiten geprüft, ${findings.length} Auffälligkeiten, gemeldet.` : `::error title=Darstellung::Meldung ans Headquarters fehlgeschlagen (${r.status}): ${txt.replace(/\n/g, ' ')}`);
    if (!r.ok) process.exit(1);
  }
}
main().catch((e) => { console.error(e); console.log(`::error title=Darstellung::${String(e && e.message || e).slice(0, 300).replace(/\n/g, ' ')}`); process.exit(1); });
