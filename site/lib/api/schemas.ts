// Eingabeschemata der API (streng: unbekannte Felder werden abgelehnt).
import { z } from 'zod';
import { SCOPES } from '@/lib/api/entitlements';

const money = (max = 100_000_000) => z.number().finite().min(0).max(max);
const str = (max: number) => z.string().trim().min(1).max(max);
export const STATES = ['baden-wuerttemberg', 'bayern', 'berlin', 'brandenburg', 'bremen', 'hamburg', 'hessen', 'mecklenburg-vorpommern', 'niedersachsen',
  'nordrhein-westfalen', 'rheinland-pfalz', 'saarland', 'sachsen', 'sachsen-anhalt', 'schleswig-holstein', 'thueringen'] as const;
export const EMPLOYMENT = ['employed', 'civil_servant', 'self_employed', 'retired', 'other'] as const;
export const PROPERTY_TYPES = ['apartment', 'single_family_house', 'two_family_house', 'multi_family_house', 'land', 'other'] as const;

const Applicant = z.object({
  first_name: str(80).optional(),
  last_name: str(80).optional(),
  employment_type: z.enum(EMPLOYMENT).optional(),
  employed_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  monthly_net_income: money(1_000_000).optional(),
}).strict();

export const CaseInput = z.object({
  external_reference: str(120).optional(),
  customer: z.object({
    first_name: str(80).optional(),
    last_name: str(80).optional(),
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().regex(/^[+0-9 ()/-]{5,30}$/).optional(),
  }).strict().optional(),
  applicants: z.array(Applicant).max(4).optional(),
  property: z.object({
    property_type: z.enum(PROPERTY_TYPES).optional(),
    usage: z.enum(['owner_occupied', 'rented', 'mixed']).optional(),
    address: z.object({
      street: str(160).optional(),
      postal_code: z.string().regex(/^\d{5}$/).optional(),
      city: str(80).optional(),
      state: z.enum(STATES).optional(),
    }).strict().optional(),
    purchase_price: money().optional(),
    land_value: money().optional(),
    renovation_cost: money().optional(),
    living_area: z.number().finite().min(0).max(100_000).optional(),
    year_built: z.number().int().min(1500).max(2100).optional(),
    monthly_cold_rent: money(10_000_000).optional(),
  }).strict().optional(),
  household: z.object({
    monthly_net_income: money(1_000_000).optional(),
    monthly_expenses: money(1_000_000).optional(),
    adults: z.number().int().min(1).max(10).optional(),
    dependants: z.number().int().min(0).max(20).optional(),
  }).strict().optional(),
  equity: z.object({
    amount: money().optional(),
    available_amount: money().optional(),
  }).strict().optional(),
  loan: z.object({
    requested_amount: money().optional(),
    term_years: z.number().int().min(1).max(50).optional(),
    repayment_rate: z.number().finite().min(0).max(20).optional(),   // anfängliche Tilgung in % p. a.
    interest_rate: z.number().finite().min(0).max(20).optional(),    // Sollzins in % p. a. (Annahme, falls bekannt)
  }).strict().optional(),
  metadata: z.record(z.string().max(40), z.union([z.string().max(200), z.number().finite(), z.boolean()])).refine((m) => Object.keys(m).length <= 20, 'max 20 keys').optional(),
}).strict();
export type CaseData = z.infer<typeof CaseInput>;

// PATCH: gleiche Felder, alles optional; null entfernt einen Wert.
export function mergeCase(base: CaseData, patch: Record<string, unknown>): unknown {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === null) return undefined;
    if (Array.isArray(b) || typeof b !== 'object' || b === undefined) return b === undefined ? a : b;
    const out: Record<string, unknown> = { ...((a && typeof a === 'object' && !Array.isArray(a)) ? a as Record<string, unknown> : {}) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      const m = merge(out[k], v);
      if (m === undefined) delete out[k]; else out[k] = m;
    }
    return out;
  };
  return merge(base, patch);
}

export const DOCUMENT_TYPES = [
  'identity', 'income_proof', 'employment_contract', 'tax_assessment', 'annual_financials', 'bwa', 'equity_proof', 'bank_statement',
  'existing_loans', 'expose', 'land_register', 'cadastral_map', 'floor_plan', 'living_area_calculation', 'energy_certificate',
  'declaration_of_division', 'owners_meeting_minutes', 'service_charge_statement', 'rental_agreement', 'purchase_contract_draft',
  'building_insurance', 'self_disclosure', 'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const WEBHOOK_EVENTS = ['case.completed', 'case.action_required', 'document.verified', 'validation.completed', 'report.completed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WebhookInput = z.object({
  url: z.string().trim().url().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  description: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
}).strict();
export const WebhookPatch = WebhookInput.partial().strict();

export const KeyInput = z.object({
  name: str(80),
  environment: z.enum(['test', 'live']).optional(),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
  expires_at: z.string().datetime({ offset: true }).optional(),
  allowed_ips: z.array(z.string().trim().max(50)).max(20).optional(),
}).strict();

export const ReportInput = z.object({
  validation_id: z.string().uuid().optional(),
}).strict();
