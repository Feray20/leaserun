import { NextResponse } from 'next/server';
import { adminConfigured } from '@/lib/supabase/admin';
import { panicLevel, panicState } from '@/lib/security/panic';
import { cronAuthOk } from '@/lib/security/github-oidc';
import { AGENT_IDS, runShift } from '@/lib/admin/hq-shift';
import { dispatchIfQueued } from '@/lib/admin/hq-dispatch';
import { kickQueue, loadQueue, pendingOf } from '@/lib/mail/send-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Headquarters-Wache rund um die Uhr. Wird alle paar Minuten von außen angestoßen (GitHub-Lauf .github/workflows/hq-wache.yml
// mit signiertem Ausweis, oder ein beliebiger Zeitplaner mit CRON_SECRET) – unabhängig davon, ob der Web-Admin offen ist.
// Ablauf je Lauf: alle Agenten regelbasiert (kostenlos). Das Denken mit Claude läuft getrennt (/api/cron/hq/denken).
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

async function run(req: Request) {
  const auth = await cronAuthOk(req, 'leaserun-hq', [process.env.CRON_SECRET, process.env.HQ_CRON_TOKEN]);
  if (!auth.ok) return j({ error: 'Nicht berechtigt.', grund: auth.why }, 401);
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  if (panicLevel(await panicState().catch(() => ({ active: false }))) === 2) return j({ skipped: 'panic' });
  const origin = process.env.PUBLIC_SITE_URL || 'https://leaserun.com';
  const t0 = Date.now();
  let todo = -1;
  try { todo = Object.values(await runShift('wache', origin, AGENT_IDS, false)).filter((r) => r.status !== 'ok').length; } catch (e) { console.warn('hq_wache', (e as Error).message); }
  await dispatchIfQueued().catch(() => null); // freigegebene Lösungen nicht liegen lassen
  // LeaseRun Intelligence: eindeutige Korrekturen (z. B. unplausible Belegbeträge) automatisch – ohne KI.
  await import('@/lib/admin/os-checks').then((m) => m.runOsChecks({ fix: true })).catch((e) => console.warn('os_checks', (e as Error).message));
  // „Alle senden“ hängt (z. B. Kette abgerissen)? Dann hier fortsetzen.
  const mq = await loadQueue().catch(() => null);
  if (mq && pendingOf(mq).length && !(mq.lockUntil && mq.lockUntil > Date.now())) await kickQueue(origin).catch(() => null);
  // Denken (Claude) läuft getrennt in /api/cron/hq/denken mit eigenem Zeitfenster.
  return j({ ok: true, ms: Date.now() - t0, todo });
}
export const GET = run;
export const POST = run;
