import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { json, requireMember } from '@/lib/b2b/http';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Berater bittet einen verbundenen Kunden um fehlende Unterlagen: Hinweis in der Kunden-App und – wenn eingerichtet – E-Mail.
// Höchstens einmal je 24 Stunden je Kunde.
const Body = z.object({ id: z.string().uuid(), note: z.string().trim().max(400).optional() });

export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-client-request', limit: 30 });
  if (ctx instanceof Response) return ctx;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Ungültig.' }, 400);
  const db = supabaseAdmin();
  const { data: row } = await db.from('lr_b2b_clients').select('id, client_user_id, client_name, status, last_request_at').eq('id', p.data.id).eq('account_id', ctx.account.id).maybeSingle();
  if (!row || row.status !== 'verbunden' || !row.client_user_id) return json({ error: 'Kunde nicht verbunden.' }, 404);
  if (row.last_request_at && Date.now() - new Date(row.last_request_at).getTime() < 24 * 3600 * 1000) return json({ error: 'Dieser Kunde wurde in den letzten 24 Stunden bereits erinnert.' }, 429);
  const { data: ud } = await db.from('lr_user_data').select('progress').eq('user_id', row.client_user_id).maybeSingle();
  const missing: string[] = Array.isArray((ud?.progress as { summary?: { missing?: unknown } } | null)?.summary?.missing) ? ((ud!.progress as { summary: { missing: string[] } }).summary.missing).slice(0, 8).map(String) : [];
  await db.from('lr_b2b_clients').update({ last_request_at: new Date().toISOString(), request_note: p.data.note || null, request_seen_at: null }).eq('id', row.id);
  let mailed = false;
  if (mailConfigured()) {
    const { data: u } = await db.auth.admin.getUserById(row.client_user_id);
    const to = u?.user?.email;
    if (to) {
      const list = missing.length ? `\n\nNoch offen:\n${missing.map((m) => `${m}: fehlt`).join('\n')}` : '';
      mailed = await sendMail(to, `${ctx.account.company_name} bittet um Ihre Unterlagen`,
        `Guten Tag${row.client_name ? ' ' + row.client_name : ''},\n\nIhr Berater bei ${ctx.account.company_name} bittet Sie, die noch fehlenden Unterlagen in LeaseRun zu ergänzen – damit Ihre Finanzierung zügig weitergehen kann.${list}${p.data.note ? `\n\nNachricht Ihres Beraters:\n${p.data.note}` : ''}`,
        [], { title: 'Fehlende Unterlagen ergänzen', button: { label: 'Unterlagen ergänzen', url: 'https://leaserun.com/app/dashboard#objekte' }, note: 'Ihre Dokumente sieht Ihr Berater nicht – nur, welche Arten noch fehlen. Die Verbindung können Sie im Konto unter „Berater-Freigaben“ trennen.' });
    }
  }
  return json({ ok: true, mailed });
}
