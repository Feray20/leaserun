import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { AGENT_IDS, COMMAND_LABELS, doNow, loadShift, runAnalyses, runCommand, runDaily, runShift } from '@/lib/admin/hq-shift';
import { AGENTS } from '@/lib/admin/hq-agents';
import { aiStatus, isModel, saveAiSettings } from '@/lib/admin/hq-ai';
import { blockActive, decideProposal, loadBlock, loadProposals, setBlock } from '@/lib/admin/hq-store';
import { dispatchReady, dispatchUmsetzung } from '@/lib/admin/hq-dispatch';
import { archiveDrafts, draftPackets } from '@/lib/admin/hq-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Headquarters: GET = Stand aller Mitarbeiter, Belegschaft, Intelligenz-Status, offene Vorschläge.
// POST = Mitarbeiter arbeiten lassen · Auftrag an einen Agenten / die Zentrale · Analyse anstoßen · Einstellungen · Freigaben.
// GET ?entwuerfe=1 = E-Mail-Entwürfe als Pakete (Herkunft + Tag) für Avas Ansicht; Archivieren nur per POST, Senden nie hier.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  if (new URL(req.url).searchParams.get('entwuerfe') === '1') return j(await draftPackets());
  const [agents, ai, proposals, block] = await Promise.all([loadShift(), aiStatus().catch(() => null), openProposals().catch(() => []), loadBlock().catch(() => null)]);
  // Sperre nur zeigen, solange wirklich Aufträge warten.
  const waiting = proposals.some((p) => p.status === 'auftrag' || p.status === 'in_arbeit');
  return j({ agents, commands: COMMAND_LABELS, staff: AGENTS, ai, proposals, umsetzung: dispatchReady(), blocked: block && waiting ? { ...block, active: blockActive(block) } : null });
}

// Offene Vorschläge, laufende Umsetzungen und frisch Erledigtes (24 Std., damit Feray das Ergebnis sieht). Dokumenttext nur gekürzt.
async function openProposals() {
  const now = Date.now();
  return (await loadProposals()).filter((p) => ['offen', 'auftrag', 'in_arbeit'].includes(p.status) || (p.status === 'erledigt' && p.result && now - new Date(p.decidedAt || 0).getTime() < 864e5))
    .slice(0, 40).map((p) => ({ ...p, doc: p.doc ? { title: p.doc.title, body: '' } : undefined }));
}

const Hist = z.array(z.object({ me: z.boolean(), t: z.string().max(2500) })).max(12);
const Body = z.object({
  agents: z.array(z.enum(AGENT_IDS)).max(AGENT_IDS.length).optional(), force: z.boolean().optional(),
  agent: z.union([z.enum(AGENT_IDS), z.literal('zentrale')]).optional(), command: z.string().trim().min(1).max(1500).optional(), history: Hist.optional(),
  action: z.enum(['analyse', 'tagesrunde', 'settings', 'proposal', 'erledigen', 'entwuerfe_archivieren']).optional(),
  ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  settings: z.object({ top: z.string().optional(), rest: z.string().optional(), bg: z.string().optional(), dailyUsd: z.number().optional(), dailyCalls: z.number().optional(), auto: z.boolean().optional(), daily: z.boolean().optional(), off: z.boolean().optional() }).optional(),
  proposalId: z.string().max(40).optional(), decision: z.enum(['erledigen', 'erledigt', 'verworfen']).optional(),
});
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const origin = new URL(req.url).origin, actor = auth.user.email;
  const d = p.data;
  if (d.action === 'settings' && d.settings) {
    const s = d.settings;
    if ((s.top && !isModel(s.top)) || (s.rest && !isModel(s.rest)) || (s.bg && !isModel(s.bg))) return j({ error: 'Unbekanntes Modell.' }, 400);
    const next = await saveAiSettings({ ...s, top: s.top as never, rest: s.rest as never, bg: s.bg as never }, 'admin');
    await adminAudit(actor, 'hq_ai_settings', null, { top: next.top, rest: next.rest, dailyUsd: next.dailyUsd, dailyCalls: next.dailyCalls, auto: next.auto, daily: next.daily, off: next.off });
    return j({ ok: true, ai: await aiStatus() });
  }
  if (d.action === 'entwuerfe_archivieren' && d.ids?.length) {
    // Dieselbe Logik wie das Werkzeug entwuerfe_archivieren: nur Ordner „Archiv“, nichts gesendet, nichts gelöscht.
    try { const n = await archiveDrafts(d.ids, actor, { agent: 'freigaben', grund: 'Paket-Ansicht (Feray)' }, 200); return j({ ok: true, archiviert: n, ...(await draftPackets()) }); }
    catch (e) { return j({ error: (e as Error).message || 'Archivieren fehlgeschlagen' }, 400); }
  }
  if (d.action === 'proposal' && d.proposalId && d.decision) {
    // „Erledigen“: Dokumente gelten als angenommen; alles andere geht an den Umsetzungs-Agenten (GitHub-Lauf mit Opus).
    const cur = (await loadProposals()).find((x) => x.id === d.proposalId);
    if (!cur) return j({ error: 'Vorschlag nicht gefunden.' }, 404);
    const status = d.decision === 'verworfen' ? 'verworfen' : cur.kind === 'dokument' || d.decision === 'erledigt' ? 'erledigt' : 'auftrag';
    const pr = await decideProposal(d.proposalId, status, 'admin');
    // Neues „Erledigen“ = sofort neuer Versuch, auch wenn die Umsetzung gerade pausiert (z. B. Guthaben inzwischen aufgeladen).
    const prevBlock = status === 'auftrag' ? await loadBlock() : null;
    if (prevBlock) await setBlock(null, 'admin');
    await adminAudit(actor, 'hq_proposal', null, { id: d.proposalId, decision: status, agent: pr?.agent });
    // KI aus: kein GitHub-Lauf mit Claude (kostet). Der Auftrag bleibt freigegeben in der Liste – Claude im Chat setzt ihn um.
    const kiOff = (await import('@/lib/admin/hq-ai').then((m) => m.loadAiSettings())).off;
    const started = status === 'auftrag' && !kiOff ? (await dispatchUmsetzung(true).catch(() => ({ ok: false }))).ok : false;
    // Letzter Lauf scheiterte am Guthaben: ehrlich sagen, statt nur „Wird umgesetzt.“
    const warn = status === 'auftrag' && kiOff ? 'KI ist ausgeschaltet – der Auftrag ist freigegeben und wartet. Sag Claude im Chat „setz die freigegebenen HQ-Aufträge um“, dann wird er ohne API-Kosten umgesetzt.' : prevBlock && (prevBlock as { reason?: string }).reason === 'guthaben' ? (prevBlock as { text?: string }).text || 'Das Anthropic-Konto hatte zuletzt kein Guthaben.' : null;
    return j({ ok: true, status, started, warn, proposals: await openProposals() });
  }
  if (d.action === 'erledigen' && d.agents?.length === 1) {
    try { const r = await doNow(actor, origin, d.agents[0]); return j({ ...r, proposals: await openProposals() }); }
    catch (e) { return j({ error: `Nicht erledigt: ${(e as Error).message || 'Fehler'}` }, 502); }
  }
  if (d.action === 'analyse') {
    try { const r = await runAnalyses(actor, origin, d.agents?.length ? d.agents.length : 2, d.agents); return j({ ...r, agents: await loadShift(), proposals: await openProposals() }); }
    catch (e) { return j({ error: `Analyse nicht möglich: ${(e as Error).message || 'Fehler'}` }, 502); }
  }
  if (d.action === 'tagesrunde') {
    try { const r = await runDaily(actor, origin, 2, true); return j({ ...r, agents: await loadShift() }); }
    catch (e) { return j({ error: `Tagesrunde nicht möglich: ${(e as Error).message || 'Fehler'}` }, 502); }
  }
  if (d.agent && d.command) {
    try { return j(await runCommand(actor, origin, d.agent, d.command, d.history || [])); }
    catch (e) { return j({ error: `Auftrag nicht ausgeführt: ${(e as Error).message || 'Fehler'}` }, 502); }
  }
  try { return j({ agents: await runShift(actor, origin, d.agents || AGENT_IDS, Boolean(d.force)) }); }
  catch (e) { console.warn('hq_shift', (e as Error).message); return j({ error: 'Die Schicht konnte gerade nicht starten.' }, 502); }
}
