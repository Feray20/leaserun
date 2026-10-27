import { z } from 'zod';

// "Report a technical problem": shared definitions for the customer API, the Web-Admin and the UI.
export const SUP_CATEGORIES = {
  anmeldung: 'Sign-in & account',
  zahlung: 'Payment & plan',
  anzeige: 'Display & usability',
  werkzeug: 'Calculators & tools',
  dokument: 'PDF, Lender Package & documents',
  langsam: "Slow / won't load",
  sonstiges: 'Other',
} as const;
export const SUP_SEVERITY = { blockiert: "I'm stuck", stoert: 'Annoying, but works', klein: 'Minor issue' } as const;
export const SUP_STATUS = { neu: 'Received', in_arbeit: 'In progress', rueckfrage: 'Waiting for your reply', geloest: 'Resolved', geschlossen: 'Closed' } as const;
export const SUP_SLA_HOURS = 12;
export const SUP_MAX_SHOTS = 3;
export const SUP_MAX_SHOT_BYTES = 1_400_000; // after downscaling in the browser; Vercel requests stay under 4.5 MB

type K<T> = [keyof T & string, ...(keyof T & string)[]];
const keys = <T extends object>(o: T) => Object.keys(o) as K<T>;

export const SupportIn = z.object({
  area: z.enum(['b2c', 'b2b']),
  category: z.enum(keys(SUP_CATEGORIES)),
  severity: z.enum(keys(SUP_SEVERITY)),
  title: z.string().trim().min(3, 'Please enter a short subject (at least 3 characters).').max(140),
  text: z.string().trim().min(10, 'Please describe the problem in at least 10 characters.').max(4000),
  expected: z.string().trim().max(2000).optional(),
  page: z.string().trim().max(300).optional(),
  device: z.object({
    ua: z.string().max(400).optional(), vw: z.number().int().min(0).max(20000).optional(), vh: z.number().int().min(0).max(20000).optional(),
    dpr: z.number().min(0).max(10).optional(), lang: z.string().max(40).optional(), tz: z.string().max(60).optional(), standalone: z.boolean().optional(),
    online: z.boolean().optional(), touch: z.boolean().optional(), errors: z.array(z.string().max(300)).max(5).optional(),
  }).default({}),
});

export const SupportAdmin = z.object({
  id: z.string().uuid(),
  status: z.enum(keys(SUP_STATUS)).optional(),
  answer: z.string().trim().max(4000).nullable().optional(),
  adminNote: z.string().trim().max(2000).nullable().optional(),
  notify: z.boolean().optional(),
});

// Detect the image type from the first bytes (not the file name): JPEG, PNG, WebP only.
export function imageType(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export const ticketNo = (n: number | string) => `T-${n}`;
