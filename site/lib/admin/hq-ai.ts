import { supabaseAdmin } from '@/lib/supabase/admin';

// LeaseRun Intelligence · model layer. Connects the Headquarters agents to Claude (Anthropic API).
// Principles (owner's decision):
//  - The watch (every few minutes) runs without a model and costs nothing. The model is only called when
//    1. the owner writes to an agent or asks the command center, 2. the watch finds something new and important
//    (analysis + solution), 3. once a day per department (proposals).
//  - Every request is counted and priced in dollars. Daily caps (calls and dollars) are hard: above them the model
//    doesn't answer and the agents keep working rule-based. The limit in the Anthropic account applies as well.
//  - Without ANTHROPIC_API_KEY everything works as before – no error, just a note in Setup.
//  - Keys stay on the server. Nothing goes out without approval: the model can only create drafts and proposals,
//    never send or publish.

export type ModelId = 'claude-fable-5-1' | 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export const MODELS: { id: ModelId; label: string; note: string }[] = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Default · fast and affordable' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'very strong · for command center and daily briefing' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'very fast · for simple background work' },
];
// Fable 5.1 is the most expensive tier and deliberately NOT selectable (owner's rule, 10/27/2026): it is only called as the
// very last step when Opus reached no result on one of the owner's own tasks (see askAgent).
export const LAST_RESORT: ModelId = 'claude-fable-5-1';
const notFable = (m: ModelId, def: ModelId): ModelId => (m === LAST_RESORT ? def : m);
// Prices in USD per 1M tokens (as of October 2026; Haiku 5.5 estimated): input, output, cache read, cache write.
const PRICE: Record<ModelId, [number, number, number, number]> = {
  'claude-fable-5-1': [10, 50, 0.25, 12.5], 'claude-opus-5-5': [4, 20, 0.2, 5], 'claude-sonnet-5-5': [2, 10, 0.2, 2.5], 'claude-haiku-5-5': [1, 5, 0.1, 1.25],
};
export const isModel = (m: string): m is ModelId => m in PRICE;

export type AiSettings = { top: ModelId; rest: ModelId; bg: ModelId; dailyUsd: number; dailyCalls: number; auto: boolean; daily: boolean; off: boolean };
// Economical (order Sonnet → Opus → Fable): command center/daily briefing with Opus, all other departments, implementations
// and background work (watch, daily round, drafts) with Sonnet. Fable never as a default.
export const DEFAULT_AI: AiSettings = { top: 'claude-opus-5-5', rest: 'claude-sonnet-5-5', bg: 'claude-sonnet-5-5', dailyUsd: 1, dailyCalls: 80, auto: true, daily: true, off: true };
// off = true: AI (Anthropic API) turned off (owner's wish, 10/27/2026 – too expensive). The agents then work rule-based:
// watch, checks, findings, fixer and approvals keep running, just without Claude calls and without cost.
// Command center and daily briefing think with the top tier; all other departments with the second.
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

// May the model work now? Returns the reason if not (for an honest display in Headquarters).
export type Gate = { ok: true; settings: AiSettings; usage: Usage } | { ok: false; reason: string; settings: AiSettings; usage: Usage };
// Cost brake: at most $50 per month (owner's rule, 10/27/2026). $20 of it is reserved for her own tasks and
// implementations – automatic work can never use it up. Automatic work (watch, daily round) gets a daily budget
// from what is left in the month (spread evenly, savings from quiet days usable).
// The owner's own tasks and "Do it now" always run as long as the month isn't used up.
export const MONTH_CAP_USD = 50;
export const USER_RESERVE_USD = 20;
// An implementation run (GitHub, Opus) costs up to about $5 – only start it if it safely fits the monthly budget.
const UMSETZUNG_MIN_LEFT_USD = 5;
const daysLeftInMonth = () => { const t = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' })); return new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() - t.getDate() + 1; };
export async function gate(kind: 'auto' | 'user' | 'umsetzung' = 'auto'): Promise<Gate> {
  const [settings, usage] = await Promise.all([loadAiSettings(), loadUsage()]);
  if (settings.off) return { ok: false, reason: 'AI is turned off (costs nothing) – the agents work rule-based: checks, watch and approvals keep running. Code changes are handled by Claude in chat.', settings, usage };
  if (!aiConfigured()) return { ok: false, reason: 'Claude is not connected yet (ANTHROPIC_API_KEY missing – see Setup).', settings, usage };
  const left = MONTH_CAP_USD - usage.monthUsd;
  if (left <= 0.3) return { ok: false, reason: 'The monthly budget ($50) is used up. From the 1st the agents work with Claude again; until then rule-based.', settings, usage };
  if (kind === 'umsetzung' && left < UMSETZUNG_MIN_LEFT_USD) return { ok: false, reason: `The monthly budget is no longer enough for an implementation ($${left.toFixed(2)} of $50 left). It continues on the 1st.`, settings, usage };
  if (kind === 'auto') {
    const autoLeft = left - USER_RESERVE_USD;
    if (autoLeft <= 0.3) return { ok: false, reason: 'The budget for automatic work is used up for this month – your own tasks keep running.', settings, usage };
    const today = Math.min(autoLeft, settings.dailyUsd, Math.max(0.5, ((autoLeft + usage.usd) / daysLeftInMonth()) * 1.5));
    if (usage.usd >= today || usage.calls >= 300) return { ok: false, reason: "Today's automatic quota is used up – your own tasks keep running.", settings, usage };
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

// Book the cost of an external run (implementation agent on GitHub) to the monthly budget.
export async function bookUsd(agent: string, usd: number, grund: string): Promise<void> {
  try {
    const usage = await loadUsage(), v = Math.max(0, Math.min(50, Number(usd) || 0));
    usage.calls++; usage.usd = Math.round((usage.usd + v) * 1e5) / 1e5; usage.monthCalls++; usage.monthUsd = Math.round((usage.monthUsd + v) * 1e5) / 1e5;
    usage.log = [{ at: new Date().toISOString(), agent, model: 'umsetzung', usd: v, ms: 0, grund }, ...usage.log].slice(0, 30);
    await supabaseAdmin().from('lr_settings').upsert({ key: USE_KEY, value: usage, updated_at: new Date().toISOString(), updated_by: 'hq' });
  } catch (e) { console.warn('hq_ai_book_usd', e instanceof Error ? e.message : e); }
}

// ---------- Call with tools (agentic loop) ----------
export type Tool = { name: string; description: string; input_schema: Record<string, unknown>; run: (input: Record<string, unknown>) => Promise<unknown> };
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
export type AiResult = { text: string; model: ModelId; usd: number; ms: number; calls: number; toolsUsed: string[]; toolLog: { name: string; ok: boolean; summary: string }[] };

const API = 'https://api.anthropic.com/v1/messages';
const short = (v: unknown, max = 8000): string => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > max ? `${s.slice(0, max)} … [truncated]` : s; };

// One conversation with the model: system briefing (cached), history, tools. At most `maxTurns` rounds so a call
// never gets out of hand. Every round is billed.
export async function converse(o: { agent: string; model: ModelId; system: string; messages: Msg[]; tools: Tool[]; grund: string; maxTurns?: number; maxTokens?: number; timeoutMs?: number }): Promise<AiResult> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const t0 = Date.now(), maxTurns = o.maxTurns ?? 6, deadline = t0 + (o.timeoutMs ?? 40_000);
  const msgs: Msg[] = [...o.messages];
  const toolDefs = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  let usd = 0, calls = 0, text = '';
  const toolsUsed: string[] = [], toolLog: AiResult['toolLog'] = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    const left = deadline - Date.now();
    if (left < 4000) { text ||= 'The analysis took too long – I stopped before it got expensive.'; break; }
    const body = {
      model: o.model, max_tokens: o.maxTokens ?? 3500,
      system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
      messages: msgs, ...(toolDefs.length ? { tools: toolDefs } : {}),
    };
    let res: Response;
    try { res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(left - 1500, 60_000)) }); }
    catch (e) { if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') { text ||= 'I need more time than this run had – I will continue in the next run.'; break; } throw e; }
    const data = (await res.json().catch(() => null)) as { content?: Block[]; stop_reason?: string; usage?: Record<string, number>; error?: { message?: string; type?: string } } | null;
    calls++;
    if (!res.ok || !data?.content) {
      const m = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error('The Anthropic key is rejected (401). Check ANTHROPIC_API_KEY in Vercel.');
      if (res.status === 429) throw new Error('Anthropic is throttling right now (too many requests or account limit reached).');
      if (res.status === 400 && /credit|balance|billing/i.test(m)) throw new Error('The Anthropic account has no credit left – add credit at console.anthropic.com → Billing.');
      throw new Error(`Model not reachable: ${m}`);
    }
    const u = data.usage || {};
    usd += costOf(o.model, u);
    await book(o.agent, o.model, u, Date.now() - t0, o.grund);
    msgs.push({ role: 'assistant', content: data.content });
    const uses = data.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    text = data.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim() || text;
    // Cut off (too long): discard the incomplete part and ask for a shorter version.
    if (data.stop_reason === 'max_tokens') { msgs.pop(); msgs.push({ role: 'user', content: 'Your last answer was too long and got cut off. Be shorter (documents at most one page) and continue.' }); text = ''; continue; }
    if (data.stop_reason !== 'tool_use' || !uses.length) break;
    const results: Block[] = [];
    for (const use of uses) {
      const tool = o.tools.find((t) => t.name === use.name);
      toolsUsed.push(use.name);
      if (!tool) { results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Unknown tool.', is_error: true }); continue; }
      try {
        const r = await Promise.race([tool.run(use.input || {}), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Tool is taking too long')), 20_000))]);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: short(r) });
        toolLog.push({ name: use.name, ok: true, summary: short(r, 160) });
      } catch (e) {
        const m = (e as Error).message || 'Error';
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `Error: ${m}`, is_error: true });
        toolLog.push({ name: use.name, ok: false, summary: m.slice(0, 160) });
      }
    }
    msgs.push({ role: 'user', content: results });
  }
  // All rounds used for lookups and still no text: a final round without tools forces the summary.
  if (!text && Date.now() < deadline - 3000) {
    if (msgs[msgs.length - 1]?.role === 'assistant') msgs.pop();
    if (msgs[msgs.length - 1]?.role !== 'user') msgs.push({ role: 'user', content: 'Continue.' });
    try {
      const last = msgs[msgs.length - 1]; const extra = { type: 'text' as const, text: 'No more tools now. Summarize for the owner in at most 5 sentences what you found out and did and what she needs to do.' };
      const body = { model: o.model, max_tokens: 700, system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }], messages: [...msgs.slice(0, -1), { ...last, content: [...(Array.isArray(last.content) ? last.content : [{ type: 'text' as const, text: last.content }]), extra] }], ...(toolDefs.length ? { tools: toolDefs, tool_choice: { type: 'none' } } : {}) };
      const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(3000, deadline - Date.now())) });
      const data = (await res.json().catch(() => null)) as { content?: Block[]; usage?: Record<string, number> } | null;
      if (res.ok && data?.content) { calls++; usd += costOf(o.model, data.usage || {}); await book(o.agent, o.model, data.usage || {}, Date.now() - t0, o.grund); text = data.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim(); }
    } catch { /* stays without text */ }
  }
  return { text: text || "I didn't reach a result – please tap \"Analyze again\".", model: o.model, usd: Math.round(usd * 1e5) / 1e5, ms: Date.now() - t0, calls, toolsUsed, toolLog };
}

// Status for Headquarters – deliberately without amounts (the owner doesn't want to see costs; the server enforces the cap).
export async function aiStatus(): Promise<{ configured: boolean; settings: Pick<AiSettings, 'top' | 'rest' | 'bg' | 'auto' | 'daily' | 'off'>; blocked?: string; models: typeof MODELS }> {
  const g = await gate('user');
  return { configured: aiConfigured(), settings: { top: g.settings.top, rest: g.settings.rest, bg: g.settings.bg, auto: g.settings.auto, daily: g.settings.daily, off: g.settings.off }, blocked: g.ok ? undefined : g.reason, models: MODELS };
}
