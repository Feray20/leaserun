export type VetoLevel='HARD_VETO'|'CONDITIONAL_VETO'|'WARNING'|'NONE';
export interface VetoFinding { id:string; level:VetoLevel; title:string; reason:string; evidenceIds:string[]; financialImpactEur?:number; recommendation:string; }
export function highestVeto(findings:VetoFinding[]):VetoLevel { if(findings.some(f=>f.level==='HARD_VETO')) return 'HARD_VETO'; if(findings.some(f=>f.level==='CONDITIONAL_VETO')) return 'CONDITIONAL_VETO'; if(findings.some(f=>f.level==='WARNING')) return 'WARNING'; return 'NONE'; }
