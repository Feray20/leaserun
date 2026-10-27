import { createHash, randomUUID } from 'node:crypto';
import { supportInbox } from '@/lib/notify/inbox';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { z } from 'zod';
import { brancheFromType } from '@/lib/b2b/catalog';
import { addressError, confirmedFlag } from '@/lib/address';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { RegistrationProofDocument, proofText, typeLabel, type RegistrationProof } from '@/lib/b2b/registration-proof';
import { avvEvidence } from '@/lib/b2b/avv-evidence';
import { AVV_VERSION, MODULE_KEYS, TIER_LIMITS, adminAudit, moduleOverrides, type ModuleKey, dossiersThisMonth, effectiveTier, membershipFor, newWidgetKey, slugify, type B2BAccount } from '@/lib/b2b/core';
import { accountBranches, BRANCHEN as BRANCHEN_ALL, getCatalog, toolsFor } from '@/lib/b2b/catalog';
import { json, requireMember } from '@/lib/b2b/http';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { newWebhookSecret, safeTarget } from '@/lib/b2b/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// NMLS ID (1–10 digits) or a state license number (letters, digits, dashes); EIN optional (12-3456789).
const NMLS_RE = /^[0-9]{1,10}$/;
const LICENSE_RE = /^[A-Z0-9][A-Z0-9 .\-/]{2,30}$/i;
const EIN_RE = /^[0-9]{2}-?[0-9]{7}$/;
const STATE_RE = /^[A-Z]{2}$/;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const RegisterSchema = z.object({
  companyName: z.string().transform(clean).pipe(z.string().min(2).max(160)),
  legalForm: z.string().transform(clean).pipe(z.string().min(1).max(60)),
  incorporationState: z.string().transform((s) => s.trim().toUpperCase()).optional().default(''),
  state: z.string().transform((s) => s.trim().toUpperCase()).optional().default(''),
  institutionType: z.enum(['BANK', 'BROKER', 'REALTOR', 'ADVISOR', 'OTHER']),
  registerNumber: z.string().transform(clean).optional().default(''),
  taxId: z.string().transform((s) => s.replace(/\s+/g, '')).optional().default(''),
  advisorName: z.string().transform(clean).pipe(z.string().min(2).max(120)),
  phone: z.string().transform(clean).pipe(z.string().max(40)).optional().default(''),
  street: z.string().transform(clean).pipe(z.string().min(3).max(160)),
  postalCode: z.string().regex(/^[0-9]{5}(-[0-9]{4})?$/),
  city: z.string().transform(clean).pipe(z.string().min(2).max(80)),
  unternehmer: z.literal(true),
  avv: z.literal(true),
  richtig: z.literal(true),
  agb: z.literal(true),
  partnerCode: z.string().transform((s) => s.trim().toUpperCase()).optional().default(''),
  referral: z.string().max(40).optional().default(''),
  addressConfirmed: z.unknown().optional(),
});

const PatchSchema = z.object({
  advisorName: z.string().transform(clean).pipe(z.string().min(2).max(120)).optional(),
  phone: z.string().transform(clean).pipe(z.string().max(40)).optional(),
  street: z.string().transform(clean).pipe(z.string().min(3).max(160)).optional(),
  postalCode: z.string().regex(/^[0-9]{5}(-[0-9]{4})?$/).optional(),
  city: z.string().transform(clean).pipe(z.string().min(2).max(80)).optional(),
  state: z.string().transform((s) => s.trim().toUpperCase()).optional(),
  addressConfirmed: z.unknown().optional(),
  bookingUrl: z.union([z.literal(''), z.string().url().max(300).refine((u) => u.startsWith('https://'), 'https required')]).optional(),
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
  const ov = moduleOverrides(a);
  const base = tier ? { ...TIER_LIMITS[tier] } : null;
  // A Web-Admin override for "White-label export" takes precedence over the plan.
  if (base && ov.whitelabel) { base.cobranding = ov.whitelabel === 'on'; base.whitelabel = ov.whitelabel === 'on'; }
  const def: Record<ModuleKey, boolean> = { schnellrechner: true, kreditmappe: true, stresstest: true, crm: true, whitelabel: Boolean(a.has_whitelabel || (tier && TIER_LIMITS[tier].cobranding)) };
  const modules = Object.fromEntries(MODULE_KEYS.map((k) => [k, ov[k] ? ov[k] === 'on' : def[k]])) as Record<ModuleKey, boolean>;
  return {
    role,
    tier,
    modules,
    moduleOverrides: ov,
    limits: base,
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

// The industry belongs to the business account (set with the request, changed only via support);
// add-on industries can be purchased. Plans and unlocked software tools follow from them.

export async function GET(req: Request) {
  if (!adminConfigured()) return json({ error: 'Not configured.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  if (!allowRequest(`b2b-get:${user.id}`, 60, 60_000)) return json({ error: 'Too many requests.' }, 429);
  const m = await membershipFor(user.id);
  if (!m) return json({ account: null, avvVersion: AVV_VERSION });
  const db = supabaseAdmin();
  const [{ count: seats }, used, { count: leadsNew }] = await Promise.all([
    db.from('lr_b2b_members').select('user_id', { count: 'exact', head: true }).eq('account_id', m.account.id),
    dossiersThisMonth(m.account.id),
    db.from('lr_b2b_leads').select('id', { count: 'exact', head: true }).eq('account_id', m.account.id).eq('status', 'neu'),
  ]);
  // First sign-in: change the initial password; the owner confirms business use and accepts the DPA.
  let mustChange = false;
  try {
    const meta = (await db.auth.admin.getUserById(user.id)).data?.user?.user_metadata || {};
    mustChange = Boolean(meta.must_change_password);
  } catch { mustChange = false; }
  const cat = await getCatalog();
  const branches = accountBranches(m.account);
  const branche = branches[0];
  const tools = toolsFor(cat, branches, effectiveTier(m.account));
  const offer = { branche, label: cat.branchen[branche].label, selfService: cat.branchen[branche].selfService, plans: cat.branchen[branche].plans.filter((p) => p.active), enterprise: cat.branchen[branche].enterprise, addon: cat.addon,
    others: BRANCHEN_ALL.filter((b) => !branches.includes(b) && b !== 'bank').map((b) => ({ key: b, label: cat.branchen[b].label })) };
  const consentsMissing = m.role === 'owner' && (!m.account.unternehmer_confirmed_at || !m.account.avv_accepted_at);
  return json({ ...view(m.account, m.role), usage: { seats: seats ?? 1, dossiersThisMonth: used, leadsNew: leadsNew ?? 0 }, avvVersion: AVV_VERSION, branche, branches, tools, offer, onboarding: { mustChange, consentsMissing } });
}

// Registration of a business account (businesses only, with the Data Processing Addendum).
export async function POST(req: Request) {
  // LeaseRun issues logins in the Web-Admin after a request – no self-registration.
  if (process.env.B2B_SELF_SIGNUP !== 'true') return json({ error: 'LeaseRun sets up business accounts on request: https://leaserun.com/business#anfrage' }, 403);
  if (!adminConfigured()) return json({ error: 'Not configured.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  if (!allowRequest(`b2b-register:${user.id}`, 5, 60_000)) return json({ error: 'Too many requests.' }, 429);
  const parsed = RegisterSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const f = parsed.error.issues[0]?.path[0];
    const msg: Record<string, string> = {
      unternehmer: 'Please confirm that you are acting on behalf of a business.',
      avv: 'Please accept the Data Processing Addendum.',
      richtig: 'Please confirm that the information is complete and accurate.',
      agb: 'Please confirm the Business Terms of Service and the Privacy Policy.',
      postalCode: 'Please enter a 5-digit ZIP code.',
      street: 'Please enter the street address with number.',
    };
    return json({ error: msg[String(f)] ?? `Please check the field "${String(f ?? 'form')}".` }, 400);
  }
  const b = parsed.data;
  if (b.state && !STATE_RE.test(b.state)) return json({ error: 'Please choose a US state.' }, 400);
  if (b.incorporationState && !STATE_RE.test(b.incorporationState)) return json({ error: 'Please choose the state of incorporation.' }, 400);
  { const err = await addressError({ postalCode: b.postalCode, city: b.city, street: b.street, state: b.state || undefined }, confirmedFlag(b.addressConfirmed)); if (err) return json({ error: err }, 400); }
  const reg = b.registerNumber.toUpperCase().replace(/^NMLS\s*#?\s*/, '');
  if (reg && !(NMLS_RE.test(reg) || LICENSE_RE.test(reg))) return json({ error: 'Please enter your NMLS ID (digits only) or your state license number.' }, 400);
  if (b.taxId && !EIN_RE.test(b.taxId)) return json({ error: 'Please check the EIN (format 12-3456789) or leave it empty.' }, 400);
  if ((b.institutionType === 'BROKER' || b.institutionType === 'REALTOR') && !reg) return json({ error: b.institutionType === 'BROKER' ? 'Please enter your NMLS ID.' : 'Please enter your real estate license number.' }, 400);
  const legalForm = b.incorporationState ? `${b.legalForm} (${b.incorporationState})` : b.legalForm;

  if (await membershipFor(user.id)) return json({ error: 'This login already belongs to a business account.' }, 409);
  const db = supabaseAdmin();

  // Derive a free partner URL from the company name.
  const base = slugify(b.companyName).replace(/-(llc|inc|corp|co|ltd|lp|llp|pllc|pc|pa)$/g, '').slice(0, 34) || 'partner';
  let slug = base.length >= 3 ? base : `${base}-partner`;
  for (let i = 2; i < 50; i++) {
    const { data } = await db.from('lr_b2b_accounts').select('id').eq('slug', slug).maybeSingle();
    if (!data) break;
    slug = `${base}-${i}`;
  }

  let referral = b.referral.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || null;
  if (b.partnerCode) {
    const { data: code } = await db.from('lr_b2b_partner_codes').select('*').eq('code', b.partnerCode).maybeSingle();
    if (!code || !code.active || (code.max_redemptions != null && code.redeemed >= code.max_redemptions)) return json({ error: 'This partner code is not valid.' }, 400);
    await db.from('lr_b2b_partner_codes').update({ redeemed: code.redeemed + 1 }).eq('code', code.code).eq('redeemed', code.redeemed);
    referral = `code:${code.code}`.slice(0, 40);
  }

  const now = new Date().toISOString();
  const ins = await db.from('lr_b2b_accounts').insert({
    owner_id: user.id, company_name: b.companyName, legal_form: legalForm, institution_type: b.institutionType, branche: brancheFromType(b.institutionType),
    register_number: reg || null, tax_id: b.taxId || null, advisor_name: b.advisorName, email: user.email, phone: b.phone || null,
    street: b.street, postal_code: b.postalCode, city: b.city, status: 'active', unternehmer_confirmed_at: now,
    avv_accepted_at: now, avv_version: AVV_VERSION, avv_evidence: avvEvidence(req, { userId: user.id, email: user.email, name: b.advisorName }), referral, slug, widget_key: newWidgetKey(),
  }).select('*').single();
  if (ins.error || !ins.data) {
    console.error('b2b_register_error', ins.error?.message);
    return json({ error: 'Registration failed.' }, 500);
  }
  const mem = await db.from('lr_b2b_members').insert({ account_id: ins.data.id, user_id: user.id, role: 'owner' });
  if (mem.error) {
    await db.from('lr_b2b_accounts').delete().eq('id', ins.data.id);
    return json({ error: 'Registration failed.' }, 500);
  }
  // Written record: all details, statements word for word, timestamps, checksum.
  let au: { email_confirmed_at?: string | null; created_at?: string | null } | null = null;
  try { au = (await db.auth.admin.getUserById(user.id)).data?.user ?? null; } catch { au = null; }
  const proof: RegistrationProof = {
    proofId: 'REG-' + randomUUID().slice(0, 8).toUpperCase(),
    createdAt: now,
    customerNumber: String(ins.data.customer_number ?? ''),
    company: { name: b.companyName, legalForm, type: b.institutionType, registerNumber: reg || null, taxId: b.taxId || null, street: b.street, postalCode: b.postalCode, city: b.city, slug },
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
    const att = pdf ? [{ filename: `LeaseRun_Registration_Record_${proof.proofId}.pdf`, content: pdf }] : [];
    const text = proofText(proof);
    // All business notifications go to the support inbox (support@leaserun.com).
    for (const to of [supportInbox()]) {
      await sendMail(to, `New business registration: ${b.companyName} (${typeLabel(b.institutionType)})`, `${text}

Review and verify: https://leaserun.com/internal/web-admin#partner`, att);
    }
    await sendMail(user.email, `Your LeaseRun registration – record ${proof.proofId}`,
      `Hi ${b.advisorName},\n\nYour business account for ${b.companyName} has been created (customer number ${ins.data.customer_number}). Attached is the record of the details and statements you provided. Please review it and let us know right away at support@leaserun.com if anything is incorrect.\n\nNext step: upload your business verification in the portal (https://leaserun.com/business-portal#verifizierung). You can download the Data Processing Addendum (version ${AVV_VERSION}) at any time at https://leaserun.com/business-portal#profil.\n\n${text}\n\nThe LeaseRun team`, att, { area: 'b2b' });
  }
  return json({ ok: true, ...view(ins.data as B2BAccount, 'owner') }, 201);
}

export async function PATCH(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-patch', limit: 30 });
  if (ctx instanceof Response) return ctx;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: `Please check the field "${String(parsed.error.issues[0]?.path[0] ?? '')}".` }, 400);
  const p = parsed.data;
  if (p.street !== undefined && p.postalCode !== undefined && p.city !== undefined) {
    const err = await addressError({ postalCode: p.postalCode, city: p.city, street: p.street, state: p.state && /^[A-Z]{2}$/.test(p.state) ? p.state : undefined }, confirmedFlag(p.addressConfirmed));
    if (err) return json({ error: err }, 400);
  }
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
  // Support access: the operator may view the portal read-only for 7 days (processing only on instruction).
  if (p.leadRetentionMonths !== undefined) up.lead_retention_months = p.leadRetentionMonths;
  if (p.webhookUrl !== undefined) {
    if (p.webhookUrl) {
      if (!effectiveTier(ctx.account) || effectiveTier(ctx.account) === 'BASIC') return json({ error: 'Webhooks are available on the Pro plan and above.' }, 402);
      const bad = await safeTarget(p.webhookUrl);
      if (bad) return json({ error: bad }, 400);
      up.webhook_url = p.webhookUrl;
      if (!ctx.account.webhook_secret) up.webhook_secret = newWebhookSecret();
    } else up.webhook_url = null;
  }
  if (p.regenerateWebhookSecret) up.webhook_secret = newWebhookSecret();
  if (p.acceptSubmissions !== undefined) {
    if (p.acceptSubmissions && ctx.account.institution_type !== 'BANK') return json({ error: 'Only lenders can receive submissions.' }, 400);
    up.accept_submissions = p.acceptSubmissions;
  }
  if (p.customDisclaimer !== undefined) {
    if (p.customDisclaimer && effectiveTier(ctx.account) !== 'ENTERPRISE' && !ctx.account.has_whitelabel) return json({ error: 'Custom disclaimers are available on the Enterprise plan.' }, 402);
    up.custom_disclaimer = p.customDisclaimer || null;
  }
  if (p.supportAccessDays !== undefined) up.support_access_until = p.supportAccessDays ? new Date(Date.now() + p.supportAccessDays * 864e5).toISOString() : null;
  const db = supabaseAdmin();
  if (p.slug !== undefined && p.slug !== ctx.account.slug) {
    if (/^(admin|api|intern|b2b|app|auth|verify|p)(-|$)/.test(p.slug)) return json({ error: 'This URL is reserved.' }, 400);
    const { data } = await db.from('lr_b2b_accounts').select('id').eq('slug', p.slug).maybeSingle();
    if (data) return json({ error: 'This URL is already taken.' }, 409);
    up.slug = p.slug;
  }
  const r = await db.from('lr_b2b_accounts').update(up).eq('id', ctx.account.id).select('*').single();
  if (r.error || !r.data) return json({ error: 'Saving failed.' }, 500);
  return json({ ok: true, ...view(r.data as B2BAccount, ctx.role) });
}
