// API input schemas (strict: unknown fields are rejected).
import { z } from 'zod';
import { SCOPES } from '@/lib/api/entitlements';

const money = (max = 100_000_000) => z.number().finite().min(0).max(max);
const str = (max: number) => z.string().trim().min(1).max(max);
// US states and DC as USPS two-letter codes.
export const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'] as const;
// civil_servant = government employee (federal, state or local); kept as identifier for compatibility.
export const EMPLOYMENT = ['employed', 'civil_servant', 'self_employed', 'retired', 'other'] as const;
// apartment = condo unit; two_family_house = duplex; multi_family_house = 3–4 units or 5+ (commercial).
export const PROPERTY_TYPES = ['apartment', 'townhouse', 'single_family_house', 'two_family_house', 'multi_family_house', 'land', 'other'] as const;

const Applicant = z.object({
  first_name: str(80).optional(),
  last_name: str(80).optional(),
  employment_type: z.enum(EMPLOYMENT).optional(),
  employed_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  monthly_gross_income: money(1_000_000).optional(),
  monthly_net_income: money(1_000_000).optional(),
}).strict();

export const CaseInput = z.object({
  external_reference: str(120).optional(),
  customer: z.object({
    first_name: str(80).optional(),
    last_name: str(80).optional(),
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().regex(/^[+0-9 ()./-]{5,30}$/).optional(),
  }).strict().optional(),
  applicants: z.array(Applicant).max(4).optional(),
  property: z.object({
    property_type: z.enum(PROPERTY_TYPES).optional(),
    usage: z.enum(['owner_occupied', 'rented', 'mixed']).optional(),
    address: z.object({
      street: str(160).optional(),
      postal_code: z.string().regex(/^\d{5}(-\d{4})?$/).optional(),
      city: str(80).optional(),
      state: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.enum(STATES)).optional(),
    }).strict().optional(),
    purchase_price: money().optional(),
    land_value: money().optional(),
    renovation_cost: money().optional(),
    closing_costs: money().optional(),               // estimated buyer closing costs (from the Loan Estimate), USD
    annual_property_tax: money(10_000_000).optional(),
    annual_insurance: money(10_000_000).optional(),  // homeowners / landlord insurance premium per year
    monthly_hoa: money(1_000_000).optional(),
    living_area: z.number().finite().min(0).max(1_000_000).optional(),   // square feet
    year_built: z.number().int().min(1500).max(2100).optional(),
    monthly_cold_rent: money(10_000_000).optional(),  // gross monthly rent (rental properties)
  }).strict().optional(),
  household: z.object({
    monthly_gross_income: money(1_000_000).optional(), // before taxes – basis for DTI
    monthly_net_income: money(1_000_000).optional(),   // take-home pay
    monthly_debt_payments: money(1_000_000).optional(), // minimum payments on credit cards, auto, student and other loans
    monthly_expenses: money(1_000_000).optional(),     // living expenses (for the budget check)
    adults: z.number().int().min(1).max(10).optional(),
    dependants: z.number().int().min(0).max(20).optional(),
  }).strict().optional(),
  equity: z.object({
    amount: money().optional(),           // down payment plus closing funds brought to closing
    available_amount: money().optional(), // total verified liquid assets (for cash to close and reserves)
  }).strict().optional(),
  loan: z.object({
    requested_amount: money().optional(),
    term_years: z.number().int().min(1).max(50).optional(),          // amortization term, default 30
    repayment_rate: z.number().finite().min(0).max(20).optional(),   // deprecated (German-style initial repayment); ignored, use term_years
    interest_rate: z.number().finite().min(0).max(20).optional(),    // note rate in % per year (assumption if known)
    loan_program: z.enum(['conventional', 'fha', 'va', 'usda', 'jumbo', 'dscr', 'other']).optional(),
  }).strict().optional(),
  metadata: z.record(z.string().max(40), z.union([z.string().max(200), z.number().finite(), z.boolean()])).refine((m) => Object.keys(m).length <= 20, 'max 20 keys').optional(),
}).strict();
export type CaseData = z.infer<typeof CaseInput>;

// PATCH: same fields, all optional; null removes a value.
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
