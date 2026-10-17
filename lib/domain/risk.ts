export type RiskLevel='low'|'medium'|'high'|'veto';
export type RiskFlag={code:string;level:RiskLevel;message:string;evidence:string[]};
export function highestRisk(flags:RiskFlag[]):RiskLevel{if(flags.some(f=>f.level==='veto'))return 'veto';if(flags.some(f=>f.level==='high'))return 'high';if(flags.some(f=>f.level==='medium'))return 'medium';return 'low';}
export function requiresManualReview(flags:RiskFlag[]){return flags.some(f=>f.level==='high'||f.level==='veto');}
