// Täglicher Wartungslauf der API (über /api/cron/cleanup) – zusätzlich werden Webhook-Wiederholungen bei jeder
// API-Anfrage des Mandanten und Berichte direkt nach der Anlage abgearbeitet.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processDue } from '@/lib/api/webhooks';
import { processReportQueue } from '@/lib/api/service';

export const REQUEST_LOG_RETENTION_DAYS = 90;

export async function apiMaintenance() {
  const db = supabaseAdmin();
  const day = new Date(Date.now() - 864e5).toISOString();
  const webhooks = await processDue({ limit: 100 }).catch(() => -1);
  const reports = await processReportQueue(10).catch(() => -1);
  await db.from('api_rate_counters').delete().lt('window_start', day);
  await db.from('api_idempotency_keys').delete().lt('created_at', day);
  await db.from('api_requests').delete().lt('created_at', new Date(Date.now() - REQUEST_LOG_RETENTION_DAYS * 864e5).toISOString());
  return { webhooks, reports };
}
