import { createHash, randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { RegistrationProofDocument, proofText, typeLabel, type RegistrationProof } from '@/lib/b2b/registration-proof';
import { avvEvidence } from '@/lib/b2b/avv-evidence';
import { AVV_VERSION, TIER_LIMITS, adminAudit, dossiersThisMonth, effectiveTier, membershipFor, newWidgetKey, slugify, type B2BAccount } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { newWebhookSecret, safeTarget } from '@/lib/b2b/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REGISTER_RE = /^D-[A-Z0-9]{1,4}(-[A-Z0-9]{1,8}){1,6}$/i; // Vermittlerregister (DIHK), z. B. D-W-123-ABCD-12
const VATID_RE = /^DE[0-9]{9}$/;
const STNR_RE = /^[0-9][0-9 /]{8,18}[0-9]$/;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const RegisterSchema = z.object({
  companyName: z.string().transform(clean).pipe(z.string().min(2).max(160)),
  legalForm: z.string().transform(clean).pipe(z.string().min(1).max(60)),
  institutionType: z.enum(['BANK', 'BROKER', 'REALTOR', 'OTHER']),
  registerNumber: z.string().transform(clean).optional().default(''),
  taxId: z.string().transform((s) => s.replace(/\s+/g, '').toUpperCase()).optional().default(''),
  advisorName: z.string().transform(clean).pipe(z.string().min(2).max(120)),
  phone: z.string().transform(clean).pipe(z.string().max(40)).optional().default(''),
  street: z.string().transform(clean).pipe(z.string().min(3).max(160)),
  postalCode: z.string().regex(/^[0-9]{5}$/),
  city: z.string().transform(clean).pipe(z.string().min(2).max(80)),
  unternehmer: z.literal(true),
  avv: z.literal(true),
  richtig: z.literal(true),
  agb: z.literal(true),
  partnerCode: z.string().transform((s) => s.trim().toUpperCase()).optional().default(''),
  referral: z.string().max(40).optional().default(''),
});

const PatchSchema = z.object({
  advisorName: z.string().transform(clean).pipe(z.string().min(2).max(120)).optional(),
  phone: z.string().transform(clean).pipe(z.string().max(40)).optional(),
  street: z.string().transform(clean).pipe(z.string().min(3).max(160)).optional(),
  postalCode: z.string().regex(/^[0-9]{5}$/).optional(),
  city: z.string().transform(clean).pipe(z.string().min(2).max(80)).optional(),
  bookingUrl: z.union([z.literal(''), z.string().url().max(300).refine((u) => u.startsWith('https://'), 'https erforderlich')]).optional(),
  brandColor: z.union([z.literal(''), z.string().regex(/^#[0-9A-Fa-f]{6}$/)]).optional(),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
  allowedDomains: z.array(z.string().regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/i).max(100)).max(10).optional(),
  leadGate: z.boolean().optional(),
  widgetActive: z.boolean().optional(),
  regenerateKey: z.literal(true).optional(),
  supportAccessDays: z.union([z.literal(0), z.literal(7)]).optional(),
  acceptSubmissions: z.boolean().optional(),
  leadRetentionMonths: z.number().int().min(1).max(120).optional(),
  webhookUrl: z.union([z.literal(''), z.string().url().max(300)]).optional(),
  regenerateWebhookSecret: z.literal(true).optional(),
  customDisclaimer: z.string().trim().max(600).optional(),
  brandColor2: z.union([z.literal(''), z.string().regex(/^#[0-9A-Fa-f]{6}$/)]).optional(),
  brandFont: z.enum(['sans', 'serif', 'klassisch']).optional(),
  docTitle: z.string().transform(clean).pipe(z.string().max(80)).optional(),
  docSender: z.string().transform(clean).pipe(z.string().max(160)).optional(),
  docFooter: z.string().trim().max(400).optional(),
});

function view(a: B2BAccount, role: string) {
  const tier = effectiveTier(a);
  return {
    role,
    tier,
    limits: tier ? TIER_LIMITS[tier] : null,
    account: {
      customerNumber: a.customer_number, companyName: a.company_name, legalForm: a.legal_form, institutionType: a.institution_type,
      registerNumber: a.register_number, taxId: a.tax_id, advisorName: a.advisor_name, email: a.email, phone: a.phone,
      street: a.street, postalCode: a.postal_code, city: a.city, status: a.status, lockReason: a.lock_reason, verified: Boolean(a.verified_at),
      planTier: a.plan_tier, planSource: a.plan_source, planUntil: a.plan_until, billingInterval: a.billing_interval,
      dossierBonus: a.dossier_bonus, hasWhitelabel: a.has_whitelabel, allowInvoicePayment: a.allow_invoice_payment,
      avvAcceptedAt: a.avv_accepted_at, avvVersion: a.avv_version, unternehmerConfirmedAt: a.unternehmer_confirmed_at,
      hasLogo: Boolean(a.logo_path), brandColor: a.brand_color, brandColor2: a.brand_color2 ?? null, brandFont: a.brand_font ?? 'sans', docTitle: a.doc_title ?? '', docSender: a.doc_sender ?? '', docFooter: a.doc_footer ?? '', bookingUrl: a.booking_url, slug: a.slug,
      widgetKey: role === 'owner' ? a.widget_key : null, widgetActive: a.widget_active, allowedDomains: a.allowed_domains, leadGate: a.lead_gate,
      createdAt: a.created_at, supportAccessUntil: a.support_access_until ?? null, acceptSubmissions: Boolean(a.accept_submissions), leadRetentionMonths: a.lead_retention_months ?? 24, webhookUrl: role === 'owner' ? a.webhook_url ?? null : null, webhookSecret: role === 'owner' ? a.webhook_secret ?? null : null, customDisclaimer: a.custom_disclaimer ?? null,
    },
  };
}

// Branchen-Ansicht je Berater (in den eigenen Kontodaten gespeichert, jederzeit im Portal wechselbar).
const BRANCHEN = ['bank', 'vermittler', 'makler', 'finanzberater', 'allgemein'];

export async function GET(req: Request) {
  if (!adminConfigured()) return json({ error: 'Nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`b2b-get:${user.id}`, 60, 60_000)) return json({ error: 'Zu viele Anfragen.' }, 429);
  const m = await membershipFor(user.id);
  if (!m) return json({ account: null, avvVersion: AVV_VERSION });
  const db = supabaseAdmin();
  const [{ count: seats }, used, { count: leadsNew }] = await Promise.all([
    db.from('immo_b2b_members').select('user_id', { count: 'exact', head: true }).eq('account_id', m.account.id),
    dossiersThisMonth(m.account.id),
    db.from('immo_b2b_leads').select('id', { count: 'exact', head: true }).eq('account_id', m.account.id).eq('status', 'neu'),
  ]);
  // Erstanmeldung: Startpasswort ändern; Inhaber bestätigt § 14 BGB und schließt den AVV ab.
  let mustChange = false, branche: string | null = null;
  try {
    const meta = (await db.auth.admin.getUserById(user.id)).data?.user?.user_metadata || {};
    mustChange = Boolean(meta.must_change_password);
    branche = BRANCHEN.includes(meta.b2b_branche) ? meta.b2b_branche : null;
  } catch { mustChange = false; }
  const consentsMissing = m.role === 'owner' && (!m.account.unternehmer_confirmed_at || !m.account.avv_accepted_at);
  return json({ ...view(m.account, m.role), usage: { seats: seats ?? 1, dossiersThisMonth: used, leadsNew: leadsNew ?? 0 }, avvVersion: AVV_VERSION, branche, onboarding: { mustChange, consentsMissing } });
}

// Registrierung eines Unternehmenskontos (nur Unternehmer nach § 14 BGB, mit AVV nach Art. 28 DSGVO).
export async function POST(req: Request) {
  // Zugänge vergibt ImmoAdv im Web-Admin nach einer Anfrage – keine Selbstregistrierung mehr.
  if (process.env.B2B_SELF_SIGNUP !== 'true') return json({ error: 'Unternehmenskonten vergibt ImmoAdv nach einer Anfrage: https://immoadv.de/b2b#anfrage' }, 403);
  if (!adminConfigured()) return json({ error: 'Nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`b2b-register:${user.id}`, 5, 60_000)) return json({ error: 'Zu viele Anfragen.' }, 429);
  const parsed = RegisterSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const f = parsed.error.issues[0]?.path[0];
    const msg: Record<string, string> = {
      unternehmer: 'Bitte bestätigen, dass Sie als Unternehmer handeln (§ 14 BGB).',
      avv: 'Bitte dem Auftragsverarbeitungsvertrag zustimmen.',
      richtig: 'Bitte versichern, dass die Angaben vollständig und richtig sind.',
      agb: 'Bitte die Nutzungsbedingungen und Datenschutzhinweise bestätigen.',
      postalCode: 'Bitte eine fünfstellige Postleitzahl angeben.',
      street: 'Bitte Straße und Hausnummer angeben.',
    };
    return json({ error: msg[String(f)] ?? `Bitte die Angabe „${String(f ?? 'Formular')}“ prüfen.` }, 400);
  }
  const b = parsed.data;
  const reg = b.registerNumber.toUpperCase();
  if (!reg && !b.taxId) return json({ error: 'Bitte Vermittler-Registernummer oder Steuernummer/USt-IdNr. angeben.' }, 400);
  if (reg && !REGISTER_RE.test(reg)) return json({ error: 'Registernummer im Format D-XXXX-XXXX-XX angeben (Vermittlerregister).' }, 400);
  if (b.taxId && !(VATID_RE.test(b.taxId) || STNR_RE.test(b.taxId))) return json({ error: 'USt-IdNr. (DE + 9 Ziffern) oder Steuernummer prüfen.' }, 400);
  if ((b.institutionType === 'BROKER' || b.institutionType === 'REALTOR') && !reg && !b.taxId) return json({ error: 'Registernummer angeben.' }, 400);

  if (await membershipFor(user.id)) return json({ error: 'Dieses Konto gehört bereits zu einem Unternehmen.' }, 409);
  const db = supabaseAdmin();

  // Freie Partner-URL aus dem Firmennamen ableiten.
  const base = slugify(b.companyName).replace(/-(gmbh|ug|ag|kg|ohg|gbr|e-k|mbh)$/g, '').slice(0, 34) || 'partner';
  let slug = base.length >= 3 ? base : `${base}-partner`;
  for (let i = 2; i < 50; i++) {
    const { data } = await db.from('immo_b2b_accounts').select('id').eq('slug', slug).maybeSingle();
    if (!data) break;
    slug = `${base}-${i}`;
  }

  let referral = b.referral.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || null;
  if (b.partnerCode) {
    const { data: code } = await db.from('immo_b2b_partner_codes').select('*').eq('code', b.partnerCode).maybeSingle();
    if (!code || !code.active || (code.max_redemptions != null && code.redeemed >= code.max_redemptions)) return json({ error: 'Partnercode ist nicht gültig.' }, 400);
    await db.from('immo_b2b_partner_codes').update({ redeemed: code.redeemed + 1 }).eq('code', code.code).eq('redeemed', code.redeemed);
    referral = `code:${code.code}`.slice(0, 40);
  }

  const now = new Date().toISOString();
  const ins = await db.from('immo_b2b_accounts').insert({
    owner_id: user.id, company_name: b.companyName, legal_form: b.legalForm, institution_type: b.institutionType,
    register_number: reg || null, tax_id: b.taxId || null, advisor_name: b.advisorName, email: user.email, phone: b.phone || null,
    street: b.street, postal_code: b.postalCode, city: b.city, status: 'active', unternehmer_confirmed_at: now,
    avv_accepted_at: now, avv_version: AVV_VERSION, avv_evidence: avvEvidence(req, { userId: user.id, email: user.email, name: b.advisorName }), referral, slug, widget_key: newWidgetKey(),
  }).select('*').single();
  if (ins.error || !ins.data) {
    console.error('b2b_register_error', ins.error?.message);
    return json({ error: 'Registrierung fehlgeschlagen.' }, 500);
  }
  const mem = await db.from('immo_b2b_members').insert({ account_id: ins.data.id, user_id: user.id, role: 'owner' });
  if (mem.error) {
    await db.from('immo_b2b_accounts').delete().eq('id', ins.data.id);
    return json({ error: 'Registrierung fehlgeschlagen.' }, 500);
  }
  // Schriftlicher Nachweis: alle Angaben, Erklärungen im Wortlaut, Zeitpunkte, Prüfsumme.
  let au: { email_confirmed_at?: string | null; created_at?: string | null } | null = null;
  try { au = (await db.auth.admin.getUserById(user.id)).data?.user ?? null; } catch { au = null; }
  const proof: RegistrationProof = {
    proofId: 'REG-' + randomUUID().slice(0, 8).toUpperCase(),
    createdAt: now,
    customerNumber: String(ins.data.customer_number ?? ''),
    company: { name: b.companyName, legalForm: b.legalForm, type: b.institutionType, registerNumber: reg || null, taxId: b.taxId || null, street: b.street, postalCode: b.postalCode, city: b.city, slug },
    person: { name: b.advisorName, email: user.email, phone: b.phone || null },
    account: { userId: user.id, emailConfirmedAt: au?.email_confirmed_at ?? null, signedUpAt: au?.created_at ?? null },
    consents: [
      { key: 'richtig', at: now },
      { key: 'unternehmer', at: now },
      { key: 'avv', at: now, version: AVV_VERSION },
      { key: 'agb', at: now },
    ],
    partnerCode: b.partnerCode || null,
    tech: { ipHash: anonymizedIpHash(req), userAgent: (req.headers.get('user-agent') || '').slice(0, 180) || null },
    sha256: '',
  };
  proof.sha256 = createHash('sha256').update(JSON.stringify({ ...proof, sha256: undefined })).digest('hex');
  await adminAudit(user.email, 'b2b_register', ins.data.id, { avv: AVV_VERSION, unternehmer: true, richtig: true, type: b.institutionType, proofId: proof.proofId, sha256: proof.sha256 });
  if (mailConfigured()) {
    let pdf: Buffer | null = null;
    try { pdf = await renderToBuffer(createElement(RegistrationProofDocument, { p: proof }) as unknown as Parameters<typeof renderToBuffer>[0]); } catch (e) { console.error('b2b_proof_pdf', e instanceof Error ? e.message : e); }
    const att = pdf ? [{ filename: `ImmoAdv_Registrierungsnachweis_${proof.proofId}.pdf`, content: pdf }] : [];
    const text = proofText(proof);
    // Geschäftsadresse für Nachweise (B2B_NOTIFY_EMAIL), sonst alle Administratoren.
    const biz = (process.env.B2B_NOTIFY_EMAIL || '').split(',').map((x) => x.trim()).filter(Boolean);
    for (const to of biz.length ? biz : adminList()) {
      await sendMail(to, `Neue B2B-Registrierung: ${b.companyName} (${typeLabel(b.institutionType)})`, `${text}

Prüfen und freischalten: https://immoadv.de/intern/web-admin#partner`, att);
    }
    await sendMail(user.email, `Ihre Registrierung bei ImmoAdv – Nachweis ${proof.proofId}`,
      `Guten Tag ${b.advisorName},\n\nIhr Unternehmenskonto für ${b.companyName} ist angelegt (Kundennummer ${ins.data.customer_number}). Im Anhang finden Sie den Nachweis über Ihre Angaben und Erklärungen. Bitte prüfen Sie ihn; falsche Angaben teilen Sie uns bitte umgehend an support@immoadv.de mit.\n\nNächster Schritt: Gewerbenachweis im Portal hochladen (https://immoadv.de/b2b-portal#verifizierung). Den Auftragsverarbeitungsvertrag (Version ${AVV_VERSION}) können Sie jederzeit unter https://immoadv.de/b2b-portal#profil herunterladen.\n\n${text}\n\nImmoAdv · Head of Operations: Feray Korkmaz · Georg-August-Zinn-Str. 25 · 64354 Reinheim`, att);
  }
  return json({ ok: true, ...view(ins.data as B2BAccount, 'owner') }, 201);
}

export async function PATCH(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-patch', limit: 30 });
  if (ctx instanceof Response) return ctx;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: `Bitte die Angabe „${String(parsed.error.issues[0]?.path[0] ?? '')}“ prüfen.` }, 400);
  const p = parsed.data;
  const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.advisorName !== undefined) up.advisor_name = p.advisorName;
  if (p.phone !== undefined) up.phone = p.phone || null;
  if (p.street !== undefined) up.street = p.street;
  if (p.postalCode !== undefined) up.postal_code = p.postalCode;
  if (p.city !== undefined) up.city = p.city;
  if (p.bookingUrl !== undefined) up.booking_url = p.bookingUrl || null;
  if (p.brandColor !== undefined) up.brand_color = p.brandColor || null;
  if (p.brandColor2 !== undefined) up.brand_color2 = p.brandColor2 || null;
  if (p.brandFont !== undefined) up.brand_font = p.brandFont;
  if (p.docTitle !== undefined) up.doc_title = p.docTitle || null;
  if (p.docSender !== undefined) up.doc_sender = p.docSender || null;
  if (p.docFooter !== undefined) up.doc_footer = p.docFooter.replace(/[<>]/g, '') || null;
  if (p.allowedDomains !== undefined) up.allowed_domains = [...new Set(p.allowedDomains.map((d) => d.toLowerCase()))];
  if (p.leadGate !== undefined) up.lead_gate = p.leadGate;
  if (p.widgetActive !== undefined) up.widget_active = p.widgetActive;
  if (p.regenerateKey) up.widget_key = newWidgetKey();
  // Support-Zugriff: Betreiber darf das Portal 7 Tage lesend einsehen (Auftragsverarbeitung nur auf Weisung).
  if (p.leadRetentionMonths !== undefined) up.lead_retention_months = p.leadRetentionMonths;
  if (p.webhookUrl !== undefined) {
    if (p.webhookUrl) {
      if (!effectiveTier(ctx.account) || effectiveTier(ctx.account) === 'BASIC') return json({ error: 'Webhooks gibt es ab Tarif Pro.' }, 402);
      const bad = await safeTarget(p.webhookUrl);
      if (bad) return json({ error: bad }, 400);
      up.webhook_url = p.webhookUrl;
      if (!ctx.account.webhook_secret) up.webhook_secret = newWebhookSecret();
    } else up.webhook_url = null;
  }
  if (p.regenerateWebhookSecret) up.webhook_secret = newWebhookSecret();
  if (p.acceptSubmissions !== undefined) {
    if (p.acceptSubmissions && ctx.account.institution_type !== 'BANK') return json({ error: 'Einreichungen empfangen können nur Kreditinstitute.' }, 400);
    up.accept_submissions = p.acceptSubmissions;
  }
  if (p.customDisclaimer !== undefined) {
    if (p.customDisclaimer && effectiveTier(ctx.account) !== 'ENTERPRISE' && !ctx.account.has_whitelabel) return json({ error: 'Eigene Hinweistexte gibt es im Tarif Enterprise.' }, 402);
    up.custom_disclaimer = p.customDisclaimer || null;
  }
  if (p.supportAccessDays !== undefined) up.support_access_until = p.supportAccessDays ? new Date(Date.now() + p.supportAccessDays * 864e5).toISOString() : null;
  const db = supabaseAdmin();
  if (p.slug !== undefined && p.slug !== ctx.account.slug) {
    if (/^(admin|api|intern|b2b|app|auth|verify|p)(-|$)/.test(p.slug)) return json({ error: 'Diese Adresse ist reserviert.' }, 400);
    const { data } = await db.from('immo_b2b_accounts').select('id').eq('slug', p.slug).maybeSingle();
    if (data) return json({ error: 'Diese Adresse ist vergeben.' }, 409);
    up.slug = p.slug;
  }
  const r = await db.from('immo_b2b_accounts').update(up).eq('id', ctx.account.id).select('*').single();
  if (r.error || !r.data) return json({ error: 'Speichern fehlgeschlagen.' }, 500);
  return json({ ok: true, ...view(r.data as B2BAccount, ctx.role) });
}
