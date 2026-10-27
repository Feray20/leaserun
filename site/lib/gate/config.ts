import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Vorschau & Freischaltung – eine Einstellung für die ganze Website, im Web-Admin steuerbar.
// vorschau = ohne Zugang nur Einblick; offen = für alle Besucher frei.
export type GateConfig = {
  wissen: 'vorschau' | 'offen';
  leseproben: number;        // so viele Wissens-Antworten sind ohne Zugang als Leseprobe sichtbar (erster Satz)
  rechner: 'vorschau' | 'offen';
  beispiele: 'vorschau' | 'offen';
  pdfProzent: number;        // Anteil der Seiten der Muster-PDFs ohne Zugang
};
export const GATE_DEFAULT: GateConfig = { wissen: 'vorschau', leseproben: 10, rechner: 'vorschau', beispiele: 'vorschau', pdfProzent: 20 };
const KEY = 'gate_config';
let memo: { v: GateConfig; t: number } | null = null;

export function cleanGate(x: unknown): GateConfig {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const mode = (v: unknown, d: 'vorschau' | 'offen') => (v === 'offen' || v === 'vorschau' ? v : d);
  const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    wissen: mode(o.wissen, GATE_DEFAULT.wissen),
    leseproben: num(o.leseproben, GATE_DEFAULT.leseproben, 0, 63),
    rechner: mode(o.rechner, GATE_DEFAULT.rechner),
    beispiele: mode(o.beispiele, GATE_DEFAULT.beispiele),
    pdfProzent: num(o.pdfProzent, GATE_DEFAULT.pdfProzent, 5, 100),
  };
}
export async function loadGate(): Promise<GateConfig> {
  if (memo && Date.now() - memo.t < 30_000) return memo.v;
  let v = GATE_DEFAULT;
  if (adminConfigured()) {
    try { const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle(); v = cleanGate(data?.value); } catch { v = GATE_DEFAULT; }
  }
  memo = { v, t: Date.now() };
  return v;
}
export async function saveGate(input: unknown, by: string): Promise<GateConfig> {
  const v = cleanGate(input);
  await supabaseAdmin().from('lr_settings').upsert({ key: KEY, value: v, updated_at: new Date().toISOString(), updated_by: by });
  memo = { v, t: Date.now() };
  return v;
}
