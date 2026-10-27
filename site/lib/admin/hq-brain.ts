import { supabaseAdmin } from '@/lib/supabase/admin';
import { fuzzyHas } from '@/lib/admin/hq-intel';

// LeaseRun Intelligence · Zentralsteuerung. Versteht freie Fragen und Aufträge auf Deutsch (auch umgangssprachlich,
// mit Tippfehlern) und beantwortet sie aus den Live-Daten von LeaseRun. Ohne externe Dienste und ohne laufende Kosten.
// Nur lesend: Änderungen und alles, was nach außen geht, laufen weiter über Knöpfe mit Freigabe der Gründerin.

export type BrainAction = { id: string; label: string; tab?: string; sg?: string };
export type BrainAnswer = { reply: string; actions?: BrainAction[]; agent: string; intent: string; daten?: unknown };

// ---------- Sprache ----------
const norm = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9@.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const has = fuzzyHas;
const n = (x: number, one: string, many: string) => `${x.toLocaleString('de-DE')} ${x === 1 ? one : many}`;
const eur = (c: number) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const DAY = 864e5;

type Range = { from: Date; to: Date; label: string };
function range(t: string, def = 30): Range {
  const now = new Date(), start = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  if (has(t, 'heute')) return { from: start(now), to: now, label: 'heute' };
  if (has(t, 'gestern')) { const f = start(new Date(+now - DAY)); return { from: f, to: start(now), label: 'gestern' }; }
  if (has(t, 'diese woche', 'woche')) { const f = start(now); f.setDate(f.getDate() - ((f.getDay() + 6) % 7)); return { from: f, to: now, label: 'diese Woche' }; }
  if (has(t, 'diesen monat', 'monat')) { const f = start(now); f.setDate(1); return { from: f, to: now, label: 'diesen Monat' }; }
  if (has(t, 'jahr', 'dieses jahr')) { const f = start(now); f.setMonth(0, 1); return { from: f, to: now, label: 'dieses Jahr' }; }
  const m = /(\d{1,3})\s*(tag|tage|tagen)/.exec(t);
  if (m) return { from: new Date(+now - Number(m[1]) * DAY), to: now, label: `in den letzten ${m[1]} Tagen` };
  if (has(t, 'insgesamt', 'gesamt', 'alle', 'jemals', 'bisher')) return { from: new Date(0), to: now, label: 'insgesamt' };
  return { from: new Date(+now - def * DAY), to: now, label: `in den letzten ${def} Tagen` };
}
const iso = (d: Date) => d.toISOString();
const db = () => supabaseAdmin();
const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

// ---------- Fähigkeiten ----------
export type Intent = { id: string; agent: string; label: string; test: (t: string) => number; run: (t: string, raw: string) => Promise<Omit<BrainAnswer, 'agent' | 'intent'>> };

export const INTENTS: Intent[] = [
  {
    id: 'kundenreise', agent: 'support', label: 'Kundenprobleme, Kasse & Abbrüche',
    test: (t) => (has(t, 'abbruch', 'abbrech', 'abgebrochen', 'kasse', 'checkout', 'kaufen nicht', 'kauft nicht', 'stolper', 'kundenprobl', 'kunde hat', 'kunden haben') ? 4 : 0),
    run: async () => {
      const { kundenReport } = await import('@/lib/admin/kundenreise');
      const r = await kundenReport();
      const list = r.issues.filter((i) => i.level !== 'niedrig').slice(0, 5);
      const co = r.checkout;
      return { reply: `${co && co.total ? `Kasse (3 Tage): ${co.total + co.own} geöffnet, davon extern ${co.total} (ohne Admin-, Test- und Testmodus-Sitzungen), ${co.complete} bezahlt, ${co.expired + co.open} ohne Kauf${co.declined ? `, ${co.declined} abgelehnt` : ''}. ` : ''}${list.length ? list.map((i, k) => `${k + 1}. ${i.title} – ${i.detail}`).join('\n') : 'Kein Kunde ist auf einen Fehler gestoßen.'}` };
    },
  },
  {
    id: 'besucher', agent: 'briefing', label: 'Besucher & Seitenaufrufe',
    test: (t) => (has(t, 'besuch', 'traffic', 'aufruf', 'reichweite', 'klicks', 'seitenaufruf', 'views') ? 3 : 0),
    run: async (t) => {
      const r = range(t, 7);
      const { data } = await db().from('lr_analytics').select('visitor, ev').gte('ts', iso(r.from)).lte('ts', iso(r.to)).limit(50000);
      const pv = (data ?? []).filter((x) => x.ev === 'pv');
      const vis = new Set(pv.map((x) => x.visitor)).size;
      return { reply: `${r.label[0].toUpperCase()}${r.label.slice(1)}: ${n(vis, 'Besucher', 'Besucher')}, ${n(pv.length, 'Seitenaufruf', 'Seitenaufrufe')}.`, actions: [{ id: 'open', label: 'Analyse öffnen', tab: 'analyse', sg: 'b2c' }] };
    },
  },
  {
    id: 'umsatz', agent: 'finanzen', label: 'Umsatz & Einnahmen',
    test: (t) => (has(t, 'umsatz', 'einnahm', 'verdien', 'revenue', 'geld', 'erloes', 'gewinn', 'eingenommen') ? 3 : 0),
    run: async (t) => {
      const r = range(t, 30);
      const [{ data: inv }, { data: k }] = await Promise.all([
        db().from('lr_invoices').select('gross_cents, payment_status, kind').gte('issue_date', iso(r.from).slice(0, 10)).lte('issue_date', iso(r.to).slice(0, 10)),
        db().from('lr_kaeufe').select('betrag, erstattet_at').gte('created_at', iso(r.from)).lte('created_at', iso(r.to)),
      ]);
      const paid = (inv ?? []).filter((x) => x.payment_status === 'paid' && x.kind !== 'credit_note').reduce((s, x) => s + Number(x.gross_cents || 0), 0);
      const open = (inv ?? []).filter((x) => x.payment_status !== 'paid' && x.kind !== 'credit_note').reduce((s, x) => s + Number(x.gross_cents || 0), 0);
      const shop = (k ?? []).filter((x) => !x.erstattet_at).reduce((s, x) => s + Number(x.betrag || 0), 0);
      return { reply: `Umsatz ${r.label}: ${eur(paid + shop)} brutto bezahlt${open ? `, dazu ${eur(open)} offen` : ''} (${n((inv ?? []).length, 'Rechnung', 'Rechnungen')}, ${n((k ?? []).length, 'Kauf', 'Käufe')}).`, actions: [{ id: 'open', label: 'Finanz-Cockpit', tab: 'cockpit' }] };
    },
  },
  {
    // Abrechnungsstand je aktivem Abo und Unternehmenskonto: bezahlt, offen, überfällig, Testphase, 100-%-Rabatt oder ohne Rechnung.
    id: 'abrechnung', agent: 'finanzen', label: 'Abrechnungsstand je Abo & Unternehmenskonto',
    test: (t) => (has(t, 'abrechnung', 'abrechnungsstand', 'zahlungsstand', 'ohne rechnung', 'naechste rechnung', 'letzte zahlung', 'ueberfaellig', 'testphase', 'rabatt') ? 4 : 0),
    run: async () => {
      const { abrechnungsstand } = await import('@/lib/admin/abrechnung');
      const a = await abrechnungsstand();
      const by: Record<string, number> = {}; for (const z of a.zeilen) by[z.status] = (by[z.status] || 0) + 1;
      const zeile = (z: (typeof a.zeilen)[number]) => `${z.kunde} · ${z.tarif} ${z.intervall} ${eur(z.preisBrutto)}: ${z.status}${z.letzteZahlung ? `, zuletzt bezahlt ${z.letzteZahlung.datum} (${eur(z.letzteZahlung.betrag)})` : ', noch keine Zahlung'}${z.offen ? `, offen ${eur(z.offen)}${z.aeltesteOffene?.faellig ? ` (fällig ${z.aeltesteOffene.faellig})` : ''}` : ''}${z.naechsteAbrechnung ? `, nächste Abrechnung ${z.naechsteAbrechnung}` : ''}${z.hinweis ? ` – ${z.hinweis}` : ''}`;
      return {
        reply: a.zeilen.length ? `${n(a.zeilen.length, 'laufender Vertrag', 'laufende Verträge')} (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}):\n${a.zeilen.slice(0, 15).map(zeile).join('\n')}${a.fehler.length ? `\nHinweis: ${a.fehler.join(' ')}` : ''}` : `Kein aktives Abo und kein aktives Unternehmenskonto gefunden.${a.fehler.length ? ` Hinweis: ${a.fehler.join(' ')}` : ''}`,
        actions: [{ id: 'open', label: 'Finanz-Cockpit', tab: 'cockpit' }],
        daten: a,
      };
    },
  },
  {
    id: 'nutzer', agent: 'vertrieb', label: 'Nutzer & Registrierungen',
    test: (t) => (has(t, 'nutzer', 'user', 'registr', 'anmeldung', 'konten', 'kunden', 'mitglied', 'signup') && !has(t, 'unternehm', 'b2b') ? 3 : 0),
    run: async (t) => {
      const r = range(t, 30);
      const [all, neu, abo] = await Promise.all([
        count(db().from('lr_user_data').select('user_id', { count: 'exact', head: true })),
        count(db().from('lr_user_data').select('user_id', { count: 'exact', head: true }).gte('created_at', iso(r.from))),
        count(db().from('lr_entitlements').select('user_id', { count: 'exact', head: true }).eq('status', 'active')),
      ]);
      return { reply: `${n(all, 'Konto', 'Konten')} insgesamt, ${n(neu, 'neues', 'neue')} ${r.label}. ${n(abo, 'aktives Abo', 'aktive Abos')}.`, actions: [{ id: 'open', label: 'Nutzer öffnen', tab: 'nutzer', sg: 'b2c' }] };
    },
  },
  {
    id: 'b2b', agent: 'vertrieb', label: 'Unternehmen & Anfragen',
    test: (t) => (has(t, 'unternehm', 'b2b', 'firmen', 'makler', 'bank', 'kontoanfrag', 'demo') ? 3 : 0),
    run: async (t) => {
      const r = range(t, 30);
      const [acc, req, clicks, reqs] = await Promise.all([
        db().from('lr_b2b_accounts').select('status, plan_tier'),
        db().from('lr_b2b_contact').select('id, kind, company, created_at, status').order('created_at', { ascending: false }).limit(50),
        // Klicks auf „Demo anfragen“ / „Unterlagen per E-Mail“ (/business, /business-portal) neben den eingegangenen Anfragen.
        db().from('lr_analytics').select('ev').in('ev', ['b2b_demo_klick', 'b2b_unterlagen_klick']).gte('ts', iso(r.from)).lte('ts', iso(r.to)).limit(20000),
        count(db().from('lr_b2b_contact').select('id', { count: 'exact', head: true }).gte('created_at', iso(r.from)).lte('created_at', iso(r.to))),
      ]);
      const active = (acc.data ?? []).filter((a) => a.status === 'active').length;
      const open = (req.data ?? []).filter((x) => !x.status || /neu|new|offen|open/i.test(String(x.status)));
      const demo = (clicks.data ?? []).filter((x) => x.ev === 'b2b_demo_klick').length, docs = (clicks.data ?? []).length - demo;
      return { reply: `${n(active, 'aktives Unternehmenskonto', 'aktive Unternehmenskonten')}. ${open.length ? `${n(open.length, 'offene Anfrage', 'offene Anfragen')}, zuletzt ${open[0].company || 'ohne Firmenname'}.` : 'Keine offenen Anfragen.'} ${r.label[0].toUpperCase()}${r.label.slice(1)}: ${n(demo, 'Klick', 'Klicks')} auf „Demo anfragen“, ${n(docs, 'Klick', 'Klicks')} auf „Unterlagen per E-Mail“, ${n(reqs, 'Anfrage', 'Anfragen')} eingegangen.`, actions: [{ id: 'open', label: 'Anfragen öffnen', tab: 'anfragen', sg: 'b2b' }] };
    },
  },
  {
    id: 'termine', agent: 'support', label: 'Termine',
    test: (t) => (has(t, 'termin', 'meeting', 'call', 'gespraech', 'kalender', 'buchung') ? 3 : 0),
    run: async () => {
      const now = new Date();
      const { data } = await db().from('lr_bookings').select('name, company, starts_at, status').in('status', ['angefragt', 'bestaetigt']).gte('ends_at', iso(now)).order('starts_at').limit(20);
      const open = (data ?? []).filter((b) => b.status === 'angefragt'), next = (data ?? []).filter((b) => b.status === 'bestaetigt');
      const when = (s: string) => new Date(s).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      return { reply: `${open.length ? `${n(open.length, 'Anfrage wartet', 'Anfragen warten')} auf Annahme. ` : 'Keine offenen Terminanfragen. '}${next.length ? `Nächster Termin: ${when(next[0].starts_at)} mit ${next[0].name}${next[0].company ? ` (${next[0].company})` : ''}.` : 'Kein bestätigter Termin in Sicht.'}`, actions: [{ id: 'open', label: 'Termine öffnen', tab: 'termine', sg: 'system' }] };
    },
  },
  {
    id: 'tickets', agent: 'support', label: 'Support-Tickets',
    test: (t) => (has(t, 'ticket', 'support', 'problem', 'beschwerde', 'hilfe anfrag') ? 3 : 0),
    run: async () => {
      const { data } = await db().from('lr_support_tickets').select('no, title, severity, status, due_at').not('status', 'in', '(erledigt,geschlossen,resolved,closed)').order('created_at', { ascending: false }).limit(20);
      const l = data ?? [];
      return { reply: l.length ? `${n(l.length, 'offenes Ticket', 'offene Tickets')}. Zuletzt: #${l[0].no} ${l[0].title}.` : 'Keine offenen Support-Tickets.', actions: l.length ? [{ id: 'open', label: 'Tickets öffnen', tab: 'probleme' }] : [] };
    },
  },
  {
    id: 'fehler', agent: 'support', label: 'Website-Fehler',
    test: (t) => (has(t, 'fehler', 'error', 'bug', 'kaputt', 'absturz', 'crash') ? 3 : 0),
    run: async () => {
      const { data } = await db().from('lr_client_errors').select('message, page, count, last_seen').is('resolved_at', null).order('last_seen', { ascending: false }).limit(10);
      const l = data ?? [];
      return { reply: l.length ? `${n(l.length, 'offener Fehler', 'offene Fehler')} auf der Website. Häufigster zuletzt: „${String(l[0].message).slice(0, 90)}“ auf ${l[0].page || '–'}.` : 'Keine offenen Fehler auf der Website.', actions: l.length ? [{ id: 'open', label: 'Technische Probleme', tab: 'probleme' }] : [] };
    },
  },
  {
    id: 'sicherheit', agent: 'sicherheit', label: 'Sicherheitslage',
    test: (t) => (has(t, 'angriff', 'hacker', 'sicherheit', 'attack', 'gesperrt', 'sperre', 'bot', 'ddos', 'einbruch') ? 3 : 0),
    run: async () => {
      const since = iso(new Date(Date.now() - DAY));
      const [{ data: ev }, blocks] = await Promise.all([
        db().from('lr_security_log').select('kind').gte('created_at', since).limit(5000),
        count(db().from('lr_security_blocks').select('ip_hash', { count: 'exact', head: true }).gt('until', iso(new Date()))),
      ]);
      const by: Record<string, number> = {}; for (const e of ev ?? []) by[e.kind] = (by[e.kind] || 0) + 1;
      const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}×`).join(', ');
      return { reply: `Letzte 24 Std.: ${n((ev ?? []).length, 'Sicherheitsereignis', 'Sicherheitsereignisse')}${top ? ` (${top})` : ''}. ${n(blocks, 'Quelle ist', 'Quellen sind')} gerade gesperrt.`, actions: [{ id: 'open', label: 'Sicherheit öffnen', tab: 'sicherheit', sg: 'system' }] };
    },
  },
  {
    id: 'creator', agent: 'creator', label: 'Creator',
    test: (t) => (has(t, 'creator', 'influencer', 'bewerbung', 'partnerprogramm') ? 3 : 0),
    run: async () => {
      const { data } = await db().from('lr_creators').select('status, display_name, submitted_at');
      const l = data ?? [], wait = l.filter((c) => /submit|pending|review|eingereicht/i.test(String(c.status)));
      return { reply: `${n(l.length, 'Creator', 'Creator')} insgesamt, ${n(l.filter((c) => /active/i.test(String(c.status))).length, 'aktiv', 'aktiv')}. ${wait.length ? `${n(wait.length, 'Bewerbung wartet', 'Bewerbungen warten')} auf Prüfung.` : 'Keine Bewerbung wartet.'}`, actions: [{ id: 'open', label: 'Creator Operations', tab: 'creator', sg: 'b2b' }] };
    },
  },
  {
    id: 'newsletter', agent: 'vertrieb', label: 'Newsletter',
    test: (t) => (has(t, 'newsletter', 'abonnent', 'verteiler') ? 3 : 0),
    run: async () => {
      const [ok, all] = await Promise.all([
        count(db().from('lr_newsletter').select('id', { count: 'exact', head: true }).not('confirmed_at', 'is', null).is('unsubscribed_at', null)),
        count(db().from('lr_newsletter').select('id', { count: 'exact', head: true })),
      ]);
      return { reply: `${n(ok, 'bestätigter Abonnent', 'bestätigte Abonnenten')} (von ${all.toLocaleString('de-DE')} Eintragungen). Versand nur über dich in Werbung.`, actions: [{ id: 'open', label: 'Werbung öffnen', tab: 'werbung' }] };
    },
  },
  {
    id: 'akquise', agent: 'vertrieb', label: 'Akquise & Kontakte',
    test: (t) => (has(t, 'akquise', 'kontakt', 'lead', 'crm', 'wiedervorlage', 'nachfass', 'follow') ? 3 : 0),
    run: async () => {
      const { data } = await db().from('lr_crm_contacts').select('status, next_at, company');
      const l = data ?? [], due = l.filter((c) => c.next_at && new Date(c.next_at) <= new Date());
      const by: Record<string, number> = {}; for (const c of l) by[c.status || 'ohne'] = (by[c.status || 'ohne'] || 0) + 1;
      return { reply: `${n(l.length, 'Kontakt', 'Kontakte')} in der Akquise (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || '–'}). ${due.length ? `${n(due.length, 'Wiedervorlage ist', 'Wiedervorlagen sind')} fällig, z. B. ${due[0].company}.` : 'Keine Wiedervorlage fällig.'}`, actions: [{ id: 'open', label: 'Akquise öffnen', tab: 'akquise', sg: 'b2b' }] };
    },
  },
  {
    id: 'marketing', agent: 'marketing', label: 'Marketing & Reichweite',
    test: (t) => (has(t, 'marketing', 'kampagne', 'social', 'linkedin', 'instagram', 'werbung', 'wachstum', 'mehr besucher', 'mehr kunden', 'sichtbarkeit', 'content', 'beitrag', 'posting') || (has(t, 'idee', 'ideen', 'vorschlag', 'vorschlaege') && !has(t, 'feedback', 'bewertung')) ? 4 : 0),
    run: async (t) => {
      const { loadMarketing, marketingDraft, marketingIdeas, marketingSources, runMarketing } = await import('@/lib/admin/marketing');
      const r = (await loadMarketing()) || (await runMarketing(7));
      if (has(t, 'linkedin', 'beitrag', 'posting')) return { reply: marketingDraft(r, 'linkedin') };
      if (has(t, 'instagram', 'reel', 'story')) return { reply: marketingDraft(r, 'instagram') };
      if (has(t, 'woher', 'quelle', 'kanal')) return { reply: marketingSources(r) };
      return { reply: marketingIdeas(r), actions: [{ id: 'open', label: 'Analyse öffnen', tab: 'analyse', sg: 'b2c' }] };
    },
  },
  {
    id: 'feedback', agent: 'support', label: 'Vorschläge & Bewertungen',
    test: (t) => (has(t, 'vorschlag', 'feedback', 'idee', 'wunsch', 'bewertung', 'review') ? 3 : 0),
    run: async () => {
      const { data } = await db().from('lr_feedback').select('topic, status, created_at').order('created_at', { ascending: false }).limit(50);
      const l = data ?? [], neu = l.filter((f) => !f.status || /neu|new|offen/i.test(String(f.status)));
      return { reply: neu.length ? `${n(neu.length, 'neuer Vorschlag', 'neue Vorschläge')}, zuletzt: „${String(neu[0].topic).slice(0, 80)}“.` : `Keine neuen Vorschläge (${n(l.length, 'Vorschlag', 'Vorschläge')} insgesamt).`, actions: [{ id: 'open', label: 'Vorschläge öffnen', tab: 'vorschlaege' }] };
    },
  },
  {
    id: 'kaeufe', agent: 'finanzen', label: 'Käufe & Abos',
    test: (t) => (has(t, 'kauf', 'kaeufe', 'verkauf', 'bestellung', 'abo', 'abonnement', 'checkout', 'conversion') ? 3 : 0),
    run: async (t) => {
      const r = range(t, 30);
      const [{ data: k }, { data: ev }, abo] = await Promise.all([
        db().from('lr_kaeufe').select('plan, betrag, erstattet_at').gte('created_at', iso(r.from)),
        db().from('lr_analytics').select('ev, visitor').in('ev', ['checkout_open', 'checkout_start']).gte('ts', iso(r.from)).limit(20000),
        count(db().from('lr_entitlements').select('user_id', { count: 'exact', head: true }).eq('status', 'active')),
      ]);
      const opened = new Set((ev ?? []).filter((e) => e.ev === 'checkout_open').map((e) => e.visitor)).size;
      const bought = (k ?? []).filter((x) => !x.erstattet_at).length;
      return { reply: `${r.label[0].toUpperCase()}${r.label.slice(1)}: ${n(bought, 'Kauf', 'Käufe')} bei ${n(opened, 'Besucher', 'Besuchern')} mit geöffnetem Kauf-Dialog${opened ? ` (${Math.round((bought / opened) * 100)} %)` : ''}. ${n(abo, 'aktives Abo', 'aktive Abos')}.`, actions: [{ id: 'open', label: 'Analyse öffnen', tab: 'analyse', sg: 'b2c' }] };
    },
  },
  {
    id: 'suche', agent: 'support', label: 'Person oder Firma suchen',
    test: (t) => (/(^|\s)(suche|such|finde|wer ist|zeig mir|info zu|infos zu)\s+\S/.test(t) || /@/.test(t) ? 4 : 0),
    run: async (_t, raw) => {
      const q = raw.replace(/^.*?(suche nach|suche|such|finde|wer ist|zeig mir|infos? zu)\s+/i, '').replace(/[%,()'"*\\]/g, ' ').trim().slice(0, 60);
      if (q.length < 2) return { reply: 'Nach wem soll ich suchen? Zum Beispiel: „Suche Müller GmbH“ oder eine E-Mail-Adresse.' };
      const like = `%${q}%`;
      const [c, a, m, b] = await Promise.all([
        db().from('lr_crm_contacts').select('company, contact_name, email, status').or(`company.ilike.${like},contact_name.ilike.${like},email.ilike.${like}`).limit(3),
        db().from('lr_b2b_accounts').select('company_name, email, plan_tier, status').or(`company_name.ilike.${like},email.ilike.${like}`).limit(3),
        db().from('lr_mail_messages').select('subject, direction, from_email, to_emails, created_at').or(`from_email.ilike.${like},subject.ilike.${like},from_name.ilike.${like}`).order('created_at', { ascending: false }).limit(3),
        db().from('lr_bookings').select('name, company, starts_at, status').or(`name.ilike.${like},company.ilike.${like},email.ilike.${like}`).limit(3),
      ]);
      const parts: string[] = [];
      if (c.data?.length) parts.push(`Akquise: ${c.data.map((x) => `${x.company}${x.contact_name ? ` (${x.contact_name})` : ''} – ${x.status}`).join('; ')}`);
      if (a.data?.length) parts.push(`Unternehmenskonto: ${a.data.map((x) => `${x.company_name} – ${x.plan_tier || 'ohne Tarif'}, ${x.status}`).join('; ')}`);
      if (m.data?.length) parts.push(`E-Mails: ${m.data.map((x) => `„${String(x.subject || '').slice(0, 50)}“`).join('; ')}`);
      if (b.data?.length) parts.push(`Termine: ${b.data.map((x) => `${x.name} ${new Date(x.starts_at).toLocaleDateString('de-DE')} (${x.status})`).join('; ')}`);
      return { reply: parts.length ? `Zu „${q}“ gefunden – ${parts.join(' · ')}.` : `Zu „${q}“ habe ich nichts gefunden.` };
    },
  },
];

const HELP = 'Frag mich einfach, z. B.: „Umsatz diesen Monat“, „Wie viele Besucher heute?“, „Neue Nutzer diese Woche“, „Offene Termine“, „Gibt es Angriffe?“, „Fehler auf der Website“, „Suche Müller GmbH“, „Wiedervorlagen fällig?“, „Marketing-Ideen“, „Woher kommen die Besucher?“ – oder tippe einen der Aufträge unten.';

// Beste Fähigkeit für eine Frage – Bonus, wenn sie zum angesprochenen Agenten gehört.
export function understand(text: string, agent?: string): Intent | null {
  const t = norm(text);
  let best: Intent | null = null, score = 0;
  for (const i of INTENTS) { const s = i.test(t) + (i.agent === agent ? 0.5 : 0); if (s > score && s >= 3) { best = i; score = s; } }
  return best;
}

// Alle passenden Fähigkeiten, beste zuerst (für Fragen mit mehreren Teilen: „Umsatz und Besucher heute“).
export function understandAll(text: string, agent?: string): Intent[] {
  const t = norm(text);
  return INTENTS.map((i) => ({ i, s: i.test(t) + (i.agent === agent ? 0.5 : 0) })).filter((x) => x.s >= 3).sort((a, b) => b.s - a.s).map((x) => x.i);
}

export async function ask(text: string, agent?: string): Promise<BrainAnswer | null> {
  const t = norm(text);
  if (/^(hilfe|help|was kannst du|\?|befehle)/.test(t)) return { reply: HELP, agent: agent || 'briefing', intent: 'hilfe' };
  const all = understandAll(text, agent);
  if (!all.length) return null;
  // Mehrteilige Frage („… und …“, Komma): bis zu drei Fähigkeiten antworten nacheinander in einer Antwort.
  const multi = /(\s|,)(und|sowie|plus|ausserdem)\s|,/.test(t) ? all.slice(0, 3) : all.slice(0, 1);
  const out: Omit<BrainAnswer, 'agent' | 'intent'>[] = await Promise.all(multi.map((i) => i.run(t, text).catch((e): Omit<BrainAnswer, 'agent' | 'intent'> => ({ reply: `${i.label}: gerade nicht abrufbar (${(e as Error).message || 'Fehler'}).` }))));
  if (out.length === 1) return { ...out[0], agent: multi[0].agent, intent: multi[0].id };
  return { reply: out.map((r, k) => `${multi[k].label}: ${r.reply}`).join('\n\n'), actions: out.flatMap((r) => r.actions || []).filter((a, k, arr) => arr.findIndex((b) => b.tab === a.tab && b.sg === a.sg) === k).slice(0, 3), agent: multi[0].agent, intent: multi.map((i) => i.id).join('+') };
}
export const BRAIN_HELP = HELP;
