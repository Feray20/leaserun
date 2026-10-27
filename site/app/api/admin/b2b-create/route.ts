import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { brancheFromType } from '@/lib/b2b/catalog';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { createB2BLogin, freeSlug, newWidgetKey } from '@/lib/b2b/provision';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin: Unternehmenskonto mit Zugang anlegen (aus einer Anfrage oder direkt).
// Das Startpasswort wird einmalig angezeigt (und auf Wunsch per E-Mail gesendet); es muss beim ersten Login geändert werden.
// § 14 BGB und AVV bestätigt der Inhaber selbst bei der ersten Anmeldung.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const Body = z.object({
  companyName: z.string().transform(clean).pipe(z.string().min(2).max(160)),
  legalForm: z.string().transform(clean).pipe(z.string().min(1).max(60)),
  institutionType: z.enum(['BANK', 'BROKER', 'REALTOR', 'ADVISOR', 'OTHER']),
  advisorName: z.string().transform(clean).pipe(z.string().min(2).max(120)),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).optional().default(''),
  street: z.string().transform(clean).pipe(z.string().min(3).max(120)),
  postalCode: z.string().trim().regex(/^[0-9]{5}$/),
  city: z.string().transform(clean).pipe(z.string().min(2).max(80)),
  registerNumber: z.string().trim().max(40).optional().default(''),
  taxId: z.string().trim().max(30).optional().default(''),
  verified: z.boolean().optional().default(false),
  sendMail: z.boolean().optional().default(false),
  requestId: z.string().uuid().optional(),
  password: z.string().max(72).optional().nullable(),
  mustChange: z.boolean().optional().default(true),
  // Zugriff direkt bei der Anlage: Tarif (manuell, optional befristet) und Module (auto = nach Tarif, on/off = fest).
  plan: z.enum(['BASIC', 'PRO', 'ENTERPRISE']).nullable().optional(),
  planUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  modules: z.record(z.enum(['schnellrechner', 'kreditmappe', 'stresstest', 'whitelabel', 'crm']), z.enum(['auto', 'on', 'off'])).optional(),
});

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    const label: Record<string, string> = { companyName: 'Firmenname', legalForm: 'Rechtsform', advisorName: 'Ansprechpartner', email: 'E-Mail', street: 'Straße und Hausnummer', postalCode: 'Postleitzahl (5 Ziffern)', city: 'Ort' };
    return j({ error: `Bitte „${label[f] || f}“ prüfen.` }, 400);
  }
  const b = p.data;
  if (!b.registerNumber && !b.taxId) return j({ error: 'Bitte Handelsregisternummer oder USt-IdNr./Steuernummer angeben (eines von beiden ist Pflicht).' }, 400);
  const login = await createB2BLogin(b.email, b.advisorName, 'b2b', { password: b.password, mustChange: b.mustChange });
  if (!login.ok) return j({ error: login.error }, login.status);
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const ins = await db.from('lr_b2b_accounts').insert({
    owner_id: login.userId, company_name: b.companyName, legal_form: b.legalForm, institution_type: b.institutionType, branche: brancheFromType(b.institutionType),
    register_number: b.registerNumber.toUpperCase() || null, tax_id: b.taxId || null, advisor_name: b.advisorName, email: b.email, phone: b.phone || null,
    street: b.street, postal_code: b.postalCode, city: b.city, status: 'active', slug: await freeSlug(b.companyName), widget_key: newWidgetKey(),
    ...(b.plan ? { plan_tier: b.plan, plan_source: 'manual', plan_until: b.planUntil ? `${b.planUntil}T23:59:59+01:00` : null } : {}),
    ...(b.modules && Object.values(b.modules).some((v) => v !== 'auto') ? { modules: Object.fromEntries(Object.entries(b.modules).filter(([, v]) => v !== 'auto')) } : {}),
    referral: 'admin', ...(b.verified ? { verified_at: now, verification_status: 'geprueft', verification_decided_at: now, verification_note: 'Bei Anlage durch LeaseRun geprüft.' } : {}),
  }).select('id, customer_number').single();
  if (ins.error || !ins.data) {
    await db.auth.admin.deleteUser(login.userId).catch(() => null);
    console.error('admin_b2b_create', ins.error?.message);
    return j({ error: 'Unternehmenskonto konnte nicht angelegt werden.' }, 500);
  }
  const mem = await db.from('lr_b2b_members').insert({ account_id: ins.data.id, user_id: login.userId, role: 'owner' });
  if (mem.error) {
    await db.from('lr_b2b_accounts').delete().eq('id', ins.data.id);
    await db.auth.admin.deleteUser(login.userId).catch(() => null);
    return j({ error: 'Unternehmenskonto konnte nicht angelegt werden.' }, 500);
  }
  if (b.requestId) {
    await db.from('lr_b2b_contact').update({ status: 'erledigt', account_id: ins.data.id }).eq('id', b.requestId);
    // Nachweis aus der Anfrage in die Verifizierungsunterlagen des neuen Kontos übernehmen.
    const { data: rq } = await db.from('lr_b2b_contact').select('proof_kind, proof_path, proof_name, proof_size, proof_sha256').eq('id', b.requestId).maybeSingle();
    if (rq?.proof_path) {
      const docId = randomUUID();
      const to = `${ins.data.id}/${docId}.${rq.proof_path.split('.').pop()}`;
      const mv = await db.storage.from('b2b-verify').move(rq.proof_path, to);
      if (!mv.error) {
        await db.from('lr_b2b_verification_docs').insert({ id: docId, account_id: ins.data.id, kind: rq.proof_kind || 'gewerbe', file_name: rq.proof_name || 'nachweis', storage_path: to, byte_size: rq.proof_size || 0, sha256: rq.proof_sha256 || '', uploaded_by: login.userId });
        await db.from('lr_b2b_contact').update({ proof_path: null }).eq('id', b.requestId);
        if (!b.verified) await db.from('lr_b2b_accounts').update({ verification_status: 'eingereicht', verification_submitted_at: now }).eq('id', ins.data.id);
      }
    }
  }
  await adminAudit(auth.user.email, 'b2b_account_create', ins.data.id, { verified: b.verified, mailed: b.sendMail, fromRequest: Boolean(b.requestId), ownPassword: Boolean(b.password), plan: b.plan || null, modules: b.modules || null });
  let mailed = false;
  if (b.sendMail && mailConfigured()) {
    mailed = await sendMail(b.email, 'Ihr Zugang zum LeaseRun-Unternehmensportal',
      `Guten Tag ${b.advisorName},\n\nIhr Unternehmenskonto für ${b.companyName} ist eingerichtet (Kundennummer ${ins.data.customer_number}).\n\nPortal: https://partner.leaserun.com\nBenutzername: ${b.email}\nPasswort: ${login.password}\n\nBei der ersten Anmeldung legen Sie ein eigenes Passwort fest und bestätigen die Vertragsunterlagen (Unternehmereigenschaft, Auftragsverarbeitungsvertrag). Das Startpasswort ist danach ungültig.`,
      [], { area: 'b2b', title: 'Ihr Zugang ist eingerichtet', button: { label: 'Zum Unternehmensportal', url: 'https://partner.leaserun.com' }, note: 'Bitte geben Sie das Startpasswort nicht weiter. Fragen: support@leaserun.com' });
  }
  return j({ ok: true, email: b.email, password: login.password, customerNumber: ins.data.customer_number, mailed });
}
