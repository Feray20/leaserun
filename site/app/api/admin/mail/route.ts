import { after, NextResponse } from 'next/server';
import { proxyImages } from '@/lib/mail/img-proxy';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { buildOutgoing, copyAddress, previewToMe, sendRow, type MailRow } from '@/lib/mail/compose';
import { kickQueue, loadQueue, pendingOf, queueSummary, runQueue, startQueue } from '@/lib/mail/send-queue';
import { allowRequest } from '@/lib/security/rate-limit';
import { mailboxAddress, resendSend } from '@/lib/mail/resend';
import { normSubject, snippetOf } from '@/lib/mail/store';
import { htmlToText, sanitizeBody } from '@/lib/mail/template';
import { OUTREACH_IMPORT } from '@/lib/mail/import-data';
import { syncReceived } from '@/lib/mail/ingest';
import { ensureDeliveryTracking } from '@/lib/mail/delivery-setup';
import { safeTarget } from '@/lib/b2b/webhook';
import { legalCheck } from '@/lib/mail/legal-gate';
import { staticScan, threatMessage } from '@/lib/security/filescan';

let lastSync = 0;
// The import is one-time: once the key is gone, this instance stops asking on every open (saves a database round trip).
let importDone = false;
let trackingChecked = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Web-Admin → Inbox: Inbox, Sent, Drafts, Starred, Archive, Spam, Trash – read, reply, compose.
// Folder keys are stored in the DB. ImmoAdv's receipts folder for tax bookkeeping ('belege', lr_tax_docs) does not exist in LeaseRun.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const FOLDERS = ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'] as const;
const LIST_COLS = 'id, thread_id, direction, folder, status, design, from_email, from_name, to_emails, subject, snippet, starred, read_at, created_at, sent_at, received_at, attachments, error, contact_id, auth, research_flag';
const MAX_INLINE = 3 * 1024 * 1024;

// One-time import of prepared press drafts (encrypted in code, key in lr_settings). The bundled payload holds ImmoAdv's
// German drafts, so it is switched off for LeaseRun (would put German emails into the US mailbox).
const OUTREACH_IMPORT_ENABLED = false;
async function runImport(email: string): Promise<number> {
  const db = supabaseAdmin();
  if (importDone || !OUTREACH_IMPORT_ENABLED || !OUTREACH_IMPORT) return 0;
  const { data } = await db.from('lr_settings').select('value').eq('key', 'outreach_import').maybeSingle();
  if (!data?.value || typeof data.value !== 'string') { importDone = true; return 0; }
  const buf = Buffer.from(OUTREACH_IMPORT, 'base64');
  const dc = createDecipheriv('aes-256-gcm', Buffer.from(data.value, 'base64'), buf.subarray(0, 12));
  dc.setAuthTag(buf.subarray(12, 28));
  const rows = JSON.parse(inflateSync(Buffer.concat([dc.update(buf.subarray(28)), dc.final()])).toString('utf8')) as { to: string; subject: string; html: string; text: string; fallback: string | null; token: string | null }[];
  const { data: have } = await db.from('lr_mail_messages').select('subject, to_emails').eq('source', 'gmail-entwurf');
  const seen = new Set((have ?? []).map((r) => `${(r.to_emails as string[])[0]}\n${r.subject}`));
  const fresh = rows.filter((r) => !seen.has(`${r.to}\n${r.subject}`));
  if (fresh.length) {
    const ins = await db.from('lr_mail_messages').insert(fresh.map((r) => {
      const id = randomUUID();
      return { id, thread_id: id, direction: 'out', folder: 'drafts', status: 'entwurf', design: 'fertig', from_email: mailboxAddress(), to_emails: [r.to], subject: r.subject, html: r.html, text_body: r.text, snippet: snippetOf(r.text), termin_fallback: r.fallback, token: r.token, source: 'gmail-entwurf' };
    }));
    if (ins.error) throw new Error(ins.error.message);
  }
  await db.from('lr_settings').delete().eq('key', 'outreach_import');
  await adminAudit(email, 'mail_import', null, { n: fresh.length });
  return fresh.length;
}

// Incoming HTML for display: embedded images (cid) as data URLs so they show inside the sandboxed frame.
async function inboundView(m: MailRow): Promise<string> {
  // Emails flagged as dangerous: text only, without links, images and scripts – with a warning.
  const th = (m as MailRow & { auth?: { threat?: { score: number; reasons: string[] } } }).auth?.threat;
  if (th && th.score >= 5) {
    const t = String(m.text_body || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string).replace(/https?:\/\/\S+/g, '[link removed]');
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:14px;font:15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a}.w{background:#FEF2F2;border:1px solid #FCA5A5;border-radius:12px;padding:12px 14px;margin:0 0 14px;color:#991B1B}</style></head><body><div class="w"><strong>Caution – likely phishing or malware.</strong><br>${th.reasons.map((r) => r.replace(/[&<>]/g, '')).join('<br>')}<br>Links and images were removed. Do not open attachments.</div><pre style="white-space:pre-wrap;font:inherit;margin:0">${t}</pre></body></html>`;
  }
  let html = m.html || `<pre style="white-space:pre-wrap;font:15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:16px">${String(m.text_body || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)}</pre>`;
  let budget = MAX_INLINE;
  for (const a of m.attachments || []) {
    if (!a.cid || !html.includes(`cid:${a.cid}`) || a.size > budget) continue;
    const { data } = await supabaseAdmin().storage.from('mail').download(a.path);
    if (!data) continue;
    budget -= a.size;
    html = html.split(`cid:${a.cid}`).join(`data:${a.type};base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`);
  }
  // Load external images (logos, banners) through leaserun.com – senders never see the IP address or browser.
  html = proxyImages(html);
  const base = '<base target="_blank"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;word-wrap:break-word}img{max-width:100%;height:auto}</style>';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${base}`) : `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${html}</body></html>`;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'mail');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Not configured.' }, 503);
  const db = supabaseAdmin();
  const q = new URL(req.url).searchParams;
  const id = q.get('id');
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return j({ error: 'Invalid.' }, 400);
    const { data: m } = await db.from('lr_mail_messages').select('*').eq('id', id).maybeSingle();
    if (!m) return j({ error: 'Not found.' }, 404);
    const { data: thread } = await db.from('lr_mail_messages').select('*').eq('thread_id', m.thread_id).neq('folder', 'trash').order('created_at', { ascending: true }).limit(50);
    const list = (thread ?? []) as MailRow[];
    if (!list.find((x) => x.id === id)) list.push(m as MailRow);
    // Load views, read marker and contact in parallel (previously sequential – noticeably slow for long threads).
    const unread = list.filter((x) => x.direction === 'in' && !x.read_at).map((x) => x.id);
    const readAt = new Date().toISOString();
    const [out, , contactRes] = await Promise.all([
      Promise.all(list.map(async (x) => {
        const view = x.direction === 'in' ? await inboundView(x) : (await buildOutgoing(x, true)).html;
        return { ...x, html: x.id === id && x.design === 'frei' && x.status !== 'gesendet' ? x.html : undefined, view };
      })),
      unread.length ? db.from('lr_mail_messages').update({ read_at: readAt }).in('id', unread) : null,
      m.contact_id ? db.from('lr_crm_contacts').select('id, company, contact_name, status').eq('id', m.contact_id).maybeSingle() : null,
    ]);
    const contact = contactRes?.data ?? null;
    for (const x of out) if (unread.includes(x.id)) x.read_at = readAt;
    // Counterpart: known ("trusted") when we already exchanged emails with this address – plus earlier emails outside this
    // thread (headers only, no content).
    const addr = String(m.direction === 'in' ? m.from_email : ((m.to_emails as string[] | null) || [])[0] || '').trim().toLowerCase();
    let party: { email: string; known: boolean; sent: number; history: Record<string, unknown>[] } | null = null;
    if (/^[^\s,(){}"'\\]+@[^\s,(){}"'\\]+\.[a-z]{2,}$/i.test(addr) && !/@leaserun\.com$/i.test(addr)) {
      const [{ data: hist }, { count: sentTo }, { data: crm }] = await Promise.all([
        db.from('lr_mail_messages').select('id, thread_id, direction, folder, status, subject, snippet, created_at, sent_at, received_at')
          .or(`from_email.eq.${addr},to_emails.cs.{${addr}}`).neq('thread_id', m.thread_id).neq('folder', 'trash').order('created_at', { ascending: false }).limit(15),
        db.from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('status', 'gesendet').contains('to_emails', [addr]),
        db.from('lr_crm_contacts').select('id').ilike('email', addr).limit(1),
      ]);
      const sent = sentTo ?? 0;
      // "Trusted" only with a real exchange: we wrote to this address AND it wrote to us (earlier emails or this thread).
      // A CRM entry alone is not enough.
      void crm;
      const theyWrote = (hist ?? []).some((h) => h.direction === 'in') || list.some((x) => x.direction === 'in' && String(x.from_email || '').toLowerCase() === addr);
      const weWrote = sent > 0 || list.some((x) => x.direction === 'out' && x.status === 'gesendet');
      party = { email: addr, known: weWrote && theyWrote, sent, history: hist ?? [] };
    }
    // Draft: commercial/transactional classification and sending basis – "Send" is blocked when it is missing (checked again on send).
    const legal = m.direction === 'out' && m.status !== 'gesendet' && m.design !== 'system' ? await legalCheck(m as MailRow & { source?: string | null }).catch(() => null) : null;
    return j({ message: out.find((x) => x.id === id), thread: out, contact, party, legal });
  }
  const file = q.get('file');
  if (file) {
    const [mid, idx] = file.split(':');
    if (!/^[0-9a-f-]{36}$/.test(mid || '')) return j({ error: 'Invalid.' }, 400);
    const { data: m } = await db.from('lr_mail_messages').select('attachments').eq('id', mid).maybeSingle();
    const a = (m?.attachments as MailRow['attachments'] | undefined)?.[Number(idx)];
    if (!a) return j({ error: 'Not found.' }, 404);
    const s = await db.storage.from('mail').createSignedUrl(a.path, 120, { download: a.name });
    return s.data ? j({ url: s.data.signedUrl }) : j({ error: 'Not available.' }, 502);
  }
  // Polling Resend as its own quick request: the list no longer waits for it (that was the main cause of slow loading).
  if (q.get('sync') === 'only') {
    let fetched = 0;
    if (q.get('force') === '1' || Date.now() - lastSync > 20_000) { lastSync = Date.now(); try { fetched = await syncReceived(40); } catch (e) { console.error('mail_sync', (e as Error).message); } }
    return j({ fetched });
  }
  // Once: enable delivery status (delivered / bounced) in Resend – in the background, does not block the list.
  if (!trackingChecked) { trackingChecked = true; try { after(() => ensureDeliveryTracking()); } catch { /* no background */ } }
  let imported = 0;
  try { imported = await runImport(auth.user.email); } catch (e) { console.error('mail_import', (e as Error).message); }
  const folder = q.get('folder') || 'inbox';
  // Inbox: fetch new emails from Resend (in addition to the webhook; at most every 20 seconds).
  let fetched = 0;
  // "Fetch" (sync=1) waits for the result; on a normal open the sync runs in the background so the list appears instantly
  // (new emails arrive via webhook anyway).
  if (q.get('sync') === '1' && Date.now() - lastSync > 5_000) { lastSync = Date.now(); try { fetched = await syncReceived(40); } catch (e) { console.error('mail_sync', (e as Error).message); } }
  else if (folder === 'inbox' && Date.now() - lastSync > 60_000) { lastSync = Date.now(); try { after(() => syncReceived(40).catch((e) => console.error('mail_sync', (e as Error).message))); } catch { /* no background */ } }
  const search = (q.get('q') || '').trim().slice(0, 100);
  let sel = db.from('lr_mail_messages').select(LIST_COLS).order('created_at', { ascending: false }).limit(200);
  if (folder === 'starred') sel = sel.eq('starred', true).neq('folder', 'trash');
  else if (folder === 'all') sel = sel.neq('folder', 'trash'); // search across all folders
  else if ((FOLDERS as readonly string[]).includes(folder)) sel = sel.eq('folder', folder);
  else return j({ error: 'Unknown folder.' }, 400);
  if (search) { const s = search.replace(/[%,()]/g, ' '); const ord = /^\d{2,3}-\d{5,7}-\d{5,7}$/.test(s); sel = sel.or(`subject.ilike.%${s}%,from_email.ilike.%${s}%,snippet.ilike.%${s}%,from_name.ilike.%${s}%${ord ? `,text_body.ilike.%${s}%` : ''}`); }
  // Let the database count instead of loading all rows (would otherwise grow with every email).
  const cnt = () => db.from('lr_mail_messages').select('id', { count: 'exact', head: true });
  const [{ data: rows, error }, nInbox, nDrafts, nSpam, { data: booking }] = await Promise.all([
    sel,
    cnt().eq('folder', 'inbox').eq('direction', 'in').is('read_at', null),
    cnt().eq('folder', 'drafts'),
    cnt().eq('folder', 'spam').is('read_at', null),
    db.from('lr_settings').select('value').eq('key', 'outreach_booking_url').maybeSingle(),
  ]);
  if (error) return j({ error: 'Not available.' }, 502);
  // Conversations: in the inbox only the newest message per thread.
  const seen = new Set<string>(), items = [];
  for (const r of rows ?? []) { if (folder !== 'drafts' && seen.has(r.thread_id as string)) continue; seen.add(r.thread_id as string); items.push(r); }
  // Processing state per received email: neu = new (unread) → gelesen/offen = read/open → entwurf = draft ready → beantwortet = answered.
  const ins = (items as Record<string, unknown>[]).filter((x) => x.direction === 'in');
  if (ins.length) {
    const { NO_REPLY, AUTO_SUBJ } = await import('@/lib/mail/autodraft');
    const { data: outs } = await db.from('lr_mail_messages').select('thread_id, status, created_at').eq('direction', 'out').in('thread_id', [...new Set(ins.map((x) => x.thread_id as string))]).in('status', ['gesendet', 'entwurf']).limit(2000);
    for (const x of ins) {
      const at = Date.parse(String(x.received_at || x.created_at));
      const later = (outs ?? []).filter((o) => o.thread_id === x.thread_id && Date.parse(o.created_at as string) >= at - 1000);
      x.state = !x.read_at ? 'neu' : later.some((o) => o.status === 'gesendet') ? 'beantwortet' : later.some((o) => o.status === 'entwurf') ? 'entwurf'
        : NO_REPLY.test(String(x.from_email || '')) || AUTO_SUBJ.test(String(x.subject || '')) || (x.auth as { unsub?: unknown } | null)?.unsub ? 'gelesen' : 'offen';
    }
  }
  // "Trusted": senders we already exchanged emails with (protection against spoofed senders).
  const froms = [...new Set((items as Record<string, unknown>[]).filter((x) => x.direction === 'in').map((x) => String(x.from_email || '').toLowerCase()).filter((e) => /^[^\s,(){}"'\\]+@[^\s,(){}"'\\]+$/.test(e)))];
  if (froms.length) {
    // "Trusted" = real exchange: we wrote to the address AND it wrote to us. Otherwise "first contact".
    const [{ data: wrote }, { data: inbound }] = await Promise.all([
      db.from('lr_mail_messages').select('to_emails').eq('direction', 'out').eq('status', 'gesendet').overlaps('to_emails', froms).limit(1000),
      db.from('lr_mail_messages').select('from_email').eq('direction', 'in').in('from_email', froms).limit(2000),
    ]);
    const weWrote = new Set<string>((wrote ?? []).flatMap((w) => ((w.to_emails as string[] | null) || []).map((e) => e.toLowerCase())));
    const theyWrote = new Set<string>((inbound ?? []).map((m) => String(m.from_email || '').toLowerCase()));
    for (const x of items as Record<string, unknown>[]) {
      if (x.direction !== 'in') continue;
      const e = String(x.from_email || '').toLowerCase();
      if (weWrote.has(e) && theyWrote.has(e)) x.known = true; else x.fresh = true;
    }
  }
  return j({
    imported, fetched, mailbox: mailboxAddress(), booking: typeof booking?.value === 'string' ? booking.value : '', copyTo: (await copyAddress().catch(() => null)) || '',
    receiving: Boolean(process.env.RESEND_API_KEY), webhook: Boolean(process.env.RESEND_INBOUND_SECRET || process.env.RESEND_WEBHOOK_SECRET),
    counts: { inbox: nInbox.count ?? 0, drafts: nDrafts.count ?? 0, spam: nSpam.count ?? 0 },
    items,
  });
}

const Emails = z.array(z.string().trim().toLowerCase().email().max(200)).max(20);
const Act = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), id: z.string().uuid().optional(), to: z.array(z.string().trim().toLowerCase().email().max(200)).max(100), split: z.boolean().optional(), cc: Emails.optional(), bcc: Emails.optional(), subject: z.string().max(300), body: z.string().max(400000).optional(), withUnsub: z.boolean().optional(), replyTo: z.string().uuid().optional(), forward: z.string().uuid().optional(), send: z.boolean().optional(), preview: z.boolean().optional() }),
  z.object({ action: z.literal('send'), id: z.string().uuid(), to: Emails.min(1).optional(), cc: Emails.optional(), bcc: Emails.optional() }),
  z.object({ action: z.literal('mark'), ids: z.array(z.string().uuid()).min(1).max(200), read: z.boolean().optional(), starred: z.boolean().optional(), folder: z.enum(FOLDERS).optional() }),
  z.object({ action: z.literal('purge'), ids: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ action: z.literal('uploadUrl'), id: z.string().uuid(), name: z.string().trim().min(1).max(160), size: z.number().int().min(1).max(20 * 1024 * 1024) }),
  z.object({ action: z.literal('attach'), id: z.string().uuid(), path: z.string().max(400), name: z.string().max(160), type: z.string().max(120), size: z.number().int().min(1) }),
  z.object({ action: z.literal('detach'), id: z.string().uuid(), index: z.number().int().min(0).max(50) }),
  z.object({ action: z.literal('unsubscribe'), id: z.string().uuid() }),
  z.object({ action: z.literal('preview'), id: z.string().uuid() }),
  z.object({ action: z.literal('autodraft'), id: z.string().uuid() }),
  z.object({ action: z.literal('copyto'), email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(200)]) }),
  z.object({ action: z.literal('booking'), url: z.union([z.literal(''), z.string().trim().url().max(500).regex(/^https:\/\//)]) }),
  // "Send all": server-side queue (keeps running when switching apps) and its status.
  z.object({ action: z.literal('sendqueue'), ids: z.array(z.string().uuid()).min(1).max(300) }),
  z.object({ action: z.literal('queuestatus') }),
]);

export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'mail');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Not configured.' }, 503);
  const raw = await req.json().catch(() => null);
  const p = Act.safeParse(raw);
  if (!p.success) {
    const field = ['to', 'cc', 'bcc'].find((k) => p.error.issues[0]?.path.includes(k));
    const bad = field && Array.isArray(raw?.[field]) ? (raw[field] as unknown[]).map(String).filter((e) => !z.string().email().safeParse(e.trim()).success) : [];
    return j({ error: field ? (bad.length ? `Not a valid email address: ${bad.slice(0, 5).join(', ')}` : 'Too many recipients.') : 'Please check your entries.' }, 400);
  }
  const a = p.data, db = supabaseAdmin(), actor = auth.user.email, now = new Date().toISOString();

  // Unsubscribe from a newsletter: one-click unsubscribe (RFC 8058) or an unsubscribe email to the mailto address – automatically.
  if (a.action === 'unsubscribe') {
    const { data: m } = await db.from('lr_mail_messages').select('id, from_email, auth').eq('id', a.id).maybeSingle();
    const u = (m?.auth as { unsub?: { url: string | null; mailto: string | null; oneClick: boolean } } | null)?.unsub;
    if (!m || !u) return j({ error: "This email doesn't offer an unsubscribe option." }, 404);
    let done = false, how = '';
    const safeUrl = (x: string | null) => { try { const h = new URL(x || '').hostname; return /^https:/i.test(x || '') && !/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(h) && h.includes('.'); } catch { return false; } };
    if (u.url && !safeUrl(u.url)) u.url = null;
    if (u.url && u.oneClick) {
      // Public https URLs only, no redirects (prevents a foreign email from making our server call internal addresses).
      done = !(await safeTarget(u.url)) && await fetch(u.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', redirect: 'manual', signal: AbortSignal.timeout(10000) }).then((r) => r.ok || (r.status >= 300 && r.status < 400), () => false);
      how = 'one-click unsubscribe';
    }
    if (!done && u.mailto) {
      const mt = /^mailto:([^?]+)(\?(.*))?$/i.exec(u.mailto);
      const to = mt ? decodeURIComponent(mt[1]) : '';
      const qs = new URLSearchParams(mt?.[3] || '');
      if (to) {
        const r = await resendSend({ to: [to], subject: qs.get('subject') || 'unsubscribe', html: '<p>Please remove this address from your mailing list. Unsubscribe.</p>', text: qs.get('body') || 'Please remove this address from your mailing list. Unsubscribe.', unsubUrl: null, brandImages: false, idemKey: `unsub:${m.id}` });
        done = r.ok; how = 'unsubscribe email';
      }
    }
    if (!done && u.url) return j({ ok: false, open: u.url, error: "Please open the sender's unsubscribe page and confirm." });
    if (!done) return j({ error: "Unsubscribing didn't work. Please try again later." }, 502);
    await db.from('lr_mail_messages').update({ auth: { ...((m.auth as object) || {}), unsubscribed_at: new Date().toISOString() } }).eq('id', m.id);
    // Automatically archive further emails from this sender.
    await db.from('lr_settings').upsert({ key: `mail_unsub:${m.from_email}`.slice(0, 200), value: { at: new Date().toISOString(), how }, updated_at: new Date().toISOString(), updated_by: auth.user.email });
    await adminAudit(auth.user.email, 'mail_unsubscribe', m.id, { how });
    return j({ ok: true, how });
  }
  // Address for "Preview to me" – shows the owner exactly what the recipient will get (no automatic copy on send).
  if (a.action === 'copyto') {
    const r = await db.from('lr_settings').upsert({ key: 'mail_copy_to', value: a.email, updated_at: now, updated_by: actor });
    return r.error ? j({ error: 'Saving failed.' }, 500) : j({ ok: true });
  }
  if (a.action === 'booking') {
    const r = a.url ? await db.from('lr_settings').upsert({ key: 'outreach_booking_url', value: a.url, updated_at: now, updated_by: actor }) : await db.from('lr_settings').delete().eq('key', 'outreach_booking_url');
    return r.error ? j({ error: 'Saving failed.' }, 500) : j({ ok: true });
  }
  if (a.action === 'mark') {
    const up: Record<string, unknown> = { updated_at: now };
    if (a.read !== undefined) up.read_at = a.read ? now : null;
    if (a.starred !== undefined) up.starred = a.starred;
    if (a.folder) up.folder = a.folder;
    const r = await db.from('lr_mail_messages').update(up).in('id', a.ids);
    return r.error ? j({ error: 'Saving failed.' }, 500) : j({ ok: true });
  }
  if (a.action === 'purge') {
    const { data: rows } = await db.from('lr_mail_messages').select('id, attachments').in('id', a.ids).eq('folder', 'trash');
    const paths = (rows ?? []).flatMap((r) => ((r.attachments as MailRow['attachments']) || []).map((x) => x.path));
    if (paths.length) await db.storage.from('mail').remove(paths);
    await db.from('lr_mail_messages').delete().in('id', (rows ?? []).map((r) => r.id));
    await adminAudit(actor, 'mail_purge', null, { n: rows?.length ?? 0 });
    return j({ ok: true });
  }
  // Reply draft on request (otherwise created automatically for new emails).
  if (a.action === 'autodraft') {
    if (!allowRequest(`mail-autodraft:${actor}`, 20, 10 * 60_000)) return j({ error: 'Too many drafts – please wait a moment.' }, 429);
    const { autoDraftFor } = await import('@/lib/mail/autodraft');
    const r = await autoDraftFor(a.id, true).catch((e) => ({ ok: false, why: (e as Error).message }) as { ok: boolean; why: string; draftId?: string });
    return r.ok ? j({ ok: true, id: r.draftId }) : j({ error: r.why === 'draft already exists' ? 'There is already a reply draft – use "Open draft & send".' : `No draft: ${r.why}` }, 409);
  }
  // Preview to me: send the draft to our own address exactly as the recipient would see it (never to the recipient).
  if (a.action === 'preview') {
    if (!allowRequest(`mail-preview:${actor}`, 10, 10 * 60_000)) return j({ error: 'Too many previews – please wait a moment.' }, 429);
    const { data: m } = await db.from('lr_mail_messages').select('*').eq('id', a.id).maybeSingle();
    if (!m || m.direction !== 'out') return j({ error: 'Not found.' }, 404);
    const r = await previewToMe(m as MailRow);
    return r.ok ? j({ ok: true, to: r.to }) : j({ error: r.error }, 502);
  }
  if (a.action === 'sendqueue') {
    if (!allowRequest(`mail-queue:${actor}`, 5, 10 * 60_000)) return j({ error: 'Please wait a moment.' }, 429);
    // Only take real, sendable drafts.
    const { data: ok } = await db.from('lr_mail_messages').select('id, to_emails').in('id', a.ids).eq('direction', 'out').eq('status', 'entwurf');
    const ids = (ok ?? []).filter((m) => ((m.to_emails as string[] | null) || []).length).map((m) => m.id as string);
    if (!ids.length) return j({ error: 'No sendable drafts.' }, 400);
    const q = await startQueue(ids, actor);
    await adminAudit(actor, 'mail_send_queue', null, { count: ids.length });
    const origin = new URL(req.url).origin;
    after(async () => {
      const r = await runQueue(40_000).catch(() => ({ left: 0, locked: true }));
      if (r.left > 0 && !r.locked) await kickQueue(origin);
    });
    return j({ ok: true, queue: queueSummary(q) });
  }
  if (a.action === 'queuestatus') {
    const q = await loadQueue();
    // If the chain is stuck (e.g. server restart), the open mailbox resumes it.
    if (q && pendingOf(q).length && !(q.lockUntil && q.lockUntil > Date.now())) {
      const origin = new URL(req.url).origin;
      after(async () => { const r = await runQueue(40_000).catch(() => ({ left: 0, locked: true })); if (r.left > 0 && !r.locked) await kickQueue(origin); });
    }
    return j({ queue: queueSummary(q) });
  }
  if (a.action === 'send') {
    const { data: m0 } = await db.from('lr_mail_messages').select('*').eq('id', a.id).maybeSingle();
    if (!m0) return j({ error: 'Not found.' }, 404);
    let m = m0;
    // Recipients can be changed until the last moment (finished drafts too): apply them before sending.
    if (a.to && m0.status !== 'gesendet') {
      const rec = { to_emails: a.to, cc_emails: a.cc || [], bcc_emails: a.bcc || [], updated_at: now };
      const u = await db.from('lr_mail_messages').update(rec).eq('id', a.id);
      if (u.error) return j({ error: 'Recipients could not be saved.' }, 500);
      m = { ...m0, ...rec };
    }
    if (!((m.to_emails as string[] | null) || []).length) return j({ error: 'Please add at least one recipient.' }, 400);
    let r: Awaited<ReturnType<typeof sendRow>>;
    try { r = await sendRow({ ...(m as MailRow), cc_emails: (m.cc_emails as string[] | null) || [], bcc_emails: (m.bcc_emails as string[] | null) || [], subject: String(m.subject || '') }, actor); }
    catch (e) { console.error('mail_send_error', (e as Error).message); return j({ error: `Sending failed: ${(e as Error).message || 'unknown error'}`.slice(0, 300) }, 500); }
    if (!r.ok) return j({ error: r.error }, r.status);
    await adminAudit(actor, 'mail_send', (m.to_emails as string[]).join(','), { id: a.id });
    return j({ ok: true });
  }
  if (a.action === 'uploadUrl' || a.action === 'attach' || a.action === 'detach') {
    const { data: m } = await db.from('lr_mail_messages').select('id, status, attachments, direction').eq('id', a.id).maybeSingle();
    if (!m || m.direction !== 'out' || m.status === 'gesendet') return j({ error: 'Only possible for drafts.' }, 409);
    const atts = (m.attachments as MailRow['attachments']) || [];
    if (a.action === 'uploadUrl') {
      const total = atts.reduce((s, x) => s + x.size, 0) + a.size;
      if (total > 25 * 1024 * 1024) return j({ error: 'Attachments may total at most 25 MB.' }, 413);
      const safe = a.name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'attachment';
      const path = `out/${a.id}/${Date.now()}-${safe}`;
      const s = await db.storage.from('mail').createSignedUploadUrl(path);
      return s.data ? j({ url: s.data.signedUrl, token: s.data.token, path }) : j({ error: 'Upload not possible.' }, 502);
    }
    if (a.action === 'attach') {
      if (!a.path.startsWith(`out/${a.id}/`)) return j({ error: 'Invalid.' }, 400);
      // Malware check: read the file from storage (real size instead of the browser's claim); remove immediately if infected.
      const dl = await db.storage.from('mail').download(a.path);
      if (!dl.data) return j({ error: 'Attachment not found – please upload again.' }, 404);
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const scan = staticScan(buf);
      if (!scan.clean) { await db.storage.from('mail').remove([a.path]); return j({ error: threatMessage(scan) }, 422); }
      atts.push({ name: a.name.slice(0, 160), type: a.type || 'application/octet-stream', size: buf.length, path: a.path });
    } else {
      const [gone] = atts.splice(a.index, 1);
      if (gone) await db.storage.from('mail').remove([gone.path]);
    }
    await db.from('lr_mail_messages').update({ attachments: atts, updated_at: now }).eq('id', a.id);
    return j({ ok: true, attachments: atts });
  }

  // New draft to several addresses: one separate draft per address. Addresses that already have a draft or a sent email
  // are skipped (no duplicates).
  if (a.split && !a.id) {
    const want = [...new Set(a.to)];
    const { data: have } = await db.from('lr_mail_messages').select('to_emails').eq('direction', 'out').in('status', ['entwurf', 'gesendet', 'fehler']).overlaps('to_emails', want);
    const taken = new Set((have ?? []).flatMap((r) => (r.to_emails as string[]) || []).map((e) => e.toLowerCase()));
    const fresh = want.filter((e) => !taken.has(e));
    const body = a.body || '';
    const rows = fresh.map((to) => {
      const id = randomUUID(), text = htmlToText(sanitizeBody(body));
      return { id, thread_id: id, direction: 'out', folder: 'drafts', status: 'entwurf', design: 'frei', from_email: mailboxAddress(), attachments: [], to_emails: [to], cc_emails: a.cc || [], bcc_emails: a.bcc || [], subject: a.subject.trim().slice(0, 300), html: body, text_body: text, snippet: snippetOf(text), with_unsub: a.withUnsub ?? true, updated_at: now };
    });
    if (rows.length) { const w = await db.from('lr_mail_messages').insert(rows); if (w.error) return j({ error: 'Saving failed.' }, 500); }
    await adminAudit(actor, 'mail_drafts_split', null, { created: rows.length, skipped: want.length - rows.length });
    return j({ ok: true, created: rows.length, skipped: want.filter((e) => taken.has(e)) });
  }
  if (a.to.length > 20) return j({ error: 'At most 20 recipients per email. When saving, choose "one draft per address".' }, 400);

  // Save a draft (new, reply or forward) – optionally send right away or return a preview.
  let row: Partial<MailRow> & { id: string };
  if (a.id) {
    const { data: m } = await db.from('lr_mail_messages').select('*').eq('id', a.id).maybeSingle();
    if (!m) return j({ error: 'Not found.' }, 404);
    if (m.status === 'gesendet') return j({ error: 'Already sent.' }, 409);
    row = m as MailRow;
  } else {
    const id = randomUUID();
    row = { id, thread_id: id, direction: 'out', folder: 'drafts', status: 'entwurf', design: 'frei', from_email: mailboxAddress(), attachments: [] };
    const ref = a.replyTo || a.forward;
    if (ref) {
      const { data: o } = await db.from('lr_mail_messages').select('thread_id, message_id, refs, subject, attachments').eq('id', ref).maybeSingle();
      if (o) {
        if (a.replyTo) { row.thread_id = o.thread_id as string; row.in_reply_to = (o.message_id as string) || null; row.refs = [o.refs, o.message_id].filter(Boolean).join(' ').slice(-7900) || null; }
        if (a.forward) row.attachments = (o.attachments as MailRow['attachments']) || [];
      }
    }
  }
  const body = a.body !== undefined ? a.body : row.html || '';
  const up = {
    ...row, to_emails: a.to, cc_emails: a.cc || [], bcc_emails: a.bcc || [], subject: a.subject.trim().slice(0, 300),
    // Finished template: without new text it stays unchanged; with new text the draft becomes a letter (design "frei")
    // with the current signature and footer – recipients, unsubscribe link (token) and thread are kept.
    html: row.design === 'fertig' && a.body === undefined ? row.html : body, with_unsub: a.withUnsub ?? row.with_unsub ?? !a.replyTo,
    text_body: row.design === 'fertig' && a.body === undefined ? row.text_body : htmlToText(sanitizeBody(body)), updated_at: now,
    design: row.design === 'fertig' && a.body !== undefined ? 'frei' : row.design,
  };
  up.snippet = snippetOf(up.text_body || '');
  if (a.preview) {
    const { html } = await buildOutgoing({ ...(up as MailRow) }, true);
    return j({ ok: true, preview: html });
  }
  const w = await db.from('lr_mail_messages').upsert(up);
  if (w.error) return j({ error: 'Saving failed.' }, 500);
  if (!a.send) return j({ ok: true, id: row.id });
  const { data: fresh } = await db.from('lr_mail_messages').select('*').eq('id', row.id).single();
  let r: Awaited<ReturnType<typeof sendRow>>;
  try { r = await sendRow(fresh as MailRow, actor); }
  catch (e) { console.error('mail_send_error', (e as Error).message); return j({ error: `Sending failed: ${(e as Error).message || 'unknown error'}`.slice(0, 300), id: row.id }, 500); }
  if (!r.ok) return j({ error: r.error, id: row.id }, r.status);
  await adminAudit(actor, 'mail_send', a.to.join(','), { id: row.id, thread: normSubject(a.subject).slice(0, 60) });
  return j({ ok: true, id: row.id, sent: true });
}
