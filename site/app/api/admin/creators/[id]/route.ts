import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendMail } from '@/lib/notify/mail';
import { actionNeedsMessage, adminTransition, allowedAdminActions, completeness, missingSteps, type AdminAction } from '@/lib/creator/model';
import { can } from '@/lib/creator/roles';
import { AdminActionInput, firstIssue } from '@/lib/creator/schema';
import { audit, j, maskedPayout, uniqueRefCode, onboardingState, requireCreatorAdmin, UUID_RE, type AuditEvent, type CreatorRow } from '@/lib/creator/server';
import { contactEmail } from '@/lib/creator/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Creator 360 (Phase 1: Profil, Social, Bewerbung, Business, Vereinbarung, Zahlungsdaten maskiert, Prüfverlauf, Audit)
// und Admin-Entscheidungen. Abschnitte ohne Rollenrecht fehlen in der Antwort vollständig.

async function load(id: string) {
  const { data } = await supabaseAdmin().from('lr_creators').select('*').eq('id', id).maybeSingle();
  return (data as CreatorRow) ?? null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return j({ error: 'Nicht gefunden.' }, 404);
  const a = await requireCreatorAdmin(req, 'creators.list', id);
  if (!('role' in a)) return a;
  const c = await load(id);
  if (!c) return j({ error: 'Nicht gefunden.' }, 404);
  const db = supabaseAdmin();
  const s = await onboardingState(c, c.user_id);
  const [reviews, acceptances, auditRows, user, benefits, memberships, content, statements] = await Promise.all([
    db.from('lr_creator_reviews').select('action, message, visible_to_creator, actor_ref, created_at').eq('creator_id', id).order('created_at', { ascending: false }).limit(50),
    db.from('lr_creator_agreement_acceptances').select('accepted_at, body_sha256, lr_creator_agreements(version, title, is_draft)').eq('creator_id', id).order('accepted_at', { ascending: false }),
    can(a.role, 'audit.read') ? db.from('lr_creator_audit').select('event_type, actor_kind, actor_ref, actor_role, result, meta, created_at').eq('creator_id', id).order('created_at', { ascending: false }).limit(100) : null,
    can(a.role, 'creators.contact') && c.user_id ? db.auth.admin.getUserById(c.user_id) : null,
    db.from('lr_creator_benefits').select('id, code, benefit, terms, starts_at, ends_at, active, campaign_id').eq('creator_id', id).order('created_at', { ascending: false }),
    db.from('lr_creator_campaign_members').select('campaign_id, lr_creator_campaigns(name, slug, status)').eq('creator_id', id),
    db.from('lr_creator_content').select('id, platform, url, title, published_on, status, review_note, campaign_id').eq('creator_id', id).order('published_on', { ascending: false }).limit(50),
    can(a.role, 'billing.read') ? db.from('lr_creator_statements').select('id, period, status, conversions, commission_cents, adjustments_cents, payout_cents, lr_creator_documents(id, doc_type, number), lr_creator_payouts(status, paid_at)').eq('creator_id', id).order('period', { ascending: false }).limit(24) : null,
  ]);
  const done = completeness(s.state);
  return j({
    me: { role: a.role },
    creator: {
      id: c.id, status: c.status, display_name: c.display_name, company: c.company, website: c.website, bio: c.bio, categories: c.categories,
      country: c.country, ref_code: c.ref_code, info_request: c.info_request,
      submitted_at: c.submitted_at, reviewed_at: c.reviewed_at, approved_at: c.approved_at, created_at: c.created_at,
      ...(can(a.role, 'creators.contact') ? { first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: user?.data?.user ? (await contactEmail(user.data.user)) || null : null, email_confirmed: s.state.emailConfirmed } : {}),
    },
    socials: s.socials,
    business: can(a.role, 'creators.business') ? s.business : undefined,
    payout: can(a.role, 'bank.masked') ? maskedPayout(s.payout) : undefined,
    agreement: { current: s.agreement ? { version: s.agreement.version, is_draft: s.agreement.is_draft } : null, accepted_current: s.agreementAccepted, history: acceptances.data ?? [] },
    completeness: done,
    missing: missingSteps(s.state),
    actions: allowedAdminActions(c.status).filter((x) => can(a.role, x === 'SUSPEND' || x === 'REACTIVATE' ? 'creators.suspend' : 'creators.review')),
    can: { reveal: can(a.role, 'bank.reveal'), verify: can(a.role, 'bank.verify'), campaigns: can(a.role, 'campaigns.manage'), conversions: can(a.role, 'conversions.read'), reverse: can(a.role, 'conversions.manage'), content: can(a.role, 'content.review'), delete: can(a.role, 'creators.suspend') && Boolean(c.user_id) },
    link: c.ref_code ? `https://leaserun.com/?ref=${c.ref_code}` : null,
    billing: can(a.role, 'billing.read') ? { mode: (c as unknown as { billing_mode?: string }).billing_mode ?? 'INVOICE', manage: can(a.role, 'billing.manage'), statements: statements?.data ?? [] } : undefined,
    benefits: benefits.data ?? [],
    memberships: memberships.data ?? [],
    content: content.data ?? [],
    reviews: reviews.data ?? [],
    audit: auditRows ? auditRows.data ?? [] : undefined,
  });
}

const EVENT: Record<AdminAction, AuditEvent> = {
  START_REVIEW: 'REVIEW_STARTED', APPROVE: 'CREATOR_APPROVED', REQUEST_INFO: 'CREATOR_INFO_REQUESTED',
  REJECT: 'CREATOR_REJECTED', SUSPEND: 'CREATOR_SUSPENDED', REACTIVATE: 'CREATOR_REACTIVATED',
};

const MAIL: Partial<Record<AdminAction, (m: string | null) => { subject: string; text: string; title: string }>> = {
  APPROVE: () => ({ subject: 'Willkommen als LeaseRun Creator Partner', title: 'Du bist freigeschaltet', text: 'deine Bewerbung als LeaseRun Creator Partner wurde freigegeben. Dein Creator-Portal ist ab sofort aktiv:\n\nhttps://leaserun.com/creators' }),
  REQUEST_INFO: (m) => ({ subject: 'LeaseRun benötigt noch eine Information von dir', title: 'Angabe ergänzen', text: `für deine Creator-Bewerbung benötigen wir noch eine Information:\n\n${m}\n\nBitte ergänze die Angabe im Creator-Bereich und reiche die Bewerbung erneut ein:\n\nhttps://leaserun.com/creators` }),
  REJECT: (m) => ({ subject: 'Deine Bewerbung als LeaseRun Creator', title: 'Bewerbung nicht freigegeben', text: `vielen Dank für dein Interesse. Wir können deine Bewerbung als Creator Partner derzeit leider nicht freigeben.\n\n${m}` }),
  SUSPEND: (m) => ({ subject: 'Dein LeaseRun Creator-Zugang wurde pausiert', title: 'Zugang pausiert', text: `dein Creator-Zugang wurde vorübergehend pausiert.\n\n${m}\n\nBei Fragen: support@leaserun.com` }),
  REACTIVATE: () => ({ subject: 'Dein LeaseRun Creator-Zugang ist wieder aktiv', title: 'Zugang wieder aktiv', text: 'dein Creator-Zugang ist wieder aktiv:\n\nhttps://leaserun.com/creators' }),
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return j({ error: 'Nicht gefunden.' }, 404);
  const p = AdminActionInput.safeParse(await req.json().catch(() => null));
  if (!p.success) return j(firstIssue(p.error), 400);
  const { action, message } = p.data;
  const a = await requireCreatorAdmin(req, action === 'SUSPEND' || action === 'REACTIVATE' ? 'creators.suspend' : 'creators.review', id);
  if (!('role' in a)) return a;
  if (actionNeedsMessage(action) && !message) return j({ error: 'Bitte eine Nachricht an den Creator angeben.', field: 'message' }, 400);

  const c = await load(id);
  if (!c) return j({ error: 'Nicht gefunden.' }, 404);
  if (!c.user_id) return j({ error: 'Das Konto dieses Creators wurde gelöscht; die Abrechnungsdaten werden nur noch aufbewahrt.' }, 409);
  const to = adminTransition(c.status, action);
  if (!to) return j({ error: 'Diese Aktion ist im aktuellen Status nicht möglich.' }, 409);

  // Freigabe nur bei vollständiger Bewerbung (serverseitige Gegenprüfung).
  if (action === 'APPROVE') {
    const s = await onboardingState(c, c.user_id);
    const miss = missingSteps(s.state);
    if (miss.length) return j({ error: 'Die Bewerbung ist unvollständig und kann nicht freigegeben werden.', missing: miss }, 409);
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, reviewed_at: now };
  if (action === 'APPROVE') { patch.approved_at = now; if (!c.ref_code) patch.ref_code = await uniqueRefCode(); }
  if (action === 'REQUEST_INFO') patch.info_request = message;
  if (action === 'APPROVE' || action === 'REJECT') patch.info_request = null;

  const db = supabaseAdmin();
  // Optimistische Sperre: zwei Admins können nicht gleichzeitig widersprüchlich entscheiden.
  const { data, error } = await db.from('lr_creators').update(patch).eq('id', id).eq('status', c.status).select('id');
  if (error || !data?.length) {
    await audit(EVENT[action], id, a.actor, 'FAILED', { from: c.status, to });
    return j({ error: 'Der Status wurde inzwischen geändert. Bitte neu laden.' }, 409);
  }
  await db.from('lr_creator_reviews').insert({ creator_id: id, action, message, visible_to_creator: actionNeedsMessage(action), actor_ref: a.actor.ref });
  await audit(EVENT[action], id, a.actor, 'SUCCESS', { from: c.status, to });

  const mail = MAIL[action]?.(message);
  if (mail && c.user_id) {
    const { data: u } = await db.auth.admin.getUserById(c.user_id);
    if (u?.user?.email) await sendMail(await contactEmail(u.user), mail.subject, `Hallo ${c.first_name || ''},\n\n${mail.text}`, [], { title: mail.title }).catch(() => false);
  }
  return j({ ok: true, status: to });
}
