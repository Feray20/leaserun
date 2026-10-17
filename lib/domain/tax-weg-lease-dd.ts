export interface TaxInputs { purchasePrice:number; buildingShare:number; relevantModernizationCosts:number; acquisitionDate:string; }
export function fifteenPercentThreshold(i:TaxInputs){return i.purchasePrice*i.buildingShare*0.15;}
export function nearAcquisitionCostCheck(i:TaxInputs){const threshold=fifteenPercentThreshold(i);return {threshold,costs:i.relevantModernizationCosts,reviewRequired:i.relevantModernizationCosts>threshold};}
export interface WegFinding { category:string; amount?:number; mea?:number; sourceEvidenceIds:string[]; severity:"INFO"|"WARNING"|"MATERIAL"|"CRITICAL"; recommendation:string; }
export function specialAssessmentShare(total:number,mea:number){return total*mea;}
export interface LeaseAudit { field:string; value:unknown; evidenceIds:string[]; legalRisk:"NONE"|"POTENTIAL"|"HIGH"; note:string; }
export interface DueDiligenceRule { id:string; name:string; source:string; severity:string; requiredEvidence:string[]; }
