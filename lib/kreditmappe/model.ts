import { afaRate, balanceAfterYears } from './math';
export { afaRate, balanceAfterYears } from './math';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { underwrite, extraMetrics, ertragswert, type StressCase } from '@/lib/underwriting/engine';
import { bankReadyScore } from '@/lib/underwriting/score';
import type { VetoFinding, VetoLevel } from '@/lib/domain/veto';
import { highestVeto } from '@/lib/domain/veto';

// Eingaben, wie sie im Konto (immo_user_data) gespeichert werden. Alle Beträge in Euro.
const num = (min = 0, max = 1e9) => z.coerce.number().finite().min(min).max(max);
const flag = () => z.preprocess((v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on', z.boolean()).default(false);
const txt = (max = 80) => z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string().trim().max(max));

export const ProfileSchema = z.object({
  employment: z.string().max(60).default('Angestellt'),
  netIncome: num().default(0),
  equity: num().default(0),
  householdSize: z.coerce.number().int().min(1).max(12).default(1),
});

export const ObjectSchema = z.object({
  id: z.string().min(4).max(40),
  name: z.string().min(1).max(160),
  price: num(1),
  rent: num(), // Nettokaltmiete pro Monat
  area: num(0, 100000).default(0), // Wohnfläche m²
  yearBuilt: z.coerce.number().int().min(0).max(2100).default(0),
  purchaseCostPct: num(0, 25).default(0), // Kaufnebenkosten in % vom Kaufpreis
  nonRecoverable: num().default(0), // nicht umlagefähige Kosten pro Monat
  maintenance: num().default(0), // Instandhaltung pro Monat
  vacancyPct: num(0, 100).default(0),
  loan: num().default(0),
  interestPct: num(0, 20).default(0),
  repaymentPct: num(0, 20).default(0),
  lendingValue: num().default(0),
  equity: num().default(0),
  // Steuer (optional)
  buildingSharePct: num(0, 100).default(0), // Gebäudeanteil am Kaufpreis in %
  marginalTaxPct: num(0, 50).default(0), // persönlicher Grenzsteuersatz in %
  renovationNet3y: num().default(0), // geplante Instandsetzung/Modernisierung netto in den ersten 3 Jahren
  // WEG (optional, nur Eigentumswohnungen)
  meaShare: num().default(0), // Miteigentumsanteil Zähler
  meaTotal: num().default(0), // Miteigentumsanteil Nenner
  wegReserveTotal: num().default(0), // Erhaltungsrücklage der Gemeinschaft gesamt
  wegPlannedTotal: num().default(0), // geplante/erwartete Maßnahmen der Gemeinschaft gesamt
  wegSpecialTotal: num().default(0), // beschlossene Sonderumlage gesamt
  // Kanonisches Objektmodell (optional, für Kreditmappe und Prüfung)
  flur: txt(), flurstueck: txt(), grundbuchAmt: txt(), grundbuchBlatt: txt(), ownership: txt(),
  landArea: num(0, 1e7).default(0), usableArea: num(0, 1e6).default(0),
  renovationYear: z.coerce.number().int().min(0).max(2100).default(0),
  heatingType: txt(), heatingYear: z.coerce.number().int().min(0).max(2100).default(0),
  energyConsumption: num(0, 2000).default(0), primaryEnergy: num(0, 2000).default(0), efficiencyClass: txt(4),
  marketValue: num().default(0),
  grestPct: num(0, 10).default(0), notaryPct: num(0, 10).default(0), brokerPct: num(0, 10).default(0),
  // Mietrecht, Grundbuch, Bewertung (optional)
  vergleichsmieteQm: num(0, 200).default(0), mietpreisbremse: flag(), abt2Open: flag(),
  liegenschaftszinsPct: num(0, 15).default(0), restnutzungsdauer: z.coerce.number().int().min(0).max(100).default(0),
});

export type UploadedDoc = { filename: string; category: string; sha256: string; createdAt: string };

export type Profile = z.infer<typeof ProfileSchema>;
export type PropertyObject = z.infer<typeof ObjectSchema>;

// Lebenshaltungspauschale als ImmoAdv-Annahme (Banken setzen eigene Werte an).
export const LIVING_BASE = 1000;
export const LIVING_PER_PERSON = 350;
// Anteil der Mieteinnahmen, der in der Haushaltsrechnung angesetzt wird (Annahme).
export const RENT_RECOGNITION = 0.75;

export type StressRow = { name: string; assumption: string; cfads: number; debtService: number; dscr: number; cashflow: number };

export type Kreditmappe = {
  reportId: string;
  dataHash: string; // SHA-256 der Eingabedaten (Objekt und Profil); die PDF-Prüfsumme steht im Prüfregister
  object: PropertyObject;
  profile: Profile;
  createdAt: string;
  financing: {
    purchaseCosts: number; totalCost: number; equity: number; loan: number; gap: number;
    monthlyRate: number; annualInterest: number; annualPrincipal: number; balanceAfter10y: number | null;
  };
  metrics: {
    grossYield: number; noi: number; cfads: number; debtService: number; dscr: number; icr: number;
    ltvPurchase: number; ltvLending: number | null; monthlyCashflow: number; pricePerSqm: number | null;
    maintenancePerSqm: number | null;
    debtYield: number | null; cashOnCash: number | null; breakEvenRate: number | null; netYield: number | null;
  };
  valuation: null | { value: number; reinertrag: number; bodenverzinsung: number; faktor: number; capRatePct: number; remainingLife: number; landValue: number; deviation: number };
  household: { income: number; recognizedRent: number; living: number; costs: number; rate: number; surplus: number };
  stress: StressRow[];
  score: { value: number; capped: boolean; note: string };
  vetos: VetoFinding[];
  vetoLevel: VetoLevel;
  documents: { name: string; status: 'Ungeprüft' }[];
  uploads: UploadedDoc[];
  scoreDrivers: { label: string; value: number; points: number; max: number }[];
  tax: null | {
    afaRatePct: number; afaBasis: number; buildingValue: number; landValue: number; annualAfa: number;
    taxableResult: number; taxEffect: number; monthlyCashflowAfterTax: number; threshold15: number; renovationNet3y: number; exceeds15: boolean;
  };
  weg: null | {
    share: number; reserveShare: number; plannedShare: number; underfunding: number; specialShare: number;
  };
};




const DOCUMENTS = [
  'Personalausweis / Reisepass (Kopie)', 'Selbstauskunft', 'Einkommensnachweise (letzte 3 Monate)',
  'Steuerbescheide (letzte 2–3 Jahre)', 'Eigenkapitalnachweis', 'Bestehende Kredite',
  'Exposé', 'Grundbuchauszug (nicht älter als 3 Monate)', 'Flurkarte', 'Grundrisse und Wohnflächenberechnung',
  'Energieausweis', 'Teilungserklärung (bei ETW)', 'Protokolle der letzten 3 Eigentümerversammlungen (bei ETW)',
  'Wirtschaftsplan und Rücklagenstand (bei ETW)', 'Mietvertrag (bei Vermietung)', 'Kaufvertragsentwurf',
];

export function buildKreditmappe(o: PropertyObject, p: Profile, now = new Date(), uploads: UploadedDoc[] = []): Kreditmappe {
  const interest = o.interestPct / 100;
  const repayment = o.repaymentPct / 100;
  const splitPct = o.grestPct + o.notaryPct + o.brokerPct;
  const costPct = splitPct > 0 ? splitPct : o.purchaseCostPct;
  const purchaseCosts = (o.price * costPct) / 100;
  const totalCost = o.price + purchaseCosts;
  const equity = o.equity > 0 ? o.equity : p.equity;
  const annualInterest = o.loan * interest;
  const annualPrincipal = o.loan * repayment;
  const monthlyRate = (annualInterest + annualPrincipal) / 12;

  const uw = underwrite(
    {
      annualNetColdRent: o.rent * 12,
      vacancyRate: o.vacancyPct / 100,
      nonRecoverableOperatingCosts: o.nonRecoverable * 12,
      annualMaintenance: o.maintenance * 12,
      annualInterest,
      annualPrincipal,
      loanAmount: o.loan,
      lendingValue: o.lendingValue > 0 ? o.lendingValue : o.price,
      purchasePrice: o.price,
    },
    stressCases(o),
  );

  const stress: StressRow[] = uw.stress.map((s, k) => ({
    name: STRESS_SET[k]?.name ?? s.case.name,
    assumption: STRESS_SET[k]?.text ?? '',
    cfads: s.annualCashflow + s.debtService,
    debtService: s.debtService,
    dscr: s.dscr,
    cashflow: s.annualCashflow,
  }));

  const living = LIVING_BASE + LIVING_PER_PERSON * Math.max(0, p.householdSize - 1);
  const recognizedRent = o.rent * RENT_RECOGNITION;
  const costs = o.nonRecoverable + o.maintenance;
  const surplus = p.netIncome + recognizedRent - living - costs - monthlyRate;

  const gap = totalCost - equity - o.loan;
  const ltvLending = o.lendingValue > 0 ? o.loan / o.lendingValue : null;
  const maintenancePerSqm = o.area > 0 ? o.maintenance / o.area : null;

  // Steuer: Kaufpreisaufteilung, AfA, Werbungskostenüberschuss, 15-%-Prüfung (§ 6 Abs. 1 Nr. 1a EStG).
  let tax: Kreditmappe['tax'] = null;
  if (o.buildingSharePct > 0) {
    const share = o.buildingSharePct / 100;
    const buildingValue = o.price * share;
    const afaBasis = (o.price + purchaseCosts) * share; // Anschaffungsnebenkosten anteilig
    const rate = afaRate(o.yearBuilt);
    const annualAfa = afaBasis * rate;
    const effectiveRent = o.rent * 12 * (1 - o.vacancyPct / 100);
    const taxableResult = effectiveRent - o.nonRecoverable * 12 - o.maintenance * 12 - annualInterest - annualAfa;
    const taxEffect = -taxableResult * (o.marginalTaxPct / 100);
    const threshold15 = (afaBasis * 0.15) / 1; // 15 % der Gebäude-Anschaffungskosten (netto zu vergleichen)
    tax = {
      afaRatePct: rate * 100, afaBasis, buildingValue, landValue: o.price - buildingValue, annualAfa, taxableResult, taxEffect,
      monthlyCashflowAfterTax: (uw.cfads - uw.debtService + taxEffect) / 12,
      threshold15, renovationNet3y: o.renovationNet3y, exceeds15: o.renovationNet3y > threshold15,
    };
  }

  // WEG: Objektanteil = Gesamtbetrag × MEA; Unterdeckung = erwartete Maßnahmen − verfügbare Rücklage (je Anteil).
  let weg: Kreditmappe['weg'] = null;
  if (o.meaShare > 0 && o.meaTotal > 0) {
    const share = o.meaShare / o.meaTotal;
    const reserveShare = o.wegReserveTotal * share;
    const plannedShare = o.wegPlannedTotal * share;
    weg = { share, reserveShare, plannedShare, underfunding: Math.max(0, plannedShare - reserveShare), specialShare: o.wegSpecialTotal * share };
  }

  const extra = extraMetrics({ noi: uw.noi, cfads: uw.cfads, debtService: uw.debtService, loan: o.loan, equity, totalCost, repaymentRate: repayment });
  let valuation: Kreditmappe['valuation'] = null;
  if (o.liegenschaftszinsPct > 0 && o.restnutzungsdauer > 0) {
    const landValue = o.buildingSharePct > 0 ? o.price * (1 - o.buildingSharePct / 100) : 0;
    const opCosts = o.nonRecoverable * 12 + o.maintenance * 12 + o.rent * 12 * Math.max(o.vacancyPct, 2) / 100;
    const ev = ertragswert({ annualRent: o.rent * 12, operatingCosts: opCosts, landValue, capRate: o.liegenschaftszinsPct / 100, remainingLife: o.restnutzungsdauer });
    if (ev) valuation = { ...ev, capRatePct: o.liegenschaftszinsPct, remainingLife: o.restnutzungsdauer, landValue, deviation: o.price / ev.value - 1 };
  }
  // Kern-Stresstests für die Resilienz: Zins +200 bp, 6 Monate Leerstand, Kosten +15 %
  const coreStress = [2, 5, 7].map((k) => uw.stress[k]?.dscr).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const stressDscr = o.loan > 0 && coreStress.length ? Math.min(...coreStress) : null;

  const vetos = evaluate({ o, gap, surplus, dscr: uw.dscr, ltvLending, equity, purchaseCosts, maintenancePerSqm, monthlyCashflow: (uw.cfads - uw.debtService) / 12, tax, weg, stressDscr });

  const docCategories = new Set(uploads.map((u) => u.category));
  const rawResult = bankReadyScore({
    dscr: uw.dscr,
    icr: uw.icr,
    ltv: uw.ltvPurchasePrice,
    // Nur formal vorhandene Unterlagen zählen, inhaltlich ist nichts geprüft: höchstens 50 Punkte.
    documentCompleteness: Math.min(50, (docCategories.size / 5) * 50),
    legalRisk: 100, // rechtlich ungeprüft
    technicalRisk: 100, // technisch ungeprüft
    cashReserveMonths: 0,
    stressDscr,
  });
  const raw = rawResult.score;
  const capped = uw.dscr < 1;
  const score = {
    value: capped ? Math.min(raw, 49) : raw,
    capped,
    note: capped
      ? 'Vorläufig und auf höchstens 49 gedeckelt, weil der DSCR unter 1,00 liegt. Recht und Technik sind ungeprüft und fließen mit 0 Punkten ein.'
      : 'Vorläufig: Recht, Technik und Liquiditätsreserve sind ungeprüft und fließen mit 0 Punkten ein; hochgeladene Unterlagen zählen höchstens zur Hälfte, solange ihr Inhalt nicht geprüft ist.',
  };

  return {
    reportId: randomUUID(),
    dataHash: createHash('sha256').update(JSON.stringify({ object: o, profile: p })).digest('hex'),
    object: o,
    profile: p,
    createdAt: now.toISOString(),
    financing: {
      purchaseCosts, totalCost, equity, loan: o.loan, gap, monthlyRate, annualInterest, annualPrincipal,
      balanceAfter10y: o.loan > 0 ? balanceAfterYears(o.loan, interest, repayment, 10) : null,
    },
    metrics: {
      grossYield: o.price > 0 ? (o.rent * 12) / o.price : 0,
      noi: uw.noi, cfads: uw.cfads, debtService: uw.debtService, dscr: uw.dscr, icr: uw.icr,
      ltvPurchase: uw.ltvPurchasePrice, ltvLending,
      monthlyCashflow: (uw.cfads - uw.debtService) / 12,
      pricePerSqm: o.area > 0 ? o.price / o.area : null,
      maintenancePerSqm,
      ...extra,
    },
    valuation,
    household: { income: p.netIncome, recognizedRent, living, costs, rate: monthlyRate, surplus },
    stress,
    score,
    vetos,
    vetoLevel: highestVeto(vetos),
    documents: DOCUMENTS.map((name) => ({ name, status: 'Ungeprüft' as const })),
    uploads,
    scoreDrivers: rawResult.components.map((c) => ({ label: c.label, value: c.value, points: c.points, max: c.max })),
    tax,
    weg,
  };
}

// Stresstest-Matrix in Anlehnung an MaRisk-Szenarien: Zinsschock, Leerstand in Monaten, Kostensteigerung, Kombination.
// Zinsschock wirkt auf den vollen Kapitaldienst (Anschluss bzw. variable Finanzierung); Tilgungssatz bleibt gleich.
const STRESS_SET: { name: string; text: string; di: number; vacMonths: number; cost: number }[] = [
  { name: 'Basis', text: 'Eingegebene Werte', di: 0, vacMonths: 0, cost: 1 },
  { name: 'Zins +100 bp', text: 'Sollzins +1,0 Prozentpunkte', di: 0.01, vacMonths: 0, cost: 1 },
  { name: 'Zins +200 bp', text: 'Sollzins +2,0 Prozentpunkte', di: 0.02, vacMonths: 0, cost: 1 },
  { name: 'Zins +300 bp', text: 'Sollzins +3,0 Prozentpunkte', di: 0.03, vacMonths: 0, cost: 1 },
  { name: 'Leerstand 3 Mon.', text: 'Drei Monate ohne Miete im Jahr', di: 0, vacMonths: 3, cost: 1 },
  { name: 'Leerstand 6 Mon.', text: 'Sechs Monate ohne Miete im Jahr', di: 0, vacMonths: 6, cost: 1 },
  { name: 'Leerstand 12 Mon.', text: 'Ein Jahr ohne Miete', di: 0, vacMonths: 12, cost: 1 },
  { name: 'Kosten +15 %', text: 'Nicht umlagefähige Kosten und Instandhaltung +15 %', di: 0, vacMonths: 0, cost: 1.15 },
  { name: 'Kosten +30 %', text: 'Nicht umlagefähige Kosten und Instandhaltung +30 %', di: 0, vacMonths: 0, cost: 1.3 },
  { name: 'Kombination', text: 'Zins +200 bp, 3 Monate Leerstand, Kosten +15 %', di: 0.02, vacMonths: 3, cost: 1.15 },
];

function stressCases(o: PropertyObject): StressCase[] {
  const i = o.interestPct / 100;
  const v = o.vacancyPct / 100;
  return STRESS_SET.map((x) => ({
    name: x.name,
    interestRate: i + x.di,
    vacancyRate: Math.min(1, x.vacMonths > 0 ? Math.max(v, x.vacMonths / 12) : v),
    maintenanceMultiplier: x.cost,
    costMultiplier: x.cost,
  }));
}

type EvalInput = {
  o: PropertyObject; gap: number; surplus: number; dscr: number; ltvLending: number | null;
  equity: number; purchaseCosts: number; maintenancePerSqm: number | null; monthlyCashflow: number;
  tax: Kreditmappe['tax']; weg: Kreditmappe['weg']; stressDscr?: number | null;
};

// Entscheidungsunterstützung. Keine Aussage über den Eintritt von Rechtsfolgen oder Bankentscheidungen.
function evaluate(x: EvalInput): VetoFinding[] {
  const f: VetoFinding[] = [];
  const eur = (v: number) => Math.round(v);
  if (x.gap > 0.5) {
    f.push({
      id: 'FINANCING_GAP', level: 'HARD_VETO', title: 'Finanzierung rechnerisch nicht gedeckt',
      reason: 'Kaufpreis und Kaufnebenkosten übersteigen Eigenkapital und Darlehen.',
      evidenceIds: ['eingabe:kaufpreis', 'eingabe:nebenkosten', 'eingabe:darlehen', 'eingabe:eigenkapital'],
      financialImpactEur: eur(x.gap),
      recommendation: 'Finanzierungslücke vor dem Bankgespräch schließen oder Annahmen korrigieren.',
    });
  }
  if (x.surplus < 0) {
    f.push({
      id: 'HOUSEHOLD_DEFICIT', level: 'HARD_VETO', title: 'Haushaltsrechnung negativ',
      reason: 'Nach Lebenshaltungspauschale, Objektkosten und Rate bleibt monatlich kein Überschuss.',
      evidenceIds: ['eingabe:nettoeinkommen', 'annahme:lebenshaltung'],
      financialImpactEur: eur(x.surplus * 12),
      recommendation: 'Rate, Kaufpreis oder Einkommen prüfen; Banken setzen eigene Pauschalen an.',
    });
  }
  if (x.dscr < 1 && x.o.loan > 0) {
    f.push({
      id: 'DSCR_BELOW_1', level: 'CONDITIONAL_VETO', title: 'Kapitaldienst nicht durch das Objekt gedeckt',
      reason: 'Der DSCR liegt unter 1,00; die Differenz muss aus dem Einkommen getragen werden.',
      evidenceIds: ['eingabe:miete', 'eingabe:zins', 'eingabe:tilgung'],
      financialImpactEur: eur(x.monthlyCashflow * 12),
      recommendation: 'Tragfähigkeit in der Haushaltsrechnung belegen oder Finanzierungsstruktur anpassen.',
    });
  }
  if (x.dscr >= 1 && x.dscr < 1.05 && x.o.loan > 0) {
    f.push({
      id: 'DSCR_BELOW_105', level: 'CONDITIONAL_VETO', title: 'Kapitaldienstdeckung ohne Puffer',
      reason: 'Der DSCR liegt zwischen 1,00 und 1,05. Schon kleine Abweichungen bei Miete oder Kosten führen zu einer Unterdeckung.',
      evidenceIds: ['eingabe:miete', 'eingabe:kosten', 'eingabe:zins', 'eingabe:tilgung'],
      recommendation: 'Puffer schaffen (Eigenkapital, Tilgung, Kaufpreis) oder Tragfähigkeit über das Einkommen belegen.',
    });
  }
  if (x.tax && x.tax.monthlyCashflowAfterTax < 0) {
    f.push({
      id: 'AFTER_TAX_NEGATIVE', level: 'CONDITIONAL_VETO', title: 'Cashflow auch nach Steuern negativ',
      reason: 'Selbst unter Berücksichtigung der modellierten Steuerwirkung muss monatlich zugezahlt werden.',
      evidenceIds: ['eingabe:miete', 'eingabe:grenzsteuersatz', 'eingabe:gebaeudeanteil'],
      financialImpactEur: eur(x.tax.monthlyCashflowAfterTax * 12),
      recommendation: 'Zuzahlung dauerhaft im Haushalt einplanen oder Annahmen und Kaufpreis prüfen.',
    });
  }
  if (x.o.mietpreisbremse && x.o.vergleichsmieteQm > 0 && x.o.area > 0 && x.o.rent > x.o.vergleichsmieteQm * 1.1 * x.o.area + 0.5) {
    const cap = x.o.vergleichsmieteQm * 1.1 * x.o.area;
    f.push({
      id: 'RENT_CAP', level: 'CONDITIONAL_VETO', title: 'Miete über der Grenze der Mietpreisbremse',
      reason: `Die angesetzte Miete liegt über 110 % der ortsüblichen Vergleichsmiete (${Math.round(cap)} € pro Monat). Zulässig ist das nur bei einer Ausnahme, z. B. höherer Vormiete, Erstvermietung nach dem 01.10.2014 oder umfassender Modernisierung (§§ 556d–556f BGB).`,
      evidenceIds: ['eingabe:miete', 'eingabe:vergleichsmiete', 'eingabe:wohnflaeche'],
      financialImpactEur: eur((cap - x.o.rent) * 12),
      recommendation: 'Ausnahme belegen oder mit der zulässigen Miete rechnen.',
    });
  }
  if (x.o.abt2Open) {
    f.push({
      id: 'GRUNDBUCH_ABT2', level: 'CONDITIONAL_VETO', title: 'Ungeklärte Belastungen in Abteilung II',
      reason: 'Rechte wie Wegerechte, Nießbrauch, Wohnrechte oder Vorkaufsrechte können Nutzung und Beleihung einschränken.',
      evidenceIds: ['eingabe:abteilung_ii'],
      recommendation: 'Eintragungsbewilligungen beim Grundbuchamt anfordern und Auswirkungen vor dem Notartermin klären.',
    });
  }
  if (x.ltvLending !== null && x.ltvLending > 1) {
    f.push({
      id: 'BLANK_PORTION', level: 'CONDITIONAL_VETO', title: 'Darlehen über dem Beleihungswert',
      reason: 'Ein Blankoanteil führt bei Banken üblicherweise zu Zinsaufschlägen oder Zusatzsicherheiten.',
      evidenceIds: ['eingabe:darlehen', 'eingabe:beleihungswert'],
      recommendation: 'Mehr Eigenkapital einplanen oder Beleihungswert mit der Bank klären.',
    });
  }
  if (x.equity < x.purchaseCosts) {
    f.push({
      id: 'EQUITY_BELOW_COSTS', level: 'CONDITIONAL_VETO', title: 'Eigenkapital deckt Nebenkosten nicht',
      reason: 'Die Kaufnebenkosten werden nicht vollständig aus Eigenkapital bezahlt.',
      evidenceIds: ['eingabe:eigenkapital', 'eingabe:nebenkosten'],
      financialImpactEur: eur(x.purchaseCosts - x.equity),
      recommendation: 'Vollfinanzierung nur mit sehr guter Bonität; Konditionen vorab vergleichen.',
    });
  }
  if (x.maintenancePerSqm !== null && x.maintenancePerSqm < 1) {
    f.push({
      id: 'LOW_MAINTENANCE', level: 'WARNING', title: 'Instandhaltung niedrig angesetzt',
      reason: 'Unter 1,00 € je m² und Monat; ältere Gebäude benötigen meist mehr.',
      evidenceIds: ['eingabe:instandhaltung', 'eingabe:wohnflaeche'],
      recommendation: 'Wirtschaftsplan und Rücklagenstand prüfen.',
    });
  }
  if (x.o.marketValue > 0 && x.o.price > x.o.marketValue * 1.1) {
    const dev = x.o.price / x.o.marketValue - 1;
    f.push({
      id: 'PRICE_ABOVE_MARKET', level: dev > 0.25 ? 'HARD_VETO' : 'CONDITIONAL_VETO', title: 'Kaufpreis deutlich über dem angegebenen Marktwert',
      reason: `Der Kaufpreis liegt ${Math.round(dev * 100)} % über dem angegebenen Marktwert. Banken finanzieren in der Regel auf Basis ihres eigenen, meist niedrigeren Werts.`,
      evidenceIds: ['eingabe:kaufpreis', 'eingabe:marktwert'],
      financialImpactEur: eur(x.o.price - x.o.marketValue),
      recommendation: 'Wertgutachten oder Vergleichswerte einholen; Kaufpreis nachverhandeln.',
    });
  }
  const nowYear = new Date().getFullYear();
  if (x.o.heatingYear > 0 && nowYear - x.o.heatingYear >= 30) {
    f.push({
      id: 'HEATING_AGE', level: 'WARNING', title: 'Heizung älter als 30 Jahre',
      reason: 'Bei diesem Alter ist mit technischem Erneuerungsbedarf zu rechnen. Seit 29.07.2026 gilt das Gebäudemodernisierungsgesetz (GModG) anstelle des GEG; ob für die konkrete Anlage Austausch- oder Nachrüstpflichten bestehen, ist im aktuellen Gesetzestext zu prüfen.',
      evidenceIds: ['eingabe:heizung_baujahr'],
      recommendation: 'Zustand und Restlebensdauer prüfen lassen; Erneuerungskosten im Kaufpreis berücksichtigen.',
    });
  }
  if (['G', 'H'].includes((x.o.efficiencyClass || '').toUpperCase())) {
    f.push({
      id: 'ENERGY_CLASS', level: 'WARNING', title: 'Niedrige Energieeffizienzklasse',
      reason: 'Effizienzklasse G oder H deutet auf erheblichen energetischen Modernisierungsbedarf hin.',
      evidenceIds: ['eingabe:effizienzklasse'],
      recommendation: 'Sanierungsfahrplan und Kosten vor dem Kauf einholen.',
    });
  }
  if (x.tax?.exceeds15) {
    f.push({
      id: 'EStG_6_1_1A', level: 'CONDITIONAL_VETO', title: '15-%-Grenze für Instandsetzung überschritten',
      reason: 'Die geplanten Instandsetzungs- und Modernisierungskosten der ersten drei Jahre (netto) übersteigen 15 % der Gebäude-Anschaffungskosten. Sie wären dann voraussichtlich nicht sofort abziehbar, sondern über die AfA zu verteilen (§ 6 Abs. 1 Nr. 1a EStG).',
      evidenceIds: ['eingabe:renovierung', 'eingabe:gebaeudeanteil'],
      financialImpactEur: eur(x.tax.renovationNet3y - x.tax.threshold15),
      recommendation: 'Zeitliche Planung der Maßnahmen mit Steuerberatung abstimmen.',
    });
  }
  if (x.weg && x.weg.specialShare > 0) {
    f.push({
      id: 'WEG_SPECIAL_ASSESSMENT', level: 'CONDITIONAL_VETO', title: 'Sonderumlage der Eigentümergemeinschaft',
      reason: 'Eine Sonderumlage ist angegeben. Sie ist kein automatischer Kaufstopp, muss aber in Kaufpreis und Liquidität berücksichtigt werden.',
      evidenceIds: ['eingabe:sonderumlage', 'eingabe:mea'],
      financialImpactEur: eur(-x.weg.specialShare),
      recommendation: 'Beschluss, Fälligkeit und Kostentragung (Käufer/Verkäufer) vor dem Notartermin klären.',
    });
  }
  if (x.weg && x.weg.underfunding > 0) {
    f.push({
      id: 'WEG_RESERVE_GAP', level: 'CONDITIONAL_VETO', title: 'Erhaltungsrücklage deckt geplante Maßnahmen nicht',
      reason: 'Auf Ihren Miteigentumsanteil entfallen mehr geplante Kosten als Rücklage vorhanden ist.',
      evidenceIds: ['eingabe:ruecklage', 'eingabe:massnahmen', 'eingabe:mea'],
      financialImpactEur: eur(-x.weg.underfunding),
      recommendation: 'Protokolle und Wirtschaftsplan prüfen; mögliche künftige Sonderumlagen einplanen.',
    });
  }
  if (x.o.vacancyPct === 0) {
    f.push({
      id: 'NO_VACANCY', level: 'WARNING', title: 'Kein Mietausfallwagnis angesetzt',
      reason: 'Üblich sind rund 2 % der Jahreskaltmiete.',
      evidenceIds: ['eingabe:leerstand'],
      recommendation: 'Leerstand bzw. Mietausfall in der Rechnung berücksichtigen.',
    });
  }
  return f;
}
