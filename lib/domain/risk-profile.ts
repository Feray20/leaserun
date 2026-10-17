export type InvestorProfile = "SUBSTANCE_CONSERVATIVE"|"CASHFLOW_STRATEGIST"|"LEVERAGE_STRATEGIST"|"TAX_ORIENTED"|"BALANCED";
export interface RiskProfileInputs { riskAversion:number; liquidityPreference:number; horizonYears:number; leverageWillingness:number; controlNeed:number; renovationReadiness:number; }
export interface RiskProfileResult { profile:InvestorProfile; scores:Record<InvestorProfile,number>; rationale:string[]; }
