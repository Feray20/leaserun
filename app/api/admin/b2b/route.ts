import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit, dossiersThisMonth, effectiveTier, type B2BAccount } from '@/lib/b2b/core';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// Alle Unternehmenskonten mit Kennzahlen (Inhaber-Ansicht, nur lesend).
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const db = supabaseAdmin();
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return j({ error: 'Ungültig.' }, 400);
    const [{ data: a }, { data: mem }, { data: leads }, { data: inv }, { data: vdocs }] = await Promise.all([
      db.from('immo_b2b_accounts').select('*').eq('id', id).maybeSingle(),
      db.from('immo_b2b_members').select('user_id, role, created_at').eq('account_id', id),
      db.from('immo_b2b_leads').select('id, source, status, created_at').eq('account_id', id).order('created_at', { ascending: false }).limit(50),
      db.from('immo_invoices').select('id, invoice_number, kind, gross_cents, payment_status, issue_date').eq('account_id', id).order('issue_date', { ascending: false }).limit(50),
      db.from('immo_b2b_verification_docs').select('id, kind, file_name, byte_size, sha256, storage_path, created_at').eq('account_id', id).order('created_at'),
    ]);
    if (!a) return j({ error: 'Nicht gefunden.' }, 404);
    const members = await Promise.all((mem ?? []).map(async (m) => ({ ...m, email: (await db.auth.admin.getUserById(m.user_id)).data?.user?.email ?? '' })));
    const { widget_key: _k, ...safe } = a as B2BAccount; // eslint-disable-line @typescript-eslint/no-unused-vars
    // Nachweise: kurzlebige, signierte Links (5 Minuten) – Dateien liegen in einem privaten Speicher. Jeder Abruf wird protokolliert.
    const docs = await Promise.all((vdocs ?? []).map(async (d) => {
      const sig = await db.storage.from('b2b-verify').createSignedUrl(d.storage_path, 300, { download: d.file_name });
      const { storage_path: _p, ...rest } = d; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { ...rest, url: sig.data?.signedUrl ?? null };
    }));
    if (docs.length) await adminAudit(auth.user.email, 'b2b_verification_view', id, { docs: docs.length });
    return j({ account: { ...safe, tier: effectiveTier(a as B2BAccount), dossiersThisMonth: await dossiersThisMonth(id) }, members, leads: leads ?? [], invoices: inv ?? [], verificationDocs: docs });
  }
  const { data, error } = await db
    .from('immo_b2b_accounts')
    .select('id, customer_number, company_name, legal_form, institution_type, register_number, tax_id, advisor_name, email, postal_code, city, plan_tier, plan_source, plan_until, billing_interval, status, lock_reason, verified_at, verification_status, verification_submitted_at, dossier_bonus, has_whitelabel, allow_invoice_payment, invoice_limit_cents, payment_terms_days, referral, slug, created_at')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) return j({ error: error.message }, 500);
  const { data: leadRows } = await db.from('immo_b2b_leads').select('account_id').limit(20000);
  const leadCount = new Map<string, number>();
  for (const r of leadRows ?? []) leadCount.set(r.account_id, (leadCount.get(r.account_id) ?? 0) + 1);
  return j({ accounts: (data ?? []).map((a) => ({ ...a, tier: effectiveTier(a as B2BAccount), leads: leadCount.get(a.id) ?? 0 })) });
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify'), id: z.string().uuid(), on: z.boolean() }),
  z.object({ action: z.literal('approve'), id: z.string().uuid() }),
  z.object({ action: z.literal('reject'), id: z.string().uuid(), reason: z.string().trim().min(5).max(600) }),
  z.object({ action: z.literal('lock'), id: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal('unlock'), id: z.string().uuid() }),
  z.object({ action: z.literal('whitelabel'), id: z.string().uuid(), on: z.boolean() }),
  z.object({ action: z.literal('invoicePayment'), id: z.string().uuid(), on: z.boolean(), limitCents: z.number().int().min(0).max(100_000_00).nullable().optional(), termsDays: z.number().int().min(0).max(90).optional() }),
  z.object({ action: z.literal('credits'), id: z.string().uuid(), add: z.number().int().min(-500).max(500) }),
  z.object({ action: z.literal('plan'), id: z.string().uuid(), tier: z.enum(['BASIC', 'PRO', 'ENTERPRISE']).nullable(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }),
]);

// Inhaber-Aktionen je Partner. Jede Aktion wird im Admin-Protokoll vermerkt.
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const p = Action.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültige Aktion.' }, 400);
  const a = p.data;
  const db = supabaseAdmin();
  const { data: cur } = await db.from('immo_b2b_accounts').select('*').eq('id', a.id).maybeSingle();
  if (!cur) return j({ error: 'Konto nicht gefunden.' }, 404);
  const now = new Date().toISOString();
  let up: Record<string, unknown> = {};
  switch (a.action) {
    case 'verify': up = { verified_at: a.on ? now : null, verification_status: a.on ? 'geprueft' : 'offen', verification_decided_at: a.on ? now : null }; break;
    // Freischaltung nach Prüfung der Nachweise; das Konto wird aktiv und das Unternehmen per E-Mail informiert.
    case 'approve': up = { verified_at: now, verification_status: 'geprueft', verification_decided_at: now, verification_note: null, status: cur.status === 'locked' ? 'locked' : 'active' }; break;
    case 'reject': up = { verified_at: null, verification_status: 'abgelehnt', verification_decided_at: now, verification_note: a.reason }; break;
    // Sperre wirkt sofort: alle Portal-Schnittstellen, Widget, Partnerseite, QR-Ziel und Kreditmappen-Kontingent prüfen den Status.
    case 'lock': up = { status: 'locked', lock_reason: a.reason }; break;
    case 'unlock': up = { status: 'active', lock_reason: null }; break;
    case 'whitelabel': up = { has_whitelabel: a.on }; break;
    case 'invoicePayment': up = { allow_invoice_payment: a.on, invoice_limit_cents: a.limitCents ?? null, ...(a.termsDays !== undefined ? { payment_terms_days: a.termsDays } : {}) }; break;
    case 'credits': up = { dossier_bonus: Math.max(0, (cur.dossier_bonus ?? 0) + a.add) }; break;
    case 'plan':
      if (cur.plan_source === 'stripe' && cur.stripe_subscription_id && cur.plan_tier) return j({ error: 'Konto hat ein Stripe-Abo. Änderungen bitte in Stripe vornehmen.' }, 409);
      up = a.tier ? { plan_tier: a.tier, plan_source: 'manual', plan_until: a.until ? `${a.until}T23:59:59+01:00` : null } : { plan_tier: null, plan_source: null, plan_until: null };
      break;
  }
  const r = await db.from('immo_b2b_accounts').update({ ...up, updated_at: now }).eq('id', a.id);
  if (r.error) return j({ error: r.error.message }, 500);
  await adminAudit(auth.user.email, `b2b_${a.action}`, a.id, { ...a, id: undefined });
  if ((a.action === 'approve' || a.action === 'reject') && mailConfigured()) {
    const c = cur as B2BAccount;
    if (a.action === 'approve') await sendMail(c.email, 'Ihr ImmoAdv-Unternehmenskonto ist freigeschaltet',
      `Guten Tag ${c.advisor_name},\n\nwir haben Ihre Unterlagen geprüft und Ihr Unternehmenskonto für ${c.company_name} freigeschaltet. Partnerseite, Widget, Anfragen, Kreditmappen und Tarife stehen Ihnen jetzt zur Verfügung:\nhttps://immoadv.de/b2b-portal\n\nImmoAdv · support@immoadv.de`);
    else await sendMail(c.email, 'Ihr ImmoAdv-Unternehmenskonto: Unterlagen bitte ergänzen',
      `Guten Tag ${c.advisor_name},\n\nwir konnten Ihr Unternehmenskonto für ${c.company_name} noch nicht freischalten.\n\nBegründung: ${a.reason}\n\nBitte laden Sie die fehlenden Unterlagen im Portal unter „Verifizierung“ hoch und reichen Sie erneut ein:\nhttps://immoadv.de/b2b-portal#verifizierung\n\nImmoAdv · support@immoadv.de`);
  }
  return j({ ok: true });
}
