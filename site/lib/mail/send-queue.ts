import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendRow, type MailRow } from '@/lib/mail/compose';
import { adminAudit } from '@/lib/b2b/core';
import { pushAdmins } from '@/lib/admin/push';

// "Send all" in the mailbox: the list of drafts lives on the server (lr_settings "mail_send_queue") and is processed there –
// even if the owner switches apps or locks her phone. Every email goes out individually through sendRow, i.e. with the same
// unsubscribe/suppression checks as "Send" in a draft. Nothing is deleted.
// Flow: start → batch of about 40 seconds → triggers itself for the next batch (CRON_SECRET). If the chain breaks, the
// watchdog (every 30 min) or the open mailbox resumes it.
const KEY = 'mail_send_queue';
export type QueueFail = { id: string; to: string; error: string };
export type SendQueue = { ids: string[]; done: string[]; failed: QueueFail[]; by: string; at: string; lockUntil?: number; finishedAt?: string | null };

export async function loadQueue(): Promise<SendQueue | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  const q = data?.value as SendQueue | null;
  return q && Array.isArray(q.ids) ? q : null;
}
async function saveQueue(q: SendQueue) {
  await supabaseAdmin().from('lr_settings').upsert({ key: KEY, value: q, updated_at: new Date().toISOString(), updated_by: 'postfach' });
}
export const pendingOf = (q: SendQueue | null) => (q ? q.ids.filter((id) => !q.done.includes(id) && !q.failed.some((f) => f.id === id)) : []);
export const queueSummary = (q: SendQueue | null) => (q ? { total: q.ids.length, sent: q.done.length, failed: q.failed, left: pendingOf(q).length, finishedAt: q.finishedAt || null, at: q.at } : null);

// Append new drafts (a running queue is continued, not replaced).
export async function startQueue(ids: string[], by: string): Promise<SendQueue> {
  const cur = await loadQueue();
  const running = cur && pendingOf(cur).length > 0;
  const q: SendQueue = running ? { ...cur!, ids: [...new Set([...cur!.ids, ...ids])] } : { ids: [...new Set(ids)], done: [], failed: [], by, at: new Date().toISOString(), finishedAt: null };
  q.finishedAt = null;
  await saveQueue(q);
  return q;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Process one batch. A lock prevents two runs from sending the same email twice.
export async function runQueue(budgetMs: number): Promise<{ left: number; locked?: boolean }> {
  let q = await loadQueue();
  if (!q || !pendingOf(q).length) return { left: 0 };
  if (q.lockUntil && q.lockUntil > Date.now()) return { left: pendingOf(q).length, locked: true };
  q.lockUntil = Date.now() + budgetMs + 20_000;
  await saveQueue(q);
  const db = supabaseAdmin(), t0 = Date.now();
  for (const id of pendingOf(q)) {
    if (Date.now() - t0 > budgetMs) break;
    const { data: m } = await db.from('lr_mail_messages').select('*').eq('id', id).maybeSingle();
    const to = ((m?.to_emails as string[] | null) || [])[0] || '?';
    // Already sent, deleted or no longer a draft → skip (never send twice).
    if (!m || m.direction !== 'out' || m.status !== 'entwurf') { q.done.push(id); await saveQueue(q); continue; }
    let r: Awaited<ReturnType<typeof sendRow>>;
    try { r = await sendRow({ ...(m as MailRow), cc_emails: (m.cc_emails as string[] | null) || [], bcc_emails: (m.bcc_emails as string[] | null) || [], subject: String(m.subject || '') }, q.by); }
    catch (e) { r = { ok: false, error: (e as Error).message || 'Error', status: 500 }; }
    if (r.ok) { q.done.push(id); await adminAudit(q.by, 'mail_send', to, { id, queue: true }).catch(() => null); }
    else q.failed.push({ id, to, error: String(r.error).slice(0, 200) });
    q.lockUntil = Date.now() + 30_000;
    await saveQueue(q);
    await sleep(600); // do not overload the sending service
  }
  // Reload: do not lose drafts appended during the run.
  const fresh = (await loadQueue()) || q;
  q = { ...fresh, done: [...new Set([...fresh.done, ...q.done])], failed: [...q.failed, ...fresh.failed.filter((f) => !q!.failed.some((x) => x.id === f.id))], lockUntil: 0 };
  const left = pendingOf(q).length;
  if (!left && !q.finishedAt) {
    q.finishedAt = new Date().toISOString();
    await pushAdmins('support', 'Emails sent', `${q.done.length} sent${q.failed.length ? `, ${q.failed.length} not sent (see Drafts)` : ''}.`, 'mail_queue').catch(() => null);
  }
  await saveQueue(q);
  return { left };
}

// Trigger the next batch in a new server request (the response comes right away, work happens afterwards).
export async function kickQueue(origin: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const r = await fetch(`${origin}/api/cron/mailqueue`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return Boolean(r?.ok);
}
