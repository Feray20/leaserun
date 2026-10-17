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
      db('properties?select=*&order=updated_at.desc'),
      db('business_profiles?select=*').catch(function () { return []; }),
      db('clients?select=*&order=updated_at.desc').catch(function () { return []; })
    ]).then(function (a) {
      var ent = a[0][0] || { plan: 'free', loan_packages_left: 0 };
      ctx = { ent: ent, profile: a[1][0] || null, props: a[2] || [], tier: tierOf(ent), b2b: /^b2b_/.test(ent.plan || ''), biz: a[3][0] || null, clients: a[4] || [] };
      return ctx;
    });
  }
  function tierOf(e) {
    if (!e) return 0;
    if (e.plan === 'pro' || /^b2b_/.test(e.plan || '')) return 2;
    if (e.plan === 'buyer_pass' && e.pass_until && new Date(e.pass_until) > new Date()) return 1;
    return 0;
  }
  var PLAN_NAME = ['Free', 'Buyer Pass', 'Investor Pro'];
  var B2B_NAME = { b2b_basic: 'Business Basic', b2b_pro: 'Business Pro', b2b_enterprise: 'Business Enterprise' };
  function mode() { return (ctx && ctx.profile && ctx.profile.mode) || store('lr-mode') || 'beginner'; }


  // ---------------------------------------------------------------- charts (inline SVG, no library)
  function kfmt(v) { var a = Math.abs(v); return (v < 0 ? '−' : '') + '$' + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a)); }
  function niceMax(v) { if (v <= 0) return 1; var e = Math.pow(10, Math.floor(Math.log10(v))), n = v / e; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * e; }
  function lineChart(labels, series, title) {
    var W = 600, H = 230, L = 52, R = 12, T = 14, B = 28;
    var all = []; series.forEach(function (s) { all = all.concat(s.values); });
    var mx = niceMax(Math.max.apply(null, all.concat([0]))), mn = Math.min.apply(null, all.concat([0]));
    mn = mn < 0 ? -niceMax(-mn) : 0;
    var X = function (i) { return L + (labels.length < 2 ? 0 : i * (W - L - R) / (labels.length - 1)); };
    var Y = function (v) { return T + (mx - v) / (mx - mn) * (H - T - B); };
    var g = '';
    for (var t = 0; t <= 4; t++) { var v = mn + (mx - mn) * t / 4; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#EEF1F6"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="11" fill="#5A6782">' + kfmt(v) + '</text>'; }
    var step = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach(function (l, i) { if (i % step === 0 || i === labels.length - 1) g += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#5A6782">' + esc(l) + '</text>'; });
    series.forEach(function (s) {
      var d = s.values.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
      g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.5" stroke-linejoin="round"' + (s.dash ? ' stroke-dasharray="6 4"' : '') + '/>';
    });
    return '<figure class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title || 'Chart') + '">' + g + '</svg><figcaption class="legend">' + series.map(function (s) { return '<span style="--c:' + s.color + '">' + esc(s.name) + '</span>'; }).join('') + '</figcaption></figure>';
  }
  function barChart(items, title) {
    var mx = niceMax(Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); }).concat([1])));
    return '<figure class="chart hbars" aria-label="' + esc(title || 'Chart') + '">' + items.map(function (i) {
      var w = Math.abs(i.value) / mx * 100;
      return '<div class="hb"><span class="hl">' + esc(i.label) + '</span><span class="ht"><i style="width:' + w.toFixed(1) + '%;background:' + (i.color || (i.value < 0 ? '#E5484D' : '#1AC585')) + '"></i></span><b>' + usd(i.value) + '</b></div>';
    }).join('') + '</figure>';
  }

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
    h += '<div class="box"><h2>' + (beginner ? 'The picture over time' : p.holdYears + '-year projection') + '</h2>' + lineChart(r.projection.map(function (x) { return 'Y' + x.year; }), [{ name: 'Property value', color: '#1290E7', values: r.projection.map(function (x) { return x.value; }) }, { name: 'Loan balance', color: '#0C1A35', values: r.projection.map(function (x) { return x.balance; }), dash: 1 }, { name: 'Your equity', color: '#1AC585', values: r.projection.map(function (x) { return x.equity; }) }], 'Value, loan and equity over time') + '<div class="scroll-x"><table class="tbl"><thead><tr><th>Year</th><th>Rent / mo</th><th>Cash flow / yr</th><th>Loan balance</th><th>Value</th><th>Equity</th></tr></thead><tbody>' + rows.map(function (x) { return '<tr><td>' + x.year + '</td><td>' + usd(x.rent) + '</td><td class="' + sign(x.cashFlow) + '">' + usd(x.cashFlow) + '</td><td>' + usd(x.balance) + '</td><td>' + usd(x.value) + '</td><td>' + usd(x.equity) + '</td></tr>'; }).join('') + '</tbody></table></div>' + explain(beginner, 'Equity grows in two ways: tenants pay down your loan, and the home may gain value. Appreciation is never guaranteed – the deal should work on cash flow alone.') + '<p class="hint" style="margin:8px 0 0">Net proceeds if sold in year ' + p.holdYears + ' after ' + pct(p.sellingCostPct, 0) + ' selling costs and loan payoff: <b>' + usd(r.saleNet) + '</b> (before capital gains and depreciation recapture tax).</p></div>';

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
    if (ctx && ctx.b2b) {
      var g = [['Daily work', [['/business/portal', 'Overview'], ['/business/portal?v=clients', 'Clients']]], ['Tools & knowledge', [['/app/tools', 'Tools'], ['/business/portal?v=playbook', 'Advisor playbook'], ['/learn', 'Learn']]], ['Account', [['/business/portal?v=company', 'Company'], ['/business', 'Plan']]]];
      return '<nav class="app-tabs biz no-print">' + g.map(function (grp) { return '<span class="tg">' + grp[0] + '</span>' + grp[1].map(function (x) { return '<a href="' + x[0] + '"' + (x[0] === active ? ' class="on"' : '') + '>' + x[1] + '</a>'; }).join(''); }).join('<i class="sep"></i>') + '<a href="#" id="lr-logout" style="margin-left:auto">Sign out</a></nav>';
    }
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
      if (c.b2b) { location.replace('/business/portal'); return; }
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
      var beginner = c.b2b ? false : mode() === 'beginner';
      var clientId = prop ? prop.client_id : qs('client');
      var clientSel = c.b2b && c.clients.length ? '<label class="fl" style="margin-bottom:12px">Client<select id="lr-client"><option value="">\u2013 no client \u2013</option>' + c.clients.map(function (cl) { return '<option value="' + esc(cl.id) + '"' + (cl.id === clientId ? ' selected' : '') + '>' + esc(cl.name) + '</option>'; }).join('') + '</select></label>' : '';
      var head = clientSel + '<div class="app-bar" style="margin-bottom:12px"><h2 style="margin:0">' + (prop ? esc(prop.name) : 'New property') + '</h2>' + (prop ? '<select id="lr-status" class="no-print" style="width:auto;padding:7px 10px;border-radius:9px;border:1px solid #D5DBE7">' + ['analyzing', 'offer', 'under_contract', 'owned', 'passed'].map(function (s) { return '<option value="' + s + '"' + (s === prop.status ? ' selected' : '') + '>' + statusLabel(s) + '</option>'; }).join('') + '</select>' : '') + '</div>' + (beginner ? '<p class="hint">Fill in what you know. Empty taxes and insurance use typical values for the state – replace them with real quotes before you make an offer.</p>' : '');
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
        var row = { name: name, data: d }, cs = $('#lr-client');
        if (cs) row.client_id = cs.value || null;
        var req = prop ? db('properties?id=eq.' + encodeURIComponent(prop.id), { method: 'PATCH', body: JSON.stringify(row) })
          : db('properties', { method: 'POST', body: JSON.stringify(row) });
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
        '</div><button class="btn btn-primary" style="margin-top:16px">Save profile</button></form><div><div class="box"><h2>Your buying power</h2><div id="bp"></div></div><div class="box"><h2>Account</h2><p class="hint" style="margin:0">' + esc(u.email || '') + '<br>Plan: <b>' + PLAN_NAME[c.tier] + '</b></p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn btn-line btn-sm" href="/pricing">Plans</a><button type="button" class="btn btn-line btn-sm" id="exp">Download my data</button><a class="btn btn-line btn-sm" href="mailto:invest@leaserun.com?subject=Delete%20my%20LeaseRun%20account">Request account deletion</a></div></div></div></div>';
      bindChrome();
      $('#exp').onclick = function () {
        var dump = { exported_at: new Date().toISOString(), email: claims().email, plan: c.ent.plan, investor_profile: c.profile, properties: c.props, business_profile: c.biz, clients: c.clients };
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })); a.download = 'leaserun-my-data.json'; a.click();
      };
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
        OUT.innerHTML = '<h2>Cash to close</h2><table class="tbl"><tbody><tr><td>Down payment</td><td>' + usd(r.down) + '</td></tr>' + r.closing.items.map(function (i) { return '<tr><td>' + esc(i.label) + '</td><td>' + usd(i.amount) + '</td></tr>'; }).join('') + '<tr class="tot"><td>Cash to close</td><td>' + usd(r.cashToClose) + '</td></tr></tbody></table>' + barChart(r.closing.items.slice().sort(function (a, b) { return b.amount - a.amount; }).map(function (i) { return { label: i.label, value: i.amount, color: '#1290E7' }; }), 'Closing costs') + '<p class="hint" style="margin:8px 0 0">Closing costs ≈ ' + pct(r.closing.pctOfPrice) + ' of the price (' + usd(r.closing.total) + '). Taxes use the ' + esc(C.STATE_NAMES[r.input.state]) + ' average. Your Loan Estimate (page 2) shows the lender’s real figures.</p>';
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
        var yrs = Math.ceil(base.months / 12), lab = [], b1 = [], b2 = [], bb = l, be = l - (num('ls') || 0), rr = r / 100 / 12;
        for (var yy = 0; yy <= yrs; yy++) { lab.push('Y' + yy); b1.push(Math.max(0, bb)); b2.push(Math.max(0, be)); for (var mm = 0; mm < 12; mm++) { bb = bb * (1 + rr) - base.payment; be = be > 0 ? be * (1 + rr) - base.payment - (num('x') || 0) : 0; } }
        h += lineChart(lab, [{ name: 'Without extra payments', color: '#8A97B4', values: b1 }, { name: 'With extra payments', color: '#1AC585', values: b2 }], 'Loan balance');
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
        OUT.innerHTML = '<h2>True cost over ' + h + ' years</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Lender</th><th>Payment</th><th>Upfront</th><th>Total cost</th></tr></thead><tbody>' + res.map(function (r) { return '<tr' + (r === best ? ' style="background:#E3F7EE"' : '') + '><td>' + esc(r.name) + (r === best ? ' ✓' : '') + '</td><td>' + usd(r.payment) + '</td><td>' + usd(r.upfront) + '</td><td>' + usd(r.costOverHorizon) + '</td></tr>'; }).join('') + '</tbody></table></div>' + barChart(res.map(function (r) { return { label: r.name, value: r.costOverHorizon, color: r === best ? '#1AC585' : '#8A97B4' }; }), 'Total cost') + '<p class="hint" style="margin:8px 0 0">Total cost = upfront costs + interest paid over the period. Points only pay off if you keep the loan long enough. Compare Loan Estimates issued on the same day – rates change daily.</p>';
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
        OUT.innerHTML = '<h2>Portfolio</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Property</th><th>Cash flow / mo</th><th>Stressed</th><th>DSCR</th><th>Stressed</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r.n) + '</td><td class="' + sign(r.b.cashFlowM) + '">' + usd(r.b.cashFlowM) + '</td><td class="' + sign(r.s.cashFlowM) + '">' + usd(r.s.cashFlowM) + '</td><td>' + (r.b.dscr == null ? 'n/a' : x2(r.b.dscr)) + '</td><td>' + (r.s.dscr == null ? 'n/a' : x2(r.s.dscr)) + '</td></tr>'; }).join('') + '<tr class="tot"><td>Total</td><td>' + usd(sum(function (r) { return r.b.cashFlowM; })) + '</td><td class="' + sign(sum(function (r) { return r.s.cashFlowM; })) + '">' + usd(sum(function (r) { return r.s.cashFlowM; })) + '</td><td></td><td></td></tr></tbody></table></div>' + barChart([].concat.apply([], rows.map(function (r) { return [{ label: r.n.slice(0, 22) + ' \u00b7 now', value: r.b.cashFlowM, color: r.b.cashFlowM < 0 ? '#E5484D' : '#1AC585' }, { label: r.n.slice(0, 22) + ' \u00b7 stressed', value: r.s.cashFlowM, color: r.s.cashFlowM < 0 ? '#E5484D' : '#F5B544' }]; })), 'Monthly cash flow') + '<p class="hint" style="margin:8px 0 0">Equity: ' + usd(sum(function (r) { return (r.b.input.arv || r.b.input.price) - r.b.loan; })) + ' · Debt: ' + usd(sum(function (r) { return r.b.loan; })) + '. Keep enough reserves to cover the stressed shortfall for at least 12 months: ' + usd(Math.max(0, -sum(function (r) { return r.s.cashFlowM; })) * 12) + '.</p>';
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
      var client = p.client_id ? c.clients.filter(function (x) { return x.id === p.client_id; })[0] : null;
      var pf = client ? { full_name: client.name } : (c.profile || {});
      renderPackage(p.data || {}, pf, { paid: paid, id: p.id.slice(0, 8).toUpperCase(), status: p.status, brand: c.b2b ? c.biz : null, client: !!client });
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
    var br = o.brand && o.brand.company ? o.brand : null;
    var bcol = br && /^#[0-9A-Fa-f]{6}$/.test(br.brand_color || '') ? br.brand_color : null;
    var h = bar + '<article class="report"' + (bcol ? ' style="border-top:6px solid ' + bcol + '"' : '') + '>' + (br ? '<div class="meta" style="margin-bottom:12px;font-weight:700;color:' + (bcol || 'inherit') + '">Prepared by ' + esc(br.company) + (br.license_no ? ' \u00b7 License ' + esc(br.license_no) : '') + (br.phone ? ' \u00b7 ' + esc(br.phone) : '') + (br.email ? ' \u00b7 ' + esc(br.email) : '') + '</div>' : '') + (mark ? '<div class="wm"><span>' + mark + '</span></div>' : '') +
      '<div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap"><div><div class="meta">INVESTMENT PROPERTY LOAN PACKAGE</div><h1>' + esc(p.name || 'Subject property') + '</h1><div class="meta">Prepared for ' + esc(pf.full_name || 'Borrower') + (pf.buy_as === 'llc' ? ' (purchasing through an LLC)' : '') + ' · ' + today + ' · Report ' + esc(o.id) + '</div></div><img src="/logo-mark.png" alt="" width="44" height="44" style="border-radius:8px"></div>' +
      '<h2>1. Summary</h2><div class="kpis"><div class="kp"><div class="k">Loan request</div><div class="v">' + usd(r.loan) + '</div><div class="x">' + pct(r.ltv, 0) + ' LTV</div></div><div class="kp"><div class="k">DSCR (rent ÷ PITIA)</div><div class="v">' + (r.dscrLender == null ? 'n/a' : x2(r.dscrLender)) + '</div><div class="x">NOI basis: ' + (r.dscr == null ? 'n/a' : x2(r.dscr)) + '</div></div><div class="kp"><div class="k">Reserves after closing</div><div class="v">' + (reservesAfter == null ? '–' : usd(reservesAfter)) + '</div><div class="x">' + (reservesAfter == null ? '' : (reservesAfter / r.pitia).toFixed(1) + ' months PITIA') + '</div></div></div>' +
      '<h2>2. Borrower</h2>' + rows([['Name', esc(pf.full_name || '–')], ['Vesting', pf.buy_as === 'llc' ? 'LLC (personal guarantee expected)' : pf.buy_as === 'individual' ? 'Individual' : '\u2013'], ['State of residence', esc(C.STATE_NAMES[pf.state] || '–')], ['Credit score (self-reported)', esc(pf.credit_band || '–')], ['Gross annual income', usd(+pf.annual_income || null)], ['Monthly debt payments', usd(pf.monthly_debts == null ? null : +pf.monthly_debts)], ['Estimated DTI incl. this property (75% of rent)', dti == null ? '–' : pct(dti)], ['Liquid assets', usd(pf.liquid_reserves == null ? null : +pf.liquid_reserves)], ['Rental units owned', pf.doors_owned == null ? '–' : String(pf.doors_owned)]]) +
      '<h2>3. Subject property</h2>' + rows([['Location', esc(C.STATE_NAMES[p.state])], ['Type / units', esc((TYPES.filter(function (t) { return t[0] === p.type; })[0] || ['', ''])[1]) + ' / ' + p.units], ['Living area', p.sqft ? p.sqft.toLocaleString('en-US') + ' sq ft' : '–'], ['Year built', String(p.yearBuilt || '–')], ['Purchase price', usd(p.price)], ['Price per sq ft', p.sqft ? usd(r.pricePerSqft) : '–'], ['Planned repairs', usd(p.rehab)], ['Flood zone / HOA rental limits', (p.floodZone ? 'Yes' : 'No') + ' / ' + (p.hoaRentalLimits ? 'Yes' : 'No')]]) +
      '<h2>4. Sources and uses</h2>' + rows([['Purchase price', usd(p.price)], ['Closing costs & prepaids (est.)', usd(r.closing.total)], ['Repairs', usd(p.rehab)], ['Total uses', usd(p.price + r.closing.total + p.rehab), 1], ['Loan', usd(r.loan)], ['Borrower funds', usd(r.cashInvested)], ['Total sources', usd(r.loan + r.cashInvested), 1]]) +
      '<h2>5. Proposed financing</h2>' + rows([['Loan type', esc((LOANS.filter(function (l) { return l[0] === p.loanType; })[0] || ['', ''])[1])], ['Rate / term', pct(p.rate, 3) + ' / ' + p.termYears + ' years'], ['Principal & interest', usd(r.pi, 2)], ['Mortgage insurance', usd(r.pmi, 2)], ['Property taxes', usd(r.taxesM, 2)], ['Hazard insurance', usd(r.insuranceM, 2)], ['HOA', usd(p.hoaMonthly, 2)], ['PITIA', usd(r.pitia, 2), 1]]) +
      '<h2>6. Income and debt coverage</h2>' + rows([['Market rent (monthly)', usd(p.rent)], ['Other income (monthly)', usd(p.otherIncome)], ['Gross scheduled income (annual)', usd(op.gsi)], ['Vacancy ' + pct(p.vacancyPct, 0), usd(-op.vacancy)], ['Effective gross income', usd(op.egi), 1], ['Management', usd(-op.mgmt)], ['Repairs & maintenance', usd(-op.maint)], ['Capital reserves', usd(-op.capex)], ['Taxes, insurance, HOA, utilities', usd(-(op.taxes + op.insurance + op.hoa + op.utilities))], ['Net operating income', usd(r.noi), 1], ['Annual debt service', usd(r.debtService)], ['DSCR (NOI ÷ debt service)', r.dscr == null ? 'n/a' : x2(r.dscr)], ['DSCR (gross rent ÷ PITIA)', r.dscrLender == null ? 'n/a' : x2(r.dscrLender)], ['Monthly cash flow after debt service', usd(r.cashFlowM)]]) +
      '<h2>7. Stress test</h2><table class="tbl"><thead><tr><th>Scenario</th><th>Cash flow / mo</th><th>DSCR</th></tr></thead><tbody>' + r.stress.map(function (s) { return '<tr><td>' + esc(s.label) + '</td><td>' + usd(s.cashFlowM) + '</td><td>' + (s.dscr == null ? 'n/a' : x2(s.dscr)) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h2>8. Notes for the underwriter</h2><ul style="padding-left:18px;font-size:13px;display:grid;gap:4px">' + (r.warnings.length ? r.warnings.map(function (w) { return '<li><b>' + esc(w.title) + ':</b> ' + esc(w.text) + '</li>'; }).join('') : '<li>No exceptions identified by the borrower’s analysis.</li>') + '</ul>' +
      '<h2>9. Document checklist</h2><ul style="list-style:none;font-size:13px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:4px 16px">' + ['Photo ID', 'Two years of federal tax returns', 'W-2s / 1099s and recent pay stubs', 'Two months of bank & brokerage statements', 'Executed purchase contract', 'Rent comps or appraiser rent schedule (Form 1007)', 'Existing leases (if occupied)', 'Landlord insurance quote (DP-3)', 'LLC articles, operating agreement, EIN letter', 'Schedule of real estate owned'].map(function (x) { return '<li>☐ ' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<p class="meta" style="margin-top:18px;font-size:11px">Figures are estimates prepared ' + (br ? 'by ' + esc(br.company) + ' from information provided by the borrower' : 'by the borrower from self-reported data') + ' and typical cost assumptions. This document is not a loan application, loan approval, appraisal or tax advice. The lender’s Loan Estimate, appraisal and underwriting determine the final terms.</p>' +
      (br && br.disclaimer ? '<p class="meta" style="font-size:11px">' + esc(br.disclaimer) + '</p>' : '') +
      '<div class="rfoot"><span>' + (br ? esc(br.company) + ' \u00b7 ' : '') + 'Created with LeaseRun \u00b7 leaserun.com</span><span>Report ' + esc(o.id) + ' · ' + today + '</span></div></article>';
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


  // ---------------------------------------------------------------- dates
  function nthWeekday(y, m, wd, n) { var d = new Date(Date.UTC(y, m, 1)); var add = (wd - d.getUTCDay() + 7) % 7 + (n - 1) * 7; d.setUTCDate(1 + add); return d; }
  function lastWeekday(y, m, wd) { var d = new Date(Date.UTC(y, m + 1, 0)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - wd + 7) % 7)); return d; }
  function holidays(y) {
    return [new Date(Date.UTC(y, 0, 1)), nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), lastWeekday(y, 4, 1), new Date(Date.UTC(y, 5, 19)),
      new Date(Date.UTC(y, 6, 4)), nthWeekday(y, 8, 1, 1), nthWeekday(y, 9, 1, 2), new Date(Date.UTC(y, 10, 11)), nthWeekday(y, 10, 4, 4), new Date(Date.UTC(y, 11, 25))]
      .map(function (d) { return d.toISOString().slice(0, 10); });
  }
  function parseD(v) { if (!v) return null; var d = new Date(v + 'T00:00:00Z'); return isNaN(d) ? null : d; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function fmtD(d) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
  // TRID "precise" business day: every day except Sundays and federal legal public holidays.
  function minusBizDays(d, n) { var x = new Date(d.getTime()); while (n > 0) { x = addDays(x, -1); if (x.getUTCDay() !== 0 && holidays(x.getUTCFullYear()).indexOf(iso(x)) < 0) n--; } return x; }
  function ics(events) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LeaseRun//Deadlines//EN', 'CALSCALE:GREGORIAN'];
    events.forEach(function (e, i) {
      var d = iso(e.date).replace(/-/g, ''), n = iso(addDays(e.date, 1)).replace(/-/g, '');
      lines.push('BEGIN:VEVENT', 'UID:lr-' + d + '-' + i + '@leaserun.com', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', 'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + n,
        'SUMMARY:' + e.title.replace(/[,;]/g, ' '), 'BEGIN:VALARM', 'TRIGGER:-P3D', 'ACTION:DISPLAY', 'DESCRIPTION:' + e.title.replace(/[,;]/g, ' '), 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' })); a.download = 'leaserun-deadlines.ics'; a.click();
  }

  function pageDeadlines() {
    var today = iso(new Date());
    root.innerHTML = '<div class="cols"><div><div class="box"><h2>Purchase timeline</h2><p class="hint">Enter the day the seller accepted your offer. Use the periods from your signed purchase agreement.</p><div class="fg">' +
      '<label class="fl">Offer accepted<input type="date" id="acc" value="' + today + '"></label>' + inp('insd', 'Inspection period (days)', 10) + inp('find', 'Financing contingency (days)', 21) + inp('apd', 'Appraisal contingency (days)', 17) + inp('cld', 'Days to closing', 30) + '</div></div>' +
      '<div class="box"><h2>1031 exchange</h2><p class="hint">Only if you are selling investment property and reinvesting through a qualified intermediary.</p><div class="fg"><label class="fl">Relinquished property closed on<input type="date" id="sold"></label><label class="chk full"><input type="checkbox" id="ext"><span>I will extend my tax return (otherwise the April 15 due date can cut the 180 days short)</span></label></div></div></div>' +
      '<div class="sticky"><div class="box" id="dl-out"></div></div></div>';
    var out = $('#dl-out'), ev = [];
    function row(t, d, note) { ev.push({ title: t, date: d }); return '<tr><td><b>' + esc(t) + '</b>' + (note ? '<br><span class="hint" style="font-size:12px">' + esc(note) + '</span>' : '') + '</td><td>' + fmtD(d) + '</td></tr>'; }
    function run() {
      ev = [];
      var acc = parseD($('#acc').value), h = '';
      if (acc) {
        var close = addDays(acc, num('cld') || 30), cd = minusBizDays(close, 3);
        var first = new Date(Date.UTC(close.getUTCFullYear(), close.getUTCMonth() + 2, 1));
        h += '<h2>Your purchase deadlines</h2><table class="tbl"><tbody>' +
          row('Earnest money due (check your contract, often 1–3 days)', addDays(acc, 3)) +
          row('Inspection period ends', addDays(acc, num('insd') || 10), 'Repair requests or cancellation must be delivered before this date.') +
          row('Appraisal contingency ends', addDays(acc, num('apd') || 17)) +
          row('Financing contingency ends', addDays(acc, num('find') || 21), 'Ask your lender for loan approval in writing before this date.') +
          row('Closing Disclosure must be received by', cd, 'At least 3 business days before closing (Sundays and federal holidays do not count).') +
          row('Closing', close) + row('First mortgage payment (typical)', first, 'Usually due on the 1st of the second month after closing.') + '</tbody></table>';
      }
      var sold = parseD($('#sold').value);
      if (sold) {
        var id45 = addDays(sold, 45), d180 = addDays(sold, 180), due = new Date(Date.UTC(sold.getUTCFullYear() + 1, 3, 15));
        var end = !$('#ext').checked && due < d180 ? due : d180;
        h += '<h2 style="margin-top:18px">1031 exchange deadlines</h2><table class="tbl"><tbody>' + row('1031: identify replacement properties', id45, 'Written, signed identification delivered to your qualified intermediary by midnight. Weekends and holidays count.') +
          row('1031: close on replacement property', end, end < d180 ? 'Your tax return due date comes first. File an extension to keep the full 180 days.' : '180 calendar days after the sale closed.') + '</tbody></table>';
      }
      out.innerHTML = (h || '<p class="hint" style="margin:0">Enter a date to see your deadlines.</p>') + (ev.length ? '<button class="btn btn-primary btn-sm" id="ics" style="margin-top:14px">Add to my calendar (.ics)</button><p class="hint" style="margin:8px 0 0">Each entry comes with a reminder three days before. Your contract and your qualified intermediary are the binding source.</p>' : '');
      var b = $('#ics'); if (b) b.onclick = function () { ics(ev); };
    }
    root.addEventListener('input', run); root.addEventListener('change', run); run();
  }

  // ---------------------------------------------------------------- sell or hold (public)
  function pageScenarios() {
    root.innerHTML = '<div class="cols"><div class="box"><h2>Your property today</h2><div class="fg">' +
      inp('v', 'Current market value', 320000, 'usd') + inp('b', 'Loan balance', 180000, 'usd') + inp('basis', 'Original price + improvements', 230000, 'usd') + inp('dep', 'Depreciation taken so far', 40000, 'usd') +
      inp('sc', 'Selling costs', 7, 'pct') + inp('rent', 'Monthly rent', 2300, 'usd') + inp('noi', 'Yearly net operating income', 17000, 'usd') + inp('rate', 'Current loan rate', 4.25, 'pct') +
      '<label class="fl">Capital gains rate<select id="cg"><option value="0">0%</option><option value="15" selected>15%</option><option value="20">20%</option></select><small>Depends on your taxable income.</small></label>' +
      '<label class="chk"><input type="checkbox" id="niit"><span>Net investment income tax 3.8% applies</span></label>' + inp('st', 'State income tax rate', 5, 'pct') + inp('sus', 'Suspended passive losses', 0, 'usd') +
      inp('nr', 'Cash-out refinance rate', 7.25, 'pct') + inp('ltv', 'Cash-out LTV', 75, 'pct') + '</div></div><div class="sticky"><div class="box" id="sc-out"></div></div></div>' + DISC;
    var out = $('#sc-out');
    function run() {
      var v = num('v') || 0, b = num('b') || 0, basis = num('basis') || 0, dep = num('dep') || 0, sc = (num('sc') || 0) / 100;
      var cost = v * sc, adj = basis - dep, gain = v - cost - adj;
      var recap = Math.max(0, Math.min(dep, gain)), cap = Math.max(0, gain - recap);
      var fed = recap * 0.25 + cap * (+$('#cg').value) / 100;
      var niit = $('#niit').checked ? Math.max(0, gain) * 0.038 : 0, state = Math.max(0, gain) * (num('st') || 0) / 100;
      var susBen = Math.min(num('sus') || 0, Math.max(0, gain)) * 0.24;
      var tax = Math.max(0, fed + niit + state - susBen), net = v - cost - b - tax;
      var newLoan = v * (num('ltv') || 0) / 100, cashOut = Math.max(0, newLoan - b - newLoan * 0.025);
      var oldPmt = b > 0 ? C.payment(b, num('rate') || 0, 25) : 0, newPmt = C.payment(newLoan, num('nr') || 0, 30);
      out.innerHTML = '<h2>Compare your options</h2><table class="tbl"><thead><tr><th>Option</th><th>Cash to you now</th><th>Tax now</th></tr></thead><tbody>' +
        '<tr><td><b>Sell</b></td><td>' + usd(net) + '</td><td>' + usd(tax) + '</td></tr>' +
        '<tr><td><b>Sell with a 1031 exchange</b><br><span class="hint" style="font-size:12px">All equity must be reinvested</span></td><td>' + usd(0) + '</td><td>' + usd(0) + ' (deferred ' + usd(tax) + ')</td></tr>' +
        '<tr><td><b>Cash-out refinance</b><br><span class="hint" style="font-size:12px">Payment ' + usd(oldPmt) + ' → ' + usd(newPmt) + '/mo (est.)</span></td><td>' + usd(cashOut) + '</td><td>' + usd(0) + '</td></tr>' +
        '<tr><td><b>Keep</b><br><span class="hint" style="font-size:12px">Equity keeps working</span></td><td>' + usd(0) + '</td><td>' + usd(0) + '</td></tr></tbody></table>' +
        barChart([{ label: 'Sell – net cash', value: net, color: '#1290E7' }, { label: 'Sell – taxes', value: tax, color: '#E5484D' }, { label: 'Cash-out refinance', value: cashOut, color: '#1AC585' }, { label: 'Equity if you keep', value: v - b, color: '#0C1A35' }], 'Options') +
        '<table class="tbl" style="margin-top:12px"><tbody><tr><td>Gain on sale</td><td>' + usd(gain) + '</td></tr><tr><td>of which depreciation recapture (up to 25%)</td><td>' + usd(recap) + '</td></tr><tr><td>of which capital gain</td><td>' + usd(cap) + '</td></tr><tr><td>Return on equity if you keep (NOI ÷ equity)</td><td>' + pct((num('noi') || 0) / Math.max(1, v - b) * 100) + '</td></tr></tbody></table>' +
        '<div class="explain">If the return on your equity is low, selling or a 1031 into a better property may make sense. A cash-out refinance raises your payment and your risk. Suspended losses are valued at a 24% rate here for simplicity.</div>';
    }
    root.addEventListener('input', run); root.addEventListener('change', run); run();
  }

  // ---------------------------------------------------------------- checklist (public, saved in this browser)
  var CHECK = {
    'Everyone': ['Government photo ID', 'Last 2 years of federal tax returns, all schedules', 'W-2s and 1099s for 2 years', 'Pay stubs for the last 30 days', 'Bank and brokerage statements, last 2 months, all pages', 'Explanation and source for large deposits', 'Gift letter if a family member helps (owner-occupied loans only)'],
    'Self-employed': ['Business tax returns for 2 years (1120S, 1065 or Schedule C)', 'Year-to-date profit and loss statement', 'Business bank statements', 'K-1s for every partnership or S corporation'],
    'Properties you already own': ['Schedule of real estate owned (address, value, loan, payment, rent)', 'Current mortgage statements', 'Signed leases', 'Insurance declarations and property tax bills', 'HOA statements'],
    'The property you are buying': ['Signed purchase agreement and addenda', 'Earnest money receipt', 'Inspection report', 'Landlord insurance quote (DP-3) and flood quote if needed', 'HOA documents and resale certificate', 'Existing leases and rent roll if occupied'],
    'Buying in an LLC (DSCR)': ['Articles of organization', 'Operating agreement', 'EIN confirmation letter (IRS CP 575)', 'Certificate of good standing', 'Personal guarantee information']
  };
  function pageChecklist() {
    var saved = store('lr-checklist') || {};
    root.innerHTML = '<div class="no-print" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap"><button class="btn btn-line btn-sm" onclick="window.print()">Print / save as PDF</button><button class="btn btn-line btn-sm" id="ck-reset">Clear all ticks</button><span class="hint" style="margin:0;align-self:center">Your ticks are saved in this browser only.</span></div><div class="cols-3" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">' + Object.keys(CHECK).map(function (g, gi) {
      return '<div class="box"><h2 style="font-size:17px">' + esc(g) + '</h2><div style="display:grid;gap:8px;margin-top:10px">' + CHECK[g].map(function (it, i) { var k = gi + '-' + i; return '<label class="chk"><input type="checkbox" data-k="' + k + '"' + (saved[k] ? ' checked' : '') + '><span>' + esc(it) + '</span></label>'; }).join('') + '</div></div>';
    }).join('') + '</div><div class="explain">Never email Social Security numbers or bank account numbers. Upload them only through your lender’s secure portal.</div>';
    root.addEventListener('change', function (e) { var k = e.target.getAttribute('data-k'); if (!k) return; saved[k] = e.target.checked; store('lr-checklist', saved); });
    $('#ck-reset').onclick = function () { store('lr-checklist', null); location.reload(); };
  }

  // ---------------------------------------------------------------- investor profiler (public)
  var QUIZ = [
    ['How much cash could you invest without touching your emergency fund?', [['Under $25k', { hack: 3, turnkey: 0, brrrr: 0, dscr: 0, hold: 1 }], ['$25k–$75k', { hack: 2, turnkey: 2, brrrr: 1, dscr: 0, hold: 3 }], ['$75k–$200k', { hack: 0, turnkey: 3, brrrr: 2, dscr: 2, hold: 3 }], ['Over $200k', { hack: 0, turnkey: 2, brrrr: 2, dscr: 3, hold: 2 }]]],
    ['How many hours a month can you spend on it?', [['Almost none', { turnkey: 3, dscr: 1 }], ['A few hours', { hold: 2, turnkey: 1, hack: 1 }], ['10+ hours', { brrrr: 3, hold: 2, hack: 2 }]]],
    ['Would you live in the property yourself?', [['Yes, I would live in one unit', { hack: 4 }], ['No', { turnkey: 1, hold: 1, brrrr: 1, dscr: 1 }]]],
    ['How do you feel about renovation projects?', [['I avoid them', { turnkey: 2, hack: 1 }], ['Small cosmetic work is fine', { hold: 2, hack: 1 }], ['I like managing contractors', { brrrr: 3 }]]],
    ['How is your income documented?', [['W-2 salary', { hold: 1, hack: 1, turnkey: 1 }], ['Self-employed, low on tax returns', { dscr: 3 }], ['I already own several financed rentals', { dscr: 2, brrrr: 1 }]]],
    ['What matters most?', [['Steady monthly cash flow', { turnkey: 2, hold: 2 }], ['Building equity fast', { brrrr: 3 }], ['Lowest entry cost', { hack: 3 }], ['Scaling to many doors', { dscr: 3, brrrr: 1 }]]]
  ];
  var STRAT = {
    hack: ['House hack', 'Buy a 2–4 unit property, live in one unit and rent the others. FHA or VA loans keep the down payment low.', '/learn/house-hacking-fha-va'],
    turnkey: ['Turnkey rental', 'Buy a renovated, often already rented home in a cash-flow market and use a professional manager.', '/learn/investor-strategies-turnkey-brrrr'],
    hold: ['Classic buy and hold', 'Find a solid home in a market you know, make it rent-ready and hold it for the long term.', '/learn/first-rental-step-by-step'],
    brrrr: ['BRRRR', 'Buy below value, renovate, rent, refinance to pull cash out and repeat. Highest effort and risk.', '/learn/refinance-and-cash-out'],
    dscr: ['DSCR / LLC scaling', 'Qualify loans on the property’s rent instead of your income and hold properties in LLCs.', '/learn/dscr-loans-explained']
  };
  function pageProfiler() {
    var ans = {};
    function draw() {
      var done = Object.keys(ans).length === QUIZ.length, sc = { hack: 0, turnkey: 0, hold: 0, brrrr: 0, dscr: 0 };
      Object.keys(ans).forEach(function (q) { var w = QUIZ[q][1][ans[q]][1]; for (var k in w) sc[k] += w[k]; });
      var rank = Object.keys(sc).sort(function (a, b) { return sc[b] - sc[a]; });
      root.innerHTML = '<div class="cols"><div>' + QUIZ.map(function (q, qi) {
        return '<div class="box"><h3>' + (qi + 1) + '. ' + esc(q[0]) + '</h3><div style="display:grid;gap:8px">' + q[1].map(function (o, oi) { return '<label class="chk"><input type="radio" name="q' + qi + '" data-q="' + qi + '" data-o="' + oi + '"' + (ans[qi] === oi ? ' checked' : '') + '><span>' + esc(o[0]) + '</span></label>'; }).join('') + '</div></div>';
      }).join('') + '</div><div class="sticky"><div class="box">' + (done ? '<span class="pill good">Your best fit</span><h2 style="margin-top:8px">' + STRAT[rank[0]][0] + '</h2><p class="hint">' + STRAT[rank[0]][1] + '</p><a class="btn btn-primary btn-sm" href="' + STRAT[rank[0]][2] + '">Learn how it works</a><h3 style="margin-top:18px">Also worth a look</h3><p class="hint" style="margin:0">' + STRAT[rank[1]][0] + ': ' + STRAT[rank[1]][1] + '</p><div style="margin-top:16px"><a class="btn btn-line btn-sm" href="/start">Run your first numbers</a></div>' : '<h2>Answer ' + (QUIZ.length - Object.keys(ans).length) + ' more question' + (QUIZ.length - Object.keys(ans).length === 1 ? '' : 's') + '</h2><p class="hint" style="margin:0">There is no wrong answer. The result is a starting point, not advice.</p>') + '</div></div></div>';
    }
    root.addEventListener('change', function (e) { var q = e.target.getAttribute('data-q'); if (q == null) return; ans[q] = +e.target.getAttribute('data-o'); draw(); });
    draw();
  }
  var DISC = '<p class="hint" style="margin-top:18px;font-size:13px">Estimates for education only – not tax, legal or investment advice. Confirm with your CPA and qualified intermediary.</p>';


  // ---------------------------------------------------------------- business portal
  var STAGES = [['new', 'New'], ['qualifying', 'Qualifying'], ['searching', 'Searching'], ['under_contract', 'Under contract'], ['closed', 'Closed'], ['inactive', 'Inactive']];
  function stageLabel(v) { return (STAGES.filter(function (x) { return x[0] === v; })[0] || ['', v])[1]; }
  var PLAYBOOK = [
    ['First-time investor', 'Wants to buy a first rental but has never run the numbers.', [
      'Start with the investor profile: cash, debts, credit range. Agree on a price ceiling from cash and DTI before showing homes.',
      'Walk through one property in the analyzer together in beginner view; let the client enter rent comps themselves.',
      'Explain reserves early: six months of PITIA is commonly required and often forgotten.',
      'Use the stress test as the decision rule: the deal should survive rent −10% and a repair shock.'], '/start'],
    ['Self-employed borrower', 'Strong business, low taxable income on returns.', [
      'Compare a DSCR loan with a conventional loan: rate, points, prepayment penalty and down payment.',
      'Check the lender DSCR (rent ÷ PITIA) against the lender’s minimum before writing an offer.',
      'Ask whether the client wants to close in an LLC; it narrows the loan options.'], '/learn/dscr-loans-explained'],
    ['1031 exchange buyer', 'Sold or is selling investment property and must reinvest.', [
      'Put the 45-day and 180-day dates in the client file on day one (deadline calculator, calendar file).',
      'Confirm a qualified intermediary is engaged before the sale closes.',
      'Replacement value and debt must at least match the relinquished property to avoid taxable boot – coordinate with the client’s CPA.'], '/deadlines'],
    ['House hacker', 'Wants to live in a 2–4 unit property.', [
      'Check FHA self-sufficiency on 3–4 units: 75% of rent must cover PITI.',
      'Run the numbers as a full rental too, for the day the client moves out.',
      'Review occupancy rules: owner-occupant loans require moving in within the stated period.'], '/learn/house-hacking-fha-va'],
    ['Landlord who wants to refinance or sell', 'Owns rentals with built-up equity.', [
      'Compare sell, 1031, cash-out and keep in the scenarios tool, including depreciation recapture.',
      'For refinances, show the break-even month and the new stressed cash flow.',
      'Hand over the Schedule E export to the client’s CPA rather than giving tax advice.'], '/scenarios']
  ];
  var COMPLIANCE = [
    '<b>Fair housing:</b> describe properties and numbers, never people or neighborhoods’ demographics. Do not steer.',
    '<b>RESPA Section 8:</b> no fees, kickbacks or things of value for referrals of settlement services. LeaseRun does not pay referral fees.',
    '<b>Licensing:</b> show your state license or NMLS number on documents you send; the company profile adds it to every lender package.',
    '<b>No tax or legal advice:</b> the tax figures are estimates; refer clients to a CPA, attorney or qualified intermediary.',
    '<b>Data:</b> never collect Social Security or bank account numbers in client notes.'
  ];
  function pageB2B() {
    requireAuth(function (c) {
      var v = qs('v') || 'overview';
      if (!c.b2b) {
        root.innerHTML = tabs('') + '<div class="box"><h2>Business portal</h2><p class="hint">Your account does not have a LeaseRun for Business plan yet. Business plans add client files, branded lender packages, the advisor playbook and all Pro tools.</p><a class="btn btn-pay btn-sm" href="/business">See business plans</a></div>';
        bindChrome(); return;
      }
      var act = v === 'overview' ? '/business/portal' : '/business/portal?v=' + (v === 'client' ? 'clients' : v);
      var plan = B2B_NAME[c.ent.plan] || 'Business';
      var head = '<div class="app-bar"><div><h1>' + esc((c.biz && c.biz.company) || 'Business portal') + '</h1><div class="sub">' + plan + (c.ent.plan === 'b2b_basic' ? ' · ' + c.clients.filter(function (x) { return x.stage !== 'inactive'; }).length + ' of 25 active client files' : '') + '</div></div><a class="btn btn-primary btn-sm" href="/business/portal?v=clients#new">New client</a></div>';
      var H = tabs(act) + head;
      if (v === 'overview') {
        var by = {}; c.clients.forEach(function (x) { by[x.stage] = (by[x.stage] || 0) + 1; });
        var clientProps = c.props.filter(function (p) { return p.client_id; });
        H += '<div class="kpis" style="margin-bottom:16px">' + [['Active clients', c.clients.filter(function (x) { return x.stage !== 'inactive' && x.stage !== 'closed'; }).length], ['Searching', by.searching || 0], ['Under contract', by.under_contract || 0], ['Closed', by.closed || 0], ['Client analyses', clientProps.length], ['Lender packages ready', clientProps.length]].map(function (k) { return '<div class="kp"><div class="k">' + k[0] + '</div><div class="v">' + k[1] + '</div></div>'; }).join('') + '</div>';
        if (!c.biz || !c.biz.company) H += '<div class="gate">Add your <a href="/business/portal?v=company" style="font-weight:700;text-decoration:underline">company details</a> so your name, license and brand color appear on every lender package.</div>';
        H += '<div class="box"><h2>Pipeline</h2><div class="pipe">' + STAGES.filter(function (st) { return st[0] !== 'inactive'; }).map(function (st) {
          var list = c.clients.filter(function (x) { return x.stage === st[0]; });
          return '<div class="pcol"><b>' + st[1] + ' <span class="pill">' + list.length + '</span></b>' + list.slice(0, 6).map(function (x) { return '<a class="pcard" href="/business/portal?v=client&id=' + encodeURIComponent(x.id) + '">' + esc(x.name) + '</a>'; }).join('') + (list.length > 6 ? '<span class="hint">+' + (list.length - 6) + ' more</span>' : '') + '</div>';
        }).join('') + '</div></div>';
        H += '<div class="box"><h2>Recent analyses</h2>' + (clientProps.length ? '<div class="scroll-x"><table class="tbl"><thead><tr><th>Property</th><th>Client</th><th>Cash flow / mo</th><th>DSCR</th><th></th></tr></thead><tbody>' + clientProps.slice(0, 8).map(function (p) { var r = C.analyze(p.data || {}), cl = c.clients.filter(function (x) { return x.id === p.client_id; })[0]; return '<tr><td><a href="/app/property?id=' + encodeURIComponent(p.id) + '" style="color:#0E7A53;font-weight:600">' + esc(p.name) + '</a></td><td>' + esc(cl ? cl.name : '') + '</td><td class="' + sign(r.cashFlowM) + '">' + usd(r.cashFlowM) + '</td><td>' + (r.dscr == null ? 'n/a' : x2(r.dscr)) + '</td><td><a href="/app/loan-package?id=' + encodeURIComponent(p.id) + '" style="color:#0E7A53;font-weight:600">Package</a></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="hint" style="margin:0">No client analyses yet. Open a client and start an analysis.</p>') + '</div>';
      } else if (v === 'clients') {
        H += '<div class="cols"><div class="box"><h2>Clients</h2>' + (c.clients.length ? '<div class="scroll-x"><table class="tbl"><thead><tr><th>Name</th><th>Stage</th><th>Analyses</th><th>Updated</th></tr></thead><tbody>' + c.clients.map(function (x) { return '<tr><td><a href="/business/portal?v=client&id=' + encodeURIComponent(x.id) + '" style="color:#0E7A53;font-weight:600">' + esc(x.name) + '</a></td><td>' + stageLabel(x.stage) + '</td><td>' + c.props.filter(function (p) { return p.client_id === x.id; }).length + '</td><td>' + new Date(x.updated_at).toLocaleDateString('en-US') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="hint" style="margin:0">No clients yet.</p>') + '</div>' +
          '<form class="box" id="new"><h2>New client</h2><div class="fg"><label class="fl full">Name<input name="name" required maxlength="120"></label><label class="fl">Email<input name="email" type="email" maxlength="254"></label><label class="fl">Phone<input name="phone" maxlength="40"></label><label class="fl full">Stage<select name="stage">' + STAGES.map(function (st) { return '<option value="' + st[0] + '">' + st[1] + '</option>'; }).join('') + '</select></label><label class="fl full">Notes<textarea name="notes" rows="4" maxlength="4000" placeholder="Goals, budget, markets, timeline. No SSN or bank numbers."></textarea></label></div><button class="btn btn-primary" style="margin-top:12px">Create client file</button></form></div>';
      } else if (v === 'client') {
        var cl = c.clients.filter(function (x) { return x.id === qs('id'); })[0];
        if (!cl) { H += '<div class="box"><h2>Client not found</h2></div>'; }
        else {
          var cp = c.props.filter(function (p) { return p.client_id === cl.id; });
          H += '<div class="cols"><form class="box" id="cl-edit"><h2>' + esc(cl.name) + '</h2><div class="fg"><label class="fl full">Name<input name="name" required maxlength="120" value="' + esc(cl.name) + '"></label><label class="fl">Email<input name="email" type="email" value="' + esc(cl.email || '') + '"></label><label class="fl">Phone<input name="phone" value="' + esc(cl.phone || '') + '"></label><label class="fl full">Stage<select name="stage">' + STAGES.map(function (st) { return '<option value="' + st[0] + '"' + (st[0] === cl.stage ? ' selected' : '') + '>' + st[1] + '</option>'; }).join('') + '</select></label><label class="fl full">Notes<textarea name="notes" rows="6" maxlength="4000">' + esc(cl.notes || '') + '</textarea></label></div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn btn-primary btn-sm">Save</button><button type="button" class="btn btn-danger btn-sm" id="cl-del">Delete client</button></div></form>' +
            '<div><div class="box"><div class="app-bar" style="margin:0 0 10px"><h2>Analyses</h2><a class="btn btn-primary btn-sm" href="/app/property?new=1&client=' + encodeURIComponent(cl.id) + '">New analysis</a></div>' + (cp.length ? cp.map(function (p) { var r = C.analyze(p.data || {}); return '<div class="warn"><i class="dot ' + (r.verdict.tone === 'good' ? 'low' : r.verdict.tone === 'mid' ? 'medium' : 'high') + '"></i><div><b><a href="/app/property?id=' + encodeURIComponent(p.id) + '">' + esc(p.name) + '</a></b><span>' + usd(r.input.price) + ' · cash flow ' + usd(r.cashFlowM) + '/mo · DSCR ' + (r.dscr == null ? 'n/a' : x2(r.dscr)) + ' · <a href="/app/loan-package?id=' + encodeURIComponent(p.id) + '" style="color:#0E7A53;font-weight:600">Lender package</a></span></div></div>'; }).join('') : '<p class="hint" style="margin:0">No analyses for this client yet.</p>') + '</div>' +
            '<div class="box"><h2>Next step</h2><p class="hint" style="margin:0">' + ({ new: 'Book an intake call and agree on budget, markets and timeline.', qualifying: 'Collect the documents from the checklist and request Loan Estimates.', searching: 'Analyze candidates together; use the price check before each offer.', under_contract: 'Track contingency deadlines and send the lender package.', closed: 'Hand over the Schedule E export and set a 12-month review.', inactive: 'Archive or reactivate when the client is ready.' })[cl.stage] + '</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><a class="btn btn-line btn-sm" href="/checklist">Document checklist</a><a class="btn btn-line btn-sm" href="/deadlines">Deadlines</a></div></div></div></div>';
        }
      } else if (v === 'playbook') {
        H += '<div class="box"><h2>Advisor playbook</h2><p class="hint">Talking points and the right tool for the most common client situations. More depth than the consumer guides: built for professionals advising US rental investors.</p></div>' + PLAYBOOK.map(function (pb) { return '<div class="box"><h3>' + esc(pb[0]) + '</h3><p class="hint">' + esc(pb[1]) + '</p><ul style="padding-left:18px;display:grid;gap:6px;font-size:14px">' + pb[2].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul><a href="' + pb[3] + '" style="display:inline-block;margin-top:8px;color:#0E7A53;font-weight:700;font-size:14px">Open the matching tool →</a></div>'; }).join('') +
          '<div class="box"><h2>Compliance essentials</h2><ul style="padding-left:18px;display:grid;gap:8px;font-size:14px">' + COMPLIANCE.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
      } else if (v === 'company') {
        var b = c.biz || {};
        H += '<div class="cols"><form class="box" id="biz"><h2>Company details</h2><p class="hint">Shown on every lender package you create for clients.</p><div class="fg">' +
          '<label class="fl full">Company name<input name="company" maxlength="120" value="' + esc(b.company || '') + '"></label>' +
          '<label class="fl">Role<select name="role">' + [['agent', 'Real estate agent / broker'], ['loan_officer', 'Loan officer / mortgage broker'], ['property_manager', 'Property manager'], ['advisor', 'Financial advisor'], ['other', 'Other']].map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === b.role ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
          '<label class="fl">License / NMLS number<input name="license_no" maxlength="60" value="' + esc(b.license_no || '') + '"></label>' +
          '<label class="fl">Phone<input name="phone" maxlength="40" value="' + esc(b.phone || '') + '"></label><label class="fl">Email<input name="email" type="email" maxlength="254" value="' + esc(b.email || '') + '"></label>' +
          '<label class="fl">Website<input name="website" maxlength="200" value="' + esc(b.website || '') + '"></label><label class="fl">Brand color<input name="brand_color" type="color" value="' + esc(b.brand_color || '#0C1A35') + '"></label>' +
          '<label class="fl full">Disclaimer on documents<textarea name="disclaimer" rows="3" maxlength="600">' + esc(b.disclaimer || '') + '</textarea><small>For example your equal housing or NMLS consumer access statement.</small></label></div><button class="btn btn-primary" style="margin-top:12px">Save company details</button></form>' +
          '<div class="box"><h2>Plan</h2><p class="hint" style="margin:0">' + plan + '. To change seats or plan, email <a href="mailto:invest@leaserun.com" style="color:#0E7A53;font-weight:600">invest@leaserun.com</a>.</p></div></div>';
      }
      root.innerHTML = H; bindChrome();
      function formObj(f) { var o = {}; $$('input,select,textarea', f).forEach(function (i) { if (i.name) o[i.name] = i.value.trim() === '' ? null : i.value.trim(); }); return o; }
      function fail(e) { toast(/B2B_LIMIT/.test(e.message) ? 'Business Basic includes 25 active client files.' : /B2B_REQUIRED/.test(e.message) ? 'Client files need a business plan.' : e.message); }
      var nf = $('#new'); if (nf && nf.tagName === 'FORM') nf.onsubmit = function (e) { e.preventDefault(); var o = formObj(nf); if (!o.name) return; db('clients', { method: 'POST', body: JSON.stringify(o) }).then(function (r) { location.href = '/business/portal?v=client&id=' + encodeURIComponent(r[0].id); }).catch(fail); };
      var ef = $('#cl-edit'); if (ef) {
        ef.onsubmit = function (e) { e.preventDefault(); db('clients?id=eq.' + encodeURIComponent(qs('id')), { method: 'PATCH', body: JSON.stringify(formObj(ef)) }).then(function () { toast('Saved'); }).catch(fail); };
        $('#cl-del').onclick = function () { if (!confirm('Delete this client file? Analyses stay in your account without a client.')) return; db('clients?id=eq.' + encodeURIComponent(qs('id')), { method: 'DELETE' }).then(function () { location.href = '/business/portal?v=clients'; }).catch(fail); };
      }
      var bf = $('#biz'); if (bf) bf.onsubmit = function (e) { e.preventDefault(); var o = formObj(bf); o.user_id = uid(); db('business_profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(o) }).then(function () { toast('Company details saved'); }).catch(fail); };
    });
  }

  // ---------------------------------------------------------------- learn search
  function pageLearn() {
    var q = $('#lsearch'); if (!q) return;
    q.addEventListener('input', function () {
      var t = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean), any = false;
      $$('[data-group]').forEach(function (g) {
        var vis = 0;
        $$('.lcard', g).forEach(function (c) { var ok = t.every(function (w) { return c.getAttribute('data-q').indexOf(w) >= 0; }); c.hidden = !ok; if (ok) vis++; });
        g.hidden = !vis; if (vis) any = true;
      });
      $('#lnone').hidden = any;
    });
  }

  // ---------------------------------------------------------------- nav + boot
  $$('.nav-app').forEach(function (a) { if (signedIn()) { a.textContent = 'My dashboard'; a.href = '/app'; } });
  var PAGES = { analyzer: pageAnalyzer, start: pageStart, login: pageLogin, signup: pageSignup, forgot: pageForgot, reset: pageReset,
    dashboard: pageDashboard, property: pageProperty, profile: pageProfile, tools: pageTools, package: pagePackage, pricing: pagePricing, learn: pageLearn, deadlines: pageDeadlines, scenarios: pageScenarios, checklist: pageChecklist, profiler: pageProfiler, b2b: pageB2B };
  if (PAGES[PAGE]) PAGES[PAGE]();
})();
