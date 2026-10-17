import type {DocumentRecord,ExtractedField} from './documents';
export type ValidationIssue={code:string;severity:'info'|'warning'|'veto';message:string;sources:string[]};
const num=(d:DocumentRecord,k:string)=>Number(d.fields[k]?.value);
export function validateCrossDocument(docs:DocumentRecord[]):ValidationIssue[]{const issues:ValidationIssue[]=[];const by=(k:string)=>docs.find(d=>d.kind===k);const expose=by('expose'),lease=by('lease'),plan=by('economic_plan'),energy=by('energy_certificate');
 if(expose&&lease){const a=num(expose,'netColdRent'),b=num(lease,'netColdRent');if(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)>1)issues.push({code:'RENT_MISMATCH',severity:'warning',message:'Exposé-Nettokaltmiete weicht vom Mietvertrag ab.',sources:[expose.id,lease.id]});}
 if(expose&&energy){const y=num(expose,'yearBuilt'),e=num(energy,'yearBuilt');if(Number.isFinite(y)&&Number.isFinite(e)&&y!==e)issues.push({code:'YEAR_BUILT_MISMATCH',severity:'warning',message:'Baujahr weicht zwischen Dokumenten ab.',sources:[expose.id,energy.id]});}
 if(plan&&num(plan,'specialAssessmentApproved')===1)issues.push({code:'WEG_SPECIAL_ASSESSMENT',severity:'veto',message:'Beschlossene Sonderumlage erkannt; Betrag und Fälligkeit vor Ankauf prüfen.',sources:[plan.id]});
 return issues;}
