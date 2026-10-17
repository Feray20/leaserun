import { StressCase, UnderwritingInput, underwrite } from './engine';

export function scenarioMatrix(input: UnderwritingInput) {
  const cases: StressCase[] = [];
  for (const rate of [0.035,0.05,0.065,0.08]) {
    for (const vacancy of [0.02,0.05,0.08,0.12]) {
      cases.push({name:rate===0.035?'best':rate>=0.08||vacancy>=0.12?'worst':'base',interestRate:rate,vacancyRate:vacancy,maintenanceMultiplier:1});
    }
  }
  return cases.map(c=>({stressCase:c,...underwrite(input,[c]).stress[0]}));
}
