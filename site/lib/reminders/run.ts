import { supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { deadlinesFor, dueThreshold, type ReminderObject } from '@/lib/reminders/deadlines';

const fmt = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

// Daily run: users who opted in to reminders; per property and deadline at most one email per threshold.
export async function runReminders(origin: string, today = new Date()): Promise<{ users: number; sent: number; skipped: string | null }> {
  if (!mailConfigured()) return { users: 0, sent: 0, skipped: 'mail_not_configured' };
  const db = supabaseAdmin();
  const { data: rows, error } = await db.from('lr_user_data').select('user_id, email, objects').eq('profile->>reminders', 'true').limit(5000);
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const r of rows ?? []) {
    // Recipient always comes from the confirmed login account, never from the browser-writable column lr_user_data.email.
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
        if (t) items.push({ objectRef, name: typeof o.name === 'string' && o.name ? o.name : 'Property', kind: d.kind, due: d.due, threshold: t.threshold, daysLeft: t.daysLeft, title: d.title, detail: d.detail, source: d.source });
      }
    }
    if (!items.length) continue;
    // Filter out reminders already sent.
    const { data: log } = await db.from('lr_reminder_log').select('object_ref, kind, due, threshold_days').eq('owner_id', r.user_id);
    const seen = new Set((log ?? []).map((l) => `${l.object_ref}|${l.kind}|${l.due}|${l.threshold_days}`));
    const fresh = items.filter((i) => !seen.has(`${i.objectRef}|${i.kind}|${i.due}|${i.threshold}`));
    if (!fresh.length) continue;
    fresh.sort((a, b) => a.daysLeft - b.daysLeft);
    const lines = fresh.map((i) => `• ${i.name}: ${i.title} on ${fmt(i.due)} (in ${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'})\n  ${i.detail} Source: ${i.source}.`);
    const text = [
      'Hello,',
      '',
      'These dates are coming up for your properties in LeaseRun:',
      '',
      ...lines,
      '',
      `All deadlines at a glance: ${origin}/deadlines`,
      `Run refinance and sale scenarios: ${origin}/scenarios`,
      '',
      `You are receiving this email because you turned on deadline reminders in your account. Turn them off: ${origin}/app/dashboard → "Data & account".`,
      'Dates are based on what you entered and may not be complete; your contracts and closing documents control. Not legal or tax advice.',
      '',
      'LeaseRun · leaserun.com',
    ].join('\n');
    const subject = fresh.length === 1 ? `Reminder: ${fresh[0].title} (${fmt(fresh[0].due)})` : `Reminder: ${fresh.length} upcoming dates for your properties`;
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
