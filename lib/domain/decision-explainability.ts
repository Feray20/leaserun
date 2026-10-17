export interface DecisionFactor{key:string;label:string;impact:"POSITIVE"|"NEGATIVE"|"NEUTRAL";value?:number|string;sourceEvidenceIds:string[];explanation:string;}
export interface ExplainableDecision{status:"PASS"|"REVIEW_REQUIRED"|"VETO";factors:DecisionFactor[];actions:string[];disclaimer:string;}
