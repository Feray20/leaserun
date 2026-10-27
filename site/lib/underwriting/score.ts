import { classifyDscr } from './engine';

export type ScoreInput = {
  dscr: number; icr: number; ltv: number; documentCompleteness: number;
  legalRisk: number; technicalRisk: number; cashReserveMonths: number;
  // Optional: lowest DSCR across the core stress tests (rate +200 bp, 6 months vacancy, expenses +15%).
  stressDscr?: number | null;
};

export function bankReadyScore(i: ScoreInput) {
  const dscr = Math.max(0, Math.min(100, (i.dscr / 1.50) * 100));
  const icr = Math.max(0, Math.min(100, (i.icr / 3.00) * 100));
  const ltv = Math.max(0, Math.min(100, (1 - Math.max(0,i.ltv-0.60)/0.40) * 100));
  const docs = Math.max(0, Math.min(100,i.documentCompleteness));
  const legal = Math.max(0, Math.min(100,100-i.legalRisk));
  const technical = Math.max(0, Math.min(100,100-i.technicalRisk));
  const reserve = Math.max(0, Math.min(100,(i.cashReserveMonths/12)*100));
  const withStress = typeof i.stressDscr === 'number' && Number.isFinite(i.stressDscr);
  const stress = withStress ? Math.max(0, Math.min(100, (i.stressDscr! / 1.20) * 100)) : 0;
  // With a stress test: ICR and reserves 5% each, stress resilience 10%; otherwise the standard weights.
  const w = withStress ? { icr: .05, reserve: .05, stress: .10 } : { icr: .10, reserve: .10, stress: 0 };
  const score=Math.round(dscr*.25+icr*w.icr+ltv*.15+docs*.15+legal*.15+technical*.10+reserve*w.reserve+stress*w.stress);
  // Score drivers: sub-score (0–100), weight and points earned per component
  const components=[
    {key:'DSCR',label:'Debt service coverage (DSCR)',value:dscr,weight:.25},
    {key:'ICR',label:'Interest coverage (ICR)',value:icr,weight:w.icr},
    {key:'LTV',label:'Loan-to-value (LTV)',value:ltv,weight:.15},
    {key:'DOC',label:'Documents',value:docs,weight:.15},
    {key:'LEGAL',label:'Legal & title risk',value:legal,weight:.15},
    {key:'TECH',label:'Physical condition risk',value:technical,weight:.10},
    {key:'LIQ',label:'Cash reserves (months of PITIA)',value:reserve,weight:w.reserve},
    ...(withStress?[{key:'STRESS',label:'Stress-test resilience (min. DSCR)',value:stress,weight:w.stress}]:[]),
  ].map(c=>({...c,value:Math.round(c.value),points:Math.round(c.value*c.weight*10)/10,max:c.weight*100}));
  return {score,band:score>=85?'prime':score>=70?'bankable':score>=55?'conditional':'weak',dscrBand:classifyDscr(i.dscr),components};
}
