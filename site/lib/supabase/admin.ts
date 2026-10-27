import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

// Serverseitiger Supabase-Zugang mit dem Secret Key. Niemals an den Browser geben.
let admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_admin_not_configured');
  if (!admin) admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export const adminConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export const DOCUMENT_BUCKET = 'immo-private';

// IP-Adresse datensparsam protokollieren: letztes Segment kürzen, dann hashen.
export function anonymizedIpHash(req: Request): string | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return null;
  const truncated = ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + '::' : ip.split('.').slice(0, 3).join('.') + '.0';
  return createHash('sha256').update(`leaserun:${truncated}`).digest('hex').slice(0, 32);
}

export type ObjectSummary = { id: string; name: string; price?: number; rent?: number; area?: number; yearBuilt?: number };

// Objekt eines Nutzers aus lr_user_data lesen (serverseitig).
export async function loadOwnerObject(ownerId: string, objectRef: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin()
    .from('lr_user_data')
    .select('objects')
    .eq('user_id', ownerId)
    .maybeSingle();
  if (error || !data) return null;
  const objects = Array.isArray(data.objects) ? (data.objects as unknown[]) : [];
  const hit = objects.find((o) => typeof o === 'object' && o !== null && (o as { id?: unknown }).id === objectRef);
  return (hit as Record<string, unknown>) ?? null;
}
