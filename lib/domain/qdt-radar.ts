export interface RadarState { cashflow:number; substance:number; tax:number; downsideRisk:number; }
export interface ScenarioDelta { interestRateDelta:number; vacancyDelta:number; maintenanceDelta:number; }
export type RadarMode="QDT_INSPIRED";
export function applyScenario(base:RadarState,delta:ScenarioDelta):RadarState{return {...base,downsideRisk:Math.max(0,Math.min(100,base.downsideRisk+delta.interestRateDelta*20+delta.vacancyDelta*10+delta.maintenanceDelta*0.01)),cashflow:Math.max(0,base.cashflow-delta.interestRateDelta*10-delta.vacancyDelta*10-delta.maintenanceDelta*0.01)}}
