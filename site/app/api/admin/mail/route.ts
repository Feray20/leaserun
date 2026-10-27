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
// Import ist einmalig: Ist der Schlüssel weg, fragt diese Instanz nicht bei jedem Öffnen erneut nach (spart eine Datenbankrunde).
let importDone = false;
let trackingChecked = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Web-Admin → Postfach: Posteingang, Gesendet, Entwürfe, Markiert, Archiv, Spam, Papierkorb – lesen, antworten, schreiben.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const FOLDERS = ['inbox', 'belege', 'sent', 'drafts', 'archive', 'spam', 'trash'] as const;
const LIST_COLS = 'id, thread_id, direction, folder, status, design, from_email, from_name, to_emails, subject, snippet, starred, read_at, created_at, sent_at, received_at, attachments, error, contact_id, auth, research_flag';
const MAX_INLINE = 3 * 1024 * 1024;

// Einmaliger Import der vorbereiteten Presse-Entwürfe (verschlüsselt im Code, Schlüssel in lr_settings).
async function runImport(email: string): Promise<number> {
  const db = supabaseAdmin();
  if (importDone || !OUTREACH_IMPORT) return 0;
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

// Eingehendes HTML für die Anzeige: eingebettete Bilder (cid) als data-URL, damit sie im abgeschotteten Rahmen erscheinen.
async function inboundView(m: MailRow): Promise<string> {
  // Als gefährlich erkannte Mails: nur als Text, ohne Links, Bilder und Skripte – mit Warnhinweis.
  const th = (m as MailRow & { auth?: { threat?: { score: number; reasons: string[] } } }).auth?.threat;
  if (th && th.score >= 5) {
    const t = String(m.text_body || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string).replace(/https?:\/\/\S+/g, '[Link entfernt]');
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:14px;font:15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a}.w{background:#FEF2F2;border:1px solid #FCA5A5;border-radius:12px;padding:12px 14px;margin:0 0 14px;color:#991B1B}</style></head><body><div class="w"><strong>Vorsicht – vermutlich Phishing oder Schadsoftware.</strong><br>${th.reasons.map((r) => r.replace(/[&<>]/g, '')).join('<br>')}<br>Links und Bilder wurden entfernt. Keine Anhänge öffnen.</div><pre style="white-space:pre-wrap;font:inherit;margin:0">${t}</pre></body></html>`;
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
  // Externe Bilder (Logos, Banner) über leaserun.com laden – die Absender sehen dabei nie IP oder Browser.
  html = proxyImages(html);
  const base = '<base target="_blank"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;word-wrap:break-word}img{max-width:100%;height:auto}</style>';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${base}`) : `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${html}</body></html>`;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'mail');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const db = supabaseAdmin();
  const q = new URL(req.url).searchParams;
  const id = q.get('id');
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return j({ error: 'Ungültig.' }, 400);
    const { data: m } = await db.from('lr_mail_messages').select('*').eq('id', id).maybeSingle();
    if (!m) return j({ error: 'Nicht gefunden.' }, 404);
    const { data: thread } = await db.from('lr_mail_messages').select('*').eq('thread_id', m.thread_id).neq('folder', 'trash').order('created_at', { ascending: true }).limit(50);
    const list = (thread ?? []) as MailRow[];
    if (!list.find((x) => x.id === id)) list.push(m as MailRow);
    // Ansichten, Gelesen-Markierung und Kontakt parallel laden (vorher nacheinander – spürbar langsam bei langen Verläufen).
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
    // Gegenüber: bekannt („vertraut“), wenn wir schon mit dieser Adresse geschrieben haben oder sie im CRM steht –
    // dazu die früheren E-Mails außerhalb dieses Verlaufs (nur Kopfdaten, kein Inhalt).
    const addr = String(m.direction === 'in' ? m.from_email : ((m.to_emails as string[] | null) || [])[0] || '').trim().toLowerCase();
    let party: { email: string; known: boolean; sent: number; history: Record<string, unknown>[] } | null = null;
    if (/^[^\s,(){}"'\\]+@[^\s,(){}"'\\]+\.[a-z]{2,}$/i.test(addr) && !/@leaserun\.de$/i.test(addr)) {
      const [{ data: hist }, { count: sentTo }, { data: crm }] = await Promise.all([
        db.from('lr_mail_messages').select('id, thread_id, direction, folder, status, subject, snippet, created_at, sent_at, received_at')
          .or(`from_email.eq.${addr},to_emails.cs.{${addr}}`).neq('thread_id', m.thread_id).neq('folder', 'trash').order('created_at', { ascending: false }).limit(15),
        db.from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('status', 'gesendet').contains('to_emails', [addr]),
        db.from('lr_crm_contacts').select('id').ilike('email', addr).limit(1),
      ]);
      const sent = sentTo ?? 0;
      // „Vertraut“ nur bei echtem Austausch: Wir haben an diese Adresse geschrieben UND sie hat uns geschrieben
      // (frühere Mails oder dieser Verlauf). Ein CRM-Eintrag allein reicht nicht.
      void crm;
      const theyWrote = (hist ?? []).some((h) => h.direction === 'in') || list.some((x) => x.direction === 'in' && String(x.from_email || '').toLowerCase() === addr);
      const weWrote = sent > 0 || list.some((x) => x.direction === 'out' && x.status === 'gesendet');
      party = { email: addr, known: weWrote && theyWrote, sent, history: hist ?? [] };
    }
    // Entwurf: Einordnung Werbung/Transaktion und Rechtsgrundlage – „Senden“ ist bei „fehlt“ gesperrt (Prüfung auch beim Senden).
    const legal = m.direction === 'out' && m.status !== 'gesendet' && m.design !== 'system' ? await legalCheck(m as MailRow & { source?: string | null }).catch(() => null) : null;
    return j({ message: out.find((x) => x.id === id), thread: out, contact, party, legal });
  }
  const file = q.get('file');
  if (file) {
    const [mid, idx] = file.split(':');
    if (!/^[0-9a-f-]{36}$/.test(mid || '')) return j({ error: 'Ungültig.' }, 400);
    const { data: m } = await db.from('lr_mail_messages').select('attachments').eq('id', mid).maybeSingle();
    const a = (m?.attachments as MailRow['attachments'] | undefined)?.[Number(idx)];
    if (!a) return j({ error: 'Nicht gefunden.' }, 404);
    const s = await db.storage.from('mail').createSignedUrl(a.path, 120, { download: a.name });
    return s.data ? j({ url: s.data.signedUrl }) : j({ error: 'Nicht verfügbar.' }, 502);
  }
  // Abruf bei Resend als eigene, schnelle Anfrage: Die Liste wartet nicht mehr darauf (das war die Hauptursache fürs langsame Laden).
  if (q.get('sync') === 'only') {
    let fetched = 0;
    if (q.get('force') === '1' || Date.now() - lastSync > 20_000) { lastSync = Date.now(); try { fetched = await syncReceived(40); } catch (e) { console.error('mail_sync', (e as Error).message); } }
    return j({ fetched });
  }
  // Einmalig: Zustellstatus (zugestellt / nicht zustellbar) in Resend aktivieren – im Hintergrund, blockiert die Liste nicht.
  if (!trackingChecked) { trackingChecked = true; try { after(() => ensureDeliveryTracking()); } catch { /* ohne Hintergrund */ } }
  let imported = 0;
  try { imported = await runImport(auth.user.email); } catch (e) { console.error('mail_import', (e as Error).message); }
  const folder = q.get('folder') || 'inbox';
  // Posteingang: neue Mails bei Resend abrufen (zusätzlich zum Webhook; höchstens alle 20 Sekunden).
  let fetched = 0;
  // „Abrufen“ (sync=1) wartet auf das Ergebnis; beim normalen Öffnen läuft der Abgleich im Hintergrund, damit die Liste sofort erscheint
  // (neue Mails kommen ohnehin sofort per Webhook).
  if (q.get('sync') === '1' && Date.now() - lastSync > 5_000) { lastSync = Date.now(); try { fetched = await syncReceived(40); } catch (e) { console.error('mail_sync', (e as Error).message); } }
  else if (folder === 'inbox' && Date.now() - lastSync > 60_000) { lastSync = Date.now(); try { after(() => syncReceived(40).catch((e) => console.error('mail_sync', (e as Error).message))); } catch { /* ohne Hintergrund */ } }
  const search = (q.get('q') || '').trim().slice(0, 100);
  let sel = db.from('lr_mail_messages').select(LIST_COLS).order('created_at', { ascending: false }).limit(200);
  if (folder === 'starred') sel = sel.eq('starred', true).neq('folder', 'trash');
  else if (folder === 'all') sel = sel.neq('folder', 'trash'); // Suche über alle Ordner (z. B. Bestellnummer aus „Verkäufe“)
  else if ((FOLDERS as readonly string[]).includes(folder)) sel = sel.eq('folder', folder);
  else return j({ error: 'Unbekannter Ordner.' }, 400);
  if (search) { const s = search.replace(/[%,()]/g, ' '); const ord = /^\d{2,3}-\d{5,7}-\d{5,7}$/.test(s); sel = sel.or(`subject.ilike.%${s}%,from_email.ilike.%${s}%,snippet.ilike.%${s}%,from_name.ilike.%${s}%${ord ? `,text_body.ilike.%${s}%` : ''}`); }
  // Zähler nur zählen lassen statt alle Zeilen zu laden (wächst sonst mit jeder E-Mail mit).
  const cnt = () => db.from('lr_mail_messages').select('id', { count: 'exact', head: true });
  const [{ data: rows, error }, nInbox, nDrafts, nSpam, { data: booking }] = await Promise.all([
    sel,
    cnt().eq('folder', 'inbox').eq('direction', 'in').is('read_at', null),
    cnt().eq('folder', 'drafts'),
    cnt().eq('folder', 'spam').is('read_at', null),
    db.from('lr_settings').select('value').eq('key', 'outreach_booking_url').maybeSingle(),
  ]);
  if (error) return j({ error: 'Nicht verfügbar.' }, 502);
  // Unterhaltungen: im Posteingang nur die neueste Nachricht je Verlauf.
  const seen = new Set<string>(), items = [];
  for (const r of rows ?? []) { if (folder !== 'drafts' && seen.has(r.thread_id as string)) continue; seen.add(r.thread_id as string); items.push(r); }
  // Belege: Stand in der Steuersoftware anzeigen (offen vor gebucht vor privat …; ohne PDF „keine“).
  if (folder === 'belege' && items.length) {
    const { data: td } = await db.from('lr_tax_docs').select('mail_id,status').in('mail_id', items.map((x) => x.id as string));
    const rank = ['offen', 'storniert', 'bestaetigt', 'duplikat', 'privat'];
    const by = new Map<string, string>();
    for (const t of td ?? []) { const cur = by.get(t.mail_id as string); if (!cur || rank.indexOf(t.status as string) < rank.indexOf(cur)) by.set(t.mail_id as string, t.status as string); }
    for (const x of items as Record<string, unknown>[]) x.tax = by.get(x.id as string) || 'keine';
  }
  // Bearbeitungsstand je eingegangener Mail: neu (ungelesen) → gelesen/offen → Entwurf bereit → beantwortet.
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
  // „Vertraut“: Absender, denen wir schon geschrieben haben oder die im CRM stehen (Schutz vor gefälschten Absendern).
  const froms = [...new Set((items as Record<string, unknown>[]).filter((x) => x.direction === 'in').map((x) => String(x.from_email || '').toLowerCase()).filter((e) => /^[^\s,(){}"'\\]+@[^\s,(){}"'\\]+$/.test(e)))];
  if (froms.length) {
    // „Vertraut“ = echter Austausch: Wir haben an die Adresse geschrieben UND sie hat uns geschrieben. Sonst „Neu“.
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
  // „Alle senden“: Warteschlange auf dem Server (läuft auch weiter, wenn die App gewechselt wird) und ihr Stand.
  z.object({ action: z.literal('sendqueue'), ids: z.array(z.string().uuid()).min(1).max(300) }),
  z.object({ action: z.literal('queuestatus') }),
]);

export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'mail');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const raw = await req.json().catch(() => null);
  const p = Act.safeParse(raw);
  if (!p.success) {
    const field = ['to', 'cc', 'bcc'].find((k) => p.error.issues[0]?.path.includes(k));
    const bad = field && Array.isArray(raw?.[field]) ? (raw[field] as unknown[]).map(String).filter((e) => !z.string().email().safeParse(e.trim()).success) : [];
    return j({ error: field ? (bad.length ? `Keine gültige E-Mail-Adresse: ${bad.slice(0, 5).join(', ')}` : 'Zu viele Empfänger.') : 'Bitte die Angaben prüfen.' }, 400);
  }
  const a = p.data, db = supabaseAdmin(), actor = auth.user.email, now = new Date().toISOString();

  // Newsletter/Abo abbestellen: Ein-Klick-Abmeldung (RFC 8058) bzw. Abmelde-Mail an die mailto-Adresse – automatisch.
  if (a.action === 'unsubscribe') {
    const { data: m } = await db.from('lr_mail_messages').select('id, from_email, auth').eq('id', a.id).maybeSingle();
    const u = (m?.auth as { unsub?: { url: string | null; mailto: string | null; oneClick: boolean } } | null)?.unsub;
    if (!m || !u) return j({ error: 'Diese E-Mail bietet keine Abmeldung an.' }, 404);
    let done = false, how = '';
    const safeUrl = (x: string | null) => { try { const h = new URL(x || '').hostname; return /^https:/i.test(x || '') && !/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(h) && h.includes('.'); } catch { return false; } };
    if (u.url && !safeUrl(u.url)) u.url = null;
    if (u.url && u.oneClick) {
      // Nur öffentliche https-Adressen, keine Weiterleitungen (Schutz davor, dass eine fremde Mail unseren Server intern anfragen lässt).
      done = !(await safeTarget(u.url)) && await fetch(u.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', redirect: 'manual', signal: AbortSignal.timeout(10000) }).then((r) => r.ok || (r.status >= 300 && r.status < 400), () => false);
      how = 'Ein-Klick-Abmeldung';
    }
    if (!done && u.mailto) {
      const mt = /^mailto:([^?]+)(\?(.*))?$/i.exec(u.mailto);
      const to = mt ? decodeURIComponent(mt[1]) : '';
      const qs = new URLSearchParams(mt?.[3] || '');
      if (to) {
        const r = await resendSend({ to: [to], subject: qs.get('subject') || 'unsubscribe', html: '<p>Bitte tragen Sie diese Adresse aus Ihrem Verteiler aus. Unsubscribe.</p>', text: qs.get('body') || 'Bitte tragen Sie diese Adresse aus Ihrem Verteiler aus. Unsubscribe.', unsubUrl: null, brandImages: false, idemKey: `unsub:${m.id}` });
        done = r.ok; how = 'Abmelde-E-Mail';
      }
    }
    if (!done && u.url) return j({ ok: false, open: u.url, error: 'Bitte die Abmeldeseite des Absenders öffnen und bestätigen.' });
    if (!done) return j({ error: 'Abmeldung hat nicht geklappt. Bitte später erneut versuchen.' }, 502);
    await db.from('lr_mail_messages').update({ auth: { ...((m.auth as object) || {}), unsubscribed_at: new Date().toISOString() } }).eq('id', m.id);
    // Weitere Mails dieses Absenders automatisch archivieren.
    await db.from('lr_settings').upsert({ key: `mail_unsub:${m.from_email}`.slice(0, 200), value: { at: new Date().toISOString(), how }, updated_at: new Date().toISOString(), updated_by: auth.user.email });
    await adminAudit(auth.user.email, 'mail_unsubscribe', m.id, { how });
    return j({ ok: true, how });
  }
  // Kopie jeder gesendeten Mail (und „Vorschau an mich“) an diese Adresse – so sieht Feray, was beim Empfänger ankommt.
  if (a.action === 'copyto') {
    const r = await db.from('lr_settings').upsert({ key: 'mail_copy_to', value: a.email, updated_at: now, updated_by: actor });
    return r.error ? j({ error: 'Speichern fehlgeschlagen.' }, 500) : j({ ok: true });
  }
  if (a.action === 'booking') {
    const r = a.url ? await db.from('lr_settings').upsert({ key: 'outreach_booking_url', value: a.url, updated_at: now, updated_by: actor }) : await db.from('lr_settings').delete().eq('key', 'outreach_booking_url');
    return r.error ? j({ error: 'Speichern fehlgeschlagen.' }, 500) : j({ ok: true });
  }
  if (a.action === 'mark') {
    const up: Record<string, unknown> = { updated_at: now };
    if (a.read !== undefined) up.read_at = a.read ? now : null;
    if (a.starred !== undefined) up.starred = a.starred;
    if (a.folder) up.folder = a.folder;
    const r = await db.from('lr_mail_messages').update(up).in('id', a.ids);
    return r.error ? j({ error: 'Speichern fehlgeschlagen.' }, 500) : j({ ok: true });
  }
  if (a.action === 'purge') {
    const { data: rows } = await db.from('lr_mail_messages').select('id, attachments').in('id', a.ids).eq('folder', 'trash');
    const paths = (rows ?? []).flatMap((r) => ((r.attachments as MailRow['attachments']) || []).map((x) => x.path));
    if (paths.length) await db.storage.from('mail').remove(paths);
    await db.from('lr_mail_messages').delete().in('id', (rows ?? []).map((r) => r.id));
    await adminAudit(actor, 'mail_purge', null, { n: rows?.length ?? 0 });
    return j({ ok: true });
  }
  // Vorschau an mich: Entwurf genau so an die eigene Adresse senden, wie ihn der Empfänger sähe (geht nicht an den Empfänger).
  if (a.action === 'autodraft') {
    if (!allowRequest(`mail-autodraft:${actor}`, 20, 10 * 60_000)) return j({ error: 'Zu viele Entwürfe – bitte kurz warten.' }, 429);
    const { autoDraftFor } = await import('@/lib/mail/autodraft');
    const r = await autoDraftFor(a.id, true).catch((e) => ({ ok: false, why: (e as Error).message }) as { ok: boolean; why: string; draftId?: string });
    return r.ok ? j({ ok: true, id: r.draftId }) : j({ error: r.why === 'Entwurf existiert schon' ? 'Es gibt schon einen Antwort-Entwurf – „Entwurf öffnen & senden“.' : `Kein Entwurf: ${r.why}` }, 409);
  }
  if (a.action === 'preview') {
    if (!allowRequest(`mail-preview:${actor}`, 10, 10 * 60_000)) return j({ error: 'Zu viele Vorschauen – bitte kurz warten.' }, 429);
    const { data: m } = await db.from('lr_mail_messages').select('*').eq('id', a.id).maybeSingle();
    if (!m || m.direction !== 'out') return j({ error: 'Nicht gefunden.' }, 404);
    const r = await previewToMe(m as MailRow);
    return r.ok ? j({ ok: true, to: r.to }) : j({ error: r.error }, 502);
  }
  if (a.action === 'sendqueue') {
    if (!allowRequest(`mail-queue:${actor}`, 5, 10 * 60_000)) return j({ error: 'Bitte kurz warten.' }, 429);
    // Nur echte, sendbare Entwürfe übernehmen.
    const { data: ok } = await db.from('lr_mail_messages').select('id, to_emails').in('id', a.ids).eq('direction', 'out').eq('status', 'entwurf');
    const ids = (ok ?? []).filter((m) => ((m.to_emails as string[] | null) || []).length).map((m) => m.id as string);
    if (!ids.length) return j({ error: 'Keine sendbaren Entwürfe.' }, 400);
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
    // Hängt die Kette (z. B. Server-Neustart), setzt das geöffnete Postfach sie fort.
    if (q && pendingOf(q).length && !(q.lockUntil && q.lockUntil > Date.now())) {
      const origin = new URL(req.url).origin;
      after(async () => { const r = await runQueue(40_000).catch(() => ({ left: 0, locked: true })); if (r.left > 0 && !r.locked) await kickQueue(origin); });
    }
    return j({ queue: queueSummary(q) });
  }
  if (a.action === 'send') {
    const { data: m0 } = await db.from('lr_mail_messages').select('*').eq('id', a.id).maybeSingle();
    if (!m0) return j({ error: 'Nicht gefunden.' }, 404);
    let m = m0;
    // Empfänger bis zuletzt änderbar (auch bei fertigen Entwürfen): vor dem Senden übernehmen.
    if (a.to && m0.status !== 'gesendet') {
      const rec = { to_emails: a.to, cc_emails: a.cc || [], bcc_emails: a.bcc || [], updated_at: now };
      const u = await db.from('lr_mail_messages').update(rec).eq('id', a.id);
      if (u.error) return j({ error: 'Empfänger konnten nicht gespeichert werden.' }, 500);
      m = { ...m0, ...rec };
    }
    if (!((m.to_emails as string[] | null) || []).length) return j({ error: 'Bitte mindestens einen Empfänger eintragen.' }, 400);
    let r: Awaited<ReturnType<typeof sendRow>>;
    try { r = await sendRow({ ...(m as MailRow), cc_emails: (m.cc_emails as string[] | null) || [], bcc_emails: (m.bcc_emails as string[] | null) || [], subject: String(m.subject || '') }, actor); }
    catch (e) { console.error('mail_send_error', (e as Error).message); return j({ error: `Senden fehlgeschlagen: ${(e as Error).message || 'unbekannter Fehler'}`.slice(0, 300) }, 500); }
    if (!r.ok) return j({ error: r.error }, r.status);
    await adminAudit(actor, 'mail_send', (m.to_emails as string[]).join(','), { id: a.id });
    return j({ ok: true });
  }
  if (a.action === 'uploadUrl' || a.action === 'attach' || a.action === 'detach') {
    const { data: m } = await db.from('lr_mail_messages').select('id, status, attachments, direction').eq('id', a.id).maybeSingle();
    if (!m || m.direction !== 'out' || m.status === 'gesendet') return j({ error: 'Nur bei Entwürfen möglich.' }, 409);
    const atts = (m.attachments as MailRow['attachments']) || [];
    if (a.action === 'uploadUrl') {
      const total = atts.reduce((s, x) => s + x.size, 0) + a.size;
      if (total > 25 * 1024 * 1024) return j({ error: 'Anhänge insgesamt höchstens 25 MB.' }, 413);
      const safe = a.name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'anhang';
      const path = `out/${a.id}/${Date.now()}-${safe}`;
      const s = await db.storage.from('mail').createSignedUploadUrl(path);
      return s.data ? j({ url: s.data.signedUrl, token: s.data.token, path }) : j({ error: 'Upload nicht möglich.' }, 502);
    }
    if (a.action === 'attach') {
      if (!a.path.startsWith(`out/${a.id}/`)) return j({ error: 'Ungültig.' }, 400);
      // Virenprüfung: Datei aus dem Speicher lesen (echte Größe statt Angabe des Browsers), bei Fund sofort löschen.
      const dl = await db.storage.from('mail').download(a.path);
      if (!dl.data) return j({ error: 'Anhang nicht gefunden – bitte erneut hochladen.' }, 404);
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

  // Neuer Entwurf an mehrere Adressen: je Adresse ein eigener Entwurf. Adressen, an die es schon einen Entwurf oder eine
  // gesendete E-Mail gibt, werden übersprungen (keine Doppelten).
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
    if (rows.length) { const w = await db.from('lr_mail_messages').insert(rows); if (w.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500); }
    await adminAudit(actor, 'mail_drafts_split', null, { created: rows.length, skipped: want.length - rows.length });
    return j({ ok: true, created: rows.length, skipped: want.filter((e) => taken.has(e)) });
  }
  if (a.to.length > 20) return j({ error: 'Höchstens 20 Empfänger je E-Mail. Beim Speichern „je Adresse ein eigener Entwurf“ wählen.' }, 400);

  // Entwurf speichern (neu, Antwort oder Weiterleitung) – optional direkt senden oder Vorschau liefern.
  let row: Partial<MailRow> & { id: string };
  if (a.id) {
    const { data: m } = await db.from('lr_mail_messages').select('*').eq('id', a.id).maybeSingle();
    if (!m) return j({ error: 'Nicht gefunden.' }, 404);
    if (m.status === 'gesendet') return j({ error: 'Bereits gesendet.' }, 409);
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
    // Fertige Vorlage: ohne neuen Text bleibt sie unverändert; kommt ein Text mit, wird der Entwurf zum Brief (design „frei“)
    // mit aktueller Signatur und Fußzeile – Empfänger, Abmeldelink (Token) und Verlauf bleiben erhalten.
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
  if (w.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  if (!a.send) return j({ ok: true, id: row.id });
  const { data: fresh } = await db.from('lr_mail_messages').select('*').eq('id', row.id).single();
  let r: Awaited<ReturnType<typeof sendRow>>;
  try { r = await sendRow(fresh as MailRow, actor); }
  catch (e) { console.error('mail_send_error', (e as Error).message); return j({ error: `Senden fehlgeschlagen: ${(e as Error).message || 'unbekannter Fehler'}`.slice(0, 300), id: row.id }, 500); }
  if (!r.ok) return j({ error: r.error, id: row.id }, r.status);
  await adminAudit(actor, 'mail_send', a.to.join(','), { id: row.id, thread: normSubject(a.subject).slice(0, 60) });
  return j({ ok: true, id: row.id, sent: true });
}
