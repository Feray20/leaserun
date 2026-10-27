import { z } from 'zod';

// „Technisches Problem melden“: gemeinsame Definitionen für Kunden-Schnittstelle, Web-Admin und Oberfläche.
export const SUP_CATEGORIES = {
  anmeldung: 'Anmeldung & Konto',
  zahlung: 'Bezahlung & Tarif',
  anzeige: 'Darstellung & Bedienung',
  werkzeug: 'Rechner & Werkzeuge',
  dokument: 'PDF, Kreditmappe & Dokumente',
  langsam: 'Langsam / lädt nicht',
  sonstiges: 'Sonstiges',
} as const;
export const SUP_SEVERITY = { blockiert: 'Ich komme nicht weiter', stoert: 'Stört, geht aber', klein: 'Kleinigkeit' } as const;
export const SUP_STATUS = { neu: 'Eingegangen', in_arbeit: 'In Bearbeitung', rueckfrage: 'Rückfrage an Sie', geloest: 'Gelöst', geschlossen: 'Geschlossen' } as const;
export const SUP_SLA_HOURS = 12;
export const SUP_MAX_SHOTS = 3;
export const SUP_MAX_SHOT_BYTES = 1_400_000; // nach Verkleinerung im Browser; Vercel-Anfragen bleiben unter 4,5 MB

type K<T> = [keyof T & string, ...(keyof T & string)[]];
const keys = <T extends object>(o: T) => Object.keys(o) as K<T>;

export const SupportIn = z.object({
  area: z.enum(['b2c', 'b2b']),
  category: z.enum(keys(SUP_CATEGORIES)),
  severity: z.enum(keys(SUP_SEVERITY)),
  title: z.string().trim().min(3, 'Bitte einen kurzen Betreff (mind. 3 Zeichen).').max(140),
  text: z.string().trim().min(10, 'Bitte beschreiben Sie das Problem in mindestens 10 Zeichen.').max(4000),
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

// Bilddatei an den ersten Bytes erkennen (nicht am Dateinamen): nur JPEG, PNG, WebP.
export function imageType(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export const ticketNo = (n: number | string) => `T-${n}`;
