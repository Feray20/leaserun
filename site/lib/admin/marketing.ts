import { supabaseAdmin } from '@/lib/supabase/admin';
import PAGES from '@/content/ratgeber/pages.json';
import { kasseKennzahl } from '@/lib/admin/kasse-kennzahl';

// Marketing (Agent Sophie): liest die eigene Reichweitenmessung, Käufe und den Newsletter und macht daraus konkrete,
// begründete Vorschläge – welche Inhalte ziehen, woher Besucher kommen, wo Besucher verloren gehen, was in dieser
// Jahreszeit gefragt ist. Entwirft Newsletter- und Beitragstexte als Vorlage. Ohne externe Dienste, ohne Kosten.
// Sie sendet und veröffentlicht nie etwas selbst: alle Entwürfe bleiben im Headquarters, bis Feray sie freigibt.

export type MFinding = { id: string; level: 'hoch' | 'mittel' | 'niedrig'; title: string; detail: string; action?: string };
export type MDraft = { id: string; kind: 'newsletter' | 'linkedin' | 'instagram'; title: string; text: string; basis: string };
export type MReport = {
  at: string; days: number;
  visitors: number; visitorsBefore: number; views: number; mobileShare: number;
  topPages: { path: string; views: number; title: string }[];
  sources: { name: string; visitors: number }[];
  funnel: { pricing: number; open: number; start: number; bought: number; rate: number };
  newsletter: { confirmed: number; newInPeriod: number };
  findings: MFinding[]; drafts: MDraft[];
};
const KEY = 'hq_marketing';
const DAY = 864e5;
type Row = { ts: string; ev: string; visitor: string | null; path: string | null; ref: string | null; src: string | null; med: string | null; device: string | null };
type PageInfo = { path: string; title: string; desc: string; indexable: boolean };
const PAGE_LIST = PAGES as PageInfo[];
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const uniq = (rows: Row[]) => new Set(rows.map((r) => r.visitor).filter(Boolean)).size;

// Lesbarer Titel einer Seite: aus dem Ratgeber-Index oder aus dem Pfad („/ratgeber/monatliche-rate-400000-euro-kredit“).
function titleOf(path: string): string {
  const p = PAGE_LIST.find((x) => x.path === path);
  if (p) return p.title.replace(/\s*\|\s*LeaseRun\s*$/, '');
  if (path === '/') return 'Startseite';
  const slug = path.split('/').filter(Boolean).pop() || path;
  return slug.replace(/-/g, ' ').replace(/\b(\d{3})000\b/g, '$1.000').replace(/\beuro\b/g, '€').replace(/^\w/, (c) => c.toUpperCase());
}
const sourceOf = (r: Row): string => {
  if (r.src) return /^partner/.test(r.src) ? 'Creator / Partner' : r.med === 'email' || r.src === 'newsletter' ? 'Newsletter' : `Kampagne ${r.src}`;
  if (r.ref) return r.ref;
  return 'Direkt / Lesezeichen';
};

// Jahreszeit: was Kaufinteressierte und Vermieter gerade suchen (feste Erfahrungswerte, kein Dienst nötig).
function seasonal(now: Date): { title: string; detail: string }[] {
  const m = now.getMonth() + 1, y = now.getFullYear();
  if (m === 12 || m === 1) return [{ title: `Jahreswechsel: „Kaufnebenkosten ${m === 12 ? y + 1 : y}“ und Grunderwerbsteuer`, detail: `Zum Jahreswechsel wird nach aktuellen Zahlen gesucht. Titel und Zahlen der Ratgeber auf ${m === 12 ? y + 1 : y} ziehen, Grunderwerbsteuersätze der Länder prüfen – das bringt Klicks aus Google ohne neue Seiten.` }];
  if (m >= 2 && m <= 4) return [{ title: 'Steuerzeit: Vermieter suchen nach absetzbaren Kosten', detail: 'Februar bis April ist Steuererklärungszeit. Ein Beitrag „Was Vermieter absetzen können“ und ein Hinweis in der Steuersoftware-Beschreibung treffen genau den Bedarf.' }];
  if (m >= 5 && m <= 7) return [{ title: 'Frühsommer: Hochsaison für Besichtigungen', detail: 'Zwischen Mai und Juli wird am meisten besichtigt. Checkliste und Bank-Chancen-Checker jetzt sichtbar bewerben (Startseite, Newsletter, Beitrag).' }];
  if (m >= 8 && m <= 10) return [{ title: 'Herbst: Zinsentwicklung und „Jetzt kaufen oder warten?“', detail: 'Im Herbst entscheiden viele über den Kauf vor Jahresende. Ein Beitrag mit aktuellem Zinsmodell und Rechenbeispiel beantwortet die häufigste Frage dieser Monate.' }];
  return [{ title: 'Jahresende: Sonderabschreibung und Entscheidung vor Silvester', detail: 'Im November fragen Investoren nach steuerlichen Effekten noch in diesem Jahr. Ein kurzer Beitrag mit Rechenbeispiel passt jetzt.' }];
}

export async function runMarketing(days = 7): Promise<MReport> {
  const db = supabaseAdmin(), now = new Date();
  const from = new Date(+now - days * DAY), before = new Date(+now - 2 * days * DAY);
  const [{ data: cur }, { data: prev }, kz, nl, nlNew] = await Promise.all([
    db.from('lr_analytics').select('ts, ev, visitor, path, ref, src, med, device').gte('ts', from.toISOString()).limit(50000),
    db.from('lr_analytics').select('ts, ev, visitor, path, ref, src, med, device').eq('ev', 'pv').gte('ts', before.toISOString()).lt('ts', from.toISOString()).limit(50000),
    // Kasse nur aus der gemeinsamen Kennzahl (ohne Testkonten, Admin-Sitzungen und gleiche Person).
    kasseKennzahl(days * 24),
    db.from('lr_newsletter').select('id', { count: 'exact', head: true }).not('confirmed_at', 'is', null).is('unsubscribed_at', null),
    db.from('lr_newsletter').select('id', { count: 'exact', head: true }).not('confirmed_at', 'is', null).gte('confirmed_at', from.toISOString()),
  ]);
  const rows = (cur ?? []) as Row[], pv = rows.filter((r) => r.ev === 'pv');
  const visitors = uniq(pv), visitorsBefore = uniq((prev ?? []) as Row[]);
  const mobile = pv.filter((r) => r.device === 'mobile').length, mobileShare = pct(mobile, pv.length);
  const byPath = new Map<string, number>();
  for (const r of pv) byPath.set(r.path || '/', (byPath.get(r.path || '/') || 0) + 1);
  const topPages = [...byPath].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, views]) => ({ path, views, title: titleOf(path) }));
  const bySrc = new Map<string, Set<string>>();
  for (const r of pv) { const s = sourceOf(r); if (!bySrc.has(s)) bySrc.set(s, new Set()); if (r.visitor) bySrc.get(s)!.add(r.visitor); }
  const sources = [...bySrc].map(([name, v]) => ({ name, visitors: v.size })).sort((a, b) => b.visitors - a.visitors).slice(0, 8);
  // Nach Personen gezählt (mehrfaches Öffnen derselben Person zählt einmal); eigene Tests sind abgezogen.
  const t = kz.trichter, bought = kz.bezahlt;
  const funnel = { pricing: t?.pricing ?? 0, open: kz.geoeffnet, start: t?.start ?? 0, bought, rate: pct(bought, kz.geoeffnet) };
  const newsletter = { confirmed: nl.count || 0, newInPeriod: nlNew.count || 0 };

  // ---------- Vorschläge: begründet mit den eigenen Zahlen ----------
  const F: MFinding[] = [], D: MDraft[] = [];
  const add = (f: MFinding) => F.push(f);
  const search = sources.filter((s) => /Google|Bing|DuckDuckGo|Ecosia/.test(s.name)).reduce((s, x) => s + x.visitors, 0);
  const social = sources.filter((s) => /LinkedIn|Instagram|Facebook|TikTok|YouTube|X \//.test(s.name)).reduce((s, x) => s + x.visitors, 0);
  const ai = sources.filter((s) => /ChatGPT|Perplexity|Claude/.test(s.name)).reduce((s, x) => s + x.visitors, 0);
  const diff = visitorsBefore ? Math.round(((visitors - visitorsBefore) / visitorsBefore) * 100) : 0;
  if (visitorsBefore && diff <= -20) add({ id: 'traffic-down', level: 'hoch', title: `Besucher ${diff} % gegenüber den ${days} Tagen davor`, detail: `${visitors} Besucher statt ${visitorsBefore}. Zuerst prüfen, ob Google weniger schickt (Search Console) oder eine Quelle weggefallen ist: ${sources.slice(0, 3).map((s) => `${s.name} ${s.visitors}`).join(', ')}.` });
  else if (visitorsBefore && diff >= 25) add({ id: 'traffic-up', level: 'niedrig', title: `Besucher +${diff} % – Schwung nutzen`, detail: `${visitors} Besucher. Stärkste Seite: ${topPages[0]?.title || '–'}. Jetzt dort den Newsletter-Hinweis und den Link zum Rechner prominent halten, damit der Zuwachs bleibt.` });
  if (visitors >= 30 && pct(search, visitors) < 30) add({ id: 'search-low', level: 'mittel', title: `Nur ${pct(search, visitors)} % der Besucher kommen über Suchmaschinen`, detail: 'Die Ratgeber-Seiten sind für genau diese Suchen gebaut. Lösung: Google Search Console und Bing Webmaster Tools prüfen, Sitemap eingereicht lassen, intern aus Startseite und Rechnern auf die Ratgeber verlinken.' });
  if (visitors >= 30 && !social) add({ id: 'social-none', level: 'mittel', title: 'Kein einziger Besucher aus sozialen Netzwerken', detail: 'LinkedIn passt zu Banken, Maklern und Käufern mit Budget. Ein Beitrag pro Woche mit einer Zahl aus dem Ratgeber reicht für den Anfang – ich habe unten einen Entwurf vorbereitet.', action: 'Entwurf unten freigeben und selbst posten' });
  if (ai) add({ id: 'ai-source', level: 'niedrig', title: `${ai} Besucher kamen über KI-Assistenten (ChatGPT, Perplexity)`, detail: 'Diese Besucher sind stark entschieden. Klare Antworten in den ersten Sätzen jeder Ratgeber-Seite und Datenstand sichtbar halten – so werden die Seiten weiter zitiert.' });
  if (mobileShare >= 60) add({ id: 'mobile-first', level: 'mittel', title: `${mobileShare} % der Aufrufe kommen vom Handy`, detail: 'Alles Neue (Beiträge, Angebote, Kasse) zuerst am Handy prüfen. Vorschaubilder fürs Teilen (og:image) sollten auch klein lesbar sein.' });
  // „hoch“ erst ab 3 verschiedenen Fremdpersonen ohne Kauf; nur eigener Testverkehr ergibt höchstens einen Hinweis.
  if (kz.nurTest) { if (kz.davon_eigene || kz.gestartet || kz.geoeffnet) add({ id: 'kasse-test', level: 'niedrig', title: kz.hinweis, detail: `${kz.personen} fremde Person${kz.personen === 1 ? '' : 'en'} an der Kasse, ${kz.davon_eigene} eigene Sitzungen abgezogen. Eine Kaufquote ist erst ab 3 verschiedenen Fremdpersonen aussagekräftig.` }); }
  else if (funnel.open >= 10 && funnel.rate < 10) add({ id: 'checkout-rate', level: kz.alarm ? 'hoch' : 'mittel', title: `Nur ${funnel.rate} % kaufen, nachdem sie die Kasse geöffnet haben (${funnel.open} Personen, ${bought} Käufe)`, detail: 'Üblich sind 20–40 %. Hebel ohne Druckmittel: Preis und Leistung direkt in der Kasse wiederholen, Zahlungsarten (Karte, PayPal, SEPA) sichtbar, keine Pflichtregistrierung vor dem Preis, Rückgaberecht in einem Satz nennen.' });
  if (funnel.pricing >= 20 && funnel.open < funnel.pricing * 0.15) add({ id: 'pricing-no-open', level: 'mittel', title: `${funnel.pricing} Personen sahen die Preise, nur ${funnel.open} öffneten die Kasse`, detail: 'Die Preise überzeugen noch nicht auf den ersten Blick. Lösung: je Tarif einen Satz „Für wen“ und das wichtigste Ergebnis (z. B. Bank-Chance) nennen; den empfohlenen Tarif hervorheben.' });
  if (newsletter.confirmed < 50 && visitors >= 50) add({ id: 'newsletter-small', level: 'mittel', title: `Newsletter hat erst ${newsletter.confirmed} bestätigte Abonnenten bei ${visitors} Besuchern`, detail: 'Die Anmeldung gehört ans Ende jeder Ratgeber-Seite mit konkretem Nutzen („Zinsmodell-Update monatlich“). Ein Freebie (Checkliste als PDF) verdoppelt erfahrungsgemäß die Anmeldungen.' });
  else if (newsletter.newInPeriod === 0 && newsletter.confirmed >= 50) add({ id: 'newsletter-stale', level: 'niedrig', title: `Keine neue Newsletter-Anmeldung in ${days} Tagen`, detail: 'Anmeldeformular auf den meistbesuchten Seiten prüfen und einen Anlass bieten (neuer Beitrag, neues Zinsmodell).' });
  const top = topPages[0];
  if (top && topPages.length > 1 && pct(top.views, pv.length) >= 40 && top.path !== '/') add({ id: 'one-hit', level: 'niedrig', title: `„${top.title}“ bringt ${pct(top.views, pv.length)} % aller Aufrufe`, detail: 'Eine Seite trägt die Reichweite. Lösung: von dort auf zwei verwandte Ratgeber und den passenden Rechner verlinken, damit Besucher bleiben – und zwei Schwesterseiten zum selben Thema anlegen.' });
  for (const s of seasonal(now)) add({ id: `season:${now.getMonth() + 1}`, level: 'mittel', title: s.title, detail: s.detail });
  const unindexed = PAGE_LIST.filter((p) => !p.indexable && p.path.startsWith('/guides/')).length;
  if (unindexed) add({ id: 'ratgeber-gate', level: 'niedrig', title: `${unindexed} Ratgeber-Seite${unindexed === 1 ? '' : 'n'} noch nicht für Google freigegeben`, detail: 'Jede freigegebene Seite ist eine zusätzliche Suchanfrage, die LeaseRun beantworten kann. Noahs Quality-Gate-Befunde nennen, was fehlt.' });

  // ---------- Entwürfe: fertig formuliert, aber nur als Vorlage (nichts geht raus) ----------
  const hero = topPages.find((p) => p.path.startsWith('/guides/')) || topPages.find((p) => p.path !== '/');
  if (hero) {
    const info = PAGE_LIST.find((p) => p.path === hero.path);
    const lead = info?.desc || `${hero.title} – mit Modellrechnung, Quellen und Datenstand.`;
    D.push({ id: 'li-top', kind: 'linkedin', title: `LinkedIn-Beitrag: ${hero.title}`, basis: `meistgelesene Seite der letzten ${days} Tage (${hero.views} Aufrufe)`,
      text: `${hero.title}.\n\n${lead}\n\nDie meisten unterschätzen dabei die Haushaltsrechnung der Bank – nicht der Kaufpreis entscheidet, sondern die monatliche Tragfähigkeit.\n\nRechnen Sie Ihren Fall in zwei Minuten durch: https://leaserun.com${hero.path}\n\n#Immobilienfinanzierung #Baufinanzierung #Eigenheim` });
    D.push({ id: 'nl-top', kind: 'newsletter', title: `Newsletter: ${hero.title}`, basis: `meistgelesene Seite der letzten ${days} Tage`,
      text: `Betreff: ${hero.title.length > 50 ? hero.title.slice(0, 47) + '…' : hero.title}\n\nHallo,\n\ndiese Woche hat eine Frage besonders viele Leser bewegt: ${hero.title}.\n\n${lead}\n\nZum Ratgeber mit Rechenbeispiel: https://leaserun.com${hero.path}\n\nWenn Sie Ihre eigene Finanzierung prüfen möchten: Der Bank-Chancen-Checker zeigt in zwei Minuten, wie eine Bank Ihren Fall bewertet – https://leaserun.com/calculators/bank-chancen-checker\n\nViele Grüße\nIhr LeaseRun-Team` });
  }
  const sea = seasonal(now)[0];
  D.push({ id: 'ig-season', kind: 'instagram', title: `Instagram-Text: ${sea.title.split(':')[0]}`, basis: 'Jahreszeit', text: `${sea.title}\n\n${sea.detail.split('.')[0]}.\n\nDie Antwort mit Rechenbeispiel steht auf leaserun.com – Link in der Bio.\n\n#Immobilien #Baufinanzierung #Eigentumswohnung #LeaseRun` });

  const order = { hoch: 0, mittel: 1, niedrig: 2 } as const;
  F.sort((a, b) => order[a.level] - order[b.level]);
  const rep: MReport = { at: now.toISOString(), days, visitors, visitorsBefore, views: pv.length, mobileShare, topPages, sources, funnel, newsletter, findings: F.slice(0, 20), drafts: D };
  await db.from('lr_settings').upsert({ key: KEY, value: rep, updated_at: rep.at, updated_by: 'system:marketing' });
  return rep;
}

export async function loadMarketing(): Promise<MReport | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  return (data?.value as MReport) || null;
}

// Kurztexte für Headquarters und Zentralsteuerung
export const marketingSummary = (r: MReport): string => {
  const d = r.visitorsBefore ? ` (${r.visitors >= r.visitorsBefore ? '+' : ''}${Math.round(((r.visitors - r.visitorsBefore) / r.visitorsBefore) * 100)} % ggü. davor)` : '';
  const top = r.topPages[0] ? ` Meistgelesen: ${r.topPages[0].title} (${r.topPages[0].views}×).` : '';
  const src = r.sources[0] ? ` Stärkste Quelle: ${r.sources[0].name} (${r.sources[0].visitors}).` : '';
  return `${r.days} Tage: ${r.visitors} Besucher${d}, ${r.views} Aufrufe, ${r.mobileShare} % mobil.${top}${src}`;
};
export const marketingIdeas = (r: MReport): string => (r.findings.length ? r.findings.slice(0, 8).map((f, i) => `${i + 1}. ${f.title}\n   ${f.detail}${f.action ? `\n   → ${f.action}` : ''}`).join('\n') : 'Keine Auffälligkeit – Reichweite und Kasse laufen im normalen Rahmen.');
export const marketingSources = (r: MReport): string => (r.sources.length ? `Woher die Besucher kommen (${r.days} Tage): ${r.sources.map((s) => `${s.name} ${s.visitors}`).join(' · ')}.` : 'Noch keine Besucherdaten im Zeitraum.');
export const marketingPages = (r: MReport): string => (r.topPages.length ? `Meistgelesene Seiten (${r.days} Tage):\n${r.topPages.map((p, i) => `${i + 1}. ${p.title} – ${p.views} Aufrufe (${p.path})`).join('\n')}` : 'Noch keine Seitenaufrufe im Zeitraum.');
export const marketingDraft = (r: MReport, kind: MDraft['kind']): string => { const d = r.drafts.find((x) => x.kind === kind); return d ? `${d.title} (Grundlage: ${d.basis}). Entwurf – geht nur raus, wenn du ihn selbst veröffentlichst:\n\n${d.text}` : 'Dafür habe ich noch keinen Entwurf – zuerst „Marketing jetzt prüfen“.'; };
