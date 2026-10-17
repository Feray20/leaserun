export type DealSignals = {
  futureSpecialAssessment?: boolean;
  titleEncumbrance?: boolean;
  unresolvedLandCharge?: boolean;
  rentClauseRisk?: boolean;
  rentControlRisk?: boolean;
  acquisitionRelatedCostRatio?: number;
  energyComplianceRisk?: boolean;
  documentConflict?: boolean;
};

export type VetoFinding={code:string;severity:'hard'|'warning';message:string;value?:number};

export function evaluateDeal(s:DealSignals):VetoFinding[]{
  const f:VetoFinding[]=[];
  if(s.futureSpecialAssessment)f.push({code:'WEG_SPECIAL_ASSESSMENT',severity:'hard',message:'Future WEG special assessment requires resolution and funding review.'});
  if(s.titleEncumbrance)f.push({code:'TITLE_ENCUMBRANCE',severity:'hard',message:'Unresolved rights/encumbrances in land register require legal clearance.'});
  if(s.unresolvedLandCharge)f.push({code:'LAND_CHARGE',severity:'warning',message:'Unresolved registered land charge requires closing-condition verification.'});
  if(s.rentClauseRisk)f.push({code:'LEASE_CLAUSE',severity:'warning',message:'Lease clause requires legal review before underwriting reliance.'});
  if(s.rentControlRisk)f.push({code:'RENT_CONTROL',severity:'warning',message:'Rent-control applicability must be legally assessed before projected rent is relied upon.'});
  if((s.acquisitionRelatedCostRatio??0)>0.15)f.push({code:'EStG_6_1_1A',severity:'hard',message:'Acquisition-related repair/modernisation costs exceed the 15% threshold indicator; tax classification review required.',value:s.acquisitionRelatedCostRatio});
  if(s.energyComplianceRisk)f.push({code:'GEG',severity:'warning',message:'Energy/GEG compliance requires document-specific assessment.'});
  if(s.documentConflict)f.push({code:'DOCUMENT_CONFLICT',severity:'hard',message:'Material cross-document inconsistency detected.'});
  return f;
}
