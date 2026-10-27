import { supabaseAdmin } from '@/lib/supabase/admin';

// Zustellstatus für gesendete E-Mails einmalig in Resend einschalten: Der bestehende Eingangs-Webhook
// (…/api/mail/inbound) bekommt zusätzlich die Ereignisse „zugestellt“, „nicht zustellbar“ und „als Spam gemeldet“.
// Bewusst KEIN Öffnungs-Tracking (Zählpixel): Das wäre ohne Einwilligung der Empfänger nach DSGVO/§ 25 TDDDG heikel.
// Läuft höchstens einmal erfolgreich; Fehler werden gemerkt und beim nächsten Aufruf (frühestens nach 6 Stunden) wiederholt.
const KEY = 'mail_delivery_setup';
const WANT = ['email.received', 'email.delivered', 'email.bounced', 'email.complained'];
let running: Promise<void> | null = null;

type Hook = { id: string; endpoint?: string; events?: string[] | null; status?: string };

export function ensureDeliveryTracking(): Promise<void> {
  running ||= run().catch((e) => console.warn('mail_delivery_setup', e instanceof Error ? e.message : e)).finally(() => { running = null; });
  return running;
}

async function run(): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const db = supabaseAdmin();
  const { data } = await db.from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  const prev = (data?.value || {}) as { ok?: boolean; at?: string };
  if (prev.ok) return;
  if (prev.at && Date.now() - new Date(prev.at).getTime() < 6 * 3600_000) return;
  const save = (value: Record<string, unknown>) => db.from('lr_settings').upsert({ key: KEY, value: { ...value, at: new Date().toISOString() }, updated_by: 'system:mail' });
  const H = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const r = await fetch('https://api.resend.com/webhooks', { headers: H });
  if (!r.ok) { await save({ ok: false, error: `Webhooks lesen: HTTP ${r.status}` }); return; }
  const list = ((await r.json().catch(() => ({}))) as { data?: Hook[] }).data || [];
  const hook = list.find((h) => /\/api\/mail\/inbound\b/.test(h.endpoint || ''));
  if (!hook) { await save({ ok: false, error: 'Kein Webhook auf /api/mail/inbound gefunden.' }); return; }
  let events = hook.events || null;
  if (!events) {
    const g = await fetch(`https://api.resend.com/webhooks/${hook.id}`, { headers: H });
    events = g.ok ? (((await g.json().catch(() => ({}))) as Hook).events || []) : [];
  }
  const merged = [...new Set([...(events || []), ...WANT])];
  if (merged.length === (events || []).length) { await save({ ok: true, webhook: hook.id, events: merged, note: 'bereits aktiv' }); return; }
  const u = await fetch(`https://api.resend.com/webhooks/${hook.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ events: merged }) });
  if (!u.ok) { await save({ ok: false, error: `Webhook ändern: HTTP ${u.status} ${(await u.text().catch(() => '')).slice(0, 200)}` }); return; }
  await save({ ok: true, webhook: hook.id, events: merged });
  console.info('mail_delivery_setup_ok', { webhook: hook.id, events: merged });
}
