import { z } from 'zod';

// Verbesserungsvorschläge: gemeinsame Definitionen für Kunden-Schnittstelle, Web-Admin und Oberfläche.
export const TOPICS = {
  bedienung: 'Bedienung & Navigation',
  rechner: 'Rechner & Kennzahlen',
  kreditmappe: 'Kreditmappe & Dokumente',
  inhalte: 'Inhalte & Erklärungen',
  neue_funktion: 'Neue Funktion',
  fehler: 'Fehler gefunden',
  sonstiges: 'Sonstiges',
} as const;
export const STATUS = { neu: 'Neu', in_pruefung: 'In Prüfung', geplant: 'Geplant', umgesetzt: 'Umgesetzt', abgelehnt: 'Nicht geplant' } as const;

export const FeedbackIn = z.object({
  area: z.enum(['b2c', 'b2b']),
  topic: z.enum(Object.keys(TOPICS) as [keyof typeof TOPICS, ...(keyof typeof TOPICS)[]]),
  text: z.string().trim().min(10, 'Bitte mindestens 10 Zeichen.').max(4000),
  importance: z.number().int().min(1).max(5),
  page: z.string().trim().max(200).optional(),
});

export const FeedbackAdmin = z.object({
  id: z.string().uuid(),
  status: z.enum(Object.keys(STATUS) as [keyof typeof STATUS, ...(keyof typeof STATUS)[]]).optional(),
  adminRating: z.number().int().min(1).max(5).nullable().optional(),
  adminNote: z.string().trim().max(2000).nullable().optional(),
  answer: z.string().trim().max(2000).nullable().optional(),
});
