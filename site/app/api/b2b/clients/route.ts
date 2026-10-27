import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canCobrand, effectiveTier, hashToken, moduleState, newToken, TIER_LIMITS, type B2BAccount } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Unternehmensportal → Kunden: Kunden einladen und – nach ausdrücklicher Einwilligung des Kunden – ihren Fortschritt sehen.
// Sichtbar sind nur Zahlen (Stufe, Bankreife, Anzahl Objekte und Unterlagen) und die Arten fehlender Unterlagen – nie Dokumente oder Inhalte.
const INVITE_DAYS = 14;

type Summary = { stage?: number; level?: number; best?: number; objects?: number; docs?: number; profile?: boolean; missing?: string[]; fixEnds?: string[]; at?: string };

export async function GET(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-clients' });
  if (ctx instanceof Response) return ctx;
  if (moduleState(ctx.account, 'crm') === 'off') return json({ error: 'Die Mandantenverwaltung ist für Ihr Unternehmenskonto nicht freigeschaltet. Bitte wenden Sie sich an support@leaserun.com.' }, 403);
  const db = supabaseAdmin();
  const { data: rows } = await db.from('lr_b2b_clients').select('id, client_name, client_email, status, client_user_id, consent_at, expires_at, created_at, ended_at, last_request_at, radar_consent_at')
    .eq('account_id', ctx.account.id).neq('status', 'getrennt').order('created_at', { ascending: false }).limit(500);
  const now = Date.now();
  const list = (rows ?? []).filter((r) => r.status === 'verbunden' || (r.expires_at && new Date(r.expires_at).getTime() > now));
  const ids = list.filter((r) => r.status === 'verbunden' && r.client_user_id).map((r) => r.client_user_id as string);
  const { data: ud } = ids.length ? await db.from('lr_user_data').select('user_id, progress, updated_at').in('user_id', ids) : { data: [] };
  const byUser = new Map((ud ?? []).map((u) => [u.user_id, u]));
  const t = effectiveTier(ctx.account), radarOn = Boolean(t && TIER_LIMITS[t].radar);
  const clients = list.map((r) => {
    const u = r.client_user_id ? byUser.get(r.client_user_id) : null;
    const s = ((u?.progress as { summary?: Summary } | null)?.summary) || {};
    return {
      id: r.id, name: r.client_name, email: r.client_email, status: r.status, since: r.consent_at, invitedAt: r.created_at, expiresAt: r.expires_at,
      progress: r.status === 'verbunden' ? { stage: s.stage ?? null, level: s.level ?? null, best: s.best ?? null, objects: s.objects ?? null, docs: s.docs ?? null, profile: s.profile ?? null, missing: Array.isArray(s.missing) ? s.missing.slice(0, 8).map(String) : null, lastActive: u?.updated_at ?? null } : null,
      lastRequestAt: r.last_request_at,
      radar: r.radar_consent_at ? (radarOn ? (Array.isArray(s.fixEnds) ? s.fixEnds.filter((x) => /^\d{4}-\d{2}$/.test(String(x))).slice(0, 10) : []) : 'tarif') : null,
    };
  });
  return json({ clients, radarOn });
}

const Invite = z.object({ email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().max(120).optional(), consent: z.literal(true) });

export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-client-invite', limit: 20 });
  if (ctx instanceof Response) return ctx;
  if (moduleState(ctx.account, 'crm') === 'off') return json({ error: 'Die Mandantenverwaltung ist für Ihr Unternehmenskonto nicht freigeschaltet. Bitte wenden Sie sich an support@leaserun.com.' }, 403);
  if (!ctx.account.verified_at) return json({ error: 'Kunden einladen ist nach der Verifizierung Ihres Unternehmenskontos möglich.' }, 403);
  const p = Invite.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues.some((i) => i.path[0] === 'consent') ? 'Bitte bestätigen Sie, dass die Einwilligung des Kunden für die Einladung vorliegt.' : 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  const db = supabaseAdmin();
  const token = newToken();
  const ins = await db.from('lr_b2b_clients').insert({
    account_id: ctx.account.id, invited_by: ctx.user.id, client_email: p.data.email, client_name: p.data.name || null, inviter_consent_at: new Date().toISOString(),
    token_hash: hashToken(token), expires_at: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(),
  });
  if (ins.error) return json({ error: 'Einladung fehlgeschlagen.' }, 500);
  const link = `${new URL(req.url).origin}/app/dashboard#berater=${token}`;
  let mailed = false;
  if (mailConfigured()) {
    mailed = await sendMail(p.data.email, `${ctx.account.company_name} lädt Sie zu LeaseRun ein`,
      `Guten Tag${p.data.name ? ' ' + p.data.name : ''},\n\n${ctx.account.company_name} begleitet Sie bei Ihrer Immobilienfinanzierung und lädt Sie zu LeaseRun ein. Dort bereiten Sie Finanzprofil, Objekt und Unterlagen vor – Schritt für Schritt bis zur bankfertigen Kreditmappe.\n\nWenn Sie zustimmen, sieht Ihr Berater nur Ihren Fortschritt (Stufe, Bankreife in Prozent, Anzahl der Unterlagen) – keine Dokumente und keine Inhalte. Sie können die Verbindung jederzeit trennen.\n\nDer Link ist ${INVITE_DAYS} Tage gültig.`,
      [], { title: `Einladung von ${ctx.account.company_name}`, button: { label: 'Einladung ansehen', url: link }, note: 'Kostenlos für Sie. Ohne Ihre Zustimmung wird nichts geteilt.',
        // Kanzlei als Absendername und Antwortadresse; Hausfarbe ab Co-Branding-Tarif.
        sender: ctx.account.company_name, replyTo: ctx.account.email, accent: canCobrand(ctx.account as B2BAccount) ? ctx.account.brand_color || undefined : undefined });
  }
  return json({ ok: true, link, mailed }, 201);
}

const End = z.object({ id: z.string().uuid() });

export async function DELETE(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-clients' });
  if (ctx instanceof Response) return ctx;
  if (moduleState(ctx.account, 'crm') === 'off') return json({ error: 'Die Mandantenverwaltung ist für Ihr Unternehmenskonto nicht freigeschaltet. Bitte wenden Sie sich an support@leaserun.com.' }, 403);
  const p = End.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Ungültig.' }, 400);
  const { error } = await supabaseAdmin().from('lr_b2b_clients').update({ status: 'getrennt', ended_at: new Date().toISOString(), ended_by: 'berater', token_hash: null })
    .eq('id', p.data.id).eq('account_id', ctx.account.id);
  return error ? json({ error: 'Trennen fehlgeschlagen.' }, 500) : json({ ok: true });
}
