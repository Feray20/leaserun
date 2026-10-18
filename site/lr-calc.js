/* LeaseRun underwriting engine (US). Pure functions, no DOM.
 * Works in the browser (window.LRCalc) and in Node (module.exports) for tests.
 * All money in USD, rates in percent (6.75 = 6.75 %). Estimates only.
 */
(function (root) {
  'use strict';

  // Approximate statewide average effective property tax rates (% of home value).
  // Order of magnitude only; the county assessor's bill is what counts.
  var STATE_TAX = {
    AL: 0.39, AK: 1.04, AZ: 0.56, AR: 0.57, CA: 0.71, CO: 0.49, CT: 1.79, DE: 0.53, DC: 0.56, FL: 0.80,
    GA: 0.83, HI: 0.27, ID: 0.56, IL: 2.08, IN: 0.77, IA: 1.43, KS: 1.34, KY: 0.79, LA: 0.51, ME: 1.09,
    MD: 0.99, MA: 1.12, MI: 1.38, MN: 1.05, MS: 0.67, MO: 0.91, MT: 0.68, NE: 1.54, NV: 0.53, NH: 1.93,
    NJ: 2.23, NM: 0.67, NY: 1.40, NC: 0.70, ND: 0.92, OH: 1.41, OK: 0.82, OR: 0.87, PA: 1.36, RI: 1.32,
    SC: 0.51, SD: 1.08, TN: 0.55, TX: 1.58, UT: 0.52, VT: 1.83, VA: 0.75, WA: 0.87, WV: 0.55, WI: 1.51, WY: 0.56
  };
  var STATE_NAMES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
    DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
  };
  // States/cities with statewide or widespread rent regulation worth a flag.
  var RENT_REG = {
    CA: 'California caps annual rent increases on many units (AB 1482) and several cities have stricter local rent control.',
    OR: 'Oregon limits annual rent increases statewide for most buildings older than 15 years.',
    NY: 'New York has rent stabilization in NYC and other localities plus strict tenant-protection rules.',
    DC: 'Washington, DC applies rent control to many older rental buildings.',
    NJ: 'Many New Jersey municipalities have local rent control ordinances.',
    MN: 'St. Paul and Minneapolis have local rent regulation.',
    WA: 'Washington State limits annual rent increases for many units (2025 law).',
    MD: 'Montgomery and Prince George’s Counties and Takoma Park cap rent increases.'
  };

  var DEFAULTS = {
    name: '', state: 'TX', type: 'sfr', units: 1, yearBuilt: 1995, sqft: 1400,
    price: 250000, rehab: 0, arv: 0,
    rent: 2100, otherIncome: 0,
    vacancyPct: 6, mgmtPct: 8, maintPct: 5, capexPct: 5,
    taxesAnnual: null, insuranceAnnual: null, hoaMonthly: 0, utilitiesMonthly: 0,
    loanType: 'conventional', downPct: 25, rate: 7.0, termYears: 30, pointsPct: 0, pmiPct: 0.6,
    lenderFees: 1500, appraisal: 650, inspection: 500, titlePct: 0.5, recording: 1200,
    transferTaxPct: 0, prepaidTaxMonths: 3, prepaidInsMonths: 12, prepaidInterestDays: 15,
    reserveMonths: 6,
    rentGrowth: 3, appreciation: 3, expenseGrowth: 3, holdYears: 10, sellingCostPct: 7,
    landPct: 20, marginalRate: 24, magi: 120000, activeParticipation: true,
    hoaRentalLimits: false, floodZone: false
  };

  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function normalize(input) {
    var p = {}, k;
    input = input || {};
    for (k in DEFAULTS) p[k] = DEFAULTS[k];
    for (k in input) if (input[k] !== undefined && input[k] !== '' && input[k] !== null) p[k] = input[k];
    ['units', 'yearBuilt', 'sqft', 'price', 'rehab', 'arv', 'rent', 'otherIncome', 'vacancyPct', 'mgmtPct', 'maintPct',
      'capexPct', 'hoaMonthly', 'utilitiesMonthly', 'downPct', 'rate', 'termYears', 'pointsPct', 'pmiPct', 'lenderFees',
      'appraisal', 'inspection', 'titlePct', 'recording', 'transferTaxPct', 'prepaidTaxMonths', 'prepaidInsMonths',
      'prepaidInterestDays', 'reserveMonths', 'rentGrowth', 'appreciation', 'expenseGrowth', 'holdYears',
      'sellingCostPct', 'landPct', 'marginalRate', 'magi'].forEach(function (f) { p[f] = Math.max(0, num(p[f], DEFAULTS[f] || 0)); });
    p.state = String(p.state || 'TX').toUpperCase().slice(0, 2);
    if (!STATE_TAX[p.state]) p.state = 'TX';
    p.units = clamp(Math.round(p.units) || 1, 1, 500);
    p.downPct = clamp(p.downPct, 0, 100);
    p.termYears = clamp(Math.round(p.termYears) || 30, 1, 40);
    p.holdYears = clamp(Math.round(p.holdYears) || 10, 1, 30);
    p.landPct = clamp(p.landPct, 0, 90);
    p.marginalRate = clamp(p.marginalRate, 0, 50);
    if (p.loanType === 'cash') p.downPct = 100;
    p.taxesAnnual = input.taxesAnnual === undefined || input.taxesAnnual === '' || input.taxesAnnual === null
      ? Math.round(p.price * STATE_TAX[p.state] / 100) : Math.max(0, num(input.taxesAnnual, 0));
    p.insuranceAnnual = input.insuranceAnnual === undefined || input.insuranceAnnual === '' || input.insuranceAnnual === null
      ? Math.round(Math.max(900, p.price * 0.006) * (p.floodZone ? 1.6 : 1)) : Math.max(0, num(input.insuranceAnnual, 0));
    p.activeParticipation = p.activeParticipation !== false && p.activeParticipation !== 'false';
    p.hoaRentalLimits = p.hoaRentalLimits === true || p.hoaRentalLimits === 'true';
    p.floodZone = p.floodZone === true || p.floodZone === 'true';
    return p;
  }

  function payment(principal, ratePct, years) {
    if (principal <= 0) return 0;
    var r = ratePct / 100 / 12, n = years * 12;
    return r > 0 ? principal * r / (1 - Math.pow(1 + r, -n)) : principal / n;
  }

  function balanceAfter(principal, ratePct, years, months) {
    if (principal <= 0) return 0;
    var r = ratePct / 100 / 12, pmt = payment(principal, ratePct, years);
    if (r === 0) return Math.max(0, principal - pmt * months);
    return Math.max(0, principal * Math.pow(1 + r, months) - pmt * (Math.pow(1 + r, months) - 1) / r);
  }

  // Amortization with optional extra principal per month. Returns months to payoff and interest paid.
  function amortize(principal, ratePct, years, extraMonthly, lumpSum) {
    var r = ratePct / 100 / 12, pmt = payment(principal, ratePct, years), bal = principal - (lumpSum || 0), m = 0, interest = 0;
    extraMonthly = extraMonthly || 0;
    while (bal > 0.005 && m < 1200) {
      var i = bal * r; interest += i;
      bal = bal + i - pmt - extraMonthly; m++;
    }
    return { months: m, interest: interest, payment: pmt };
  }

  function closingCosts(p, loan) {
    var items = [
      ['Lender origination / points', loan * p.pointsPct / 100],
      ['Lender & underwriting fees', loan > 0 ? p.lenderFees : 0],
      ['Appraisal', loan > 0 ? p.appraisal : 0],
      ['Home inspection', p.inspection],
      ['Title insurance & settlement', p.price * p.titlePct / 100],
      ['Recording & escrow fees', p.recording],
      ['Transfer tax (buyer share)', p.price * p.transferTaxPct / 100],
      ['Prepaid property taxes (escrow)', loan > 0 ? p.taxesAnnual / 12 * p.prepaidTaxMonths : 0],
      ['Prepaid insurance', p.insuranceAnnual / 12 * p.prepaidInsMonths],
      ['Prepaid interest', loan * p.rate / 100 / 365 * p.prepaidInterestDays]
    ].map(function (x) { return { label: x[0], amount: Math.round(x[1]) }; }).filter(function (x) { return x.amount > 0; });
    var total = items.reduce(function (s, x) { return s + x.amount; }, 0);
    return { items: items, total: total, pctOfPrice: p.price > 0 ? total / p.price * 100 : 0 };
  }

  function operating(p, rentMonthly, yearFactor) {
    yearFactor = yearFactor || 1;
    var gsi = (rentMonthly + p.otherIncome) * 12;
    var vacancy = gsi * p.vacancyPct / 100;
    var egi = gsi - vacancy;
    var mgmt = egi * p.mgmtPct / 100;
    var maint = gsi * p.maintPct / 100;
    var capex = gsi * p.capexPct / 100;
    var fixed = (p.taxesAnnual + p.insuranceAnnual + (p.hoaMonthly + p.utilitiesMonthly) * 12) * yearFactor;
    var opex = mgmt + maint + capex + fixed;
    return { gsi: gsi, vacancy: vacancy, egi: egi, mgmt: mgmt, maint: maint, capex: capex,
      taxes: p.taxesAnnual * yearFactor, insurance: p.insuranceAnnual * yearFactor,
      hoa: p.hoaMonthly * 12 * yearFactor, utilities: p.utilitiesMonthly * 12 * yearFactor,
      opex: opex, noi: egi - opex };
  }

  function irr(flows) {
    var lo = -0.99, hi = 1.5, f = function (r) { return flows.reduce(function (s, c, t) { return s + c / Math.pow(1 + r, t); }, 0); };
    if (f(lo) * f(hi) > 0) return null;
    for (var i = 0; i < 200; i++) { var mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
    return (lo + hi) / 2 * 100;
  }

  function analyze(input, profile) {
    var p = normalize(input);
    profile = profile || {};
    var loan = p.loanType === 'cash' ? 0 : Math.round(p.price * (1 - p.downPct / 100));
    var down = p.price - loan;
    var cc = closingCosts(p, loan);
    var pi = payment(loan, p.rate, p.termYears);
    var ltv = p.price > 0 ? loan / p.price * 100 : 0;
    var pmi = (p.loanType === 'conventional' && ltv > 80) ? loan * p.pmiPct / 100 / 12 : 0;
    var taxM = p.taxesAnnual / 12, insM = p.insuranceAnnual / 12;
    var pitia = pi + pmi + taxM + insM + p.hoaMonthly;
    var op = operating(p, p.rent);
    var debtService = (pi + pmi) * 12;
    var cashFlowY = op.noi - debtService;
    var cashIn = down + cc.total + p.rehab;
    var reservesNeeded = pitia * p.reserveMonths;
    var basis = p.price + p.rehab;
    var grossRentM = p.rent + p.otherIncome;

    // Tax (federal, simplified): 27.5-year straight line on building + rehab; full first year (mid-month convention ignored for simplicity).
    // Acquisition costs that go into basis (title, recording, transfer tax, inspection); loan costs and prepaids do not.
    var basisCosts = cc.items.filter(function (x) { return /Title|Recording|Transfer|inspection/i.test(x.label); })
      .reduce(function (s, x) { return s + x.amount; }, 0);
    var depBasis = (p.price + basisCosts) * (1 - p.landPct / 100) + p.rehab;
    var depYear = depBasis / 27.5;
    var interestY1 = loan > 0 ? (function () { var r = p.rate / 100 / 12, b = loan, s = 0; for (var m = 0; m < 12; m++) { var i = b * r; s += i; b -= (pi - i); } return s; })() : 0;
    var taxableY1 = op.noi - interestY1 - pmi * 12 - depYear;
    var allowance = 0;
    if (taxableY1 < 0 && p.activeParticipation) {
      allowance = Math.max(0, 25000 - Math.max(0, p.magi - 100000) * 0.5);
    }
    var usableLoss = taxableY1 < 0 ? Math.min(-taxableY1, allowance) : 0;
    var taxEffect = taxableY1 >= 0 ? -taxableY1 * p.marginalRate / 100 : usableLoss * p.marginalRate / 100;
    var suspended = taxableY1 < 0 ? -taxableY1 - usableLoss : 0;

    // Projection
    var rows = [], flows = [-cashIn], value = p.arv > 0 ? p.arv : p.price;
    for (var y = 1; y <= p.holdYears; y++) {
      var rentY = p.rent * Math.pow(1 + p.rentGrowth / 100, y - 1);
      var opY = operating(p, rentY, Math.pow(1 + p.expenseGrowth / 100, y - 1));
      var bal = balanceAfter(loan, p.rate, p.termYears, y * 12);
      var ltvY = value > 0 ? bal / (value * Math.pow(1 + p.appreciation / 100, y)) * 100 : 0;
      var pmiY = (p.loanType === 'conventional' && ltvY > 78) ? loan * p.pmiPct / 100 : 0;
      var cfY = opY.noi - pi * 12 - pmiY;
      var valY = value * Math.pow(1 + p.appreciation / 100, y);
      rows.push({ year: y, rent: rentY, noi: opY.noi, cashFlow: cfY, balance: bal, value: valY, equity: valY - bal });
      flows.push(cfY);
    }
    var last = rows[rows.length - 1];
    var saleNet = last.value * (1 - p.sellingCostPct / 100) - last.balance;
    flows[flows.length - 1] += saleNet;
    var totalCash = flows.slice(1).reduce(function (s, c) { return s + c; }, 0);

    var res = {
      input: p,
      loan: loan, down: down, ltv: ltv, closing: cc, cashToClose: down + cc.total, cashInvested: cashIn,
      pi: pi, pmi: pmi, taxesM: taxM, insuranceM: insM, pitia: pitia,
      op: op, noi: op.noi, debtService: debtService,
      cashFlowY: cashFlowY, cashFlowM: cashFlowY / 12,
      capRate: basis > 0 ? op.noi / basis * 100 : 0,
      coc: cashIn > 0 ? cashFlowY / cashIn * 100 : 0,
      dscr: debtService > 0 ? op.noi / debtService : null,
      dscrLender: pitia > 0 && loan > 0 ? grossRentM / pitia : null,
      grm: op.gsi > 0 ? p.price / op.gsi : 0,
      onePct: p.price > 0 ? (p.rent / (p.price + p.rehab)) * 100 : 0,
      breakEvenOcc: op.gsi > 0 ? (op.opex + debtService) / op.gsi * 100 : 0,
      pricePerSqft: p.sqft > 0 ? p.price / p.sqft : 0,
      reservesNeeded: reservesNeeded,
      tax: { depBasis: depBasis, depreciation: depYear, interest: interestY1, taxable: taxableY1,
        allowance: allowance, usableLoss: usableLoss, suspended: suspended, effect: taxEffect },
      projection: rows, irr: irr(flows), equityMultiple: cashIn > 0 ? totalCash / cashIn : null, saleNet: saleNet
    };
    res.stress = stress(p, res);
    res.warnings = warnings(p, res, profile);
    res.verdict = verdict(res);
    return res;
  }

  function stress(p, base) {
    function run(label, mod) {
      var q = {}; for (var k in p) q[k] = p[k];
      mod(q);
      var loan = base.loan;
      var pi = payment(loan, q.rate, q.termYears);
      var op = operating(q, q.rent);
      var cf = op.noi - pi * 12 - base.pmi * 12 - (q.shock || 0);
      return { label: label, cashFlowM: cf / 12, dscr: pi > 0 ? op.noi / ((pi + base.pmi) * 12) : null };
    }
    return [
      run('Base case', function () {}),
      run('Rate +2 pts (ARM reset / refinance)', function (q) { q.rate += 2; }),
      run('Vacancy 15%', function (q) { q.vacancyPct = 15; }),
      run('Rent −10%', function (q) { q.rent *= 0.9; }),
      run('Taxes & insurance +25%', function (q) { q.taxesAnnual *= 1.25; q.insuranceAnnual *= 1.25; }),
      run('Major repair $8,000 this year', function (q) { q.shock = 8000; }),
      run('Combined: rent −10%, vacancy 12%, rate +1', function (q) { q.rent *= 0.9; q.vacancyPct = 12; q.rate += 1; })
    ];
  }

  function warnings(p, r, profile) {
    var w = [];
    function add(level, title, text) { w.push({ level: level, title: title, text: text }); }
    if (r.cashFlowM < 0) add('high', 'Negative cash flow', 'After all expenses and the mortgage you would pay about $' + Math.round(-r.cashFlowM).toLocaleString('en-US') + ' per month out of pocket.');
    if (r.dscr !== null && r.dscr < 1.0) add('high', 'DSCR below 1.00', 'Net operating income does not cover the debt service. Most DSCR lenders will decline or require a larger down payment.');
    else if (r.dscr !== null && r.dscr < 1.25) add('medium', 'Thin debt coverage', 'DSCR ' + r.dscr.toFixed(2) + '. Many lenders price better at 1.25 or higher; a small vacancy can wipe out the margin.');
    if (r.loan > 0 && r.capRate < p.rate) add('medium', 'Negative leverage', 'The cap rate (' + r.capRate.toFixed(1) + '%) is below your interest rate (' + p.rate.toFixed(2) + '%). Borrowing lowers your return instead of raising it.');
    if (p.loanType === 'conventional' && r.ltv > 85) add('medium', 'High LTV for an investment loan', 'Conventional investment-property loans usually need 15–25% down. Expect PMI and a higher rate above 80% LTV.');
    if (r.closing.pctOfPrice > 6) add('low', 'High closing costs', 'Closing costs are ' + r.closing.pctOfPrice.toFixed(1) + '% of the price. Compare Loan Estimates and title quotes.');
    if (p.yearBuilt && p.yearBuilt < 1978) add('medium', 'Built before 1978', 'Federal law requires a lead-based paint disclosure to tenants. Budget for testing and lead-safe repairs.');
    if (p.hoaRentalLimits) add('high', 'HOA rental restrictions', 'Read the CC&Rs: rental caps, minimum lease terms or leasing bans can make the plan impossible.');
    if (p.floodZone) add('medium', 'Flood zone', 'Lenders require flood insurance in FEMA Special Flood Hazard Areas. Get a quote before you make an offer.');
    if (RENT_REG[p.state]) add('low', 'Rent regulation in ' + STATE_NAMES[p.state], RENT_REG[p.state] + ' Check the rules for this address before projecting rent growth.');
    if (p.vacancyPct < 4) add('low', 'Optimistic vacancy', 'A vacancy allowance under 4% assumes almost no turnover. 5–8% is typical for single-family rentals.');
    if (p.maintPct + p.capexPct < 8 && p.yearBuilt < 2005) add('low', 'Low repair budget for an older home', 'Older homes often need 10% or more of rent for repairs and capital expenses combined.');
    if (profile.liquid_reserves != null && profile.liquid_reserves !== '' && +profile.liquid_reserves < r.cashToClose + r.reservesNeeded) {
      add('high', 'Not enough cash', 'You need about $' + Math.round(r.cashToClose + r.reservesNeeded).toLocaleString('en-US') + ' (cash to close plus ' + p.reserveMonths + ' months of reserves). Your profile shows $' + Math.round(+profile.liquid_reserves).toLocaleString('en-US') + '.');
    }
    if (profile.annual_income > 0 && r.loan > 0) {
      var dti = ((+profile.monthly_debts || 0) + r.pitia - 0.75 * (p.rent + p.otherIncome)) / (profile.annual_income / 12) * 100;
      if (dti > 45) add('medium', 'Debt-to-income may be too high', 'Estimated DTI ' + dti.toFixed(0) + '% (lenders usually count 75% of rent). Conventional loans typically cap DTI at 45–50%.');
    }
    return w;
  }

  function verdict(r) {
    var high = r.warnings.filter(function (x) { return x.level === 'high'; }).length;
    if (high > 0) return { tone: 'bad', label: 'Does not pencil yet', text: 'Fix the red flags below before you make an offer.' };
    if (r.cashFlowM >= 150 && (r.dscr === null || r.dscr >= 1.25) && r.coc >= 6) return { tone: 'good', label: 'Pencils out', text: 'Solid cash flow and coverage under these assumptions. Verify rent, taxes and insurance with real quotes.' };
    return { tone: 'mid', label: 'Borderline', text: 'Works on paper, but there is little room for error. Negotiate the price or check the stress tests.' };
  }

  // Compare lender offers (Loan Estimate figures): total cost over a horizon.
  function compareOffers(loan, offers, horizonYears) {
    return offers.map(function (o) {
      var pmt = payment(loan, num(o.rate, 0), num(o.termYears, 30));
      var months = Math.min(horizonYears * 12, num(o.termYears, 30) * 12);
      var upfront = loan * num(o.pointsPct, 0) / 100 + num(o.fees, 0) - num(o.credits, 0);
      var bal = balanceAfter(loan, num(o.rate, 0), num(o.termYears, 30), months);
      var cost = upfront + pmt * months + bal - loan;
      return { name: o.name || 'Offer', payment: pmt, upfront: upfront, costOverHorizon: cost, balance: bal };
    });
  }

  // Refinance: break-even months and cash-out.
  function refinance(o) {
    var curPmt = payment(num(o.origBalance, 0), num(o.origRate, 0), num(o.origTerm, 30));
    var curBal = num(o.currentBalance, 0);
    var newLoan = Math.max(curBal, num(o.value, 0) * num(o.newLtv, 75) / 100);
    var cashOut = newLoan - curBal;
    var newPmt = payment(newLoan, num(o.newRate, 0), num(o.newTerm, 30));
    var costs = newLoan * num(o.costPct, 2.5) / 100;
    var sameLoanPmt = payment(curBal, num(o.newRate, 0), num(o.newTerm, 30));
    var monthlySaving = num(o.currentPayment, curPmt) - sameLoanPmt;
    return { newLoan: newLoan, cashOut: cashOut, newPayment: newPmt, rateTermPayment: sameLoanPmt,
      costs: costs, monthlySaving: monthlySaving, breakEvenMonths: monthlySaving > 0 ? Math.ceil(costs / monthlySaving) : null };
  }


  // Parse pasted listing text (any US listing site or MLS sheet) into analyzer inputs.
  function parseListing(text) {
    var t = String(text || '').replace(/ /g, ' ').slice(0, 20000), o = {}, m;
    function money(v) { return Math.round(parseFloat(String(v).replace(/[,$\s]/g, ''))); }
    function moneyK(v, suf) { var n = parseFloat(String(v).replace(/[,$\s]/g, '')); if (/k/i.test(suf || '')) n *= 1e3; if (/m/i.test(suf || '')) n *= 1e6; return Math.round(n); }
    m = t.match(/(?:list(?:ing)?\s*price|asking(?:\s*price)?|price|sold\s*for|for\s*sale)\s*[:\-]?\s*\$\s?([\d,.]+)\s*([kKmM])?/i) || t.match(/\$\s?(\d{2,3}(?:,\d{3}){1,2})(?!\s*\/\s*mo)(?!\s*per)/);
    if (m) { var pr = moneyK(m[1], m[2]); if (pr >= 10000 && pr < 50000000) o.price = pr; }
    m = t.match(/([\d,]{3,6})\s*(?:sq\.?\s*ft|sqft|square\s*feet|sf)\b/i); if (m) { var sq = money(m[1]); if (sq > 200 && sq < 50000) o.sqft = sq; }
    m = t.match(/(?:year\s*built|built\s*in|built)\s*[:\-]?\s*(18\d{2}|19\d{2}|20\d{2})/i); if (m) o.yearBuilt = +m[1];
    m = t.match(/(\d{1,2})\s*(?:bd|beds?|bedrooms?)\b/i); if (m) o.beds = +m[1];
    m = t.match(/(\d{1,2}(?:\.\d)?)\s*(?:ba|baths?|bathrooms?)\b/i); if (m) o.baths = +m[1];
    m = t.match(/HOA[^$\n]{0,30}\$\s?([\d,]+)\s*(?:\/\s*|per\s*)?(mo|month|monthly|yr|year|annual|annually|qtr|quarter)?/i);
    if (m) { var h = money(m[1]); var per = (m[2] || 'mo').toLowerCase(); o.hoaMonthly = /y|ann/.test(per) ? Math.round(h / 12) : /q/.test(per) ? Math.round(h / 3) : h; }
    m = t.match(/(?:annual\s*)?(?:property\s*)?tax(?:es)?(?:\s*\(\d{4}\))?[^$\n]{0,25}\$\s?([\d,]+)(\s*\/\s*(?:mo|month))?/i);
    if (m) { var tx = money(m[1]); o.taxesAnnual = m[2] ? tx * 12 : tx; if (o.price && (o.taxesAnnual < o.price * 0.0005 || o.taxesAnnual > o.price * 0.05)) delete o.taxesAnnual; }
    m = t.match(/(?:rent(?:al)?\s*(?:estimate|est\.?|income)?|market\s*rent|current\s*rent|gross\s*rent)[^$\n]{0,20}\$\s?([\d,]+)\s*(?:\/\s*mo|per\s*month|monthly)?/i);
    if (m) { var rn = money(m[1]); if (rn >= 300 && rn < 100000) o.rent = rn; }
    if (/\bfour[-\s]?plex|quadplex|\b4[-\s]?units?\b/i.test(t)) { o.type = 'fourplex'; o.units = 4; }
    else if (/\btri[-\s]?plex|\b3[-\s]?units?\b/i.test(t)) { o.type = 'triplex'; o.units = 3; }
    else if (/\bduplex|\b2[-\s]?units?\b/i.test(t)) { o.type = 'duplex'; o.units = 2; }
    else if (/\bcondo|townho(?:use|me)/i.test(t)) { o.type = 'condo'; o.units = 1; }
    else if (/single[-\s]?family/i.test(t)) { o.type = 'sfr'; o.units = 1; }
    m = t.match(/(\d{1,6}\s+[A-Za-z0-9.'\- ]{2,40}?(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Way|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Hwy)\.?)(?:,?\s*(?:#|Apt|Unit)\s*\w+)?,?\s*([A-Za-z .'\-]{2,30}),\s*([A-Z]{2})\s*(\d{5})?/);
    if (m && STATE_TAX[m[3]]) { o.name = (m[1].trim() + ', ' + m[2].trim() + ' ' + m[3]).slice(0, 120); o.state = m[3]; }
    else { m = t.match(/,\s*([A-Z]{2})\s+\d{5}\b/); if (m && STATE_TAX[m[1]]) o.state = m[1]; }
    if (/flood\s*zone\s*[:\-]?\s*(A|AE|AH|AO|V|VE)\b/i.test(t) || /special\s*flood\s*hazard/i.test(t)) o.floodZone = true;
    return o;
  }

  var api = { parseListing: parseListing, STATE_TAX: STATE_TAX, STATE_NAMES: STATE_NAMES, RENT_REG: RENT_REG, DEFAULTS: DEFAULTS,
    normalize: normalize, payment: payment, balanceAfter: balanceAfter, amortize: amortize, closingCosts: closingCosts,
    analyze: analyze, compareOffers: compareOffers, refinance: refinance, irr: irr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LRCalc = api;
})(typeof window !== 'undefined' ? window : this);
