// Core analysis (US): NOI, DSCR, ICR, LTV, cap rate and a lender-readiness score. Field names are kept for API compatibility
// (monthlyNetRent = monthly rent, lendingValue = appraised value, buildingShare = depreciable building share).
// threshold15/exceeds15Percent: flag when first-3-year repair spending exceeds 15% of the building basis (LeaseRun review trigger, not a tax rule).
import { z } from 'zod';

export const AnalysisInputSchema = z.object({
  purchasePrice: z.number().nonnegative(), monthlyNetRent: z.number().nonnegative(),
  monthlyVacancy: z.number().nonnegative().default(0), monthlyNonRecoverableCosts: z.number().nonnegative().default(0),
  monthlyMaintenance: z.number().nonnegative().default(0), annualOperatingCashCosts: z.number().nonnegative().default(0),
  debtAmount: z.number().nonnegative().default(0), annualInterest: z.number().nonnegative().default(0), annualPrincipal: z.number().nonnegative().default(0),
  lendingValue: z.number().nonnegative().default(0), evidenceComplete: z.boolean().default(false), documentationScore: z.number().min(0).max(100).default(0),
  legalRiskScore: z.number().min(0).max(100).default(0), technicalRiskScore: z.number().min(0).max(100).default(0), liquidityReserve: z.number().nonnegative().default(0),
  buildingShare: z.number().min(0).max(1).default(0), firstThreeYearNetMaintenance: z.number().nonnegative().default(0),
});
export type AnalysisInput = z.infer<typeof AnalysisInputSchema>;
const ratioScore=(v:number|null,target:number,floor:number)=>v===null?50:v>=target?100:v<=floor?0:Math.round((v-floor)/(target-floor)*100);
const ltvScore=(v:number|null)=>v===null?50:Math.round(Math.max(0,Math.min(100,(1-(v-.6)/.4)*100)));
const liquidityScore=(r:number,d:number)=>d<=0?100:Math.min(100,Math.round(r/d*100));
export function analyze(input:AnalysisInput){
 const i=AnalysisInputSchema.parse(input); const annualRent=i.monthlyNetRent*12; const noi=annualRent-i.monthlyVacancy*12-i.monthlyNonRecoverableCosts*12-i.monthlyMaintenance*12;
 const cfads=noi-i.annualOperatingCashCosts; const debtService=i.annualInterest+i.annualPrincipal; const dscr=debtService?cfads/debtService:null; const icr=i.annualInterest?noi/i.annualInterest:null;
 const ltvPurchase=i.purchasePrice?i.debtAmount/i.purchasePrice:null; const ltvLending=i.lendingValue?i.debtAmount/i.lendingValue:null; const capRate=i.purchasePrice?noi/i.purchasePrice:null;
 const threshold15=i.purchasePrice*i.buildingShare*.15; const exceeds15=i.firstThreeYearNetMaintenance>threshold15;
 const components={dscr:ratioScore(dscr,1.25,1),icr:ratioScore(icr,2,1),ltv:ltvScore(ltvPurchase),documentation:i.evidenceComplete?i.documentationScore:Math.min(84,i.documentationScore),legal:i.legalRiskScore,technical:i.technicalRiskScore,liquidity:liquidityScore(i.liquidityReserve,debtService)};
 const score=Math.round(components.dscr*.25+components.icr*.1+components.ltv*.15+components.documentation*.15+components.legal*.15+components.technical*.1+components.liquidity*.1);
 const vetoes:Array<{level:'HARD_VETO'|'CONDITIONAL_VETO'|'WARNING';code:string;title:string;impact:number|null;recommendation:string}>=[];
 if(!i.evidenceComplete)vetoes.push({level:'CONDITIONAL_VETO',code:'EVIDENCE_GATE',title:'Key figures are not fully documented',impact:null,recommendation:'Add source documents (lease, tax bill, insurance quote, HOA statement) and check the evidence references.'});
 if(dscr!==null&&dscr<1)vetoes.push({level:'CONDITIONAL_VETO',code:'DSCR_BELOW_1',title:'Debt service not covered by cash flow (DSCR below 1.00)',impact:cfads-debtService,recommendation:'Review the down payment, rate, rent and cash reserves. Most DSCR lenders need 1.00–1.25 or more.'});
 if(exceeds15)vetoes.push({level:'CONDITIONAL_VETO',code:'REPAIR_VS_IMPROVEMENT_REVIEW',title:'Large early repair spending: review repairs vs. capital improvements',impact:i.firstThreeYearNetMaintenance-threshold15,recommendation:'Work done in the first years may have to be capitalized and depreciated (IRS tangible property rules) instead of deducted. Review invoices with your CPA.'});
 return {metrics:{annualRent,noi,cfads,debtService,dscr,icr,ltvPurchase,ltvLending,capRate,cashflowAfterDebt:cfads-debtService},score,scoreComponents:components,vetoes,taxCheck:{threshold15,firstThreeYearNetMaintenance:i.firstThreeYearNetMaintenance,exceeds15Percent:exceeds15}};
}
