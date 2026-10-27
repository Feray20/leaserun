// Help for every input field: a "?" next to the label opens a short answer with a link into Learn.
// Works for all forms in the account (financial profile, properties, taxes), also when they are loaded later.
// Links go to the site search so they keep working when Learn articles are renamed.
const W = (q) => `/search?q=${encodeURIComponent(q)}`;
const H = {
  // Financial profile
  employment: ['How you earn your income. Lenders treat W-2 employees, self-employed borrowers (2 years of tax returns), 1099 contractors and retirees differently – it changes the documents they ask for.', 'employment type'],
  netIncome: ['Your gross monthly income before taxes (both borrowers together). Lenders qualify you on gross income. Self-employed: average net profit from the last two tax returns ÷ 12.', 'gross income'],
  equity: ['Cash you can put into the purchase (down payment + closing costs) without touching your emergency fund: checking, savings, brokerage, retirement funds you can access.', 'down payment'],
  targetPrice: ['The purchase price you are aiming for – without closing costs. LeaseRun adds closing costs and the monthly payment.', 'how much house can I afford'],
  householdSize: ['Everyone who lives on your income. Used for your monthly budget; lenders look mainly at your debt-to-income ratio (DTI).', 'monthly budget'],
  creditScore: ['Your FICO score range. Most conventional loans need 620+, FHA 580+; the best rates usually start around 740–760.', 'credit score'],
  monthlyDebts: ['Minimum monthly payments on car loans, student loans, credit cards and other debts. Lenders use them for your back-end DTI.', 'debt-to-income'],
  // Property
  objName: ['A name you recognize the property by, e.g. street and city.', null],
  objPrice: ['Purchase price from the listing or purchase agreement, without closing costs.', 'closing costs'],
  objRent: ['Monthly rent. If you will live there, the rent you save, or 0.', 'rental income'],
  of_area: ['Finished living area in square feet (listing or appraisal).', null],
  of_units: ['Number of units: 1 for a single-family home or condo, 2–4 for a duplex to fourplex.', 'investment property down payment'],
  of_yearBuilt: ['Year the home was built. Homes built before 1978 need a lead-based paint disclosure for tenants.', null],
  of_purchaseCostPct: ['Total closing costs as a percent of the price: transfer tax (buyer share), title insurance, escrow/settlement, recording, lender fees and prepaids – often 2–5%.', 'closing costs'],
  of_taxesAnnual: ['Annual property tax from the listing or county tax bill. It is usually reassessed after a sale.', 'property tax'],
  of_insuranceAnnual: ['Annual homeowners or landlord (DP-3) insurance premium – get a real quote; flood insurance is extra.', 'homeowners insurance'],
  of_hoaMonthly: ['Monthly HOA or condo dues. Lenders count them in your housing payment (PITIA).', 'hoa dues'],
  of_mgmtPct: ['Property management fee as a percent of collected rent, typically 8–10% for single-family rentals. Enter 0 if you self-manage.', 'property management'],
  of_nonRecoverable: ['Other monthly costs you pay as the owner (e.g. utilities, lawn care, pest control) – not taxes, insurance or HOA.', 'operating expenses'],
  of_maintenance: ['Monthly budget for repairs and capital expenses (roof, HVAC, water heater). A common rule is 5–10% of rent each, more for older homes.', 'repairs and capex'],
  of_vacancyPct: ['Allowance for vacancy and unpaid rent, typically 5–8% of annual rent.', 'vacancy rate'],
  of_loan: ['Loan amount. Leave blank: LeaseRun uses price + closing costs − your cash invested.', 'loan to value'],
  of_interestPct: ['Note rate per year from your Loan Estimate (not the APR).', 'interest rate'],
  of_termYears: ['Length of the loan in years – 30 is the US standard, 15 builds equity faster.', 'amortization'],
  of_lendingValue: ['Appraised value from the lender\'s appraisal. LTV is based on the lower of price and appraised value.', 'appraisal'],
  of_equity: ['Cash you put into exactly this property (down payment plus closing costs).', 'down payment'],
  of_buildingSharePct: ['Share of the price that is the building (land is not depreciable). Often taken from the county assessor\'s land/improvement split.', 'depreciation'],
  of_marginalTaxPct: ['Your combined federal and state tax rate on your next dollar of income – shows what deductions and depreciation are worth.', 'marginal tax rate'],
  of_renovationNet3y: ['What you plan to spend on repairs and improvements in the first three years. Improvements are depreciated, repairs deducted – ask your CPA.', 'repairs vs improvements'],
  of_meaShare: ['Condo/HOA: units you own in the association (usually 1). Used for your share of reserves and special assessments.', 'hoa reserves'],
  of_meaTotal: ['Condo/HOA: total number of units in the association.', 'hoa reserves'],
  of_wegReserveTotal: ['Balance of the association\'s reserve fund (HOA budget or resale certificate).', 'hoa reserves'],
  of_wegPlannedTotal: ['Total of projects the HOA plans (reserve study, meeting minutes).', 'hoa reserves'],
  of_wegSpecialTotal: ['Total special assessments the HOA has already approved.', 'special assessment'],
  of_grestPct: ['Transfer or recordation tax the buyer pays in your state, as a percent of the price (0 in many states).', 'transfer tax'],
  of_notaryPct: ['Title insurance, escrow/settlement and recording fees together, often around 1–2% of the price.', 'title insurance'],
  of_brokerPct: ['What you pay your buyer\'s agent, if the seller does not cover it. Since 2024 this is agreed in a written buyer agreement and negotiable.', 'buyer agent commission'],
  of_marketValue: ['What the property would sell for today, e.g. from an appraisal or a broker price opinion.', 'appraisal'],
  of_county: ['County where the deed is recorded – shown on the title commitment and the tax bill.', null],
  of_parcelId: ['Assessor\'s parcel number (APN) from the tax bill or county records.', null],
  of_legalDescription: ['Legal description from the deed or title commitment (lot, block, subdivision).', null],
  of_ownership: ['How title is held (vesting), e.g. sole owner, joint tenancy, tenants in common or an LLC.', null],
  of_landArea: ['Lot size in square feet (1 acre = 43,560 sq ft).', null],
  of_usableArea: ['Area not counted as living area, e.g. unfinished basement or garage.', null],
  of_renovationYear: ['Year of the last major renovation – matters for value and remaining life.', null],
  of_heatingType: ['E.g. gas furnace, heat pump, central air, baseboard – from the listing or inspection.', null],
  of_heatingYear: ['Year the HVAC system was installed – most systems last about 15–20 years.', null],
  of_purchaseDate: ['Closing date of your purchase – starts the capital gains holding period.', 'capital gains'],
  of_payoutDate: ['Date your loan funded – the first payment is usually due on the 1st of the second month after.', null],
  of_fixedYears: ['For an ARM: years until the rate first adjusts (e.g. 5, 7 or 10). Enter 0 for a fixed-rate loan.', 'adjustable rate mortgage'],
  of_lastRentChange: ['Date of the last rent change or lease start – rent increases usually take effect at renewal with written notice.', 'rent increase'],
  of_exchangeSaleDate: ['Only for a 1031 exchange: the closing date of the property you sold. Starts the 45-day and 180-day deadlines.', '1031 exchange'],
  of_vergleichsmieteQm: ['Market rent per square foot per month for comparable rentals nearby.', 'market rent'],
  of_mietpreisbremse: ['Is the unit covered by state or local rent control or rent stabilization (e.g. California AB 1482, Oregon, NYC)? Check your state and city.', 'rent control'],
  of_abt2Open: ['Are there open title issues (liens, easements, lis pendens, encroachments) not yet resolved?', 'title commitment'],
  of_ownerOccupied: ['Will you live in the home? Owner-occupied loans allow lower down payments; PMI applies below 20% down.', 'pmi'],
  of_floodZone: ['Is the property in a FEMA Special Flood Hazard Area? Lenders then require flood insurance.', 'flood insurance'],
  of_liegenschaftszinsPct: ['Market cap rate for the income approach to value, e.g. from an appraiser or local sales.', 'cap rate'],
  of_restnutzungsdauer: ['How many more years the building can economically be used.', null],
  // Deductible rental expenses (Schedule E checklist)
  wk_zins: ['Mortgage interest paid during the year (Form 1098 from your lender) – not the principal.', 'schedule e'],
  wk_haus: ['HOA dues for the rental (special assessments for improvements are capitalized instead).', 'hoa dues'],
  wk_grundst: ['Property taxes paid for the rental (county tax bill).', 'property tax'],
  wk_vers: ['Landlord (DP-3), liability and flood insurance for the rental.', 'landlord insurance'],
  wk_verw: ['Property management fees and leasing fees.', 'property management'],
  wk_erhalt: ['Repairs and maintenance that keep the property in working order – materials and contractors, not your own time.', 'repairs vs improvements'],
  wk_fahrt: ['Miles driven for the rental × the IRS standard mileage rate (showings, repairs, collecting rent).', 'mileage'],
  wk_konto: ['Bank fees, software, postage and phone costs for the rental.', 'schedule e'],
  wk_beratung: ['CPA and legal fees for the rental (prorated if the bill covers more).', 'cpa'],
  wk_makler: ['Advertising and leasing fees to find a tenant (not the agent fees when buying).', 'closing costs'],
  // Tax tools
  s_inv_land: ['State of the property – sets the transfer tax.', 'transfer tax'],
  s_inv_wert: ['Value of personal property bought with the home (e.g. appliances, furniture) – depreciated faster (5 years) than the building.', 'cost segregation'],
  s_vm_ist: ['Rent your relative pays. Renting below fair rental value to family can turn the rental into personal use for tax purposes.', 'renting to family'],
  s_vm_markt: ['Fair market rent for a comparable home nearby.', 'renting to family'],
  s_eh_betrag: ['Cost of a larger project you want to classify.', 'repairs vs improvements'],
  s_eh_jahre: ['Over how many years the amount is spread.', 'repairs vs improvements'],
  s_15_price: ['Purchase price of the property.', 'depreciation'],
  s_15_nk: ['Closing costs in percent (title, recording and transfer tax add to basis; loan costs do not).', 'closing costs'],
  s_15_geb: ['Building share of the price in percent.', 'depreciation'],
  s_15_spent: ['What you have spent on repairs and improvements since the purchase.', 'repairs vs improvements'],
  s_sp_kauf: ['Closing date of your purchase.', 'capital gains'],
  s_sp_verkauf: ['Planned closing date of the sale.', 'capital gains'],
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let n = 0;
export function attachHelp(root = document) {
  for (const [id, [text, slug]] of Object.entries(H)) {
    const el = root.querySelector ? root.querySelector('#' + CSS.escape(id)) : null;
    if (!el || el.dataset.fh) continue;
    el.dataset.fh = '1';
    const label = el.closest('label');
    const host = label || el.parentElement;
    if (!host) continue;
    const bid = 'fh' + (++n);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'fh-btn'; btn.textContent = '?'; btn.setAttribute('aria-label', 'What does this mean?'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', bid);
    const box = document.createElement('span');
    box.className = 'fh-box'; box.id = bid; box.hidden = true;
    box.innerHTML = `${esc(text)}${slug ? ` <a href="${W(slug)}" target="_blank" rel="noopener">Learn more →</a>` : ''}`;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const on = box.hidden; box.hidden = !on; btn.setAttribute('aria-expanded', String(on)); });
    // Button right after the label text, explanation below the field.
    const textNode = label ? [...label.childNodes].find((x) => x.nodeType === 3 && x.textContent.trim()) || label.querySelector('span') : null;
    if (textNode && textNode.nodeType === 3) textNode.after(btn); else if (textNode) textNode.append(btn); else host.insertBefore(btn, el);
    el.after(box);
  }
}

export function watchHelp(root = document.body) {
  attachHelp(document);
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => attachHelp(document), 120); }).observe(root, { childList: true, subtree: true });
}
