import { supabaseAdmin } from '@/lib/supabase/admin';

// LeaseRun Intelligence (rule-based, no AI cost): checks the inbox, invoices and website & tech, fixes what can be
// fixed unambiguously and without risk, and reports everything else with a target to fix it. Nothing is deleted;
// every correction is recorded in the correction log (before → after).
export type Area = 'postfach' | 'rechnungen' | 'website';
export type Check = { area: Area; level: 'bad' | 'warn' | 'ok' | 'info'; text: string; detail?: string; tab?: string; seg?: string; n?: number };
export type Fix = { at: string; area: Area; text: string; from?: string; to?: string };
export type OsReport = { at: string; checks: Check[]; fixes: Fix[]; badges: Record<string, number>; lights: Record<Area, 'ok' | 'warn' | 'bad'> };

const LOG = 'os_fixlog';
const AREAS: Area[] = ['postfach', 'rechnungen', 'website'];
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function loadLog(): Promise<Fix[]> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', LOG).maybeSingle();
  // Older entries from removed areas (tax receipts, marketplaces) are no longer shown.
  return ((data?.value as Fix[] | null) || []).filter((f) => AREAS.includes(f.area));
}
async function addLog(f: Fix[]) {
  if (!f.length) return;
  const cur = await loadLog();
  await supabaseAdmin().from('lr_settings').upsert({ key: LOG, value: [...f, ...cur].slice(0, 200), updated_at: new Date().toISOString(), updated_by: 'intelligence' });
}

export async function runOsChecks(o: { fix: boolean; origin?: string }): Promise<OsReport> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const C: Check[] = [], F: Fix[] = [];
  const add = (c: Check) => C.push(c);

  // ---------- Inbox & email ----------
  const [unread, drafts, failed] = await Promise.all([
    db.from('lr_mail_messages').select('id,received_at', { count: 'exact' }).eq('folder', 'inbox').eq('direction', 'in').is('read_at', null).limit(500),
    db.from('lr_mail_messages').select('id,subject,text_body,html,attachments,status,updated_at').eq('folder', 'drafts').limit(500),
    db.from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('status', 'fehler').neq('folder', 'trash'),
  ]);
  const old = (unread.data || []).filter((m) => m.received_at && Date.now() - Date.parse(m.received_at) > 48 * 36e5).length;
  if (unread.count) add({ area: 'postfach', level: old ? 'warn' : 'info', text: `${unread.count} unread emails${old ? `, ${old} of them older than 2 days` : ''}`, tab: 'postfach', seg: 'system', n: unread.count });
  // Draft mentions an attachment but has none (English and legacy German wording).
  const ATT = /\b(attached|attachment|enclosed|please find|see the file|h[äa]ngt an|anbei|im anhang|angeh[äa]ngt)\b/i;
  const noAtt = (drafts.data || []).filter((m) => m.status === 'entwurf' && !((m.attachments as unknown[]) || []).length && ATT.test(`${m.text_body || ''} ${String(m.html || '').replace(/<[^>]+>/g, ' ')}`));
  if (noAtt.length) add({ area: 'postfach', level: 'bad', text: `${noAtt.length} draft(s) mention an attachment but don't have one`, detail: noAtt.slice(0, 3).map((m) => m.subject).join(' · '), tab: 'postfach', seg: 'system', n: noAtt.length });
  const blocked = (drafts.data || []).filter((m) => m.status === 'gesperrt').length;
  if (blocked) add({ area: 'postfach', level: 'info', text: `${blocked} drafts blocked (marketing without a legal basis – can't be sent)`, detail: 'They stay until you decide. Only send with a valid opt-in or CAN-SPAM-compliant unsubscribe.', tab: 'postfach', seg: 'system' });
  if (failed.count) add({ area: 'postfach', level: 'bad', text: `${failed.count} emails with a delivery error`, tab: 'postfach', seg: 'system', n: failed.count });
  const ready = (drafts.data || []).filter((m) => m.status === 'entwurf').length - noAtt.length;
  if (ready > 0) add({ area: 'postfach', level: 'info', text: `${ready} drafts ready to review and send`, tab: 'postfach', seg: 'system', n: ready });

  // ---------- LeaseRun invoices (integrity only; no tax bookkeeping) ----------
  const { data: inv } = await db.from('lr_invoices').select('invoice_number,net_cents,vat_cents,gross_cents,payment_status,due_date,pdf_path,kind,account_id').limit(5000);
  const invs = inv || [];
  const seg = (i: { account_id?: string | null }) => (i.account_id ? 'b2b' : 'b2c');
  const overdue = invs.filter((i) => i.due_date && i.due_date < day(0) && !/paid|bezahlt|cancel/i.test(String(i.payment_status || '')));
  if (overdue.length) add({ area: 'rechnungen', level: 'warn', text: `${overdue.length} LeaseRun invoice(s) overdue`, tab: 'rechnungen', seg: seg(overdue[0]), n: overdue.length });
  const sumErr = invs.filter((i) => i.gross_cents != null && i.net_cents != null && i.vat_cents != null && Math.abs(Number(i.net_cents) + Number(i.vat_cents) - Number(i.gross_cents)) > 1);
  if (sumErr.length) add({ area: 'rechnungen', level: 'bad', text: `${sumErr.length} invoice(s): subtotal + tax ≠ total`, detail: sumErr.slice(0, 5).map((i) => i.invoice_number).join(', '), tab: 'rechnungen', seg: seg(sumErr[0]) });
  const noPdf = invs.filter((i) => !i.pdf_path);
  if (noPdf.length) add({ area: 'rechnungen', level: 'warn', text: `${noPdf.length} invoice(s) without a stored PDF`, tab: 'rechnungen', seg: seg(noPdf[0]) });
  const nums = invs.map((i) => String(i.invoice_number || '')).filter(Boolean);
  const dup = nums.filter((n, k) => nums.indexOf(n) !== k);
  if (dup.length) add({ area: 'rechnungen', level: 'bad', text: `Duplicate invoice number(s): ${[...new Set(dup)].slice(0, 5).join(', ')}`, tab: 'rechnungen', seg: 'b2b' });

  // ---------- Website & tech ----------
  if (o.origin) {
    const pages = ['/', '/pricing', '/calculators', '/learn', '/sitemap.xml', '/robots.txt'];
    const res = await Promise.all(pages.map(async (p) => { const t0 = Date.now(); try { const r = await fetch(o.origin + p, { signal: AbortSignal.timeout(8000), redirect: 'manual', headers: { 'user-agent': 'LeaseRun-Intelligence' } }); return { p, s: r.status, ms: Date.now() - t0 }; } catch { return { p, s: 0, ms: Date.now() - t0 }; } }));
    const bad = res.filter((x) => x.s === 0 || x.s >= 500 || (x.s >= 400 && x.s !== 404));
    const slow = res.filter((x) => x.s && x.s < 400 && x.ms > 2500);
    if (bad.length) add({ area: 'website', level: 'bad', text: `Pages not reachable: ${bad.map((x) => `${x.p} (${x.s || 'no response'})`).join(', ')}`, tab: 'system', seg: 'system' });
    else add({ area: 'website', level: slow.length ? 'warn' : 'ok', text: slow.length ? `Slow: ${slow.map((x) => `${x.p} ${(x.ms / 1000).toFixed(1)} s`).join(', ')}` : `Website reachable (${res.length} pages checked, avg. ${Math.round(res.reduce((a, x) => a + x.ms, 0) / res.length)} ms)`, tab: 'system', seg: 'system' });
  }
  const { data: errs } = await db.from('lr_client_errors').select('message,count,last_seen').is('resolved_at', null).gte('last_seen', new Date(Date.now() - 3 * 864e5).toISOString()).order('count', { ascending: false }).limit(20);
  if (errs?.length) add({ area: 'website', level: errs.some((e) => Number(e.count) >= 5) ? 'warn' : 'info', text: `${errs.length} open browser errors (3 days)`, detail: errs.slice(0, 3).map((e) => `${String(e.message).slice(0, 60)} (${e.count}×)`).join(' · '), tab: 'probleme', seg: 'b2c', n: errs.length });

  if (o.fix && F.length) await addLog(F);
  const fixes = [...F, ...(await loadLog())].slice(0, 60);
  const lights = Object.fromEntries(AREAS.map((a) => { const cs = C.filter((c) => c.area === a); return [a, cs.some((c) => c.level === 'bad') ? 'bad' : cs.some((c) => c.level === 'warn') ? 'warn' : 'ok']; })) as Record<Area, 'ok' | 'warn' | 'bad'>;
  const badges: Record<string, number> = {};
  for (const c of C) if (c.tab && c.n && c.level !== 'ok') badges[c.tab] = (badges[c.tab] || 0) + c.n;
  return { at: now, checks: C.sort((a, b) => ['bad', 'warn', 'info', 'ok'].indexOf(a.level) - ['bad', 'warn', 'info', 'ok'].indexOf(b.level)), fixes, badges, lights };
}
