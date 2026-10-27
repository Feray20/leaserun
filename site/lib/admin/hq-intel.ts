// Intelligenz-Schicht der HQ-Mitarbeiter (ohne bezahlte KI, nur feste Regeln über die eigenen Daten):
// 1. Gedächtnis: Jeder Agent merkt sich, seit wann ein Punkt offen ist, was neu ist, was behoben wurde und was
//    nach einer Behebung wiederkommt. Lange offene Punkte werden hochgestuft.
// 2. Verlauf: Kennzahlen je Agent über die letzten Runden – Trend gegenüber dem Vortag bzw. der Vorwoche.
// 3. Zusammenhänge: Ethan legt die Ergebnisse aller Agenten nebeneinander, erkennt gemeinsame Ursachen
//    (z. B. Stripe-Störung → Kasse bricht ab) und nennt die drei wichtigsten Schritte für heute.

import { befundKey } from '@/lib/admin/kasse-kennzahl';

export type Level = 'hoch' | 'mittel' | 'niedrig';
export type Issue = { id: string; level: Level; title: string; customer?: boolean };
type Seen = { first: string; last: string; level: Level; title: string };
export type AgentMem = { open: Record<string, Seen>; gone: Record<string, string>; series: { at: string; v: Record<string, number> }[] };
export type Memory = Record<string, AgentMem>;
export type Recall = { neu: Issue[]; alt: (Issue & { days: number })[]; wieder: Issue[]; behoben: string[]; escalate: boolean };

const DAY = 864e5;
const empty = (): AgentMem => ({ open: {}, gone: {}, series: [] });

// Ergebnis einer Runde ins Gedächtnis übernehmen und Auffälliges zurückgeben.
export function remember(mem: Memory, agent: string, issues: Issue[], metrics: Record<string, number> = {}, now = new Date()): Recall {
  const m = (mem[agent] ||= empty()), t = now.toISOString(), ids = new Set(issues.map((i) => i.id));
  const r: Recall = { neu: [], alt: [], wieder: [], behoben: [], escalate: false };
  for (const i of issues) {
    const s = m.open[i.id];
    if (!s) { (m.gone[i.id] ? r.wieder : r.neu).push(i); delete m.gone[i.id]; m.open[i.id] = { first: t, last: t, level: i.level, title: i.title }; continue; }
    s.last = t; s.level = i.level; s.title = i.title;
    const days = Math.floor((+now - +new Date(s.first)) / DAY);
    if (days >= 1) r.alt.push({ ...i, days });
    if (days >= 2 && i.level !== 'niedrig') r.escalate = true;
  }
  for (const [id, s] of Object.entries(m.open)) if (!ids.has(id)) { r.behoben.push(s.title); m.gone[id] = t; delete m.open[id]; }
  // „Behoben“ nur 30 Tage merken (für „wieder aufgetreten“), Verlauf: höchstens eine Messung je Stunde, 21 Tage.
  for (const [id, at] of Object.entries(m.gone)) if (+now - +new Date(at) > 30 * DAY) delete m.gone[id];
  if (Object.keys(metrics).length) {
    const last = m.series[m.series.length - 1];
    if (last && +now - +new Date(last.at) < 36e5) last.v = metrics; else m.series.push({ at: t, v: metrics });
    m.series = m.series.filter((x) => +now - +new Date(x.at) < 21 * DAY).slice(-500);
  }
  r.alt.sort((a, b) => b.days - a.days);
  return r;
}

// Vergleichswert von vor etwa `days` Tagen (nächstgelegene Messung, mindestens 60 % des Abstands).
export function trend(mem: Memory, agent: string, key: string, now: number, days = 7): { before: number; now: number } | null {
  const s = mem[agent]?.series || [];
  const cur = s[s.length - 1]?.v[key];
  if (cur === undefined) return null;
  const target = now - days * DAY;
  let best: { at: string; v: Record<string, number> } | null = null;
  for (const x of s) if (+new Date(x.at) <= now - days * 0.6 * DAY && (!best || Math.abs(+new Date(x.at) - target) < Math.abs(+new Date(best.at) - target))) best = x;
  return best && best.v[key] !== undefined ? { before: best.v[key], now: cur } : null;
}
export function trendText(t: { before: number; now: number } | null, label: string, period = 'Vorwoche'): string {
  if (!t || t.before === t.now) return '';
  if (!t.before) return `${label}: ${t.now} (${period}: 0)`;
  const p = Math.round(((t.now - t.before) / t.before) * 100);
  return Math.abs(p) < 15 ? '' : `${label} ${p > 0 ? '+' : ''}${p} % ggü. ${period}`;
}

// Kurztext „Gedächtnis“ für die Zeile eines Agenten.
export function recallText(r: Recall): string {
  const p: string[] = [];
  if (r.wieder.length) p.push(`wieder aufgetreten: ${r.wieder[0].title}${r.wieder.length > 1 ? ` (+${r.wieder.length - 1})` : ''}`);
  if (r.alt.length) p.push(`seit ${r.alt[0].days} Tag${r.alt[0].days === 1 ? '' : 'en'} offen: ${r.alt[0].title}`);
  if (r.behoben.length) p.push(`seit letzter Runde erledigt: ${r.behoben.length}`);
  return p.length ? ` Gedächtnis: ${p.join(' · ')}.` : '';
}

// ---------- Ethan: alle Ergebnisse zusammen bewerten ----------
export type AgentView = { id: string; name: string; status: string; line: string; issues: Issue[]; days: Record<string, number> };
const W: Record<Level, number> = { hoch: 3, mittel: 2, niedrig: 1 };
const has = (v: AgentView[], agent: string, re: RegExp) => v.some((a) => a.id === agent && a.issues.some((i) => re.test(`${i.id} ${i.title}`)));

// kasse: gemeinsame Kassen-Kennzahl (lib/admin/kasse-kennzahl.ts). Ist es nur eigener Testverkehr, wird kein Kassen-Punkt
// „hoch“ gewertet; gleiche Befund-Schlüssel (z. B. kasse:keine-kaeufe) zählen nur einmal.
export function situation(views: AgentView[], kasse?: { nurTest: boolean } | null): { top: (Issue & { agent: string; score: number })[]; causes: string[] } {
  const lv = (i: Issue): Level => (kasse?.nurTest && befundKey(i.id) ? 'niedrig' : i.level);
  const all = views.flatMap((a) => a.issues.map((i) => ({ ...i, level: lv(i), agent: a.name, score: W[lv(i)] * (i.customer ? 2 : 1) * (1 + Math.min(a.days[i.id] || 0, 7) / 7) })));
  all.sort((a, b) => b.score - a.score);
  const seen = new Set<string>(), top: typeof all = [];
  for (const i of all) { const k = befundKey(i.id) || i.title.slice(0, 40); if (!seen.has(k)) { seen.add(k); top.push(i); } if (top.length === 3) break; }
  const causes: string[] = [];
  if (has(views, 'technik', /stripe|webhook|zahlung/i) && has(views, 'support', /kasse|zahlung/i)) causes.push('Kasse und Stripe-Prüfung melden gleichzeitig Probleme – wahrscheinlich eine gemeinsame Ursache bei Stripe. Zuerst Olivias Stripe-Prüfung lösen.');
  if (has(views, 'support', /Serverfehler|API 5|abgestürzt/i) && has(views, 'optimierung', /antwortet nicht|langsam/i)) causes.push('Kundenfehler und langsame/ausgefallene Seiten zur selben Zeit – deutet auf eine Störung nach dem letzten Update oder bei Vercel hin.');
  if (has(views, 'support', /Missbrauchsschutz/i) && has(views, 'sicherheit', /angriff|sperr|brute|login/i)) causes.push('Der Missbrauchsschutz bremst gerade auch echte Kunden – vermutlich wegen eines laufenden Angriffs (Jake).');
  if (has(views, 'postfach', /resend|keine.*mail/i) && has(views, 'technik', /mail|dns|domain|resend/i)) causes.push('Postfach leer und E-Mail-Domain auffällig – gemeinsame Ursache: E-Mail-Domain bei Resend.');
  if (has(views, 'support', /registrieren|Anmeldedienst/i) && has(views, 'technik', /supabase|datenbank/i)) causes.push('Anmeldung gestört und Datenbank auffällig – zuerst Supabase prüfen.');
  if (!kasse?.nurTest && has(views, 'support', /keinen? abgeschlossenen Kauf|ohne Kauf/i) && !has(views, 'support', /Serverfehler|abgewiesen|abgelehnt/i)) causes.push('Kunden gehen bis zur Kasse, kaufen aber nicht – technisch ist kein Fehler zu sehen. Eher Angebot, Preis oder Zahlungsarten prüfen.');
  return { top, causes };
}

// ---------- Sprache: Tippfehler-tolerante Stichworte (für die Zentralsteuerung, hq-brain.ts) ----------
// Tippfehler-tolerant: ein Stichwort passt auch, wenn ein Wort im Text bis zu einen Buchstaben abweicht
// (z. B. „umsaz“, „bescuher“, „ternim“). Kurze Wörter müssen genau passen, damit nichts Falsches anspringt.
// Zählt Einfügen, Löschen, Ersetzen und das Vertauschen zweier Nachbarbuchstaben („bescuher“, „ternim“) je als einen Fehler.
export function lev(a: string, b: string, max = 1): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const w = b.length + 1;
  const d: number[][] = [Array.from({ length: w }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(w); row[0] = i; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(d[i - 1][j] + 1, row[j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      row[j] = v; rowMin = Math.min(rowMin, v);
    }
    d.push(row);
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}
export function fuzzyHas(t: string, ...w: string[]): boolean {
  const words = t.split(' ');
  return w.some((x) => {
    if (new RegExp(`(^|\\s)${x}`).test(t)) return true;
    if (x.length < 5 || x.includes(' ')) return false;
    // Ab sechs Buchstaben dürfen es zwei Fehler sein, wenn der Wortanfang stimmt („ternime“ → Termin).
    return words.some((tok) => { if (tok.length < 5) return false; const max = x.length >= 6 && tok.slice(0, 3) === x.slice(0, 3) ? 2 : 1; return lev(tok.slice(0, x.length), x, max) <= max || lev(tok.slice(0, x.length + 1), x, max) <= max; });
  });
}
