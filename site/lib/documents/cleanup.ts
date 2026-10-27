import { DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Removes a user's unfinished direct uploads (folder incoming/) older than 24 hours.
export async function cleanupIncoming(userId: string, now = Date.now()): Promise<number> {
  const store = supabaseAdmin().storage.from(DOCUMENT_BUCKET);
  const { data, error } = await store.list(`${userId}/incoming`, { limit: 100 });
  if (error || !data?.length) return 0;
  const old = data
    .filter((f) => f.id && f.created_at && now - new Date(f.created_at).getTime() > MAX_AGE_MS)
    .map((f) => `${userId}/incoming/${f.name}`);
  if (!old.length) return 0;
  const rm = await store.remove(old);
  return rm.error ? 0 : old.length;
}

// Walk all user folders (for the daily cron run).
export async function cleanupAllIncoming(): Promise<{ users: number; removed: number }> {
  const store = supabaseAdmin().storage.from(DOCUMENT_BUCKET);
  let offset = 0, users = 0, removed = 0;
  for (;;) {
    const { data, error } = await store.list('', { limit: 500, offset });
    if (error || !data?.length) break;
    for (const d of data) {
      if (d.id) continue; // file, not a folder
      users++;
      removed += await cleanupIncoming(d.name);
    }
    if (data.length < 500) break;
    offset += 500;
  }
  return { users, removed };
}
