import { NextResponse } from 'next/server';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { hashToken } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kunde (Website-Konto): Einladung eines Beraters ansehen, zustimmen, Verbindungen anzeigen und trennen.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const CONSENT = 'Ich willige ein, dass das genannte Unternehmen meinen Fortschritt in ImmoAdv sieht: Stufe, Bankreife in Prozent, Anzahl meiner Objekte und Unterlagen, welche Arten von Unterlagen noch fehlen (z. B. „Grundbuch und Flurkarte“) und den Zeitpunkt meiner letzten Aktivität. Dokumente und Inhalte werden nicht geteilt. Das Unternehmen kann mich per E-Mail an fehlende Unterlagen erinnern. Ich kann die Einwilligung jederzeit in meinem Konto widerrufen.';
const RADAR = 'Ich willige ein, dass das genannte Unternehmen zusätzlich Monat und Jahr des Endes der Zinsbindung meiner erfassten Objekte sieht (ohne Beträge, Banken oder Dokumente), um mich rechtzeitig zur Anschlussfinanzierung anzusprechen. Ich kann diese Einwilligung jederzeit in meinem Konto widerrufen.';
const Tok = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

async function ctx(req: Request) {
  if (!adminConfigured()) return { err: j({ error: 'Nicht konfiguriert.' }, 503) };
  const user = await userFromRequest(req);
  if (!user) return { err: j({ error: 'Bitte zuerst anmelden.' }, 401) };
  if (!allowRequest(`me-berater:${user.id}`, 30, 60_000)) return { err: j({ error: 'Zu viele Anfragen.' }, 429) };
  return { user };
}

async function inviteByToken(token: string) {
  const db = supabaseAdmin();
  const { data } = await db.from('immo_b2b_clients').select('id, account_id, status, expires_at').eq('token_hash', hashToken(token)).maybeSingle();
  if (!data || data.status !== 'eingeladen' || !data.expires_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  const { data: acc } = await db.from('immo_b2b_accounts').select('company_name, city, institution_type, verified_at').eq('id', data.account_id).maybeSingle();
  return acc ? { ...data, company: acc } : null;
}

export async function GET(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const token = new URL(req.url).searchParams.get('token');
  if (token) {
    if (!Tok.safeParse(token).success) return j({ error: 'Ungültiger Link.' }, 400);
    const inv = await inviteByToken(token);
    if (!inv) return j({ error: 'Diese Einladung ist abgelaufen oder wurde schon verwendet.' }, 404);
    return j({ invite: { company: inv.company.company_name, city: inv.company.city, verified: Boolean(inv.company.verified_at) }, consent: CONSENT });
  }
  const db = supabaseAdmin();
  const { data } = await db.from('immo_b2b_clients').select('id, account_id, consent_at, last_request_at, request_note, request_seen_at, radar_consent_at').eq('client_user_id', c.user!.id).eq('status', 'verbunden');
  const accIds = [...new Set((data ?? []).map((x) => x.account_id))];
  const { data: accs } = accIds.length ? await db.from('immo_b2b_accounts').select('id, company_name, city').in('id', accIds) : { data: [] };
  const byId = new Map((accs ?? []).map((a) => [a.id, a]));
  return j({ connections: (data ?? []).map((x) => ({
    id: x.id, company: byId.get(x.account_id)?.company_name || 'Unternehmen', city: byId.get(x.account_id)?.city || null, since: x.consent_at, radar: Boolean(x.radar_consent_at),
    // Offene Bitte des Beraters um fehlende Unterlagen (bis der Kunde sie gesehen hat).
    request: x.last_request_at && (!x.request_seen_at || new Date(x.request_seen_at) < new Date(x.last_request_at)) ? { at: x.last_request_at, note: x.request_note || null } : null,
  })), radarText: RADAR });
}

export async function POST(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const body = await req.json().catch(() => null);
  const seen = z.object({ seen: z.string().uuid() }).safeParse(body);
  if (seen.success) {
    await supabaseAdmin().from('immo_b2b_clients').update({ request_seen_at: new Date().toISOString() }).eq('id', seen.data.seen).eq('client_user_id', c.user!.id);
    return j({ ok: true });
  }
  // Zinsbindungs-Radar je Verbindung ein- oder ausschalten (eigene Einwilligung).
  const rad = z.object({ radar: z.boolean(), id: z.string().uuid() }).safeParse(body);
  if (rad.success) {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin().from('immo_b2b_clients').update(rad.data.radar ? { radar_consent_at: now, radar_consent_text: RADAR } : { radar_consent_at: null }).eq('id', rad.data.id).eq('client_user_id', c.user!.id).eq('status', 'verbunden');
    return error ? j({ error: 'Speichern fehlgeschlagen.' }, 500) : j({ ok: true });
  }
  const p = z.object({ token: Tok, consent: z.literal(true) }).safeParse(body);
  if (!p.success) return j({ error: 'Bitte der Freigabe ausdrücklich zustimmen.' }, 400);
  const inv = await inviteByToken(p.data.token);
  if (!inv) return j({ error: 'Diese Einladung ist abgelaufen oder wurde schon verwendet.' }, 404);
  const db = supabaseAdmin();
  // Bereits verbunden? Dann nur die Einladung schließen.
  const { data: dup } = await db.from('immo_b2b_clients').select('id').eq('account_id', inv.account_id).eq('client_user_id', c.user!.id).eq('status', 'verbunden').maybeSingle();
  if (dup) { await db.from('immo_b2b_clients').update({ status: 'getrennt', ended_at: new Date().toISOString(), ended_by: 'doppelt', token_hash: null }).eq('id', inv.id); return j({ ok: true, company: inv.company.company_name }); }
  const { error } = await db.from('immo_b2b_clients').update({ status: 'verbunden', client_user_id: c.user!.id, consent_at: new Date().toISOString(), consent_text: CONSENT, token_hash: null }).eq('id', inv.id).eq('status', 'eingeladen');
  return error ? j({ error: 'Verbinden fehlgeschlagen.' }, 500) : j({ ok: true, company: inv.company.company_name });
}

export async function DELETE(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const p = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const { error } = await supabaseAdmin().from('immo_b2b_clients').update({ status: 'getrennt', ended_at: new Date().toISOString(), ended_by: 'kunde' }).eq('id', p.data.id).eq('client_user_id', c.user!.id);
  return error ? j({ error: 'Trennen fehlgeschlagen.' }, 500) : j({ ok: true });
}
