import { z } from 'zod';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { panicState } from '@/lib/security/panic';
import { effectiveTier, type B2BAccount } from '@/lib/b2b/core';
import { json } from '@/lib/b2b/http';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { leadToken } from '@/lib/b2b/leadtoken';
import { sendWebhook } from '@/lib/b2b/webhook';
import { guardSubmission } from '@/lib/security/antispam';
// Gleicher Rechenkern wie im Browser.
import { analyse } from '@/public/src/calc.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const num = (max: number) => z.coerce.number().min(0).max(max).optional();
const Schema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  source: z.enum(['widget', 'landing', 'qr']).default('landing'),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).optional().default(''),
  message: z.string().trim().max(2000).optional().default(''),
  consent: z.literal(true),
  website: z.string().optional().default(''), // honeypot field, stays empty for humans
  ts: z.coerce.number().optional(), // time the form was rendered (timing trap against bots)
  property: z.object({
    ref: z.string().trim().max(80).optional(),
    address: z.string().trim().max(160).optional(),
    land: z.string().max(40).optional(),
    price: num(50_000_000), rent: num(1_000_000), area: num(100_000), equity: num(50_000_000),
    ratePct: num(20), repaymentPct: num(20), brokerPct: num(10), income: num(1_000_000),
  }).default({}),
});

const consentText = (company: string) =>
  `I agree that my details (name, contact information, property and financing details) are sent to ${company} ` +
  `so that ${company} can contact me by email or phone about my inquiry. Consent is not a condition of any purchase. ` +
  `LeaseRun processes the data on behalf of ${company} and does not sell it. I can withdraw my consent at any time by contacting ${company}.`;

// Public inquiry via partner page, widget or listing QR. Goes only to that business.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Not available.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`lead:${ip}`, 5, 10 * 60_000)) return json({ error: 'Too many requests. Please try again later.' }, 429);
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const f = String(parsed.error.issues[0]?.path[0] ?? '');
    const msg: Record<string, string> = { consent: 'Please agree to share your details with this partner.', email: 'Please enter a valid email address.', name: 'Please enter your name.' };
    return json({ error: msg[f] ?? 'Please check your entries.' }, 400);
  }
  const b = parsed.data;
  // Bot and fake protection: honeypot, timing trap, disposable address, undeliverable domain, spam content.
  const guard = await guardSubmission({ email: b.email, name: b.name, message: b.message, website: b.website, ts: b.ts, bucket: 'lead' });
  if (guard.action === 'drop') return json({ ok: true }, 201); // bot: silently discard
  if (guard.action === 'reject') return json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, 400);
  if ((await panicState()).active) return json({ error: 'Inquiries are temporarily unavailable (maintenance).' }, 503);
  const db = supabaseAdmin();
  const { data } = await db.from('lr_b2b_accounts').select('*').eq('slug', b.slug).maybeSingle();
  const a = data as B2BAccount | null;
  if (!a || a.status !== 'active' || !a.verified_at || !a.widget_active || !effectiveTier(a)) return json({ error: 'This partner is not accepting inquiries right now.' }, 404);

  const p = b.property;
  let metrics: Record<string, unknown> | null = null;
  if (p.price && p.land) {
    const r = analyse({ price: p.price, rent: p.rent ?? 0, area: p.area ?? 0, land: p.land, equity: p.equity ?? 0, ratePct: p.ratePct ?? 6.5, repaymentPct: p.repaymentPct ?? 2, brokerPct: p.brokerPct ?? 0, maintenanceQm: 1, vacancyPct: 2 });
    if (r) metrics = { allIn: r.allIn, nebenkosten: r.nebenkosten, loan: r.loan, ltv: r.ltv, rate: r.rate, noi: r.noi, cashflow: r.cashflow, dscr: r.dscr, grossYield: r.grossYield, netYield: r.netYield };
  }
  // Still deliver a suspicious inquiry, but flag it visibly for the partner.
  if (guard.action === 'allow' && guard.flagged) metrics = { ...(metrics ?? {}), spamVerdacht: true };
  const ct = consentText(a.company_name);
  const ins = await db.from('lr_b2b_leads').insert({
    account_id: a.id, source: b.source, client_name: b.name, client_email: b.email, client_phone: b.phone || null, message: b.message || null,
    property_data: p, metrics, consent_at: new Date().toISOString(), consent_text: ct, ip_hash: ip,
  }).select('id').single();
  if (ins.error) return json({ error: 'Your inquiry could not be saved.' }, 500);

  if (a.webhook_url) await sendWebhook(a, 'lead.created', { id: ins.data.id, source: b.source, name: b.name, email: b.email, phone: b.phone || null, message: b.message || null, property: p, metrics, consentAt: new Date().toISOString() });
  if (mailConfigured()) {
    const eur = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '–');
    await sendMail(a.email, `New financing inquiry via LeaseRun (${b.source})`,
      `New inquiry for ${a.company_name}\n\nName: ${b.name}\nEmail: ${b.email}\nPhone: ${b.phone || '–'}\n` +
      `Property: ${p.address || p.ref || '–'}\nPurchase price: ${eur(p.price)} · Rent: ${eur(p.rent)} · Down payment: ${eur(p.equity)}\n` +
      (metrics ? `Total cost: ${eur(metrics.allIn)} · Loan: ${eur(metrics.loan)} · DSCR: ${metrics.dscr ?? '–'}\n` : '') +
      `\nMessage: ${b.message || '–'}\n\nAll details in the portal: https://leaserun.com/business-portal#anfragen\n\nEstimates only, not a credit decision. Please follow TCPA and CAN-SPAM rules when you follow up.`, [], { area: 'b2b' });
    // Confirmation to the prospect (not if the name contains links, against abuse as spam relay).
    if (!/https?:|www\.|:\/\/|\.[a-z]{2,}\//i.test(b.name)) await sendMail(b.email, `Your inquiry to ${a.company_name}`,
      `Hi ${b.name},\n\nYour financing inquiry has reached ${a.company_name} (${a.city}). ${a.company_name} will contact you directly.\n\n` +
      `${a.company_name} is responsible for your data; LeaseRun processes it only on their behalf and does not sell it. You can withdraw your consent at any time by contacting ${a.company_name} (${a.email}).\n\n` +
      'The figures shown are estimates for planning only, not a loan offer or commitment to lend.');
  }
  return json({ ok: true, id: ins.data.id, pdf: p.price ? `/api/b2b/lead/pdf?id=${ins.data.id}&t=${leadToken(ins.data.id)}` : null }, 201);
}
