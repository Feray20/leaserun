export type AnalysisView="BEGINNER"|"BANK"|"DEEP_AUDIT";
export interface MetricPresentation{key:string;beginnerLabel:string;bankLabel:string;formula?:string;inputs?:Record<string,number>;evidenceIds?:string[];}
