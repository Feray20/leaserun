import { supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { agentBriefing, AGENT_NAMES } from '@/lib/admin/hq-agents';
import { converse, gate, modelFor, LAST_RESORT, type AiResult } from '@/lib/admin/hq-ai';
import { toolsFor } from '@/lib/admin/hq-tools';
import type { AgentRun, AiNote } from '@/lib/admin/hq-store';

// Denken im Headquarters – die drei Anlässe, bei denen das Modell arbeitet.
const today = () => new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const sys = (agent: string) => `${agentBriefing(agent)}\n\nJetzt: ${today()} Uhr (Berlin).`;
const note = (r: AiResult, grund: AiNote['grund']): AiNote => ({ at: new Date().toISOString(), text: r.text.slice(0, 2500), model: r.model, usd: r.usd, grund, tools: r.toolsUsed.slice(0, 12) });

const FAILED = /^(Ich bin zu keinem Ergebnis gekommen|Die Analyse hat zu lange gedauert|Ich brauche dafür mehr Zeit)/;

export type Think = { ok: true; note: AiNote; result: AiResult } | { ok: false; reason: string };

// 1. Auftrag oder Frage von Feray an einen Agenten (oder die Zentrale).
export async function askAgent(actor: string, origin: string, agent: string, text: string, history: { me: boolean; t: string }[] = []): Promise<Think> {
  const g = await gate('user');
  if (!g.ok) return { ok: false, reason: g.reason };
  const model = modelFor(g.settings, agent);
  const msgs = [...history.slice(-8).map((m) => ({ role: (m.me ? 'user' : 'assistant') as 'user' | 'assistant', content: m.t.slice(0, 2000) })), { role: 'user' as const, content: text.slice(0, 2000) }];
  // Verlauf muss mit einer Nutzer-Nachricht beginnen und abwechseln – notfalls kürzen.
  while (msgs.length > 1 && msgs[0].role !== 'user') msgs.shift();
  let r = await converse({ agent, model, system: sys(agent), messages: msgs, tools: toolsFor({ actor, origin, agent }), grund: 'auftrag', maxTurns: 12, timeoutMs: 100_000 });
  // Letzte Stufe: Nur wenn Opus bei Ferays eigenem Auftrag zu keinem Ergebnis kam, einmal mit Fable nachfassen.
  if (model === 'claude-opus-5-5' && FAILED.test(r.text) && (await gate('user')).ok) {
    const f = await converse({ agent, model: LAST_RESORT, system: sys(agent), messages: msgs, tools: toolsFor({ actor, origin, agent }), grund: 'auftrag', maxTurns: 8, timeoutMs: 80_000 });
    r = { ...f, usd: r.usd + f.usd, calls: r.calls + f.calls };
  }
  await adminAudit(actor, 'hq_ai', null, { agent, grund: 'auftrag', model: r.model, usd: r.usd, tools: r.toolsUsed.length });
  return { ok: true, note: note(r, 'auftrag'), result: r };
}

// 2. Die Wache hat etwas Neues und Wichtiges gefunden: Ursache bestimmen, Internes erledigen, Lösung formulieren.
export async function analyseRun(actor: string, origin: string, run: AgentRun, byUser = false): Promise<Think> {
  const g = await gate(byUser ? 'user' : 'auto');
  if (!g.ok) return { ok: false, reason: g.reason };
  const model = modelFor(g.settings, run.id, !byUser);
  const issues = (run.issues || []).slice(0, 12).map((i) => `- [${i.level}${i.customer ? ', Kunden betroffen' : ''}] ${i.title}`).join('\n');
  const text = `Die Wache meldet aus deinem Bereich:\n${run.line}\n\nOffene Punkte:\n${issues || '(keine Liste)'}\n\nVorgehen: 1) Prüfe mit deinen Werkzeugen die Ursache. 2) Erledige alles Interne sofort (befund_erledigen, emails_abholen, webhook_testen …) und prüfe, ob es weg ist. 3) Was du nicht selbst erledigen kannst (Code-Änderung, Text, Einstellung): lege dafür GENAU EINE konkrete Lösung mit vorschlag_anlegen an – Feray tippt dann nur „Erledigen“, und ein Umsetzungs-Agent setzt sie im Code um. Bei Code beschreibe Datei/Seite und Änderung so genau, dass ein Entwickler sie ohne Rückfrage umsetzen kann. Nur Dinge, die ausschließlich Feray außerhalb tun kann (z. B. Einstellung im Stripe-Dashboard), als Satz mit genauem Klickweg. 4) Antworte in höchstens 4 Sätzen: Ursache · was du erledigt hast · welche Lösung bereitliegt. Keine Kosten, keine Fachbegriffe ohne Erklärung.`;
  const r = await converse({ agent: run.id, model, system: sys(run.id), messages: [{ role: 'user', content: text }], tools: toolsFor({ actor, origin, agent: run.id }), grund: 'analyse', maxTurns: byUser ? 6 : 4, maxTokens: 1500, timeoutMs: byUser ? 32_000 : 95_000 });
  await adminAudit(actor, 'hq_ai', null, { agent: run.id, grund: 'analyse', model, usd: r.usd, tools: r.toolsUsed.length });
  return { ok: true, note: note(r, 'analyse'), result: r };
}

// 3. Einmal am Tag je Abteilung: Vorschläge mit Zahl und Begründung – wie ein Abteilungsleiter im Morgen-Meeting.
const DAILY_FOCUS: Record<string, string> = {
  neukunden: 'Wie werden mehr Besucher zu Registrierungen und Käufen? Schau auf Trichter, Preisseite, Kasse, Abbrüche.',
  bestandskunden: 'Wie bleiben Kunden länger? Schau auf auslaufende Zugänge, stille Konten, Erstattungen, Tickets.',
  akquise: 'Welche Kontakte und Wiedervorlagen sind fällig, welche Anschreiben lohnen sich? Entwürfe anlegen, nichts senden.',
  marketing: 'Welche Maßnahme bringt diese Woche am meisten Reichweite oder Käufe? Mit Zahl aus Besuchern, Quellen, Newsletter.',
  optimierung: 'Welche Verbesserung an Website oder System hat den größten Nutzen? Internes gleich erledigen.',
  finanzen: 'Umsatz, offene Posten, überfällige Rechnungen: Was ist zu tun, was fällt auf?',
  vertrieb: 'Unternehmensanfragen und Partner: Was wartet, was lohnt Nachfassen?',
  recht: 'Welche rechtlichen Pflichten oder Risiken sind offen (E-Mails, Rechtstexte, Fristen, Datenschutz)? Lieber Risiko entfernen als behalten.',
  support: 'Welche Kundenprobleme wiederholen sich, welche Ursache steckt dahinter, was behebt sie dauerhaft?',
  briefing: 'Lagebild für heute: die drei wichtigsten Schritte über alle Abteilungen, mit Zusammenhängen.',
};
export async function dailyThink(actor: string, origin: string, agent: string): Promise<Think> {
  const g = await gate();
  if (!g.ok) return { ok: false, reason: g.reason };
  const model = modelFor(g.settings, agent, true);
  const focus = DAILY_FOCUS[agent] || 'Was ist in deinem Bereich heute wichtig?';
  const text = `Tagesrunde für ${AGENT_NAMES[agent] || agent}. ${focus}\n\nLies zuerst die Daten (daten_abfragen, agenten_stand und die Werkzeuge deines Bereichs). Dann: höchstens drei Vorschläge, jeder in zwei Sätzen mit Zahl und Begründung, der wichtigste zuerst. Den besten Vorschlag, wenn er konkret umsetzbar ist, mit vorschlag_anlegen hinterlegen (einmal, nicht mehr). Internes, das du direkt erledigen kannst, erledige. Keine Floskeln, keine Überschriften.`;
  const r = await converse({ agent, model, system: sys(agent), messages: [{ role: 'user', content: text }], tools: toolsFor({ actor, origin, agent }), grund: 'tag', maxTurns: 5, maxTokens: 1500, timeoutMs: 95_000 });
  await adminAudit(actor, 'hq_ai', null, { agent, grund: 'tag', model, usd: r.usd, tools: r.toolsUsed.length });
  return { ok: true, note: note(r, 'tag'), result: r };
}
export const DAILY_AGENTS = Object.keys(DAILY_FOCUS);

// ---------- Entwürfe überarbeiten (Hintergrund, in Paketen) ----------
// Feray startet mit „Jetzt erledigen“ bei Ava (oder per Auftrag). Der Denk-Lauf arbeitet je Runde ein paar Entwürfe ab:
// lesen → verbessern (bleibt Entwurf, alte Fassung gesichert) → als erledigt merken. Fortschritt steht in Avas Karte.
type Review = { active: boolean; started: string; total: number; done: string[]; changed: number; agent: string; note?: string };
const RV_KEY = 'hq_draft_review';
export async function loadReview(): Promise<Review | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', RV_KEY).maybeSingle();
  return (data?.value as Review | null) || null;
}
async function saveReview(r: Review) { await supabaseAdmin().from('lr_settings').upsert({ key: RV_KEY, value: r, updated_at: new Date().toISOString(), updated_by: 'hq' }); }
export async function startReview(agent = 'freigaben', note?: string): Promise<Review> {
  const { count } = await supabaseAdmin().from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf');
  const cur = await loadReview();
  const r: Review = cur?.active ? { ...cur, note: note || cur.note } : { active: true, started: new Date().toISOString(), total: count || 0, done: [], changed: 0, agent, note };
  await saveReview(r); return r;
}
const REVIEW_TASK = (note?: string) => `Überarbeite diesen E-Mail-Entwurf so, dass der Empfänger nichts zu beanstanden hat${note ? ` (Wunsch von Feray: ${note})` : ''}:
- korrekte, höfliche Anrede passend zum Empfänger (Redaktion/Firma/Person), keine Rechtschreib- oder Grammatikfehler, klar und knapp
- Fakten und Zahlen aus dem Entwurf beibehalten, nichts erfinden, nichts übertreiben, keine Versprechen, keine reißerischen Formulierungen
- klarer Anlass und ein konkretes, leicht zu beantwortendes Anliegen am Ende; Betreff sachlich und passend
- keine Spur von KI; Absender ist Feray Korkmaz, Head of Operations bei LeaseRun
- Text endet mit der Grußformel – Signatur, Impressum und Abmeldelink setzt das Postfach selbst an
Ist der Entwurf bereits einwandfrei, ändere nichts und antworte nur „unverändert“. Sonst rufe entwurf_verbessern genau einmal auf.`;
export async function runReviewBatch(actor: string, origin: string, deadlineMs: number): Promise<{ done: number; left: number } | null> {
  const rv = await loadReview();
  if (!rv?.active) return null;
  // Von Feray angestoßen → zählt wie ihre eigenen Aufträge (nicht vom automatischen Tageskontingent gebremst).
  const g = await gate('user');
  if (!g.ok) return { done: 0, left: -1 };
  const db = supabaseAdmin();
  const { data } = await db.from('lr_mail_messages').select('id, to_emails, subject, text_body').eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf').order('created_at', { ascending: true }).limit(300);
  const todo = (data ?? []).filter((m) => !rv.done.includes(m.id as string));
  let n = 0;
  const tools = toolsFor({ actor, origin, agent: rv.agent }).filter((t) => t.name === 'entwurf_verbessern');
  for (const m of todo) {
    if (Date.now() > deadlineMs - 25_000) break;
    const r = await converse({ agent: rv.agent, model: modelFor(g.settings, rv.agent, true), system: sys(rv.agent), tools, grund: 'tag', maxTurns: 3, maxTokens: 2500, timeoutMs: Math.min(40_000, deadlineMs - Date.now() - 5000),
      messages: [{ role: 'user', content: `${REVIEW_TASK(rv.note)}\n\nEntwurf-ID: ${m.id}\nAn: ${((m.to_emails as string[] | null) || []).join(', ')}\nBetreff: ${m.subject}\n\nText:\n${String(m.text_body || '').slice(0, 5000)}` }] }).catch(() => null);
    rv.done.push(m.id as string); n++;
    if (r?.toolsUsed.includes('entwurf_verbessern')) rv.changed++;
    await saveReview(rv);
  }
  const left = todo.length - n;
  if (left <= 0) { rv.active = false; await saveReview(rv); }
  return { done: n, left };
}
