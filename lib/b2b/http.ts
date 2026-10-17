import { NextResponse } from 'next/server';
import { userFromRequest, type AuthUser } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured } from '@/lib/supabase/admin';
import { membershipFor, type B2BAccount } from '@/lib/b2b/core';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export type MemberCtx = { user: AuthUser; account: B2BAccount; role: 'owner' | 'advisor' };

// Angemeldetes Mitglied eines Unternehmenskontos; gesperrte Konten werden abgewiesen.
export async function requireMember(req: Request, opts: { owner?: boolean; allowLocked?: boolean; bucket?: string; limit?: number; onboarding?: boolean } = {}): Promise<MemberCtx | NextResponse> {
  if (!adminConfigured()) return json({ error: 'Nicht konfiguriert.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`${opts.bucket ?? 'b2b'}:${user.id}`, opts.limit ?? 60, 60_000)) return json({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, 429);
  const m = await membershipFor(user.id);
  if (!m) return json({ error: 'Kein Unternehmenskonto.' }, 404);
  if (m.account.status === 'locked' && !opts.allowLocked) return json({ error: 'Das Unternehmenskonto ist gesperrt. Bitte an support@immoadv.de wenden.' }, 423);
  if (opts.owner && m.role !== 'owner') return json({ error: 'Nur der Kontoinhaber kann das ändern.' }, 403);
  // Vom Admin angelegte Konten: erst nach Ersteinrichtung (§ 14 BGB, AVV) nutzbar.
  if (!opts.onboarding && (!m.account.unternehmer_confirmed_at || !m.account.avv_accepted_at)) return json({ error: 'Bitte zuerst die Ersteinrichtung abschließen.', code: 'onboarding' }, 428);
  return { user, ...m };
}
