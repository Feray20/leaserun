import '@/lib/env-alias';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, adminList, mfaRequired } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { fromAddress, mailConfigured, sendMail } from '@/lib/notify/mail';
import { SUPABASE_TEMPLATES } from '@/lib/notify/supabase-templates';
import { sampleMails } from '@/lib/notify/catalog';
import { billingEnabled } from '@/lib/billing/stripe';
import { panicState } from '@/lib/security/panic';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const has = (k: string) => Boolean(process.env[k] && String(process.env[k]).trim());

// Systemstatus für den Inhaber: welche Dienste eingerichtet sind (nur ja/nein – niemals Werte von Schlüsseln).
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const q = new URL(req.url).searchParams;

  // Nutzer-Suche (datensparsam): nur Kennzahlen, keine Inhalte.
  const email = (q.get('user') || '').trim().toLowerCase();
  if (email) {
    if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ error: 'Bitte eine E-Mail-Adresse eingeben.' }, 400);
    const db = supabaseAdmin();
    const { data: row } = await db.from('lr_user_data').select('user_id, profile, objects, updated_at').eq('email', email).maybeSingle();
    if (!row) return j({ found: false });
    const u = (await db.auth.admin.getUserById(row.user_id)).data?.user;
    const [{ count: docs }, { count: maps }, { data: mem }] = await Promise.all([
      db.from('lr_documents').select('id', { count: 'exact', head: true }).eq('owner_id', row.user_id),
      db.from('lr_kreditmappe_versions').select('id', { count: 'exact', head: true }).eq('owner_id', row.user_id),
      db.from('lr_b2b_members').select('role, account_id').eq('user_id', row.user_id).limit(1),
    ]);
    await adminAudit(auth.user.email, 'user_lookup', row.user_id, {});
    const prof = (row.profile || {}) as { mode?: string; phase?: number };
    return j({
      found: true,
      user: {
        id: row.user_id, createdAt: u?.created_at ?? null, lastSignIn: u?.last_sign_in_at ?? null, confirmed: Boolean(u?.email_confirmed_at),
        mfa: (u?.factors ?? []).some((f) => f.status === 'verified'), mode: prof.mode ?? null, phase: Number.isInteger(prof.phase) ? prof.phase : null,
        objects: Array.isArray(row.objects) ? row.objects.length : 0, documents: docs ?? 0, kreditmappen: maps ?? 0,
        b2b: mem?.[0] ? { role: mem[0].role, accountId: mem[0].account_id } : null, updatedAt: row.updated_at,
      },
    });
  }

  // Vorlage für Supabase (Authentication → Emails → Templates) als HTML zum Kopieren/Herunterladen.
  const tpl = q.get('template');
  if (tpl) {
    const t = SUPABASE_TEMPLATES.find((x) => x.id === tpl);
    if (!t) return j({ error: 'Unbekannte Vorlage.' }, 404);
    return new NextResponse(t.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="leaserun-${t.id}.html"`, 'Content-Security-Policy': "default-src 'none'; img-src https:; style-src 'unsafe-inline'" } });
  }

  // Kacheln je Bereich (B2C = Privatkunden, B2B = Unternehmen) – nur Zahlen, keine Inhalte.
  const seg = q.get('segment');
  if (seg) {
    if (seg !== 'b2c' && seg !== 'b2b') return j({ error: 'Ungültiger Bereich.' }, 400);
    if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
    const { data, error } = await supabaseAdmin().rpc('admin_segment_overview', { seg, admins: adminList() });
    if (error) return j({ error: 'Übersicht nicht verfügbar.' }, 502);
    return j(data);
  }

  // Analyse (cookielose Reichweitenmessung): Besucher, Seiten, Herkunft, Geräte, Weg zum Kauf.
  const aseg = q.get('analytics');
  if (aseg) {
    if (aseg !== 'b2c' && aseg !== 'b2b') return j({ error: 'Ungültiger Bereich.' }, 400);
    if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
    const days = [1, 7, 30, 90, 365].includes(Number(q.get('days'))) ? Number(q.get('days')) : 30;
    const [{ data, error }, geo] = await Promise.all([supabaseAdmin().rpc('admin_analytics', { seg_in: aseg, days, admins: adminList() }), supabaseAdmin().rpc('admin_analytics_geo', { seg_in: aseg, days })]);
    if (error) return j({ error: 'Analyse nicht verfügbar.' }, 502);
    return j({ ...(data as Record<string, unknown>), ...((geo.data as Record<string, unknown>) || {}) });
  }

  // Funnel je Bereich: wie viele Nutzer welchen Schritt erreichen (nur Zahlen).
  const fseg = q.get('funnel');
  if (fseg) {
    if (fseg !== 'b2c' && fseg !== 'b2b') return j({ error: 'Ungültiger Bereich.' }, 400);
    if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
    const days = Number(q.get('days')) || null;
    const { data, error } = await supabaseAdmin().rpc('admin_funnel', { seg: fseg, admins: adminList(), days: days && [30, 90, 365].includes(days) ? days : null });
    if (error) return j({ error: 'Funnel nicht verfügbar.' }, 502);
    return j(data);
  }

  // Sicherheitsübersicht (Konten, Zwei-Faktor, Sitzungen, Konto-Ereignisse, abgewehrte Zugriffe).
  if (q.get('security')) {
    if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
    const { data, error } = await supabaseAdmin().rpc('admin_security_overview');
    if (error) return j({ error: 'Übersicht nicht verfügbar.' }, 502);
    await adminAudit(auth.user.email, 'security_overview', null, {});
    return j({ ...(data as Record<string, unknown>), mfaRequiredAdmin: mfaRequired() });
  }

  let db_ok = false;
  if (adminConfigured()) {
    try { const r = await supabaseAdmin().from('lr_settings').select('key').limit(1); db_ok = !r.error; } catch { db_ok = false; }
  }
  const panic = await panicState().catch(() => ({ active: false }));
  const checks = [
    { key: 'db', label: 'Datenbank (Supabase)', ok: db_ok, fix: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY in Vercel setzen.' },
    { key: 'admins', label: 'Administratoren (ADMIN_EMAILS)', ok: adminList().length > 0, info: `${adminList().length} eingetragen`, fix: 'ADMIN_EMAILS setzen (kommagetrennt).' },
    { key: 'mfa', label: 'Zweiter Faktor für Admins', ok: mfaRequired(), fix: 'ADMIN_MFA nicht auf „off“ setzen; in Supabase TOTP aktivieren.' },
    { key: 'mail', label: 'E-Mail-Versand (Resend)', ok: mailConfigured(), fix: 'RESEND_API_KEY und NOTIFY_FROM_EMAIL setzen, Absender-Domain bei Resend verifizieren.' },
    { key: 'cron', label: 'Täglicher Lauf (CRON_SECRET)', ok: has('CRON_SECRET'), fix: 'CRON_SECRET setzen (zufälliger langer Wert).' },
    { key: 'billing', label: 'Zahlungen (Stripe)', ok: billingEnabled(), info: has('STRIPE_SECRET_KEY') ? (String(process.env.STRIPE_SECRET_KEY).startsWith('sk_live') ? 'Live-Schlüssel' : 'Test-Schlüssel') : 'kein Schlüssel', fix: 'BILLING_ENABLED, STRIPE_SECRET_KEY (live) und STRIPE_WEBHOOK_SECRET setzen.' },
    { key: 'webhook', label: 'Stripe-Webhook', ok: has('STRIPE_WEBHOOK_SECRET'), fix: 'Webhook in Stripe anlegen und STRIPE_WEBHOOK_SECRET setzen.' },
    { key: 'invoice', label: 'Bankverbindung auf Rechnungen', ok: has('INVOICE_IBAN') && has('INVOICE_BIC'), fix: 'INVOICE_IBAN, INVOICE_BIC, INVOICE_BANK_NAME setzen.' },
    { key: 'leadtoken', label: 'Eigener Schlüssel für Anfrage-PDFs', ok: has('LEAD_TOKEN_SECRET'), optional: true, fix: 'Optional: LEAD_TOKEN_SECRET setzen.' },
    { key: 'preview', label: 'Website öffentlich', ok: true, info: has('SITE_PREVIEW_KEY') ? 'öffentlich · SITE_PREVIEW_KEY hat keine Wirkung mehr und kann in Vercel gelöscht werden' : 'öffentlich', optional: true, fix: '–' },
    { key: 'panic', label: 'Not-Aus', ok: !panic.active, info: panic.active ? 'AKTIV' : 'aus', fix: 'Im Reiter „Sicherheit“ ausschalten.' },
  ];
  const from = fromAddress();
  const mail = {
    resendKey: has('RESEND_API_KEY'), fromSet: Boolean(from), from: from || null,
    fromDomain: (/@([^>\s]+)/.exec(from)?.[1] || '').toLowerCase() || null,
    b2bNotify: true, ready: mailConfigured(),
    templates: SUPABASE_TEMPLATES.map(({ id, supabase, label, subject }) => ({ id, supabase, label, subject })),
  };
  return j({ checks, mail, env: process.env.VERCEL_ENV || 'lokal', commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7), region: process.env.VERCEL_REGION || null });
}

// Test-E-Mail an die eigene Admin-Adresse.
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const p = z.object({ action: z.enum(['testmail', 'testauth', 'testall']), from: z.number().int().min(0).max(500).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  // Alle E-Mail-Vorlagen mit Beispieldaten an die eigene Admin-Adresse (je Aufruf 8 Stück, die Oberfläche ruft nacheinander auf).
  if (p.data.action === 'testall') {
    if (!mailConfigured()) return j({ error: 'E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY, NOTIFY_FROM_EMAIL).' }, 503);
    const all = sampleMails(), from = p.data.from ?? 0, part = all.slice(from, from + 8);
    let sent = 0; const failed: string[] = [];
    for (const [k, m] of part.entries()) {
      const n = from + k + 1;
      const ok = await sendMail(auth.user.email, `[Test ${n}/${all.length}] ${m.subject}`, m.text, [], { ...m.opts, replyTo: m.opts?.replyTo, headers: { 'X-LeaseRun-Test': m.group } });
      if (ok) sent++; else failed.push(`${m.group}: ${m.label}`);
      await new Promise((r) => setTimeout(r, 550)); // Resend erlaubt wenige E-Mails pro Sekunde
    }
    if (from === 0) await adminAudit(auth.user.email, 'testmail_all', null, { total: all.length });
    return j({ ok: true, to: auth.user.email, total: all.length, next: from + part.length < all.length ? from + part.length : null, sent, failed });
  }
  // Konto-E-Mail über Supabase (prüft „Custom SMTP“ und die Vorlagen): Passwort-Link an die eigene Admin-Adresse.
  if (p.data.action === 'testauth') {
    if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
    const { error } = await supabaseAdmin().auth.resetPasswordForEmail(auth.user.email, { redirectTo: 'https://leaserun.com/auth/reset' });
    await adminAudit(auth.user.email, 'testmail_auth', null, { ok: !error });
    return error ? j({ error: /rate|seconds/i.test(error.message) ? 'Bitte eine Minute warten und erneut versuchen.' : 'Versand über Supabase fehlgeschlagen – SMTP-Einstellungen prüfen.' }, 502) : j({ ok: true, to: auth.user.email });
  }
  if (!mailConfigured()) return j({ error: 'E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY, NOTIFY_FROM_EMAIL).' }, 503);
  const ok = await sendMail(auth.user.email, 'LeaseRun: Test-E-Mail', `Diese Test-E-Mail bestätigt, dass der E-Mail-Versand funktioniert.\nZeitpunkt: ${new Date().toISOString()}`);
  await adminAudit(auth.user.email, 'testmail', null, { ok });
  return ok ? j({ ok: true, to: auth.user.email }) : j({ error: 'Versand fehlgeschlagen – Absender-Domain bei Resend verifiziert?' }, 502);
}
