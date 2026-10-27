import { z } from 'zod';

// Improvement suggestions: shared definitions for the customer API, the Web-Admin and the UI.
export const TOPICS = {
  bedienung: 'Ease of use & navigation',
  rechner: 'Calculators & metrics',
  kreditmappe: 'Lender Package & documents',
  inhalte: 'Content & explanations',
  neue_funktion: 'New feature',
  fehler: 'Found a bug',
  sonstiges: 'Other',
} as const;
export const STATUS = { neu: 'New', in_pruefung: 'Under review', geplant: 'Planned', umgesetzt: 'Done', abgelehnt: 'Not planned' } as const;

export const FeedbackIn = z.object({
  area: z.enum(['b2c', 'b2b']),
  topic: z.enum(Object.keys(TOPICS) as [keyof typeof TOPICS, ...(keyof typeof TOPICS)[]]),
  text: z.string().trim().min(10, 'Please enter at least 10 characters.').max(4000),
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
