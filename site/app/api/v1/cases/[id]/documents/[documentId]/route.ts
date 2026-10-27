import { apiRoute } from '@/lib/api/pipeline';
import { deleteDocument, getCase, getDocument, signedUrl } from '@/lib/api/service';
import { publicDocument } from '@/lib/api/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET – metadata plus a short-lived signed download link (5 minutes).
export const GET = apiRoute({ route: '/api/v1/cases/{id}/documents/{documentId}', scope: 'documents:read' }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  await getCase(s, ctx.params.id);
  const d = await getDocument(s, ctx.params.id, ctx.params.documentId);
  const link = d.status === 'rejected' ? null : await signedUrl(d.storage_path);
  return { status: 200, body: { ...publicDocument(d), download_url: link?.url ?? null, download_expires_at: link?.expires_at ?? null } };
});

export const DELETE = apiRoute({ route: '/api/v1/cases/{id}/documents/{documentId}', scope: 'documents:write' }, async (ctx) => {
  const s = { tenantId: ctx.tenantId, env: ctx.env, actor: ctx.actor, requestId: ctx.requestId };
  await getCase(s, ctx.params.id);
  await deleteDocument(s, await getDocument(s, ctx.params.id, ctx.params.documentId));
  return new Response(null, { status: 204 });
});
