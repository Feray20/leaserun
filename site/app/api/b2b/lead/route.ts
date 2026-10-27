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
  website: z.string().optional().default(''), // Honigtopf-Feld, bleibt bei Menschen leer
  ts: z.coerce.number().optional(), // Zeitpunkt des Formularaufbaus (Zeitfalle gegen Bots)
  property: z.object({
    ref: z.string().trim().max(80).optional(),
    address: z.string().trim().max(160).optional(),
    land: z.string().max(40).optional(),
    price: num(50_000_000), rent: num(1_000_000), area: num(100_000), equity: num(50_000_000),
    ratePct: num(20), repaymentPct: num(20), brokerPct: num(10), income: num(1_000_000),
  }).default({}),
});

const consentText = (company: string) =>
  `Ich willige ein, dass meine Angaben (Name, Kontaktdaten, Objekt- und Finanzierungsdaten) an ${company} übermittelt werden, ` +
  `damit ${company} mich zu meiner Anfrage kontaktiert. LeaseRun verarbeitet die Daten im Auftrag von ${company}. ` +
  `Ich kann die Einwilligung jederzeit gegenüber ${company} widerrufen.`;

// Öffentliche Anfrage über Partnerseite, Widget oder Exposé-QR. Geht ausschließlich an das jeweilige Unternehmen.
export async function POST(req: Request) {
  if (!adminConfigured()) return json({ error: 'Nicht verfügbar.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`lead:${ip}`, 5, 10 * 60_000)) return json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429);
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const f = String(parsed.error.issues[0]?.path[0] ?? '');
    const msg: Record<string, string> = { consent: 'Bitte der Weitergabe an den Partner zustimmen.', email: 'Bitte eine gültige E-Mail-Adresse angeben.', name: 'Bitte Ihren Namen angeben.' };
    return json({ error: msg[f] ?? 'Bitte die Angaben prüfen.' }, 400);
  }
  const b = parsed.data;
  // Bot- und Fake-Abwehr: Honigtopf, Zeitfalle, Wegwerf-Adresse, nicht empfangsfähige Domain, Spam-Inhalt.
  const guard = await guardSubmission({ email: b.email, name: b.name, message: b.message, website: b.website, ts: b.ts, bucket: 'lead' });
  if (guard.action === 'drop') return json({ ok: true }, 201); // Bot: stillschweigend verwerfen
  if (guard.action === 'reject') return json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, 400);
  if ((await panicState()).active) return json({ error: 'Anfragen sind vorübergehend nicht möglich (Wartung).' }, 503);
  const db = supabaseAdmin();
  const { data } = await db.from('lr_b2b_accounts').select('*').eq('slug', b.slug).maybeSingle();
  const a = data as B2BAccount | null;
  if (!a || a.status !== 'active' || !a.verified_at || !a.widget_active || !effectiveTier(a)) return json({ error: 'Dieser Partner nimmt derzeit keine Anfragen an.' }, 404);

  const p = b.property;
  let metrics: Record<string, unknown> | null = null;
  if (p.price && p.land) {
    const r = analyse({ price: p.price, rent: p.rent ?? 0, area: p.area ?? 0, land: p.land, equity: p.equity ?? 0, ratePct: p.ratePct ?? 3.8, repaymentPct: p.repaymentPct ?? 2, brokerPct: p.brokerPct ?? 0, maintenanceQm: 1, vacancyPct: 2 });
    if (r) metrics = { allIn: r.allIn, nebenkosten: r.nebenkosten, loan: r.loan, ltv: r.ltv, rate: r.rate, noi: r.noi, cashflow: r.cashflow, dscr: r.dscr, grossYield: r.grossYield, netYield: r.netYield };
  }
  // Auffällige Anfrage trotzdem zustellen, aber für den Partner sichtbar markieren.
  if (guard.action === 'allow' && guard.flagged) metrics = { ...(metrics ?? {}), spamVerdacht: true };
  const ct = consentText(a.company_name);
  const ins = await db.from('lr_b2b_leads').insert({
    account_id: a.id, source: b.source, client_name: b.name, client_email: b.email, client_phone: b.phone || null, message: b.message || null,
    property_data: p, metrics, consent_at: new Date().toISOString(), consent_text: ct, ip_hash: ip,
  }).select('id').single();
  if (ins.error) return json({ error: 'Anfrage konnte nicht gespeichert werden.' }, 500);

  if (a.webhook_url) await sendWebhook(a, 'lead.created', { id: ins.data.id, source: b.source, name: b.name, email: b.email, phone: b.phone || null, message: b.message || null, property: p, metrics, consentAt: new Date().toISOString() });
  if (mailConfigured()) {
    const eur = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €' : '–');
    await sendMail(a.email, `Neue Finanzierungsanfrage über LeaseRun (${b.source})`,
      `Neue Anfrage für ${a.company_name}\n\nName: ${b.name}\nE-Mail: ${b.email}\nTelefon: ${b.phone || '–'}\n` +
      `Objekt: ${p.address || p.ref || '–'}\nKaufpreis: ${eur(p.price)} · Kaltmiete: ${eur(p.rent)} · Eigenkapital: ${eur(p.equity)}\n` +
      (metrics ? `Gesamtkosten: ${eur(metrics.allIn)} · Darlehen: ${eur(metrics.loan)} · DSCR: ${metrics.dscr ?? '–'}\n` : '') +
      `\nNachricht: ${b.message || '–'}\n\nAlle Angaben im Portal: https://leaserun.com/business-portal#anfragen\n\nRechnerische Orientierungswerte, keine Kreditentscheidung.`, [], { area: 'b2b' });
    // Eingangsbestätigung an den Interessenten (nicht bei Links im Namen, gegen Missbrauch als Spam-Versand).
    if (!/https?:|www\.|:\/\/|\.[a-z]{2,}\//i.test(b.name)) await sendMail(b.email, `Ihre Anfrage an ${a.company_name}`,
      `Guten Tag ${b.name},\n\nIhre Finanzierungsanfrage ist bei ${a.company_name} (${a.postal_code} ${a.city}) eingegangen. ${a.company_name} meldet sich direkt bei Ihnen.\n\n` +
      `Verantwortlich für Ihre Daten ist ${a.company_name}; LeaseRun verarbeitet sie nur im Auftrag. Ihre Einwilligung können Sie jederzeit gegenüber ${a.company_name} widerrufen (Kontakt: ${a.email}).\n\n` +
      'Die angezeigten Werte sind rechnerische Orientierungswerte, keine Kreditzusage.');
  }
  return json({ ok: true, id: ins.data.id, pdf: p.price ? `/api/b2b/lead/pdf?id=${ins.data.id}&t=${leadToken(ins.data.id)}` : null }, 201);
}
