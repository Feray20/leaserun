# -*- coding: utf-8 -*-
"""LeaseRun knowledge center: US rental-investing answers.

Each article: slug, category, title, one-line summary, body (HTML), related tool (path, label).
Facts are general US rules as of 2026; articles tell readers to verify specifics.
"""

CATS = [
    ("basics", "Understand the money"),
    ("start", "Start investing"),
    ("check", "Check a property"),
    ("finance", "Financing"),
    ("tax", "Taxes"),
    ("manage", "Own and manage"),
    ("leaserun", "Using LeaseRun"),
]

def P(*ps): return "".join(f"<p>{p}</p>" for p in ps)
def UL(*li): return "<ul>" + "".join(f"<li>{x}</li>" for x in li) + "</ul>"
def H(t): return f"<h2>{t}</h2>"
def KEY(*li): return '<div class="takeaways"><b>Key takeaways</b>' + UL(*li) + "</div>"

A = []
def art(slug, cat, title, summary, body, tool=None):
    A.append(dict(slug=slug, cat=cat, title=title, summary=summary, body=body, tool=tool))

# ------------------------------------------------------------------ basics
art("how-does-a-rental-property-make-money", "basics", "How does a rental property make money?",
    "Four sources of return: cash flow, loan paydown, appreciation and tax benefits &ndash; and why only the first one pays your bills.",
    P("A rental pays you in four different ways. Only one of them puts money in your bank account every month, which is why experienced investors judge a deal on cash flow first and treat everything else as a bonus.")
    + H("1. Cash flow")
    + P("Cash flow is the rent you collect minus every cost of owning the home: vacancy, property management, repairs, a reserve for big-ticket items (CapEx), property taxes, insurance, HOA dues and the mortgage payment. If the result is positive, the property pays you. If it is negative, you pay the property.")
    + H("2. Principal paydown")
    + P("Each mortgage payment contains interest and principal. The principal part reduces your loan balance. Because the tenant&rsquo;s rent covers the payment, your equity grows even if the home never gains value. In the early years of a 30-year loan the principal share is small and rises over time.")
    + H("3. Appreciation")
    + P("Homes have historically risen in value over long periods, but not everywhere and not every year. Appreciation is real wealth only when you sell or refinance, and it can reverse. Never buy a property that only works if prices go up.")
    + H("4. Tax benefits")
    + P("The IRS lets you deduct mortgage interest, operating costs and depreciation &ndash; a yearly deduction for wear and tear on the building. Depreciation often makes a cash-flowing rental show a small loss on paper. Whether that loss reduces tax on your salary depends on your income (see the passive loss rules).")
    + KEY("Judge a deal on cash flow after every cost, including repairs and CapEx.",
          "Loan paydown and appreciation build wealth slowly and are not spendable.",
          "Tax benefits are real but depend on your income and must be confirmed with a CPA."),
    ("/analyzer", "Analyze a property"))

art("cap-rate-cash-on-cash-irr", "basics", "Cap rate, cash-on-cash or IRR: which number matters?",
    "What each return metric measures, how to calculate it and when it misleads.",
    P("Return metrics answer different questions. Using the wrong one is the most common way new investors talk themselves into a bad deal.")
    + H("Cap rate")
    + P("Cap rate = net operating income (NOI) &divide; purchase price. NOI is rent minus vacancy and operating costs, <b>before</b> the mortgage. It describes the property, not your financing, so you can compare a house in Ohio with a duplex in Texas. Compare the cap rate with your mortgage rate: if the cap rate is lower, borrowing makes your return worse (negative leverage).")
    + H("Cash-on-cash return")
    + P("Cash-on-cash = yearly cash flow after the mortgage &divide; cash you invested (down payment, closing costs, repairs). It answers: what does my money earn this year? It ignores loan paydown, appreciation and taxes.")
    + H("IRR")
    + P("The internal rate of return combines every yearly cash flow plus the sale proceeds into one annual rate. It is the best single measure of the whole investment, but it depends heavily on assumptions about rent growth, appreciation and the sale price. Small changes in those assumptions move the IRR a lot.")
    + H("DSCR")
    + P("The debt service coverage ratio divides NOI by the yearly loan payments. Lenders use it to decide whether the property can carry its loan. Below 1.00 the rent does not cover the debt.")
    + KEY("Cap rate compares properties; cash-on-cash compares uses of your cash.",
          "IRR is only as good as its assumptions &ndash; check the stress test.",
          "A cap rate below your interest rate is a warning sign."),
    ("/analyzer", "See all metrics for a property"))

art("what-is-pitia", "basics", "What is PITIA?",
    "Principal, interest, taxes, insurance and association dues &ndash; the full monthly cost lenders look at.",
    P("PITIA stands for <b>P</b>rincipal, <b>I</b>nterest, <b>T</b>axes, <b>I</b>nsurance and <b>A</b>ssociation dues. It is the complete monthly housing payment for a property, and it is the number lenders use for debt-to-income, DSCR and reserve calculations.")
    + H("Why the mortgage payment alone is misleading")
    + P("Online mortgage calculators often show only principal and interest. On a rental, property taxes and landlord insurance can add 30&ndash;60% on top, especially in high-tax states such as New Jersey, Illinois or Texas. If the loan has an escrow account, the servicer collects taxes and insurance monthly with the payment.")
    + H("Where to find real numbers")
    + UL("Taxes: the county assessor or treasurer website. Ask whether the assessment will reset after the sale &ndash; in many states it does.",
         "Insurance: a quote for a landlord (dwelling fire, usually DP-3) policy, not a homeowner policy.",
         "HOA: the dues and any special assessments from the resale certificate or HOA disclosure.",
         "Principal and interest: page 1 of your Loan Estimate.")
    + KEY("Always compare rent with PITIA, not with principal and interest.",
          "Lenders require reserves measured in months of PITIA."),
    ("/analyzer", "Calculate PITIA"))

art("50-percent-rule-operating-expenses", "basics", "What does it cost to run a rental?",
    "Vacancy, management, repairs, CapEx, taxes and insurance &ndash; realistic ranges and the 50% rule of thumb.",
    P("New investors underestimate operating costs more than any other number. A realistic budget protects you from a property that looks great on paper and drains your account in year two.")
    + H("Typical ranges for single-family rentals")
    + '<table class="tbl"><thead><tr><th>Cost</th><th>Typical range</th></tr></thead><tbody>'
      '<tr><td>Vacancy and turnover</td><td>5&ndash;8% of rent</td></tr>'
      '<tr><td>Property management</td><td>8&ndash;10% of collected rent, plus leasing fees</td></tr>'
      '<tr><td>Repairs and maintenance</td><td>5&ndash;10% of rent (more for older homes)</td></tr>'
      '<tr><td>CapEx reserve (roof, HVAC, water heater)</td><td>5&ndash;10% of rent</td></tr>'
      '<tr><td>Property taxes</td><td>about 0.3&ndash;2.2% of value per year, by state and county</td></tr>'
      '<tr><td>Landlord insurance</td><td>often $1,000&ndash;$3,000 per year, more in coastal and wildfire areas</td></tr></tbody></table>'
    + H("The 50% rule")
    + P("A quick screening rule says operating costs (not the mortgage) eat about half of the rent over time. It is crude, but if your detailed budget comes out far below 50%, double-check it.")
    + H("Self-managing")
    + P("Managing yourself saves the management fee but costs time. Many investors budget a management fee anyway, so the deal still works if they hire help later.")
    + KEY("Budget for vacancy, repairs and CapEx even on a renovated home.",
          "Replace state averages for taxes and insurance with real quotes."),
    ("/analyzer", "Build a full operating budget"))

art("how-wealth-grows-savings-rate-compounding", "basics", "How does wealth grow? Savings rate, return and compounding",
    "Why your savings rate matters more than picking the perfect deal in the first years.",
    P("Wealth comes from three levers: how much you save, what that money earns and how long it compounds. In the first years the savings rate dominates: earning 10% on $10,000 adds $1,000, while saving an extra $500 a month adds $6,000.")
    + H("Where real estate fits")
    + P("Real estate combines a modest cash return with leverage. If a property rises 3% in value and you put 25% down, your equity gains about 12% from appreciation alone &ndash; before cash flow and loan paydown. Leverage works the same way in reverse when prices fall, which is why reserves matter.")
    + H("An emergency fund comes first")
    + P("Before buying a rental, keep three to six months of personal expenses separate from the property reserves. A rental should never be the reason you miss your own mortgage or rent.")
    + KEY("Increase savings first; it is the lever you control.", "Leverage magnifies gains and losses.", "Separate personal emergency funds from property reserves."))

# ------------------------------------------------------------------ start
art("how-much-money-to-buy-first-rental", "start", "How much money do I need to buy my first rental?",
    "Down payment, closing costs, repairs and reserves &ndash; the real cash requirement.",
    P("The cash you need is far more than the down payment. Add up four buckets:")
    + UL("<b>Down payment:</b> usually 20&ndash;25% of the price for an investment-property loan. Some conventional loans allow 15% on a single-unit rental with mortgage insurance; 2&ndash;4 units generally need 25%.",
         "<b>Closing costs:</b> typically 2&ndash;5% of the price: lender fees, appraisal, title insurance, recording, prepaid taxes, insurance and interest.",
         "<b>Make-ready repairs:</b> paint, flooring, appliances and anything the inspection finds.",
         "<b>Reserves:</b> lenders commonly require six months of PITIA in the bank after closing; more if you already own financed properties.")
    + H("Example")
    + P("A $200,000 home with 25% down needs about $50,000 down, $6,000&ndash;$10,000 in closing costs, perhaps $5,000 in repairs and around $9,000 in reserves &ndash; roughly $70,000 in total.")
    + H("Lower-cash routes")
    + UL("House hacking: live in one unit of a 2&ndash;4 unit property with an FHA (3.5% down) or VA loan.",
         "Seller credits toward closing costs, negotiated in the offer.",
         "Buying below value and refinancing later (BRRRR) &ndash; higher risk and more work.")
    + KEY("Plan for about 30&ndash;35% of the price in total cash for a typical investment loan.",
          "Reserves are not optional; lenders verify them."),
    ("/start", "Run your first rental in 3 steps"))

art("how-much-can-i-afford-as-investor", "start", "How much property can I afford as an investor?",
    "Debt-to-income, how lenders count rent, and why DSCR loans change the math.",
    P("Affordability has two limits: your cash and your debt-to-income ratio (DTI). The lower of the two decides your price range.")
    + H("Debt-to-income")
    + P("DTI = all monthly debt payments &divide; gross monthly income. Conventional lenders usually cap DTI around 45&ndash;50%. For a rental, many lenders add the new PITIA to your debts and count about 75% of the expected rent as income (the 25% haircut covers vacancy and costs). A rental that clearly cash-flows can therefore add little to your DTI.")
    + H("Cash")
    + P("Divide the cash you can invest by about 0.33 (25% down + closing costs + reserves) for a rough maximum price.")
    + H("DSCR loans")
    + P("DSCR lenders do not look at your personal income. They qualify the property: the rent must cover PITIA, often with a ratio of 1.0&ndash;1.25. This helps self-employed investors and those who already own several rentals, but rates and fees are higher.")
    + KEY("Your price range is the lower of the cash limit and the DTI limit.",
          "Lenders usually count 75% of rent as income."),
    ("/app/profile", "Calculate your buying power"))

art("first-rental-step-by-step", "start", "Buying a rental in the US: the steps in order",
    "From budget to keys: pre-approval, search, offer, inspection, appraisal, closing and leasing.",
    "<ol class=\"steps-list\">"
    "<li><b>Know your numbers.</b> Income, debts, cash, credit score. Decide how much you can invest and keep in reserve.</li>"
    "<li><b>Get pre-approved.</b> Apply with two or three lenders on the same day and compare the Loan Estimates. A pre-approval letter makes your offer credible.</li>"
    "<li><b>Choose a market and a buy box.</b> Price range, property type, neighborhoods, minimum cash flow.</li>"
    "<li><b>Analyze properties.</b> Real rent comps, the property tax bill, an insurance quote, HOA rules. Run the stress test.</li>"
    "<li><b>Make an offer.</b> Your agent writes it on the state purchase agreement. Keep inspection, financing and appraisal contingencies. Deposit earnest money (often 1&ndash;3%) with the title or escrow company.</li>"
    "<li><b>Inspection.</b> Hire a licensed inspector within the inspection period. Add a sewer scope and roof check on older homes. Renegotiate or walk away.</li>"
    "<li><b>Appraisal and underwriting.</b> The lender orders the appraisal, often with a rent schedule (Form 1007). Provide documents quickly.</li>"
    "<li><b>Closing.</b> You receive the Closing Disclosure at least three business days before closing. Compare it with the Loan Estimate, wire funds only after confirming instructions by phone with the title company, and sign.</li>"
    "<li><b>Lease up.</b> Make the home rent-ready, set written screening criteria, list it and sign a lease that follows state law.</li>"
    "</ol>"
    + KEY("Do not skip contingencies to win a deal unless you can afford to lose the deposit.",
          "Wire fraud is common: always verify wire instructions by phone."),
    ("/app", "Follow the steps in your dashboard"))

art("house-hacking-fha-va", "start", "House hacking with FHA or VA loans",
    "Live in one unit of a 2&ndash;4 unit building and let the other units pay the mortgage.",
    P("House hacking means buying a small multifamily property, living in one unit and renting the others. Because it is your primary residence, you can use owner-occupant loans with much smaller down payments.")
    + H("FHA")
    + UL("Minimum down payment 3.5% with a qualifying credit score.",
         "You must move in within 60 days and intend to live there at least one year.",
         "For 3&ndash;4 unit properties, the self-sufficiency test applies: 75% of the expected rent must cover the full PITI.",
         "FHA mortgage insurance applies, often for the life of the loan.")
    + H("VA")
    + P("Eligible veterans and service members can buy with no down payment, including 2&ndash;4 unit homes they live in.")
    + H("Conventional")
    + P("Owner-occupied conventional loans on 2&ndash;4 units may allow lower down payments than investment loans; check current guidelines with your lender.")
    + KEY("Owner-occupant loans require that you really live there.", "Run the numbers as if you had to move out and rent your unit too."))

art("investor-strategies-turnkey-brrrr", "start", "Which strategy fits me? Turnkey, BRRRR, house hack, DSCR",
    "The main US rental strategies compared by cash, time and risk.",
    '<table class="tbl"><thead><tr><th>Strategy</th><th>Cash</th><th>Time</th><th>Risk</th></tr></thead><tbody>'
    '<tr><td><b>House hack</b> &ndash; live in one unit</td><td>low</td><td>medium</td><td>low&ndash;medium</td></tr>'
    '<tr><td><b>Turnkey</b> &ndash; renovated, often tenanted</td><td>medium</td><td>low</td><td>medium (price paid, remote market)</td></tr>'
    '<tr><td><b>Buy and hold</b> &ndash; you find and prepare the home</td><td>medium</td><td>medium</td><td>medium</td></tr>'
    '<tr><td><b>BRRRR</b> &ndash; buy, rehab, rent, refinance, repeat</td><td>high at first</td><td>high</td><td>high (rehab and refinance risk)</td></tr>'
    '<tr><td><b>DSCR / LLC scaling</b></td><td>medium&ndash;high</td><td>medium</td><td>medium (higher rates)</td></tr></tbody></table>'
    + P("There is no best strategy, only one that fits your cash, time, skills and nerves. Most investors start with a house hack or a simple buy-and-hold property and move to more complex strategies once they have reserves and experience.")
    + KEY("Match the strategy to your time and cash, not to what is popular online."),
    ("/profiler", "Take the investor profiler"))

# ------------------------------------------------------------------ check
art("how-to-estimate-rent", "check", "How do I estimate the rent?",
    "Rent comps, HUD Fair Market Rents and the appraiser&rsquo;s rent schedule.",
    P("Rent is the most important input in your analysis, and the seller&rsquo;s listing is the least reliable source for it.")
    + H("Good sources")
    + UL("Homes of similar size and condition currently listed for rent within about a mile, and those recently leased.",
         "Local property managers: ask what they would list the home for and how long it would take to lease.",
         "HUD Fair Market Rents for your county, a useful sanity check and relevant if you accept Housing Choice Vouchers.",
         "The appraiser&rsquo;s comparable rent schedule (Fannie Mae Form 1007), which many lenders order for investment loans.")
    + H("Adjust for differences")
    + P("Bedrooms, bathrooms, garage, yard, laundry, school district and condition change rent. Be conservative: use the middle of the range, not the top.")
    + KEY("Never use the seller&rsquo;s projected rent without checking comps.", "Lenders may use the appraiser&rsquo;s rent, not yours."),
    ("/analyzer", "Enter your rent comps"))

art("how-to-check-a-property", "check", "How do I check a property before buying?",
    "Inspection, sewer scope, roof, HVAC, permits, flood zone, HOA and lead paint.",
    P("A home inspection is the single best investment in the buying process. Use your inspection period fully.")
    + H("What to look at")
    + UL("<b>Roof, HVAC, water heater, electrical panel:</b> age and remaining life drive your CapEx budget.",
         "<b>Foundation and drainage:</b> cracks, water in the basement or crawl space.",
         "<b>Sewer line:</b> a camera sewer scope on homes older than about 30 years or with large trees.",
         "<b>Permits:</b> unpermitted additions or conversions can be a lender, insurance and safety problem.",
         "<b>Flood zone:</b> check the FEMA flood map; lenders require flood insurance in high-risk zones.",
         "<b>HOA:</b> rental caps, minimum lease terms, special assessments and reserve study.",
         "<b>Lead-based paint:</b> homes built before 1978 require federal lead disclosures to tenants.")
    + H("Price")
    + P("Compare the price per square foot with recent sales of similar homes. If the price is well above the comps, the appraisal may come in low.")
    + KEY("Budget for the big items the inspection reveals.", "Read the HOA documents before the contingency ends."),
    ("/app/tools?t=price", "Run a price check"))

art("making-an-offer-contingencies", "check", "Making an offer: contingencies and earnest money",
    "What protects your deposit and what to negotiate.",
    P("In the US, offers are written on a state or regional purchase agreement, usually by a buyer&rsquo;s agent. The key protections are contingencies &ndash; conditions under which you can cancel and get your earnest money back.")
    + UL("<b>Inspection contingency:</b> commonly 7&ndash;14 days to inspect and negotiate or cancel.",
         "<b>Financing contingency:</b> protects you if the loan is not approved by a deadline.",
         "<b>Appraisal contingency:</b> protects you if the home appraises below the price.",
         "<b>Title contingency:</b> lets you cancel over title defects.")
    + H("Earnest money")
    + P("Often 1&ndash;3% of the price, held by the title or escrow company. If you miss a contingency deadline, you may lose it.")
    + H("Negotiating")
    + P("Price is only one lever. Seller credits toward closing costs, a home warranty, repair credits after inspection and closing timing all have value.")
    + KEY("Calendar every contingency deadline on the day you sign.", "Offer a price where the stress test still works."),
    ("/app/tools?t=letter", "Draft an offer letter"))

art("property-taxes-for-rentals", "check", "How do property taxes work on a rental?",
    "Assessment, reassessment after a sale and why homestead exemptions do not apply.",
    P("Property taxes are set by counties, cities and school districts. The bill equals the assessed value times the local tax rate, minus exemptions.")
    + UL("Many states reassess at or near the sale price after a purchase. The seller&rsquo;s current bill can understate your future taxes.",
         "Homestead exemptions and caps usually apply only to owner-occupied homes. A rental often pays more than the neighbor who lives in her home.",
         "Some states cap annual increases (for example California under Proposition 13); others reassess yearly.",
         "You can usually appeal an assessment if comparable homes are assessed lower.")
    + KEY("Ask the assessor how the bill will change after you buy.", "Do not assume the seller&rsquo;s exemptions transfer to you."),
    ("/analyzer", "Enter your tax estimate"))

art("landlord-insurance", "check", "What insurance does a rental need?",
    "Landlord (DP-3) policy, liability, flood, and an umbrella.",
    UL("<b>Landlord or dwelling fire policy (DP-3):</b> covers the building and your liability; it replaces a homeowner policy. It also often covers lost rent after a covered loss.",
       "<b>Flood insurance:</b> standard policies exclude flood. Required by lenders in FEMA high-risk zones and worth considering elsewhere.",
       "<b>Umbrella policy:</b> extra liability coverage across your properties at relatively low cost.",
       "<b>Renters insurance:</b> many landlords require tenants to carry it for their belongings and liability.")
    + P("Insurance costs have risen sharply in parts of Florida, Louisiana, California and other high-risk areas. Get a quote before you make an offer, not after.")
    + KEY("A homeowner policy does not cover a rented home.", "Quote insurance during your inspection period."))

# ------------------------------------------------------------------ finance
art("conventional-investment-property-loans", "finance", "Conventional loans for investment properties",
    "Down payment, reserves, property limits and what lenders check.",
    P("Most first rentals are financed with a conventional loan sold to Fannie Mae or Freddie Mac. Investment-property loans have stricter rules than loans for a home you live in.")
    + UL("<b>Down payment:</b> typically 15&ndash;25% for one unit and 25% for 2&ndash;4 units. Below 20% means mortgage insurance and higher pricing.",
         "<b>Rates:</b> usually higher than owner-occupied rates because of risk-based pricing adjustments.",
         "<b>Reserves:</b> commonly six months of PITIA for the subject property, plus additional reserves for other financed properties.",
         "<b>Number of properties:</b> Fannie Mae allows up to ten financed properties per borrower under its guidelines.",
         "<b>Income:</b> rental income is usually counted at 75% of the lease or market rent.",
         "<b>Vesting:</b> conventional loans are made to individuals, not LLCs.")
    + KEY("Compare Loan Estimates from several lenders on the same day.", "Guidelines change; ask your lender for current requirements."),
    ("/app/tools?t=offers", "Compare Loan Estimates"))

art("dscr-loans-explained", "finance", "DSCR loans explained",
    "Loans qualified on the property&rsquo;s rent instead of your income.",
    P("A debt service coverage ratio (DSCR) loan is a non-QM loan for investors. The lender checks whether the property&rsquo;s rent covers its PITIA instead of verifying your personal income with tax returns.")
    + H("Typical features")
    + UL("Minimum DSCR around 1.0&ndash;1.25 (rent &divide; PITIA).",
         "Usually 20&ndash;25% down; credit score requirements vary by lender.",
         "Can close in an LLC, usually with a personal guarantee.",
         "Higher rates and fees than conventional loans.",
         "Often a prepayment penalty for the first few years, for example a declining 5-4-3-2-1% schedule.")
    + H("When it makes sense")
    + P("For self-employed investors whose tax returns show low income, investors who have reached conventional loan limits, and purchases in an LLC.")
    + KEY("Read the prepayment penalty clause before you sign.", "Two DSCR numbers exist: lenders mostly use rent &divide; PITIA."),
    ("/analyzer", "Check your DSCR"))

art("closing-costs-loan-estimate", "finance", "Closing costs, the Loan Estimate and the Closing Disclosure",
    "What you pay at closing and how federal rules help you compare lenders.",
    P("Federal rules (TRID) give you two standard forms. The <b>Loan Estimate</b> must arrive within three business days of your application. The <b>Closing Disclosure</b> must arrive at least three business days before closing.")
    + H("What closing costs include")
    + UL("Section A &ndash; origination charges: points, underwriting and processing fees. Compare these between lenders.",
         "Sections B and C &ndash; services: appraisal, credit report, title insurance and settlement. Some you can shop for.",
         "Section E &ndash; taxes and government fees: recording fees and, in some places, transfer taxes.",
         "Sections F and G &ndash; prepaids and initial escrow: homeowner insurance premium, property taxes, prepaid interest.")
    + P("Who pays transfer tax varies by state and is negotiable. Total buyer closing costs often run 2&ndash;5% of the price.")
    + KEY("Compare Section A between lenders; it is where they differ most.", "Expect prepaids and escrow even if you pay no points."),
    ("/app/tools?t=closing", "Estimate closing costs"))

art("refinance-and-cash-out", "finance", "Refinancing and cash-out on a rental",
    "When a refinance pays off, seasoning rules and cash-out limits.",
    P("A rate-and-term refinance replaces your loan with a cheaper one. A cash-out refinance borrows more than you owe and pays you the difference.")
    + UL("<b>Break-even:</b> divide the refinance costs by the monthly saving. If you will sell before then, it does not pay off.",
         "<b>Cash-out limits:</b> for conventional investment properties, commonly up to 75% of value for one unit and 70% for 2&ndash;4 units.",
         "<b>Seasoning:</b> many lenders require you to have owned the property for six to twelve months before a cash-out refinance.",
         "<b>Reset:</b> a new 30-year loan restarts amortization, so less of each payment goes to principal at first.")
    + KEY("Refinance for numbers, not for headlines about rates.", "Cash-out raises your payment; re-run the stress test."),
    ("/app/tools?t=refi", "Model a refinance"))

art("interest-rate-risk-arms", "finance", "Interest-rate risk and adjustable-rate mortgages",
    "Why investors stress-test rates, and how ARM caps work.",
    P("A 30-year fixed-rate mortgage removes rate risk for the life of the loan, which is why it is the US standard. Adjustable-rate mortgages (ARMs) start with a fixed period, often five or seven years, and then adjust periodically within caps.")
    + UL("Caps are often written like 2/1/5 or 5/1/5: the first adjustment, later adjustments and the lifetime maximum in percentage points.",
         "DSCR and commercial loans may have balloon payments or shorter terms.",
         "Even with a fixed rate, you face rate risk when you refinance or sell into a market where buyers pay higher rates.")
    + KEY("Stress-test every deal at your rate plus two points.", "Know when your fixed period ends."),
    ("/app/tools?t=portfolio", "Run the portfolio stress test"))

art("should-i-buy-in-an-llc", "finance", "Should I buy my rental in an LLC?",
    "Liability, financing, insurance and the due-on-sale clause.",
    P("An LLC can separate a property&rsquo;s liabilities from your personal assets, but it is not automatic protection and it has costs.")
    + H("Pros")
    + UL("A layer of liability protection when you keep finances separate and follow formalities.", "Privacy in some states.", "Easier to add partners.")
    + H("Cons")
    + UL("Conventional loans are made to individuals; LLC purchases usually mean DSCR or commercial loans at higher rates.",
         "Transferring a financed property into an LLC can trigger the loan&rsquo;s due-on-sale clause; ask your lender first.",
         "State filing fees and annual taxes (for example California&rsquo;s minimum franchise tax).",
         "Insurance must name the LLC.")
    + P("Good insurance and an umbrella policy are the first line of protection either way. Ask an attorney in the property&rsquo;s state.")
    + KEY("An LLC changes your financing options.", "Talk to a local attorney and your CPA before setting one up."))

# ------------------------------------------------------------------ tax
art("rental-property-depreciation", "tax", "How does depreciation on a rental work?",
    "27.5 years, the land split, mid-month convention and recapture when you sell.",
    P("Residential rental buildings are depreciated over 27.5 years using the straight-line method. Each year you deduct about 3.6% of the building&rsquo;s cost basis.")
    + UL("<b>Land is not depreciable.</b> Split the purchase price between land and building, often using the county assessor&rsquo;s ratio.",
         "<b>Basis</b> includes the price plus certain acquisition costs such as title fees and recording, plus improvements. Loan costs are amortized separately.",
         "<b>Mid-month convention:</b> in the first year you deduct from the middle of the month the property is placed in service.",
         "<b>Improvements</b> (a new roof) are depreciated; repairs (fixing a leak) are deducted in the year paid.",
         "<b>Cost segregation</b> studies can move parts of the property into shorter lives; 2025 tax legislation restored 100% bonus depreciation for qualifying property, so ask your CPA whether it applies.",
         "<b>Recapture:</b> when you sell, depreciation taken is taxed at up to 25% unless you use a 1031 exchange.")
    + KEY("Depreciation reduces taxable income but not cash flow.", "Keep records of every improvement for your basis."),
    ("/analyzer", "See depreciation for a property"))

art("passive-activity-loss-rules", "tax", "Can rental losses reduce tax on my salary?",
    "The $25,000 allowance, the income phase-out and real estate professional status.",
    P("Rental income is generally passive. Passive losses can only offset passive income, with one important exception for small landlords.")
    + UL("<b>$25,000 special allowance:</b> if you actively participate (you approve tenants, set rent and approve repairs), up to $25,000 of rental losses can offset wages and other income.",
         "<b>Phase-out:</b> the allowance shrinks by $1 for every $2 of modified adjusted gross income above $100,000 and disappears at $150,000.",
         "<b>Suspended losses</b> carry forward and are released when you sell the property.",
         "<b>Real estate professional status</b> requires more than 750 hours per year in real property trades and more than half of your working time; it lets losses be non-passive.",
         "Short-term rentals with average stays of seven days or less follow different rules.")
    + KEY("High earners often cannot use rental losses right away.", "Losses are not lost; they wait for future income or a sale."),
    ("/analyzer", "Estimate your year-one tax"))

art("schedule-e-basics", "tax", "Reporting a rental on Schedule E",
    "Which income and expenses go on which line.",
    P("Most individual landlords report each rental on Schedule E of Form 1040.")
    + '<table class="tbl"><thead><tr><th>Line</th><th>Item</th></tr></thead><tbody>'
      '<tr><td>3</td><td>Rents received</td></tr><tr><td>5</td><td>Advertising</td></tr><tr><td>6</td><td>Auto and travel</td></tr>'
      '<tr><td>7</td><td>Cleaning and maintenance</td></tr><tr><td>9</td><td>Insurance</td></tr><tr><td>10</td><td>Legal and other professional fees</td></tr>'
      '<tr><td>11</td><td>Management fees</td></tr><tr><td>12</td><td>Mortgage interest paid to banks</td></tr><tr><td>14</td><td>Repairs</td></tr>'
      '<tr><td>16</td><td>Taxes</td></tr><tr><td>17</td><td>Utilities</td></tr><tr><td>18</td><td>Depreciation (from Form 4562)</td></tr><tr><td>19</td><td>Other</td></tr></tbody></table>'
    + P("Keep receipts and a separate bank account for each property or LLC. A CPA can tell you which costs are repairs and which are improvements.")
    + KEY("Separate accounts make Schedule E easy.", "Mortgage principal is not deductible; interest is."),
    ("/app/tools?t=schedule", "Export Schedule E estimates"))

art("1031-exchange-basics", "tax", "How does a 1031 exchange work?",
    "Defer capital gains and recapture by reinvesting in like-kind real estate.",
    P("Section 1031 lets you defer capital gains tax and depreciation recapture when you sell investment real estate and buy other investment real estate.")
    + UL("<b>45 days:</b> from the sale closing, you must identify replacement properties in writing.",
         "<b>180 days:</b> you must close on the replacement within 180 days of the sale, or by your tax return due date (including extensions) if earlier.",
         "<b>Qualified intermediary:</b> the sale proceeds must go to a QI. If you touch the money, the exchange fails.",
         "<b>Like-kind:</b> since 2018, only real property qualifies. Most US investment real estate is like-kind to other US investment real estate.",
         "<b>Boot:</b> cash you take out or debt you do not replace is taxable.",
         "<b>Primary residences and fix-and-flip inventory</b> do not qualify.")
    + KEY("Engage a qualified intermediary before you close the sale.", "Count the deadlines in calendar days &ndash; weekends count."),
    ("/deadlines", "Calculate your 1031 deadlines"))

art("selling-a-rental-taxes", "tax", "What taxes do I pay when I sell a rental?",
    "Capital gains, depreciation recapture, net investment income tax and state tax.",
    UL("<b>Long-term capital gains</b> (held over one year): federal rates of 0%, 15% or 20% depending on income.",
       "<b>Depreciation recapture:</b> the depreciation you took (or could have taken) is taxed at up to 25%.",
       "<b>Net investment income tax:</b> 3.8% on investment income for higher earners.",
       "<b>State income tax</b> in most states.",
       "<b>Suspended passive losses</b> are released in the year of sale and can offset the gain.")
    + P("Alternatives to selling outright include a 1031 exchange, a cash-out refinance (no tax, but more debt) or holding the property until death, when heirs generally receive a stepped-up basis.")
    + KEY("Recapture applies even if you never claimed depreciation.", "Model the after-tax proceeds before you list."),
    ("/scenarios", "Compare selling and holding"))

# ------------------------------------------------------------------ manage
art("tenant-screening-fair-housing", "manage", "Screening tenants and fair housing",
    "Written criteria, protected classes, credit reports and adverse action notices.",
    P("The federal Fair Housing Act prohibits discrimination based on race, color, religion, sex, national origin, familial status and disability. Many states and cities add more protected classes, such as sexual orientation, gender identity, source of income (housing vouchers), age or rules on criminal history.")
    + H("A fair process")
    + UL("Write your criteria before you advertise: income (for example 3x rent), credit, rental history, eviction records.",
         "Apply the same criteria to every applicant, in order of complete applications.",
         "Allow reasonable accommodations and modifications for people with disabilities, including assistance animals.",
         "If you deny or add conditions based on a credit or background report, send an adverse action notice under the Fair Credit Reporting Act.",
         "Avoid ads that describe people (&ldquo;ideal for singles&rdquo;); describe the property instead.")
    + KEY("Consistency is your best protection.", "Check state and city rules; they are often stricter than federal law."))

art("security-deposits-and-leases", "manage", "Security deposits and leases",
    "State limits, return deadlines and what a lease should cover.",
    P("Landlord-tenant law is mostly state law, so the rules depend on where the property is.")
    + UL("<b>Deposit limits:</b> some states cap deposits (for example one or two months of rent); others have no cap.",
         "<b>Return deadlines:</b> commonly 14 to 45 days after move-out, with an itemized list of deductions.",
         "<b>Separate accounts or interest:</b> some states and cities require it.",
         "<b>Required disclosures:</b> lead-based paint for pre-1978 homes, plus state-specific notices (mold, flood, bed bugs and others).",
         "<b>Lease basics:</b> term, rent and due date, late fees within state limits, maintenance duties, entry notice, pets, utilities.")
    + KEY("Use a lease written for your state.", "Document condition with dated photos at move-in and move-out."))

art("late-rent-and-evictions", "manage", "What if the tenant does not pay?",
    "Notices, the court process and why self-help evictions are illegal.",
    P("Talk to the tenant early. Many payment problems can be solved with a short payment plan documented in writing.")
    + H("The formal process")
    + UL("Serve the state-required notice (often called a pay-or-quit notice) with the correct deadline and delivery method.",
         "If the tenant does not pay or move, file an eviction (unlawful detainer) case in the local court.",
         "Only a law enforcement officer can carry out the court&rsquo;s order to remove a tenant.",
         "Never change locks, remove belongings or shut off utilities yourself: self-help evictions are illegal and can lead to damages.")
    + P("Timelines range from a few weeks to several months depending on the state and court backlog. Budget for it with your vacancy and reserves.")
    + KEY("Follow the exact notice rules; mistakes restart the clock.", "A local attorney or experienced manager is worth the fee."))

# ------------------------------------------------------------------ leaserun
art("what-data-does-leaserun-store", "leaserun", "What data does LeaseRun store and who can see it?",
    "Your account, profile and properties are private to you.",
    UL("<b>Account:</b> your email address and a securely hashed password, managed by our authentication provider.",
       "<b>Investor profile:</b> the income, debts, cash, credit range and tax figures you enter. They are used only for your calculations.",
       "<b>Properties:</b> the inputs you save for each property.",
       "<b>Access:</b> database rules allow only your signed-in account to read or change your profile and properties. We do not sell personal information.",
       "<b>Never store</b> Social Security numbers, bank account numbers or tax returns in LeaseRun. The lender package lists documents, it does not collect them.")
    + P("You can download all your data from your investor profile page at any time and ask us to delete your account.")
    + KEY("Only you can see your numbers.", "Do not enter sensitive identification numbers."),
    ("/app/profile", "Open your profile"))

art("how-to-use-the-lender-package", "leaserun", "How do I use the lender package?",
    "What it contains, how lenders read it and what it is not.",
    P("The lender package summarizes one property and your finances on a few pages: summary, borrower, subject property, sources and uses, proposed financing, income and DSCR, stress test, notes and a document checklist.")
    + UL("Send it with your loan application or bring it to the lender meeting so the loan officer sees the full picture quickly.",
         "Update taxes, insurance and the rate from real quotes before you send it.",
         "Save it as a PDF from the print dialog.")
    + P("It is not a loan application, an appraisal or a pre-approval. The lender&rsquo;s own Loan Estimate, appraisal and underwriting decide the terms.")
    + KEY("Replace every estimate with a real quote before sending."),
    ("/sample-loan-package", "See a sample"))
