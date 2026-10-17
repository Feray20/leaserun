import { NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { unsubToken } from '@/lib/marketing/consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Web-Admin → Werbung: Kampagnen mit Tracking-Link und QR-Code, Erfolg je Kampagne (cookielose Analyse),
// Neuigkeiten-E-Mails nur an bestätigte Abonnenten (Double-Opt-in) mit Abmeldelink und Versandprotokoll.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const SITE = 'https://immoadv.de';
const linkOf = (c: { slug: string; channel: string; target_path: string }) => `${SITE}${c.target_path}?utm_source=${c.channel}&utm_medium=${c.channel === 'brief' || c.channel === 'messe' ? 'offline' : 'online'}&utm_campaign=${c.slug}`;

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const db = supabaseAdmin(), q = new URL(req.url).searchParams;
  const qr = q.get('qr');
  if (qr) {
    const { data: c } = await db.from('immo_campaigns').select('slug, channel, target_path').eq('slug', qr).maybeSingle();
    if (!c) return j({ error: 'Nicht gefunden.' }, 404);
    const png = await QRCode.toBuffer(linkOf(c), { margin: 2, width: 1200, errorCorrectionLevel: 'M', color: { dark: '#0F2C59', light: '#FFFFFF' } });
    return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="qr-${c.slug}.png"`, 'Cache-Control': 'no-store' } });
  }
  const sid = q.get('send');
  if (sid) {
    if (!/^[0-9a-f-]{36}$/.test(sid)) return j({ error: 'Ungültig.' }, 400);
    const { data } = await db.from('immo_newsletter_deliveries').select('email, ok, at').eq('send_id', sid).order('at').limit(5000);
    return j({ deliveries: data ?? [] });
  }
  const [{ data: camps }, { data: stats }, { data: subs }, { data: sends }, { data: letters }] = await Promise.all([
    db.from('immo_campaigns').select('*').order('created_at', { ascending: false }).limit(200),
    db.rpc('admin_campaign_stats', { days: 365 }),
    db.from('immo_newsletter').select('id, created_at, email, name, company, segment, source, confirmed_at, unsubscribed_at').order('created_at', { ascending: false }).limit(5000),
    db.from('immo_newsletter_sends').select('id, created_at, campaign_slug, subject, segment, recipients, failed, actor').order('created_at', { ascending: false }).limit(100),
    db.from('immo_crm_activities').select('campaign').eq('type', 'brief').not('campaign', 'is', null).limit(20000),
  ]);
  const lettersBy: Record<string, number> = {};
  for (const l of letters ?? []) lettersBy[l.campaign as string] = (lettersBy[l.campaign as string] || 0) + 1;
  const st = (stats || {}) as Record<string, { visitors: number; pageviews: number; requests: number; registrations: number }>;
  return j({
    campaigns: (camps ?? []).map((c) => ({ ...c, link: linkOf(c), stats: st[c.slug] || { visitors: 0, pageviews: 0, requests: 0, registrations: 0 }, letters: lettersBy[c.slug] || 0 })),
    subscribers: subs ?? [], sends: sends ?? [], mail: mailConfigured(),
  });
}

const Act = z.discriminatedUnion('action', [
  z.object({ action: z.literal('campaign'), name: z.string().trim().min(2).max(120), slug: z.string().regex(/^[a-z0-9-]{3,40}$/), channel: z.enum(['brief', 'qr', 'link', 'newsletter', 'social', 'anzeige', 'messe']), segment: z.enum(['b2b', 'b2c']), targetPath: z.string().regex(/^\/[a-z0-9/_-]*$/).max(80), notes: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('toggle'), id: z.string().uuid(), active: z.boolean() }),
  z.object({ action: z.literal('send'), segment: z.enum(['b2b', 'b2c']), subject: z.string().trim().min(3).max(160), body: z.string().trim().min(20).max(20000), campaign: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(), buttonLabel: z.string().trim().max(60).optional(), buttonPath: z.string().regex(/^\/[a-z0-9/_-]*$/).max(80).optional(), test: z.boolean().optional(), continueId: z.string().uuid().optional() }),
  z.object({ action: z.literal('unsubscribe'), id: z.string().uuid() }),
]);

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Act.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: `Bitte „${String(p.error.issues[0]?.path.at(-1) ?? '')}“ prüfen.` }, 400);
  const a = p.data, db = supabaseAdmin(), actor = auth.user.email;
  if (a.action === 'campaign') {
    const r = await db.from('immo_campaigns').insert({ name: a.name, slug: a.slug, channel: a.channel, segment: a.segment, target_path: a.targetPath, notes: a.notes || null });
    if (r.error) return j({ error: /duplicate/.test(r.error.message) ? 'Diese Kennung gibt es schon.' : 'Speichern fehlgeschlagen.' }, 400);
    await adminAudit(actor, 'campaign_create', a.slug);
    return j({ ok: true });
  }
  if (a.action === 'toggle') { await db.from('immo_campaigns').update({ active: a.active }).eq('id', a.id); return j({ ok: true }); }
  if (a.action === 'unsubscribe') { await db.from('immo_newsletter').update({ unsubscribed_at: new Date().toISOString() }).eq('id', a.id); await adminAudit(actor, 'newsletter_unsub', a.id); return j({ ok: true }); }
  // Versand: nur bestätigte, nicht abgemeldete Abonnenten des Bereichs.
  if (!mailConfigured()) return j({ error: 'E-Mail-Versand ist noch nicht eingerichtet (System → E-Mail-Versand).' }, 503);
  const utm = a.campaign ? `?utm_source=newsletter&utm_medium=email&utm_campaign=${a.campaign}` : '';
  const button = a.buttonLabel && a.buttonPath ? { label: a.buttonLabel, url: `${SITE}${a.buttonPath}${utm}` } : undefined;
  const one = async (to: string, id: string | null) => {
    const unsub = id ? `${SITE}/api/newsletter?unsub=${unsubToken(id)}` : `${SITE}/datenschutz`;
    return sendMail(to, a.subject, a.body, [], {
      title: a.subject, button,
      note: `Sie erhalten diese E-Mail, weil Sie Neuigkeiten von ImmoAdv bestellt haben. Abmelden: ${unsub}`,
      headers: id ? { 'List-Unsubscribe': `<${SITE}/api/newsletter/unsub?t=${unsubToken(id)}>, <mailto:support@immoadv.de?subject=Abmelden>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
    });
  };
  if (a.test) { const ok = await one(actor, null); return ok ? j({ ok: true, test: true }) : j({ error: 'Testversand fehlgeschlagen.' }, 502); }
  const { data: subs } = await db.from('immo_newsletter').select('id, email').eq('segment', a.segment).not('confirmed_at', 'is', null).is('unsubscribed_at', null).limit(2000);
  let list = subs ?? [];
  if (!list.length) return j({ error: 'Noch keine bestätigten Abonnenten in diesem Bereich.' }, 400);
  // Fortsetzung eines großen Versands: bereits zugestellte Empfänger überspringen (keine Doppelversendung).
  let send: { data: { id: string } | null; error: unknown };
  if (a.continueId) {
    const { data: done } = await db.from('immo_newsletter_deliveries').select('subscriber_id').eq('send_id', a.continueId).limit(10000);
    const seen = new Set((done ?? []).map((x) => x.subscriber_id));
    list = list.filter((x) => !seen.has(x.id));
    send = { data: { id: a.continueId }, error: null };
  } else send = await db.from('immo_newsletter_sends').insert({ campaign_slug: a.campaign || null, subject: a.subject, body: a.body, segment: a.segment, recipients: 0, actor }).select('id').single();
  if (send.error || !send.data) return j({ error: 'Versand konnte nicht angelegt werden.' }, 500);
  let ok = 0, failed = 0; const log: { send_id: string; subscriber_id: string; email: string; ok: boolean }[] = [];
  const t0 = Date.now();
  for (const s of list) {
    if (Date.now() - t0 > 50_000) break;
    const r = await one(s.email, s.id);
    if (r) ok++; else failed++;
    log.push({ send_id: send.data.id, subscriber_id: s.id, email: s.email, ok: r });
  }
  if (log.length) await db.from('immo_newsletter_deliveries').insert(log);
  const { data: tot } = await db.from('immo_newsletter_deliveries').select('ok').eq('send_id', send.data.id).limit(10000);
  await db.from('immo_newsletter_sends').update({ recipients: (tot ?? []).filter((x) => x.ok).length, failed: (tot ?? []).filter((x) => !x.ok).length }).eq('id', send.data.id);
  await adminAudit(actor, 'newsletter_send', send.data.id, { ok, failed, total: list.length });
  return j({ ok: true, sent: ok, failed, remaining: list.length - log.length, sendId: send.data.id });
}
