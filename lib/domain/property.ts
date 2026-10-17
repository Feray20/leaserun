export interface PropertyAddress { street:string; houseNumber:string; postalCode:string; city:string; country:string; }
export interface PropertyEvidenceRef { documentId:string; page?:number; field:string; confidence:number; extractionMethod?:string; excerptHash?:string; }
export interface EvidencedValue<T> { value:T; evidence:PropertyEvidenceRef[]; reviewRequired:boolean; }
export interface Property {
 id:string; address:PropertyAddress;
 parcel?:{ district?:string; parcelNumber?:string; landAreaM2?:number; flur?:string; flurstueck?:string };
 area?:{ residentialM2?:number; usableM2?:number };
 construction?:{ yearBuilt?:number; renovationYear?:number; heatingType?:string; heatGeneratorYear?:number };
 energy?:{ consumptionKwhM2a?:number; primaryEnergyDemandKwhM2a?:number; efficiencyClass?:string };
 acquisition?:{ purchasePriceEur?:number; acquisitionCostsEur?:number; transferTaxEur?:number; brokerEur?:number; notaryEur?:number; landRegistryEur?:number };
 valuation?:{ marketValueEur?:number; mortgageLendingValueEur?:number; buildingShare?:number; landShare?:number };
 ownership?:{ mea?:number; structure?:string };
 evidence?:Record<string,PropertyEvidenceRef[]>;
 metadata?:{createdAt:string;updatedAt:string;schemaVersion:number};
}
