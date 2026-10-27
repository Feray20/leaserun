import { NextResponse } from 'next/server';
import { adminScope } from '@/lib/admin/scope';
import { z } from 'zod';
import { requireAdmin, isAdminEmail } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { adminAudit } from '@/lib/b2b/core';
import { purgeUser } from '@/lib/account/purge';
import { billingEnabled, entitlementsFor } from '@/lib/billing/stripe';
import { isCreatorAuthEmail } from '@/lib/creator/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const SITE = 'https://leaserun.com';

// Web-Admin → Nutzer: Konten auflisten (ohne Inhalte), sperren/entsperren, Passwort-Reset senden, Konto löschen.
export const maxDuration = 60;
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const q = new URL(req.url).searchParams;
  const page = Math.max(1, Number(q.get('page')) || 1);
  const term = (q.get('q') || '').trim().toLowerCase().slice(0, 100);
  const seg = (['b2c', 'b2b', 'admin'] as const).find((x) => x === q.get('seg')) || 'b2c';
  // Bereichstrennung serverseitig erzwingen: B2C zeigt nur Privatkonten, B2B nur Unternehmenskonten, System nur Administratoren.
  const sc = adminScope(req);
  if (sc && seg !== (sc === 'system' ? 'admin' : sc)) return j({ error: 'Diese Konten gehören nicht zum gewählten Bereich.' }, 403);
  const db = supabaseAdmin();
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) return j({ error: 'Nutzerliste nicht verfügbar.' }, 502);
  // Unternehmens-Mitgliedschaften: wer einem Unternehmenskonto angehört, zählt zu B2B.
  const { data: mem } = await db.from('lr_b2b_members').select('user_id, role, account_id');
  const accIds = [...new Set((mem || []).map((m) => m.account_id))];
  const { data: accs } = accIds.length ? await db.from('lr_b2b_accounts').select('id, company_name, customer_number, verification_status, verified_at').in('id', accIds) : { data: [] };
  const accById = new Map((accs || []).map((a) => [a.id, a]));
  const memByUser = new Map((mem || []).map((m) => [m.user_id, m]));
  const now = Date.now();
  const users = (data.users || [])
    .filter((u) => !term || (u.email || '').toLowerCase().includes(term))
    .map((u) => ({
      id: u.id,
      email: u.email || '',
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at || null,
      confirmed: Boolean(u.email_confirmed_at),
      mfa: (u.factors || []).some((f) => f.status === 'verified'),
      banned: Boolean((u as { banned_until?: string }).banned_until && new Date((u as { banned_until?: string }).banned_until!).getTime() > now),
      admin: isAdminEmail(u.email || ''),
      company: (() => { const m = memByUser.get(u.id); const a = m ? accById.get(m.account_id) : null; return a ? { id: a.id, name: a.company_name, number: a.customer_number, role: m!.role, verified: Boolean(a.verified_at), status: a.verification_status } : null; })(),
    }))
    // Creator-Konten (eigene Kennung) werden in Creator Operations verwaltet, nicht in den Kundenlisten.
    .filter((u) => !isCreatorAuthEmail(u.email))
    .filter((u) => (seg === 'admin' ? u.admin : seg === 'b2b' ? !u.admin && Boolean(u.company) : !u.admin && !u.company));
  await adminAudit(auth.user.email, 'users_list', null, { page, seg: q.get('seg') || 'b2c', term: term ? 'gesetzt' : '' });
  return j({ users, page, seg, more: (data.users || []).length === 200 });
}

const Body = z.object({ action: z.enum(['ban', 'unban', 'reset', 'confirm', 'delete']), id: z.string().uuid(), confirmEmail: z.string().max(200).optional() });

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const { action, id } = p.data;
  const admin = supabaseAdmin().auth.admin;
  const { data: got } = await admin.getUserById(id);
  const u = got?.user;
  if (!u) return j({ error: 'Konto nicht gefunden.' }, 404);
  const email = (u.email || '').toLowerCase();
  if ((action === 'ban' || action === 'delete') && (email === auth.user.email.toLowerCase() || isAdminEmail(email))) {
    return j({ error: action === 'delete' ? 'Administratoren können hier nicht gelöscht werden.' : 'Administratoren können hier nicht gesperrt werden.' }, 409);
  }
  // Konto löschen (B2C oder B2B): endgültig, nur nach Eingabe der E-Mail-Adresse; laufende Abos zuerst kündigen.
  if (action === 'delete') {
    if ((p.data.confirmEmail || '').trim().toLowerCase() !== email) return j({ error: 'Zur Bestätigung bitte die E-Mail-Adresse des Kontos genau eingeben.' }, 400);
    const db = supabaseAdmin();
    const { data: acc } = await db.from('lr_b2b_accounts').select('id, plan_source, plan_tier, plan_until, stripe_subscription_id').eq('owner_id', id).maybeSingle();
    if (acc?.plan_source === 'stripe' && acc.plan_tier && acc.stripe_subscription_id && !acc.plan_until) {
      return j({ error: 'Das Unternehmenskonto hat ein laufendes Abo. Bitte zuerst in Stripe kündigen, dann löschen.' }, 409);
    }
    if (billingEnabled()) {
      try {
        const ent = await entitlementsFor(id, email);
        if (ent.pro && ent.proSource === 'subscription') return j({ error: 'Das Konto hat ein laufendes Investor-Pro-Abo. Bitte zuerst in Stripe kündigen, dann löschen.' }, 409);
      } catch {
        return j({ error: 'Abo-Status konnte nicht geprüft werden. Bitte später erneut versuchen.' }, 502);
      }
    }
    try {
      await purgeUser(id, acc?.id || null, email);
    } catch (e) {
      console.error('admin_user_delete', e instanceof Error ? e.message : e);
      return j({ error: 'Löschen nicht vollständig möglich.' }, 500);
    }
    await adminAudit(auth.user.email, 'user_delete', id, { bereich: acc ? 'b2b' : 'b2c' });
    return j({ ok: true });
  }
  if (action === 'ban' || action === 'unban') {
    const { error } = await admin.updateUserById(id, { ban_duration: action === 'ban' ? '876000h' : 'none' });
    if (error) return j({ error: 'Änderung fehlgeschlagen.' }, 502);
    await adminAudit(auth.user.email, action === 'ban' ? 'user_ban' : 'user_unban', id, {});
    return j({ ok: true });
  }
  if (!email) return j({ error: 'Konto hat keine E-Mail-Adresse.' }, 409);
  // Bestätigungs-E-Mail erneut senden (nur unbestätigte Konten).
  if (action === 'confirm') {
    if (u.email_confirmed_at) return j({ error: 'Dieses Konto ist bereits bestätigt.' }, 409);
    if (mailConfigured()) {
      const { data, error } = await admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${SITE}/app/dashboard` } });
      if (error || !data.properties?.hashed_token) return j({ error: 'Link konnte nicht erstellt werden.' }, 502);
      const ok = await sendMail(email, 'Bitte bestätigen Sie Ihre E-Mail-Adresse – LeaseRun',
        'Guten Tag,\n\nIhr LeaseRun-Konto ist noch nicht bestätigt. Über den Knopf bestätigen Sie Ihre E-Mail-Adresse und werden direkt angemeldet.',
        [], { title: 'E-Mail-Adresse bestätigen', button: { label: 'E-Mail-Adresse bestätigen', url: `${SITE}/auth/confirm?th=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink` }, note: 'Der Link ist nur kurze Zeit gültig und kann einmal verwendet werden.' });
      if (!ok) return j({ error: 'E-Mail konnte nicht gesendet werden.' }, 502);
    } else {
      const { error } = await supabaseAdmin().auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${SITE}/auth/login` } });
      if (error) return j({ error: 'E-Mail konnte nicht gesendet werden.' }, 502);
    }
    await adminAudit(auth.user.email, 'user_resend_confirmation', id, {});
    return j({ ok: true });
  }
  // Passwort-Reset: im LeaseRun-Design (eigener Versand) oder übergangsweise über Supabase.
  if (mailConfigured()) {
    const { data, error } = await admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${SITE}/auth/reset` } });
    if (error || !data.properties?.hashed_token) return j({ error: 'Link konnte nicht erstellt werden.' }, 502);
    const ok = await sendMail(email, 'Passwort zurücksetzen – LeaseRun',
      'Guten Tag,\n\nfür Ihr LeaseRun-Konto wurde das Zurücksetzen des Passworts angestoßen. Über den Knopf legen Sie ein neues Passwort fest.',
      [], { title: 'Neues Passwort festlegen', button: { label: 'Neues Passwort festlegen', url: `${SITE}/auth/confirm?th=${encodeURIComponent(data.properties.hashed_token)}&type=recovery` }, note: 'Wenn Sie das nicht erwartet haben, wenden Sie sich bitte an support@leaserun.com.' });
    if (!ok) return j({ error: 'E-Mail konnte nicht gesendet werden.' }, 502);
  } else {
    const { error } = await supabaseAdmin().auth.resetPasswordForEmail(email, { redirectTo: `${SITE}/auth/reset` });
    if (error) return j({ error: 'E-Mail konnte nicht gesendet werden.' }, 502);
  }
  await adminAudit(auth.user.email, 'user_reset_password', id, {});
  return j({ ok: true });
}
