import details from '@/lib/wissen/details.json';

// Leseproben der Wissenszentrale: der erste vollständige Satz der Kernaussage – gleichmäßig über die Phasen verteilt.
export type Detail = { q: string; cat: string; l1: string; next: string; l2: string };
export const DETAILS = details as Detail[];
const ABBR = /(?:\b(?:ggf|bzw|ca|inkl|zzgl|evtl|usw|etc|vgl|Nr|Abs|Art|Str|max|min|mtl|sog|z\.\s?B|d\.\s?h|u\.\s?a|i\.\s?d\.\s?R)|\b[A-Za-zÄÖÜäöü])\.$/;
export function firstSentence(t: string): string {
  let acc = '';
  for (const p of t.split(/(?<=[.!?])\s+/)) { acc += (acc ? ' ' : '') + p; if (!ABBR.test(acc) && !/\d\.$/.test(acc)) break; }
  return acc;
}
const TAX = /AfA|15-%|steuerfrei|nach Steuern/;
function phase(d: Detail): number {
  if (['Geld & Vermögen', 'Orientierung & Leistbarkeit'].includes(d.cat)) return 1;
  if (d.cat === 'Objektauswahl & Kaufentscheidung' || (d.cat === 'Kapitalanlage & Vermögensaufbau' && !TAX.test(d.q))) return 2;
  if (['Steuern & Werbungskosten', 'Vermieten & Absicherung'].includes(d.cat) || (d.cat === 'Kapitalanlage & Vermögensaufbau' && TAX.test(d.q))) return 3;
  if (d.cat === 'Finanzierung & Bankenpraxis') return 4;
  return 0;
}
const ORDER = ['Geld & Vermögen', 'Orientierung & Leistbarkeit', 'Objektauswahl & Kaufentscheidung', 'Kapitalanlage & Vermögensaufbau', 'Steuern & Werbungskosten', 'Vermieten & Absicherung', 'Finanzierung & Bankenpraxis'];
const rank = (d: Detail) => { const r = ORDER.indexOf(d.cat); return r < 0 ? 99 : r; };
// Reihum je Phase (1–4, dann „Rund um LeaseRun“) die jeweils ersten Fragen nehmen, bis n erreicht ist.
export function leseproben(n: number): { q: string; t: string }[] {
  const lists = [1, 2, 3, 4, 0].map((p) => DETAILS.map((d, i) => ({ d, i })).filter((x) => phase(x.d) === p).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map((x) => x.d));
  const out: Detail[] = [];
  for (let k = 0; out.length < n && lists.some((l) => l.length > k); k++) for (const l of lists) if (l[k] && out.length < n) out.push(l[k]);
  return out.map((d) => ({ q: d.q, t: firstSentence(d.l1) }));
}
