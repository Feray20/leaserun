import { supabaseAdmin } from '@/lib/supabase/admin';

// B2B-Katalog: Branchen, Pakete, Preise, Leistungen und Software-Tools – im Web-Admin änderbar (lr_settings 'b2b_catalog').
// Jedes Unternehmenskonto hat genau eine Branche (bei der Kontoanfrage festgelegt, Wechsel nur über den Support)
// plus optional dazugebuchte Zusatzbranchen. Pakete und Tools richten sich nach der Branche.
export type Branche = 'bank' | 'vermittler' | 'makler' | 'finanzberater' | 'allgemein';
export type Tier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export const BRANCHEN: Branche[] = ['bank', 'vermittler', 'makler', 'finanzberater', 'allgemein'];
export const TOOL_IDS = ['haushalt', 'unterlagen', 'angebote', 'protokoll', 'vfe', 'provision', 'inserat', 'ertrag'] as const;
export type ToolId = (typeof TOOL_IDS)[number];
export const TOOL_LABEL: Record<ToolId, string> = {
  haushalt: 'Haushaltsrechnung', unterlagen: 'Unterlagen-Anforderung', angebote: 'Bankangebote vergleichen', protokoll: 'Beratungsprotokoll (§ 511 BGB)',
  vfe: 'Vorfälligkeit & Anschluss', provision: 'Provisionsrechner (§§ 656c/d BGB)', inserat: 'Inserats-Pflichtangaben (§ 87 GEG)', ertrag: 'Ertragswert-Schnellcheck',
};

export type Plan = { key: 'basic' | 'pro'; tier: Exclude<Tier, 'ENTERPRISE'>; name: string; monthCents: number; yearCents: number; seats: number; active: boolean; tools: ToolId[]; features: string[] };
export type BrancheCfg = {
  label: string; short: string; desc: string; selfService: boolean; plans: Plan[];
  enterprise: { active: boolean; name: string; price: string; tools: ToolId[]; features: string[] };
};
export type Catalog = { version: number; addon: { active: boolean; monthCents: number; yearCents: number; text: string }; branchen: Record<Branche, BrancheCfg> };

const BASE_PRO = ['Bis zu 3 Berater-Zugänge', 'Kreditmappen und Präsentationen unbegrenzt – mit Ihrem Logo, Ihren Farben und Ihrer Schrift', 'Eigene Partnerseite mit Terminlink', 'REST-API v1 für Ihr CRM (Frühzugang auf Anfrage)'];
const BASE_BASIC = ['1 Berater-Zugang', 'Unbegrenzt: Schnell-Checks, Kunden-Einladungen und Anfragen', '20 Kreditmappen und 3 Kunden-Präsentationen (PDF) pro Monat', 'Pipeline mit CSV-Export, Website-Widget, Exposé-QR-Codes'];
const toolLine = (t: ToolId[]) => `Software-Tools: ${t.map((x) => TOOL_LABEL[x].replace(/ \(.*\)$/, '')).join(', ')}`;
function plans(prefix: string, basic: [number, ToolId[]], pro: [number, ToolId[]], extraPro: string[] = []): Plan[] {
  return [
    { key: 'basic', tier: 'BASIC', name: `${prefix} Basic`, monthCents: basic[0], yearCents: basic[0] * 10, seats: 1, active: true, tools: basic[1], features: [...BASE_BASIC, toolLine(basic[1])] },
    { key: 'pro', tier: 'PRO', name: `${prefix} Pro`, monthCents: pro[0], yearCents: pro[0] * 10, seats: 3, active: true, tools: pro[1], features: ['Alles aus Basic, plus:', ...BASE_PRO, toolLine(pro[1]), ...extraPro] },
  ];
}
const FIN_B: ToolId[] = ['haushalt', 'unterlagen', 'ertrag'];
const FIN_P: ToolId[] = ['haushalt', 'unterlagen', 'ertrag', 'angebote', 'protokoll', 'vfe'];
const ENT = (tools: ToolId[], name = 'Enterprise'): BrancheCfg['enterprise'] => ({ active: true, name, price: 'ab 349 € netto pro Monat', tools, features: ['Ab 10 Berater-Zugängen, erweiterbar', 'White-Label: Unterlagen komplett im Erscheinungsbild Ihres Hauses', 'Volle REST-API v1 mit Webhooks', 'Teamverwaltung mit Berater-Zuordnung', 'Kauf auf Rechnung, Angebot nach Größe'] });

export const DEFAULT_CATALOG: Catalog = {
  version: 1,
  addon: { active: true, monthCents: 2900, yearCents: 29000, text: 'Weitere Branche dazubuchen: zusätzliche Tools und Beratungskompass der Branche' },
  branchen: {
    makler: { label: 'Immobilienmakler', short: 'Makler', desc: 'Makler nach § 34c GewO – Verkauf und Vermietung', selfService: true,
      plans: plans('Makler', [2900, ['provision', 'inserat', 'ertrag', 'unterlagen']], [6900, ['provision', 'inserat', 'ertrag', 'unterlagen', 'haushalt']], ['Interessenten vorqualifizieren: Haushaltsrechnung für Kaufinteressenten']),
      enterprise: ENT(['provision', 'inserat', 'ertrag', 'unterlagen', 'haushalt'], 'Makler Enterprise') },
    vermittler: { label: 'Finanzierungsvermittler', short: 'Vermittler', desc: 'Immobiliardarlehensvermittler nach § 34i GewO', selfService: true,
      plans: plans('Vermittler', [4900, FIN_B], [11900, FIN_P], ['Bestandskunden-Radar: Zinsbindungsenden Ihrer Kunden']), enterprise: ENT(FIN_P, 'Vermittler Enterprise') },
    finanzberater: { label: 'Finanz- & Vermögensberater', short: 'Finanzberater', desc: 'Berater nach § 34d/f/h GewO mit Immobilien als Anlageklasse', selfService: true,
      plans: plans('Finanzberater', [4900, FIN_B], [11900, FIN_P], ['Bestandskunden-Radar: Zinsbindungsenden Ihrer Mandanten']), enterprise: ENT(FIN_P, 'Finanzberater Enterprise') },
    allgemein: { label: 'Sonstiges Unternehmen', short: 'Allgemein', desc: 'Kanzlei, Hausverwaltung, Bauträger oder anderes', selfService: true,
      plans: plans('Business', [3900, FIN_B], [9900, ['haushalt', 'unterlagen', 'ertrag', 'angebote', 'vfe']]), enterprise: ENT(['haushalt', 'unterlagen', 'ertrag', 'angebote', 'vfe', 'protokoll']) },
    bank: { label: 'Bank & Sparkasse', short: 'Bank', desc: 'Baufinanzierungsberater in Filiale oder Immobilienzentrum', selfService: false,
      plans: plans('Bank', [0, FIN_B], [0, FIN_P]).map((p) => ({ ...p, active: false })), enterprise: { ...ENT(FIN_P, 'Bank & Filiale Enterprise'), features: ['Ab 10 Berater-Zugängen, erweiterbar', 'Einreichungen von Vermittlern empfangen', 'White-Label: Unterlagen komplett im Erscheinungsbild Ihres Hauses', 'Volle REST-API v1 mit Webhooks, Mandanten- und Berater-Routing', 'Kauf auf Rechnung, Angebot nach Filialgröße'] } },
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

// Freigeschaltete Tools: Vereinigung aller gebuchten Branchen für den gebuchten Tarif.
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
