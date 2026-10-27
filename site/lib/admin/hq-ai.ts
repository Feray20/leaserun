import { supabaseAdmin } from '@/lib/supabase/admin';

// LeaseRun Intelligence · Modell-Schicht. Verbindet die Headquarters-Agenten mit Claude (Anthropic-API).
// Grundsätze (Entscheidung der Gründerin):
//  - Die Wache (alle paar Minuten) läuft ohne Modell und kostet nichts. Das Modell wird nur gerufen, wenn
//    1. Feray einem Agenten schreibt oder die Zentrale fragt, 2. die Wache etwas Neues und Wichtiges findet
//    (Analyse + Lösung), 3. einmal am Tag je Abteilung (Vorschläge).
//  - Jede Anfrage wird gezählt und in Dollar bewertet. Tages-Deckel (Aufrufe und Dollar) sind hart: darüber antwortet
//    das Modell nicht, die Agenten arbeiten regelbasiert weiter. Zusätzlich gilt das Limit im Anthropic-Konto.
//  - Ohne ANTHROPIC_API_KEY ist alles wie vorher – kein Fehler, nur ein Hinweis in der Einrichtung.
//  - Schlüssel bleiben auf dem Server. Nichts geht ohne Freigabe nach außen: Das Modell kann nur Entwürfe und Vorschläge
//    anlegen, nie senden oder veröffentlichen.

export type ModelId = 'claude-fable-5-1' | 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export const MODELS: { id: ModelId; label: string; note: string }[] = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Standard · schnell und günstig' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'sehr stark · für Zentrale und Lagebild' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'sehr schnell · für einfache Hintergrundarbeit' },
];
// Fable 5.1 ist die teuerste Stufe und bewusst NICHT wählbar (Vorgabe Feray, 27.10.2026): Sie wird nur als allerletzte
// Stufe gerufen, wenn Opus bei einem eigenen Auftrag von Feray zu keinem Ergebnis gekommen ist (siehe askAgent).
export const LAST_RESORT: ModelId = 'claude-fable-5-1';
const notFable = (m: ModelId, def: ModelId): ModelId => (m === LAST_RESORT ? def : m);
// Preise in US-Dollar je 1 Mio. Tokens (Stand Oktober 2026; Haiku 5.5 geschätzt): Eingabe, Ausgabe, Cache lesen, Cache schreiben.
const PRICE: Record<ModelId, [number, number, number, number]> = {
  'claude-fable-5-1': [10, 50, 0.25, 12.5], 'claude-opus-5-5': [4, 20, 0.2, 5], 'claude-sonnet-5-5': [2, 10, 0.2, 2.5], 'claude-haiku-5-5': [1, 5, 0.1, 1.25],
};
export const isModel = (m: string): m is ModelId => m in PRICE;

export type AiSettings = { top: ModelId; rest: ModelId; bg: ModelId; dailyUsd: number; dailyCalls: number; auto: boolean; daily: boolean; off: boolean };
// Sparsam (Reihenfolge Sonnet → Opus → Fable): Zentrale/Lagebild mit Opus, alle übrigen Abteilungen, Umsetzungen und
// Hintergrundarbeit (Wache, Tagesrunde, Entwürfe) mit Sonnet. Fable nie als Grundeinstellung.
export const DEFAULT_AI: AiSettings = { top: 'claude-opus-5-5', rest: 'claude-sonnet-5-5', bg: 'claude-sonnet-5-5', dailyUsd: 1, dailyCalls: 80, auto: true, daily: true, off: true };
// off = true: KI (Anthropic-API) ausgeschaltet (Wunsch Feray, 27.10.2026 – zu teuer). Die Agenten arbeiten dann regelbasiert:
// Wache, Prüfungen, Funde, Fixer und Freigaben laufen weiter, nur ohne Claude-Aufrufe und ohne Kosten.
// Zentrale und Lagebild denken mit der obersten Stufe; alle übrigen Abteilungen mit der zweiten.
export const TOP_AGENTS = new Set(['zentrale', 'briefing']);

export type Usage = { day: string; calls: number; inTok: number; outTok: number; cacheRead: number; cacheWrite: number; usd: number; month: string; monthCalls: number; monthUsd: number; log: { at: string; agent: string; model: string; usd: number; ms: number; grund: string }[] };
const SET_KEY = 'hq_ai', USE_KEY = 'hq_ai_usage';
const berlinDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d);
const emptyUsage = (): Usage => ({ day: berlinDay(), calls: 0, inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0, usd: 0, month: berlinDay().slice(0, 7), monthCalls: 0, monthUsd: 0, log: [] });

export const aiConfigured = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY && String(process.env.ANTHROPIC_API_KEY).trim());

export async function loadAiSettings(): Promise<AiSettings> {
  try {
    const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', SET_KEY).maybeSingle();
    const v = (data?.value as Partial<AiSettings> | null) || {};
    const pick = (x: unknown, def: ModelId): ModelId => (isModel(String(x)) ? notFable(x as ModelId, def) : def);
    return { ...DEFAULT_AI, ...v, top: pick(v.top, DEFAULT_AI.top), rest: pick(v.rest, DEFAULT_AI.rest), bg: pick(v.bg, DEFAULT_AI.bg), dailyUsd: clamp(Number(v.dailyUsd), 0.5, 100, DEFAULT_AI.dailyUsd), dailyCalls: clamp(Number(v.dailyCalls), 5, 2000, DEFAULT_AI.dailyCalls) };
  } catch { return { ...DEFAULT_AI }; }
}
const clamp = (x: number, lo: number, hi: number, def: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def);
export async function saveAiSettings(s: Partial<AiSettings>, by: string): Promise<AiSettings> {
  const cur = await loadAiSettings();
  const pick = (x: unknown, def: ModelId): ModelId => (isModel(String(x)) ? notFable(x as ModelId, def) : def);
  const next: AiSettings = { ...cur, ...s, top: pick(s.top ?? cur.top, cur.top), rest: pick(s.rest ?? cur.rest, cur.rest), bg: pick(s.bg ?? cur.bg, cur.bg), dailyUsd: clamp(Number(s.dailyUsd ?? cur.dailyUsd), 0.5, 100, cur.dailyUsd), dailyCalls: clamp(Number(s.dailyCalls ?? cur.dailyCalls), 5, 2000, cur.dailyCalls) };
  await supabaseAdmin().from('lr_settings').upsert({ key: SET_KEY, value: next, updated_at: new Date().toISOString(), updated_by: by });
  return next;
}
export async function loadUsage(): Promise<Usage> {
  try {
    const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', USE_KEY).maybeSingle();
    const u = { ...emptyUsage(), ...((data?.value as Partial<Usage> | null) || {}) };
    const today = berlinDay();
    if (u.day !== today) { Object.assign(u, { day: today, calls: 0, inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }); }
    if (u.month !== today.slice(0, 7)) { u.month = today.slice(0, 7); u.monthCalls = 0; u.monthUsd = 0; }
    return u;
  } catch { return emptyUsage(); }
}
export const modelFor = (s: AiSettings, agent: string, bg = false): ModelId => (bg ? s.bg : TOP_AGENTS.has(agent) ? s.top : s.rest);
export const costOf = (model: ModelId, u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): number => {
  const [i, o, cr, cw] = PRICE[model];
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * cr + (u.cache_creation_input_tokens || 0) * cw) / 1e6;
};

// Darf das Modell jetzt arbeiten? Liefert den Grund, wenn nicht (für die ehrliche Anzeige im Headquarters).
export type Gate = { ok: true; settings: AiSettings; usage: Usage } | { ok: false; reason: string; settings: AiSettings; usage: Usage };
// Kostenbremse: höchstens 50 $ im Monat (Vorgabe Feray, 27.10.2026). Davon sind 20 $ für ihre eigenen Aufträge und die
// Umsetzungen reserviert – die automatische Arbeit kann sie also nie aufbrauchen. Automatische Arbeit (Wache, Tagesrunde) bekommt
// ein Tagesbudget aus dem, was im Monat übrig ist (gleichmäßig verteilt, an ruhigen Tagen Gespartes nutzbar).
// Ferays eigene Aufträge und „Jetzt erledigen“ laufen immer, solange der Monat nicht ausgeschöpft ist.
export const MONTH_CAP_USD = 50;
export const USER_RESERVE_USD = 20;
// Ein Umsetzungs-Lauf (GitHub, Opus) kostet bis ca. 5 $ – nur starten, wenn das sicher noch ins Monatsbudget passt.
const UMSETZUNG_MIN_LEFT_USD = 5;
const daysLeftInMonth = () => { const t = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' })); return new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() - t.getDate() + 1; };
export async function gate(kind: 'auto' | 'user' | 'umsetzung' = 'auto'): Promise<Gate> {
  const [settings, usage] = await Promise.all([loadAiSettings(), loadUsage()]);
  if (settings.off) return { ok: false, reason: 'KI ist ausgeschaltet (kostet nichts) – die Agenten arbeiten regelbasiert: Prüfungen, Wache und Freigaben laufen weiter. Code-Änderungen übernimmt Claude im Chat.', settings, usage };
  if (!aiConfigured()) return { ok: false, reason: 'Claude ist noch nicht angebunden (ANTHROPIC_API_KEY fehlt – siehe Einrichtung).', settings, usage };
  const left = MONTH_CAP_USD - usage.monthUsd;
  if (left <= 0.3) return { ok: false, reason: 'Das Monatsbudget (50 $) ist ausgeschöpft. Ab dem 1. arbeiten die Agenten wieder mit Claude; bis dahin regelbasiert.', settings, usage };
  if (kind === 'umsetzung' && left < UMSETZUNG_MIN_LEFT_USD) return { ok: false, reason: `Für eine Umsetzung reicht das Monatsbudget nicht mehr (noch ${left.toFixed(2)} $ von 50 $). Ab dem 1. geht es weiter.`, settings, usage };
  if (kind === 'auto') {
    const autoLeft = left - USER_RESERVE_USD;
    if (autoLeft <= 0.3) return { ok: false, reason: 'Das Budget für automatische Arbeit ist für diesen Monat aufgebraucht – deine eigenen Aufträge laufen weiter.', settings, usage };
    const today = Math.min(autoLeft, settings.dailyUsd, Math.max(0.5, ((autoLeft + usage.usd) / daysLeftInMonth()) * 1.5));
    if (usage.usd >= today || usage.calls >= 300) return { ok: false, reason: 'Für heute ist das automatische Kontingent verbraucht – deine eigenen Aufträge laufen weiter.', settings, usage };
  }
  return { ok: true, settings, usage };
}
async function book(agent: string, model: ModelId, u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }, ms: number, grund: string): Promise<void> {
  try {
    const usage = await loadUsage(), usd = costOf(model, u);
    usage.calls++; usage.inTok += u.input_tokens || 0; usage.outTok += u.output_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0; usage.cacheWrite += u.cache_creation_input_tokens || 0;
    usage.usd = Math.round((usage.usd + usd) * 1e5) / 1e5; usage.monthCalls++; usage.monthUsd = Math.round((usage.monthUsd + usd) * 1e5) / 1e5;
    usage.log = [{ at: new Date().toISOString(), agent, model, usd: Math.round(usd * 1e5) / 1e5, ms, grund }, ...usage.log].slice(0, 30);
    await supabaseAdmin().from('lr_settings').upsert({ key: USE_KEY, value: usage, updated_at: new Date().toISOString(), updated_by: 'hq' });
  } catch (e) { console.warn('hq_ai_book', e instanceof Error ? e.message : e); }
}

// Kosten eines externen Laufs (Umsetzungs-Agent bei GitHub) ins Monatsbudget buchen.
export async function bookUsd(agent: string, usd: number, grund: string): Promise<void> {
  try {
    const usage = await loadUsage(), v = Math.max(0, Math.min(50, Number(usd) || 0));
    usage.calls++; usage.usd = Math.round((usage.usd + v) * 1e5) / 1e5; usage.monthCalls++; usage.monthUsd = Math.round((usage.monthUsd + v) * 1e5) / 1e5;
    usage.log = [{ at: new Date().toISOString(), agent, model: 'umsetzung', usd: v, ms: 0, grund }, ...usage.log].slice(0, 30);
    await supabaseAdmin().from('lr_settings').upsert({ key: USE_KEY, value: usage, updated_at: new Date().toISOString(), updated_by: 'hq' });
  } catch (e) { console.warn('hq_ai_book_usd', e instanceof Error ? e.message : e); }
}

// ---------- Aufruf mit Werkzeugen (agentische Schleife) ----------
export type Tool = { name: string; description: string; input_schema: Record<string, unknown>; run: (input: Record<string, unknown>) => Promise<unknown> };
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
export type AiResult = { text: string; model: ModelId; usd: number; ms: number; calls: number; toolsUsed: string[]; toolLog: { name: string; ok: boolean; summary: string }[] };

const API = 'https://api.anthropic.com/v1/messages';
const short = (v: unknown, max = 8000): string => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > max ? `${s.slice(0, max)} … [gekürzt]` : s; };

// Ein Gespräch mit dem Modell: System-Briefing (zwischengespeichert), Verlauf, Werkzeuge. Höchstens `maxTurns` Runden,
// damit ein Aufruf nie ausufert. Jede Runde wird abgerechnet.
export async function converse(o: { agent: string; model: ModelId; system: string; messages: Msg[]; tools: Tool[]; grund: string; maxTurns?: number; maxTokens?: number; timeoutMs?: number }): Promise<AiResult> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const t0 = Date.now(), maxTurns = o.maxTurns ?? 6, deadline = t0 + (o.timeoutMs ?? 40_000);
  const msgs: Msg[] = [...o.messages];
  const toolDefs = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  let usd = 0, calls = 0, text = '';
  const toolsUsed: string[] = [], toolLog: AiResult['toolLog'] = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    const left = deadline - Date.now();
    if (left < 4000) { text ||= 'Die Analyse hat zu lange gedauert – ich habe abgebrochen, bevor es teuer wird.'; break; }
    const body = {
      model: o.model, max_tokens: o.maxTokens ?? 3500,
      system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
      messages: msgs, ...(toolDefs.length ? { tools: toolDefs } : {}),
    };
    let res: Response;
    try { res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(left - 1500, 60_000)) }); }
    catch (e) { if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') { text ||= 'Ich brauche dafür mehr Zeit, als dieser Durchlauf hatte – beim nächsten Durchlauf mache ich weiter.'; break; } throw e; }
    const data = (await res.json().catch(() => null)) as { content?: Block[]; stop_reason?: string; usage?: Record<string, number>; error?: { message?: string; type?: string } } | null;
    calls++;
    if (!res.ok || !data?.content) {
      const m = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error('Der Anthropic-Schlüssel wird abgelehnt (401). In Vercel ANTHROPIC_API_KEY prüfen.');
      if (res.status === 429) throw new Error('Anthropic bremst gerade (zu viele Anfragen oder Kontolimit erreicht).');
      if (res.status === 400 && /credit|balance|billing/i.test(m)) throw new Error('Das Anthropic-Konto hat kein Guthaben mehr – unter console.anthropic.com → Billing aufladen.');
      throw new Error(`Modell nicht erreichbar: ${m}`);
    }
    const u = data.usage || {};
    usd += costOf(o.model, u);
    await book(o.agent, o.model, u, Date.now() - t0, o.grund);
    msgs.push({ role: 'assistant', content: data.content });
    const uses = data.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    text = data.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim() || text;
    // Abgeschnitten (zu lang): unvollständigen Teil verwerfen und um eine kürzere Fassung bitten.
    if (data.stop_reason === 'max_tokens') { msgs.pop(); msgs.push({ role: 'user', content: 'Deine letzte Antwort war zu lang und wurde abgeschnitten. Fasse dich kürzer (Dokumente höchstens eine Seite) und mach weiter.' }); text = ''; continue; }
    if (data.stop_reason !== 'tool_use' || !uses.length) break;
    const results: Block[] = [];
    for (const use of uses) {
      const tool = o.tools.find((t) => t.name === use.name);
      toolsUsed.push(use.name);
      if (!tool) { results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Unbekanntes Werkzeug.', is_error: true }); continue; }
      try {
        const r = await Promise.race([tool.run(use.input || {}), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Werkzeug dauert zu lange')), 20_000))]);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: short(r) });
        toolLog.push({ name: use.name, ok: true, summary: short(r, 160) });
      } catch (e) {
        const m = (e as Error).message || 'Fehler';
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `Fehler: ${m}`, is_error: true });
        toolLog.push({ name: use.name, ok: false, summary: m.slice(0, 160) });
      }
    }
    msgs.push({ role: 'user', content: results });
  }
  // Alle Runden mit Nachschauen verbraucht und noch kein Text: eine letzte Runde ohne Werkzeuge erzwingt die Zusammenfassung.
  if (!text && Date.now() < deadline - 3000) {
    if (msgs[msgs.length - 1]?.role === 'assistant') msgs.pop();
    if (msgs[msgs.length - 1]?.role !== 'user') msgs.push({ role: 'user', content: 'Weiter.' });
    try {
      const last = msgs[msgs.length - 1]; const extra = { type: 'text' as const, text: 'Jetzt keine Werkzeuge mehr. Fasse für Feray in höchstens 5 Sätzen zusammen, was du herausgefunden und erledigt hast und was sie tun muss.' };
      const body = { model: o.model, max_tokens: 700, system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }], messages: [...msgs.slice(0, -1), { ...last, content: [...(Array.isArray(last.content) ? last.content : [{ type: 'text' as const, text: last.content }]), extra] }], ...(toolDefs.length ? { tools: toolDefs, tool_choice: { type: 'none' } } : {}) };
      const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(3000, deadline - Date.now())) });
      const data = (await res.json().catch(() => null)) as { content?: Block[]; usage?: Record<string, number> } | null;
      if (res.ok && data?.content) { calls++; usd += costOf(o.model, data.usage || {}); await book(o.agent, o.model, data.usage || {}, Date.now() - t0, o.grund); text = data.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim(); }
    } catch { /* bleibt ohne Text */ }
  }
  return { text: text || 'Ich bin zu keinem Ergebnis gekommen – bitte „Erneut analysieren“ tippen.', model: o.model, usd: Math.round(usd * 1e5) / 1e5, ms: Date.now() - t0, calls, toolsUsed, toolLog };
}

// Status für das Headquarters – bewusst ohne Beträge (Feray will keine Kosten sehen; die Grenze hält der Server).
export async function aiStatus(): Promise<{ configured: boolean; settings: Pick<AiSettings, 'top' | 'rest' | 'bg' | 'auto' | 'daily' | 'off'>; blocked?: string; models: typeof MODELS }> {
  const g = await gate('user');
  return { configured: aiConfigured(), settings: { top: g.settings.top, rest: g.settings.rest, bg: g.settings.bg, auto: g.settings.auto, daily: g.settings.daily, off: g.settings.off }, blocked: g.ok ? undefined : g.reason, models: MODELS };
}
