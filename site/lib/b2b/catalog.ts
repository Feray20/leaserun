import { supabaseAdmin } from '@/lib/supabase/admin';

// Business catalog: industries, plans, prices, features and software tools – editable in the Web-Admin (lr_settings 'b2b_catalog').
// Every business account has exactly one industry (set when the account is requested; changes only via support)
// plus optional add-on industries. Plans and tools depend on the industry.
// Internal keys stay unchanged (stored in the database): bank = lenders, banks & credit unions; vermittler = mortgage
// brokers & loan officers; makler = real estate agents & brokerages; finanzberater = CPAs & financial advisors;
// allgemein = property managers, investor groups and other firms.
export type Branche = 'bank' | 'vermittler' | 'makler' | 'finanzberater' | 'allgemein';
export type Tier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export const BRANCHEN: Branche[] = ['bank', 'vermittler', 'makler', 'finanzberater', 'allgemein'];
export const TOOL_IDS = ['haushalt', 'unterlagen', 'angebote', 'protokoll', 'vfe', 'provision', 'inserat', 'ertrag'] as const;
export type ToolId = (typeof TOOL_IDS)[number];
export const TOOL_LABEL: Record<ToolId, string> = {
  haushalt: 'Borrower DTI & max loan', unterlagen: 'Document request list', angebote: 'Compare Loan Estimates', protokoll: 'Client meeting record (TRID checklist)',
  vfe: 'Refinance break-even & ARM reset', provision: 'Commission split calculator (post-NAR settlement)', inserat: 'Listing ad compliance check (Fair Housing)', ertrag: 'Income approach (cap rate) check',
};

export type Plan = { key: 'basic' | 'pro'; tier: Exclude<Tier, 'ENTERPRISE'>; name: string; monthCents: number; yearCents: number; seats: number; active: boolean; tools: ToolId[]; features: string[] };
export type BrancheCfg = {
  label: string; short: string; desc: string; selfService: boolean; plans: Plan[];
  enterprise: { active: boolean; name: string; price: string; tools: ToolId[]; features: string[] };
};
export type Catalog = { version: number; addon: { active: boolean; monthCents: number; yearCents: number; text: string }; branchen: Record<Branche, BrancheCfg> };

// Prices in US cents. Business Basic $79/month (max 25 active clients), Pro $149/month, Enterprise custom.
// Annual billing = 10 monthly payments (2 months free).
export const BASIC_CENTS = 7900;
export const PRO_CENTS = 14900;
const BASE_PRO = ['Up to 3 team seats', 'Unlimited active clients', 'Unlimited lender packages and presentations – with your logo, colors and font', 'Your own partner page with booking link', 'REST API v1 for your CRM (early access on request)'];
const BASE_BASIC = ['1 seat', 'Up to 25 active clients', 'Unlimited: quick checks, client invitations and leads', '20 lender packages and 3 client presentations (PDF) per month', 'Pipeline with CSV export, website widget, listing QR codes'];
const toolLine = (t: ToolId[]) => `Software tools: ${t.map((x) => TOOL_LABEL[x].replace(/ \(.*\)$/, '')).join(', ')}`;
function plans(prefix: string, basic: [number, ToolId[]], pro: [number, ToolId[]], extraPro: string[] = []): Plan[] {
  return [
    { key: 'basic', tier: 'BASIC', name: `${prefix} Basic`, monthCents: basic[0], yearCents: basic[0] * 10, seats: 1, active: true, tools: basic[1], features: [...BASE_BASIC, toolLine(basic[1])] },
    { key: 'pro', tier: 'PRO', name: `${prefix} Pro`, monthCents: pro[0], yearCents: pro[0] * 10, seats: 3, active: true, tools: pro[1], features: ['Everything in Basic, plus:', ...BASE_PRO, toolLine(pro[1]), ...extraPro] },
  ];
}
const FIN_B: ToolId[] = ['haushalt', 'unterlagen', 'ertrag'];
const FIN_P: ToolId[] = ['haushalt', 'unterlagen', 'ertrag', 'angebote', 'protokoll', 'vfe'];
const ENT = (tools: ToolId[], name = 'Enterprise'): BrancheCfg['enterprise'] => ({ active: true, name, price: 'Custom pricing', tools, features: ['10+ team seats, expandable', 'White label: documents fully in your company\'s branding', 'Full REST API v1 with webhooks', 'Team management with client assignment', 'Pay by invoice (ACH or check), quote based on team size'] });

export const DEFAULT_CATALOG: Catalog = {
  version: 1,
  addon: { active: true, monthCents: 2900, yearCents: 29000, text: 'Add another industry: extra tools and that industry\'s advisor playbook' },
  branchen: {
    makler: { label: 'Real estate agents & brokerages', short: 'Agents', desc: 'Licensed real estate agents, brokers and brokerages – buyer and listing side', selfService: true,
      plans: plans('Agent', [BASIC_CENTS, ['provision', 'inserat', 'ertrag', 'unterlagen']], [PRO_CENTS, ['provision', 'inserat', 'ertrag', 'unterlagen', 'haushalt']], ['Pre-qualify buyers: DTI and max loan for interested buyers']),
      enterprise: ENT(['provision', 'inserat', 'ertrag', 'unterlagen', 'haushalt'], 'Brokerage Enterprise') },
    vermittler: { label: 'Mortgage brokers & loan officers', short: 'Loan officers', desc: 'NMLS-licensed mortgage brokers and loan officers', selfService: true,
      plans: plans('Loan Officer', [BASIC_CENTS, FIN_B], [PRO_CENTS, FIN_P], ['Client radar: ARM resets and refinance opportunities of your clients']), enterprise: ENT(FIN_P, 'Mortgage Enterprise') },
    finanzberater: { label: 'CPAs & financial advisors', short: 'Advisors', desc: 'CPAs, tax preparers and financial advisors with real estate clients', selfService: true,
      plans: plans('Advisor', [BASIC_CENTS, FIN_B], [PRO_CENTS, FIN_P], ['Client radar: ARM resets and refinance opportunities of your clients']), enterprise: ENT(FIN_P, 'Advisor Enterprise') },
    allgemein: { label: 'Property managers & investor groups', short: 'Other', desc: 'Property management companies, investor groups, real estate attorneys, builders and other firms', selfService: true,
      plans: plans('Business', [BASIC_CENTS, FIN_B], [PRO_CENTS, ['haushalt', 'unterlagen', 'ertrag', 'angebote', 'vfe']]), enterprise: ENT(['haushalt', 'unterlagen', 'ertrag', 'angebote', 'vfe', 'protokoll']) },
    bank: { label: 'Lenders, banks & credit unions', short: 'Lenders', desc: 'Mortgage lenders, community banks and credit unions – branch or central lending team', selfService: false,
      plans: plans('Lender', [0, FIN_B], [0, FIN_P]).map((p) => ({ ...p, active: false })), enterprise: { ...ENT(FIN_P, 'Lender Enterprise'), features: ['10+ team seats, expandable', 'Receive submissions from mortgage brokers', 'White label: documents fully in your institution\'s branding', 'Full REST API v1 with webhooks, client and loan officer routing', 'Pay by invoice (ACH), quote based on branch count'] } },
  },
};

let cache: { at: number; cat: Catalog } | null = null;
function merge(saved: Partial<Catalog> | null): Catalog {
  if (!saved || typeof saved !== 'object' || !saved.branchen) return DEFAULT_CATALOG;
  const out: Catalog = JSON.parse(JSON.stringify(DEFAULT_CATALOG));
  if (saved.addon) out.addon = { ...out.addon, ...saved.addon };
  for (const b of BRANCHEN) if (saved.branchen[b]) out.branchen[b] = { ...out.branchen[b], ...saved.branchen[b] } as BrancheCfg;
  return out;
}
export async function getCatalog(fresh = false): Promise<Catalog> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.cat;
  let saved: Partial<Catalog> | null = null;
  try { const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'b2b_catalog').maybeSingle(); saved = (data?.value as Partial<Catalog>) ?? null; } catch { saved = null; }
  const cat = merge(saved);
  cache = { at: Date.now(), cat };
  return cat;
}
export async function saveCatalog(cat: Catalog, by: string) {
  const r = await supabaseAdmin().from('lr_settings').upsert({ key: 'b2b_catalog', value: cat, updated_at: new Date().toISOString(), updated_by: by });
  if (r.error) throw new Error(r.error.message);
  cache = { at: Date.now(), cat };
}

export const planId = (b: Branche, p: Plan, interval: 'month' | 'year') => `b2b-${b}-${p.key}-${interval === 'year' ? 'yearly' : 'monthly'}`;
export function findPlan(cat: Catalog, id: string): { branche: Branche; plan: Plan; interval: 'month' | 'year'; cents: number } | null {
  const m = /^b2b-(bank|vermittler|makler|finanzberater|allgemein)-(basic|pro)-(monthly|yearly)$/.exec(id);
  if (!m) return null;
  const branche = m[1] as Branche, plan = cat.branchen[branche].plans.find((p) => p.key === m[2]);
  if (!plan) return null;
  const interval = m[3] === 'yearly' ? 'year' : 'month';
  return { branche, plan, interval, cents: interval === 'year' ? plan.yearCents : plan.monthCents };
}

export const brancheFromType = (t: string | null | undefined): Branche => (({ BANK: 'bank', BROKER: 'vermittler', REALTOR: 'makler', ADVISOR: 'finanzberater' }) as Record<string, Branche>)[String(t)] || 'allgemein';
export const accountBranches = (a: { branche?: string | null; extra_branches?: string[] | null; institution_type?: string | null }): Branche[] => {
  const main = (BRANCHEN as string[]).includes(String(a.branche)) ? (a.branche as Branche) : brancheFromType(a.institution_type);
  return [main, ...((a.extra_branches || []).filter((x) => (BRANCHEN as string[]).includes(x) && x !== main) as Branche[])];
};

// Unlocked tools: union of all purchased industries for the purchased plan.
export function toolsFor(cat: Catalog, branches: Branche[], tier: Tier | null): { unlocked: ToolId[]; visible: ToolId[] } {
  const unlocked = new Set<ToolId>(), visible = new Set<ToolId>();
  for (const b of branches) {
    const c = cat.branchen[b];
    const pro = c.plans.find((p) => p.key === 'pro'), basic = c.plans.find((p) => p.key === 'basic');
    [...(pro?.tools || []), ...(basic?.tools || []), ...c.enterprise.tools].forEach((t) => visible.add(t));
    const set = tier === 'ENTERPRISE' ? c.enterprise.tools : tier === 'PRO' ? pro?.tools || [] : tier === 'BASIC' ? basic?.tools || [] : [];
    set.forEach((t) => unlocked.add(t));
  }
  return { unlocked: [...unlocked], visible: [...visible] };
}
