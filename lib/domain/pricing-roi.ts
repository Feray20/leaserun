export interface RoiInput{loanAmount:number;rateImprovement:number;avoidableCost?:number;}
export function annualInterestSaving(i:RoiInput){return i.loanAmount*i.rateImprovement;}
export interface ProductTier{key:"QUICK_CHECK"|"MASTER_SUITE";features:string[];}
export const PRODUCT_TIERS:ProductTier[]=[{key:"QUICK_CHECK",features:["Basisrechner","eingeschränkte Bankmappe"]},{key:"MASTER_SUITE",features:["Underwriting","Data Room","QR","Audit","Training","KI-Unterstützung"]}];
