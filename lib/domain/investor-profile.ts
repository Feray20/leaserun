export type InvestorType="SUBSTANZ_KONSERVATIV"|"CASHFLOW_STRATEGE"|"HEBEL_STRATEGE"|"STEUERORIENTIERT"|"BALANCED";
export interface InvestorProfile{riskAversion:number; liquidityPreference:number; horizonYears:number; leverageReadiness:number; controlNeed:number; renovationReadiness:number; type:InvestorType;}
export interface DecisionRadar{cashflow:number; substance:number; tax:number; downsideRisk:number;}
export function classifyInvestor(p:Omit<InvestorProfile,"type">):InvestorType{if(p.riskAversion>=80)return "SUBSTANZ_KONSERVATIV";if(p.leverageReadiness>=80)return "HEBEL_STRATEGE";if(p.liquidityPreference>=80)return "CASHFLOW_STRATEGE";if(p.horizonYears>=15)return "STEUERORIENTIERT";return "BALANCED";}
