// Quality Gate und Duplikat-Prüfung für die Ratgeber-Seiten (/guides/{slug}).
// Eine Seite wird nur indexierbar, wenn alle Bedingungen erfüllt sind (siehe GATE). Sonst: noindex, nicht in der
// Sitemap, keine prominente Verlinkung. Ergebnis wird als content/ratgeber/gate-report.json eingecheckt.

// Formulierungen, die nie vorkommen dürfen (Finanzversprechen, Druck, falsche Allgemeinaussagen).
export const PROHIBITED = [
  /die bank wird (sie )?ablehnen/i, /kredit garantiert/i, /bankzusage garantiert/i, /sie bekommen den kredit/i,
  /sie bekommen keinen kredit/i, /geheimtrick/i, /100\s?% kreditgarantie/i, /banken wollen das nicht/i,
  /alle banken rechnen so/i, /wir wissen exakt, wie jede bank/i, /nur noch heute/i, /garantierte? (zusage|finanzierung)/i,
];

export const THRESHOLDS = { minWords: 380, maxSimilarity: 0.45, minFaqs: 3, minSources: 2, minSections: 3, titleMin: 25, titleMax: 62, descMin: 80, descMax: 160 };

const words = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<table[\s\S]*?<\/table>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;|&#\d+;/g, ' ').toLowerCase().split(/[^a-zäöüß0-9]+/).filter((w) => w.length > 2);
// Wort-Dreiergruppen (Shingles) für die Ähnlichkeit zweier Texte.
const shingles = (ws) => { const s = new Set(); for (let i = 0; i + 2 < ws.length; i++) s.add(`${ws[i]} ${ws[i + 1]} ${ws[i + 2]}`); return s; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };

/**
 * @param pages [{ slug, topic, prose (eigener Fließtext ohne Tabellen/Rechner), title, desc, h1, calcOk, faqsRendered }]
 * @returns { [slug]: { pass, indexable, scores, failures } }
 */
export function evaluate(pages) {
  const T = THRESHOLDS;
  const sh = new Map(pages.map((p) => [p.slug, shingles(words(p.prose))]));
  const out = {};
  for (const p of pages) {
    const t = p.topic;
    const ws = words(p.prose);
    let maxSim = 0, simWith = null;
    for (const q of pages) {
      if (q.slug === p.slug) continue;
      const s = jaccard(sh.get(p.slug), sh.get(q.slug));
      if (s > maxSim) { maxSim = s; simWith = q.slug; }
    }
    const titleOk = p.title.length >= T.titleMin && p.title.length <= T.titleMax;
    const descOk = p.desc.length >= T.descMin && p.desc.length <= T.descMax;
    const prohibited = PROHIBITED.filter((re) => re.test(p.prose) || re.test(p.title) || re.test(p.desc)).map(String);
    const checks = {
      search_intent_exists: Boolean(t.search_intent && t.search_intent_exists !== false),
      user_value: (t.sections?.length || 0) >= T.minSections && (t.checker !== false || /\{\{tabelle:|<table/.test(JSON.stringify(t.sections))),
      unique_information: ws.length >= T.minWords,
      financial_claims_validated: t.financial_claims_validated === true,
      calculation_valid: p.calcOk === true,
      metadata_valid: titleOk && descOk && Boolean(p.h1),
      canonical_valid: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug),
      schema_valid: p.faqsRendered === (t.faqs?.length || 0) && (t.faqs?.length || 0) >= T.minFaqs,
      no_duplicate_content: maxSim <= T.maxSimilarity,
      no_thin_content: ws.length >= T.minWords,
      sources_present: (t.sources?.length || 0) >= T.minSources && Boolean(t.last_verified),
      no_prohibited_language: prohibited.length === 0,
      legal_review_ok: t.legal_review_status !== 'blocked',
      status_published: t.status === 'published',
    };
    const failures = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    const scores = {
      quality_score: Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100),
      source_score: Math.min(100, (t.sources?.length || 0) * 25),
      uniqueness_score: Math.round((1 - maxSim) * 100),
      financial_accuracy_score: checks.financial_claims_validated && checks.calculation_valid ? 100 : 0,
      user_value_score: Math.min(100, Math.round(ws.length / 12) + (t.checker !== false ? 25 : 0)),
      words: ws.length, max_similarity: Math.round(maxSim * 1000) / 1000, most_similar: simWith,
    };
    out[p.slug] = { pass: failures.length === 0, indexable: failures.length === 0, scores, failures, prohibited };
  }
  return out;
}
