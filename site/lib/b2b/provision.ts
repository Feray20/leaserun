import { randomInt } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newWidgetKey, slugify } from '@/lib/b2b/core';

// Zugänge für das Unternehmensportal werden von LeaseRun vergeben (keine Selbstregistrierung).
// Startpasswort: 4 Blöcke aus gut lesbaren Zeichen (ohne 0/O/1/l/I), ca. 95 Bit. Muss bei der ersten Anmeldung geändert werden.
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function genPassword(): string {
  const block = () => Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
  let pw = '';
  do { pw = [block(), block(), block(), block()].join('-'); } while (!(/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)));
  return pw;
}

export type LoginResult = { ok: true; userId: string; password: string } | { ok: false; error: string; status: number };

// Neues Login anlegen (E-Mail gilt als bestätigt, da LeaseRun die Adresse aus der Anfrage übernimmt).
// Existiert die Adresse bereits als Konto, wird nichts verändert – bitte andere Adresse verwenden.
// Vom Admin gewähltes Passwort: mindestens 10 Zeichen, Buchstaben und Ziffern (wie die Mindestregel der Registrierung, etwas strenger).
export function adminPasswordError(pw: string | undefined | null): string | null {
  if (!pw) return null;
  if (pw.length < 10 || pw.length > 72) return 'Das Passwort muss 10 bis 72 Zeichen lang sein.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Das Passwort braucht mindestens einen Buchstaben und eine Ziffer.';
  return null;
}

// Zugang anlegen. Ohne eigenes Passwort wird ein Startpasswort erzeugt, das bei der ersten Anmeldung geändert werden muss.
// Mit eigenem Passwort entscheidet der Admin, ob es bei der ersten Anmeldung geändert werden muss (mustChange).
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
    if (/already|exists|registered/i.test(error?.message || '')) return { ok: false, status: 409, error: area === 'creator' ? 'Für diese E-Mail-Adresse gibt es bereits ein Creator-Konto.' : area === 'b2b' ? 'Für diese E-Mail-Adresse gibt es bereits ein Konto im Unternehmensportal.' : 'Für diese E-Mail-Adresse gibt es bereits ein Konto im Kundenbereich.' };
    if (/password/i.test(error?.message || '')) return { ok: false, status: 400, error: 'Das Passwort wurde abgelehnt (zu schwach oder bekannt aus Datenlecks). Bitte ein anderes wählen.' };
    return { ok: false, status: 502, error: 'Zugang konnte nicht angelegt werden.' };
  }
  return { ok: true, userId: data.user.id, password };
}

// Freie Partner-URL aus dem Firmennamen.
export async function freeSlug(company: string): Promise<string> {
  const db = supabaseAdmin();
  const base = slugify(company).replace(/-(gmbh|ug|ag|kg|ohg|gbr|e-k|mbh)$/g, '').slice(0, 34) || 'partner';
  let slug = base.length >= 3 ? base : `${base}-partner`;
  for (let i = 2; i < 50; i++) {
    const { data } = await db.from('lr_b2b_accounts').select('id').eq('slug', slug).maybeSingle();
    if (!data) break;
    slug = `${base}-${i}`;
  }
  return slug;
}

export { newWidgetKey };
