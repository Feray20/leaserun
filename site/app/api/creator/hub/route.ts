import { supabaseAdmin } from '@/lib/supabase/admin';
import { creatorLink } from '@/lib/creator/attribution-rules';
import { portalNextAction } from '@/lib/creator/model';
import { j, requireActiveCreator, SITE_ORIGIN } from '@/lib/creator/server';
import { ensureCreatorKit } from '@/lib/creator/kit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Creator Studio: sichtbare Kampagnen (inkl. persönlichem Link), Assets (nur Metadaten), Community-Vorteil, eigene Inhalte.
// Sichtbar ist nur, was aktiv ist und für alle Creator oder ausdrücklich für diesen Creator freigegeben wurde.
export async function GET(req: Request) {
  const g = await requireActiveCreator(req, 'hub', 120);
  if (!('creator' in g)) return g;
  const c = g.creator;
  await ensureCreatorKit(new URL(req.url).origin).catch(() => null);
  const db = supabaseAdmin();
  const [camps, members, assets, benefits, content] = await Promise.all([
    db.from('lr_creator_campaigns').select('id, slug, name, summary, brief, dos, donts, target_path, audience, starts_on, ends_on, created_at').eq('status', 'ACTIVE').order('created_at', { ascending: false }),
    db.from('lr_creator_campaign_members').select('campaign_id').eq('creator_id', c.id),
    db.from('lr_creator_assets').select('id, campaign_id, title, description, kind, mime, size_bytes, text_body, usage_notes, created_at').eq('active', true).order('created_at', { ascending: false }),
    db.from('lr_creator_benefits').select('code, benefit, terms, starts_at, ends_at, campaign_id').eq('creator_id', c.id).eq('active', true),
    db.from('lr_creator_content').select('id, campaign_id, platform, url, title, published_on, ad_disclosure, status, review_note, created_at').eq('creator_id', c.id).order('published_on', { ascending: false }).limit(200),
  ]);
  const mine = new Set(((members.data ?? []) as { campaign_id: string }[]).map((m) => m.campaign_id));
  type Camp = { id: string; slug: string; name: string; summary: string | null; brief: string | null; dos: string | null; donts: string | null; target_path: string; audience: string; starts_on: string | null; ends_on: string | null; created_at: string };
  const today = new Date().toISOString().slice(0, 10);
  const visible = ((camps.data ?? []) as Camp[]).filter((k) => (k.audience === 'ALL' || mine.has(k.id)) && (!k.ends_on || k.ends_on >= today));
  const visibleIds = new Set(visible.map((k) => k.id));
  type Asset = { id: string; campaign_id: string | null; title: string; description: string | null; kind: string; mime: string | null; size_bytes: number | null; text_body: string | null; usage_notes: string | null; created_at: string };
  const myAssets = ((assets.data ?? []) as Asset[]).filter((a) => !a.campaign_id || visibleIds.has(a.campaign_id));
  type Content = { id: string; campaign_id: string | null; status: string };
  const contentRows = (content.data ?? []) as (Content & Record<string, unknown>)[];
  const now = new Date();
  const validBenefits = ((benefits.data ?? []) as { code: string; benefit: string; terms: string | null; starts_at: string; ends_at: string | null; campaign_id: string | null }[])
    .filter((b) => new Date(b.starts_at) <= now && (!b.ends_at || new Date(b.ends_at) > now));
  const link = c.ref_code ? creatorLink(SITE_ORIGIN, c.ref_code) : null;
  return j({
    ref_code: c.ref_code,
    link,
    benefits: validBenefits.map((b) => ({ code: b.code, benefit: b.benefit, terms: b.terms, starts_at: b.starts_at, ends_at: b.ends_at })),
    campaigns: visible.map((k) => ({
      id: k.id, slug: k.slug, name: k.name, summary: k.summary, brief: k.brief, dos: k.dos, donts: k.donts, starts_on: k.starts_on, ends_on: k.ends_on, created_at: k.created_at,
      link: c.ref_code ? creatorLink(SITE_ORIGIN, c.ref_code, k) : null,
      assets: myAssets.filter((a) => a.campaign_id === k.id).length,
      my_content: contentRows.filter((x) => x.campaign_id === k.id).length,
    })),
    assets: myAssets.map((a) => ({ ...a, downloadable: a.kind !== 'text' })),
    content: contentRows,
    next: portalNextAction({
      contentChangesRequested: contentRows.filter((x) => x.status === 'CHANGES_REQUESTED').length,
      campaigns: visible.map((k) => ({ slug: k.slug, name: k.name, created_at: k.created_at, hasMyContent: contentRows.some((x) => x.campaign_id === k.id) })),
      now,
    }),
  });
}
