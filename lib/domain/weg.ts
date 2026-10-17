export type WegAssessment={hoaReserveTotal?:number;ownerReserveShare?:number;annualHouseMoney?:number;mea?:number;specialAssessments:Array<{amount:number;dueDate?:string;resolutionDate?:string;purpose:string}>;recentMinutesIds:string[];riskNotes:string[]};
export function specialAssessmentExposure(w:WegAssessment){return w.specialAssessments.reduce((s,x)=>s+Math.max(0,x.amount),0);}
export function propertySpecialAssessment(totalAmount:number,mea:number){return totalAmount*Math.max(0,mea);}
export function reserveUndercoverage(expectedMaintenance:number,relevantReserve:number){return Math.max(0,expectedMaintenance-relevantReserve);}
