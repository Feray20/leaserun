import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { effectiveTier, moduleState, TIER_LIMITS, TRIAL_LIMITS, type B2BAccount } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fall-Analyse und Kunden-Präsentation: Kontingente und Erscheinungsbild.
// Die Dokumente selbst werden im Browser ausgewertet und nie an LeaseRun übertragen – hier wird nur gezählt.
const monthKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);

function limitsFor(a: B2BAccount) {
  const t = effectiveTier(a);
  const l = t ? TIER_LIMITS[t] : null;
  const sr = moduleState(a, 'schnellrechner'), wl = moduleState(a, 'whitelabel');
  return {
    tier: t,
    blocked: sr === 'off',
    fall: sr === 'on' ? null : l ? l.fall : TRIAL_LIMITS.fall,
    praes: sr === 'on' ? null : l ? l.praes : TRIAL_LIMITS.praes,
    // leaserun = LeaseRun-Logo · eigen = eigenes Logo und Farben mit dezentem LeaseRun-Hinweis · whitelabel = komplett eigenes Erscheinungsbild
    // Web-Admin-Freischaltung „White-Label-Export“ geht dem Tarif vor.
    branding: wl === 'on' ? 'whitelabel' : wl === 'off' ? 'leaserun' : a.has_whitelabel || (l && l.whitelabel) ? 'whitelabel' : l && l.cobranding ? 'eigen' : 'leaserun',
  };
}

async function logoData(a: B2BAccount): Promise<string | null> {
  if (!a.logo_path) return null;
  const dl = await supabaseAdmin().storage.from('b2b-logos').download(a.logo_path);
  if (dl.error || !dl.data) return null;
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : null;
  return type ? `data:${type};base64,${buf.toString('base64')}` : null;
}

export async function GET(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-fall' });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account as B2BAccount;
  const L = limitsFor(a);
  const { data } = await supabaseAdmin().from('lr_b2b_usage').select('kind, n').eq('account_id', a.id).eq('month', monthKey());
  const used = Object.fromEntries((data ?? []).map((r) => [r.kind, r.n]));
  const own = L.branding !== 'leaserun';
  return json({
    verified: Boolean(a.verified_at),
    usage: { fall: used.fall ?? 0, praes: used.praesentation ?? 0 },
    limits: { fall: L.fall, praes: L.praes }, tier: L.tier, blocked: L.blocked,
    branding: {
      mode: L.branding,
      company: a.company_name, advisor: a.advisor_name, city: a.city,
      color: (own && a.brand_color) || '#0F2C59', color2: (own && a.brand_color2) || '#0284C7', font: (own && a.brand_font) || 'sans',
      title: (own && a.doc_title) || 'Finanzierungsübersicht', sender: (own && a.doc_sender) || null, footer: (own && a.doc_footer) || null,
      logo: own ? await logoData(a) : null,
    },
  });
}

// Kontingent verbrauchen (eine Fall-Analyse bzw. eine Präsentation).
export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-fall-take', limit: 30 });
  if (ctx instanceof Response) return ctx;
  const p = z.object({ kind: z.enum(['fall', 'praesentation']) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Ungültig.' }, 400);
  const a = ctx.account as B2BAccount;
  if (!a.verified_at) return json({ error: 'Ihr Unternehmenskonto ist noch nicht freigeschaltet.' }, 403);
  const L = limitsFor(a);
  if (L.blocked) return json({ error: 'Schnellrechner und Fall-Analysen sind für Ihr Unternehmenskonto nicht freigeschaltet. Bitte wenden Sie sich an support@leaserun.com.' }, 403);
  const lim = p.data.kind === 'fall' ? L.fall : L.praes;
  const { data, error } = await supabaseAdmin().rpc('b2b_usage_take', { acc: a.id, mon: monthKey(), k: p.data.kind, lim });
  if (error) return json({ error: 'Kontingent konnte nicht geprüft werden.' }, 502);
  if (data === -1) return json({ error: p.data.kind === 'fall' ? `Ihr Testkontingent von ${lim} Fall-Analysen in diesem Monat ist aufgebraucht. Mit jedem gebuchten Tarif sind Fall-Analysen unbegrenzt.` : `Ihr Kontingent von ${lim} Präsentationen in diesem Monat ist aufgebraucht. Ab „Kanzlei & Baufi Pro“ unbegrenzt.`, code: 'quota' }, 402);
  return json({ ok: true, used: data, limit: lim });
}
