import { z } from 'zod';
import { CATEGORIES, FOLLOWER_RANGES, PLATFORMS } from '@/lib/creator/model';

// Eingaben des Creator-Onboardings. Server prüft alles erneut – Browser-Prüfungen sind nur Komfort.
const txt = (min: number, max: number) => z.string().trim().min(min).max(max);
const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const https = (max: number) => z.string().trim().max(max).transform((v) => (v && !/^[a-z]+:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => { try { const u = new URL(v); return u.protocol === 'https:' && Boolean(u.hostname.includes('.')) && !u.username && !u.password; } catch { return false; } }, 'Bitte eine gültige https-Adresse angeben.');
const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Bitte ein Land wählen.');

export const AccountInput = z.object({
  first_name: txt(1, 80),
  last_name: txt(1, 80),
  country,
  phone: z.string().trim().max(40).regex(/^[+0-9 ()/-]*$/, 'Bitte nur Ziffern, Leerzeichen und + verwenden.').optional().nullable().transform((v) => (v ? v : null)),
});

export const ProfileInput = z.object({
  display_name: txt(2, 80),
  company: opt(120),
  website: https(200).optional().nullable().or(z.literal('').transform(() => null)),
  bio: opt(600),
  categories: z.array(z.enum(CATEGORIES)).min(1, 'Bitte mindestens eine Kategorie wählen.').max(CATEGORIES.length).transform((a) => [...new Set(a)]),
});

export const SocialItem = z.object({
  platform: z.enum(PLATFORMS),
  platform_label: opt(40),
  channel_name: opt(100),
  handle: z.string().trim().max(100).optional().nullable().transform((v) => (v ? v : null)),
  url: https(300),
  follower_range: z.enum(FOLLOWER_RANGES).optional().nullable().transform((v) => v ?? null),
}).refine((s) => s.platform !== 'other' || Boolean(s.platform_label), { message: 'Bitte die Plattform benennen.', path: ['platform_label'] });

export const SocialInput = z.object({ socials: z.array(SocialItem).min(1, 'Bitte mindestens ein öffentliches Profil angeben.').max(12) });

export const BusinessInput = z.object({
  entity_type: z.enum(['individual', 'company']),
  legal_name: txt(2, 160),
  legal_form: opt(60),
  street: txt(3, 160),
  postal_code: txt(3, 12),
  city: txt(2, 80),
  country,
  tax_number: opt(30),
  vat_id: z.preprocess((v) => (typeof v === 'string' ? v.toUpperCase().replace(/\s/g, '') : v), z.string().max(15).optional().nullable())
    .transform((v) => (v ? v : null)).refine((v) => v === null || /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v), 'Bitte eine gültige USt-IdNr. angeben (z. B. DE123456789).'),
  vat_status: z.enum(['small_business', 'vat_registered', 'not_applicable']),
  billing_email: z.string().trim().toLowerCase().max(200).email('Bitte eine gültige E-Mail-Adresse angeben.'),
}).refine((b) => b.vat_status !== 'vat_registered' || Boolean(b.vat_id || b.tax_number), { message: 'Bei Umsatzsteuerpflicht bitte USt-IdNr. oder Steuernummer angeben.', path: ['vat_id'] });

export const PayoutInput = z.object({
  holder_name: txt(2, 140),
  iban: z.string().max(64),
  bic: z.string().max(20).optional().nullable(),
  confirmed: z.literal(true, { errorMap: () => ({ message: 'Bitte bestätige, dass die Zahlungsdaten korrekt sind.' }) }),
});

export const SectionInput = z.discriminatedUnion('section', [
  z.object({ section: z.literal('account'), data: AccountInput }),
  z.object({ section: z.literal('profile'), data: ProfileInput }),
  z.object({ section: z.literal('social'), data: SocialInput }),
  z.object({ section: z.literal('business'), data: BusinessInput }),
]);

export const AdminActionInput = z.object({
  action: z.enum(['START_REVIEW', 'APPROVE', 'REQUEST_INFO', 'REJECT', 'SUSPEND', 'REACTIVATE']),
  message: z.string().trim().max(2000).optional().nullable().transform((v) => (v ? v : null)),
});

export const RoleInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['SUPER_ADMIN', 'FINANCE_ADMIN', 'CREATOR_MANAGER', 'SUPPORT', 'READ_ONLY']).nullable(),
});

export const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return { error: i?.message || 'Bitte Eingaben prüfen.', field: i?.path?.join('.') || null };
};
