import '@/lib/env-alias';
import { NextResponse } from 'next/server';
import { requireAdmin, mfaRequired } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { liveChecks, type Check } from '@/lib/admin/livecheck';
import { graphReady } from '@/lib/booking/graph';
import { panicState } from '@/lib/security/panic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// Läuft eine Prüfung in die Zeit oder scheitert sie, wird sie als „nicht geprüft“ gemeldet – nie als in Ordnung.
async function timed(id: string, label: string, f: () => Promise<{ state: Check['state']; info: string }>, ms = 8000): Promise<Check & { ms: number }> {
  const t0 = Date.now();
  try {
    const r = await Promise.race([f(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    return { id, label, ...r, ms: Date.now() - t0 };
  } catch (e) {
    const timeout = e instanceof Error && e.message === 'timeout';
    return { id, label, state: 'fail', info: timeout ? 'Keine Antwort innerhalb der Zeit – nicht geprüft.' : 'Prüfung fehlgeschlagen.', ms: Date.now() - t0 };
  }
}

// Systemdiagnose für die Admin-App („System jetzt prüfen“): alle Dienste live und parallel, verständliche Ergebnisse.
// Nur Inhaber; jeder Lauf wird protokolliert. Nutzt die bestehende Live-Prüfung des Web-Admins (Stripe, Webhook, E-Mail, DNS, Datenbank).
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Der Server hat keinen Zugang zur Datenbank.' }, 503);
  const origin = new URL(req.url).origin;
  const db = supabaseAdmin();
  const supaUrl = process.env.SUPABASE_URL || '';
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const [live, ...extra] = await Promise.all([
    Promise.race([liveChecks(origin), new Promise<Check[]>((r) => setTimeout(() => r([{ id: 'live', label: 'Zahlungen, E-Mail, Datenbank', state: 'fail', info: 'Keine Antwort innerhalb der Zeit – nicht geprüft.' }]), 30000))]).catch(() => [{ id: 'live', label: 'Zahlungen, E-Mail, Datenbank', state: 'fail' as const, info: 'Prüfung fehlgeschlagen.' }]),
    timed('storage', 'Speicher', async () => { const r = await db.storage.listBuckets(); return r.error ? { state: 'fail', info: 'nicht erreichbar' } : { state: 'ok', info: `${r.data?.length ?? 0} Speicherbereiche erreichbar` }; }),
    timed('auth', 'Anmeldung (Supabase Auth)', async () => {
      const r = await fetch(`${supaUrl}/auth/v1/health`, { headers: { apikey: supaKey }, signal: AbortSignal.timeout(7000) });
      return r.ok ? { state: 'ok', info: 'erreichbar' } : { state: 'fail', info: 'antwortet nicht wie erwartet' };
    }),
    timed('graph', 'Microsoft-Kalender (Termine)', async () => ((await graphReady()) ? { state: 'ok', info: 'verbunden' } : { state: 'warn', info: 'nicht verbunden – Bestätigungen ohne Teams-Link' })),
    timed('push', 'Mitteilungsdienst (Expo/APNs)', async () => {
      const r = await fetch('https://exp.host/--/api/v2/push/getReceipts', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ids: [] }), signal: AbortSignal.timeout(7000) });
      const n = await db.from('lr_admin_push_tokens').select('token', { count: 'exact', head: true });
      return r.ok ? { state: 'ok', info: `erreichbar · ${n.count ?? 0} Gerät(e) angemeldet` } : { state: 'fail', info: 'nicht erreichbar' };
    }),
    timed('secconf', 'Sicherheitseinstellungen', async () => {
      const p = await panicState().catch(() => ({ active: false } as { active: boolean }));
      if (p.active) return { state: 'fail', info: 'Not-Aus ist aktiv' };
      return mfaRequired() ? { state: 'ok', info: 'zweiter Faktor Pflicht, Not-Aus aus' } : { state: 'warn', info: 'zweiter Faktor ist nicht Pflicht (ADMIN_MFA=off)' };
    }),
  ]);

  const checks = [{ id: 'api', label: 'API', state: 'ok' as const, info: `antwortet${process.env.VERCEL_REGION ? ` · ${process.env.VERCEL_REGION}` : ''}`, ms: 0 }, ...extra, ...live];
  const reachable = checks.filter((c) => c.state !== 'fail').length;
  await adminAudit(auth.user.email, 'app_diagnose', null, { ok: reachable, total: checks.length }).catch(() => null);
  return j({ at: new Date().toISOString(), total: checks.length, reachable, failed: checks.length - reachable, warnings: checks.filter((c) => c.state === 'warn').length, checks });
}
