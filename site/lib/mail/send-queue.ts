import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendRow, type MailRow } from '@/lib/mail/compose';
import { adminAudit } from '@/lib/b2b/core';
import { pushAdmins } from '@/lib/admin/push';

// „Alle senden“ im Postfach: Die Liste der Entwürfe liegt auf dem Server (lr_settings „mail_send_queue“) und wird dort
// abgearbeitet – auch wenn Feray die App wechselt oder das Handy sperrt. Jede Mail geht einzeln über sendRow, also mit
// derselben Prüfung auf Abmeldung/Sperrliste wie „Senden“ im Entwurf. Nichts wird gelöscht.
// Ablauf: Start → Paket von ca. 40 Sekunden → stößt sich selbst für das nächste Paket an (CRON_SECRET). Fällt die Kette
// aus, setzt die Wache (alle 30 Min.) oder das geöffnete Postfach sie fort.
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

// Neue Entwürfe anhängen (laufende Warteschlange wird fortgesetzt, nicht ersetzt).
export async function startQueue(ids: string[], by: string): Promise<SendQueue> {
  const cur = await loadQueue();
  const running = cur && pendingOf(cur).length > 0;
  const q: SendQueue = running ? { ...cur!, ids: [...new Set([...cur!.ids, ...ids])] } : { ids: [...new Set(ids)], done: [], failed: [], by, at: new Date().toISOString(), finishedAt: null };
  q.finishedAt = null;
  await saveQueue(q);
  return q;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ein Paket abarbeiten. Sperre verhindert, dass zwei Läufe dieselbe Mail doppelt senden.
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
    // Schon gesendet, gelöscht oder kein Entwurf mehr → überspringen (nie doppelt senden).
    if (!m || m.direction !== 'out' || m.status !== 'entwurf') { q.done.push(id); await saveQueue(q); continue; }
    let r: Awaited<ReturnType<typeof sendRow>>;
    try { r = await sendRow({ ...(m as MailRow), cc_emails: (m.cc_emails as string[] | null) || [], bcc_emails: (m.bcc_emails as string[] | null) || [], subject: String(m.subject || '') }, q.by); }
    catch (e) { r = { ok: false, error: (e as Error).message || 'Fehler', status: 500 }; }
    if (r.ok) { q.done.push(id); await adminAudit(q.by, 'mail_send', to, { id, queue: true }).catch(() => null); }
    else q.failed.push({ id, to, error: String(r.error).slice(0, 200) });
    q.lockUntil = Date.now() + 30_000;
    await saveQueue(q);
    await sleep(600); // Versanddienst nicht überlasten
  }
  // Frisch laden: Während des Laufs angehängte Entwürfe nicht verlieren.
  const fresh = (await loadQueue()) || q;
  q = { ...fresh, done: [...new Set([...fresh.done, ...q.done])], failed: [...q.failed, ...fresh.failed.filter((f) => !q!.failed.some((x) => x.id === f.id))], lockUntil: 0 };
  const left = pendingOf(q).length;
  if (!left && !q.finishedAt) {
    q.finishedAt = new Date().toISOString();
    await pushAdmins('support', 'E-Mails gesendet', `${q.done.length} gesendet${q.failed.length ? `, ${q.failed.length} nicht gesendet (siehe Entwürfe)` : ''}.`, 'mail_queue').catch(() => null);
  }
  await saveQueue(q);
  return { left };
}

// Nächstes Paket in einem neuen Server-Aufruf anstoßen (die Antwort kommt sofort, gearbeitet wird danach).
export async function kickQueue(origin: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const r = await fetch(`${origin}/api/cron/mailqueue`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return Boolean(r?.ok);
}
