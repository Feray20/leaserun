import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { anonymizedIpHash } from '@/lib/supabase/admin';
import { hasOwnCookie, ownCookieHeader, trustIp, trustedList, untrustIp } from '@/lib/security/trusted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → Sicherheit → Vorfälle: Angriffe und Bot-Wellen der letzten 7 Tage, Quellen sperren/entsperren, Vorfälle als erledigt markieren.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const LABEL: Record<string, string> = { probe: 'Scanner / Angriffsversuch', blocked: 'Gesperrte Quelle', admin_denied: 'Web-Admin ohne Berechtigung', admin_ip_blocked: 'Web-Admin von fremder IP', admin_mfa_missing: 'Web-Admin ohne 2. Faktor', rate_limit: 'Zu viele Anfragen (gedrosselt)', honeypot: 'Formular-Bot (Honigtopf)', too_fast: 'Formular-Bot (zu schnell)', disposable_email: 'Wegwerf-E-Mail', email_no_mx: 'E-Mail-Domain ohne Postfach', content_flagged: 'Spam-Inhalt', panic: 'Not-Aus', login_flood: 'Viele Fehlanmeldungen', upload_rejected: 'Upload abgewiesen' };

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: ev }, { data: bl }, { data: st }] = await Promise.all([
    db.from('lr_security_log').select('id, created_at, kind, bucket, detail, ip_hash, acknowledged_at').gte('created_at', since).order('created_at', { ascending: false }).limit(3000),
    db.from('lr_security_blocks').select('*').order('created_at', { ascending: false }).limit(500),
    db.from('lr_settings').select('value').eq('key', 'sec_alert_last').maybeSingle(),
  ]);
  const trusted = await trustedList(true);
  const own = new Set(trusted.map((t) => t.ip));
  // Eigene Netze nie als Vorfall zeigen (auch Altbestand vor der Freigabe).
  const rows = (ev ?? []).filter((r) => !r.ip_hash || !own.has(r.ip_hash));
  const here = anonymizedIpHash(req);
  const groups = new Map<string, { kind: string; label: string; ip: string | null; n: number; open: number; first: string; last: string; details: Set<string> }>();
  for (const r of rows) {
    const k = `${r.kind}|${r.ip_hash || '-'}`;
    const g = groups.get(k) || { kind: r.kind, label: LABEL[r.kind] || r.kind, ip: r.ip_hash, n: 0, open: 0, first: r.created_at, last: r.created_at, details: new Set<string>() };
    g.n++; if (!r.acknowledged_at) g.open++; if (r.created_at < g.first) g.first = r.created_at; if (r.created_at > g.last) g.last = r.created_at;
    if (r.detail && g.details.size < 5) g.details.add(r.detail); else if (r.bucket && g.details.size < 5) g.details.add(r.bucket);
    groups.set(k, g);
  }
  const blockedSet = new Set((bl ?? []).filter((b) => !b.until || new Date(b.until) > new Date()).map((b) => b.ip_hash));
  return j({
    groups: [...groups.values()].map((g) => ({ ...g, details: [...g.details], blocked: g.ip ? blockedSet.has(g.ip) : false })).sort((a, b) => (b.open - a.open) || (b.last > a.last ? 1 : -1)).slice(0, 200),
    total: rows.length, open: rows.filter((r) => !r.acknowledged_at).length,
    blocks: (bl ?? []).map((b) => ({ ...b, active: !b.until || new Date(b.until) > new Date() })),
    lastAlerts: (st?.value as Record<string, string>) || {},
    trusted: trusted.map((t) => ({ ip: t.ip, label: t.label, seen: t.seen, here: t.ip === here })),
    here: { ip: here, trusted: Boolean(here && own.has(here)), cookie: hasOwnCookie(req) },
  });
}

const Act = z.discriminatedUnion('action', [
  z.object({ action: z.literal('block'), ip: z.string().regex(/^[0-9a-f]{32}$/), days: z.number().int().min(1).max(3650).nullable(), reason: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal('unblock'), ip: z.string().regex(/^[0-9a-f]{32}$/) }),
  z.object({ action: z.literal('testalert') }),
  z.object({ action: z.literal('trust'), label: z.string().trim().max(60).optional() }),
  z.object({ action: z.literal('untrust'), ip: z.string().regex(/^[0-9a-f]{32}$/) }),
  z.object({ action: z.literal('ack'), kind: z.string().max(40).optional(), ip: z.string().regex(/^[0-9a-f]{32}$/).nullable().optional() }),
]);

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Act.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const a = p.data, db = supabaseAdmin(), now = new Date();
  if (a.action === 'testalert') {
    if (!mailConfigured()) return j({ error: 'E-Mail-Versand ist noch nicht eingerichtet (Reiter Einrichtung).' }, 503);
    const ok = await sendMail(auth.user.email, 'Test: Sicherheitsalarm von LeaseRun', 'Dies ist ein Testalarm. Bei echten Angriffen (Scanner, Zugriffsversuche auf den Web-Admin, Bot-Wellen) erhalten Sie E-Mails in dieser Form – höchstens alle 15 Minuten je Art.', [], { title: 'Testalarm', button: { label: 'Im Web-Admin ansehen', url: 'https://leaserun.com/internal/web-admin#sicherheit' } });
    return ok ? j({ ok: true }) : j({ error: 'Versand fehlgeschlagen – Resend-Domain prüfen.' }, 502);
  }
  if (a.action === 'trust') {
    const ip = anonymizedIpHash(req);
    await trustIp(ip, a.label || 'Eigenes Gerät');
    await adminAudit(auth.user.email, 'sec_trust', ip ? ip.slice(0, 8) : '-');
    const res = j({ ok: true });
    res.headers.append('Set-Cookie', ownCookieHeader());
    return res;
  }
  if (a.action === 'untrust') {
    await untrustIp(a.ip);
    await adminAudit(auth.user.email, 'sec_untrust', a.ip.slice(0, 8));
    return j({ ok: true });
  }
  if (a.action === 'block') {
    if ((await trustedList()).some((t) => t.ip === a.ip)) return j({ error: 'Das ist eines Ihrer eigenen Netze – erst unter „Eigene Geräte“ entfernen.' }, 409);
    const r = await db.from('lr_security_blocks').upsert({ ip_hash: a.ip, until: a.days ? new Date(now.getTime() + a.days * 864e5).toISOString() : null, reason: a.reason || null, created_by: auth.user.email, created_at: now.toISOString() });
    if (r.error) return j({ error: 'Sperren fehlgeschlagen.' }, 500);
    await db.from('lr_security_log').update({ acknowledged_at: now.toISOString() }).eq('ip_hash', a.ip).is('acknowledged_at', null);
    await adminAudit(auth.user.email, 'sec_block', a.ip.slice(0, 8), { days: a.days });
    return j({ ok: true });
  }
  if (a.action === 'unblock') {
    await db.from('lr_security_blocks').delete().eq('ip_hash', a.ip);
    await adminAudit(auth.user.email, 'sec_unblock', a.ip.slice(0, 8));
    return j({ ok: true });
  }
  let q = db.from('lr_security_log').update({ acknowledged_at: now.toISOString() }).is('acknowledged_at', null);
  if (a.kind) q = q.eq('kind', a.kind);
  if (a.ip) q = q.eq('ip_hash', a.ip); else if (a.ip === null) q = q.is('ip_hash', null);
  const r = await q;
  if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  await adminAudit(auth.user.email, 'sec_ack', a.kind || 'alle');
  return j({ ok: true });
}
