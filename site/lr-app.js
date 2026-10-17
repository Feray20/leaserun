/* LeaseRun investor software (US port of ImmoAdv).
 * Talks to Supabase Auth + REST directly (no SDK). Every table is protected by RLS.
 * Pages are selected by <body data-app="...">.
 */
(function () {
  'use strict';
  var SB_URL = 'https://pxexxguhgqfxwhtnwcrj.supabase.co';
  var SB_KEY = 'sb_publishable_7Ga_tZ-JbJyVbA5e8YaGUg_DvftkCHP';
  var SKEY = 'lr-session-v1', DRAFT = 'lr-draft-v1';
  var C = window.LRCalc;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = $('#lr-root');
  var PAGE = document.body.getAttribute('data-app');

  // ---------------------------------------------------------------- format
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n, dec) { if (n == null || !isFinite(n)) return '–'; return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: dec || 0, minimumFractionDigits: dec || 0 }); }
  function pct(n, d) { return n == null || !isFinite(n) ? '–' : n.toFixed(d == null ? 1 : d) + '%'; }
  function x2(n) { return n == null || !isFinite(n) ? '–' : n.toFixed(2); }
  function sign(n) { return n >= 0 ? 'pos' : 'neg'; }
  function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600); }
  function qs(k) { return new URLSearchParams(location.search).get(k); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  // ---------------------------------------------------------------- auth + db
  function getS() { return store(SKEY); }
  function setS(d) {
    if (!d) { store(SKEY, null); return; }
    var exp = d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600);
    store(SKEY, { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: exp, user: d.user || (getS() || {}).user });
  }
  function api(path, opts, tok) {
    opts = opts || {};
    var h = { apikey: SB_KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (tok || SB_KEY) };
    for (var k in (opts.headers || {})) h[k] = opts.headers[k];
    return fetch(SB_URL + path, { method: opts.method || 'GET', headers: h, body: opts.body });
  }
  var refreshing = null;
  function token() {
    var s = getS();
    if (!s || !s.access_token) return Promise.resolve(null);
    if (s.expires_at * 1000 > Date.now() + 60000) return Promise.resolve(s.access_token);
    if (!refreshing) {
      refreshing = api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { refreshing = null; if (!d) { setS(null); return null; } setS(d); return d.access_token; })
        .catch(function () { refreshing = null; return null; });
    }
    return refreshing;
  }
  function db(path, opts) {
    return token().then(function (t) {
      if (!t) { goLogin(); throw new Error('Please sign in.'); }
      opts = opts || {};
      opts.headers = opts.headers || {};
      if (opts.method && opts.method !== 'GET') opts.headers.Prefer = opts.headers.Prefer || 'return=representation';
      return api('/rest/v1/' + path, opts, t).then(function (r) {
        if (r.status === 401) { setS(null); goLogin(); throw new Error('Your session expired. Please sign in again.'); }
        return r.text().then(function (txt) {
          var d = txt ? JSON.parse(txt) : null;
          if (!r.ok) { var e = new Error((d && (d.message || d.hint)) || 'Request failed (' + r.status + ')'); e.code = d && d.code; throw e; }
          return d;
        });
      });
    });
  }
  function goLogin() { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); }
  function claims() { try { var t = getS().access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(escape(atob(t)))); } catch (e) { return {}; } }
  function uid() { return claims().sub || null; }
  function signedIn() { var s = getS(); return !!(s && s.access_token); }
  function logout() {
    token().then(function (t) { if (t) api('/auth/v1/logout', { method: 'POST' }, t).catch(function () {}); setS(null); location.href = '/'; });
  }

  var ctx = null;
  function loadCtx() {
    if (ctx) return Promise.resolve(ctx);
    return Promise.all([
      db('entitlements?select=*'),
      db('financial_profiles?select=*'),
      db('properties?select=*&order=updated_at.desc')
    ]).then(function (a) {
      var ent = a[0][0] || { plan: 'free', loan_packages_left: 0 };
      ctx = { ent: ent, profile: a[1][0] || null, props: a[2] || [], tier: tierOf(ent) };
      return ctx;
    });
  }
  function tierOf(e) {
    if (!e) return 0;
    if (e.plan === 'pro') return 2;
    if (e.plan === 'buyer_pass' && e.pass_until && new Date(e.pass_until) > new Date()) return 1;
    return 0;
  }
  var PLAN_NAME = ['Free', 'Buyer Pass', 'Investor Pro'];
  function mode() { return (ctx && ctx.profile && ctx.profile.mode) || store('lr-mode') || 'beginner'; }

  // ---------------------------------------------------------------- form spec
  var STATES = Object.keys(C.STATE_NAMES).sort(function (a, b) { return C.STATE_NAMES[a] < C.STATE_NAMES[b] ? -1 : 1; });
  var TYPES = [['sfr', 'Single-family home'], ['condo', 'Condo / townhome'], ['duplex', 'Duplex'], ['triplex', 'Triplex'], ['fourplex', 'Fourplex'], ['multi', '5+ units']];
  var LOANS = [['conventional', 'Conventional investment loan'], ['dscr', 'DSCR loan (rent-based)'], ['cash', 'All cash']];
  var GROUPS = [
    { t: 'Property', f: [
      ['name', 'Name or address', 'text', 'e.g. 412 Maple St, Columbus OH'],
      ['state', 'State', 'state', 'Sets typical property tax and local rent rules.'],
      ['type', 'Property type', 'type'],
      ['units', 'Units', 'int'],
      ['sqft', 'Living area', 'int', '', 0, 'sq ft'],
      ['yearBuilt', 'Year built', 'int', 'Before 1978: lead-paint disclosure required.'],
      ['hoaRentalLimits', 'HOA restricts rentals', 'chk'],
      ['floodZone', 'In a FEMA flood zone', 'chk']
    ] },
    { t: 'Purchase', f: [
      ['price', 'Purchase price', 'usd'],
      ['rehab', 'Repairs before renting', 'usd', 'Make-ready work paid in cash.'],
      ['arv', 'Value after repairs (optional)', 'usd', 'Leave 0 to use the purchase price.', 0, '', 1]
    ] },
    { t: 'Rent', f: [
      ['rent', 'Monthly rent (all units)', 'usd', 'Use rent comps from similar homes nearby, not the seller’s number.'],
      ['otherIncome', 'Other monthly income', 'usd', 'Pet fees, parking, laundry.', 0, '', 1],
      ['vacancyPct', 'Vacancy allowance', 'pct', '5–8% is typical for single-family rentals.']
    ] },
    { t: 'Operating costs', f: [
      ['taxesAnnual', 'Property taxes per year', 'usd', 'Empty = state average. Check the county assessor; taxes often reset after a sale.'],
      ['insuranceAnnual', 'Landlord insurance per year', 'usd', 'Empty = rough estimate. Get a real quote (dwelling policy, DP-3).'],
      ['hoaMonthly', 'HOA dues per month', 'usd'],
      ['utilitiesMonthly', 'Utilities you pay per month', 'usd', 'Water, trash, common areas.', 0, '', 1],
      ['mgmtPct', 'Property management', 'pct', '8–10% of collected rent; 0 if you self-manage.'],
      ['maintPct', 'Repairs & maintenance', 'pct', 'Share of rent for ongoing repairs.'],
      ['capexPct', 'CapEx reserve', 'pct', 'Roof, HVAC, water heater – saved monthly.']
    ] },
    { t: 'Financing', f: [
      ['loanType', 'Loan type', 'loan'],
      ['downPct', 'Down payment', 'pct', 'Investment loans usually need 20–25%.'],
      ['rate', 'Interest rate', 'pct', 'Use the rate on your Loan Estimate.'],
      ['termYears', 'Loan term', 'int', '', 1, 'years'],
      ['pointsPct', 'Discount points', 'pct', '1 point = 1% of the loan.', 1],
      ['pmiPct', 'PMI per year (if < 20% down)', 'pct', '', 1]
    ] },
    { t: 'Closing costs', adv: 1, f: [
      ['lenderFees', 'Lender & underwriting fees', 'usd'], ['appraisal', 'Appraisal', 'usd'], ['inspection', 'Home inspection', 'usd'],
      ['titlePct', 'Title insurance & settlement', 'pct', 'Of the price.'], ['recording', 'Recording & escrow fees', 'usd'],
      ['transferTaxPct', 'Transfer tax paid by you', 'pct', 'Often paid by the seller; varies by state and county.'],
      ['prepaidTaxMonths', 'Prepaid tax escrow', 'int', '', 0, 'months'], ['prepaidInsMonths', 'Prepaid insurance', 'int', '', 0, 'months'],
      ['reserveMonths', 'Reserves to keep', 'int', 'Lenders often want 6 months of PITIA in the bank.', 0, 'months']
    ] },
    { t: 'Growth & sale', adv: 1, f: [
      ['rentGrowth', 'Rent growth per year', 'pct'], ['appreciation', 'Appreciation per year', 'pct'], ['expenseGrowth', 'Cost growth per year', 'pct'],
      ['holdYears', 'Holding period', 'int', '', 0, 'years'], ['sellingCostPct', 'Selling costs', 'pct', 'Agent commissions and closing costs.']
    ] },
    { t: 'Federal taxes', adv: 1, f: [
      ['landPct', 'Land share of price', 'pct', 'Land is not depreciable. See the land/improvement split on the tax bill.'],
      ['marginalRate', 'Your federal tax bracket', 'pct'],
      ['magi', 'Modified adjusted gross income', 'usd', 'Up to $25,000 of rental losses can offset wages below $100k; phases out by $150k.'],
      ['activeParticipation', 'I actively participate (approve tenants, repairs)', 'chk']
    ] }
  ];

  function fieldHtml(f, v, beginner) {
    var k = f[0], label = f[1], kind = f[2], help = f[3], adv = f[4], suf = f[5], full = f[6];
    var id = 'f-' + k, val = v == null ? '' : v, input;
    var D = C.DEFAULTS[k];
    if (kind === 'chk') return '<label class="chk full"><input type="checkbox" name="' + k + '" ' + (v === true || v === 'true' || (v == null && D === true) ? 'checked' : '') + '><span>' + esc(label) + '</span></label>';
    if (kind === 'state') input = '<select name="state" id="' + id + '">' + STATES.map(function (s) { return '<option value="' + s + '"' + (s === (v || 'TX') ? ' selected' : '') + '>' + esc(C.STATE_NAMES[s]) + '</option>'; }).join('') + '</select>';
    else if (kind === 'type') input = '<select name="type" id="' + id + '">' + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === v ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>';
    else if (kind === 'loan') input = '<select name="loanType" id="' + id + '">' + LOANS.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === v ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>';
    else if (kind === 'text') input = '<input name="' + k + '" id="' + id + '" maxlength="120" value="' + esc(val) + '" placeholder="' + esc(help || '') + '">';
    else {
      var ph = (k === 'taxesAnnual' || k === 'insuranceAnnual') ? ' placeholder="auto"' : (typeof D === 'number' && D > 0 ? ' placeholder="' + D + '"' : '');
      var core = '<input name="' + k + '" id="' + id + '" type="number" inputmode="decimal" step="any" min="0" value="' + esc(val) + '"' + ph + '>';
      input = kind === 'usd' ? '<div class="pre"><span>$</span>' + core + '</div>' : kind === 'pct' ? '<div class="suf">' + core + '<span>%</span></div>' : suf ? '<div class="suf">' + core + '<span>' + esc(suf) + '</span></div>' : core;
    }
    var h = help && kind !== 'text' && (beginner || /Empty|Before|Up to/.test(help)) ? '<small>' + esc(help) + '</small>' : '';
    return '<label class="fl' + (full || kind === 'text' ? ' full' : '') + '" for="' + id + '">' + esc(label) + input + h + '</label>';
  }

  function editorHtml(data, beginner) {
    return '<form class="lr-form" autocomplete="off" novalidate>' + GROUPS.map(function (g) {
      var basic = g.f.filter(function (f) { return !f[4] || !beginner; }), extra = g.f.filter(function (f) { return f[4] && beginner; });
      var inner = '<div class="fg">' + basic.map(function (f) { return fieldHtml(f, data[f[0]], beginner); }).join('') + '</div>';
      if (extra.length) inner += '<details class="adv"><summary>More options</summary><div class="fg">' + extra.map(function (f) { return fieldHtml(f, data[f[0]], beginner); }).join('') + '</div></details>';
      if (g.adv) return '<details class="adv"' + (beginner ? '' : ' open') + '><summary>' + esc(g.t) + '</summary><fieldset>' + inner + '</fieldset></details>';
      return '<fieldset><legend>' + esc(g.t) + '</legend>' + inner + '</fieldset>';
    }).join('') + '</form>';
  }

  function readForm(form) {
    var o = {};
    $$('input,select', form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'number') { if (el.value !== '') o[el.name] = +el.value; }
      else o[el.name] = el.value.trim();
    });
    return o;
  }

  // ---------------------------------------------------------------- results
  function explain(beginner, t) { return beginner ? '<div class="explain">' + t + '</div>' : ''; }

  function resultsHtml(r, beginner) {
    var p = r.input, v = r.verdict, op = r.op;
    var k = [
      ['Monthly cash flow', usd(r.cashFlowM), sign(r.cashFlowM), 'after mortgage & reserves'],
      ['Cash-on-cash', pct(r.coc), sign(r.coc), 'yearly cash flow ÷ cash invested'],
      ['Cap rate', pct(r.capRate), '', 'NOI ÷ price + repairs'],
      ['DSCR', r.dscr == null ? 'n/a' : x2(r.dscr), r.dscr != null && r.dscr < 1 ? 'neg' : '', 'NOI ÷ debt service'],
      ['Cash needed', usd(r.cashInvested), '', 'down + closing + repairs'],
      ['Monthly payment (PITIA)', usd(r.pitia), '', 'loan, PMI, taxes, insurance, HOA']
    ];
    if (!beginner) k = k.concat([
      ['Lender DSCR', r.dscrLender == null ? 'n/a' : x2(r.dscrLender), '', 'gross rent ÷ PITIA'],
      ['IRR (' + p.holdYears + ' yrs)', r.irr == null ? 'n/a' : pct(r.irr), r.irr != null ? sign(r.irr) : '', 'incl. sale, pre-tax'],
      ['Equity multiple', r.equityMultiple == null ? 'n/a' : x2(r.equityMultiple) + 'x', '', 'total cash back ÷ cash in'],
      ['Break-even occupancy', pct(r.breakEvenOcc), r.breakEvenOcc > 90 ? 'neg' : '', 'costs + debt ÷ full rent'],
      ['Gross rent multiplier', x2(r.grm) + 'x', '', 'price ÷ yearly rent'],
      ['Rent-to-price', pct(r.onePct, 2), '', 'the “1% rule”']
    ]);
    var h = '<div class="verdict ' + v.tone + '"><div><b>' + esc(v.label) + '</b><p>' + esc(v.text) + '</p></div></div>';
    h += '<div class="kpis">' + k.map(function (x) { return '<div class="kp"><div class="k">' + x[0] + '</div><div class="v ' + x[2] + '">' + x[1] + '</div><div class="x">' + x[3] + '</div></div>'; }).join('') + '</div>';
    h += explain(beginner, '<b>How to read this:</b> cash flow is what is left each month after every bill, the mortgage and money set aside for repairs. DSCR shows how many times the rent (after costs) covers the loan payment; lenders like 1.25 or more.');

    h += '<div class="box" style="margin-top:16px"><h2>Red flags & checks</h2>' + (r.warnings.length ? r.warnings.map(function (w) { return '<div class="warn"><i class="dot ' + w.level + '"></i><div><b>' + esc(w.title) + '</b><span>' + esc(w.text) + '</span></div></div>'; }).join('') : '<p class="hint" style="margin:0">No red flags under these assumptions.</p>') + '</div>';

    // Where the rent goes
    var gsi = op.gsi || 1, ds = r.debtService;
    var parts = [['Vacancy', op.vacancy, '#C9D1E0'], ['Management', op.mgmt, '#8A97B4'], ['Repairs & CapEx', op.maint + op.capex, '#F5B544'], ['Taxes', op.taxes, '#1290E7'], ['Insurance', op.insurance, '#5FB3F0'], ['HOA & utilities', op.hoa + op.utilities, '#B39DDB'], ['Mortgage & PMI', ds, '#0C1A35']];
    var cf = r.cashFlowY;
    h += '<div class="box"><h2>Where each rent dollar goes</h2><p class="hint">Yearly gross rent ' + usd(op.gsi) + '.</p><div class="bar">' + parts.map(function (x) { return '<i style="width:' + Math.max(0, x[1] / gsi * 100) + '%;background:' + x[2] + '"></i>'; }).join('') + (cf > 0 ? '<i style="width:' + cf / gsi * 100 + '%;background:#1AC585"></i>' : '') + '</div><div class="legend">' + parts.map(function (x) { return '<span style="--c:' + x[2] + '">' + x[0] + ' ' + usd(x[1] / 12) + '/mo</span>'; }).join('') + '<span style="--c:#1AC585">Cash flow ' + usd(r.cashFlowM) + '/mo</span></div></div>';

    // Cash to close
    h += '<div class="box"><h2>Cash to close</h2><div class="scroll-x"><table class="tbl"><tbody><tr><td>Down payment (' + pct(100 - r.ltv, 0) + ')</td><td>' + usd(r.down) + '</td></tr>' + r.closing.items.map(function (i) { return '<tr><td>' + esc(i.label) + '</td><td>' + usd(i.amount) + '</td></tr>'; }).join('') + (p.rehab ? '<tr><td>Repairs before renting</td><td>' + usd(p.rehab) + '</td></tr>' : '') + '<tr class="tot"><td>Total cash in</td><td>' + usd(r.cashInvested) + '</td></tr><tr><td>Recommended reserves (' + p.reserveMonths + ' months PITIA)</td><td>' + usd(r.reservesNeeded) + '</td></tr></tbody></table></div><p class="hint" style="margin:8px 0 0">Closing costs ≈ ' + pct(r.closing.pctOfPrice) + ' of the price. Your Loan Estimate and the title company’s quote replace these estimates.</p></div>';

    // Stress
    h += '<div class="box"><h2>Stress test</h2><p class="hint">What happens to monthly cash flow when things go wrong.</p><div class="scroll-x"><table class="tbl"><thead><tr><th>Scenario</th><th>Cash flow / mo</th><th>DSCR</th></tr></thead><tbody>' + r.stress.map(function (s) { return '<tr><td>' + esc(s.label) + '</td><td class="' + sign(s.cashFlowM) + '">' + usd(s.cashFlowM) + '</td><td>' + (s.dscr == null ? 'n/a' : x2(s.dscr)) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';

    // Projection
    var rows = r.projection.filter(function (x, i) { return beginner ? [0, 4, 9].indexOf(i) >= 0 || i === r.projection.length - 1 : true; });
    h += '<div class="box"><h2>' + (beginner ? 'The picture over time' : p.holdYears + '-year projection') + '</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Year</th><th>Rent / mo</th><th>Cash flow / yr</th><th>Loan balance</th><th>Value</th><th>Equity</th></tr></thead><tbody>' + rows.map(function (x) { return '<tr><td>' + x.year + '</td><td>' + usd(x.rent) + '</td><td class="' + sign(x.cashFlow) + '">' + usd(x.cashFlow) + '</td><td>' + usd(x.balance) + '</td><td>' + usd(x.value) + '</td><td>' + usd(x.equity) + '</td></tr>'; }).join('') + '</tbody></table></div>' + explain(beginner, 'Equity grows in two ways: tenants pay down your loan, and the home may gain value. Appreciation is never guaranteed – the deal should work on cash flow alone.') + '<p class="hint" style="margin:8px 0 0">Net proceeds if sold in year ' + p.holdYears + ' after ' + pct(p.sellingCostPct, 0) + ' selling costs and loan payoff: <b>' + usd(r.saleNet) + '</b> (before capital gains and depreciation recapture tax).</p></div>';

    // Tax
    var t = r.tax;
    h += '<div class="box"><h2>Federal tax, year one (estimate)</h2><div class="scroll-x"><table class="tbl"><tbody><tr><td>Net operating income</td><td>' + usd(r.noi) + '</td></tr><tr><td>Mortgage interest' + (r.pmi ? ' & PMI' : '') + '</td><td>' + usd(-(t.interest + r.pmi * 12)) + '</td></tr><tr><td>Depreciation (27.5 years on ' + usd(t.depBasis) + ')</td><td>' + usd(-t.depreciation) + '</td></tr><tr class="tot"><td>Taxable rental income (Schedule E)</td><td class="' + sign(t.taxable) + '">' + usd(t.taxable) + '</td></tr>' +
      (t.taxable < 0 ? '<tr><td>Loss usable against other income (passive allowance ' + usd(t.allowance) + ')</td><td>' + usd(t.usableLoss) + '</td></tr><tr><td>Suspended loss carried forward</td><td>' + usd(t.suspended) + '</td></tr>' : '') +
      '<tr><td>Effect on your federal tax at ' + pct(p.marginalRate, 0) + '</td><td class="' + sign(t.effect) + '">' + (t.effect >= 0 ? 'saves ' : 'costs ') + usd(Math.abs(t.effect)) + '</td></tr></tbody></table></div><p class="hint" style="margin:8px 0 0">Simplified: no state tax, no mid-month convention, no cost segregation. Depreciation is recaptured at up to 25% when you sell. Review with your CPA.</p></div>';
    return h;
  }

  function mountAnalyzer(el, data, opts) {
    var beginner = opts.beginner;
    el.innerHTML = '<div class="cols"><div class="box">' + (opts.head || '') + editorHtml(data, beginner) + '</div><div class="sticky"><div id="lr-act"></div><div id="lr-out"></div></div></div>';
    var form = $('.lr-form', el), out = $('#lr-out', el), timer;
    if (opts.actions) $('#lr-act', el).innerHTML = opts.actions();
    function run() {
      var d = readForm(form);
      var r = C.analyze(d, opts.profile || {});
      var tx = $('#f-taxesAnnual', form), ins = $('#f-insuranceAnnual', form);
      if (tx) tx.placeholder = 'auto: ' + usd(r.input.taxesAnnual);
      if (ins) ins.placeholder = 'auto: ' + usd(r.input.insuranceAnnual);
      out.innerHTML = resultsHtml(r, beginner);
      if (opts.onChange) opts.onChange(d, r);
    }
    form.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 120); });
    form.addEventListener('change', run);
    run();
    return { read: function () { return readForm(form); }, run: run };
  }

  // ---------------------------------------------------------------- page: analyzer (public)
  function pageAnalyzer() {
    var draft = store(DRAFT) || { name: 'Sample: 3-bed house, Columbus OH', state: 'OH', price: 165000, rent: 1650, yearBuilt: 1998, sqft: 1350, downPct: 25, rate: 7.0 };
    var beginner = (store('lr-mode') || 'beginner') === 'beginner';
    var top = '<div class="app-bar"><div><span class="pill">' + (beginner ? 'Beginner view' : 'Pro view') + '</span></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-line btn-sm" id="lr-mode">' + (beginner ? 'Switch to Pro view' : 'Switch to Beginner view') + '</button><button class="btn btn-line btn-sm" id="lr-reset">Reset</button><button class="btn btn-primary btn-sm" id="lr-save">' + (signedIn() ? 'Save to my account' : 'Save – free account') + '</button></div></div>';
    root.innerHTML = top + '<div id="lr-an"></div><p class="hint" style="margin-top:18px;font-size:13px;color:var(--muted-dark)">Estimates for education only – not investment, tax, legal or lending advice. Verify every number with your lender, insurance agent, county assessor and CPA.</p>';
    var A = mountAnalyzer($('#lr-an'), draft, { beginner: beginner, onChange: function (d) { store(DRAFT, d); } });
    $('#lr-mode').onclick = function () { store('lr-mode', beginner ? 'pro' : 'beginner'); location.reload(); };
    $('#lr-reset').onclick = function () { store(DRAFT, null); location.reload(); };
    $('#lr-save').onclick = function () {
      var d = A.read();
      store(DRAFT, d);
      if (!signedIn()) { location.href = '/signup?next=' + encodeURIComponent('/analyzer?save=1'); return; }
      saveNew(d);
    };
    if (qs('save') === '1' && signedIn()) saveNew(A.read());
  }
  function saveNew(d) {
    var name = (d.name || 'My property').slice(0, 120);
    db('properties', { method: 'POST', body: JSON.stringify({ name: name, data: d }) }).then(function (rows) {
      store(DRAFT, null);
      location.href = '/app/property?id=' + encodeURIComponent(rows[0].id);
    }).catch(function (e) {
      if (/FREE_LIMIT/.test(e.message)) { location.href = '/pricing?limit=1'; return; }
      toast(e.message);
    });
  }

  // ---------------------------------------------------------------- page: start (guided beginner, public)
  function pageStart() {
    var s = { price: 180000, rent: 1750, state: 'OH', downPct: 25, rate: 7 };
    function step(n) { return '<span class="pill good">Step ' + n + ' of 3</span>'; }
    root.innerHTML =
      '<div class="cols"><div><div class="box">' + step(1) + '<h2 style="margin-top:8px">The home and the rent</h2><p class="hint">Use a real listing if you have one. Rent should come from similar homes that are rented today.</p><div class="fg">' +
      fieldHtml(['price', 'Purchase price', 'usd'], s.price, true) + fieldHtml(['rent', 'Monthly rent', 'usd'], s.rent, true) + fieldHtml(['state', 'State', 'state', 'Sets typical property tax.'], s.state, true) + '</div></div>' +
      '<div class="box">' + step(2) + '<h2 style="margin-top:8px">Your money and the loan</h2><p class="hint">Investment-property loans usually need 20–25% down. Rates are higher than for a home you live in.</p><div class="fg">' +
      fieldHtml(['downPct', 'Down payment', 'pct'], s.downPct, true) + fieldHtml(['rate', 'Interest rate (30-year)', 'pct'], s.rate, true) + '</div></div>' +
      '<div class="box">' + step(3) + '<h2 style="margin-top:8px">Read your results</h2><p class="hint" style="margin:0">Every number on the right updates as you type. When you are ready, open the full analyzer to add your own costs and save the property.</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><a class="btn btn-primary" id="st-full" href="/analyzer">Open the full analyzer</a><a class="btn btn-line" href="/signup">Create a free account</a></div></div></div>' +
      '<div class="sticky" id="st-out"></div></div>' +
      '<div class="box" style="margin-top:22px"><h2>Terms in plain English</h2><dl class="gloss">' + [
        ['PITIA', 'Principal, interest, taxes, insurance and association dues – your full monthly housing payment.'],
        ['NOI (net operating income)', 'Rent after vacancy and all operating costs, before the mortgage.'],
        ['Cap rate', 'NOI divided by the price. Compare it with your interest rate: if it is lower, borrowing hurts your return.'],
        ['Cash-on-cash return', 'Yearly cash flow divided by the cash you put in.'],
        ['DSCR', 'Debt service coverage ratio: NOI divided by the yearly loan payments. Below 1.00 the rent does not cover the loan.'],
        ['Reserves', 'Cash you keep after closing. Lenders often require six months of PITIA for a rental.'],
        ['Depreciation', 'A yearly tax deduction for wear and tear on the building (not the land), spread over 27.5 years.'],
        ['Closing costs', 'Lender fees, title insurance, appraisal, recording and prepaid escrow – usually 2–5% of the price.']
      ].map(function (g) { return '<dt>' + g[0] + '</dt><dd>' + g[1] + '</dd>'; }).join('') + '</dl></div>';
    var out = $('#st-out');
    function run() {
      var d = {}; $$('#lr-root input, #lr-root select').forEach(function (i) { d[i.name] = i.type === 'number' ? +i.value : i.value; });
      var r = C.analyze(d);
      var lev = [20, 25, 35, 100].map(function (dp) { var x = C.analyze(Object.assign({}, d, { downPct: dp, loanType: dp === 100 ? 'cash' : 'conventional' })); return '<tr><td>' + (dp === 100 ? 'All cash' : dp + '% down') + '</td><td>' + usd(x.cashInvested) + '</td><td class="' + sign(x.cashFlowM) + '">' + usd(x.cashFlowM) + '</td><td class="' + sign(x.coc) + '">' + pct(x.coc) + '</td></tr>'; }).join('');
      var y10 = r.projection[9] || r.projection[r.projection.length - 1];
      out.innerHTML = '<div class="verdict ' + r.verdict.tone + '"><div><b>' + esc(r.verdict.label) + '</b><p>' + esc(r.verdict.text) + '</p></div></div>' +
        '<div class="box"><h3>1. Loan and monthly payment</h3><table class="tbl"><tbody><tr><td>Loan amount</td><td>' + usd(r.loan) + '</td></tr><tr><td>Principal & interest</td><td>' + usd(r.pi) + '</td></tr><tr><td>Taxes, insurance' + (r.pmi ? ', PMI' : '') + '</td><td>' + usd(r.pitia - r.pi) + '</td></tr><tr class="tot"><td>Total payment (PITIA)</td><td>' + usd(r.pitia) + '</td></tr></tbody></table></div>' +
        '<div class="box"><h3>2. Your leverage</h3><p class="hint">More down payment means more cash tied up but safer cash flow.</p><table class="tbl"><thead><tr><th>Down payment</th><th>Cash in</th><th>Cash flow / mo</th><th>Cash-on-cash</th></tr></thead><tbody>' + lev + '</tbody></table></div>' +
        '<div class="box"><h3>3. Monthly cash flow</h3><table class="tbl"><tbody><tr><td>Rent</td><td>' + usd(r.op.gsi / 12) + '</td></tr><tr><td>Vacancy, management, repairs, CapEx</td><td>' + usd(-(r.op.vacancy + r.op.mgmt + r.op.maint + r.op.capex) / 12) + '</td></tr><tr><td>Taxes & insurance</td><td>' + usd(-(r.op.taxes + r.op.insurance) / 12) + '</td></tr><tr><td>Mortgage' + (r.pmi ? ' & PMI' : '') + '</td><td>' + usd(-r.debtService / 12) + '</td></tr><tr class="tot"><td>Cash flow</td><td class="' + sign(r.cashFlowM) + '">' + usd(r.cashFlowM) + '</td></tr></tbody></table></div>' +
        '<div class="box"><h3>4. Safety net</h3><p class="hint" style="margin:0">Plan to keep <b>' + usd(r.reservesNeeded) + '</b> in the bank after closing (six months of PITIA). Total cash needed including closing costs: <b>' + usd(r.cashInvested + r.reservesNeeded) + '</b>.</p></div>' +
        '<div class="box"><h3>5. In ten years</h3><p class="hint" style="margin:0">With 3% rent growth and 3% appreciation: loan balance ' + usd(y10.balance) + ', value ' + usd(y10.value) + ', equity <b>' + usd(y10.equity) + '</b>. Appreciation is not guaranteed.</p></div>';
      store(DRAFT, Object.assign({}, store(DRAFT) || {}, d, { name: (store(DRAFT) || {}).name || 'My first rental' }));
    }
    root.addEventListener('input', run); root.addEventListener('change', run); run();
  }

  // ---------------------------------------------------------------- auth pages
  function authBox(title, sub, inner) {
    root.innerHTML = '<div class="auth-wrap"><div class="box"><h2 style="font-size:24px">' + title + '</h2><p class="hint">' + sub + '</p>' + inner + '<div id="lr-msg"></div></div></div>';
  }
  function msg(t, cls) { var m = $('#lr-msg'); if (m) m.innerHTML = '<div class="msg ' + (cls || 'err') + '">' + esc(t) + '</div>'; }
  function errText(d, fb) {
    var m = (d && (d.msg || d.error_description || d.message)) || fb;
    if (/Invalid login/i.test(m)) return 'Email or password is incorrect.';
    if (/not confirmed/i.test(m)) return 'Please confirm your email first – check your inbox and spam folder.';
    if (/already registered/i.test(m)) return 'An account with this email already exists. Please sign in.';
    if (/rate limit/i.test(m)) return 'Too many attempts. Please wait a few minutes.';
    return m;
  }
  function nextUrl() { var n = qs('next') || '/app'; return /^\/[a-zA-Z0-9\-\/?=&._%]*$/.test(n) && n.indexOf('//') !== 0 ? n : '/app'; }
  function takeHashSession() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.get('error_description')) { return { error: h.get('error_description') }; }
    if (!h.get('access_token')) return null;
    history.replaceState(null, '', location.pathname + location.search);
    return { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: +h.get('expires_in') || 3600, type: h.get('type') };
  }
  var PW = '<label class="fl full" for="pw">Password<input id="pw" type="password" required minlength="10" autocomplete="current-password"></label>';
  function pageLogin() {
    var hs = takeHashSession();
    if (hs && hs.access_token) {
      if (hs.type === 'recovery') { location.replace('/reset#access_token=' + encodeURIComponent(hs.access_token) + '&refresh_token=' + encodeURIComponent(hs.refresh_token || '') + '&type=recovery'); return; }
      setS(hs); location.replace('/app'); return;
    }
    if (signedIn() && !qs('next')) { location.replace('/app'); return; }
    authBox('Sign in', 'Welcome back. Your properties and numbers are waiting.',
      '<form id="af" class="fg"><label class="fl full" for="em">Email<input id="em" type="email" required autocomplete="email"></label>' + PW +
      '<button class="btn btn-primary full" type="submit">Sign in</button></form><p class="hint" style="margin-top:14px"><a href="/forgot" style="color:#0E7A53;font-weight:600">Forgot password?</a> · No account? <a href="/signup' + (qs('next') ? '?next=' + encodeURIComponent(qs('next')) : '') + '" style="color:#0E7A53;font-weight:600">Create one free</a></p>');
    if (hs && hs.error) msg(hs.error);
    $('#af').onsubmit = function (e) {
      e.preventDefault(); var b = $('button', e.target); b.disabled = true; msg('Signing in…', 'info');
      api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: $('#em').value.trim().toLowerCase(), password: $('#pw').value }) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(errText(d, 'Sign-in failed.')); setS(d); location.href = nextUrl(); }); })
        .catch(function (x) { b.disabled = false; msg(x.message); });
    };
  }
  function pageSignup() {
    authBox('Create your free account', 'Save up to 2 properties, use the core tools and preview your lender package. No credit card.',
      '<form id="af" class="fg"><label class="fl full" for="em">Email<input id="em" type="email" required autocomplete="email"></label>' + PW.replace('current-password', 'new-password').replace('Password', 'Password <small>at least 10 characters</small>') +
      '<label class="chk full"><input type="checkbox" id="tos" required><span>I agree to the <a href="/terms" style="text-decoration:underline">Terms of Use</a> and <a href="/privacy" style="text-decoration:underline">Privacy Policy</a>.</span></label>' +
      '<button class="btn btn-primary full" type="submit">Create account</button></form><p class="hint" style="margin-top:14px">Already registered? <a href="/login" style="color:#0E7A53;font-weight:600">Sign in</a></p>');
    $('#af').onsubmit = function (e) {
      e.preventDefault();
      if (!$('#tos').checked) { msg('Please accept the Terms and Privacy Policy.'); return; }
      if ($('#pw').value.length < 10) { msg('Please use at least 10 characters.'); return; }
      var b = $('button', e.target); b.disabled = true; msg('Creating your account…', 'info');
      var back = location.origin + '/login' + (qs('next') ? '?next=' + encodeURIComponent(qs('next')) : '');
      api('/auth/v1/signup?redirect_to=' + encodeURIComponent(back), { method: 'POST', body: JSON.stringify({ email: $('#em').value.trim().toLowerCase(), password: $('#pw').value }) })
        .then(function (r) { return r.json().then(function (d) {
          if (!r.ok) throw new Error(errText(d, 'Sign-up failed.'));
          if (d.access_token) { setS(d); location.href = nextUrl(); return; }
          e.target.remove(); msg('Almost done! We sent you an email. Click the link inside to confirm your address, then sign in. Check your spam folder too.', 'ok');
        }); })
        .catch(function (x) { b.disabled = false; msg(x.message); });
    };
  }
  function pageForgot() {
    authBox('Reset your password', 'We will email you a link to choose a new password.',
      '<form id="af" class="fg"><label class="fl full" for="em">Email<input id="em" type="email" required autocomplete="email"></label><button class="btn btn-primary full" type="submit">Send reset link</button></form>');
    $('#af').onsubmit = function (e) {
      e.preventDefault(); var b = $('button', e.target); b.disabled = true;
      api('/auth/v1/recover?redirect_to=' + encodeURIComponent(location.origin + '/reset'), { method: 'POST', body: JSON.stringify({ email: $('#em').value.trim().toLowerCase() }) })
        .then(function (r) { if (r.status === 429) throw new Error('Too many requests. Please try again in a few minutes.'); msg('If an account exists for this email, a reset link is on its way. The link expires soon.', 'ok'); })
        .catch(function (x) { b.disabled = false; msg(x.message); });
    };
  }
  function pageReset() {
    var hs = takeHashSession();
    if (!hs || !hs.access_token) { authBox('Link expired', 'Please request a new reset link.', '<a class="btn btn-primary" href="/forgot">Request new link</a>'); if (hs && hs.error) msg(hs.error); return; }
    authBox('Choose a new password', 'At least 10 characters.', '<form id="af" class="fg">' + PW.replace('current-password', 'new-password').replace('id="pw"', 'id="pw"') + '<label class="fl full" for="pw2">Repeat password<input id="pw2" type="password" required minlength="10" autocomplete="new-password"></label><button class="btn btn-primary full" type="submit">Save password</button></form>');
    $('#af').onsubmit = function (e) {
      e.preventDefault();
      if ($('#pw').value !== $('#pw2').value) { msg('The passwords do not match.'); return; }
      if ($('#pw').value.length < 10) { msg('Please use at least 10 characters.'); return; }
      api('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: $('#pw').value }) }, hs.access_token)
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(errText(d, 'Could not save the password.')); setS(hs); msg('Password saved. Redirecting…', 'ok'); setTimeout(function () { location.href = '/app'; }, 900); }); })
        .catch(function (x) { msg(x.message); });
    };
  }

  // ---------------------------------------------------------------- app chrome
  function tabs(active) {
    var t = [['/app', 'Dashboard'], ['/analyzer', 'Analyzer'], ['/app/tools', 'Tools'], ['/app/profile', 'Investor profile'], ['/pricing', 'Plans']];
    return '<nav class="app-tabs no-print">' + t.map(function (x) { return '<a href="' + x[0] + '"' + (x[0] === active ? ' class="on"' : '') + '>' + x[1] + '</a>'; }).join('') + '<a href="#" id="lr-logout" style="margin-left:auto">Sign out</a></nav>';
  }
  function bindChrome() { var l = $('#lr-logout'); if (l) l.onclick = function (e) { e.preventDefault(); logout(); }; }
  function requireAuth(fn) {
    if (!signedIn()) { goLogin(); return; }
    root.innerHTML = '<div class="empty-state"><span class="spin"></span> Loading…</div>';
    loadCtx().then(fn).catch(function (e) {
      root.innerHTML = '<div class="box"><h2>Something went wrong</h2><p class="hint">' + esc(e.message) + '</p><a class="btn btn-line" href="/app">Try again</a></div>';
    });
  }

  // ---------------------------------------------------------------- page: dashboard
  var JOURNEY = [
    ['Know your budget', 'Fill in your investor profile: income, debts, cash and credit. This sets your safe price range and the reserves lenders expect.', '/app/profile'],
    ['Get pre-approved', 'Ask two or three lenders for a Loan Estimate for an investment property. Compare them line by line.', '/app/tools?t=offers'],
    ['Find and check a property', 'Enter the listing, real rent comps, taxes and an insurance quote. Look at the red flags.', '/analyzer'],
    ['Make an offer', 'Offer a price where the numbers still work after the stress test. Keep inspection, appraisal and financing contingencies.', '/app/tools?t=letter'],
    ['Inspection and appraisal', 'Use the inspection to renegotiate repairs. If the appraisal comes in low, the price usually has to come down.', '/app/tools?t=price'],
    ['Financing and closing', 'Send the lender package, lock your rate, review the Closing Disclosure three days before closing.', '/app'],
    ['Rent it out and manage it', 'Screen tenants with written criteria that follow fair housing law, sign a lease, track income and expenses for Schedule E.', '/app/tools?t=schedule']
  ];
  function pageDashboard() {
    requireAuth(function (c) {
      var beginner = mode() === 'beginner', pf = c.profile || {};
      var profDone = !!(pf.annual_income && pf.liquid_reserves != null && pf.credit_band);
      var st = c.props.map(function (p) { return p.status; });
      var stage = !profDone ? 0 : !c.props.length ? 2 : st.indexOf('owned') >= 0 ? 6 : st.indexOf('under_contract') >= 0 ? 5 : st.indexOf('offer') >= 0 ? 4 : 3;
      var limit = c.tier === 0 ? 2 : Infinity;
      var h = tabs('/app') + '<div class="app-bar"><div><h1>' + (pf.full_name ? 'Hi, ' + esc(pf.full_name.split(' ')[0]) : 'Your dashboard') + '</h1><div class="sub">' + (beginner ? 'Beginner view: we guide you step by step through a real purchase.' : 'Pro view: portfolio figures and every tool at a glance.') + '</div></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill plan">' + PLAN_NAME[c.tier] + (c.tier === 1 ? ' until ' + new Date(c.ent.pass_until).toLocaleDateString('en-US') : '') + '</span><button class="btn btn-line btn-sm" id="lr-mode">' + (beginner ? 'Switch to Pro view' : 'Switch to Beginner view') + '</button></div></div>';

      if (beginner) {
        h += '<div class="box"><h2>Your path to the first rental</h2><p class="hint">This is the order a real purchase follows in the US. Finish one step, then move to the next.</p><div class="journey">' + JOURNEY.map(function (j, i) {
          return '<div class="jstep' + (i < stage ? ' done' : i === stage ? ' now' : '') + '"><div><b>' + j[0] + '</b><p>' + j[1] + '</p>' + (i === stage ? '<a href="' + j[2] + '">Start this step →</a>' : '') + '</div></div>';
        }).join('') + '</div></div>';
      } else {
        var tot = c.props.filter(function (p) { return p.status !== 'passed'; }).map(function (p) { return C.analyze(p.data || {}, pf); });
        var sum = function (f) { return tot.reduce(function (s, r) { return s + f(r); }, 0); };
        var val = sum(function (r) { return r.input.arv || r.input.price; }), debt = sum(function (r) { return r.loan; });
        h += '<div class="kpis" style="margin-bottom:16px">' + [
          ['Properties tracked', String(tot.length), ''], ['Total value', usd(val), ''], ['Total debt', usd(debt), ''],
          ['Combined cash flow / mo', usd(sum(function (r) { return r.cashFlowM; })), sign(sum(function (r) { return r.cashFlowM; }))],
          ['Combined NOI / yr', usd(sum(function (r) { return r.noi; })), ''], ['Portfolio LTV', val ? pct(debt / val * 100) : '–', '']
        ].map(function (x) { return '<div class="kp"><div class="k">' + x[0] + '</div><div class="v ' + x[2] + '">' + x[1] + '</div></div>'; }).join('') + '</div>';
      }
      if (!profDone) h += '<div class="gate">Complete your <a href="/app/profile" style="font-weight:700;text-decoration:underline">investor profile</a> so the analyzer can check cash, reserves and debt-to-income for you.</div>';

      h += '<div class="box"><div class="app-bar" style="margin:0 0 12px"><h2>Your properties</h2><span class="hint" style="margin:0">' + c.props.length + (limit === Infinity ? '' : ' of ' + limit) + ' saved</span></div><div class="props">' + c.props.map(function (p) {
        var r = C.analyze(p.data || {}, pf);
        return '<a class="prop" href="/app/property?id=' + encodeURIComponent(p.id) + '"><div style="display:flex;justify-content:space-between;gap:8px"><h3>' + esc(p.name) + '</h3><span class="pill ' + r.verdict.tone + '">' + esc(r.verdict.label) + '</span></div><div class="loc">' + esc(C.STATE_NAMES[r.input.state]) + ' · ' + esc(statusLabel(p.status)) + '</div><div class="row"><span>Price</span><b>' + usd(r.input.price) + '</b></div><div class="row"><span>Cash flow / mo</span><b class="' + sign(r.cashFlowM) + '">' + usd(r.cashFlowM) + '</b></div><div class="row"><span>Cash-on-cash</span><b>' + pct(r.coc) + '</b></div><div class="row"><span>DSCR</span><b>' + (r.dscr == null ? 'n/a' : x2(r.dscr)) + '</b></div></a>';
      }).join('') + (c.props.length < limit ? '<a class="prop new" href="/app/property?new=1"><b style="font-size:28px;color:#0E7A53">+</b><span>Add a property</span></a>' : '<a class="prop new" href="/pricing?limit=1"><b>Free plan: 2 properties</b><span>Upgrade for unlimited properties</span></a>') + '</div></div>';

      h += '<div class="box"><h2>Tools</h2><p class="hint">Calculators that use the numbers from your properties and profile.</p>' + toolsGrid(c.tier) + '</div>';
      root.innerHTML = h; bindChrome();
      $('#lr-mode').onclick = function () { setMode(beginner ? 'pro' : 'beginner'); };
    });
  }
  function setMode(m) {
    store('lr-mode', m);
    db('financial_profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ user_id: uid(), mode: m }) })
      .catch(function () {}).then(function () { location.reload(); });
  }
  function statusLabel(s) { return { analyzing: 'Analyzing', offer: 'Offer made', under_contract: 'Under contract', owned: 'Owned', passed: 'Passed' }[s] || s; }

  // ---------------------------------------------------------------- page: property
  function pageProperty() {
    requireAuth(function (c) {
      var id = qs('id'), prop = id ? c.props.filter(function (p) { return p.id === id; })[0] : null;
      if (id && !prop) { root.innerHTML = tabs('') + '<div class="box"><h2>Property not found</h2><a class="btn btn-line" href="/app">Back to dashboard</a></div>'; bindChrome(); return; }
      if (!prop && c.tier === 0 && c.props.length >= 2) { location.replace('/pricing?limit=1'); return; }
      var data = prop ? prop.data || {} : { state: (c.profile && c.profile.state) || '' , name: '' };
      if (!prop) { data = { name: '', state: data.state || 'TX', price: '', rent: '' }; }
      var beginner = mode() === 'beginner';
      var head = '<div class="app-bar" style="margin-bottom:12px"><h2 style="margin:0">' + (prop ? esc(prop.name) : 'New property') + '</h2>' + (prop ? '<select id="lr-status" class="no-print" style="width:auto;padding:7px 10px;border-radius:9px;border:1px solid #D5DBE7">' + ['analyzing', 'offer', 'under_contract', 'owned', 'passed'].map(function (s) { return '<option value="' + s + '"' + (s === prop.status ? ' selected' : '') + '>' + statusLabel(s) + '</option>'; }).join('') + '</select>' : '') + '</div>' + (beginner ? '<p class="hint">Fill in what you know. Empty taxes and insurance use typical values for the state – replace them with real quotes before you make an offer.</p>' : '');
      root.innerHTML = tabs('') + '<div id="lr-an"></div>';
      bindChrome();
      var dirty = false;
      var A = mountAnalyzer($('#lr-an'), data, {
        beginner: beginner, profile: c.profile || {}, head: head,
        actions: function () {
          return '<div class="box no-print" style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="lr-save">' + (prop ? 'Save changes' : 'Save property') + '</button>' + (prop ? '<a class="btn btn-pay btn-sm" href="/app/loan-package?id=' + encodeURIComponent(prop.id) + '">Lender package (PDF)</a><a class="btn btn-line btn-sm" href="/app/tools?t=meeting&id=' + encodeURIComponent(prop.id) + '">Lender meeting prep</a><button class="btn btn-danger btn-sm" id="lr-del">Delete</button>' : '') + '</div>';
        },
        onChange: function () { dirty = true; }
      });
      function bindActions() {
        var sv = $('#lr-save'); if (sv) sv.onclick = save;
        var dl = $('#lr-del'); if (dl) dl.onclick = function () {
          if (!confirm('Delete this property permanently?')) return;
          db('properties?id=eq.' + encodeURIComponent(prop.id), { method: 'DELETE' }).then(function () { location.href = '/app'; }).catch(function (e) { toast(e.message); });
        };
      }
      dirty = false; bindActions();
      function save() {
        var d = A.read(); var name = (d.name || '').slice(0, 120) || 'Untitled property';
        var b = $('#lr-save'); if (b) b.disabled = true;
        var req = prop ? db('properties?id=eq.' + encodeURIComponent(prop.id), { method: 'PATCH', body: JSON.stringify({ name: name, data: d }) })
          : db('properties', { method: 'POST', body: JSON.stringify({ name: name, data: d }) });
        req.then(function (rows) { dirty = false; toast('Saved'); if (!prop) location.replace('/app/property?id=' + encodeURIComponent(rows[0].id)); else { prop.data = d; prop.name = name; if (b) b.disabled = false; } })
          .catch(function (e) { if (b) b.disabled = false; if (/FREE_LIMIT/.test(e.message)) location.href = '/pricing?limit=1'; else toast(e.message); });
      }
      var stSel = $('#lr-status');
      if (stSel) stSel.onchange = function () { db('properties?id=eq.' + encodeURIComponent(prop.id), { method: 'PATCH', body: JSON.stringify({ status: stSel.value }) }).then(function () { toast('Status updated'); }).catch(function (e) { toast(e.message); }); };
      window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    });
  }

  // ---------------------------------------------------------------- page: profile
  function pageProfile() {
    requireAuth(function (c) {
      var p = c.profile || {}, u = { email: claims().email };
      function sel(name, opts, v) { return '<select name="' + name + '">' + '<option value="">–</option>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
      root.innerHTML = tabs('/app/profile') + '<div class="app-bar"><div><h1>Investor profile</h1><div class="sub">Used for affordability, reserves, debt-to-income, taxes and your lender package. Only you can see it.</div></div></div><div class="cols"><form class="box" id="pf"><div class="fg">' +
        '<label class="fl full">Full name<input name="full_name" maxlength="120" value="' + esc(p.full_name || '') + '" autocomplete="name"></label>' +
        '<label class="fl">Home state' + sel('state', STATES.map(function (s) { return [s, C.STATE_NAMES[s]]; }), p.state) + '</label>' +
        '<label class="fl">Buy as' + sel('buy_as', [['individual', 'Individual'], ['llc', 'LLC']], p.buy_as) + '</label>' +
        '<label class="fl">Gross annual income<div class="pre"><span>$</span><input name="annual_income" type="number" min="0" value="' + esc(p.annual_income == null ? '' : p.annual_income) + '"></div><small>All W-2 and 1099 income before tax.</small></label>' +
        '<label class="fl">Monthly debt payments<div class="pre"><span>$</span><input name="monthly_debts" type="number" min="0" value="' + esc(p.monthly_debts == null ? '' : p.monthly_debts) + '"></div><small>Your home payment, car, student loans, card minimums.</small></label>' +
        '<label class="fl">Cash available to invest<div class="pre"><span>$</span><input name="liquid_reserves" type="number" min="0" value="' + esc(p.liquid_reserves == null ? '' : p.liquid_reserves) + '"></div><small>Checking, savings, brokerage you can use.</small></label>' +
        '<label class="fl">Credit score' + sel('credit_band', [['760+', '760 or higher'], ['720-759', '720–759'], ['680-719', '680–719'], ['640-679', '640–679'], ['<640', 'Below 640']], p.credit_band) + '</label>' +
        '<label class="fl">Filing status' + sel('filing_status', [['single', 'Single'], ['married_joint', 'Married filing jointly'], ['married_separate', 'Married filing separately'], ['head', 'Head of household']], p.filing_status) + '</label>' +
        '<label class="fl">Federal tax bracket<div class="suf"><input name="marginal_rate" type="number" min="0" max="50" value="' + esc(p.marginal_rate == null ? '' : p.marginal_rate) + '"><span>%</span></div></label>' +
        '<label class="fl">Rental units you own<input name="doors_owned" type="number" min="0" value="' + esc(p.doors_owned == null ? '' : p.doors_owned) + '"></label>' +
        '<label class="fl">View' + sel('mode', [['beginner', 'Beginner – guide me'], ['pro', 'Pro – show everything']], p.mode || mode()) + '</label>' +
        '</div><button class="btn btn-primary" style="margin-top:16px">Save profile</button></form><div><div class="box"><h2>Your buying power</h2><div id="bp"></div></div><div class="box"><h2>Account</h2><p class="hint" style="margin:0">' + esc(u.email || '') + '<br>Plan: <b>' + PLAN_NAME[c.tier] + '</b></p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn btn-line btn-sm" href="/pricing">Plans</a><a class="btn btn-line btn-sm" href="mailto:invest@leaserun.com?subject=Delete%20my%20LeaseRun%20account">Request account deletion</a></div></div></div></div>';
      bindChrome();
      var f = $('#pf');
      function bp() {
        var d = {}; $$('input,select', f).forEach(function (i) { d[i.name] = i.value; });
        var inc = +d.annual_income || 0, debts = +d.monthly_debts || 0, cash = +d.liquid_reserves || 0;
        if (!inc || !cash) { $('#bp').innerHTML = '<p class="hint" style="margin:0">Enter income and cash to see a safe price range.</p>'; return; }
        // Cash limit: 25% down + ~3.5% closing + 6 months PITIA (~0.8% of price per month incl. taxes/ins at 7%).
        var byCash = cash / (0.25 + 0.035 + 6 * 0.0075);
        var room = inc / 12 * 0.45 - debts;
        $('#bp').innerHTML = '<table class="tbl"><tbody><tr><td>Price your cash supports (25% down, closing, 6 mo. reserves)</td><td>' + usd(byCash) + '</td></tr><tr><td>Room for new debt at 45% DTI</td><td class="' + sign(room) + '">' + usd(room) + '/mo</td></tr></tbody></table><p class="hint" style="margin:8px 0 0">Lenders usually count 75% of the expected rent as income. A rental that cash-flows uses little or none of your DTI room. Rough guide only – your Loan Estimate decides.</p>';
      }
      f.addEventListener('input', bp); bp();
      f.onsubmit = function (e) {
        e.preventDefault();
        var d = { user_id: uid() };
        $$('input,select', f).forEach(function (i) { var v = i.value.trim(); d[i.name] = v === '' ? null : (i.type === 'number' ? +v : v); });
        if (!d.mode) d.mode = 'beginner';
        store('lr-mode', d.mode);
        db('financial_profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(d) })
          .then(function () { toast('Profile saved'); ctx = null; }).catch(function (x) { toast(x.message); });
      };
    });
  }

  // ---------------------------------------------------------------- tools
  var TOOLS = [
    ['closing', 'Closing cost estimator', 'Itemized lender, title, escrow and prepaid costs plus cash to close.', 0],
    ['price', 'Price check', 'Compare the asking price per square foot with recent sales nearby.', 0],
    ['extra', 'Extra payments', 'How much interest and time extra principal payments save.', 0],
    ['offers', 'Compare Loan Estimates', 'Line up up to three lender offers: rate, points, fees and true cost.', 1],
    ['meeting', 'Lender meeting prep', 'Your numbers, the questions to ask and the documents to bring.', 1],
    ['letter', 'Offer letter', 'A clear cover letter for your purchase offer with the key terms.', 1],
    ['portfolio', 'Portfolio stress test', 'All properties together under rate, rent and vacancy shocks.', 2],
    ['refi', 'Refinance & cash-out', 'New payment, cash-out and break-even for a refinance.', 2],
    ['schedule', 'Schedule E export', 'Year-one income and expense lines per property as CSV for your CPA.', 2]
  ];
  function toolsGrid(tier) {
    return '<div class="tools">' + TOOLS.map(function (t) {
      var locked = tier < t[3];
      return '<a class="tool' + (locked ? ' locked' : '') + '" href="' + (locked ? '/pricing' : '/app/tools?t=' + t[0]) + '"><b>' + t[1] + '</b><p>' + t[2] + '</p>' + (locked ? '<span class="lock">🔒 ' + PLAN_NAME[t[3]] + '</span>' : '<span class="pill good" style="align-self:flex-start">Open</span>') + '</a>';
    }).join('') + '</div>';
  }
  function propSelect(c, id) {
    if (!c.props.length) return '';
    return '<label class="fl full no-print">Use numbers from<select id="t-prop"><option value="">– enter manually –</option>' + c.props.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>';
  }
  function num(id) { var e = $('#' + id); return e && e.value !== '' ? +e.value : null; }
  function inp(id, label, v, kind, help) {
    var core = '<input id="' + id + '" type="number" inputmode="decimal" step="any" min="0" value="' + (v == null ? '' : esc(v)) + '">';
    return '<label class="fl" for="' + id + '">' + esc(label) + (kind === 'usd' ? '<div class="pre"><span>$</span>' + core + '</div>' : kind === 'pct' ? '<div class="suf">' + core + '<span>%</span></div>' : core) + (help ? '<small>' + esc(help) + '</small>' : '') + '</label>';
  }
  function pageTools() {
    requireAuth(function (c) {
      var key = qs('t');
      var t = TOOLS.filter(function (x) { return x[0] === key; })[0];
      if (!t) { root.innerHTML = tabs('/app/tools') + '<div class="app-bar"><div><h1>Tools</h1><div class="sub">Plan: ' + PLAN_NAME[c.tier] + '</div></div></div>' + toolsGrid(c.tier); bindChrome(); return; }
      if (c.tier < t[3]) { root.innerHTML = tabs('/app/tools') + '<div class="gate"><b>' + esc(t[1]) + '</b> is part of ' + PLAN_NAME[t[3]] + '. <a href="/pricing" style="font-weight:700;text-decoration:underline">See plans</a></div>' + toolsGrid(c.tier); bindChrome(); return; }
      var pid = qs('id') || '', prop = c.props.filter(function (p) { return p.id === pid; })[0];
      var d = prop ? C.normalize(prop.data || {}) : null;
      var canPrint = c.tier >= 1;
      root.innerHTML = tabs('/app/tools') + '<div class="app-bar"><div><h1>' + esc(t[1]) + '</h1><div class="sub">' + esc(t[2]) + '</div></div>' + (canPrint ? '<button class="btn btn-line btn-sm no-print" onclick="window.print()">Print / save as PDF</button>' : '') + '</div><div class="cols"><div class="box" id="t-in"></div><div class="sticky"><div class="box" id="t-out"></div></div></div>';
      bindChrome();
      var IN = $('#t-in'), OUT = $('#t-out');
      var R = TOOL_IMPL[key](c, d, IN, OUT);
      var sp = $('#t-prop'); if (sp) sp.onchange = function () { location.href = '/app/tools?t=' + key + (sp.value ? '&id=' + encodeURIComponent(sp.value) : ''); };
      IN.addEventListener('input', R); IN.addEventListener('change', R); R();
    });
  }
  var TOOL_IMPL = {
    closing: function (c, d, IN, OUT) {
      IN.innerHTML = '<div class="fg">' + propSelect(c, qs('id')) + inp('a', 'Purchase price', d && d.price, 'usd') + inp('b', 'Down payment', d ? d.downPct : null, 'pct') + inp('r', 'Interest rate', d && d.rate, 'pct') + inp('pt', 'Discount points', d ? d.pointsPct : 0, 'pct') +
        '<label class="fl">State<select id="s">' + STATES.map(function (s) { return '<option value="' + s + '"' + (s === ((d && d.state) || (c.profile && c.profile.state)) ? ' selected' : '') + '>' + C.STATE_NAMES[s] + '</option>'; }).join('') + '</select></label>' + inp('tt', 'Transfer tax you pay', d ? d.transferTaxPct : 0, 'pct', 'Usually the seller pays; check your state.') + '</div>';
      return function () {
        var price = num('a'); if (!price) { OUT.innerHTML = '<p class="hint" style="margin:0">Enter a purchase price.</p>'; return; }
        var r = C.analyze({ price: price, downPct: num('b') == null ? 25 : num('b'), rate: num('r') || 7, pointsPct: num('pt') || 0, state: $('#s').value, transferTaxPct: num('tt') || 0, rent: 0 });
        OUT.innerHTML = '<h2>Cash to close</h2><table class="tbl"><tbody><tr><td>Down payment</td><td>' + usd(r.down) + '</td></tr>' + r.closing.items.map(function (i) { return '<tr><td>' + esc(i.label) + '</td><td>' + usd(i.amount) + '</td></tr>'; }).join('') + '<tr class="tot"><td>Cash to close</td><td>' + usd(r.cashToClose) + '</td></tr></tbody></table><p class="hint" style="margin:8px 0 0">Closing costs ≈ ' + pct(r.closing.pctOfPrice) + ' of the price (' + usd(r.closing.total) + '). Taxes use the ' + esc(C.STATE_NAMES[r.input.state]) + ' average. Your Loan Estimate (page 2) shows the lender’s real figures.</p>';
      };
    },
    price: function (c, d, IN, OUT) {
      var comps = '';
      for (var i = 1; i <= 5; i++) comps += inp('cp' + i, 'Sale ' + i + ' price', null, 'usd') + inp('cs' + i, 'Sale ' + i + ' sq ft', null);
      IN.innerHTML = '<div class="fg">' + propSelect(c, qs('id')) + inp('a', 'Asking price', d && d.price, 'usd') + inp('sq', 'Living area (sq ft)', d && d.sqft) + '<p class="hint full" style="margin:6px 0 0">Recent sales of similar homes nearby (last 6 months, within about a mile). Your agent or the county records have them.</p>' + comps + '</div>';
      return function () {
        var price = num('a'), sq = num('sq'), pps = [];
        for (var i = 1; i <= 5; i++) { var p = num('cp' + i), s = num('cs' + i); if (p && s) pps.push(p / s); }
        if (!price || !sq || pps.length < 2) { OUT.innerHTML = '<p class="hint" style="margin:0">Enter the asking price, size and at least two comparable sales.</p>'; return; }
        pps.sort(function (a, b) { return a - b; });
        var med = pps.length % 2 ? pps[(pps.length - 1) / 2] : (pps[pps.length / 2 - 1] + pps[pps.length / 2]) / 2;
        var fair = med * sq, diff = (price - fair) / fair * 100;
        OUT.innerHTML = '<h2>Price check</h2><div class="kpis"><div class="kp"><div class="k">Asking $/sq ft</div><div class="v">' + usd(price / sq) + '</div></div><div class="kp"><div class="k">Comps median $/sq ft</div><div class="v">' + usd(med) + '</div></div><div class="kp"><div class="k">Implied value</div><div class="v">' + usd(fair) + '</div></div></div><div class="verdict ' + (diff > 8 ? 'bad' : diff > 2 ? 'mid' : 'good') + '" style="margin-top:12px"><div><b>' + (diff >= 0 ? pct(diff) + ' above' : pct(-diff) + ' below') + ' the comps</b><p>' + (diff > 8 ? 'An appraisal may come in low. Negotiate or keep your appraisal contingency.' : diff > 2 ? 'Slightly above the comps. Use inspection findings to negotiate.' : 'In line with or below recent sales.') + '</p></div></div><p class="hint" style="margin:0">Range of comps: ' + usd(pps[0]) + '–' + usd(pps[pps.length - 1]) + ' per sq ft. Condition, lot and location matter more than averages.</p>';
      };
    },
    extra: function (c, d, IN, OUT) {
      var loan = d ? Math.round(d.price * (1 - d.downPct / 100)) : null;
      IN.innerHTML = '<div class="fg">' + propSelect(c, qs('id')) + inp('l', 'Loan balance', loan, 'usd') + inp('r', 'Interest rate', d && d.rate, 'pct') + inp('y', 'Years remaining', d ? d.termYears : null) + inp('x', 'Extra principal per month', 100, 'usd') + inp('ls', 'One-time extra payment', 0, 'usd') + (mode() === 'pro' ? inp('alt', 'Alternative return if invested instead', 7, 'pct', 'Compare paying down debt with investing the cash.') : '') + '</div>';
      return function () {
        var l = num('l'), r = num('r'), y = num('y');
        if (!l || r == null || !y) { OUT.innerHTML = '<p class="hint" style="margin:0">Enter balance, rate and years remaining.</p>'; return; }
        var base = C.amortize(l, r, y, 0, 0), ex = C.amortize(l, r, y, num('x') || 0, num('ls') || 0);
        var saved = base.months - ex.months, end = new Date(); end.setMonth(end.getMonth() + ex.months);
        var h = '<h2>Result</h2><div class="kpis"><div class="kp"><div class="k">Interest saved</div><div class="v pos">' + usd(base.interest - ex.interest) + '</div></div><div class="kp"><div class="k">Paid off earlier by</div><div class="v">' + Math.floor(saved / 12) + 'y ' + saved % 12 + 'm</div></div><div class="kp"><div class="k">New payoff</div><div class="v">' + end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + '</div></div></div><p class="hint" style="margin:10px 0 0">Monthly payment stays ' + usd(base.payment) + '. Ask your servicer to apply extra money to principal; most US mortgages have no prepayment penalty, but some DSCR loans do (check your note).</p>';
        var alt = num('alt');
        if (alt != null) h += '<div class="explain">Paying down debt earns a guaranteed ' + pct(r, 2) + '. Investing at ' + pct(alt) + ' earns more on paper but with risk. On a rental, mortgage interest is deductible, so the after-tax cost of the loan is lower than the rate.</div>';
        OUT.innerHTML = h;
      };
    },
    offers: function (c, d, IN, OUT) {
      var loan = d ? Math.round(d.price * (1 - d.downPct / 100)) : null, rows = '';
      for (var i = 1; i <= 3; i++) rows += '<p class="full" style="font-weight:700;margin-top:8px">Offer ' + i + '</p>' + '<label class="fl">Lender<input id="n' + i + '" maxlength="40"></label>' + inp('r' + i, 'Rate', null, 'pct') + inp('p' + i, 'Points', null, 'pct') + inp('f' + i, 'Lender fees (Loan Estimate section A)', null, 'usd') + inp('cr' + i, 'Lender credits', null, 'usd');
      IN.innerHTML = '<div class="fg">' + propSelect(c, qs('id')) + inp('l', 'Loan amount', loan, 'usd') + inp('h', 'How long you expect to keep the loan', 7, '', 'years') + rows + '</div>';
      return function () {
        var l = num('l'), h = num('h') || 7, offers = [];
        for (var i = 1; i <= 3; i++) if (num('r' + i) != null) offers.push({ name: ($('#n' + i).value || 'Offer ' + i), rate: num('r' + i), pointsPct: num('p' + i) || 0, fees: num('f' + i) || 0, credits: num('cr' + i) || 0, termYears: 30 });
        if (!l || offers.length < 2) { OUT.innerHTML = '<p class="hint" style="margin:0">Enter the loan amount and at least two offers from your Loan Estimates.</p>'; return; }
        var res = C.compareOffers(l, offers, h), best = res.reduce(function (a, b) { return a.costOverHorizon < b.costOverHorizon ? a : b; });
        OUT.innerHTML = '<h2>True cost over ' + h + ' years</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Lender</th><th>Payment</th><th>Upfront</th><th>Total cost</th></tr></thead><tbody>' + res.map(function (r) { return '<tr' + (r === best ? ' style="background:#E3F7EE"' : '') + '><td>' + esc(r.name) + (r === best ? ' ✓' : '') + '</td><td>' + usd(r.payment) + '</td><td>' + usd(r.upfront) + '</td><td>' + usd(r.costOverHorizon) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="hint" style="margin:8px 0 0">Total cost = upfront costs + interest paid over the period. Points only pay off if you keep the loan long enough. Compare Loan Estimates issued on the same day – rates change daily.</p>';
      };
    },
    meeting: function (c, d, IN, OUT) {
      IN.innerHTML = '<div class="fg">' + propSelect(c, qs('id')) + '</div>' + (d ? '' : '<p class="hint">Pick a saved property to fill in your numbers.</p>');
      return function () {
        var pf = c.profile || {};
        var r = d ? C.analyze(d, pf) : null;
        OUT.innerHTML = '<h2>Your numbers</h2>' + (r ? '<table class="tbl"><tbody><tr><td>Purchase price</td><td>' + usd(r.input.price) + '</td></tr><tr><td>Loan amount / LTV</td><td>' + usd(r.loan) + ' / ' + pct(r.ltv, 0) + '</td></tr><tr><td>Expected rent</td><td>' + usd(r.input.rent) + '/mo</td></tr><tr><td>PITIA</td><td>' + usd(r.pitia) + '</td></tr><tr><td>DSCR (rent ÷ PITIA)</td><td>' + x2(r.dscrLender) + '</td></tr><tr><td>Cash to close</td><td>' + usd(r.cashToClose) + '</td></tr><tr><td>Cash available</td><td>' + usd(+pf.liquid_reserves || null) + '</td></tr><tr><td>Credit score</td><td>' + esc(pf.credit_band || '–') + '</td></tr></tbody></table>' : '<p class="hint">–</p>') +
          '<h2 style="margin-top:18px">Questions to ask</h2><ul style="padding-left:18px;font-size:14px;display:grid;gap:6px">' + ['What rate and points do you quote today for a non-owner-occupied ' + (d ? TYPES.filter(function (t) { return t[0] === d.type; })[0][1].toLowerCase() : 'rental') + '? Please send an official Loan Estimate.', 'Is this a conventional or a DSCR loan? What minimum DSCR and credit score do you require?', 'How many months of reserves do you require, and do retirement accounts count?', 'How much of the rent do you count as income (usually 75%), and do you need a lease or an appraiser’s rent schedule (Form 1007)?', 'Is there a prepayment penalty? For how long?', 'Can I close in an LLC? Is a personal guarantee required?', 'What does a rate lock cost and how long does it last?', 'What are your underwriting and processing fees (Loan Estimate section A)?'].map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>' +
          '<h2 style="margin-top:18px">Documents to bring</h2><ul style="padding-left:18px;font-size:14px;display:grid;gap:6px">' + ['Photo ID', 'Last two years of federal tax returns with all schedules (incl. Schedule E)', 'W-2s / 1099s for two years and the last 30 days of pay stubs', 'Two most recent months of bank and investment statements (all pages)', 'Leases and mortgage statements for properties you already own', 'Purchase contract and the listing for the subject property', 'LLC documents and EIN letter if buying in an entity', 'Insurance quote (landlord / DP-3 policy)'].map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>';
      };
    },
    letter: function (c, d, IN, OUT) {
      var pf = c.profile || {};
      IN.innerHTML = '<div class="fg">' + propSelect(c, qs('id')) +
        '<label class="fl full">Your name<input id="bn" maxlength="80" value="' + esc(pf.full_name || '') + '"></label><label class="fl full">Property address<input id="ad" maxlength="120" value="' + esc(d ? d.name : '') + '"></label>' +
        inp('op', 'Offer price', d && d.price, 'usd') + inp('em', 'Earnest money deposit', d ? Math.round(d.price * 0.01) : null, 'usd') + inp('dp', 'Down payment', d ? d.downPct : null, 'pct') + inp('ins', 'Inspection period', 10, '', 'days') + inp('fin', 'Financing contingency', 21, '', 'days') + inp('cl', 'Days to close', 30) + inp('cc', 'Seller credit toward closing costs', 0, 'usd') +
        '<label class="chk full"><input type="checkbox" id="ap" checked><span>Appraisal contingency</span></label></div>';
      return function () {
        var name = $('#bn').value.trim() || '[Your name]', ad = $('#ad').value.trim() || '[Property address]', op = num('op');
        var lines = ['Dear Seller,', '', 'Thank you for the opportunity to make an offer on ' + ad + '. I am pleased to offer ' + (op ? usd(op) : '[price]') + ' with the following terms:', '',
          '• Earnest money deposit: ' + usd(num('em')) + ', held in escrow by the title company',
          '• Financing: ' + (num('dp') === 100 ? 'all cash, proof of funds attached' : 'investment-property loan with ' + pct(num('dp') || 25, 0) + ' down, pre-approval letter attached'),
          '• Inspection period: ' + (num('ins') || 10) + ' days', '• Financing contingency: ' + (num('fin') || 21) + ' days',
          '• ' + ($('#ap').checked ? 'Appraisal contingency: the property must appraise at or above the purchase price' : 'No appraisal contingency'),
          '• Closing: within ' + (num('cl') || 30) + ' days of acceptance', (num('cc') ? '• Seller credit toward buyer closing costs: ' + usd(num('cc')) : ''), '',
          'I have reviewed the property carefully and am ready to move quickly. The binding terms will be set out in the state purchase agreement prepared by my agent or attorney.', '', 'Sincerely,', name];
        OUT.innerHTML = '<h2>Your offer letter</h2><pre id="ltr" style="white-space:pre-wrap;font-family:var(--sans);font-size:14px;line-height:1.6;background:#F7F9FC;border-radius:10px;padding:16px">' + esc(lines.filter(function (l, i) { return l !== '' || lines[i - 1] !== ''; }).join('\n')) + '</pre><button class="btn btn-line btn-sm no-print" id="cp">Copy text</button><p class="hint" style="margin:10px 0 0">A cover letter does not replace the purchase agreement. Do not mention personal characteristics of yourself or the seller (fair housing).</p>';
        $('#cp').onclick = function () { try { navigator.clipboard.writeText($('#ltr').textContent); toast('Copied'); } catch (e) { toast('Copy not available'); } };
      };
    },
    portfolio: function (c, d, IN, OUT) {
      IN.innerHTML = '<div class="fg">' + inp('rs', 'Rate shock', 2, 'pct', 'For adjustable loans and refinancing.') + inp('rd', 'Rent drop', 10, 'pct') + inp('vc', 'Vacancy', 12, 'pct') + '<label class="chk full"><input type="checkbox" id="own" checked><span>Only properties marked Owned or Under contract</span></label></div>';
      return function () {
        var only = $('#own').checked, pf = c.profile || {};
        var ps = c.props.filter(function (p) { return !only || p.status === 'owned' || p.status === 'under_contract'; });
        if (!ps.length) { OUT.innerHTML = '<p class="hint" style="margin:0">No matching properties. Mark properties as Owned on their page, or untick the filter.</p>'; return; }
        var rows = ps.map(function (p) {
          var b = C.analyze(p.data || {}, pf), s = C.analyze(Object.assign({}, p.data, { rate: b.input.rate + (num('rs') || 0), rent: b.input.rent * (1 - (num('rd') || 0) / 100), vacancyPct: num('vc') || b.input.vacancyPct }), pf);
          return { n: p.name, b: b, s: s };
        });
        var sum = function (f) { return rows.reduce(function (a, r) { return a + f(r); }, 0); };
        OUT.innerHTML = '<h2>Portfolio</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Property</th><th>Cash flow / mo</th><th>Stressed</th><th>DSCR</th><th>Stressed</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r.n) + '</td><td class="' + sign(r.b.cashFlowM) + '">' + usd(r.b.cashFlowM) + '</td><td class="' + sign(r.s.cashFlowM) + '">' + usd(r.s.cashFlowM) + '</td><td>' + (r.b.dscr == null ? 'n/a' : x2(r.b.dscr)) + '</td><td>' + (r.s.dscr == null ? 'n/a' : x2(r.s.dscr)) + '</td></tr>'; }).join('') + '<tr class="tot"><td>Total</td><td>' + usd(sum(function (r) { return r.b.cashFlowM; })) + '</td><td class="' + sign(sum(function (r) { return r.s.cashFlowM; })) + '">' + usd(sum(function (r) { return r.s.cashFlowM; })) + '</td><td></td><td></td></tr></tbody></table></div><p class="hint" style="margin:8px 0 0">Equity: ' + usd(sum(function (r) { return (r.b.input.arv || r.b.input.price) - r.b.loan; })) + ' · Debt: ' + usd(sum(function (r) { return r.b.loan; })) + '. Keep enough reserves to cover the stressed shortfall for at least 12 months: ' + usd(Math.max(0, -sum(function (r) { return r.s.cashFlowM; })) * 12) + '.</p>';
      };
    },
    refi: function (c, d, IN, OUT) {
      var loan = d ? Math.round(d.price * (1 - d.downPct / 100)) : null;
      IN.innerHTML = '<div class="fg">' + propSelect(c, qs('id')) + inp('ob', 'Original loan amount', loan, 'usd') + inp('or', 'Current rate', d && d.rate, 'pct') + inp('cb', 'Current balance', loan, 'usd') + inp('v', 'Current value', d && (d.arv || d.price), 'usd') + inp('nr', 'New rate', null, 'pct') + inp('nl', 'Cash-out LTV', 0, 'pct', '0 = rate-and-term only. Cash-out on rentals is usually capped at 70–75%.') + inp('cp', 'Refinance costs', 2.5, 'pct', 'Of the new loan.') + '</div>';
      return function () {
        if (!num('ob') || !num('cb') || num('or') == null || num('nr') == null) { OUT.innerHTML = '<p class="hint" style="margin:0">Enter the current loan, its rate and the new rate.</p>'; return; }
        var r = C.refinance({ origBalance: num('ob'), origRate: num('or'), origTerm: 30, currentBalance: num('cb'), value: num('v') || 0, newLtv: num('nl') || 0, newRate: num('nr'), newTerm: 30, costPct: num('cp') || 2.5 });
        OUT.innerHTML = '<h2>Refinance</h2><div class="kpis"><div class="kp"><div class="k">New loan</div><div class="v">' + usd(r.newLoan) + '</div></div><div class="kp"><div class="k">Cash out</div><div class="v">' + usd(r.cashOut) + '</div></div><div class="kp"><div class="k">New payment</div><div class="v">' + usd(r.newPayment) + '</div></div><div class="kp"><div class="k">Costs</div><div class="v">' + usd(r.costs) + '</div></div><div class="kp"><div class="k">Saving / mo (same balance)</div><div class="v ' + sign(r.monthlySaving) + '">' + usd(r.monthlySaving) + '</div></div><div class="kp"><div class="k">Break-even</div><div class="v">' + (r.breakEvenMonths ? r.breakEvenMonths + ' mo' : 'never') + '</div></div></div><p class="hint" style="margin:10px 0 0">A refinance resets the 30-year clock. Points on a rental refinance are deducted over the life of the loan, not at once.</p>';
      };
    },
    schedule: function (c, d, IN, OUT) {
      IN.innerHTML = '<p class="hint" style="margin:0">Year-one estimates from your saved properties, mapped to IRS Schedule E (Form 1040) lines. Replace them with your actual receipts at tax time.</p><button class="btn btn-primary btn-sm" id="csv" style="margin-top:14px">Download CSV</button>';
      var lines = [['3', 'Rents received', function (r) { return r.op.egi; }], ['9', 'Insurance', function (r) { return r.op.insurance; }], ['11', 'Management fees', function (r) { return r.op.mgmt; }], ['12', 'Mortgage interest', function (r) { return r.tax.interest; }], ['14', 'Repairs', function (r) { return r.op.maint; }], ['16', 'Taxes', function (r) { return r.op.taxes; }], ['17', 'Utilities', function (r) { return r.op.utilities; }], ['18', 'Depreciation', function (r) { return r.tax.depreciation; }], ['19', 'Other (HOA, PMI)', function (r) { return r.op.hoa + r.pmi * 12; }]];
      var ps = c.props.filter(function (p) { return p.status !== 'passed'; }).map(function (p) { return { n: p.name, r: C.analyze(p.data || {}, c.profile || {}) }; });
      $('#csv', IN).onclick = function () {
        var csv = [['Line', 'Item'].concat(ps.map(function (p) { return p.n; }))].concat(lines.map(function (l) { return [l[0], l[1]].concat(ps.map(function (p) { return Math.round(l[2](p.r)); })); }))
          .map(function (row) { return row.map(function (v) { v = String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'leaserun-schedule-e-estimate.csv'; a.click();
      };
      return function () {
        if (!ps.length) { OUT.innerHTML = '<p class="hint" style="margin:0">No properties yet.</p>'; return; }
        OUT.innerHTML = '<h2>Schedule E preview</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Line</th>' + ps.map(function (p) { return '<th>' + esc(p.n.slice(0, 18)) + '</th>'; }).join('') + '</tr></thead><tbody>' + lines.map(function (l) { return '<tr><td>' + l[0] + ' ' + l[1] + '</td>' + ps.map(function (p) { return '<td>' + usd(l[2](p.r)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      };
    }
  };

  // ---------------------------------------------------------------- loan package
  var SAMPLE = { data: { name: 'Sample: 1418 Oakwood Ave, Dayton OH', state: 'OH', type: 'duplex', units: 2, sqft: 1960, yearBuilt: 1984, price: 210000, rehab: 6000, rent: 2250, vacancyPct: 6, mgmtPct: 8, maintPct: 6, capexPct: 6, taxesAnnual: 3900, insuranceAnnual: 1650, loanType: 'conventional', downPct: 25, rate: 6.875 },
    profile: { full_name: 'Sample Borrower', buy_as: 'llc', state: 'OH', annual_income: 118000, monthly_debts: 2350, liquid_reserves: 98000, credit_band: '720-759', doors_owned: 1 } };
  function pagePackage() {
    if (qs('sample') === '1' || document.body.getAttribute('data-sample') === '1') { renderPackage(SAMPLE.data, SAMPLE.profile, { sample: true, id: 'SAMPLE' }); return; }
    requireAuth(function (c) {
      var p = c.props.filter(function (x) { return x.id === qs('id'); })[0];
      if (!p) { root.innerHTML = tabs('') + '<div class="box"><h2>Property not found</h2><a class="btn btn-line" href="/app">Back</a></div>'; bindChrome(); return; }
      var paid = c.tier >= 1 || c.ent.loan_packages_left > 0;
      renderPackage(p.data || {}, c.profile || {}, { paid: paid, id: p.id.slice(0, 8).toUpperCase(), status: p.status });
    });
  }
  function renderPackage(d, pf, o) {
    var r = C.analyze(d, pf), p = r.input, op = r.op;
    var today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var reservesAfter = pf.liquid_reserves != null ? +pf.liquid_reserves - r.cashToClose - p.rehab : null;
    var dti = pf.annual_income ? (((+pf.monthly_debts || 0) + r.pitia - 0.75 * (p.rent + p.otherIncome)) / (pf.annual_income / 12) * 100) : null;
    var rows = function (a) { return '<table class="tbl"><tbody>' + a.map(function (x) { return '<tr' + (x[2] ? ' class="tot"' : '') + '><td>' + x[0] + '</td><td>' + x[1] + '</td></tr>'; }).join('') + '</tbody></table>'; };
    var mark = o.sample ? 'SAMPLE' : (!o.paid ? 'PREVIEW' : '');
    var bar = '<div class="no-print" style="max-width:860px;margin:0 auto 14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      (o.sample ? '<span class="pill">Sample with fictional numbers</span><a class="btn btn-primary btn-sm" href="/signup">Create your own – free</a>' :
        '<a class="btn btn-line btn-sm" href="/app/property?id=' + encodeURIComponent(qs('id')) + '">← Back to property</a>' + (o.paid ? '<button class="btn btn-pay btn-sm" onclick="window.print()">Save as PDF / Print</button><span class="hint" style="margin:0;font-size:13px">In the print dialog choose “Save as PDF”.</span>' : '<span class="pill mid">Preview – printing is part of the Loan Package, Buyer Pass and Investor Pro</span><a class="btn btn-pay btn-sm" href="/pricing">See plans</a>')) + '</div>';
    var h = bar + '<article class="report">' + (mark ? '<div class="wm"><span>' + mark + '</span></div>' : '') +
      '<div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap"><div><div class="meta">INVESTMENT PROPERTY LOAN PACKAGE</div><h1>' + esc(p.name || 'Subject property') + '</h1><div class="meta">Prepared for ' + esc(pf.full_name || 'Borrower') + (pf.buy_as === 'llc' ? ' (purchasing through an LLC)' : '') + ' · ' + today + ' · Report ' + esc(o.id) + '</div></div><img src="/logo-mark.png" alt="" width="44" height="44" style="border-radius:8px"></div>' +
      '<h2>1. Summary</h2><div class="kpis"><div class="kp"><div class="k">Loan request</div><div class="v">' + usd(r.loan) + '</div><div class="x">' + pct(r.ltv, 0) + ' LTV</div></div><div class="kp"><div class="k">DSCR (rent ÷ PITIA)</div><div class="v">' + (r.dscrLender == null ? 'n/a' : x2(r.dscrLender)) + '</div><div class="x">NOI basis: ' + (r.dscr == null ? 'n/a' : x2(r.dscr)) + '</div></div><div class="kp"><div class="k">Reserves after closing</div><div class="v">' + (reservesAfter == null ? '–' : usd(reservesAfter)) + '</div><div class="x">' + (reservesAfter == null ? '' : (reservesAfter / r.pitia).toFixed(1) + ' months PITIA') + '</div></div></div>' +
      '<h2>2. Borrower</h2>' + rows([['Name', esc(pf.full_name || '–')], ['Vesting', pf.buy_as === 'llc' ? 'LLC (personal guarantee expected)' : 'Individual'], ['State of residence', esc(C.STATE_NAMES[pf.state] || '–')], ['Credit score (self-reported)', esc(pf.credit_band || '–')], ['Gross annual income', usd(+pf.annual_income || null)], ['Monthly debt payments', usd(pf.monthly_debts == null ? null : +pf.monthly_debts)], ['Estimated DTI incl. this property (75% of rent)', dti == null ? '–' : pct(dti)], ['Liquid assets', usd(pf.liquid_reserves == null ? null : +pf.liquid_reserves)], ['Rental units owned', pf.doors_owned == null ? '–' : String(pf.doors_owned)]]) +
      '<h2>3. Subject property</h2>' + rows([['Location', esc(C.STATE_NAMES[p.state])], ['Type / units', esc((TYPES.filter(function (t) { return t[0] === p.type; })[0] || ['', ''])[1]) + ' / ' + p.units], ['Living area', p.sqft ? p.sqft.toLocaleString('en-US') + ' sq ft' : '–'], ['Year built', String(p.yearBuilt || '–')], ['Purchase price', usd(p.price)], ['Price per sq ft', p.sqft ? usd(r.pricePerSqft) : '–'], ['Planned repairs', usd(p.rehab)], ['Flood zone / HOA rental limits', (p.floodZone ? 'Yes' : 'No') + ' / ' + (p.hoaRentalLimits ? 'Yes' : 'No')]]) +
      '<h2>4. Sources and uses</h2>' + rows([['Purchase price', usd(p.price)], ['Closing costs & prepaids (est.)', usd(r.closing.total)], ['Repairs', usd(p.rehab)], ['Total uses', usd(p.price + r.closing.total + p.rehab), 1], ['Loan', usd(r.loan)], ['Borrower funds', usd(r.cashInvested)], ['Total sources', usd(r.loan + r.cashInvested), 1]]) +
      '<h2>5. Proposed financing</h2>' + rows([['Loan type', esc((LOANS.filter(function (l) { return l[0] === p.loanType; })[0] || ['', ''])[1])], ['Rate / term', pct(p.rate, 3) + ' / ' + p.termYears + ' years'], ['Principal & interest', usd(r.pi, 2)], ['Mortgage insurance', usd(r.pmi, 2)], ['Property taxes', usd(r.taxesM, 2)], ['Hazard insurance', usd(r.insuranceM, 2)], ['HOA', usd(p.hoaMonthly, 2)], ['PITIA', usd(r.pitia, 2), 1]]) +
      '<h2>6. Income and debt coverage</h2>' + rows([['Market rent (monthly)', usd(p.rent)], ['Other income (monthly)', usd(p.otherIncome)], ['Gross scheduled income (annual)', usd(op.gsi)], ['Vacancy ' + pct(p.vacancyPct, 0), usd(-op.vacancy)], ['Effective gross income', usd(op.egi), 1], ['Management', usd(-op.mgmt)], ['Repairs & maintenance', usd(-op.maint)], ['Capital reserves', usd(-op.capex)], ['Taxes, insurance, HOA, utilities', usd(-(op.taxes + op.insurance + op.hoa + op.utilities))], ['Net operating income', usd(r.noi), 1], ['Annual debt service', usd(r.debtService)], ['DSCR (NOI ÷ debt service)', r.dscr == null ? 'n/a' : x2(r.dscr)], ['DSCR (gross rent ÷ PITIA)', r.dscrLender == null ? 'n/a' : x2(r.dscrLender)], ['Monthly cash flow after debt service', usd(r.cashFlowM)]]) +
      '<h2>7. Stress test</h2><table class="tbl"><thead><tr><th>Scenario</th><th>Cash flow / mo</th><th>DSCR</th></tr></thead><tbody>' + r.stress.map(function (s) { return '<tr><td>' + esc(s.label) + '</td><td>' + usd(s.cashFlowM) + '</td><td>' + (s.dscr == null ? 'n/a' : x2(s.dscr)) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2>8. Notes for the underwriter</h2><ul style="padding-left:18px;font-size:13px;display:grid;gap:4px">' + (r.warnings.length ? r.warnings.map(function (w) { return '<li><b>' + esc(w.title) + ':</b> ' + esc(w.text) + '</li>'; }).join('') : '<li>No exceptions identified by the borrower’s analysis.</li>') + '</ul>' +
      '<h2>9. Document checklist</h2><ul style="list-style:none;font-size:13px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:4px 16px">' + ['Photo ID', 'Two years of federal tax returns', 'W-2s / 1099s and recent pay stubs', 'Two months of bank & brokerage statements', 'Executed purchase contract', 'Rent comps or appraiser rent schedule (Form 1007)', 'Existing leases (if occupied)', 'Landlord insurance quote (DP-3)', 'LLC articles, operating agreement, EIN letter', 'Schedule of real estate owned'].map(function (x) { return '<li>☐ ' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<p class="meta" style="margin-top:18px;font-size:11px">Figures are estimates prepared by the borrower from self-reported data and typical cost assumptions. This document is not a loan application, loan approval, appraisal or tax advice. The lender’s Loan Estimate, appraisal and underwriting determine the final terms.</p>' +
      '<div class="rfoot"><span>Created with LeaseRun · leaserun.com</span><span>Report ' + esc(o.id) + ' · ' + today + '</span></div></article>';
    root.innerHTML = h;
  }

  // ---------------------------------------------------------------- pricing (waitlist until checkout is live)
  function pagePricing() {
    if (qs('limit') === '1') { var g = $('#limit-note'); if (g) g.hidden = false; }
    $$('[data-plan]').forEach(function (b) {
      b.addEventListener('click', function () {
        var plan = b.getAttribute('data-plan'), em = signedIn() ? claims().email : '';
        var f = document.createElement('form'); f.className = 'fg'; f.style.marginTop = '8px';
        f.innerHTML = '<label class="fl full">Email<input type="email" required value="' + esc(em || '') + '"></label><button class="btn btn-pay full">Notify me at launch</button><p class="hint full" style="font-size:12px;margin:0">Online checkout opens shortly. We email you once – no spam.</p>';
        b.replaceWith(f);
        f.onsubmit = function (e) {
          e.preventDefault();
          fetch(SB_URL + '/rest/v1/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' }, body: JSON.stringify({ source: 'software-' + plan, page: '/pricing', email: $('input', f).value.trim().toLowerCase(), interest: 'Software plan: ' + plan }) })
            .then(function (r) { if (!r.ok) throw 0; f.innerHTML = '<div class="msg ok full">Thanks! We will email you when ' + esc(plan.replace('-', ' ')) + ' is available.</div>'; })
            .catch(function () { toast('Please check the email address and try again.'); });
        };
      });
    });
  }

  // ---------------------------------------------------------------- nav + boot
  $$('.nav-app').forEach(function (a) { if (signedIn()) { a.textContent = 'My dashboard'; a.href = '/app'; } });
  var PAGES = { analyzer: pageAnalyzer, start: pageStart, login: pageLogin, signup: pageSignup, forgot: pageForgot, reset: pageReset,
    dashboard: pageDashboard, property: pageProperty, profile: pageProfile, tools: pageTools, package: pagePackage, pricing: pagePricing };
  if (PAGES[PAGE] && (root || PAGE === 'pricing')) PAGES[PAGE]();
})();
