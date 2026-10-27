import { apiRoute, background } from '@/lib/api/pipeline';
import { getCase, getReport, processReport, signedUrl } from '@/lib/api/service';
import { publicReport } from '@/lib/api/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET – Status; bei "completed" mit signiertem Download-Link (5 Minuten gültig).
export const GET = apiRoute({ route: '/api/v1/cases/{id}/reports/{reportId}', scope: 'reports:read' }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  await getCase(s, ctx.params.id);
  const r = await getReport(s, ctx.params.id, ctx.params.reportId);
  // Noch wartend (z. B. nach Funktionsabbruch): erneut anstoßen.
  if (r.status === 'queued' && Date.now() - new Date(r.created_at).getTime() > 15_000) background(() => processReport(r.id));
  const link = r.status === 'completed' && r.storage_path ? await signedUrl(r.storage_path) : null;
  return { status: 200, body: publicReport(r, link?.url ?? null, link?.expires_at ?? null) };
});
