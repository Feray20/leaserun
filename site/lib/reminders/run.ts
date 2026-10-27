import { supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { deadlinesFor, dueThreshold, type ReminderObject } from '@/lib/reminders/deadlines';

const fmt = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });

// Täglicher Lauf: Nutzer mit aktivierter Erinnerung, je Objekt und Frist höchstens eine Mail je Schwelle.
export async function runReminders(origin: string, today = new Date()): Promise<{ users: number; sent: number; skipped: string | null }> {
  if (!mailConfigured()) return { users: 0, sent: 0, skipped: 'mail_not_configured' };
  const db = supabaseAdmin();
  const { data: rows, error } = await db.from('lr_user_data').select('user_id, email, objects').eq('profile->>reminders', 'true').limit(5000);
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const r of rows ?? []) {
    // Empfänger immer aus dem bestätigten Login-Konto – nie aus der vom Browser beschreibbaren Spalte lr_user_data.email.
    const { data: au } = await db.auth.admin.getUserById(String(r.user_id)).catch(() => ({ data: null }));
    const email = String(au?.user?.email_confirmed_at ? au.user.email || '' : '');
    if (!email.includes('@')) continue;
    const objects = Array.isArray(r.objects) ? (r.objects as ReminderObject[]) : [];
    const items: { objectRef: string; name: string; kind: string; due: string; threshold: number; daysLeft: number; title: string; detail: string; source: string }[] = [];
    for (const o of objects) {
      const objectRef = typeof o.id === 'string' ? o.id : '';
      if (!objectRef) continue;
      for (const d of deadlinesFor(o)) {
        const t = dueThreshold(d, today);
        if (t) items.push({ objectRef, name: typeof o.name === 'string' && o.name ? o.name : 'Objekt', kind: d.kind, due: d.due, threshold: t.threshold, daysLeft: t.daysLeft, title: d.title, detail: d.detail, source: d.source });
      }
    }
    if (!items.length) continue;
    // Bereits versendete Erinnerungen herausfiltern.
    const { data: log } = await db.from('lr_reminder_log').select('object_ref, kind, due, threshold_days').eq('owner_id', r.user_id);
    const seen = new Set((log ?? []).map((l) => `${l.object_ref}|${l.kind}|${l.due}|${l.threshold_days}`));
    const fresh = items.filter((i) => !seen.has(`${i.objectRef}|${i.kind}|${i.due}|${i.threshold}`));
    if (!fresh.length) continue;
    fresh.sort((a, b) => a.daysLeft - b.daysLeft);
    const lines = fresh.map((i) => `• ${i.name}: ${i.title} am ${fmt(i.due)} (in ${i.daysLeft} Tagen)\n  ${i.detail} Grundlage: ${i.source}.`);
    const text = [
      'Guten Tag,',
      '',
      'für Ihre Objekte bei LeaseRun stehen folgende Termine an:',
      '',
      ...lines,
      '',
      `Alle Fristen im Überblick: ${origin}/fristen`,
      `Anschlusszins durchrechnen: ${origin}/szenarien`,
      '',
      `Sie erhalten diese Nachricht, weil Sie Fristen-Erinnerungen im Konto aktiviert haben. Abschalten: ${origin}/app/dashboard → „Daten & Konto“.`,
      'Die Termine beruhen auf Ihren eigenen Angaben und sind ohne Gewähr; maßgeblich sind Ihre Verträge. Keine Rechts- oder Steuerberatung.',
      '',
      'LeaseRun · leaserun.com',
    ].join('\n');
    const subject = fresh.length === 1 ? `Erinnerung: ${fresh[0].title} (${fmt(fresh[0].due)})` : `Erinnerung: ${fresh.length} Termine für Ihre Immobilien`;
    if (await sendMail(email, subject, text)) {
      sent++;
      await db.from('lr_reminder_log').upsert(
        fresh.map((i) => ({ owner_id: r.user_id, object_ref: i.objectRef, kind: i.kind, due: i.due, threshold_days: i.threshold })),
        { onConflict: 'owner_id,object_ref,kind,due,threshold_days', ignoreDuplicates: true },
      );
    }
  }
  return { users: rows?.length ?? 0, sent, skipped: null };
}
