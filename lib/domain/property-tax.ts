export type PropertyTaxAssessment={buildingValue:number;modernizationNetWithinThreeYears:number;thresholdRate:number;incomeRelatedAfa:number;specialAfa:number;taxRate:number};
export function assess15Percent(a:PropertyTaxAssessment){const threshold=a.buildingValue*a.thresholdRate;return {threshold,amount:a.modernizationNetWithinThreeYears,exceeds:a.modernizationNetWithinThreeYears>threshold};}
export function annualTaxEffect(a:PropertyTaxAssessment){const deduction=a.incomeRelatedAfa+a.specialAfa;return deduction*a.taxRate;}
