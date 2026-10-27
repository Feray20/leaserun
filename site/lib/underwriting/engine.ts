export type UnderwritingInput = {
  annualNetColdRent: number;
  nonRecoverableOperatingCosts: number;
  annualInterest: number;
  annualPrincipal: number;
  loanAmount: number;
  lendingValue: number;
  purchasePrice: number;
  vacancyRate?: number;
  annualMaintenance?: number;
  annualTax?: number;
  annualOtherCashCosts?: number;
  annualTaxEffect?: number;
};

// costMultiplier (optional) also scales the non-recoverable operating expenses; maintenanceMultiplier scales repairs/capex.
export type StressCase = { name: string; interestRate: number; vacancyRate: number; maintenanceMultiplier: number; costMultiplier?: number };
export type UnderwritingResult = {
  grossRent: number; vacancyLoss: number; noi: number; cfads: number;
  debtService: number; dscr: number; icr: number; ltvPurchasePrice: number;
  ltvLendingValue: number; annualAfterTaxCashflow: number; monthlyAfterTaxCashflow: number;
  stress: Array<{case: StressCase; noi: number; debtService: number; dscr: number; annualCashflow: number}>;
};

const n=(v:number|undefined)=>Number.isFinite(v) ? v! : 0;
const ratio=(a:number,b:number)=>b===0 ? null : a/b;
const annualDebt=(loan:number,rate:number,principalRate:number)=>loan*(rate+principalRate);

export function underwrite(i:UnderwritingInput, cases?:StressCase[]):UnderwritingResult {
  if(i.annualNetColdRent<0||i.nonRecoverableOperatingCosts<0||i.loanAmount<0||i.purchasePrice<=0||i.lendingValue<=0) throw new Error('invalid_underwriting_input');
  const vacancy=n(i.vacancyRate);
  const grossRent=i.annualNetColdRent;
  const vacancyLoss=grossRent*vacancy;
  const noi=grossRent-vacancyLoss-i.nonRecoverableOperatingCosts-n(i.annualMaintenance);
  const debtService=i.annualInterest+i.annualPrincipal;
  const cfads=noi-n(i.annualOtherCashCosts)-n(i.annualTax);
  const afterTax=cfads-debtService+n(i.annualTaxEffect);
  const baseCases:StressCase[]=cases??[
    {name:'base',interestRate:0.035,vacancyRate:vacancy,maintenanceMultiplier:1},
    {name:'worst',interestRate:0.075,vacancyRate:Math.max(vacancy,0.08),maintenanceMultiplier:1.25},
    {name:'best',interestRate:0.025,vacancyRate:Math.min(vacancy,0.02),maintenanceMultiplier:0.9}
  ];
  const stress=baseCases.map(c=>{
    const sNoi=grossRent*(1-c.vacancyRate)-i.nonRecoverableOperatingCosts*(c.costMultiplier??1)-n(i.annualMaintenance)*c.maintenanceMultiplier;
    const sCfads=sNoi-n(i.annualOtherCashCosts)-n(i.annualTax);
    const sDebt=annualDebt(i.loanAmount,c.interestRate,i.loanAmount?i.annualPrincipal/i.loanAmount:0);
    // DSCR = CFADS / debt service (LeaseRun risk policy; most DSCR lenders want 1.00–1.25 or more)
    return {case:c,noi:sNoi,debtService:sDebt,dscr:ratio(sCfads,sDebt)??0,annualCashflow:sCfads-sDebt+n(i.annualTaxEffect)};
  });
  return {grossRent,vacancyLoss,noi,cfads,debtService,dscr:ratio(cfads,debtService)??0,icr:ratio(noi,i.annualInterest)??0,ltvPurchasePrice:i.loanAmount/i.purchasePrice,ltvLendingValue:i.loanAmount/i.lendingValue,annualAfterTaxCashflow:afterTax,monthlyAfterTaxCashflow:afterTax/12,stress};
}

// DSCR bands: most DSCR/investor lenders require at least 1.00 and price best at 1.25 or higher.
export function classifyDscr(dscr:number):'red'|'amber'|'green' { return dscr<1.00?'red':dscr<1.25?'amber':'green'; }
// LTV bands: up to 60% best pricing, up to 80% standard (no PMI, typical 20–25% down on investment property), above 80% high.
export function classifyLtv(ltv:number):'prime'|'standard'|'high' { return ltv<=0.60?'prime':ltv<=0.80?'standard':'high'; }

// Additional metrics for investors and lenders (all annual; null when undefined).
export function extraMetrics(x:{noi:number;cfads:number;debtService:number;loan:number;equity:number;totalCost:number;repaymentRate:number}){
  return {
    debtYield: x.loan>0 ? x.noi/x.loan : null,                       // NOI ÷ loan amount
    cashOnCash: x.equity>0 ? (x.cfads-x.debtService)/x.equity : null, // pre-tax cash flow ÷ cash invested
    breakEvenRate: x.loan>0 ? x.cfads/x.loan-x.repaymentRate : null,  // interest rate at which pre-tax cash flow is zero
    netYield: x.totalCost>0 ? x.noi/x.totalCost : null,              // NOI ÷ total project cost (cap rate on cost)
  };
}

// Income approach (land residual / building annuity): land value + (NOI − return on land) × present-value factor over the
// remaining economic life. Cap rate and remaining economic life are user inputs (e.g. from an appraiser); this is not an appraisal.
// Field names are kept for compatibility: reinertrag = NOI, bodenverzinsung = return on land, faktor = PV annuity factor.
export function ertragswert(x:{annualRent:number;operatingCosts:number;landValue:number;capRate:number;remainingLife:number}){
  if(!(x.capRate>0)||!(x.remainingLife>0)||x.annualRent<=0) return null;
  const reinertrag=x.annualRent-x.operatingCosts;
  const bodenverzinsung=x.landValue*x.capRate;
  const q=1+x.capRate, qn=Math.pow(q,x.remainingLife);
  const faktor=(qn-1)/(qn*(q-1));
  const gebaeudeertrag=Math.max(0,reinertrag-bodenverzinsung);
  return { reinertrag, bodenverzinsung, faktor, gebaeudeertragswert:gebaeudeertrag*faktor, value:x.landValue+gebaeudeertrag*faktor };
}

// ---------- US lending metrics (owner-occupied and investment) ----------
// PITIA = principal & interest + property tax + homeowners insurance + HOA dues (+ PMI where it applies), per month.
export function pitia(x:{principalAndInterest:number;propertyTaxMonthly?:number;insuranceMonthly?:number;hoaMonthly?:number;pmiMonthly?:number}):number {
  return n(x.principalAndInterest)+n(x.propertyTaxMonthly)+n(x.insuranceMonthly)+n(x.hoaMonthly)+n(x.pmiMonthly);
}
// Front-end DTI = housing payment ÷ gross monthly income; back-end DTI = (housing + other monthly debts) ÷ gross income.
// Lenders typically count 75% of expected rent from a rental as income (Fannie Mae / Freddie Mac practice).
export function dti(x:{grossMonthlyIncome:number;housingPayment:number;otherMonthlyDebts?:number;rentalIncomeMonthly?:number;rentFactor?:number}){
  const income=n(x.grossMonthlyIncome)+n(x.rentalIncomeMonthly)*(x.rentFactor??0.75);
  if(!(income>0)) return {front:null as number|null,back:null as number|null};
  return {front:n(x.housingPayment)/income,back:(n(x.housingPayment)+n(x.otherMonthlyDebts))/income};
}
// Typical guideline ranges: front ≤ 28%, back ≤ 36% comfortable, up to 43% (QM) / 45–50% with strong compensating factors.
export function classifyDti(back:number|null):'green'|'amber'|'red'|'na' { return back==null?'na':back<=0.36?'green':back<=0.43?'amber':'red'; }
// Reserves in months of PITIA (lenders often ask for 2–6 months, more for investment property or several financed properties).
export function reserveMonths(liquidAfterClosing:number,monthlyPitia:number):number|null { return monthlyPitia>0?n(liquidAfterClosing)/monthlyPitia:null; }
// PMI applies to conventional owner-occupied loans above 80% LTV (dropped at 78% of original value); annual rate is an assumption.
export function pmiMonthly(x:{loan:number;value:number;ownerOccupied:boolean;annualRatePct?:number}):number {
  if(!x.ownerOccupied||!(x.value>0)||x.loan/x.value<=0.80) return 0;
  return x.loan*(x.annualRatePct??0.6)/100/12;
}
// Minimum down payment rule of thumb for investment property on conventional loans: 15% (1 unit) to 25% (2–4 units).
export function minDownPctInvestment(units:number):number { return units>1?25:15; }
// Cap rate = NOI ÷ purchase price; cash-on-cash = annual pre-tax cash flow ÷ total cash invested.
export function capRate(noi:number,price:number):number|null { return price>0?noi/price:null; }
