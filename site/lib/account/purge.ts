// Permanently delete an account (privacy right to delete, e.g. CCPA/CPRA) – shared by "Delete account" in the account area
// and the Web-Admin. Files, logs without foreign keys and the login are removed; profile, properties, documents, shares,
// versions and an owned business account follow via CASCADE. Invoices are kept for tax record-keeping (the foreign key to
// the business account is set to NULL). Creators with billing records are detached from the login and scrubbed instead
// of deleted (see lr_creator_account_deleted).
import { DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';

async function removeFolder(bucket: string, prefix: string): Promise<void> {
  const store = supabaseAdmin().storage.from(bucket);
  for (let round = 0; round < 50; round++) {
    const { data, error } = await store.list(prefix, { limit: 1000 });
    if (error || !data?.length) return;
    const files = data.filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
    const dirs = data.filter((f) => !f.id).map((f) => `${prefix}/${f.name}`);
    for (const d of dirs) await removeFolder(bucket, d);
    if (files.length) await store.remove(files);
    if (data.length < 1000) return;
  }
}

export async function purgeUser(userId: string, b2bAccountId: string | null, email?: string | null): Promise<void> {
  const db = supabaseAdmin();
  if (b2bAccountId) {
    await removeFolder('b2b-logos', b2bAccountId);
    await removeFolder('b2b-verify', b2bAccountId);
  }
  await removeFolder(DOCUMENT_BUCKET, userId);
  await removeFolder('bank-ready-pdf', userId);
  await removeFolder('immo-exports', userId);

  // Explicitly delete logs with SET NULL and tables without foreign keys.
  await db.from('lr_data_room_access_log').delete().eq('owner_id', userId);
  await db.from('lr_access_audit').delete().eq('owner_id', userId);
  await db.from('lr_kreditmappe_credits').delete().eq('owner_id', userId);
  await db.from('lr_audit_log').delete().eq('actor_user_id', userId);
  await db.from('lr_feedback').delete().eq('user_id', userId);
  await db.from('lr_review_requests').delete().eq('user_id', userId);
  await db.from('lr_access_grants').delete().eq('user_id', userId);
  if (email) await db.from('lr_newsletter').delete().eq('email', email.toLowerCase());

  // Older lender packages (if any) have RESTRICT dependencies.
  const { data: pk } = await db.from('lr_bank_packages').select('id').eq('owner_id', userId);
  const ids = (pk ?? []).map((x) => x.id as string);
  if (ids.length) {
    await db.from('lr_bank_share_events').delete().in('package_id', ids);
    await db.from('lr_bank_share_links').delete().in('package_id', ids);
    await db.from('lr_bank_pdf_audit').delete().in('package_id', ids);
    await db.from('lr_bank_pdf_versions').delete().in('package_id', ids);
  }

  // Creator Hub: delete completely when there are no billing records; otherwise detach from the login and scrub
  // (statements and receipts must be retained and would otherwise block the cascade).
  const cr = await db.rpc('lr_creator_account_deleted', { p_user: userId });
  if (cr.error && !/lr_creator_account_deleted|does not exist|schema cache/i.test(cr.error.message)) throw new Error(cr.error.message);

  const del = await db.auth.admin.deleteUser(userId);
  if (del.error) throw new Error(del.error.message);
}
