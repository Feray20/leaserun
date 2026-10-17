import { classifyDscr } from './engine';

export type ScoreInput = {
  dscr: number; icr: number; ltv: number; documentCompleteness: number;
  legalRisk: number; technicalRisk: number; cashReserveMonths: number;
  // Optional: niedrigster DSCR der Kern-Stresstests (Zins +200 bp, 6 Monate Leerstand, Kosten +15 %).
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
  // Mit Stresstest: ICR und Liquidität je 5 %, Stress-Resilienz 10 %; sonst bisherige Gewichte.
  const w = withStress ? { icr: .05, reserve: .05, stress: .10 } : { icr: .10, reserve: .10, stress: 0 };
  const score=Math.round(dscr*.25+icr*w.icr+ltv*.15+docs*.15+legal*.15+technical*.10+reserve*w.reserve+stress*w.stress);
  // Score-Treiber: Teilwert (0–100), Gewicht und erreichte Punkte je Komponente
  const components=[
    {key:'DSCR',label:'Kapitaldienstdeckung (DSCR)',value:dscr,weight:.25},
    {key:'ICR',label:'Zinsdeckung (ICR)',value:icr,weight:w.icr},
    {key:'LTV',label:'Beleihung (LTV)',value:ltv,weight:.15},
    {key:'DOC',label:'Unterlagen',value:docs,weight:.15},
    {key:'LEGAL',label:'Rechtliches Risiko',value:legal,weight:.15},
    {key:'TECH',label:'Technisches Risiko',value:technical,weight:.10},
    {key:'LIQ',label:'Liquiditätsreserve',value:reserve,weight:w.reserve},
    ...(withStress?[{key:'STRESS',label:'Stresstest-Resilienz (min. DSCR)',value:stress,weight:w.stress}]:[]),
  ].map(c=>({...c,value:Math.round(c.value),points:Math.round(c.value*c.weight*10)/10,max:c.weight*100}));
  return {score,band:score>=85?'prime':score>=70?'bankable':score>=55?'conditional':'weak',dscrBand:classifyDscr(i.dscr),components};
}
