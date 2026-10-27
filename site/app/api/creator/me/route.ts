import { honeypotTripped, tooFast } from '@/lib/security/antispam-pure';
import { reportBlock } from '@/lib/security/seclog';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { completeness, creatorCanEdit, creatorCanSubmit, missingSteps, nextBestAction, STEP_ORDER } from '@/lib/creator/model';
import { SectionInput, firstIssue } from '@/lib/creator/schema';
import { ensureOwnCreator, j, maskedPayout, onboardingState, ownCreator, requireCreatorUser, type CreatorRow } from '@/lib/creator/server';
import { contactEmail } from '@/lib/creator/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Eigener Creator-Zustand. Der Datensatz wird ausschließlich über die angemeldete Nutzer-ID gefunden –
// eine Creator-ID aus der Anfrage wird nie verwendet (Creator A kann Creator B nicht adressieren).

function view(c: CreatorRow, email: string, s: Awaited<ReturnType<typeof onboardingState>>) {
  const done = completeness(s.state);
  return {
    email,
    creator: {
      status: c.status, first_name: c.first_name, last_name: c.last_name, country: c.country, phone: c.phone,
      display_name: c.display_name, company: c.company, website: c.website, bio: c.bio, categories: c.categories,
      ref_code: c.status === 'ACTIVE' ? c.ref_code : null, info_request: c.status === 'INFO_REQUESTED' ? c.info_request : null,
      submitted_at: c.submitted_at, approved_at: c.approved_at,
    },
    email_confirmed: s.state.emailConfirmed,
    socials: s.socials,
    business: s.business ? { ...(s.business as Record<string, unknown>), creator_id: undefined } : null,
    payout: maskedPayout(s.payout),
    agreement: s.agreement ? { id: s.agreement.id, version: s.agreement.version, title: s.agreement.title, body: s.agreement.body, sha256: s.agreement.body_sha256, is_draft: s.agreement.is_draft, accepted: s.agreementAccepted } : null,
    steps: Object.fromEntries(STEP_ORDER.map((k) => [k, { done: done[k], editable: creatorCanEdit(c.status, k) }])),
    missing: missingSteps(s.state),
    can_submit: creatorCanSubmit(c.status) && missingSteps(s.state).length === 0,
    next: nextBestAction(s.state, c.info_request),
    messages: s.reviews,
  };
}

export async function GET(req: Request) {
  const g = await requireCreatorUser(req, 'me', 120);
  if (!('user' in g)) return g;
  const c = await ownCreator(g.user.id);
  if (!c) {
    // Unternehmenskonten können sich nicht als Creator bewerben – die Seite zeigt das sofort statt erst beim Klick.
    const { data: b2b } = await supabaseAdmin().from('lr_b2b_members').select('user_id').eq('user_id', g.user.id).maybeSingle();
    return j({ email: await contactEmail(g.user), creator: null, b2b: Boolean(b2b) });
  }
  return j(view(c, await contactEmail(g.user), await onboardingState(c, g.user.id)));
}

// Bewerbung beginnen (legt den Creator-Datensatz an). Bot-Schutz: Honigtopf-Feld + Zeitfalle.
export async function POST(req: Request) {
  const g = await requireCreatorUser(req, 'start', 10);
  if (!('user' in g)) return g;
  const b = (await req.json().catch(() => ({}))) as { website?: unknown; ts?: unknown };
  if (honeypotTripped(b.website)) { reportBlock('honeypot', 'creator'); return j({ error: 'Bitte erneut versuchen.' }, 400); }
  if (tooFast(b.ts)) { reportBlock('too_fast', 'creator'); return j({ error: 'Bitte erneut versuchen.' }, 400); }
  const { data: b2b } = await supabaseAdmin().from('lr_b2b_members').select('user_id').eq('user_id', g.user.id).maybeSingle();
  if (b2b) return j({ error: 'Dieses Konto gehört zu einem Unternehmenszugang. Bitte mit einer eigenen E-Mail-Adresse als Creator bewerben.' }, 409);
  const c = await ensureOwnCreator(g.user);
  return j(view(c, await contactEmail(g.user), await onboardingState(c, g.user.id)), 201);
}

// Einen Abschnitt speichern (Konto, Profil, Social Media, Rechnungsdaten). Zahlungsdaten: /api/creator/payout.
export async function PATCH(req: Request) {
  const g = await requireCreatorUser(req, 'save', 40);
  if (!('user' in g)) return g;
  const c = await ownCreator(g.user.id);
  if (!c) return j({ error: 'Bitte zuerst die Bewerbung beginnen.' }, 404);
  const p = SectionInput.safeParse(await req.json().catch(() => null));
  if (!p.success) return j(firstIssue(p.error), 400);
  const { section, data } = p.data;
  if (!creatorCanEdit(c.status, section)) return j({ error: 'Deine Angaben werden gerade geprüft und können in diesem Moment nicht geändert werden.' }, 409);
  const db = supabaseAdmin();
  let error: { message: string } | null = null;
  if (section === 'account') {
    ({ error } = await db.from('lr_creators').update({ first_name: data.first_name, last_name: data.last_name, country: data.country, phone: data.phone ?? null }).eq('id', c.id));
  } else if (section === 'profile') {
    ({ error } = await db.from('lr_creators').update({ display_name: data.display_name, company: data.company ?? null, website: data.website ?? null, bio: data.bio ?? null, categories: data.categories }).eq('id', c.id));
  } else if (section === 'social') {
    // Liste vollständig ersetzen (der Creator sieht und sendet immer die ganze Liste).
    const del = await db.from('lr_creator_socials').delete().eq('creator_id', c.id);
    error = del.error;
    if (!error) ({ error } = await db.from('lr_creator_socials').insert(data.socials.map((s) => ({ ...s, creator_id: c.id }))));
  } else if (section === 'business') {
    ({ error } = await db.from('lr_creator_business').upsert({ ...data, creator_id: c.id }));
  }
  if (error) return j({ error: 'Speichern fehlgeschlagen. Bitte erneut versuchen.' }, 500);
  const fresh = (await ownCreator(g.user.id))!;
  return j(view(fresh, await contactEmail(g.user), await onboardingState(fresh, g.user.id)));
}
