// Echte Zustandsprüfung der API-Komponenten (keine statischen Anzeigen).
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin';
import { API_BUCKET, configIssues } from '@/lib/api/config';
import { evaluateCase } from '@/lib/api/validation-engine';

export type CompStatus = 'operational' | 'degraded' | 'unavailable';
export type Component = { name: string; status: CompStatus; latency_ms: number | null; detail: string };

async function timed(name: string, fn: () => Promise<{ status: CompStatus; detail: string }>): Promise<Component> {
  const t = performance.now();
  try {
    const r = await Promise.race([fn(), new Promise<{ status: CompStatus; detail: string }>((res) => setTimeout(() => res({ status: 'unavailable', detail: 'Zeitüberschreitung (5 s)' }), 5000))]);
    return { name, ...r, latency_ms: Math.round(performance.now() - t) };
  } catch (e) {
    return { name, status: 'unavailable', latency_ms: Math.round(performance.now() - t), detail: e instanceof Error ? e.message.slice(0, 120) : 'Fehler' };
  }
}

export async function healthCheck(): Promise<{ status: CompStatus; checked_at: string; components: Component[]; config: string[] }> {
  const issues = configIssues();
  const db = adminConfigured() ? supabaseAdmin() : null;
  const components = await Promise.all([
    timed('api', async () => (issues.length ? { status: 'unavailable', detail: `Konfiguration fehlt: ${issues.join(', ')}` } : { status: 'operational', detail: 'Konfiguration vollständig' })),
    timed('database', async () => {
      if (!db) return { status: 'unavailable', detail: 'Supabase nicht konfiguriert' };
      const { error } = await db.from('api_keys').select('id', { head: true, count: 'exact' }).limit(1);
      return error ? { status: 'unavailable', detail: `Abfrage fehlgeschlagen (${error.code || 'Fehler'})` } : { status: 'operational', detail: 'Lesen erfolgreich' };
    }),
    timed('storage', async () => {
      if (!db) return { status: 'unavailable', detail: 'Supabase nicht konfiguriert' };
      const { error } = await db.storage.from(API_BUCKET).list('', { limit: 1 });
      return error ? { status: 'unavailable', detail: 'Privater Speicher nicht erreichbar' } : { status: 'operational', detail: 'Privater Bucket erreichbar' };
    }),
    timed('validation_engine', async () => {
      const r = evaluateCase({ property: { purchase_price: 300000, address: { state: 'bayern' } }, equity: { amount: 60000, available_amount: 70000 }, loan: { requested_amount: 260000 }, household: { monthly_net_income: 5000, monthly_expenses: 1500 } }, []);
      return r.checks.length > 5 ? { status: 'operational', detail: `${r.checks.length} Prüfpunkte berechnet` } : { status: 'degraded', detail: 'Unerwartetes Ergebnis' };
    }),
    timed('report_engine', async () => {
      if (!db) return { status: 'unavailable', detail: 'Supabase nicht konfiguriert' };
      const stale = new Date(Date.now() - 10 * 60_000).toISOString();
      const [{ count: waiting }, { count: failed }] = await Promise.all([
        db.from('api_reports').select('id', { head: true, count: 'exact' }).in('status', ['queued', 'processing']).lt('created_at', stale),
        db.from('api_reports').select('id', { head: true, count: 'exact' }).eq('status', 'failed').gt('created_at', new Date(Date.now() - 3600_000).toISOString()),
      ]);
      await import('@react-pdf/renderer');
      return (waiting ?? 0) > 0 || (failed ?? 0) > 2 ? { status: 'degraded', detail: `${waiting ?? 0} wartend > 10 min, ${failed ?? 0} fehlgeschlagen (1 h)` } : { status: 'operational', detail: 'PDF-Erzeugung bereit, keine Rückstände' };
    }),
    timed('webhook_dispatcher', async () => {
      if (!db) return { status: 'unavailable', detail: 'Supabase nicht konfiguriert' };
      const overdue = new Date(Date.now() - 30 * 60_000).toISOString();
      const [{ count: late }, { count: failed }] = await Promise.all([
        db.from('api_webhook_deliveries').select('id', { head: true, count: 'exact' }).in('status', ['pending', 'retrying']).lt('next_attempt_at', overdue),
        db.from('api_webhook_deliveries').select('id', { head: true, count: 'exact' }).eq('status', 'failed').gt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString()),
      ]);
      if (issues.includes('API_ENCRYPTION_KEY')) return { status: 'unavailable', detail: 'API_ENCRYPTION_KEY fehlt – keine Signatur möglich' };
      return (late ?? 0) > 0 ? { status: 'degraded', detail: `${late} Zustellungen überfällig, ${failed ?? 0} endgültig fehlgeschlagen (24 h)` } : { status: 'operational', detail: `Keine Rückstände · ${failed ?? 0} fehlgeschlagen (24 h)` };
    }),
  ]);
  const worst: CompStatus = components.some((c) => c.status === 'unavailable') ? (components.some((c) => (c.name === 'api' || c.name === 'database') && c.status === 'unavailable') ? 'unavailable' : 'degraded') : components.some((c) => c.status === 'degraded') ? 'degraded' : 'operational';
  return { status: worst, checked_at: new Date().toISOString(), components, config: issues };
}
