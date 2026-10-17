export type TaxInput={buildingValue:number; acquisitionDate:Date; plannedModernizationNet:number; annualDepreciation:number; taxableRentalIncome:number};
export function anschaffungsnahe15(input:TaxInput){const threshold=input.buildingValue*0.15;return {threshold,plannedNet:input.plannedModernizationNet,exceeds:input.plannedModernizationNet>threshold,excess:Math.max(0,input.plannedModernizationNet-threshold)};}
export function straightLineAfa(buildingValue:number,rate:number){if(buildingValue<0||rate<0)throw new Error('invalid_afa_input');return buildingValue*rate;}
