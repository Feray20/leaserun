import { supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { buildOverview, type Overview } from '@/lib/admin/app-overview';
import { analyse, applyFixes, liveChecksCached } from '@/lib/admin/fixer';
import { webhookSelfTest } from '@/lib/admin/livecheck';
import { syncReceivedDetailed } from '@/lib/mail/ingest';
import { ask, BRAIN_HELP } from '@/lib/admin/hq-brain';
import { loadOptimizer, runOptimizer, type OptReport } from '@/lib/admin/optimizer';
import { kundenReport, loadKundenReport, type KReport } from '@/lib/admin/kundenreise';
import { recallText, remember, situation, trend, trendText, type AgentView, type Issue } from '@/lib/admin/hq-intel';
import { befundKey, kasseKennzahl, KASSE_MELDER } from '@/lib/admin/kasse-kennzahl';
import { loadMarketing, marketingDraft, marketingIdeas, marketingPages, marketingSources, marketingSummary, runMarketing, type MReport } from '@/lib/admin/marketing';
import { AGENT_IDS, AGENT_NAMES, type AgentId } from '@/lib/admin/hq-agents';
import { loadMemory, loadShift, saveMemory, saveShift, type AgentAction, type AgentRun } from '@/lib/admin/hq-store';
import { analyseRun, askAgent, dailyThink, DAILY_AGENTS, loadReview, runReviewBatch, startReview } from '@/lib/admin/hq-think';
import { gate } from '@/lib/admin/hq-ai';
import { serviceLinks } from '@/lib/admin/hq-links';
import { classifyWaitingDrafts, loadLegalSummary } from '@/lib/mail/legal-gate';

// LeaseRun HEADQUARTERS · digitale Mitarbeiter. Jeder Mitarbeiter ist ein echter Automatik-Job, der eine Aufgabe für
// LeaseRun erledigt. Alle laufen parallel. Ergebnis je Mitarbeiter: ein Satz, ein Status und – wo nötig – ein Knopf.
// Sicher erledigt wird automatisch nur Internes (E-Mails abholen, Angreifer sperren, Ereignisse abhaken, prüfen).
// Alles, was nach außen geht (z. B. Zahlungserinnerungen an Kunden), braucht einen Knopfdruck der Gründerin.
export type { AgentAction, AgentRun } from '@/lib/admin/hq-store';
export { AGENT_IDS, type AgentId } from '@/lib/admin/hq-agents';
export { loadShift } from '@/lib/admin/hq-store';
type Out = Omit<AgentRun, 'id' | 'at' | 'ms' | 'ai' | 'aiQueue'>;
const H = 3_600_000, D = 24 * H;
const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
const ago = (t: string | null | undefined) => {
  if (!t) return 'noch nie';
  const h = Math.round((Date.now() - new Date(t).getTime()) / H);
  return h < 1 ? 'vor weniger als einer Stunde' : h < 48 ? `vor ${h} Std.` : `vor ${Math.round(h / 24)} Tagen`;
};
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} dauert zu lange`)), ms))]);

type Ctx = { actor: string; origin: string; overview: () => Promise<Overview>; prev: Record<string, AgentRun>; force: boolean; views?: AgentView[] };

const optIssues = (r: OptReport): Issue[] => r.findings.filter((f) => f.level !== 'niedrig').slice(0, 30).map((f) => ({ id: `opt:${f.id}`, level: f.level, title: f.title, customer: f.area === 'Links' || f.area === 'Darstellung' }));
const optLine = (r: OptReport): Out => ({ ...optLine0(r), issues: optIssues(r), metrics: { funde: r.findings.length, wichtig: r.findings.filter((f) => f.level === 'hoch').length } });
const optLine0 = (r: OptReport): Out => {
  const hi = r.findings.filter((f) => f.level === 'hoch').length;
  const done = r.fixed.length ? ` Selbst erledigt: ${r.fixed.join(' · ')}.` : '';
  const disp = r.display ? ` Darstellung im Browser geprüft ${new Date(r.display.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (${r.display.pages} Seiten, Handy und Computer).` : ' Darstellungsprüfung im Browser noch nicht gelaufen.';
  if (!r.findings.length) return { status: 'ok', line: `${r.pages} Seiten geprüft – nichts zu verbessern.${done}${disp}` };
  return { status: hi ? 'todo' : 'ok', line: `${r.pages} Seiten geprüft: ${r.findings.length} Verbesserung${r.findings.length === 1 ? '' : 'en'} gefunden${hi ? `, ${hi} wichtig` : ''} – oben: ${r.findings[0].title}.${done}${disp}`, actions: [{ id: 'opt', label: 'Vorschläge ansehen' }] };
};
const RUN: Record<AgentId, (c: Ctx) => Promise<Out>> = {
  // Noah Sullivan · Optimierung: prüft selbstständig Website und System, erledigt Internes selbst, schlägt den Rest vor.
  async optimierung(c) {
    const last = await loadOptimizer();
    if (!c.force && last && Date.now() - new Date(last.at).getTime() < 6 * H) return optLine(last);
    return optLine(await runOptimizer(c.origin));
  },
  // Sophie Turner · Marketing: liest Reichweite, Quellen, Kasse und Newsletter und macht begründete Vorschläge; entwirft
  // Newsletter- und Beitragstexte als Vorlage. Veröffentlicht und sendet nie selbst (höchstens alle 6 Std. neu gerechnet).
  async marketing(c) {
    const last = await loadMarketing();
    const r: MReport = !c.force && last && Date.now() - new Date(last.at).getTime() < 6 * H ? last : await runMarketing(7);
    const issues: Issue[] = r.findings.filter((f) => f.level !== 'niedrig').map((f) => ({ id: `mkt:${f.id}`, level: f.level, title: f.title, customer: /kaufen|Kasse|Preise/.test(f.title) }));
    const metrics = { besucher: r.visitors, aufrufe: r.views, kasse_rate: r.funnel.rate, abonnenten: r.newsletter.confirmed };
    const hi = r.findings.filter((f) => f.level === 'hoch');
    const line = `${marketingSummary(r)}${r.findings.length ? ` ${n(r.findings.length, 'Vorschlag', 'Vorschläge')}${hi.length ? `, ${hi.length} wichtig` : ''} – oben: ${r.findings[0].title}.` : ' Nichts Auffälliges.'} ${n(r.drafts.length, 'Entwurf liegt', 'Entwürfe liegen')} bereit – nichts geht ohne dich raus.`;
    return { status: hi.length ? 'todo' : 'ok', line, actions: [{ id: 'ask', label: 'Marketing-Ideen', q: 'Marketing-Ideen' }, { id: 'open', label: 'Analyse öffnen', tab: 'analyse', sg: 'b2c' }], issues, metrics };
  },
  // Emily Carter · Postfach: holt neue E-Mails bei Resend ab.
  async postfach() {
    const db = supabaseAdmin();
    const st = await syncReceivedDetailed(50);
    if (!st.ok) return { status: 'error', line: st.error || 'E-Mails konnten nicht abgeholt werden.', actions: [{ id: 'open', label: 'Postfach öffnen', tab: 'postfach' }], issues: [{ id: 'mail:sync', level: 'hoch', title: 'E-Mails können nicht abgeholt werden' }] };
    const [{ data: last }, { data: unread }] = await Promise.all([
      db.from('lr_mail_messages').select('received_at').eq('direction', 'in').order('received_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('lr_mail_messages').select('id, subject, text_body, received_at').eq('direction', 'in').eq('folder', 'inbox').is('read_at', null).gte('received_at', new Date(Date.now() - 30 * D).toISOString()).limit(100),
    ]);
    const lastAt = (last?.received_at as string | undefined) || null;
    // Ungelesene Mails nach Dringlichkeit einordnen (feste Regeln): gesetzliche Fristen zuerst.
    const RULES: [RegExp, string, string][] = [
      [/widerruf/i, 'Widerruf', 'Erstattung binnen 14 Tagen nach Eingang (§ 357 BGB)'], [/k[üu]ndig/i, 'Kündigung', 'Kündigung zeitnah bestätigen'],
      [/dsgvo|datenschutz|auskunft|l[öo]sch(ung|en)|art\.? ?15|art\.? ?17/i, 'Datenschutz-Anfrage', 'Antwort spätestens binnen eines Monats (Art. 12 DSGVO)'],
      [/anwalt|abmahn|rechtsanw|klage|gericht/i, 'Rechtliches', 'sofort ansehen, Fristen im Schreiben beachten'], [/mahnung|zahlungserinnerung|inkasso/i, 'Mahnung', 'Zahlung prüfen'],
      [/beschwerde|reklamation|funktioniert nicht|fehler|geht nicht|kaputt|abgebucht|nicht freigeschaltet/i, 'Kundenproblem', 'Kunde wartet auf Hilfe'],
    ];
    const issues: Issue[] = [], urgent: string[] = [];
    for (const m of unread ?? []) {
      const t = `${m.subject || ''} ${(m.text_body || '').slice(0, 2000)}`;
      const r = RULES.find(([re]) => re.test(t));
      if (!r) continue;
      const age = Math.floor((Date.now() - new Date(m.received_at as string).getTime()) / D);
      issues.push({ id: `mail:${m.id}`, level: r[1] === 'Kundenproblem' && age < 1 ? 'mittel' : 'hoch', title: `${r[1]} ungelesen${age ? ` seit ${age} Tag${age === 1 ? '' : 'en'}` : ''}: „${String(m.subject || '(ohne Betreff)').slice(0, 50)}“`, customer: true });
      urgent.push(`${r[1]} (${r[2]})`);
    }
    const metrics = { ungelesen: (unread ?? []).length, neu: st.fetched || 0 };
    const pre = urgent.length ? `Zuerst lesen: ${[...new Set(urgent)].slice(0, 2).join(' · ')}. ` : '';
    if (st.fetched) return { status: 'todo', line: `${pre}${n(st.fetched, 'neue E-Mail', 'neue E-Mails')} abgeholt und ins Postfach gelegt.`, actions: [{ id: 'open', label: 'Lesen', tab: 'postfach' }], issues, metrics };
    if (!st.listed) return { status: 'todo', line: `${pre}Bei Resend ist keine einzige Mail angekommen (letzte Mail im Postfach: ${ago(lastAt)}). Resend erreicht keine Post – in Resend → Domains → leaserun.com prüfen, ob alles „Verified“ ist.`, issues: [...issues, { id: 'mail:resend-none', level: 'hoch', title: 'Bei Resend kommt keine Post an' }], metrics };
    if (issues.length) return { status: 'todo', line: `${pre}${n((unread ?? []).length, 'ungelesene E-Mail', 'ungelesene E-Mails')} im Posteingang.`, actions: [{ id: 'open', label: 'Lesen', tab: 'postfach' }], issues, metrics };
    if (!lastAt || Date.now() - new Date(lastAt).getTime() > 2 * D) return { status: 'ok', line: `Postfach ist aktuell. Letzte eingegangene Mail: ${ago(lastAt)}.`, metrics };
    return { status: 'ok', line: 'Postfach ist aktuell – keine neuen E-Mails.', metrics };
  },
  // Jake Morrison · Sicherheit: prüft und erledigt sichere Punkte selbst (Angreifer sperren, abgewehrte Ereignisse abhaken).
  async sicherheit(c) {
    const r = await applyFixes(c.actor, { all: true, areas: ['Sicherheit'], origin: c.origin });
    const done = r.results.filter((x) => x.ok).map((x) => x.text.replace(/ ✓$/, ''));
    const left = r.findings.filter((f) => f.area === 'Sicherheit');
    const issues: Issue[] = left.map((f) => ({ id: `sec:${f.id}`, level: f.sev === 'critical' ? 'hoch' : f.sev === 'warning' ? 'mittel' : 'niedrig', title: f.title }));
    const metrics = { offen: left.length, erledigt: done.length };
    if (left.length) return { status: 'todo', line: `${done.length ? `Erledigt: ${done.join(' · ')}. ` : ''}Braucht dich: ${left[0].title}${left[0].how ? ` – ${left[0].how}` : ''}`, actions: [{ id: 'open', label: 'Ansehen', tab: 'hq' }], issues, metrics };
    return { status: 'ok', line: done.length ? `Erledigt: ${done.join(' · ')}.` : 'Alles sicher – keine Angriffe offen.', metrics };
  },
  // Olivia Brooks · Technik: prüft Stripe, Webhooks, E-Mail-Domain, DNS und Datenbank live (höchstens alle 30 Minuten).
  async technik(c) {
    // Dieselbe (zwischengespeicherte) Live-Prüfung wie „Prüfen & erledigen“ – keine doppelte Abfrage bei Stripe & Co.
    const checks = await liveChecksCached(c.origin, c.force);
    const bad = checks.filter((x) => x.state === 'fail'), warn = checks.filter((x) => x.state === 'warn');
    const issues: Issue[] = [...bad.map((x) => ({ id: `tech:${x.id}`, level: 'hoch' as const, title: `${x.label}: ${x.info}`.slice(0, 120), customer: /stripe|zahlung|webhook|auth|anmeld/i.test(x.label) })), ...warn.map((x) => ({ id: `tech:${x.id}`, level: 'niedrig' as const, title: `${x.label}: ${x.info}`.slice(0, 120) }))];
    const metrics = { stoerungen: bad.length, hinweise: warn.length };
    if (bad.length) return { status: 'todo', line: `${n(bad.length, 'Störung', 'Störungen')}: ${bad.slice(0, 2).map((x) => `${x.label} – ${x.info}`).join(' · ')}`, actions: [{ id: 'open', label: 'Prüfung ansehen', tab: 'hq' }], issues, metrics };
    return { status: 'ok', line: `${n(checks.length - warn.length, 'Prüfung', 'Prüfungen')} in Ordnung${warn.length ? ` · ${n(warn.length, 'Hinweis', 'Hinweise')}: ${warn[0].label}` : ''}.`, issues, metrics };
  },
  // Ryan Mitchell · Finanzen: findet überfällige Unternehmensrechnungen; Erinnerungen gehen erst nach Knopfdruck raus.
  async finanzen() {
    const db = supabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const { data: open } = await db.from('lr_invoices').select('id, invoice_number, due_date').in('payment_status', ['PENDING', 'OVERDUE']).eq('kind', 'invoice').not('account_id', 'is', null).lt('due_date', today).limit(200);
    const rows = open ?? [];
    if (!rows.length) return { status: 'ok', line: 'Keine überfälligen Rechnungen.' };
    const { data: sent } = await db.from('lr_admin_audit').select('target').eq('action', 'invoice_remind').in('target', rows.map((x) => x.id)).gte('created_at', new Date(Date.now() - 7 * D).toISOString());
    const recent = new Set((sent ?? []).map((x) => x.target));
    const due = rows.filter((x) => !recent.has(x.id));
    if (!due.length) return { status: 'ok', line: `${n(rows.length, 'Rechnung ist', 'Rechnungen sind')} überfällig – Erinnerung wurde in den letzten 7 Tagen schon gesendet.` };
    const od = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / D);
    const issues: Issue[] = due.map((x) => ({ id: `inv:${x.id}`, level: od(x.due_date as string) > 14 ? 'hoch' : 'mittel', title: `Rechnung ${x.invoice_number} seit ${od(x.due_date as string)} Tagen überfällig` }));
    return { issues, metrics: { ueberfaellig: rows.length }, status: 'todo', line: `${n(due.length, 'Rechnung ist', 'Rechnungen sind')} überfällig und ${due.length === 1 ? 'wartet' : 'warten'} auf eine Zahlungserinnerung.`, actions: [{ id: 'remind', label: `Erinnerung${due.length === 1 ? '' : 'en'} senden (${due.length})`, confirm: `Jetzt ${n(due.length, 'Zahlungserinnerung', 'Zahlungserinnerungen')} an die Kunden senden?`, ids: due.map((x) => x.id) }, { id: 'open', label: 'Ansehen', tab: 'cockpit', sg: 'b2b' }] };
  },
  // Madison Hayes · Vertrieb: neue Anfragen und Unternehmen, die auf Freigabe warten.
  async vertrieb(c) {
    const o = await c.overview();
    const req = o.metrics.find((m) => m.key === 'requests')?.value || 0;
    const ver = o.alerts.filter((a) => a.target === 'unternehmen' && a.attention);
    const parts: string[] = [], actions: AgentAction[] = [];
    if (req) { parts.push(`${n(req, 'neue Anfrage wartet', 'neue Anfragen warten')} auf Antwort`); actions.push({ id: 'open', label: 'Anfragen öffnen', tab: 'anfragen', sg: 'b2b' }); }
    if (ver.length) { parts.push(ver.map((a) => a.title).join(' · ')); actions.push({ id: 'open2', label: 'Unternehmen prüfen', tab: 'partner', sg: 'b2b' }); }
    return parts.length ? { status: 'todo', line: `${parts.join(' · ')}.`, actions } : { status: 'ok', line: 'Keine offenen Anfragen.' };
  },
  // Tyler Reed · Support: Fehler auf der Website und Webhook-Störungen.
  async support(c) {
    // Tyler · Kundenreise: Fehler, die Kunden gesehen haben, Formular- und Kassenprobleme, Abbrüche (lib/admin/kundenreise.ts).
    const last = await loadKundenReport();
    const r: KReport = !c.force && last && Date.now() - new Date(last.at).getTime() < 10 * 60_000 ? last : await kundenReport();
    const o = await c.overview();
    const hook = o.alerts.find((x) => x.attention && x.id === 'b2b-webhook');
    const issues: Issue[] = r.issues.map((i) => ({ id: i.id, level: i.level, title: i.title, customer: i.customer }));
    if (hook) issues.push({ id: 'b2b-webhook', level: 'mittel', title: `${hook.title}: ${hook.detail}`.slice(0, 120) });
    const cust = r.issues.filter((i) => i.customer && i.level !== 'niedrig');
    const co = r.checkout, fu = r.funnel;
    const kasse = co && co.total ? ` Kasse (3 Tage): ${co.total} geöffnet, ${co.complete} bezahlt${co.expired + co.open ? `, ${co.expired + co.open} ohne Kauf` : ''}${co.declined ? `, ${co.declined} abgelehnt` : ''}.` : '';
    const metrics: Record<string, number> = { kundenfehler: cust.length, ...(co ? { kasse_offen: co.total, kasse_bezahlt: co.complete } : {}), ...(fu ? { kassenstarts: fu.start } : {}) };
    const done = r.fixed.length ? ` Selbst erledigt: ${r.fixed.join(' · ')}.` : '';
    if (cust.length || hook) return { status: 'todo', line: `${n(cust.length, 'Kundenproblem', 'Kundenprobleme')} – zuerst: ${cust[0]?.title || hook?.title}.${kasse}${done}`, actions: [{ id: 'ask', label: 'Probleme & Lösungen', q: 'Kundenprobleme zeigen' }], issues, metrics };
    return { status: 'ok', line: `Kein Kunde ist auf einen Fehler gestoßen.${kasse}${done}`, issues, metrics };
  },
  // Ava Bennett · Freigaben: sammelt alles, was nach außen gehen würde und auf Ferays Freigabe wartet. Sendet selbst nie etwas.
  // Entwürfe meldet sie nur, wenn seit der letzten Meldung neue dazugekommen sind (6 Std. sichtbar) oder welche älter als
  // 14 Tage sind – sonst bleibt die Zeile „ok“ (die gleichen wartenden Entwürfe lösen nicht jede Schicht dieselbe Meldung aus).
  async freigaben(c) {
    const db = supabaseAdmin(), now = new Date().toISOString(), today = now.slice(0, 10);
    const pm = c.prev.freigaben?.metrics || {}, draftQ = () => db.from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf');
    const rv = await loadReview().catch(() => null);
    const rvLine = rv?.active ? `Überarbeite gerade die Entwürfe: ${rv.done.length} von ${rv.total} geprüft, ${rv.changed} verbessert (läuft im Hintergrund weiter). ` : rv && Date.now() - new Date(rv.started).getTime() < 2 * D ? `Entwürfe überarbeitet: ${rv.done.length} geprüft, ${rv.changed} verbessert – Originale gesichert. ` : '';
    const [drafts, newest, stale, books, inv, crea] = await Promise.all([
      draftQ(),
      db.from('lr_mail_messages').select('created_at').eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      draftQ().lt('created_at', new Date(Date.now() - 14 * D).toISOString()),
      db.from('lr_bookings').select('id', { count: 'exact', head: true }).eq('status', 'angefragt').gte('starts_at', now),
      db.from('lr_invoices').select('id', { count: 'exact', head: true }).in('payment_status', ['PENDING', 'OVERDUE']).eq('kind', 'invoice').not('account_id', 'is', null).lt('due_date', today),
      db.from('lr_creators').select('id', { count: 'exact', head: true }).in('status', ['SUBMITTED', 'UNDER_REVIEW']),
    ]);
    // Stand = Erstellzeit des neuesten bereits gemeldeten Entwurfs. Ohne früheren Stand (erste Runde) gilt der heutige als gemeldet.
    const top = newest.data?.created_at ? new Date(newest.data.created_at as string).getTime() : 0;
    const stand = typeof pm.entwurf_stand === 'number' ? pm.entwurf_stand : top;
    const fresh = top > stand ? (await draftQ().gt('created_at', new Date(stand).toISOString())).count || 0 : 0;
    const still = Date.now() < (pm.entwurf_neu_bis || 0) ? pm.entwurf_neu || 0 : 0;
    const neu = Math.min(drafts.count || 0, fresh + still), old = stale.count || 0;
    const dm = { entwurf_stand: Math.max(stand, top), entwurf_neu: neu, entwurf_neu_bis: fresh ? Date.now() + 6 * H : neu ? pm.entwurf_neu_bis || 0 : 0, entwuerfe: drafts.count || 0, entwuerfe_veraltet: old };
    const parts: string[] = [], actions: AgentAction[] = [];
    if (drafts.count) actions.push({ id: 'open', label: 'Entwürfe prüfen', tab: 'postfach' });
    if (neu) parts.push(`${n(neu, 'neuer E-Mail-Entwurf', 'neue E-Mail-Entwürfe')} seit der letzten Meldung (insgesamt ${drafts.count} bereit)`);
    if (old) parts.push(`${n(old, 'Entwurf ist', 'Entwürfe sind')} älter als 14 Tage – veraltet, archivieren?`);
    if (books.count) { parts.push(`${n(books.count, 'Terminanfrage', 'Terminanfragen')} zum Bestätigen`); actions.push({ id: 'open2', label: 'Termine öffnen', tab: 'termine' }); }
    const soon = books.count ? (await db.from('lr_bookings').select('id', { count: 'exact', head: true }).eq('status', 'angefragt').gte('starts_at', now).lt('starts_at', new Date(Date.now() + D).toISOString())).count || 0 : 0;
    if (soon) parts.unshift(`Dringend: ${n(soon, 'Termin beginnt', 'Termine beginnen')} in weniger als 24 Std. und ${soon === 1 ? 'ist' : 'sind'} noch nicht bestätigt`);
    const issues: Issue[] = [
      ...(soon ? [{ id: 'frei:termin24', level: 'hoch' as const, title: `${n(soon, 'Termin', 'Termine')} in unter 24 Std. unbestätigt`, customer: true }] : []),
      ...(neu ? [{ id: 'frei:entwurf', level: 'mittel' as const, title: `${n(neu, 'neuer E-Mail-Entwurf', 'neue E-Mail-Entwürfe')} zur Freigabe` }] : []),
      ...(old ? [{ id: 'frei:veraltet', level: 'niedrig' as const, title: `${n(old, 'Entwurf', 'Entwürfe')} älter als 14 Tage – archivieren?` }] : []),
      ...(books.count && books.count > soon ? [{ id: 'frei:termin', level: 'mittel' as const, title: `${n(books.count, 'Terminanfrage', 'Terminanfragen')} zum Bestätigen`, customer: true }] : []),
      ...(crea.count ? [{ id: 'frei:creator', level: 'niedrig' as const, title: `${n(crea.count, 'Creator-Bewerbung', 'Creator-Bewerbungen')} zur Entscheidung` }] : []),
    ];
    if (inv.count) { parts.push(`${n(inv.count, 'Zahlungserinnerung', 'Zahlungserinnerungen')} vorbereitet`); actions.push({ id: 'open3', label: 'Rechnungen öffnen', tab: 'rechnungen', sg: 'b2b' }); }
    if (crea.count) { parts.push(`${n(crea.count, 'Creator-Bewerbung', 'Creator-Bewerbungen')} zur Entscheidung`); actions.push({ id: 'open4', label: 'Creator öffnen', tab: 'creator', sg: 'b2b' }); }
    const bereit = drafts.count ? `${n(drafts.count, 'Entwurf liegt', 'Entwürfe liegen')} bereit, nichts geht ohne dich raus.` : '';
    const metrics = { wartend: (drafts.count || 0) + (books.count || 0) + (crea.count || 0), ...dm };
    if (parts.length) return { status: 'todo', line: `${rvLine}${parts.join(' · ')}. Nichts davon geht ohne dich raus.${drafts.count && !neu ? ` ${bereit}` : ''}`, actions, issues, metrics };
    return { status: 'ok', line: `${rvLine}${bereit || 'Nichts wartet auf deine Freigabe.'}`, actions: actions.length ? actions : undefined, metrics };
  },
  // Chloe Parker · Creator: Bewerbungen und Rückfragen im Creator-Programm im Blick behalten (entscheiden tut Feray).
  async creator() {
    const db = supabaseAdmin();
    const [rev, info, act] = await Promise.all([
      db.from('lr_creators').select('id', { count: 'exact', head: true }).in('status', ['SUBMITTED', 'UNDER_REVIEW']),
      db.from('lr_creators').select('id', { count: 'exact', head: true }).eq('status', 'INFO_REQUESTED'),
      db.from('lr_creators').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    ]);
    if (rev.error) return { status: 'ok', line: 'Creator-Programm ist noch nicht eingerichtet.' };
    if (rev.count) return { status: 'todo', line: `${n(rev.count, 'Bewerbung wartet', 'Bewerbungen warten')} auf Prüfung${info.count ? ` · ${n(info.count, 'Rückfrage offen', 'Rückfragen offen')}` : ''}. ${n(act.count || 0, 'Creator ist', 'Creator sind')} aktiv.`, actions: [{ id: 'open', label: 'Bewerbungen prüfen', tab: 'creator', sg: 'b2b' }] };
    return { status: 'ok', line: `Keine offenen Bewerbungen · ${n(act.count || 0, 'Creator aktiv', 'Creator aktiv')}${info.count ? ` · ${n(info.count, 'Rückfrage', 'Rückfragen')} beim Creator` : ''}.` };
  },
  // Hannah Walsh · Neukunden: vom Besucher zur Registrierung zum Kauf (7 Tage).
  async neukunden() {
    const db = supabaseAdmin();
    const [kz, { count: reg }, { data: k }] = await Promise.all([
      // Kasse und Trichter nur aus der gemeinsamen Kennzahl (ohne Testkonten, Admin-Sitzungen und gleiche Person).
      kasseKennzahl(7 * 24),
      db.from('lr_user_data').select('user_id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * D).toISOString()),
      db.from('lr_kaeufe').select('id, erstattet_at').gte('created_at', new Date(Date.now() - 7 * D).toISOString()),
    ]);
    const fu = kz.trichter, co = kz.checkout;
    const buys = (k ?? []).filter((x) => !x.erstattet_at).length, regs = reg || 0;
    // „hoch“ erst ab 3 verschiedenen Fremdpersonen ohne Kauf; ist es nur eigener Testverkehr, höchstens ein Hinweis.
    const issues: Issue[] = [];
    if (kz.nurTest) { if (kz.davon_eigene || kz.gestartet || kz.geoeffnet) issues.push({ id: 'neu:kasse-test', level: 'niedrig', title: kz.hinweis }); }
    else if (kz.alarm) issues.push({ id: 'neu:kasse-ohne-kauf', level: 'hoch', title: `${kz.personen} Personen starteten die Kasse, aber kein Kauf in 7 Tagen`, customer: true });
    else if (!kz.bezahlt) issues.push({ id: 'neu:kasse-ohne-kauf', level: 'mittel', title: `${kz.personen} Personen starteten die Kasse, noch kein Kauf in 7 Tagen`, customer: true });
    else if (kz.gestartet >= 10 && kz.bezahlt / kz.gestartet < 0.3) issues.push({ id: 'neu:kasse-quote', level: 'mittel', title: `Nur ${kz.bezahlt} von ${kz.gestartet} Kassenstarts werden zum Kauf`, customer: true });
    if (fu && fu.pricing >= 20 && fu.open / fu.pricing < 0.08) issues.push({ id: 'neu:preisseite', level: 'mittel', title: `Preisseite: ${fu.pricing} Personen, nur ${fu.open} öffneten die Kasse` });
    if (regs >= 5 && !buys) issues.push({ id: 'neu:reg-ohne-kauf', level: 'mittel', title: `${regs} neue Konten, aber kein Kauf` });
    const metrics = { registrierungen: regs, kaeufe: buys, ...(fu ? { preisseite: fu.pricing, kassenstarts: fu.start } : {}) };
    const line = `7 Tage: ${n(regs, 'neues Konto', 'neue Konten')}, ${n(buys, 'Kauf', 'Käufe')}${fu ? `, Preisseite ${fu.pricing} Besucher, Kasse geöffnet ${fu.open}, zu Stripe ${fu.start} (ohne eigene Tests)` : ''}.${co ? ` Stripe (7 Tage): ${co.total} fremde Kassen von ${n(co.people, 'Person', 'Personen')}${co.own ? `, ${co.own} eigene Sitzungen nicht gezählt` : ''}.` : ''}`;
    if (!issues.some((i) => i.level !== 'niedrig')) return { status: 'ok', line: `${line} ${issues.length ? `${issues[0].title}.` : 'Der Weg zum Kauf läuft ohne Auffälligkeit.'}`, issues, metrics, actions: [{ id: 'ask', label: 'Vorschläge für mehr Kunden', q: 'Wie werden mehr Besucher zu Kunden? Drei Vorschläge mit Zahl.' }] };
    return { status: issues.some((i) => i.level === 'hoch') ? 'todo' : 'ok', line: `${line} Auffällig: ${issues[0].title}.`, issues, metrics, actions: [{ id: 'ask', label: 'Ursache & Vorschläge', q: 'Warum brechen Besucher vor dem Kauf ab und was ändern wir? Mit Zahlen.' }, { id: 'open', label: 'Analyse öffnen', tab: 'analyse', sg: 'b2c' }] };
  },
  // Liam Foster · Bestandskunden: aktive Abos, auslaufende Zugänge, stille Konten, Erstattungen.
  async bestandskunden() {
    const db = supabaseAdmin(), now = Date.now();
    const [{ data: ent }, { data: ref }] = await Promise.all([
      db.from('lr_entitlements').select('user_id, plan, status, valid_until').limit(5000),
      db.from('lr_kaeufe').select('id').not('erstattet_at', 'is', null).gte('erstattet_at', new Date(now - 30 * D).toISOString()),
    ]);
    const all = ent ?? [], active = all.filter((e) => e.status === 'active');
    const soon = active.filter((e) => e.valid_until && new Date(e.valid_until as string).getTime() - now < 14 * D && new Date(e.valid_until as string).getTime() > now);
    const lapsed = all.filter((e) => e.status !== 'active' && e.valid_until && now - new Date(e.valid_until as string).getTime() < 30 * D);
    let silent = 0;
    if (active.length) {
      const ids = active.slice(0, 500).map((e) => e.user_id as string);
      const { data: ud } = await db.from('lr_user_data').select('user_id, updated_at').in('user_id', ids);
      silent = (ud ?? []).filter((u) => u.updated_at && now - new Date(u.updated_at as string).getTime() > 30 * D).length;
    }
    const refunds = (ref ?? []).length;
    const issues: Issue[] = [];
    if (soon.length) issues.push({ id: 'best:laeuft-aus', level: soon.length >= 3 ? 'hoch' : 'mittel', title: `${n(soon.length, 'Zugang läuft', 'Zugänge laufen')} in den nächsten 14 Tagen aus`, customer: true });
    if (lapsed.length) issues.push({ id: 'best:nicht-verlaengert', level: 'mittel', title: `${n(lapsed.length, 'Kunde hat', 'Kunden haben')} in 30 Tagen nicht verlängert`, customer: true });
    if (refunds >= 2) issues.push({ id: 'best:erstattungen', level: 'mittel', title: `${n(refunds, 'Erstattung', 'Erstattungen')} in 30 Tagen` });
    if (active.length >= 5 && silent / Math.min(active.length, 500) > 0.5) issues.push({ id: 'best:still', level: 'niedrig', title: `${silent} aktive Kunden seit über 30 Tagen nicht mehr im Konto` });
    const metrics = { aktiv: active.length, laeuft_aus: soon.length, nicht_verlaengert: lapsed.length, erstattungen: refunds, still: silent };
    const line = `${n(active.length, 'aktiver Kunde', 'aktive Kunden')}${soon.length ? `, ${soon.length} laufen bald aus` : ''}${lapsed.length ? `, ${lapsed.length} nicht verlängert` : ''}${refunds ? `, ${n(refunds, 'Erstattung', 'Erstattungen')} (30 Tage)` : ''}${silent ? `, ${silent} seit 30 Tagen still` : ''}.`;
    if (!issues.length) return { status: 'ok', line: `${line} Kundenbestand ist stabil.`, metrics, actions: [{ id: 'ask', label: 'Vorschläge zur Bindung', q: 'Wie halten wir Bestandskunden länger? Drei Vorschläge mit Zahl.' }] };
    return { status: issues.some((i) => i.level === 'hoch') ? 'todo' : 'ok', line: `${line} Zuerst: ${issues[0].title}.`, issues, metrics, actions: [{ id: 'ask', label: 'Was tun?', q: 'Welche Kunden sind gefährdet und was tun wir konkret? Entwürfe nur vorbereiten.' }, { id: 'open', label: 'Nutzer öffnen', tab: 'nutzer', sg: 'b2c' }] };
  },
  // Zoe Campbell · Akquise: Kontakte, Wiedervorlagen, Nachfassen (nur Entwürfe, nichts geht raus).
  async akquise() {
    const db = supabaseAdmin(), now = Date.now();
    const [{ data: c, error }, { data: req }] = await Promise.all([
      db.from('lr_crm_contacts').select('id, company, status, next_at, updated_at').limit(2000),
      db.from('lr_b2b_contact').select('id, created_at').eq('status', 'offen').lt('created_at', new Date(now - 2 * D).toISOString()).limit(50),
    ]);
    if (error) return { status: 'ok', line: 'Akquise ist noch nicht eingerichtet (keine Kontaktliste).' };
    const l = c ?? [];
    const due = l.filter((x) => x.next_at && new Date(x.next_at as string).getTime() <= now);
    const fresh = l.filter((x) => x.status === 'neu' && now - new Date(x.updated_at as string).getTime() > 3 * D);
    const follow = l.filter((x) => x.status === 'angeschrieben' && !x.next_at && now - new Date(x.updated_at as string).getTime() > 7 * D);
    const open = (req ?? []).length;
    const issues: Issue[] = [];
    if (due.length) issues.push({ id: 'akq:faellig', level: due.length >= 5 ? 'hoch' : 'mittel', title: `${n(due.length, 'Wiedervorlage ist', 'Wiedervorlagen sind')} fällig${due[0]?.company ? `, z. B. ${due[0].company}` : ''}` });
    if (open) issues.push({ id: 'akq:anfragen', level: 'hoch', title: `${n(open, 'Unternehmensanfrage wartet', 'Unternehmensanfragen warten')} seit über 2 Tagen`, customer: true });
    if (follow.length) issues.push({ id: 'akq:nachfassen', level: 'mittel', title: `${n(follow.length, 'Kontakt ohne Antwort', 'Kontakte ohne Antwort')} seit über 7 Tagen – nachfassen` });
    if (fresh.length) issues.push({ id: 'akq:neu', level: 'niedrig', title: `${n(fresh.length, 'neuer Kontakt', 'neue Kontakte')} seit 3 Tagen nicht angeschrieben` });
    const metrics = { kontakte: l.length, faellig: due.length, nachfassen: follow.length, offen_anfragen: open };
    const line = `${n(l.length, 'Kontakt', 'Kontakte')} in der Akquise${due.length ? `, ${due.length} fällig` : ''}${follow.length ? `, ${follow.length} zum Nachfassen` : ''}${open ? `, ${open} offene Anfragen` : ''}.`;
    if (!issues.length) return { status: 'ok', line: `${line} Nichts ist überfällig.`, metrics };
    return { status: issues.some((i) => i.level === 'hoch') ? 'todo' : 'ok', line: `${line} Zuerst: ${issues[0].title}.`, issues, metrics, actions: [{ id: 'ask', label: 'Nachfass-Entwürfe vorbereiten', q: 'Bereite für die fälligen Wiedervorlagen und Kontakte ohne Antwort Nachfass-E-Mails als Entwurf vor (nicht senden).' }, { id: 'open', label: 'Anfragen öffnen', tab: 'anfragen', sg: 'b2b' }] };
  },
  // Daniel Hughes · Recht & Compliance: Rechtstexte erreichbar, E-Mail-Pflichten (Einwilligung, Abmeldelink), Datenschutz.
  async recht(c) {
    const pages = await legalPages(c.origin);
    const missing = pages.filter((p) => !p.ok);
    const r = await analyse({ areas: ['E-Mail'] });
    const issues: Issue[] = [
      ...missing.map((p) => ({ id: `recht:seite:${p.path}`, level: 'hoch' as const, title: `Rechtstext ${p.path} nicht erreichbar (${p.status})`, customer: true })),
      ...r.findings.filter((f) => ['mail:optout', 'mail:unsub'].includes(f.id)).map((f) => ({ id: `recht:${f.id}`, level: f.sev === 'critical' ? 'hoch' as const : 'mittel' as const, title: f.title })),
    ];
    if (!process.env.NOTIFY_FROM_EMAIL && !process.env.MAILBOX_FROM_EMAIL) issues.push({ id: 'recht:absender', level: 'niedrig', title: 'Kein fester Absender für Kunden-E-Mails hinterlegt (Impressumspflicht in E-Mails)' });
    // Einmalige Einordnung der wartenden Entwürfe nach Rechtsgrundlage (nur markieren, nichts senden oder löschen).
    const lg = (await loadLegalSummary().catch(() => null)) || (await classifyWaitingDrafts(c.actor).catch(() => null));
    const metrics = { rechtstexte_ok: pages.length - missing.length, mail_risiken: issues.filter((i) => i.id.startsWith('recht:mail')).length, ...(lg ? { entwuerfe_transaktion: lg.transaktion, entwuerfe_werbung_mit_grundlage: lg.werbung_ok, entwuerfe_gesperrt: lg.gesperrt } : {}) };
    const lgLine = lg ? ` Entwürfe: ${lg.transaktion} Transaktion/Antwort, ${lg.werbung_ok} Werbung mit Grundlage, ${lg.gesperrt} gesperrt.` : '';
    if (!issues.length) return { status: 'ok', line: `Impressum, Datenschutz, Nutzungsbedingungen (AGB) und Widerrufsformular erreichbar. Keine E-Mail geht an Widersprechende, Abmeldelinks vorhanden.${lgLine}`, metrics };
    return { status: issues.some((i) => i.level === 'hoch') ? 'todo' : 'ok', line: `Risiko: ${issues[0].title}${issues.length > 1 ? ` · ${issues.length - 1} weitere` : ''}.${lgLine}`, issues, metrics, actions: [{ id: 'ask', label: 'Risiken & Lösung', q: 'Welche rechtlichen Risiken sind offen und wie beseitigen wir sie am sichersten?' }, { id: 'open', label: 'Prüfung ansehen', tab: 'hq' }] };
  },
  // Ethan Collins · Briefing: fasst den Tag in einem Satz zusammen (nur intern).
  async briefing(c) {
    const o = await c.overview();
    const kpi = o.metrics.slice(0, 4).map((m) => `${m.label}: ${Number(m.value).toLocaleString('de-DE')}`).join(' · ');
    const views = c.views || [];
    // Kasse nur aus der gemeinsamen Kennzahl: ist es nur eigener Testverkehr, wird „Kasse ohne Kauf“ nicht zur Tagespriorität.
    const kz = await kasseKennzahl(72).catch(() => null);
    const { top, causes } = situation(views, kz);
    const fixedToday = views.filter((v) => /Erledigt:|Selbst erledigt:/.test(v.line)).map((v) => v.name);
    const parts = [top.length ? `Heute zuerst: ${top.map((t, i) => `${i + 1}) ${t.title} (${t.agent})`).join(' ')}` : 'Heute ist nichts Dringendes offen'];
    if (causes.length) parts.push(`Zusammenhang: ${causes[0]}`);
    if (kz?.nurTest && (kz.davon_eigene || kz.gestartet)) parts.push(kz.hinweis);
    if (fixedToday.length) parts.push(`Selbst erledigt von ${fixedToday.join(', ')}`);
    if (kpi) parts.push(kpi);
    return { status: top.some((t) => t.level === 'hoch') ? 'todo' : 'ok', line: `${parts.join(' · ')}.`, actions: top.length ? [{ id: 'ask', label: 'Lagebild', q: 'Lagebild' }] : undefined, metrics: Object.fromEntries(o.metrics.slice(0, 6).map((m) => [m.key, Number(m.value) || 0])) };
  },
};


// Rechtstexte live prüfen (höchstens alle 6 Stunden): nur Status, keine Inhalte.
// Die echten Seiten (AGB stehen in /terms, das Widerrufsformular unter /refund).
const LEGAL = ['/legal-notice', '/privacy', '/terms', '/refund'];
let legalCache: { at: number; v: { path: string; ok: boolean; status: number }[] } | null = null;
async function legalPages(origin: string): Promise<{ path: string; ok: boolean; status: number }[]> {
  if (legalCache && Date.now() - legalCache.at < 6 * H) return legalCache.v;
  const v = await Promise.all(LEGAL.map(async (path) => { try { const r = await fetch(`${origin}${path}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'LeaseRun-HQ' } }); return { path, ok: r.ok, status: r.status }; } catch { return { path, ok: false, status: 0 }; } }));
  legalCache = { at: Date.now(), v }; return v;
}

// Schicht: gewählte (oder alle) Mitarbeiter parallel arbeiten lassen, Ergebnis speichern. Danach wertet die
// Intelligenz-Schicht aus (Gedächtnis, Trends, Hochstufen lange offener Punkte) und Ethan bewertet das Gesamtbild.
const TREND: Record<string, [string, string][]> = { postfach: [['ungelesen', 'Ungelesene']], support: [['kundenfehler', 'Kundenprobleme'], ['kassenstarts', 'Kassenstarts']], finanzen: [['ueberfaellig', 'Überfällige']], optimierung: [['funde', 'Verbesserungen']], sicherheit: [['offen', 'Sicherheitspunkte']], marketing: [['besucher', 'Besucher'], ['abonnenten', 'Abonnenten']] };
const runOne = async (id: AgentId, ctx: Ctx): Promise<AgentRun> => {
  const t0 = Date.now();
  try { const r = await withTimeout(RUN[id](ctx), 25_000, 'Die Aufgabe'); return { id, ...r, at: new Date().toISOString(), ms: Date.now() - t0 }; }
  catch (e) { return { id, status: 'error', line: `Konnte nicht arbeiten: ${(e as Error).message || 'Fehler'}`.slice(0, 200), at: new Date().toISOString(), ms: Date.now() - t0, issues: [{ id: `${id}:ausfall`, level: 'mittel', title: `${AGENT_NAMES[id]} konnte nicht arbeiten` }] }; }
};
// Gleicher Befund-Schlüssel (z. B. kasse:keine-kaeufe) bei mehreren Agenten: nur Tyler meldet ihn, die anderen verweisen
// darauf (Schwere „niedrig“) – damit derselbe Punkt nicht dreimal als Top-Priorität erscheint.
function einMelder(out: AgentRun[], prev: Record<string, AgentRun>): void {
  const all = { ...prev, ...Object.fromEntries(out.map((r) => [r.id, r])) };
  const melder = new Map<string, string>();
  for (const id of [KASSE_MELDER, ...AGENT_IDS]) for (const i of all[id]?.issues || []) { const k = befundKey(i.id); if (k && !melder.has(k)) melder.set(k, id); }
  for (const r of out) {
    let changed = false;
    r.issues = r.issues?.map((i) => {
      const k = befundKey(i.id), m = k ? melder.get(k) : undefined;
      if (!m || m === r.id) return i;
      changed = true;
      return { ...i, level: 'niedrig' as const, customer: false, title: `Siehe ${AGENT_NAMES[m as AgentId]}: ${i.title}`.slice(0, 160) };
    });
    if (changed && r.status === 'todo' && !r.issues?.some((i) => i.level === 'hoch')) r.status = 'ok';
  }
}
export async function runShift(actor: string, origin: string, ids: readonly string[] = AGENT_IDS, force = false): Promise<Record<string, AgentRun>> {
  const [prev, mem] = await Promise.all([loadShift(), loadMemory()]);
  let ov: Promise<Overview> | null = null;
  const ctx: Ctx = { actor, origin, prev, force, overview: () => (ov ||= buildOverview('owner')) };
  const pick = AGENT_IDS.filter((x) => ids.includes(x));
  const out = await Promise.all(pick.filter((x) => x !== 'briefing').map((id) => runOne(id, ctx)));
  einMelder(out, prev);
  const now = new Date();
  const days: Record<string, Record<string, number>> = {};
  const alarm: { agent: AgentId; issue: Issue; wieder: boolean }[] = [];
  const think: Record<string, string[]> = {};
  for (const r of out) {
    // Ohne eigene Liste: offener Auftrag zählt als ein Punkt (damit auch er Gedächtnis und Hochstufung bekommt).
    const issues = r.issues ?? (r.status === 'todo' ? [{ id: `${r.id}:todo`, level: 'mittel' as const, title: r.line.slice(0, 90) }] : []);
    const rc = remember(mem, r.id, issues, r.metrics, now);
    // Neu oder wieder aufgetreten und wichtig: Kunden betroffen oder Störung bei Technik/Sicherheit → sofort aufs Gerät.
    for (const i of [...rc.neu, ...rc.wieder]) if (i.level === 'hoch' && (i.customer || r.id === 'technik' || r.id === 'sicherheit')) alarm.push({ agent: r.id as AgentId, issue: i, wieder: rc.wieder.includes(i) });
    // Neues Wichtiges oder ein Ausfall → das Modell soll Ursache und Lösung erarbeiten (runAnalyses, gedeckelt).
    const fresh = [...rc.neu, ...rc.wieder].filter((i) => i.level === 'hoch').map((i) => i.id);
    // Ava (Warteliste für Feray) und Ethan (Lagebild, eigene Tagesrunde) werden nicht automatisch analysiert.
    if ((fresh.length || r.status === 'error') && r.id !== 'freigaben' && r.id !== 'briefing') think[r.id] = fresh.length ? fresh : [`${r.id}:ausfall`];
    days[r.id] = Object.fromEntries(Object.entries(mem[r.id]?.open || {}).map(([k, v]) => [k, Math.floor((+now - +new Date(v.first)) / D)]));
    const tr = (TREND[r.id] || []).map(([k, l]) => trendText(trend(mem, r.id, k, +now, 7), l)).filter(Boolean);
    r.line = `${r.line}${recallText(rc)}${tr.length ? ` Trend: ${tr.join(' · ')}.` : ''}`.slice(0, 900);
    if (rc.escalate && r.status === 'ok') r.status = 'todo';
    r.issues = issues.slice(0, 30);
  }
  // Ethan zuletzt: sieht die frischen Ergebnisse dieser Runde und den letzten Stand der übrigen Agenten.
  if (pick.includes('briefing')) {
    const all = { ...prev, ...Object.fromEntries(out.map((r) => [r.id, r])) };
    ctx.views = AGENT_IDS.filter((x) => x !== 'briefing' && all[x]).map((x) => ({ id: x, name: AGENT_NAMES[x], status: all[x].status, line: all[x].line, issues: all[x].issues || [], days: days[x] || Object.fromEntries(Object.entries(mem[x]?.open || {}).map(([k, v]) => [k, Math.floor((+now - +new Date(v.first)) / D)])) }));
    const b = await runOne('briefing', ctx);
    remember(mem, 'briefing', [], b.metrics, now);
    out.push(b);
  }
  const by = actor.includes('@') ? 'admin' : actor;
  // Vorherige Analyse des Modells bleibt sichtbar, bis eine neue kommt; neue Punkte landen in der Warteschlange.
  const fresh = (a?: AgentRun['ai']) => (a && Date.now() - new Date(a.at).getTime() < (a.grund === 'tag' ? 24 : 3) * H ? a : undefined);
  const part: Record<string, AgentRun> = Object.fromEntries(out.map((r) => [r.id, { ...r, ai: fresh(prev[r.id]?.ai), aiQueue: think[r.id] || (prev[r.id]?.aiQueue && prev[r.id]?.status !== 'ok' ? prev[r.id]?.aiQueue : undefined) }]));
  const memPart = Object.fromEntries(pick.map((id) => [id, mem[id]]).filter(([, v]) => v)) as typeof mem;
  const [next] = await Promise.all([saveShift(part, by), saveMemory(memPart, by), alarm.length ? alertNow(alarm, by) : Promise.resolve()]);
  // Protokoll nur bei manuellem Start oder wenn sich ein Ergebnis geändert hat – sonst füllt die 3-Minuten-Runde das Protokoll.
  const changed = out.some((r) => prev[r.id]?.status !== r.status || prev[r.id]?.line !== r.line);
  if (actor !== 'cron' && (force || changed)) await adminAudit(actor, 'hq_shift', null, { agents: pick.join(','), todo: out.filter((r) => r.status !== 'ok').length });
  return next;
}

// ---------- Sofort-Meldung aufs Gerät: neue wichtige Punkte aus der Schicht (höchstens einmal je Punkt in 6 Std.) ----------
// Nur der Anlass, keine Namen oder Beträge (Push läuft über Expo). Die Details stehen im Headquarters.
const ALERT_KEY = 'hq_shift_alerts';
async function alertNow(list: { agent: AgentId; issue: Issue; wieder: boolean }[], by: string): Promise<void> {
  try {
    const db = supabaseAdmin();
    const { data } = await db.from('lr_settings').select('value').eq('key', ALERT_KEY).maybeSingle();
    const seen = { ...((data?.value as Record<string, number>) || {}) }, now = Date.now();
    for (const [k, t] of Object.entries(seen)) if (now - t > 7 * D) delete seen[k];
    const fresh = list.filter((a) => !seen[a.issue.id] || now - seen[a.issue.id] > 6 * H).slice(0, 3);
    if (!fresh.length) return;
    for (const a of fresh) seen[a.issue.id] = now;
    await db.from('lr_settings').upsert({ key: ALERT_KEY, value: seen, updated_at: new Date().toISOString(), updated_by: by });
    const { pushAdmins } = await import('@/lib/admin/push');
    for (const a of fresh) {
      const kind = a.agent === 'sicherheit' ? 'security' : a.agent === 'finanzen' ? 'payment' : 'support';
      await pushAdmins(kind, `${AGENT_NAMES[a.agent]}: ${a.wieder ? 'wieder da' : 'neu'} – ${a.issue.customer ? 'Kunden betroffen' : 'Störung'}`, `${a.issue.title.slice(0, 120)}. Details im Headquarters.`, 'hq_alarm');
    }
  } catch (e) { console.warn('hq_alert', e instanceof Error ? e.message : e); }
}

// ---------- Auftrag an einen Agenten (Eingabefeld im Headquarters) ----------
// Feray schreibt in Alltagssprache, was der Agent tun soll. Erkannt werden feste, sichere Aufträge je Agent.
// Interne Aufträge laufen sofort. Alles, was nach außen ginge, wird nur vorbereitet und braucht ihren Knopfdruck.
type Cmd = { keys: RegExp; label: string; run: (c: Ctx) => Promise<{ reply: string; actions?: AgentAction[] }> };
const fromRun = (id: AgentId, prefix = '') => async (c: Ctx) => { const r = await RUN[id]({ ...c, force: true }); return { reply: `${prefix}${r.line}`, actions: r.actions }; };
const CMDS: Record<AgentId, Cmd[]> = {
  postfach: [
    { keys: /abruf|hol|neu|sync|check|prüf/i, label: 'Neue E-Mails abholen', run: fromRun('postfach', 'Erledigt: ') },
    { keys: /entw[uü]rf|draft/i, label: 'Wie viele Entwürfe warten?', run: async () => { const { count } = await supabaseAdmin().from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf'); return { reply: `${n(count || 0, 'Entwurf wartet', 'Entwürfe warten')} auf deine Freigabe. Gesendet wird nur, wenn du im Postfach auf „Senden“ tippst.`, actions: [{ id: 'open', label: 'Entwürfe öffnen', tab: 'postfach' }] }; } },
    { keys: /ungelesen|unread|posteingang/i, label: 'Ungelesene zählen', run: async () => { const { count } = await supabaseAdmin().from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'in').eq('folder', 'inbox').is('read_at', null); return { reply: count ? `${n(count, 'ungelesene E-Mail', 'ungelesene E-Mails')} im Posteingang.` : 'Keine ungelesenen E-Mails.', actions: count ? [{ id: 'open', label: 'Lesen', tab: 'postfach' }] : [] }; } },
  ],
  sicherheit: [
    { keys: /sperr|block|angriff|erledig|aufr[äa]um|fix/i, label: 'Angreifer sperren & aufräumen', run: async (c) => { const r = await applyFixes(c.actor, { all: true, areas: ['Sicherheit'], origin: c.origin }); const done = r.results.filter((x) => x.ok).map((x) => x.text.replace(/ ✓$/, '')); const left = r.findings.filter((f) => f.area === 'Sicherheit' && !f.auto); return { reply: `${done.length ? `Erledigt: ${done.join(' · ')}.` : 'Es gab nichts zu sperren oder aufzuräumen.'}${left.length ? ` Offen (nur du): ${left.map((f) => f.title).join(' · ')}.` : ''}` }; } },
    { keys: /status|lage|pr[üu]f|check|sicher/i, label: 'Sicherheitslage prüfen', run: fromRun('sicherheit') },
    { keys: /not.?aus|panic/i, label: 'Not-Aus', run: async () => ({ reply: 'Den Not-Aus löse ich bewusst nicht selbst aus – das entscheidest nur du. Der Knopf liegt im Reiter Sicherheit.', actions: [{ id: 'open', label: 'Sicherheit öffnen', tab: 'sicherheit' }] }) },
  ],
  technik: [
    { keys: /webhook|zahlung|stripe/i, label: 'Zahlungs-Webhook testen', run: async (c) => { const r = await webhookSelfTest(c.origin); return { reply: `${r.label}: ${r.info}` }; } },
    { keys: /pr[üu]f|check|test|status|alles/i, label: 'Alles live prüfen', run: fromRun('technik') },
  ],
  finanzen: [
    { keys: /erinner|mahn|remind/i, label: 'Zahlungserinnerungen vorbereiten', run: async (c) => { const r = await RUN.finanzen({ ...c, force: true }); return { reply: r.actions?.some((a) => a.id === 'remind') ? `${r.line} Ich habe sie vorbereitet – raus gehen sie erst, wenn du auf den Knopf tippst.` : r.line, actions: r.actions }; } },
    { keys: /[üu]berf[äa]llig|rechnung|offen|status/i, label: 'Überfällige Rechnungen', run: fromRun('finanzen') },
  ],
  vertrieb: [{ keys: /anfrag|lead|unternehm|status|neu/i, label: 'Offene Anfragen', run: fromRun('vertrieb') }],
  support: [
    { keys: /kundenprobl|l[öo]sung|zeig|liste/i, label: 'Kundenprobleme zeigen', run: async () => { const r = (await loadKundenReport()) || (await kundenReport()); const list = r.issues.filter((i) => i.level !== 'niedrig'); return { reply: list.length ? list.slice(0, 8).map((i, k) => `${k + 1}. ${i.title}\n   ${i.detail}`).join('\n') : `Kein Kunde ist auf einen Fehler gestoßen.${r.fixed.length ? ` Selbst erledigt: ${r.fixed.join(' · ')}.` : ''}` }; } },
    { keys: /kasse|checkout|abbruch|abbr[üu]ch|zahlung|kauf/i, label: 'Kasse & Abbrüche prüfen', run: async () => { const r = await kundenReport(); const co = r.checkout, fu = r.funnel; const k = r.issues.filter((i) => i.id.startsWith('kasse:')); return { reply: `${co ? `Stripe (3 Tage): ${co.total} Kassen geöffnet, ${co.complete} bezahlt, ${co.expired} abgelaufen, ${co.open} offen, ${co.declined} abgelehnt${Object.keys(co.reasons).length ? ` (${Object.entries(co.reasons).map(([a, b]) => `${a} ${b}×`).join(', ')})` : ''}.` : 'Stripe nicht erreichbar.'}${fu ? ` Website (${fu.days} Tage, nach Personen, ohne eigene Tests): ${fu.pricing} sahen Preise, ${fu.open} öffneten die Kasse, ${fu.start} gingen zu Stripe, ${fu.back} kamen nach Kauf zurück.` : ''}${k.length ? `\n${k.map((i) => `• ${i.title} – ${i.detail}`).join('\n')}` : ' Keine Auffälligkeit.'}` }; } },
    { keys: /fehler|error|bug|status|website|pr[üu]f/i, label: 'Jetzt prüfen', run: fromRun('support') },
  ],
  freigaben: [{ keys: /was|wart|frei|liste|offen|status/i, label: 'Was wartet auf mich?', run: fromRun('freigaben') }],
  neukunden: [{ keys: /trichter|kauf|registr|neukund|status|pr[üu]f|zahlen/i, label: 'Weg zum Kauf prüfen', run: fromRun('neukunden') }],
  bestandskunden: [{ keys: /abo|kund|verl[äa]nger|k[üu]ndig|status|pr[üu]f|zahlen/i, label: 'Kundenbestand prüfen', run: fromRun('bestandskunden') }],
  akquise: [{ keys: /wiedervorlag|kontakt|nachfass|akquise|status|pr[üu]f|f[äa]llig/i, label: 'Wiedervorlagen prüfen', run: fromRun('akquise') }],
  recht: [{ keys: /recht|risik|impressum|datenschutz|agb|widerruf|dsgvo|status|pr[üu]f/i, label: 'Rechtliches prüfen', run: fromRun('recht') }],
  creator: [{ keys: /bewerb|creator|r[üu]ckfrag|status/i, label: 'Bewerbungen prüfen', run: fromRun('creator') }],
  briefing: [
    { keys: /lagebild|priorit|wichtig|zuerst|zusammenhang|ursache/i, label: 'Lagebild', run: async () => {
      const [sh, mem] = await Promise.all([loadShift(), loadMemory()]); const now = Date.now();
      const views = AGENT_IDS.filter((x) => x !== 'briefing' && sh[x]).map((x) => ({ id: x, name: AGENT_NAMES[x], status: sh[x].status, line: sh[x].line, issues: sh[x].issues || [], days: Object.fromEntries(Object.entries(mem[x]?.open || {}).map(([k, v]) => [k, Math.floor((now - +new Date(v.first)) / D)])) }));
      const kz = await kasseKennzahl(72).catch(() => null);
      const { top, causes } = situation(views, kz);
      if (kz?.nurTest && (kz.davon_eigene || kz.gestartet)) causes.push(kz.hinweis);
      const old = views.flatMap((v) => v.issues.filter((i) => (v.days[i.id] || 0) >= 2).map((i) => `${i.title} (${v.name}, seit ${v.days[i.id]} Tagen)`)).slice(0, 5);
      return { reply: [top.length ? `Heute zuerst:\n${top.map((t, i) => `${i + 1}. ${t.title} – ${t.agent}${t.customer ? ' · Kunden betroffen' : ''}`).join('\n')}` : 'Heute ist nichts Dringendes offen.', causes.length ? `Zusammenhänge:\n${causes.map((c) => `• ${c}`).join('\n')}` : '', old.length ? `Lange offen:\n${old.map((o) => `• ${o}`).join('\n')}` : ''].filter(Boolean).join('\n\n') };
    } },
    { keys: /brief|zusammen|heute|lage|status|tag/i, label: 'Tages-Briefing', run: async (c) => { const sh = await loadShift(); const r = await runShift(c.actor, c.origin, ['briefing'], true); void sh; return { reply: r.briefing?.line || '–', actions: r.briefing?.actions }; } },
  ],
  optimierung: [
    { keys: /pr[üu]f|optimi|verbesser|check|scan|jetzt/i, label: 'Website jetzt prüfen', run: fromRun('optimierung') },
    { keys: /vorschl|liste|was|zeig/i, label: 'Vorschläge zeigen', run: async () => { const r = await loadOptimizer(); if (!r) return { reply: 'Noch keine Prüfung gelaufen – sag „Website jetzt prüfen“.' }; return { reply: r.findings.length ? r.findings.slice(0, 8).map((f, i) => `${i + 1}. ${f.title} – ${f.detail}`).join('\n') : 'Keine offenen Verbesserungen.' }; } },
  ],
  marketing: [
    { keys: /idee|vorschl|was tun|verbesser|wachs|mehr besucher|mehr kunden|strategie/i, label: 'Marketing-Ideen', run: async () => { const r = (await loadMarketing()) || (await runMarketing(7)); return { reply: marketingIdeas(r), actions: [{ id: 'open', label: 'Analyse öffnen', tab: 'analyse', sg: 'b2c' }] }; } },
    { keys: /woher|quelle|kanal|google|social|linkedin|instagram|referr/i, label: 'Woher kommen die Besucher?', run: async () => ({ reply: marketingSources((await loadMarketing()) || (await runMarketing(7))) }) },
    { keys: /seite|beliebt|meist|top|inhalt|content|ratgeber/i, label: 'Meistgelesene Seiten', run: async () => ({ reply: marketingPages((await loadMarketing()) || (await runMarketing(7))) }) },
    { keys: /newsletter|mailing|rundschreiben/i, label: 'Newsletter-Entwurf', run: async () => ({ reply: marketingDraft((await loadMarketing()) || (await runMarketing(7)), 'newsletter'), actions: [{ id: 'open', label: 'Postfach öffnen', tab: 'postfach' }] }) },
    { keys: /linkedin|beitrag|post|xing/i, label: 'LinkedIn-Beitrag entwerfen', run: async () => ({ reply: marketingDraft((await loadMarketing()) || (await runMarketing(7)), 'linkedin') }) },
    { keys: /instagram|reel|story|tiktok/i, label: 'Instagram-Text entwerfen', run: async () => ({ reply: marketingDraft((await loadMarketing()) || (await runMarketing(7)), 'instagram') }) },
    { keys: /pr[üu]f|jetzt|neu|aktualis|check|zahlen|status|lage/i, label: 'Marketing jetzt prüfen', run: fromRun('marketing') },
  ],
};
export const COMMAND_LABELS: Record<string, string[]> = Object.fromEntries(Object.entries(CMDS).map(([k, v]) => [k, v.map((x) => x.label)]));

export async function runCommand(actor: string, origin: string, id: AgentId | 'zentrale', text: string, history: { me: boolean; t: string }[] = []): Promise<{ reply: string; actions?: AgentAction[]; understood: boolean; ai?: import('@/lib/admin/hq-store').AiNote }> {
  const t = text.trim().slice(0, 1500);
  // „Gib mir den Link zu …“: sofort die richtige offizielle Adresse – ohne KI, also auch bei leerem Guthaben.
  const links = serviceLinks(t);
  if (links) { await adminAudit(actor, 'hq_command', null, { agent: id, intent: 'link' }); return { understood: true, reply: links, actions: [] }; }
  if (id === 'zentrale') {
    const ai = await askAgent(actor, origin, 'zentrale', t, history).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
    if (ai.ok) return { understood: true, reply: ai.note.text, actions: [], ai: ai.note };
    return runCommand(actor, origin, 'briefing', t, history);
  }
  const list = CMDS[id] || [];
  // 1. Genau ein Auftrag (Knopf) → ausführen. 2. Freie Frage → LeaseRun Intelligence beantwortet sie aus den Live-Daten,
  // auch wenn sie in den Bereich eines anderen Agenten fällt. 3. Stichwort passt zu einem Auftrag → ausführen.
  const exact = list.find((c) => c.label.toLowerCase() === t.toLowerCase());
  // Mit angebundenem Claude: der Agent versteht jede Formulierung, nutzt seine Werkzeuge und antwortet selbst.
  if (!exact) {
    const ai = await askAgent(actor, origin, id, t, history).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
    if (ai.ok) return { understood: true, reply: ai.note.text, actions: [], ai: ai.note };
    if (ai.reason && !/nicht angebunden/.test(ai.reason)) return { understood: true, reply: `Claude konnte gerade nicht antworten: ${ai.reason} Ich antworte regelbasiert:\n\n${(await ask(t, id).catch(() => null))?.reply || `Das habe ich ohne Modell nicht verstanden. Ich kann: ${list.map((c) => `„${c.label}“`).join(', ')}.`}`, actions: [] };
  }
  if (!exact) {
    const b = await withTimeout(ask(t, id), 20_000, 'Die Antwort').catch(() => null);
    if (b) {
      await adminAudit(actor, 'hq_command', null, { agent: id, intent: b.intent });
      const by = b.agent !== id && AGENT_NAMES[b.agent] ? ` (aus dem Bereich von ${AGENT_NAMES[b.agent]})` : '';
      return { understood: true, reply: `${b.reply}${by}`, actions: b.actions };
    }
  }
  const cmd = exact || list.find((c) => c.keys.test(t));
  if (!cmd) return { understood: false, reply: `Das habe ich nicht verstanden. Ich kann: ${list.map((c) => `„${c.label}“`).join(', ')}. ${BRAIN_HELP}` };
  const prev = await loadShift();
  let ov: Promise<Overview> | null = null;
  const ctx: Ctx = { actor, origin, prev, force: true, overview: () => (ov ||= buildOverview('owner')) };
  const r = await withTimeout(cmd.run(ctx), 25_000, 'Der Auftrag');
  await adminAudit(actor, 'hq_command', null, { agent: id, command: cmd.label });
  return { understood: true, ...r };
}

// ---------- Denken nach der Wache ----------
// Punkte, für die das Modell schon eine Analyse geliefert hat, werden 6 Stunden nicht erneut analysiert (Kosten).
const SEEN_KEY = 'hq_ai_seen';
export async function runAnalyses(actor: string, origin: string, limit = 2, only?: string[]): Promise<{ done: string[]; skipped?: string }> {
  const g = await gate(only ? 'user' : 'auto');
  if (!g.ok) return { done: [], skipped: g.reason };
  if (!g.settings.auto && !only) return { done: [], skipped: 'Automatische Analyse ist ausgeschaltet.' };
  const db = supabaseAdmin();
  const [shift, { data: seenRow }] = await Promise.all([loadShift(), db.from('lr_settings').select('value').eq('key', SEEN_KEY).maybeSingle()]);
  const seen = { ...((seenRow?.value as Record<string, number>) || {}) }, now = Date.now();
  for (const [k, t] of Object.entries(seen)) if (now - t > 2 * D) delete seen[k];
  const todo = Object.values(shift).filter((r) => (only ? only.includes(r.id) : (r.aiQueue || []).some((k) => !seen[k] || now - seen[k] > 24 * H))).slice(0, limit);
  const done: string[] = [];
  for (const r of todo) {
    const t = await analyseRun(actor, origin, r, Boolean(only)).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
    if (!t.ok) { await saveShift({ [r.id]: { ...r, ai: { at: new Date().toISOString(), text: `Analyse nicht möglich: ${t.reason}`, model: '-', usd: 0, grund: 'analyse' }, aiQueue: undefined } }, 'hq'); continue; }
    for (const k of r.aiQueue || []) seen[k] = now;
    await saveShift({ [r.id]: { ...r, ai: t.note, aiQueue: undefined } }, 'hq');
    done.push(r.id);
  }
  if (todo.length) await db.from('lr_settings').upsert({ key: SEEN_KEY, value: seen, updated_at: new Date().toISOString(), updated_by: 'hq' });
  return { done };
}

// Tagesrunde: ab 6 Uhr (Berlin) einmal je Abteilung, über mehrere Wache-Läufe verteilt, damit kein Lauf zu lange dauert.
const DAILY_KEY = 'hq_ai_daily';
export async function runDaily(actor: string, origin: string, perRun = 3, force = false): Promise<{ done: string[]; skipped?: string }> {
  const g = await gate();
  if (!g.ok) return { done: [], skipped: g.reason };
  if (!g.settings.daily && !force) return { done: [], skipped: 'Tagesrunde ist ausgeschaltet.' };
  const db = supabaseAdmin();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(new Date()));
  if (hour < 6 && !force) return { done: [], skipped: 'Tagesrunde läuft ab 6 Uhr.' };
  const { data } = await db.from('lr_settings').select('value').eq('key', DAILY_KEY).maybeSingle();
  const st = { ...({ day: '', done: [] as string[] }), ...((data?.value as { day: string; done: string[] } | null) || {}) };
  if (st.day !== day) { st.day = day; st.done = []; }
  const dayNo = Math.floor(Date.parse(day) / 864e5);
  const todayAgents = DAILY_AGENTS.filter((a, i) => a === 'briefing' || (i + dayNo) % 3 === 0);
  const todo = todayAgents.filter((a) => !st.done.includes(a)).slice(0, perRun);
  if (!todo.length) return { done: [] };
  const done: string[] = [];
  for (const a of todo) {
    const t = await dailyThink(actor, origin, a).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
    st.done.push(a);
    const cur = (await loadShift())[a];
    if (cur) await saveShift({ [a]: { ...cur, ai: t.ok ? t.note : { at: new Date().toISOString(), text: `Tagesrunde nicht möglich: ${t.reason}`, model: '-', usd: 0, grund: 'tag' } } }, 'hq');
    if (t.ok) done.push(a);
    await db.from('lr_settings').upsert({ key: DAILY_KEY, value: st, updated_at: new Date().toISOString(), updated_by: 'hq' });
    if (!t.ok && /Budget|Tagesgrenze|Guthaben/.test(t.reason)) break;
  }
  return { done };
}

// ---------- „Jetzt erledigen“ (von Feray getippt) ----------
// 1) Agent arbeitet (Internes sofort) · 2) Steht noch etwas offen: Claude sucht die Ursache, behebt Internes mit seinen
// Werkzeugen und legt für den Rest Lösungen an · 3) nachprüfen. Ist alles weg, verschwindet die alte Analyse – der Agent
// meldet „erledigt“ und arbeitet in der nächsten Wache-Runde weiter an neuen Funden.
export async function doNow(actor: string, origin: string, id: AgentId): Promise<{ agents: Record<string, AgentRun>; text: string }> {
  const t0 = Date.now();
  // Ava: „Erledigen“ heißt die wartenden Entwürfe überarbeiten (im Hintergrund, in Paketen) – das erste Paket sofort.
  if (id === 'freigaben' || id === 'postfach') {
    const rv = await startReview(id);
    const b = await runReviewBatch(actor, origin, t0 + 95_000).catch(() => null);
    const st = await runShift(actor, origin, [id], true);
    const cur = await loadReview();
    return { agents: st, text: cur?.active ? `${AGENT_NAMES[id]} überarbeitet die Entwürfe: ${cur.done.length} von ${rv.total} geprüft, ${cur.changed} verbessert. Der Rest läuft im Hintergrund weiter – Fortschritt steht in der Karte.` : `${AGENT_NAMES[id]}: alle ${rv.total} Entwürfe geprüft, ${cur?.changed ?? 0} verbessert. Nichts wurde gesendet; Originale sind gesichert.${b ? '' : ''}` };
  }
  let st = await runShift(actor, origin, [id], true);
  let r = st[id];
  if (!r || r.status === 'ok') {
    if (r?.ai) st = await saveShift({ [id]: { ...r, ai: undefined, aiQueue: undefined } }, 'hq');
    return { agents: st, text: `${AGENT_NAMES[id]}: erledigt – nichts mehr offen.` };
  }
  const t = await analyseRun(actor, origin, r, true).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
  if (!t.ok) return { agents: st, text: t.reason };
  if (Date.now() - t0 < 42_000) { st = await runShift(actor, origin, [id], true); r = st[id]; }
  const done = r.status === 'ok';
  st = await saveShift({ [id]: { ...r, ai: done ? undefined : t.note, aiQueue: undefined } }, 'hq');
  return { agents: st, text: done ? `${AGENT_NAMES[id]}: erledigt. ${t.note.text.split(/(?<=[.!?])\s/)[0]}` : `${AGENT_NAMES[id]} hat gearbeitet – Ergebnis und Lösungen stehen in der Karte.` };
}
