import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { cronAuthOk } from '@/lib/security/github-oidc';
import { blockActive, decideProposal, loadBlock, loadProposals, nextJob, setBlock } from '@/lib/admin/hq-store';
import { agentOf } from '@/lib/admin/hq-agents';
import { bookUsd, gate } from '@/lib/admin/hq-ai';
import { adminAudit } from '@/lib/b2b/core';
import { pushAdmins } from '@/lib/admin/push';
import { dispatchIfQueued } from '@/lib/admin/hq-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Umsetzungs-Agent (GitHub-Lauf .github/workflows/hq-umsetzung.yml): holt den nächsten Auftrag, den Feray mit „Erledigen“
// freigegeben hat, setzt ihn im Code um und meldet das Ergebnis. Anmeldung nur mit GitHub-Ausweis (Zweck leaserun-hq).
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function GET(req: Request) {
  const auth = await cronAuthOk(req, 'leaserun-hq', [process.env.HQ_CRON_TOKEN]);
  if (!auth.ok) return j({ error: 'Nicht berechtigt.', grund: auth.why }, 401);
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  // Meldet der Lauf, ob bei GitHub ein Anthropic-Schlüssel hinterlegt ist (Einrichtung erkennt das von selbst).
  const sk = new URL(req.url).searchParams.get('schluessel');
  if (sk === '0' || sk === '1') await supabaseAdmin().from('lr_settings').upsert({ key: 'gh_anthropic', value: { has: sk === '1', at: new Date().toISOString() }, updated_at: new Date().toISOString(), updated_by: 'umsetzung' });
  // Ohne eigenen GitHub-Schlüssel bekommt nur der echte Umsetzungs-Lauf (signierter Ausweis, Zweig main) den Schlüssel aus Vercel.
  const key = sk === '0' ? umsetzungKey(req) : null;
  if (sk === '0' && !key) return j({ job: null, grund: 'Kein Anthropic-Schlüssel für den Umsetzungs-Lauf.' });
  const g = await gate('umsetzung');
  if (!g.ok) return j({ job: null, grund: g.reason });
  // Umsetzung gesperrt (z. B. Guthaben leer): nicht alle 10 Minuten erneut scheitern, sondern höchstens alle 30 Minuten.
  const bl = await loadBlock();
  if (blockActive(bl)) return j({ job: null, grund: bl!.text });
  const job = await nextJob('umsetzung');
  if (!job) return j({ job: null });
  const a = agentOf(job.agent);
  return j({ job: { id: job.id, agent: a ? `${a.name} ${a.last} (${a.role})` : job.agent, kind: job.kind, title: job.title, detail: job.detail, why: job.why || '' }, model: g.settings.rest, ...(key ? { key } : {}) });
}

// Signatur ist bereits von cronAuthOk geprüft; hier nur, dass es genau der Umsetzungs-Lauf auf main ist.
function umsetzungKey(req: Request): string | null {
  const k = process.env.ANTHROPIC_API_KEY;
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!k || tok.split('.').length !== 3) return null;
  try {
    const c = JSON.parse(Buffer.from(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { workflow_ref?: string; ref?: string; event_name?: string };
    const wf = String(c.workflow_ref || '').includes('/.github/workflows/hq-umsetzung.yml@');
    return wf && (c.ref === 'refs/heads/main' || c.event_name === 'deployment_status') ? k : null;
  } catch { return null; }
}

const Body = z.object({ id: z.string().max(40), ok: z.boolean(), summary: z.string().max(4000), usd: z.number().min(0).max(100).optional(), commit: z.string().max(60).optional() });
export async function POST(req: Request) {
  const auth = await cronAuthOk(req, 'leaserun-hq', [process.env.HQ_CRON_TOKEN]);
  if (!auth.ok) return j({ error: 'Nicht berechtigt.', grund: auth.why }, 401);
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const { id, ok, summary, usd, commit } = p.data;
  // Scheitert die Umsetzung nur, weil etwas fehlt, das nicht am Auftrag liegt (Anthropic-Guthaben, Schlüssel), bleibt
  // Ferays „Erledigen“ gültig: der Auftrag wartet weiter und läuft automatisch, sobald es wieder geht.
  const blocked = !ok && /kein Guthaben|credit balance|billing|keinen Anthropic-Schlüssel/i.test(summary);
  const pr = await decideProposal(id, ok ? 'erledigt' : blocked ? 'auftrag' : 'offen', 'umsetzung', { result: `${ok ? '✓' : '✕'} ${summary.trim()}`.slice(0, 1500) });
  if (!pr) return j({ error: 'Auftrag nicht gefunden.' }, 404);
  if (usd) await bookUsd(pr.agent, usd, 'umsetzung');
  await adminAudit('umsetzung', 'hq_umsetzung', null, { id, ok, blocked, commit: commit || null });
  const was = await loadBlock();
  if (blocked) {
    await setBlock({ reason: /Guthaben|credit|billing/i.test(summary) ? 'guthaben' : 'sonstiges', text: summary.trim().slice(0, 400), at: new Date().toISOString() }, 'umsetzung');
    // Nur beim ersten Mal melden, nicht bei jedem Wiederholungsversuch.
    if (!was) await pushAdmins('support', 'Umsetzung pausiert', 'Anthropic-Guthaben leer – freigegebene Aufträge warten und laufen danach automatisch weiter.', 'hq_alarm').catch(() => null);
    return j({ ok: true, blocked: true });
  }
  if (ok && was) await setBlock(null, 'umsetzung');
  await pushAdmins('support', ok ? 'Umgesetzt' : 'Umsetzung braucht dich', `${pr.title.slice(0, 90)}`, 'hq_alarm').catch(() => null);
  await dispatchIfQueued(true); // nächsten wartenden Auftrag gleich anschließen
  return j({ ok: true });
}
