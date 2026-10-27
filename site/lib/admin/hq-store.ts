import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Memory } from '@/lib/admin/hq-intel';

// Gemeinsamer Speicher des Headquarters (Tabelle lr_settings, nichts wird gelöscht):
//  hq_shift – letzter Stand jedes Agenten · hq_memory – Gedächtnis je Agent · hq_proposals – Vorschläge, die Freigabe brauchen.
export type AgentAction = { id: string; label: string; confirm?: string; tab?: string; sg?: string; ids?: string[]; q?: string };
export type AiNote = { at: string; text: string; model: string; usd: number; grund: 'analyse' | 'tag' | 'auftrag'; tools?: string[] };
export type AgentRun = { id: string; status: 'ok' | 'todo' | 'error'; line: string; at: string; ms: number; actions?: AgentAction[]; issues?: { id: string; level: 'hoch' | 'mittel' | 'niedrig'; title: string; customer?: boolean }[]; metrics?: Record<string, number>; ai?: AiNote; aiQueue?: string[] };

export async function loadShift(): Promise<Record<string, AgentRun>> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'hq_shift').maybeSingle();
  return (data?.value as Record<string, AgentRun>) || {};
}
// Nur die genannten Agenten überschreiben – parallele Runden (mehrere Browser-Anfragen, Wache) löschen sich so nicht gegenseitig.
export async function saveShift(part: Record<string, AgentRun>, by: string): Promise<Record<string, AgentRun>> {
  const fresh = await loadShift();
  const next = { ...fresh, ...part };
  await supabaseAdmin().from('lr_settings').upsert({ key: 'hq_shift', value: next, updated_at: new Date().toISOString(), updated_by: by });
  return next;
}
export async function loadMemory(): Promise<Memory> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'hq_memory').maybeSingle();
  return (data?.value as Memory) || {};
}
export async function saveMemory(part: Memory, by: string): Promise<void> {
  const fresh = await loadMemory();
  await supabaseAdmin().from('lr_settings').upsert({ key: 'hq_memory', value: { ...fresh, ...part }, updated_at: new Date().toISOString(), updated_by: by });
}

// ---------- Vorschläge mit Freigabe (Ava) ----------
export type ProposalDoc = { title: string; body: string };
export type Proposal = { id: string; at: string; agent: string; kind: 'code' | 'text' | 'marketing' | 'einstellung' | 'dokument' | 'sonstiges'; title: string; detail: string; why?: string; doc?: ProposalDoc; status: 'offen' | 'auftrag' | 'in_arbeit' | 'erledigt' | 'verworfen'; decidedAt?: string; startedAt?: string; result?: string };
const PROP_KEY = 'hq_proposals';
export async function loadProposals(): Promise<Proposal[]> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', PROP_KEY).maybeSingle();
  return ((data?.value as Proposal[] | null) || []).filter((p) => p && p.id);
}
export async function addProposal(p: Omit<Proposal, 'id' | 'at' | 'status'>, by: string): Promise<Proposal> {
  const list = await loadProposals();
  // Gleicher Titel vom gleichen Agenten noch offen → nicht doppelt anlegen.
  const dup = list.find((x) => ['offen', 'auftrag', 'in_arbeit'].includes(x.status) && x.agent === p.agent && x.title.toLowerCase() === p.title.toLowerCase());
  if (dup) return dup;
  const n: Proposal = { ...p, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), status: 'offen' };
  const next = [n, ...list].slice(0, 120);
  await supabaseAdmin().from('lr_settings').upsert({ key: PROP_KEY, value: next, updated_at: n.at, updated_by: by });
  return n;
}
export async function decideProposal(id: string, status: Proposal['status'], by: string, patch: Partial<Proposal> = {}): Promise<Proposal | null> {
  const list = await loadProposals();
  const p = list.find((x) => x.id === id);
  if (!p) return null;
  Object.assign(p, patch); p.status = status; p.decidedAt = new Date().toISOString();
  await supabaseAdmin().from('lr_settings').upsert({ key: PROP_KEY, value: list, updated_at: p.decidedAt, updated_by: by });
  return p;
}

// Sperre der Umsetzung, wenn etwas fehlt, das nur Feray beheben kann (z. B. Anthropic-Guthaben leer). Freigegebene
// Aufträge bleiben dann „freigegeben“ (statt wieder als offener Vorschlag aufzutauchen) und laufen automatisch weiter,
// sobald der nächste Versuch klappt. Neuer Versuch höchstens alle 30 Minuten oder sofort bei erneutem „Erledigen“.
export type UmsetzungBlock = { reason: 'guthaben' | 'sonstiges'; text: string; at: string };
const BLOCK_KEY = 'hq_umsetzung_block';
export const BLOCK_RETRY_MS = 30 * 60_000;
export async function loadBlock(): Promise<UmsetzungBlock | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', BLOCK_KEY).maybeSingle();
  const b = data?.value as UmsetzungBlock | null;
  return b && b.at ? b : null;
}
export async function setBlock(b: UmsetzungBlock | null, by: string): Promise<void> {
  // „null“ = Sperre aufheben (Wert leeren statt Zeile löschen).
  await supabaseAdmin().from('lr_settings').upsert({ key: BLOCK_KEY, value: b ?? {}, updated_at: new Date().toISOString(), updated_by: by });
}
export const blockActive = (b: UmsetzungBlock | null) => Boolean(b && Date.now() - Date.parse(b.at) < BLOCK_RETRY_MS);

// Umsetzungs-Warteschlange (Feray hat „Erledigen“ getippt): ältesten Auftrag holen und als „in Arbeit“ markieren.
// Hängt ein Auftrag länger als 45 Minuten, kommt er zurück in die Warteschlange.
export async function nextJob(by: string): Promise<Proposal | null> {
  const list = await loadProposals(), now = Date.now();
  for (const p of list) if (p.status === 'in_arbeit' && p.startedAt && now - new Date(p.startedAt).getTime() > 45 * 60_000) p.status = 'auftrag';
  if (list.some((p) => p.status === 'in_arbeit')) return null; // immer nur ein Auftrag gleichzeitig
  const job = list.filter((p) => p.status === 'auftrag').sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)))[0];
  if (!job) return null;
  job.status = 'in_arbeit'; job.startedAt = new Date().toISOString();
  await supabaseAdmin().from('lr_settings').upsert({ key: PROP_KEY, value: list, updated_at: job.startedAt, updated_by: by });
  return job;
}
