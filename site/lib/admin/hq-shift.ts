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

// LeaseRun HEADQUARTERS · digital staff. Each staff member is a real automated job that does one task for LeaseRun.
// All run in parallel. Result per staff member: one sentence, a status and – where needed – a button.
// Only internal work is done automatically (fetching email, blocking attackers, checking off events, checks).
// Anything that goes out (e.g. payment reminders to customers) needs a tap by the owner.
export type { AgentAction, AgentRun } from '@/lib/admin/hq-store';
export { AGENT_IDS, type AgentId } from '@/lib/admin/hq-agents';
export { loadShift } from '@/lib/admin/hq-store';
type Out = Omit<AgentRun, 'id' | 'at' | 'ms' | 'ai' | 'aiQueue'>;
const H = 3_600_000, D = 24 * H;
const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
const ago = (t: string | null | undefined) => {
  if (!t) return 'never';
  const h = Math.round((Date.now() - new Date(t).getTime()) / H);
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} is taking too long`)), ms))]);

type Ctx = { actor: string; origin: string; overview: () => Promise<Overview>; prev: Record<string, AgentRun>; force: boolean; views?: AgentView[] };

const optIssues = (r: OptReport): Issue[] => r.findings.filter((f) => f.level !== 'niedrig').slice(0, 30).map((f) => ({ id: `opt:${f.id}`, level: f.level, title: f.title, customer: f.area === 'Links' || f.area === 'Darstellung' || f.area === 'Display' }));
const optLine = (r: OptReport): Out => ({ ...optLine0(r), issues: optIssues(r), metrics: { funde: r.findings.length, wichtig: r.findings.filter((f) => f.level === 'hoch').length } });
const optLine0 = (r: OptReport): Out => {
  const hi = r.findings.filter((f) => f.level === 'hoch').length;
  const done = r.fixed.length ? ` Fixed myself: ${r.fixed.join(' · ')}.` : '';
  const disp = r.display ? ` Rendering checked in the browser ${new Date(r.display.at).toLocaleString('en-US', { timeZone: 'Europe/Berlin', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${r.display.pages} pages, phone and desktop).` : ' Browser rendering check has not run yet.';
  if (!r.findings.length) return { status: 'ok', line: `${r.pages} pages checked – nothing to improve.${done}${disp}` };
  return { status: hi ? 'todo' : 'ok', line: `${r.pages} pages checked: ${r.findings.length} improvement${r.findings.length === 1 ? '' : 's'} found${hi ? `, ${hi} important` : ''} – top: ${r.findings[0].title}.${done}${disp}`, actions: [{ id: 'opt', label: 'View proposals' }] };
};
const RUN: Record<AgentId, (c: Ctx) => Promise<Out>> = {
  // Noah Sullivan · SEO & optimization: checks website and system on his own, fixes internal things, proposes the rest.
  async optimierung(c) {
    const last = await loadOptimizer();
    if (!c.force && last && Date.now() - new Date(last.at).getTime() < 6 * H) return optLine(last);
    return optLine(await runOptimizer(c.origin));
  },
  // Sophie Turner · Marketing: reads reach, sources, checkout and newsletter and makes reasoned proposals; drafts
  // newsletter and post copy as templates. Never publishes or sends herself (recalculated at most every 6 h).
  async marketing(c) {
    const last = await loadMarketing();
    const r: MReport = !c.force && last && Date.now() - new Date(last.at).getTime() < 6 * H ? last : await runMarketing(7);
    const issues: Issue[] = r.findings.filter((f) => f.level !== 'niedrig').map((f) => ({ id: `mkt:${f.id}`, level: f.level, title: f.title, customer: /kaufen|Kasse|Preise|buy|checkout|pricing/i.test(f.title) }));
    const metrics = { besucher: r.visitors, aufrufe: r.views, kasse_rate: r.funnel.rate, abonnenten: r.newsletter.confirmed };
    const hi = r.findings.filter((f) => f.level === 'hoch');
    const line = `${marketingSummary(r)}${r.findings.length ? ` ${n(r.findings.length, 'proposal', 'proposals')}${hi.length ? `, ${hi.length} important` : ''} – top: ${r.findings[0].title}.` : ' Nothing unusual.'} ${n(r.drafts.length, 'draft is', 'drafts are')} ready – nothing goes out without you.`;
    return { status: hi.length ? 'todo' : 'ok', line, actions: [{ id: 'ask', label: 'Marketing ideas', q: 'Marketing ideas' }, { id: 'open', label: 'Open analytics', tab: 'analyse', sg: 'b2c' }], issues, metrics };
  },
  // Emily Carter · Email: fetches new email from Resend.
  async postfach() {
    const db = supabaseAdmin();
    const st = await syncReceivedDetailed(50);
    if (!st.ok) return { status: 'error', line: st.error || "Email couldn't be fetched.", actions: [{ id: 'open', label: 'Open inbox', tab: 'postfach' }], issues: [{ id: 'mail:sync', level: 'hoch', title: "Email can't be fetched" }] };
    const [{ data: last }, { data: unread }] = await Promise.all([
      db.from('lr_mail_messages').select('received_at').eq('direction', 'in').order('received_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('lr_mail_messages').select('id, subject, text_body, received_at').eq('direction', 'in').eq('folder', 'inbox').is('read_at', null).gte('received_at', new Date(Date.now() - 30 * D).toISOString()).limit(100),
    ]);
    const lastAt = (last?.received_at as string | undefined) || null;
    // Sort unread mail by urgency (fixed rules): legal deadlines first.
    const RULES: [RegExp, string, string][] = [
      [/refund|chargeback|dispute/i, 'Refund request', 'process per the LeaseRun refund policy; respond to card disputes before the Stripe deadline'], [/cancel|unsubscribe/i, 'Cancellation', 'confirm the cancellation promptly (auto-renewal rules)'],
      [/ccpa|cpra|privacy request|delete my (data|account)|do not sell|right to know|data request/i, 'Privacy request', 'confirm within 10 business days, respond within 45 days (CCPA/CPRA)'],
      [/attorney|lawyer|lawsuit|cease and desist|subpoena|legal notice|court/i, 'Legal', 'look right away, note any deadlines in the letter'], [/past due|collections|payment reminder|overdue/i, 'Payment reminder', 'check the payment'],
      [/complaint|not working|doesn'?t work|error|broken|charged|not unlocked|can'?t log ?in/i, 'Customer issue', 'customer is waiting for help'],
    ];
    const issues: Issue[] = [], urgent: string[] = [];
    for (const m of unread ?? []) {
      const t = `${m.subject || ''} ${(m.text_body || '').slice(0, 2000)}`;
      const r = RULES.find(([re]) => re.test(t));
      if (!r) continue;
      const age = Math.floor((Date.now() - new Date(m.received_at as string).getTime()) / D);
      issues.push({ id: `mail:${m.id}`, level: r[1] === 'Customer issue' && age < 1 ? 'mittel' : 'hoch', title: `${r[1]} unread${age ? ` for ${age} day${age === 1 ? '' : 's'}` : ''}: "${String(m.subject || '(no subject)').slice(0, 50)}"`, customer: true });
      urgent.push(`${r[1]} (${r[2]})`);
    }
    const metrics = { ungelesen: (unread ?? []).length, neu: st.fetched || 0 };
    const pre = urgent.length ? `Read first: ${[...new Set(urgent)].slice(0, 2).join(' · ')}. ` : '';
    if (st.fetched) return { status: 'todo', line: `${pre}${n(st.fetched, 'new email', 'new emails')} fetched and placed in the inbox.`, actions: [{ id: 'open', label: 'Read', tab: 'postfach' }], issues, metrics };
    if (!st.listed) return { status: 'todo', line: `${pre}Not a single email has arrived at Resend (last email in the inbox: ${ago(lastAt)}). Resend isn't receiving mail – check in Resend → Domains → leaserun.com that everything is "Verified".`, issues: [...issues, { id: 'mail:resend-none', level: 'hoch', title: 'No mail is arriving at Resend' }], metrics };
    if (issues.length) return { status: 'todo', line: `${pre}${n((unread ?? []).length, 'unread email', 'unread emails')} in the inbox.`, actions: [{ id: 'open', label: 'Read', tab: 'postfach' }], issues, metrics };
    if (!lastAt || Date.now() - new Date(lastAt).getTime() > 2 * D) return { status: 'ok', line: `Inbox is up to date. Last email received: ${ago(lastAt)}.`, metrics };
    return { status: 'ok', line: 'Inbox is up to date – no new email.', metrics };
  },
  // Jake Morrison · Security: checks and handles safe items himself (block attackers, check off repelled events).
  async sicherheit(c) {
    const r = await applyFixes(c.actor, { all: true, areas: ['Sicherheit'], origin: c.origin });
    const done = r.results.filter((x) => x.ok).map((x) => x.text.replace(/ ✓$/, ''));
    const left = r.findings.filter((f) => f.area === 'Sicherheit');
    const issues: Issue[] = left.map((f) => ({ id: `sec:${f.id}`, level: f.sev === 'critical' ? 'hoch' : f.sev === 'warning' ? 'mittel' : 'niedrig', title: f.title }));
    const metrics = { offen: left.length, erledigt: done.length };
    if (left.length) return { status: 'todo', line: `${done.length ? `Done: ${done.join(' · ')}. ` : ''}Needs you: ${left[0].title}${left[0].how ? ` – ${left[0].how}` : ''}`, actions: [{ id: 'open', label: 'View', tab: 'hq' }], issues, metrics };
    return { status: 'ok', line: done.length ? `Done: ${done.join(' · ')}.` : 'All secure – no open attacks.', metrics };
  },
  // Olivia Brooks · Product & tech: checks Stripe, webhooks, email domain, DNS and database live (at most every 30 minutes).
  async technik(c) {
    // Same (cached) live check as "Check & fix" – no duplicate queries to Stripe & co.
    const checks = await liveChecksCached(c.origin, c.force);
    const bad = checks.filter((x) => x.state === 'fail'), warn = checks.filter((x) => x.state === 'warn');
    const issues: Issue[] = [...bad.map((x) => ({ id: `tech:${x.id}`, level: 'hoch' as const, title: `${x.label}: ${x.info}`.slice(0, 120), customer: /stripe|zahlung|payment|webhook|auth|anmeld|sign/i.test(x.label) })), ...warn.map((x) => ({ id: `tech:${x.id}`, level: 'niedrig' as const, title: `${x.label}: ${x.info}`.slice(0, 120) }))];
    const metrics = { stoerungen: bad.length, hinweise: warn.length };
    if (bad.length) return { status: 'todo', line: `${n(bad.length, 'outage', 'outages')}: ${bad.slice(0, 2).map((x) => `${x.label} – ${x.info}`).join(' · ')}`, actions: [{ id: 'open', label: 'View check', tab: 'hq' }], issues, metrics };
    return { status: 'ok', line: `${n(checks.length - warn.length, 'check', 'checks')} OK${warn.length ? ` · ${n(warn.length, 'note', 'notes')}: ${warn[0].label}` : ''}.`, issues, metrics };
  },
  // Ryan Mitchell · Finance: finds overdue business invoices; reminders only go out after a tap.
  async finanzen() {
    const db = supabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const { data: open } = await db.from('lr_invoices').select('id, invoice_number, due_date').in('payment_status', ['PENDING', 'OVERDUE']).eq('kind', 'invoice').not('account_id', 'is', null).lt('due_date', today).limit(200);
    const rows = open ?? [];
    if (!rows.length) return { status: 'ok', line: 'No overdue invoices.' };
    const { data: sent } = await db.from('lr_admin_audit').select('target').eq('action', 'invoice_remind').in('target', rows.map((x) => x.id)).gte('created_at', new Date(Date.now() - 7 * D).toISOString());
    const recent = new Set((sent ?? []).map((x) => x.target));
    const due = rows.filter((x) => !recent.has(x.id));
    if (!due.length) return { status: 'ok', line: `${n(rows.length, 'invoice is', 'invoices are')} overdue – a reminder was already sent in the last 7 days.` };
    const od = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / D);
    const issues: Issue[] = due.map((x) => ({ id: `inv:${x.id}`, level: od(x.due_date as string) > 14 ? 'hoch' : 'mittel', title: `Invoice ${x.invoice_number} overdue for ${od(x.due_date as string)} days` }));
    return { issues, metrics: { ueberfaellig: rows.length }, status: 'todo', line: `${n(due.length, 'invoice is', 'invoices are')} overdue and ${due.length === 1 ? 'waits' : 'wait'} for a payment reminder.`, actions: [{ id: 'remind', label: `Send reminder${due.length === 1 ? '' : 's'} (${due.length})`, confirm: `Send ${n(due.length, 'payment reminder', 'payment reminders')} to the customers now?`, ids: due.map((x) => x.id) }, { id: 'open', label: 'View', tab: 'cockpit', sg: 'b2b' }] };
  },
  // Madison Hayes · Sales: new requests and businesses waiting for approval.
  async vertrieb(c) {
    const o = await c.overview();
    const req = o.metrics.find((m) => m.key === 'requests')?.value || 0;
    const ver = o.alerts.filter((a) => a.target === 'unternehmen' && a.attention);
    const parts: string[] = [], actions: AgentAction[] = [];
    if (req) { parts.push(`${n(req, 'new request is', 'new requests are')} waiting for a reply`); actions.push({ id: 'open', label: 'Open requests', tab: 'anfragen', sg: 'b2b' }); }
    if (ver.length) { parts.push(ver.map((a) => a.title).join(' · ')); actions.push({ id: 'open2', label: 'Review businesses', tab: 'partner', sg: 'b2b' }); }
    return parts.length ? { status: 'todo', line: `${parts.join(' · ')}.`, actions } : { status: 'ok', line: 'No open requests.' };
  },
  // Tyler Reed · Support: website errors and webhook problems.
  async support(c) {
    // Tyler · customer journey: errors customers saw, form and checkout problems, drop-offs (lib/admin/kundenreise.ts).
    const last = await loadKundenReport();
    const r: KReport = !c.force && last && Date.now() - new Date(last.at).getTime() < 10 * 60_000 ? last : await kundenReport();
    const o = await c.overview();
    const hook = o.alerts.find((x) => x.attention && x.id === 'b2b-webhook');
    const issues: Issue[] = r.issues.map((i) => ({ id: i.id, level: i.level, title: i.title, customer: i.customer }));
    if (hook) issues.push({ id: 'b2b-webhook', level: 'mittel', title: `${hook.title}: ${hook.detail}`.slice(0, 120) });
    const cust = r.issues.filter((i) => i.customer && i.level !== 'niedrig');
    const co = r.checkout, fu = r.funnel;
    const kasse = co && co.total ? ` Checkout (3 days): ${co.total} opened, ${co.complete} paid${co.expired + co.open ? `, ${co.expired + co.open} without purchase` : ''}${co.declined ? `, ${co.declined} declined` : ''}.` : '';
    const metrics: Record<string, number> = { kundenfehler: cust.length, ...(co ? { kasse_offen: co.total, kasse_bezahlt: co.complete } : {}), ...(fu ? { kassenstarts: fu.start } : {}) };
    const done = r.fixed.length ? ` Fixed myself: ${r.fixed.join(' · ')}.` : '';
    if (cust.length || hook) return { status: 'todo', line: `${n(cust.length, 'customer issue', 'customer issues')} – first: ${cust[0]?.title || hook?.title}.${kasse}${done}`, actions: [{ id: 'ask', label: 'Issues & solutions', q: 'Show customer issues' }], issues, metrics };
    return { status: 'ok', line: `No customer has hit an error.${kasse}${done}`, issues, metrics };
  },
  // Ava Bennett · Approvals: collects everything that would go out and waits for the owner's approval. Never sends anything herself.
  // She reports drafts only if new ones were added since the last report (visible for 6 h) or some are older than
  // 14 days – otherwise the line stays "ok" (the same waiting drafts don't trigger the same report every shift).
  async freigaben(c) {
    const db = supabaseAdmin(), now = new Date().toISOString(), today = now.slice(0, 10);
    const pm = c.prev.freigaben?.metrics || {}, draftQ = () => db.from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf');
    const rv = await loadReview().catch(() => null);
    const rvLine = rv?.active ? `Revising the drafts: ${rv.done.length} of ${rv.total} checked, ${rv.changed} improved (continues in the background). ` : rv && Date.now() - new Date(rv.started).getTime() < 2 * D ? `Drafts revised: ${rv.done.length} checked, ${rv.changed} improved – originals saved. ` : '';
    const [drafts, newest, stale, books, inv, crea] = await Promise.all([
      draftQ(),
      db.from('lr_mail_messages').select('created_at').eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      draftQ().lt('created_at', new Date(Date.now() - 14 * D).toISOString()),
      db.from('lr_bookings').select('id', { count: 'exact', head: true }).eq('status', 'angefragt').gte('starts_at', now),
      db.from('lr_invoices').select('id', { count: 'exact', head: true }).in('payment_status', ['PENDING', 'OVERDUE']).eq('kind', 'invoice').not('account_id', 'is', null).lt('due_date', today),
      db.from('lr_creators').select('id', { count: 'exact', head: true }).in('status', ['SUBMITTED', 'UNDER_REVIEW']),
    ]);
    // State = creation time of the newest draft already reported. Without a prior state (first round) today's counts as reported.
    const top = newest.data?.created_at ? new Date(newest.data.created_at as string).getTime() : 0;
    const stand = typeof pm.entwurf_stand === 'number' ? pm.entwurf_stand : top;
    const fresh = top > stand ? (await draftQ().gt('created_at', new Date(stand).toISOString())).count || 0 : 0;
    const still = Date.now() < (pm.entwurf_neu_bis || 0) ? pm.entwurf_neu || 0 : 0;
    const neu = Math.min(drafts.count || 0, fresh + still), old = stale.count || 0;
    const dm = { entwurf_stand: Math.max(stand, top), entwurf_neu: neu, entwurf_neu_bis: fresh ? Date.now() + 6 * H : neu ? pm.entwurf_neu_bis || 0 : 0, entwuerfe: drafts.count || 0, entwuerfe_veraltet: old };
    const parts: string[] = [], actions: AgentAction[] = [];
    if (drafts.count) actions.push({ id: 'open', label: 'Review drafts', tab: 'postfach' });
    if (neu) parts.push(`${n(neu, 'new email draft', 'new email drafts')} since the last report (${drafts.count} ready in total)`);
    if (old) parts.push(`${n(old, 'draft is', 'drafts are')} older than 14 days – outdated, archive?`);
    if (books.count) { parts.push(`${n(books.count, 'appointment request', 'appointment requests')} to confirm`); actions.push({ id: 'open2', label: 'Open appointments', tab: 'termine' }); }
    const soon = books.count ? (await db.from('lr_bookings').select('id', { count: 'exact', head: true }).eq('status', 'angefragt').gte('starts_at', now).lt('starts_at', new Date(Date.now() + D).toISOString())).count || 0 : 0;
    if (soon) parts.unshift(`Urgent: ${n(soon, 'appointment starts', 'appointments start')} in less than 24 h and ${soon === 1 ? 'is' : 'are'} not confirmed yet`);
    const issues: Issue[] = [
      ...(soon ? [{ id: 'frei:termin24', level: 'hoch' as const, title: `${n(soon, 'appointment', 'appointments')} in under 24 h unconfirmed`, customer: true }] : []),
      ...(neu ? [{ id: 'frei:entwurf', level: 'mittel' as const, title: `${n(neu, 'new email draft', 'new email drafts')} for approval` }] : []),
      ...(old ? [{ id: 'frei:veraltet', level: 'niedrig' as const, title: `${n(old, 'draft', 'drafts')} older than 14 days – archive?` }] : []),
      ...(books.count && books.count > soon ? [{ id: 'frei:termin', level: 'mittel' as const, title: `${n(books.count, 'appointment request', 'appointment requests')} to confirm`, customer: true }] : []),
      ...(crea.count ? [{ id: 'frei:creator', level: 'niedrig' as const, title: `${n(crea.count, 'creator application', 'creator applications')} to decide` }] : []),
    ];
    if (inv.count) { parts.push(`${n(inv.count, 'payment reminder', 'payment reminders')} prepared`); actions.push({ id: 'open3', label: 'Open invoices', tab: 'rechnungen', sg: 'b2b' }); }
    if (crea.count) { parts.push(`${n(crea.count, 'creator application', 'creator applications')} to decide`); actions.push({ id: 'open4', label: 'Open creators', tab: 'creator', sg: 'b2b' }); }
    const bereit = drafts.count ? `${n(drafts.count, 'draft is', 'drafts are')} ready, nothing goes out without you.` : '';
    const metrics = { wartend: (drafts.count || 0) + (books.count || 0) + (crea.count || 0), ...dm };
    if (parts.length) return { status: 'todo', line: `${rvLine}${parts.join(' · ')}. None of this goes out without you.${drafts.count && !neu ? ` ${bereit}` : ''}`, actions, issues, metrics };
    return { status: 'ok', line: `${rvLine}${bereit || 'Nothing is waiting for your approval.'}`, actions: actions.length ? actions : undefined, metrics };
  },
  // Chloe Parker · Creators: keeps track of applications and questions in the creator program (the owner decides).
  async creator() {
    const db = supabaseAdmin();
    const [rev, info, act] = await Promise.all([
      db.from('lr_creators').select('id', { count: 'exact', head: true }).in('status', ['SUBMITTED', 'UNDER_REVIEW']),
      db.from('lr_creators').select('id', { count: 'exact', head: true }).eq('status', 'INFO_REQUESTED'),
      db.from('lr_creators').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    ]);
    if (rev.error) return { status: 'ok', line: 'The creator program is not set up yet.' };
    if (rev.count) return { status: 'todo', line: `${n(rev.count, 'application is', 'applications are')} waiting for review${info.count ? ` · ${n(info.count, 'question open', 'questions open')}` : ''}. ${n(act.count || 0, 'creator is', 'creators are')} active.`, actions: [{ id: 'open', label: 'Review applications', tab: 'creator', sg: 'b2b' }] };
    return { status: 'ok', line: `No open applications · ${n(act.count || 0, 'creator active', 'creators active')}${info.count ? ` · ${n(info.count, 'question', 'questions')} with the creator` : ''}.` };
  },
  // Hannah Walsh · New customers: from visitor to sign-up to purchase (7 days).
  async neukunden() {
    const db = supabaseAdmin();
    const [kz, { count: reg }, { data: k }] = await Promise.all([
      // Checkout and funnel only from the shared metric (without test accounts, admin sessions and the same person).
      kasseKennzahl(7 * 24),
      db.from('lr_user_data').select('user_id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * D).toISOString()),
      db.from('lr_kaeufe').select('id, erstattet_at').gte('created_at', new Date(Date.now() - 7 * D).toISOString()),
    ]);
    const fu = kz.trichter, co = kz.checkout;
    const buys = (k ?? []).filter((x) => !x.erstattet_at).length, regs = reg || 0;
    // "high" only from 3 different outside people without a purchase; if it's only own test traffic, at most a note.
    const issues: Issue[] = [];
    if (kz.nurTest) { if (kz.davon_eigene || kz.gestartet || kz.geoeffnet) issues.push({ id: 'neu:kasse-test', level: 'niedrig', title: kz.hinweis }); }
    else if (kz.alarm) issues.push({ id: 'neu:kasse-ohne-kauf', level: 'hoch', title: `${kz.personen} people started checkout, but no purchase in 7 days`, customer: true });
    else if (!kz.bezahlt) issues.push({ id: 'neu:kasse-ohne-kauf', level: 'mittel', title: `${kz.personen} people started checkout, no purchase yet in 7 days`, customer: true });
    else if (kz.gestartet >= 10 && kz.bezahlt / kz.gestartet < 0.3) issues.push({ id: 'neu:kasse-quote', level: 'mittel', title: `Only ${kz.bezahlt} of ${kz.gestartet} checkout starts turn into a purchase`, customer: true });
    if (fu && fu.pricing >= 20 && fu.open / fu.pricing < 0.08) issues.push({ id: 'neu:preisseite', level: 'mittel', title: `Pricing page: ${fu.pricing} people, only ${fu.open} opened checkout` });
    if (regs >= 5 && !buys) issues.push({ id: 'neu:reg-ohne-kauf', level: 'mittel', title: `${regs} new accounts, but no purchase` });
    const metrics = { registrierungen: regs, kaeufe: buys, ...(fu ? { preisseite: fu.pricing, kassenstarts: fu.start } : {}) };
    const line = `7 days: ${n(regs, 'new account', 'new accounts')}, ${n(buys, 'purchase', 'purchases')}${fu ? `, pricing page ${fu.pricing} visitors, checkout opened ${fu.open}, to Stripe ${fu.start} (without own tests)` : ''}.${co ? ` Stripe (7 days): ${co.total} outside checkouts from ${n(co.people, 'person', 'people')}${co.own ? `, ${co.own} own sessions not counted` : ''}.` : ''}`;
    if (!issues.some((i) => i.level !== 'niedrig')) return { status: 'ok', line: `${line} ${issues.length ? `${issues[0].title}.` : 'The path to purchase looks normal.'}`, issues, metrics, actions: [{ id: 'ask', label: 'Ideas for more customers', q: 'How do more visitors become customers? Three proposals with numbers.' }] };
    return { status: issues.some((i) => i.level === 'hoch') ? 'todo' : 'ok', line: `${line} Notable: ${issues[0].title}.`, issues, metrics, actions: [{ id: 'ask', label: 'Cause & proposals', q: 'Why do visitors drop off before buying and what do we change? With numbers.' }, { id: 'open', label: 'Open analytics', tab: 'analyse', sg: 'b2c' }] };
  },
  // Liam Foster · Customer success: active subscriptions, expiring access, quiet accounts, refunds.
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
    if (soon.length) issues.push({ id: 'best:laeuft-aus', level: soon.length >= 3 ? 'hoch' : 'mittel', title: `${n(soon.length, 'access expires', 'accesses expire')} in the next 14 days`, customer: true });
    if (lapsed.length) issues.push({ id: 'best:nicht-verlaengert', level: 'mittel', title: `${n(lapsed.length, 'customer has', 'customers have')} not renewed in 30 days`, customer: true });
    if (refunds >= 2) issues.push({ id: 'best:erstattungen', level: 'mittel', title: `${n(refunds, 'refund', 'refunds')} in 30 days` });
    if (active.length >= 5 && silent / Math.min(active.length, 500) > 0.5) issues.push({ id: 'best:still', level: 'niedrig', title: `${silent} active customers haven't used their account in over 30 days` });
    const metrics = { aktiv: active.length, laeuft_aus: soon.length, nicht_verlaengert: lapsed.length, erstattungen: refunds, still: silent };
    const line = `${n(active.length, 'active customer', 'active customers')}${soon.length ? `, ${soon.length} expiring soon` : ''}${lapsed.length ? `, ${lapsed.length} not renewed` : ''}${refunds ? `, ${n(refunds, 'refund', 'refunds')} (30 days)` : ''}${silent ? `, ${silent} quiet for 30 days` : ''}.`;
    if (!issues.length) return { status: 'ok', line: `${line} Customer base is stable.`, metrics, actions: [{ id: 'ask', label: 'Retention ideas', q: 'How do we keep existing customers longer? Three proposals with numbers.' }] };
    return { status: issues.some((i) => i.level === 'hoch') ? 'todo' : 'ok', line: `${line} First: ${issues[0].title}.`, issues, metrics, actions: [{ id: 'ask', label: 'What to do?', q: 'Which customers are at risk and what exactly do we do? Prepare drafts only.' }, { id: 'open', label: 'Open users', tab: 'nutzer', sg: 'b2c' }] };
  },
  // Zoe Campbell · Acquisition: contacts (lenders, brokers, property managers, agents), follow-ups (drafts only, nothing goes out).
  async akquise() {
    const db = supabaseAdmin(), now = Date.now();
    const [{ data: c, error }, { data: req }] = await Promise.all([
      db.from('lr_crm_contacts').select('id, company, status, next_at, updated_at').limit(2000),
      db.from('lr_b2b_contact').select('id, created_at').eq('status', 'offen').lt('created_at', new Date(now - 2 * D).toISOString()).limit(50),
    ]);
    if (error) return { status: 'ok', line: 'Acquisition is not set up yet (no contact list).' };
    const l = c ?? [];
    const due = l.filter((x) => x.next_at && new Date(x.next_at as string).getTime() <= now);
    const fresh = l.filter((x) => x.status === 'neu' && now - new Date(x.updated_at as string).getTime() > 3 * D);
    const follow = l.filter((x) => x.status === 'angeschrieben' && !x.next_at && now - new Date(x.updated_at as string).getTime() > 7 * D);
    const open = (req ?? []).length;
    const issues: Issue[] = [];
    if (due.length) issues.push({ id: 'akq:faellig', level: due.length >= 5 ? 'hoch' : 'mittel', title: `${n(due.length, 'follow-up is', 'follow-ups are')} due${due[0]?.company ? `, e.g. ${due[0].company}` : ''}` });
    if (open) issues.push({ id: 'akq:anfragen', level: 'hoch', title: `${n(open, 'business request has', 'business requests have')} been waiting for over 2 days`, customer: true });
    if (follow.length) issues.push({ id: 'akq:nachfassen', level: 'mittel', title: `${n(follow.length, 'contact without a reply', 'contacts without a reply')} for over 7 days – follow up` });
    if (fresh.length) issues.push({ id: 'akq:neu', level: 'niedrig', title: `${n(fresh.length, 'new contact', 'new contacts')} not contacted for 3 days` });
    const metrics = { kontakte: l.length, faellig: due.length, nachfassen: follow.length, offen_anfragen: open };
    const line = `${n(l.length, 'contact', 'contacts')} in acquisition${due.length ? `, ${due.length} due` : ''}${follow.length ? `, ${follow.length} to follow up` : ''}${open ? `, ${open} open requests` : ''}.`;
    if (!issues.length) return { status: 'ok', line: `${line} Nothing is overdue.`, metrics };
    return { status: issues.some((i) => i.level === 'hoch') ? 'todo' : 'ok', line: `${line} First: ${issues[0].title}.`, issues, metrics, actions: [{ id: 'ask', label: 'Prepare follow-up drafts', q: 'Prepare win-win follow-up emails as drafts for the due follow-ups and contacts without a reply (do not send).' }, { id: 'open', label: 'Open requests', tab: 'anfragen', sg: 'b2b' }] };
  },
  // Daniel Hughes · Legal & compliance: legal pages reachable, email duties (consent, unsubscribe link), privacy.
  async recht(c) {
    const pages = await legalPages(c.origin);
    const missing = pages.filter((p) => !p.ok);
    const r = await analyse({ areas: ['E-Mail'] });
    const issues: Issue[] = [
      ...missing.map((p) => ({ id: `recht:seite:${p.path}`, level: 'hoch' as const, title: `Legal page ${p.path} not reachable (${p.status})`, customer: true })),
      ...r.findings.filter((f) => ['mail:optout', 'mail:unsub'].includes(f.id)).map((f) => ({ id: `recht:${f.id}`, level: f.sev === 'critical' ? 'hoch' as const : 'mittel' as const, title: f.title })),
    ];
    if (!process.env.NOTIFY_FROM_EMAIL && !process.env.MAILBOX_FROM_EMAIL) issues.push({ id: 'recht:absender', level: 'niedrig', title: 'No fixed sender for customer emails set (CAN-SPAM requires a clear sender and postal address)' });
    // One-time classification of waiting drafts by legal basis (only mark, nothing is sent or deleted).
    const lg = (await loadLegalSummary().catch(() => null)) || (await classifyWaitingDrafts(c.actor).catch(() => null));
    const metrics = { rechtstexte_ok: pages.length - missing.length, mail_risiken: issues.filter((i) => i.id.startsWith('recht:mail')).length, ...(lg ? { entwuerfe_transaktion: lg.transaktion, entwuerfe_werbung_mit_grundlage: lg.werbung_ok, entwuerfe_gesperrt: lg.gesperrt } : {}) };
    const lgLine = lg ? ` Drafts: ${lg.transaktion} transactional/reply, ${lg.werbung_ok} marketing with a legal basis, ${lg.gesperrt} blocked.` : '';
    if (!issues.length) return { status: 'ok', line: `Company information, privacy policy, terms and refund policy are reachable. No email goes to people who opted out, unsubscribe links present.${lgLine}`, metrics };
    return { status: issues.some((i) => i.level === 'hoch') ? 'todo' : 'ok', line: `Risk: ${issues[0].title}${issues.length > 1 ? ` · ${issues.length - 1} more` : ''}.${lgLine}`, issues, metrics, actions: [{ id: 'ask', label: 'Risks & solution', q: 'Which legal risks are open and what is the safest way to remove them?' }, { id: 'open', label: 'View check', tab: 'hq' }] };
  },
  // Ethan Collins · Daily briefing: sums up the day in one sentence (internal only).
  async briefing(c) {
    const o = await c.overview();
    const kpi = o.metrics.slice(0, 4).map((m) => `${m.label}: ${Number(m.value).toLocaleString('en-US')}`).join(' · ');
    const views = c.views || [];
    // Checkout only from the shared metric: if it's only own test traffic, "checkout without purchase" doesn't become today's priority.
    const kz = await kasseKennzahl(72).catch(() => null);
    const { top, causes } = situation(views, kz);
    const fixedToday = views.filter((v) => /Done:|Fixed myself:|Erledigt:|Selbst erledigt:/.test(v.line)).map((v) => v.name);
    const parts = [top.length ? `First today: ${top.map((t, i) => `${i + 1}) ${t.title} (${t.agent})`).join(' ')}` : 'Nothing urgent is open today'];
    if (causes.length) parts.push(`Connection: ${causes[0]}`);
    if (kz?.nurTest && (kz.davon_eigene || kz.gestartet)) parts.push(kz.hinweis);
    if (fixedToday.length) parts.push(`Handled by ${fixedToday.join(', ')}`);
    if (kpi) parts.push(kpi);
    return { status: top.some((t) => t.level === 'hoch') ? 'todo' : 'ok', line: `${parts.join(' · ')}.`, actions: top.length ? [{ id: 'ask', label: 'Daily briefing', q: 'Daily briefing' }] : undefined, metrics: Object.fromEntries(o.metrics.slice(0, 6).map((m) => [m.key, Number(m.value) || 0])) };
  },
};


// Check legal pages live (at most every 6 hours): status only, no content.
// The real pages (terms at /terms, refund policy at /refund; /legal-notice is the company information page).
const LEGAL = ['/legal-notice', '/privacy', '/terms', '/refund'];
let legalCache: { at: number; v: { path: string; ok: boolean; status: number }[] } | null = null;
async function legalPages(origin: string): Promise<{ path: string; ok: boolean; status: number }[]> {
  if (legalCache && Date.now() - legalCache.at < 6 * H) return legalCache.v;
  const v = await Promise.all(LEGAL.map(async (path) => { try { const r = await fetch(`${origin}${path}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'LeaseRun-HQ' } }); return { path, ok: r.ok, status: r.status }; } catch { return { path, ok: false, status: 0 }; } }));
  legalCache = { at: Date.now(), v }; return v;
}

// Shift: let selected (or all) staff work in parallel and save the result. Then the intelligence layer evaluates
// (memory, trends, escalating long-open items) and Ethan assesses the big picture.
const TREND: Record<string, [string, string][]> = { postfach: [['ungelesen', 'Unread']], support: [['kundenfehler', 'Customer issues'], ['kassenstarts', 'Checkout starts']], finanzen: [['ueberfaellig', 'Overdue']], optimierung: [['funde', 'Improvements']], sicherheit: [['offen', 'Security items']], marketing: [['besucher', 'Visitors'], ['abonnenten', 'Subscribers']] };
const runOne = async (id: AgentId, ctx: Ctx): Promise<AgentRun> => {
  const t0 = Date.now();
  try { const r = await withTimeout(RUN[id](ctx), 25_000, 'The task'); return { id, ...r, at: new Date().toISOString(), ms: Date.now() - t0 }; }
  catch (e) { return { id, status: 'error', line: `Couldn't work: ${(e as Error).message || 'Error'}`.slice(0, 200), at: new Date().toISOString(), ms: Date.now() - t0, issues: [{ id: `${id}:ausfall`, level: 'mittel', title: `${AGENT_NAMES[id]} couldn't work` }] }; }
};
// Same finding key (e.g. kasse:keine-kaeufe) at several agents: only Tyler reports it, the others refer to it
// (severity "low") – so the same item doesn't show up three times as a top priority.
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
      return { ...i, level: 'niedrig' as const, customer: false, title: `See ${AGENT_NAMES[m as AgentId]}: ${i.title}`.slice(0, 160) };
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
    // Without an own list: an open task counts as one item (so it also gets memory and escalation).
    const issues = r.issues ?? (r.status === 'todo' ? [{ id: `${r.id}:todo`, level: 'mittel' as const, title: r.line.slice(0, 90) }] : []);
    const rc = remember(mem, r.id, issues, r.metrics, now);
    // New or recurring and important: customers affected or a tech/security outage → push to the device right away.
    for (const i of [...rc.neu, ...rc.wieder]) if (i.level === 'hoch' && (i.customer || r.id === 'technik' || r.id === 'sicherheit')) alarm.push({ agent: r.id as AgentId, issue: i, wieder: rc.wieder.includes(i) });
    // New important item or a failure → the model should work out cause and solution (runAnalyses, capped).
    const fresh = [...rc.neu, ...rc.wieder].filter((i) => i.level === 'hoch').map((i) => i.id);
    // Ava (waiting list for the owner) and Ethan (daily briefing, own daily round) are not analyzed automatically.
    if ((fresh.length || r.status === 'error') && r.id !== 'freigaben' && r.id !== 'briefing') think[r.id] = fresh.length ? fresh : [`${r.id}:ausfall`];
    days[r.id] = Object.fromEntries(Object.entries(mem[r.id]?.open || {}).map(([k, v]) => [k, Math.floor((+now - +new Date(v.first)) / D)]));
    const tr = (TREND[r.id] || []).map(([k, l]) => trendText(trend(mem, r.id, k, +now, 7), l)).filter(Boolean);
    r.line = `${r.line}${recallText(rc)}${tr.length ? ` Trend: ${tr.join(' · ')}.` : ''}`.slice(0, 900);
    if (rc.escalate && r.status === 'ok') r.status = 'todo';
    r.issues = issues.slice(0, 30);
  }
  // Ethan last: sees this round's fresh results and the latest state of the other agents.
  if (pick.includes('briefing')) {
    const all = { ...prev, ...Object.fromEntries(out.map((r) => [r.id, r])) };
    ctx.views = AGENT_IDS.filter((x) => x !== 'briefing' && all[x]).map((x) => ({ id: x, name: AGENT_NAMES[x], status: all[x].status, line: all[x].line, issues: all[x].issues || [], days: days[x] || Object.fromEntries(Object.entries(mem[x]?.open || {}).map(([k, v]) => [k, Math.floor((+now - +new Date(v.first)) / D)])) }));
    const b = await runOne('briefing', ctx);
    remember(mem, 'briefing', [], b.metrics, now);
    out.push(b);
  }
  const by = actor.includes('@') ? 'admin' : actor;
  // The model's previous analysis stays visible until a new one arrives; new items go into the queue.
  const fresh = (a?: AgentRun['ai']) => (a && Date.now() - new Date(a.at).getTime() < (a.grund === 'tag' ? 24 : 3) * H ? a : undefined);
  const part: Record<string, AgentRun> = Object.fromEntries(out.map((r) => [r.id, { ...r, ai: fresh(prev[r.id]?.ai), aiQueue: think[r.id] || (prev[r.id]?.aiQueue && prev[r.id]?.status !== 'ok' ? prev[r.id]?.aiQueue : undefined) }]));
  const memPart = Object.fromEntries(pick.map((id) => [id, mem[id]]).filter(([, v]) => v)) as typeof mem;
  const [next] = await Promise.all([saveShift(part, by), saveMemory(memPart, by), alarm.length ? alertNow(alarm, by) : Promise.resolve()]);
  // Log only on a manual start or when a result changed – otherwise the 3-minute round would flood the log.
  const changed = out.some((r) => prev[r.id]?.status !== r.status || prev[r.id]?.line !== r.line);
  if (actor !== 'cron' && (force || changed)) await adminAudit(actor, 'hq_shift', null, { agents: pick.join(','), todo: out.filter((r) => r.status !== 'ok').length });
  return next;
}

// ---------- Instant push to the device: new important items from the shift (at most once per item in 6 h) ----------
// Only the reason, no names or amounts (push goes through Expo). Details are in Headquarters.
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
      await pushAdmins(kind, `${AGENT_NAMES[a.agent]}: ${a.wieder ? 'back again' : 'new'} – ${a.issue.customer ? 'customers affected' : 'outage'}`, `${a.issue.title.slice(0, 120)}. Details in Headquarters.`, 'hq_alarm');
    }
  } catch (e) { console.warn('hq_alert', e instanceof Error ? e.message : e); }
}

// ---------- Task for an agent (input field in Headquarters) ----------
// The owner writes in plain language what the agent should do. Fixed, safe tasks per agent are recognized.
// Internal tasks run right away. Anything that would go out is only prepared and needs her tap.
type Cmd = { keys: RegExp; label: string; run: (c: Ctx) => Promise<{ reply: string; actions?: AgentAction[] }> };
const fromRun = (id: AgentId, prefix = '') => async (c: Ctx) => { const r = await RUN[id]({ ...c, force: true }); return { reply: `${prefix}${r.line}`, actions: r.actions }; };
const CMDS: Record<AgentId, Cmd[]> = {
  postfach: [
    { keys: /fetch|get|new|sync|check|abruf|hol|neu|prüf/i, label: 'Fetch new email', run: fromRun('postfach', 'Done: ') },
    { keys: /draft|entw[uü]rf/i, label: 'How many drafts are waiting?', run: async () => { const { count } = await supabaseAdmin().from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf'); return { reply: `${n(count || 0, 'draft is', 'drafts are')} waiting for your approval. Nothing is sent until you tap "Send" in the Inbox.`, actions: [{ id: 'open', label: 'Open drafts', tab: 'postfach' }] }; } },
    { keys: /unread|inbox|ungelesen|posteingang/i, label: 'Count unread', run: async () => { const { count } = await supabaseAdmin().from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'in').eq('folder', 'inbox').is('read_at', null); return { reply: count ? `${n(count, 'unread email', 'unread emails')} in the inbox.` : 'No unread email.', actions: count ? [{ id: 'open', label: 'Read', tab: 'postfach' }] : [] }; } },
  ],
  sicherheit: [
    { keys: /block|attack|clean|fix|sperr|angriff|erledig|aufr[äa]um/i, label: 'Block attackers & clean up', run: async (c) => { const r = await applyFixes(c.actor, { all: true, areas: ['Sicherheit'], origin: c.origin }); const done = r.results.filter((x) => x.ok).map((x) => x.text.replace(/ ✓$/, '')); const left = r.findings.filter((f) => f.area === 'Sicherheit' && !f.auto); return { reply: `${done.length ? `Done: ${done.join(' · ')}.` : 'There was nothing to block or clean up.'}${left.length ? ` Open (only you): ${left.map((f) => f.title).join(' · ')}.` : ''}` }; } },
    { keys: /status|check|secur|lage|pr[üu]f|sicher/i, label: 'Check security status', run: fromRun('sicherheit') },
    { keys: /emergency|kill.?switch|panic|not.?aus/i, label: 'Emergency stop', run: async () => ({ reply: "I deliberately don't trigger the emergency stop myself – only you decide that. The button is in the Security tab.", actions: [{ id: 'open', label: 'Open security', tab: 'sicherheit' }] }) },
  ],
  technik: [
    { keys: /webhook|payment|stripe|zahlung/i, label: 'Test payment webhook', run: async (c) => { const r = await webhookSelfTest(c.origin); return { reply: `${r.label}: ${r.info}` }; } },
    { keys: /check|test|status|all|pr[üu]f|alles/i, label: 'Check everything live', run: fromRun('technik') },
  ],
  finanzen: [
    { keys: /remind|dun|erinner|mahn/i, label: 'Prepare payment reminders', run: async (c) => { const r = await RUN.finanzen({ ...c, force: true }); return { reply: r.actions?.some((a) => a.id === 'remind') ? `${r.line} I prepared them – they only go out when you tap the button.` : r.line, actions: r.actions }; } },
    { keys: /overdue|invoice|open|status|[üu]berf[äa]llig|rechnung|offen/i, label: 'Overdue invoices', run: fromRun('finanzen') },
  ],
  vertrieb: [{ keys: /request|lead|business|status|new|anfrag|unternehm|neu/i, label: 'Open requests', run: fromRun('vertrieb') }],
  support: [
    { keys: /customer issue|solution|show|list|kundenprobl|l[öo]sung|zeig|liste/i, label: 'Show customer issues', run: async () => { const r = (await loadKundenReport()) || (await kundenReport()); const list = r.issues.filter((i) => i.level !== 'niedrig'); return { reply: list.length ? list.slice(0, 8).map((i, k) => `${k + 1}. ${i.title}\n   ${i.detail}`).join('\n') : `No customer has hit an error.${r.fixed.length ? ` Fixed myself: ${r.fixed.join(' · ')}.` : ''}` }; } },
    { keys: /checkout|abandon|payment|purchase|kasse|abbruch|abbr[üu]ch|zahlung|kauf/i, label: 'Check checkout & drop-offs', run: async () => { const r = await kundenReport(); const co = r.checkout, fu = r.funnel; const k = r.issues.filter((i) => i.id.startsWith('kasse:')); return { reply: `${co ? `Stripe (3 days): ${co.total} checkouts opened, ${co.complete} paid, ${co.expired} expired, ${co.open} open, ${co.declined} declined${Object.keys(co.reasons).length ? ` (${Object.entries(co.reasons).map(([a, b]) => `${a} ${b}×`).join(', ')})` : ''}.` : 'Stripe not reachable.'}${fu ? ` Website (${fu.days} days, by person, without own tests): ${fu.pricing} saw pricing, ${fu.open} opened checkout, ${fu.start} went to Stripe, ${fu.back} came back after buying.` : ''}${k.length ? `\n${k.map((i) => `• ${i.title} – ${i.detail}`).join('\n')}` : ' Nothing unusual.'}` }; } },
    { keys: /error|bug|status|website|check|fehler|pr[üu]f/i, label: 'Check now', run: fromRun('support') },
  ],
  freigaben: [{ keys: /what|wait|approv|list|open|status|was|wart|frei|liste|offen/i, label: 'What is waiting for me?', run: fromRun('freigaben') }],
  neukunden: [{ keys: /funnel|purchase|sign.?up|new customer|status|check|numbers|trichter|kauf|registr|neukund|pr[üu]f|zahlen/i, label: 'Check path to purchase', run: fromRun('neukunden') }],
  bestandskunden: [{ keys: /subscri|customer|renew|cancel|churn|status|check|numbers|abo|kund|verl[äa]nger|k[üu]ndig|pr[üu]f|zahlen/i, label: 'Check customer base', run: fromRun('bestandskunden') }],
  akquise: [{ keys: /follow.?up|contact|outreach|acquisition|lender|broker|agent|status|check|due|wiedervorlag|kontakt|nachfass|akquise|pr[üu]f|f[äa]llig/i, label: 'Check follow-ups', run: fromRun('akquise') }],
  recht: [{ keys: /legal|risk|privacy|terms|refund|ccpa|can.?spam|tcpa|status|check|recht|risik|datenschutz/i, label: 'Check legal', run: fromRun('recht') }],
  creator: [{ keys: /appl|creator|question|status|bewerb|r[üu]ckfrag/i, label: 'Review applications', run: fromRun('creator') }],
  briefing: [
    { keys: /briefing|priorit|important|first|connection|cause|lagebild|wichtig|zuerst|zusammenhang|ursache/i, label: 'Daily briefing', run: async () => {
      const [sh, mem] = await Promise.all([loadShift(), loadMemory()]); const now = Date.now();
      const views = AGENT_IDS.filter((x) => x !== 'briefing' && sh[x]).map((x) => ({ id: x, name: AGENT_NAMES[x], status: sh[x].status, line: sh[x].line, issues: sh[x].issues || [], days: Object.fromEntries(Object.entries(mem[x]?.open || {}).map(([k, v]) => [k, Math.floor((now - +new Date(v.first)) / D)])) }));
      const kz = await kasseKennzahl(72).catch(() => null);
      const { top, causes } = situation(views, kz);
      if (kz?.nurTest && (kz.davon_eigene || kz.gestartet)) causes.push(kz.hinweis);
      const old = views.flatMap((v) => v.issues.filter((i) => (v.days[i.id] || 0) >= 2).map((i) => `${i.title} (${v.name}, for ${v.days[i.id]} days)`)).slice(0, 5);
      return { reply: [top.length ? `First today:\n${top.map((t, i) => `${i + 1}. ${t.title} – ${t.agent}${t.customer ? ' · customers affected' : ''}`).join('\n')}` : 'Nothing urgent is open today.', causes.length ? `Connections:\n${causes.map((c) => `• ${c}`).join('\n')}` : '', old.length ? `Open for a long time:\n${old.map((o) => `• ${o}`).join('\n')}` : ''].filter(Boolean).join('\n\n') };
    } },
    { keys: /brief|summar|today|status|day|zusammen|heute|lage|tag/i, label: 'Daily summary', run: async (c) => { const sh = await loadShift(); const r = await runShift(c.actor, c.origin, ['briefing'], true); void sh; return { reply: r.briefing?.line || '–', actions: r.briefing?.actions }; } },
  ],
  optimierung: [
    { keys: /check|optimi|improve|seo|scan|now|pr[üu]f|verbesser|jetzt/i, label: 'Check website now', run: fromRun('optimierung') },
    { keys: /proposal|list|what|show|vorschl|liste|was|zeig/i, label: 'Show proposals', run: async () => { const r = await loadOptimizer(); if (!r) return { reply: 'No check has run yet – say "Check website now".' }; return { reply: r.findings.length ? r.findings.slice(0, 8).map((f, i) => `${i + 1}. ${f.title} – ${f.detail}`).join('\n') : 'No open improvements.' }; } },
  ],
  marketing: [
    { keys: /idea|proposal|what to do|improve|grow|more visitors|more customers|strategy|idee|vorschl|wachs|strategie/i, label: 'Marketing ideas', run: async () => { const r = (await loadMarketing()) || (await runMarketing(7)); return { reply: marketingIdeas(r), actions: [{ id: 'open', label: 'Open analytics', tab: 'analyse', sg: 'b2c' }] }; } },
    { keys: /where from|source|channel|google|social|referr|woher|quelle|kanal/i, label: 'Where do visitors come from?', run: async () => ({ reply: marketingSources((await loadMarketing()) || (await runMarketing(7))) }) },
    { keys: /page|popular|most|top|content|guide|seite|beliebt|meist|inhalt|ratgeber/i, label: 'Most-read pages', run: async () => ({ reply: marketingPages((await loadMarketing()) || (await runMarketing(7))) }) },
    { keys: /newsletter|mailing/i, label: 'Newsletter draft', run: async () => ({ reply: marketingDraft((await loadMarketing()) || (await runMarketing(7)), 'newsletter'), actions: [{ id: 'open', label: 'Open inbox', tab: 'postfach' }] }) },
    { keys: /linkedin|post|beitrag/i, label: 'Draft LinkedIn post', run: async () => ({ reply: marketingDraft((await loadMarketing()) || (await runMarketing(7)), 'linkedin') }) },
    { keys: /instagram|reel|story|tiktok/i, label: 'Draft Instagram caption', run: async () => ({ reply: marketingDraft((await loadMarketing()) || (await runMarketing(7)), 'instagram') }) },
    { keys: /check|now|new|refresh|numbers|status|pr[üu]f|jetzt|neu|aktualis|zahlen|lage/i, label: 'Check marketing now', run: fromRun('marketing') },
  ],
};
export const COMMAND_LABELS: Record<string, string[]> = Object.fromEntries(Object.entries(CMDS).map(([k, v]) => [k, v.map((x) => x.label)]));

export async function runCommand(actor: string, origin: string, id: AgentId | 'zentrale', text: string, history: { me: boolean; t: string }[] = []): Promise<{ reply: string; actions?: AgentAction[]; understood: boolean; ai?: import('@/lib/admin/hq-store').AiNote }> {
  const t = text.trim().slice(0, 1500);
  // "Give me the link to …": the right official URL right away – without AI, so also with an empty credit balance.
  const links = serviceLinks(t);
  if (links) { await adminAudit(actor, 'hq_command', null, { agent: id, intent: 'link' }); return { understood: true, reply: links, actions: [] }; }
  if (id === 'zentrale') {
    const ai = await askAgent(actor, origin, 'zentrale', t, history).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
    if (ai.ok) return { understood: true, reply: ai.note.text, actions: [], ai: ai.note };
    return runCommand(actor, origin, 'briefing', t, history);
  }
  const list = CMDS[id] || [];
  // 1. Exactly one task (button) → run it. 2. Free question → LeaseRun Intelligence answers it from live data,
  // even if it belongs to another agent's area. 3. Keyword matches a task → run it.
  const exact = list.find((c) => c.label.toLowerCase() === t.toLowerCase());
  // With Claude connected: the agent understands any wording, uses its tools and answers itself.
  if (!exact) {
    const ai = await askAgent(actor, origin, id, t, history).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
    if (ai.ok) return { understood: true, reply: ai.note.text, actions: [], ai: ai.note };
    if (ai.reason && !/not connected/.test(ai.reason)) return { understood: true, reply: `Claude couldn't answer right now: ${ai.reason} Answering rule-based:\n\n${(await ask(t, id).catch(() => null))?.reply || `I didn't understand that without the model. I can: ${list.map((c) => `"${c.label}"`).join(', ')}.`}`, actions: [] };
  }
  if (!exact) {
    const b = await withTimeout(ask(t, id), 20_000, 'The answer').catch(() => null);
    if (b) {
      await adminAudit(actor, 'hq_command', null, { agent: id, intent: b.intent });
      const by = b.agent !== id && AGENT_NAMES[b.agent] ? ` (from ${AGENT_NAMES[b.agent]}'s area)` : '';
      return { understood: true, reply: `${b.reply}${by}`, actions: b.actions };
    }
  }
  const cmd = exact || list.find((c) => c.keys.test(t));
  if (!cmd) return { understood: false, reply: `I didn't understand that. I can: ${list.map((c) => `"${c.label}"`).join(', ')}. ${BRAIN_HELP}` };
  const prev = await loadShift();
  let ov: Promise<Overview> | null = null;
  const ctx: Ctx = { actor, origin, prev, force: true, overview: () => (ov ||= buildOverview('owner')) };
  const r = await withTimeout(cmd.run(ctx), 25_000, 'The task');
  await adminAudit(actor, 'hq_command', null, { agent: id, command: cmd.label });
  return { understood: true, ...r };
}

// ---------- Thinking after the watch ----------
// Items the model already analyzed are not analyzed again for 6 hours (cost).
const SEEN_KEY = 'hq_ai_seen';
export async function runAnalyses(actor: string, origin: string, limit = 2, only?: string[]): Promise<{ done: string[]; skipped?: string }> {
  const g = await gate(only ? 'user' : 'auto');
  if (!g.ok) return { done: [], skipped: g.reason };
  if (!g.settings.auto && !only) return { done: [], skipped: 'Automatic analysis is turned off.' };
  const db = supabaseAdmin();
  const [shift, { data: seenRow }] = await Promise.all([loadShift(), db.from('lr_settings').select('value').eq('key', SEEN_KEY).maybeSingle()]);
  const seen = { ...((seenRow?.value as Record<string, number>) || {}) }, now = Date.now();
  for (const [k, t] of Object.entries(seen)) if (now - t > 2 * D) delete seen[k];
  const todo = Object.values(shift).filter((r) => (only ? only.includes(r.id) : (r.aiQueue || []).some((k) => !seen[k] || now - seen[k] > 24 * H))).slice(0, limit);
  const done: string[] = [];
  for (const r of todo) {
    const t = await analyseRun(actor, origin, r, Boolean(only)).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
    if (!t.ok) { await saveShift({ [r.id]: { ...r, ai: { at: new Date().toISOString(), text: `Analysis not possible: ${t.reason}`, model: '-', usd: 0, grund: 'analyse' }, aiQueue: undefined } }, 'hq'); continue; }
    for (const k of r.aiQueue || []) seen[k] = now;
    await saveShift({ [r.id]: { ...r, ai: t.note, aiQueue: undefined } }, 'hq');
    done.push(r.id);
  }
  if (todo.length) await db.from('lr_settings').upsert({ key: SEEN_KEY, value: seen, updated_at: new Date().toISOString(), updated_by: 'hq' });
  return { done };
}

// Daily round: from 6 a.m. (owner's time zone) once per department, spread over several watch runs so no run takes too long.
const DAILY_KEY = 'hq_ai_daily';
export async function runDaily(actor: string, origin: string, perRun = 3, force = false): Promise<{ done: string[]; skipped?: string }> {
  const g = await gate();
  if (!g.ok) return { done: [], skipped: g.reason };
  if (!g.settings.daily && !force) return { done: [], skipped: 'The daily round is turned off.' };
  const db = supabaseAdmin();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(new Date()));
  if (hour < 6 && !force) return { done: [], skipped: 'The daily round runs from 6 a.m.' };
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
    if (cur) await saveShift({ [a]: { ...cur, ai: t.ok ? t.note : { at: new Date().toISOString(), text: `Daily round not possible: ${t.reason}`, model: '-', usd: 0, grund: 'tag' } } }, 'hq');
    if (t.ok) done.push(a);
    await db.from('lr_settings').upsert({ key: DAILY_KEY, value: st, updated_at: new Date().toISOString(), updated_by: 'hq' });
    if (!t.ok && /budget|quota|credit|Budget|Tagesgrenze|Guthaben/.test(t.reason)) break;
  }
  return { done };
}

// ---------- "Do it now" (tapped by the owner) ----------
// 1) Agent works (internal right away) · 2) If something is still open: Claude finds the cause, fixes internal things with
// its tools and creates solutions for the rest · 3) re-check. If everything is gone, the old analysis disappears – the agent
// reports "done" and keeps working on new findings in the next watch round.
export async function doNow(actor: string, origin: string, id: AgentId): Promise<{ agents: Record<string, AgentRun>; text: string }> {
  const t0 = Date.now();
  // Ava: "Do it" means revising the waiting drafts (in the background, in batches) – the first batch right away.
  if (id === 'freigaben' || id === 'postfach') {
    const rv = await startReview(id);
    const b = await runReviewBatch(actor, origin, t0 + 95_000).catch(() => null);
    const st = await runShift(actor, origin, [id], true);
    const cur = await loadReview();
    return { agents: st, text: cur?.active ? `${AGENT_NAMES[id]} is revising the drafts: ${cur.done.length} of ${rv.total} checked, ${cur.changed} improved. The rest continues in the background – progress is in the card.` : `${AGENT_NAMES[id]}: all ${rv.total} drafts checked, ${cur?.changed ?? 0} improved. Nothing was sent; originals are saved.${b ? '' : ''}` };
  }
  let st = await runShift(actor, origin, [id], true);
  let r = st[id];
  if (!r || r.status === 'ok') {
    if (r?.ai) st = await saveShift({ [id]: { ...r, ai: undefined, aiQueue: undefined } }, 'hq');
    return { agents: st, text: `${AGENT_NAMES[id]}: done – nothing left open.` };
  }
  const t = await analyseRun(actor, origin, r, true).catch((e): { ok: false; reason: string } => ({ ok: false, reason: (e as Error).message }));
  if (!t.ok) return { agents: st, text: t.reason };
  if (Date.now() - t0 < 42_000) { st = await runShift(actor, origin, [id], true); r = st[id]; }
  const done = r.status === 'ok';
  st = await saveShift({ [id]: { ...r, ai: done ? undefined : t.note, aiQueue: undefined } }, 'hq');
  return { agents: st, text: done ? `${AGENT_NAMES[id]}: done. ${t.note.text.split(/(?<=[.!?])\s/)[0]}` : `${AGENT_NAMES[id]} has worked – results and solutions are in the card.` };
}
