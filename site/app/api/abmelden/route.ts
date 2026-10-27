import { NextResponse } from 'next/server';
import { supportInbox } from '@/lib/notify/inbox';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { suppress } from '@/lib/marketing/suppression';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Abmeldelink in persönlichen Akquise-E-Mails (z. B. Presse- und Kooperationsanfragen aus Gmail).
// Jeder Empfänger hat ein eigenes, zufälliges Token (Tabelle lr_outreach_links) – keine E-Mail-Adresse in der URL.
// GET zeigt nur eine Bestätigungsseite (Link-Scanner lösen so keine Abmeldung aus), POST meldet ab:
// Werbe-Sperrliste, Akquise-Kontakt auf „Widerspruch“ (wird bei Bedarf angelegt), Verlaufseintrag und Hinweis an den Admin.
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · LeaseRun</title>
<style>:root{color-scheme:light}body{margin:0;background:#EEF2F7;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1E293B}
.c{max-width:480px;margin:40px auto;padding:0 16px}.k{background:#fff;border:1px solid #E2E8F0;border-radius:18px;padding:28px}
.l{display:flex;align-items:center;gap:10px;font-weight:800;font-size:22px;color:#0F2C59;text-decoration:none;margin-bottom:18px}.l span{color:#0284C7}
h1{font-size:22px;line-height:1.3;margin:0 0 10px;color:#0F2C59}p{margin:0 0 16px;color:#475569}
button{font:inherit;font-weight:700;border:0;border-radius:999px;background:#0F2C59;color:#fff;padding:13px 26px;cursor:pointer;width:100%}
small{display:block;margin-top:16px;color:#94A3B8;font-size:12px}</style></head>
<body><div class="c"><div class="k"><a class="l" href="https://leaserun.com"><img src="/logo-icon.svg" width="34" height="29" alt="">Immo<span>Adv</span></a>${body}</div></div></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

async function lookup(t: string) {
  if (!TOKEN.test(t) || !adminConfigured()) return null;
  const { data } = await supabaseAdmin().from('lr_outreach_links').select('token, email, label, opted_out_at').eq('token', t).maybeSingle();
  return data;
}

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get('t') || '';
  const row = await lookup(t);
  if (!row) return page('Link ungültig', '<h1>Link nicht gefunden</h1><p>Dieser Abmeldelink ist ungültig. Schreiben Sie einfach an <a href="mailto:support@leaserun.com?subject=Abmelden">support@leaserun.com</a> – wir tragen Sie sofort aus.</p>', 404);
  if (row.opted_out_at) return page('Abgemeldet', '<h1>Sie sind abgemeldet</h1><p>Sie erhalten von uns keine weiteren E-Mails dieser Art.</p>');
  const masked = row.email.replace(/^(.).*(@.*)$/, '$1•••$2');
  return page('Abmelden', `<h1>Keine weiteren E-Mails?</h1><p>Mit einem Klick tragen wir <strong>${masked.replace(/</g, '&lt;')}</strong> aus. Sie erhalten danach keine Anfragen mehr von LeaseRun.</p>
<form method="post" action="/api/abmelden?t=${encodeURIComponent(t)}"><button type="submit">Jetzt abmelden</button></form><small>Ihre Abmeldung wird gespeichert, damit wir Sie nicht erneut anschreiben (Art. 21 DSGVO).</small>`);
}

export async function POST(req: Request) {
  const t = new URL(req.url).searchParams.get('t') || '';
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'x';
  if (!allowRequest(`abmelden:${ip}`, 20, 10 * 60_000)) return page('Zu viele Anfragen', '<h1>Bitte kurz warten</h1><p>Zu viele Anfragen. Bitte versuchen Sie es in einigen Minuten erneut.</p>', 429);
  const row = await lookup(t);
  if (!row) return page('Link ungültig', '<h1>Link nicht gefunden</h1><p>Schreiben Sie an <a href="mailto:support@leaserun.com?subject=Abmelden">support@leaserun.com</a> – wir tragen Sie sofort aus.</p>', 404);
  if (!row.opted_out_at) {
    const db = supabaseAdmin();
    const now = new Date().toISOString();
    await db.from('lr_outreach_links').update({ opted_out_at: now }).eq('email', row.email).is('opted_out_at', null);
    await suppress({ email: row.email }, 'abmeldung').catch(() => null);
    // In der Akquise sichtbar machen: vorhandene Kontakte mit dieser Adresse auf „Widerspruch“, sonst neu anlegen.
    const { data: cs } = await db.from('lr_crm_contacts').select('id').ilike('email', row.email);
    let ids = (cs ?? []).map((c) => c.id as string);
    if (!ids.length) {
      const domain = row.email.split('@')[1] || row.email;
      const ins = await db.from('lr_crm_contacts').insert({ kind: 'sonstige', company: domain.slice(0, 160), email: row.email, status: 'widerspruch', source: 'Abmeldelink in E-Mail', notes: row.label || null }).select('id').single();
      if (ins.data) ids = [ins.data.id as string];
    } else {
      await db.from('lr_crm_contacts').update({ status: 'widerspruch', updated_at: now }).in('id', ids);
    }
    if (ids.length) await db.from('lr_crm_activities').insert(ids.map((id) => ({ contact_id: id, type: 'status', note: `Abgemeldet per Link${row.label ? ` (${row.label})` : ''}`.slice(0, 1000), actor: 'abmeldelink' })));
    if (mailConfigured()) for (const to of [supportInbox()]) await sendMail(to, `Abmeldung: ${row.email}`, `${row.email} hat sich über den Abmeldelink abgemeldet${row.label ? ` (${row.label})` : ''}.\n\nDer Kontakt steht im Web-Admin unter Akquise auf „Widerspruch“ und ist auf der Werbe-Sperrliste.`).catch(() => false);
  }
  return page('Abgemeldet', '<h1>Sie sind abgemeldet</h1><p>Danke für die Rückmeldung. Sie erhalten von uns keine weiteren E-Mails dieser Art.</p>');
}
