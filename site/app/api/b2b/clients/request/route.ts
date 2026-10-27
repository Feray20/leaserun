import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { json, requireMember } from '@/lib/b2b/http';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Advisor asks a connected client for missing documents: notice in the client app and – if configured – email.
// At most once per 24 hours per client.
const Body = z.object({ id: z.string().uuid(), note: z.string().trim().max(400).optional() });

export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-client-request', limit: 30 });
  if (ctx instanceof Response) return ctx;
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Invalid request.' }, 400);
  const db = supabaseAdmin();
  const { data: row } = await db.from('lr_b2b_clients').select('id, client_user_id, client_name, status, last_request_at').eq('id', p.data.id).eq('account_id', ctx.account.id).maybeSingle();
  if (!row || row.status !== 'verbunden' || !row.client_user_id) return json({ error: 'Client is not connected.' }, 404);
  if (row.last_request_at && Date.now() - new Date(row.last_request_at).getTime() < 24 * 3600 * 1000) return json({ error: 'This client was already reminded in the last 24 hours.' }, 429);
  const { data: ud } = await db.from('lr_user_data').select('progress').eq('user_id', row.client_user_id).maybeSingle();
  const missing: string[] = Array.isArray((ud?.progress as { summary?: { missing?: unknown } } | null)?.summary?.missing) ? ((ud!.progress as { summary: { missing: string[] } }).summary.missing).slice(0, 8).map(String) : [];
  await db.from('lr_b2b_clients').update({ last_request_at: new Date().toISOString(), request_note: p.data.note || null, request_seen_at: null }).eq('id', row.id);
  let mailed = false;
  if (mailConfigured()) {
    const { data: u } = await db.auth.admin.getUserById(row.client_user_id);
    const to = u?.user?.email;
    if (to) {
      const list = missing.length ? `\n\nStill missing:\n${missing.map((m) => `- ${m}`).join('\n')}` : '';
      mailed = await sendMail(to, `${ctx.account.company_name} is asking for your documents`,
        `Hi${row.client_name ? ' ' + row.client_name : ''},\n\nYour advisor at ${ctx.account.company_name} asks you to add the missing documents in LeaseRun – so your financing can move forward quickly.${list}${p.data.note ? `\n\nMessage from your advisor:\n${p.data.note}` : ''}`,
        [], { title: 'Add missing documents', button: { label: 'Add documents', url: 'https://leaserun.com/app/dashboard#objekte' }, note: 'Your advisor cannot see your documents – only which types are still missing. You can disconnect at any time in your account under "Advisor access".' });
    }
  }
  return json({ ok: true, mailed });
}
