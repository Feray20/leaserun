// Erzeugt public/data/faq.json aus public/src/content.js (eine Quelle für Seite und CMS-Export).
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const ctx = { window: {} };
vm.runInNewContext(readFileSync(new URL('../public/src/content.js', import.meta.url), 'utf8'), ctx);
const c = ctx.window.IA_CONTENT;
const out = {
  version: new Date().toISOString().slice(0, 10),
  disclaimer: c.disclaimer,
  hinweis: 'Öffentlich nur Frage und Vorschau. Die Antworten (Kernaussage, nächster Schritt, Rechenweg, Rechtsgrundlage) gibt es im LeaseRun-Zugang.',
  entries: c.faq.map((f, i) => ({ id: i + 1, category: f.cat, question: f.q, teaser: f.t })),
};
writeFileSync(new URL('../public/data/faq.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`faq.json: ${out.entries.length} Einträge`);
