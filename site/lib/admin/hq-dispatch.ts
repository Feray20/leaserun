import { supabaseAdmin } from '@/lib/supabase/admin';
import { blockActive, loadBlock, loadProposals } from '@/lib/admin/hq-store';

// Startet den Umsetzungs-Agenten (GitHub-Lauf hq-umsetzung.yml) sofort, statt auf einen Zeitplan zu warten.
// GitHub führt geplante Läufe in diesem Repository nicht zuverlässig aus – deshalb stößt der Server den Lauf selbst an:
// direkt nach „Erledigen“ und in jeder Wache-Runde, solange Aufträge warten (höchstens alle 4 Minuten).
// Braucht in Vercel GITHUB_HQ_TOKEN (fein abgestufter GitHub-Schlüssel nur für dieses Repository, Recht „Actions: Read and write“).
const REPO = process.env.SITECHECK_REPO || 'Feray20/LeaseRun';
const KEY = 'hq_dispatch';
export const dispatchReady = () => Boolean(process.env.GITHUB_HQ_TOKEN);

export async function dispatchUmsetzung(force = false): Promise<{ ok: boolean; why?: string }> {
  const tok = process.env.GITHUB_HQ_TOKEN;
  if (!tok) return { ok: false, why: 'kein GitHub-Schlüssel' };
  const db = supabaseAdmin();
  const { data } = await db.from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  const last = (data?.value as { at?: string } | null)?.at;
  if (!force && last && Date.now() - Date.parse(last) < 4 * 6e4) return { ok: true, why: 'läuft bereits' };
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/hq-umsetzung.yml/dispatches`, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  }).catch(() => null);
  const ok = r?.status === 204;
  await db.from('lr_settings').upsert({ key: KEY, value: { at: new Date().toISOString(), ok, status: r?.status ?? 0 }, updated_at: new Date().toISOString(), updated_by: 'hq' });
  return ok ? { ok } : { ok, why: `GitHub antwortet ${r?.status ?? 'nicht'}` };
}

// Für die Wache: nur anstoßen, wenn wirklich ein Auftrag wartet.
export async function dispatchIfQueued(force = false): Promise<void> {
  if (!dispatchReady()) return;
  if ((await import('./hq-ai').then((m) => m.loadAiSettings())).off) return; // KI aus: keine Läufe mit Claude
  if (blockActive(await loadBlock())) return; // gesperrt (z. B. Guthaben leer) → erst nach 30 Min. oder neuem „Erledigen“
  const waiting = (await loadProposals()).some((p) => p.status === 'auftrag' || (p.status === 'in_arbeit' && Date.now() - Date.parse(p.startedAt || p.decidedAt || '0') > 50 * 6e4));
  if (waiting) await dispatchUmsetzung(force).catch(() => null);
}
