import { randomInt } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newWidgetKey, slugify } from '@/lib/b2b/core';

// Business portal logins are issued by LeaseRun (no self-registration).
// Initial password: 4 blocks of easy-to-read characters (no 0/O/1/l/I), about 95 bits. Must be changed at first sign-in.
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function genPassword(): string {
  const block = () => Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
  let pw = '';
  do { pw = [block(), block(), block(), block()].join('-'); } while (!(/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)));
  return pw;
}

export type LoginResult = { ok: true; userId: string; password: string } | { ok: false; error: string; status: number };

// Create a new login (email counts as confirmed because LeaseRun takes the address from the request).
// If the address already exists as an account, nothing is changed – please use a different address.
// Password chosen by the admin: at least 10 characters, letters and digits (like the sign-up minimum, slightly stricter).
export function adminPasswordError(pw: string | undefined | null): string | null {
  if (!pw) return null;
  if (pw.length < 10 || pw.length > 72) return 'The password must be 10 to 72 characters long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'The password needs at least one letter and one digit.';
  return null;
}

// Create a login. Without a chosen password an initial password is generated that must be changed at first sign-in.
// With a chosen password the admin decides whether it must be changed at first sign-in (mustChange).
export async function createB2BLogin(email: string, name: string, area: 'b2b' | 'app' | 'creator' = 'b2b', opts: { password?: string | null; mustChange?: boolean; meta?: Record<string, unknown> } = {}): Promise<LoginResult> {
  const own = opts.password || null;
  const bad = adminPasswordError(own);
  if (bad) return { ok: false, status: 400, error: bad };
  const password = own || genPassword();
  const mustChange = own ? opts.mustChange !== false : true;
  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { must_change_password: mustChange, area, name: name.slice(0, 120), created_by_admin: true, ...(opts.meta || {}) },
  });
  if (error || !data.user) {
    if (/already|exists|registered/i.test(error?.message || '')) return { ok: false, status: 409, error: area === 'creator' ? 'A creator account already exists for this email address.' : area === 'b2b' ? 'A business portal account already exists for this email address.' : 'A customer account already exists for this email address.' };
    if (/password/i.test(error?.message || '')) return { ok: false, status: 400, error: 'The password was rejected (too weak or found in data breaches). Please choose another one.' };
    return { ok: false, status: 502, error: 'The login could not be created.' };
  }
  return { ok: true, userId: data.user.id, password };
}

// Free partner URL from the company name.
export async function freeSlug(company: string): Promise<string> {
  const db = supabaseAdmin();
  const base = slugify(company).replace(/-(llc|inc|corp|co|ltd|lp|llp|pllc|pc|pa)$/g, '').slice(0, 34) || 'partner';
  let slug = base.length >= 3 ? base : `${base}-partner`;
  for (let i = 2; i < 50; i++) {
    const { data } = await db.from('lr_b2b_accounts').select('id').eq('slug', slug).maybeSingle();
    if (!data) break;
    slug = `${base}-${i}`;
  }
  return slug;
}

export { newWidgetKey };
