#!/usr/bin/env python3
"""Builds the static LEASERUN site into ./dist (shared header/footer, clean URLs)."""
import os, shutil, pathlib

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "dist"
ASSETS = ["styles.css", "app.js", "logo.png", "favicon.png", "apple-touch-icon.png"]

# ---- Config: replace before launch ------------------------------------------
PHONE = "(888) 555-0142"          # Investor relations hotline (placeholder)
EMAIL = "invest@leaserun.com"
CALENDLY = "https://calendly.com/leaserun/portfolio-audit"   # replace with real link
LEAD_ENDPOINT = ""                 # e.g. https://hooks.zapier.com/... or your CRM webhook
# -----------------------------------------------------------------------------

ICON = {
 "house": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
 "chart": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/><path d="M16 8h4v4"/></svg>',
 "swap": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>',
 "shield": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
 "doc": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
 "cash": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
 "tool": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/></svg>',
 "clock": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
 "pin": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
 "lock": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
 "users": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3"/></svg>',
 "paw": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5-2 3-4 3-4 0-4-3z"/></svg>',
}

NAV = [("/", "Home"), ("/properties", "Properties"), ("/property-management", "Property Management"), ("/about-contact", "About & Contact")]


def head(title, desc, path, auto_modal=False):
    links = "".join(f'<a href="{h}"{" class=\"active\"" if h == path else ""}>{t}</a>' for h, t in NAV)
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://leaserun.com{path}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0C1A35">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Montserrat:wght@700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body{' data-auto-modal="1"' if auto_modal else ''}>
<header class="nav"><div class="wrap">
  <a href="/" class="logo" aria-label="LeaseRun home"><img src="/logo.png" alt="LeaseRun — Real Estate Investment" width="153" height="38"></a>
  <nav class="nav-links">{links}<a href="#" data-modal class="btn btn-primary btn-sm">Get the Deal Sheet</a></nav>
  <button class="menu-btn" aria-label="Menu">&#9776;</button>
</div></header>
'''


def modal():
    return f'''
<div class="modal-bg" id="lead-modal" role="dialog" aria-modal="true" aria-labelledby="lm-title">
  <div class="modal">
    <button class="x" aria-label="Close">&times;</button>
    <span class="eyebrow"><span class="dot"></span>Free · Every Tuesday</span>
    <h3 id="lm-title">Get Our Weekly Off-Market US Deal Sheet</h3>
    <p>5–10 pre-underwritten rentals before they hit the MLS. Cap rate, cash-on-cash, rehab budget and rent comps on every deal.</p>
    <form data-lead="deal-sheet-modal" data-endpoint="{LEAD_ENDPOINT}">
      <div class="field"><input name="first_name" placeholder="First name" required autocomplete="given-name"></div>
      <div class="field"><input name="email" type="email" placeholder="Email address" required autocomplete="email"></div>
      <div class="field"><select name="budget" required>
        <option value="">Investment budget per deal</option>
        <option>Under $150k</option><option>$150k – $300k</option><option>$300k – $600k</option><option>$600k – $1M</option><option>$1M+</option>
      </select></div>
      <button class="btn btn-primary" style="width:100%">Send Me This Week&rsquo;s Deals</button>
      <p class="fine">No spam. Unsubscribe in one click. By subscribing you agree to our Privacy Policy.</p>
      <div class="ok-msg">You&rsquo;re in. Check your inbox for this week&rsquo;s deal sheet.</div>
    </form>
  </div>
</div>'''


def foot():
    return f'''
<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <a href="/" class="logo"><img src="/logo.png" alt="LeaseRun" width="177" height="44"></a>
        <p class="mt-m" style="max-width:300px">Turnkey rental acquisitions, full-cycle property management and 1031 exchange coordination for US real estate investors.</p>
        <p class="mt-s"><a href="tel:{PHONE.replace(" ", "").replace("(", "").replace(")", "").replace("-", "")}">{PHONE}</a><br><a href="mailto:{EMAIL}">{EMAIL}</a></p>
      </div>
      <div><h4>Invest</h4><ul><li><a href="/properties">Turnkey Properties</a></li><li><a href="/properties">Off-Market Deals</a></li><li><a href="/#how">How It Works</a></li><li><a href="/#calculator">ROI Calculator</a></li></ul></div>
      <div><h4>Owners</h4><ul><li><a href="/property-management">Property Management</a></li><li><a href="/property-management#pricing">Pricing</a></li><li><a href="/property-management#guarantees">Guarantees</a></li><li><a href="/about-contact#intake">Owner Onboarding</a></li></ul></div>
      <div><h4>Company</h4><ul><li><a href="/about-contact">About</a></li><li><a href="/about-contact#compliance">Compliance</a></li><li><a href="/about-contact#intake">Book a Portfolio Audit</a></li><li><a href="#" data-modal>Weekly Deal Sheet</a></li></ul></div>
    </div>
    <div class="legal">
      <p><b>Equal Housing Opportunity.</b> LeaseRun complies with the Federal Fair Housing Act and all applicable state and local fair housing laws. We do not discriminate on the basis of race, color, religion, sex, national origin, familial status, disability, or any other protected class.</p>
      <p class="mt-s">LeaseRun provides real estate brokerage and property management services through licensed affiliates in the states where it operates [license numbers to be added]. Nothing on this website constitutes investment, tax, or legal advice, or an offer to sell securities. All projections, cap rates, cash-on-cash returns and market metrics are illustrative estimates based on stated assumptions, are not guaranteed, and actual results will vary. Consult your own CPA, attorney and Qualified Intermediary before entering into a 1031 exchange.</p>
      <p class="mt-s">&copy; <span class="yr">2026</span> LeaseRun. All rights reserved. · <a href="/about-contact#compliance">Privacy</a> · <a href="/about-contact#compliance">Terms</a></p>
    </div>
  </div>
</footer>
{modal()}
<script src="/app.js" defer></script>
</body>
</html>'''


# ============================================================================ HOME
HOME = f'''
<section class="hero" style="padding-top:72px">
  <div class="wrap hero-grid">
    <div>
      <span class="eyebrow"><span class="dot"></span>Turnkey rentals · Management · 1031</span>
      <h1>Smarter Real Estate Investing. <em>Hands-Off Yield.</em></h1>
      <p class="lead">From acquisition to automated cash flow. We source and underwrite cash-flowing US rentals, close them for you, place qualified tenants, and deposit your distributions by ACH on the 1st of every month.</p>
      <div class="hero-ctas">
        <a href="/properties" class="btn btn-primary">Find High-Yield Deals &rarr;</a>
        <a href="/about-contact#intake" class="btn btn-ghost">Book a Free Portfolio Audit</a>
      </div>
      <div class="hero-proof"><span>Underwriting on every deal</span><span>14-day tenant placement guarantee</span><span>LLC-ready closings</span></div>
    </div>
    <div class="calc" id="calculator">
      <div id="roi-calc">
        <h3>Instant Underwriting <small>Live estimate</small></h3>
        <div class="calc-row"><label>Purchase price <b id="o-price"></b></label><input id="c-price" type="range" min="80000" max="900000" step="5000" value="160000"></div>
        <div class="calc-row"><label>Estimated rehab <b id="o-rehab"></b></label><input id="c-rehab" type="range" min="0" max="100000" step="1000" value="5000"></div>
        <div class="calc-row"><label>Projected monthly rent <b id="o-rent"></b></label><input id="c-rent" type="range" min="800" max="8000" step="25" value="1700"></div>
        <div class="calc-row"><label>Down payment <b id="o-down"></b></label><input id="c-down" type="range" min="20" max="100" step="5" value="25"></div>
        <div class="calc-row"><label>Interest rate (30-yr) <b id="o-rate"></b></label><input id="c-rate" type="range" min="4" max="10" step="0.125" value="6.75"></div>
        <div class="calc-out">
          <div class="kpi hl"><div class="k">Cash-on-Cash</div><div class="v" id="k-coc"></div></div>
          <div class="kpi hl"><div class="k">Cap Rate</div><div class="v" id="k-cap"></div></div>
          <div class="kpi"><div class="k">NOI / yr</div><div class="v" id="k-noi"></div></div>
          <div class="kpi"><div class="k">Cash Flow</div><div class="v" id="k-cf"></div></div>
          <div class="kpi"><div class="k">GRM</div><div class="v" id="k-grm"></div></div>
          <div class="kpi"><div class="k">Cash Required</div><div class="v" id="k-cash"></div></div>
        </div>
        <p class="calc-foot">Assumes 5% vacancy, 8% management, 30% of gross rent for taxes, insurance, maintenance, CapEx &amp; HOA, 3% closing costs. Estimates only.</p>
      </div>
    </div>
  </div>
</section>

<!-- Metrics bar: illustrative figures — replace with live data from your PM software before launch -->
<div class="metrics"><div class="wrap">
  <div class="metric"><span class="live">Live</span><div class="v">7.8%</div><div class="k">Avg. cap rate, current inventory</div></div>
  <div class="metric"><div class="v">98.4%</div><div class="k">Occupancy across managed doors</div></div>
  <div class="metric"><div class="v">11</div><div class="k">Avg. days on market to lease</div></div>
  <div class="metric"><div class="v">48 hrs</div><div class="k">Subscriber head start on off-market deals</div></div>
  <div class="metric"><div class="v">1st</div><div class="k">ACH owner payout, every month</div></div>
</div></div>

<div class="trust"><div class="wrap">
  <span class="badge">{ICON["shield"]}Equal Housing Opportunity</span>
  <span class="badge">{ICON["doc"]}Fair Housing Act Compliant</span>
  <span class="badge">{ICON["lock"]}Bank-Level Encrypted Owner Portal</span>
  <span class="badge">{ICON["users"]}TransUnion &amp; Equifax Tenant Screening</span>
  <span class="badge">{ICON["swap"]}1031 Exchange Ready</span>
  <span class="badge">{ICON["cash"]}ACH Direct Deposit</span>
</div></div>

<section id="how">
  <div class="wrap">
    <div class="sec-head">
      <span class="eyebrow"><span class="dot"></span>How LeaseRun Works</span>
      <h2>One partner from first underwrite to monthly distribution.</h2>
      <p>No juggling wholesalers, inspectors, title companies and property managers across state lines. You approve the deal &mdash; we run the rest.</p>
    </div>
    <div class="steps">
      <div class="step"><div class="n">01 &mdash; Week 1</div><h3>Source &amp; Underwrite</h3><p>We match your buy box to vetted on- and off-market inventory and send a full underwriting package.</p>
        <ul><li>Verified historical rent rolls</li><li>Rent comps &amp; rehab scope</li><li>NOI, cap rate, CoC, GRM</li><li>Neighborhood &amp; job-growth data</li></ul></div>
      <div class="step"><div class="n">02 &mdash; Weeks 2&ndash;5</div><h3>Acquire &amp; Close</h3><p>We coordinate inspection, appraisal, lender, title and insurance &mdash; closing in your name or your LLC.</p>
        <ul><li>Third-party inspection report</li><li>Wyoming, Delaware or in-state LLC</li><li>Remote e-closing</li><li>Rehab managed to budget</li></ul></div>
      <div class="step"><div class="n">03 &mdash; Ongoing</div><h3>Automate &amp; Cash Flow</h3><p>Our management team places a qualified tenant, handles every repair call, and pays you on the 1st.</p>
        <ul><li>14-day tenant placement guarantee</li><li>24/7 maintenance dispatch</li><li>ACH payouts + owner dashboard</li><li>Year-end 1099 &amp; statements</li></ul></div>
    </div>
  </div>
</section>

<section class="dark">
  <div class="wrap">
    <div class="sec-head">
      <span class="eyebrow"><span class="dot"></span>The LeaseRun Platform</span>
      <h2>Three pillars. One institutional-grade operation.</h2>
    </div>
    <div class="grid-3">
      <div class="card"><div class="ic">{ICON["house"]}</div><h3>Turnkey Acquisitions &amp; Off-Market Deals</h3><p>Pre-vetted single-family, 2&ndash;4 unit multi-family and BRRRR properties in cash-flow markets.</p>
        <ul><li>Verified rent rolls &amp; leases in place</li><li>Population, job-growth &amp; school-district data</li><li>Price, rehab, rent and cap rate on one sheet</li></ul></div>
      <div class="card"><div class="ic">{ICON["chart"]}</div><h3>Full-Cycle Property Management</h3><p>A zero-headache landlord dashboard with distributions, maintenance tickets and leases in real time.</p>
        <ul><li>14-day tenant placement guarantee</li><li>Multi-bureau screening &amp; dynamic rent pricing</li><li>ACH direct deposit on the 1st</li></ul></div>
      <div class="card"><div class="ic">{ICON["swap"]}</div><h3>Portfolio Optimization &amp; 1031 Exchange</h3><p>Redeploy equity from underperforming or high-tax-market units into Sunbelt and Midwest growth corridors.</p>
        <ul><li>Qualified Intermediary coordination</li><li>45-day identification support</li><li>180-day closing timeline management</li></ul></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="sec-head">
      <span class="eyebrow"><span class="dot"></span>Why Investors Choose Rentals</span>
      <h2>Yield is only half the return.</h2>
      <p>Residential rentals combine monthly cash flow with some of the most favorable tax treatment in the US code. We structure every acquisition to capture it.</p>
    </div>
    <div class="grid-4">
      <div class="card-light"><div class="ic">{ICON["shield"]}</div><h3>Tax Shielding</h3><p>Depreciation, mortgage interest and operating expenses can offset rental income, often sheltering most of your cash flow.</p></div>
      <div class="card-light"><div class="ic">{ICON["doc"]}</div><h3>Depreciation &amp; Cost Segregation</h3><p>27.5-year straight-line depreciation, with optional cost segregation studies to accelerate deductions.</p></div>
      <div class="card-light"><div class="ic">{ICON["cash"]}</div><h3>Hassle-Free Passive Income</h3><p>No tenant calls, no contractor chasing. A single monthly deposit and a dashboard you check when you want.</p></div>
      <div class="card-light"><div class="ic">{ICON["swap"]}</div><h3>Tax-Deferred Growth</h3><p>Roll gains forward with 1031 exchanges and scale from one door to a portfolio without a tax drag.</p></div>
      <div class="card-light"><div class="ic">{ICON["chart"]}</div><h3>Leverage &amp; Equity Build</h3><p>Tenants pay down your mortgage while appreciation and principal reduction build long-term equity.</p></div>
      <div class="card-light"><div class="ic">{ICON["pin"]}</div><h3>Out-of-State Access</h3><p>Own in landlord-friendly, high-yield markets without living there or flying in for closings.</p></div>
      <div class="card-light"><div class="ic">{ICON["lock"]}</div><h3>LLC Asset Protection</h3><p>Close directly into a Wyoming, Delaware or local domestic LLC with lender and title coordination.</p></div>
      <div class="card-light"><div class="ic">{ICON["users"]}</div><h3>Qualified Tenants</h3><p>Credit, criminal, nationwide eviction history and 3x income-to-rent verification on every applicant.</p></div>
    </div>
    <p class="fine mt-m" style="color:var(--muted-dark)">Tax treatment depends on your individual situation. Consult a CPA.</p>
  </div>
</section>

<section class="dark" style="padding:72px 0">
  <div class="wrap">
    <div class="grid-2" style="align-items:center">
      <div>
        <span class="eyebrow" style="color:var(--accent)"><span class="dot"></span>Sample Deal Breakdown</span>
        <h2>What you see before you commit a dollar.</h2>
        <p style="color:#B8C3DB;margin-top:14px">Every property in our inventory ships with a one-page underwriting summary. Here&rsquo;s an illustrative 3-bed single-family in a Midwest metro.</p>
        <a href="/properties" class="btn btn-primary mt-m">Browse Current Inventory &rarr;</a>
      </div>
      <div class="card">
        <div class="calc-out" style="margin-top:0">
          <div class="kpi"><div class="k">Purchase Price</div><div class="v">$189,000</div></div>
          <div class="kpi"><div class="k">Est. Rehab</div><div class="v">$6,500</div></div>
          <div class="kpi"><div class="k">Projected Rent</div><div class="v">$1,725/mo</div></div>
          <div class="kpi"><div class="k">NOI / yr</div><div class="v">$13,500</div></div>
          <div class="kpi hl"><div class="k">Cap Rate</div><div class="v">6.9%</div></div>
          <div class="kpi hl"><div class="k">GRM</div><div class="v">9.1x</div></div>
        </div>
        <p class="calc-foot">Illustrative example. Not an offer. Figures vary by property, financing and market.</p>
      </div>
    </div>
  </div>
</section>

<section id="faq">
  <div class="wrap">
    <div class="sec-head"><span class="eyebrow"><span class="dot"></span>FAQ</span><h2>Questions investors ask us first.</h2></div>
    <div class="faq">
      <details><summary>How much capital do I need to get started?</summary><p>Most investors start with $45,000&ndash;$90,000 for a financed single-family rental (typically 20&ndash;25% down plus closing costs and reserves). Cash buyers and 1031 exchangers often start higher. Our ROI calculator shows your cash required for any scenario.</p></details>
      <details><summary>Do I have to live near the property?</summary><p>No. Most LeaseRun clients are out-of-state investors. Inspections, closing, rehab, leasing and maintenance are handled locally by our team; you review documents and sign electronically.</p></details>
      <details><summary>Which markets do you operate in?</summary><p>We focus on Sunbelt and Midwest metros with strong job growth, landlord-friendly regulations and rent-to-price ratios that support positive cash flow. Current markets are listed on the Properties page.</p></details>
      <details><summary>Can I buy through an LLC?</summary><p>Yes. We regularly close into Wyoming, Delaware and in-state domestic LLCs and coordinate with lenders and title companies that support entity ownership. We recommend having your attorney set up the entity before going under contract.</p></details>
      <details><summary>How do you screen tenants?</summary><p>Every adult applicant goes through a credit report (TransUnion/Equifax), criminal background check, nationwide eviction history search, employment verification and a 3x income-to-rent ratio check &mdash; applied consistently to every applicant in compliance with the Fair Housing Act.</p></details>
      <details><summary>What does property management cost?</summary><p>Ongoing management is 7&ndash;9% of monthly rent collected depending on your plan, and tenant placement is 50&ndash;75% of the first month&rsquo;s rent. No hidden markups on maintenance. Full details on our Property Management page.</p></details>
      <details><summary>Can you help with a 1031 exchange?</summary><p>Yes. We coordinate with your Qualified Intermediary, deliver replacement-property options within your 45-day identification window, and manage the timeline to close within 180 days. We do not act as your QI or give tax advice.</p></details>
      <details><summary>When do I get paid?</summary><p>Net rent is deposited to your bank account by ACH on the 1st of every month, with a statement and full ledger in your owner dashboard.</p></details>
    </div>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap">
    <div class="cta-band">
      <div>
        <h2 style="color:var(--text)">Get our weekly off-market deal sheet.</h2>
        <p>5&ndash;10 pre-underwritten rentals every Tuesday, before they hit the MLS.</p>
      </div>
      <div>
        <form class="inline-form" data-lead="deal-sheet-footer" data-endpoint="{LEAD_ENDPOINT}">
          <input name="email" type="email" placeholder="you@email.com" required autocomplete="email">
          <button class="btn btn-primary">Subscribe</button>
        </form>
        <div class="ok-msg">You&rsquo;re in. First deal sheet is on its way.</div>
        <p class="fine">Or <a href="/about-contact#intake" style="color:var(--accent)">book a free portfolio audit &rarr;</a></p>
      </div>
    </div>
  </div>
</section>
'''

# ====================================================================== PROPERTIES
LISTINGS = [
    # city, state, type, beds/baths/sqft, price, rehab, rent, cap, coc, status
    ("Indianapolis", "IN", "sfr", "3 bd · 2 ba · 1,420 sqft", 189000, 6500, 1725, 7.1, 9.4, "Off-Market"),
    ("Memphis", "TN", "sfr", "3 bd · 2 ba · 1,310 sqft", 154000, 9000, 1495, 7.9, 11.2, "Off-Market"),
    ("Cleveland", "OH", "mf", "Duplex · 4 bd · 2 ba", 168000, 12000, 2050, 9.1, 13.6, "Turnkey"),
    ("Birmingham", "AL", "sfr", "3 bd · 1.5 ba · 1,250 sqft", 139000, 4000, 1350, 8.2, 11.8, "Turnkey"),
    ("Kansas City", "MO", "mf", "Fourplex · 8 bd · 4 ba", 415000, 18000, 4200, 8.4, 12.1, "Off-Market"),
    ("Jacksonville", "FL", "sfr", "4 bd · 2 ba · 1,780 sqft", 279000, 5000, 2250, 6.6, 7.4, "Turnkey"),
    ("Columbus", "OH", "mf", "Triplex · 6 bd · 3 ba", 329000, 15000, 3300, 8.0, 10.9, "BRRRR"),
    ("San Antonio", "TX", "sfr", "3 bd · 2 ba · 1,560 sqft", 235000, 3500, 1895, 6.4, 6.9, "Turnkey"),
    ("Detroit", "MI", "sfr", "3 bd · 1 ba · 1,180 sqft", 98000, 22000, 1250, 9.6, 14.8, "BRRRR"),
    ("Charlotte", "NC", "mf", "Duplex · 6 bd · 4 ba", 389000, 8000, 3150, 6.9, 7.8, "Turnkey"),
    ("St. Louis", "MO", "mf", "Duplex · 4 bd · 2 ba", 179000, 10000, 2100, 8.8, 12.9, "Off-Market"),
    ("Huntsville", "AL", "sfr", "4 bd · 2.5 ba · 1,940 sqft", 259000, 2500, 2095, 7.0, 8.6, "Turnkey"),
]
STATES = sorted({l[1] for l in LISTINGS})


def listing_card(l):
    city, st, ty, spec, price, rehab, rent, cap, coc, status = l
    grm = price / (rent * 12)
    tlabel = "Multi-Family" if ty == "mf" else "Single Family"
    return f'''<article class="listing" data-state="{st}" data-price="{price}" data-cap="{cap}" data-coc="{coc}" data-type="{ty}">
  <div class="img">{ICON["house"]}<span class="tag">{tlabel}</span><span class="tag off">{status}</span></div>
  <div class="body">
    <div class="loc">{city}, {st}</div>
    <div class="price">${price:,.0f}</div>
    <div class="meta">{spec} · Est. rehab ${rehab:,.0f}</div>
    <div class="uw">
      <div class="g">Cap Rate<b>{cap:.1f}%</b></div>
      <div class="g">CoC<b>{coc:.1f}%</b></div>
      <div>GRM<b>{grm:.1f}x</b></div>
      <div>Rent<b>${rent:,.0f}</b></div>
      <div>NOI/yr<b>${price * cap / 100 + rehab * cap / 100:,.0f}</b></div>
      <div>1031<b>Eligible</b></div>
    </div>
    <a href="/about-contact#intake" class="btn btn-dark">Request Underwriting Package</a>
  </div>
</article>'''


PROPERTIES = f'''
<div class="page-head"><div class="wrap">
  <span class="eyebrow"><span class="dot"></span>Current Inventory</span>
  <h1 style="font-size:clamp(32px,4.4vw,50px)">Pre-underwritten US rental deals.</h1>
  <p>Turnkey single-family, 2&ndash;4 unit multi-family and BRRRR opportunities in cash-flow markets. Filter by your buy box and request the full package on any deal.</p>
</div></div>
<section style="padding-top:40px">
  <div class="wrap">
    <div class="filters">
      <div><label for="f-state">State</label><select id="f-state"><option value="">All states</option>{"".join(f"<option>{s}</option>" for s in STATES)}</select></div>
      <div><label for="f-price">Max price</label><select id="f-price"><option value="0">Any price</option><option value="150000">Up to $150k</option><option value="200000">Up to $200k</option><option value="300000">Up to $300k</option><option value="500000">Up to $500k</option></select></div>
      <div><label for="f-cap">Cap rate</label><select id="f-cap"><option value="0">Any</option><option value="7">7%+</option><option value="8">8%+</option><option value="9">9%+</option></select></div>
      <div><label for="f-coc">Cash-on-cash</label><select id="f-coc"><option value="0">Any</option><option value="8">8%+</option><option value="10">10%+</option><option value="12">12%+</option></select></div>
      <div><label for="f-type">Property type</label><select id="f-type"><option value="">All types</option><option value="sfr">Single Family</option><option value="mf">Multi-Family (2&ndash;4)</option></select></div>
      <button id="f-reset" class="btn btn-sm" style="border:1px solid var(--line-light);background:#fff">Reset</button>
    </div>
    <p id="f-count" style="font-size:14px;color:var(--muted-dark);margin-bottom:16px"></p>
    <!-- Sample inventory — replace with your live listings feed -->
    <div class="grid-3" id="listing-grid">{"".join(listing_card(l) for l in LISTINGS)}</div>
    <div class="empty">No deals match these filters right now. <a href="#" data-modal style="color:#119767;font-weight:600">Get new deals by email &rarr;</a></div>
    <p class="fine mt-m" style="color:var(--muted-dark)">Cap rate and cash-on-cash figures are projections assuming 25% down, 6.875% 30-year financing and standard operating assumptions. Listings shown are illustrative; availability changes weekly.</p>
  </div>
</section>
<section class="dark" style="padding:64px 0">
  <div class="wrap center">
    <h2 style="color:var(--text)">Most of our best deals never get posted.</h2>
    <p style="color:#B8C3DB;margin:12px auto 24px;max-width:560px">Off-market inventory goes to deal-sheet subscribers first, usually within 48 hours of going under our control.</p>
    <a href="#" data-modal class="btn btn-primary">Get the Weekly Deal Sheet</a>
  </div>
</section>
'''

# ============================================================ PROPERTY MANAGEMENT
PM = f'''
<div class="page-head"><div class="wrap">
  <span class="eyebrow"><span class="dot"></span>Full-Service Property Management</span>
  <h1 style="font-size:clamp(32px,4.4vw,50px)">Own the asset. Skip the landlord job.</h1>
  <p>Tenant placement, 24/7 maintenance dispatch, lease enforcement, eviction protection and ACH rent collection &mdash; with transparent, flat percentage pricing.</p>
  <div class="hero-ctas"><a href="/about-contact#intake" class="btn btn-primary">Get a Management Proposal</a><a href="#pricing" class="btn btn-ghost">See Pricing</a></div>
</div></div>

<section id="pricing">
  <div class="wrap">
    <div class="sec-head"><span class="eyebrow"><span class="dot"></span>Owner Pricing</span><h2>Simple pricing. No maintenance markups.</h2><p>You pay when your property earns. Tenant placement is billed once per new lease; ongoing management is a percentage of rent actually collected.</p></div>
    <div class="grid-3">
      <div class="price-card"><h3>Tenant Placement Only</h3><div class="amt">75%<small> of 1st month</small></div><div class="sub">For self-managing owners who need a qualified tenant fast.</div>
        <ul><li>Rent analysis &amp; dynamic pricing</li><li>Professional photos &amp; staging advice</li><li>Syndication to 20+ listing sites</li><li>Multi-bureau tenant screening</li><li>State-specific lease execution</li><li>14-day placement guarantee</li></ul>
        <a href="/about-contact#intake" class="btn btn-dark">Get Started</a></div>
      <div class="price-card feat"><h3>Essential Management</h3><div class="amt">7%<small> of rent collected</small></div><div class="sub">+ 50% of first month&rsquo;s rent per new lease.</div>
        <ul><li>Everything in Tenant Placement</li><li>ACH rent collection &amp; payout on the 1st</li><li>24/7 maintenance dispatch</li><li>Lease enforcement &amp; late-fee collection</li><li>Annual property inspection</li><li>Owner dashboard &amp; year-end 1099</li></ul>
        <a href="/about-contact#intake" class="btn btn-primary">Choose Essential</a></div>
      <div class="price-card"><h3>Premier Management</h3><div class="amt">9%<small> of rent collected</small></div><div class="sub">+ 50% of first month&rsquo;s rent per new lease.</div>
        <ul><li>Everything in Essential</li><li>Eviction protection guarantee</li><li>Pet damage guarantee</li><li>Semi-annual inspections with photo report</li><li>Renewal &amp; rent-increase strategy</li><li>Dedicated portfolio manager</li></ul>
        <a href="/about-contact#intake" class="btn btn-dark">Choose Premier</a></div>
    </div>
    <div class="tbl-wrap mt-l">
      <table class="cmp">
        <thead><tr><th>Fee</th><th>Placement Only</th><th>Essential</th><th>Premier</th></tr></thead>
        <tbody>
          <tr><td>Monthly management</td><td>&mdash;</td><td>7% of collected rent</td><td>9% of collected rent</td></tr>
          <tr><td>Tenant placement</td><td>75% of first month</td><td>50% of first month</td><td>50% of first month</td></tr>
          <tr><td>Lease renewal</td><td>&mdash;</td><td>$250</td><td>Included</td></tr>
          <tr><td>Maintenance markup</td><td>&mdash;</td><td>None</td><td>None</td></tr>
          <tr><td>Eviction coordination</td><td>&mdash;</td><td>At cost</td><td>Covered by guarantee</td></tr>
          <tr><td>Setup / onboarding</td><td>$0</td><td>$0</td><td>$0</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>

<section class="dark" id="guarantees">
  <div class="wrap">
    <div class="sec-head"><span class="eyebrow"><span class="dot"></span>Our Guarantees</span><h2>We put our fee on the line.</h2></div>
    <div class="grid-3">
      <div class="card"><div class="ic">{ICON["clock"]}</div><h3>14-Day Tenant Placement</h3><p>If we don&rsquo;t sign a qualified tenant within 14 days of your property being rent-ready and listed at our recommended price, your first month of management is free.</p></div>
      <div class="card"><div class="ic">{ICON["shield"]}</div><h3>Eviction Protection</h3><p>If a tenant we placed must be evicted within their first 12 months, we cover court and attorney costs up to $2,500 and re-place a tenant at no leasing fee.</p></div>
      <div class="card"><div class="ic">{ICON["paw"]}</div><h3>Pet Damage Guarantee</h3><p>Pet damage beyond the security deposit caused by an approved pet is covered up to $1,500 per lease on Premier plans.</p></div>
    </div>
    <p class="fine mt-m">Guarantee terms, limits and eligibility are governed by your management agreement.</p>
  </div>
</section>

<section>
  <div class="wrap two-col">
    <div>
      <div class="sec-head" style="margin-bottom:24px"><span class="eyebrow"><span class="dot"></span>Tenant Screening</span><h2>Four checks. Every applicant. Every time.</h2><p>Consistent written criteria applied to every applicant &mdash; the foundation of both low turnover and Fair Housing compliance.</p></div>
      <div class="grid-2">
        <div class="card-light"><div class="ic">{ICON["chart"]}</div><h3>Credit Report</h3><p>TransUnion / Equifax score and payment history.</p></div>
        <div class="card-light"><div class="ic">{ICON["shield"]}</div><h3>Criminal Background</h3><p>Nationwide search within HUD and local guidelines.</p></div>
        <div class="card-light"><div class="ic">{ICON["doc"]}</div><h3>Eviction History</h3><p>Nationwide eviction and judgment records.</p></div>
        <div class="card-light"><div class="ic">{ICON["cash"]}</div><h3>3x Income-to-Rent</h3><p>Verified income of at least 3x monthly rent.</p></div>
      </div>
    </div>
    <div>
      <div class="sec-head" style="margin-bottom:24px"><span class="eyebrow"><span class="dot"></span>What&rsquo;s Included</span><h2>Transparent deliverables.</h2></div>
      <div class="faq">
        <details open><summary>24/7 maintenance dispatch</summary><p>Tenants submit requests online or by phone around the clock. Our vetted, licensed and insured vendor network is dispatched by priority; you approve anything above your set threshold (default $350).</p></details>
        <details><summary>Rent collection via ACH</summary><p>Tenants pay online by ACH or card. Late fees are enforced per your lease and state law. Net proceeds hit your account on the 1st.</p></details>
        <details><summary>Lease enforcement &amp; compliance</summary><p>State-compliant leases, HOA bylaw coordination, notices, inspections and renewals handled by our team.</p></details>
        <details><summary>Owner dashboard</summary><p>Real-time view of distributions, maintenance tickets, lease terms, inspection photos and monthly statements. Year-end 1099 and P&amp;L for your CPA.</p></details>
        <details><summary>Switching from another manager</summary><p>We handle the transition: tenant notices, deposit transfer, lease and key handover. Most transfers complete within 30 days at no cost.</p></details>
      </div>
    </div>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap"><div class="cta-band">
    <div><h2 style="color:var(--text)">Get a free rental analysis and management proposal.</h2><p>Tell us about your property &mdash; we&rsquo;ll send projected rent, time to lease and an all-in cost breakdown within one business day.</p></div>
    <div><a href="/about-contact#intake" class="btn btn-primary">Start Owner Onboarding &rarr;</a></div>
  </div></div>
</section>
'''

# ================================================================== ABOUT/CONTACT
ABOUT = f'''
<div class="page-head"><div class="wrap">
  <span class="eyebrow"><span class="dot"></span>About LeaseRun</span>
  <h1 style="font-size:clamp(32px,4.4vw,50px)">Institutional discipline for individual investors.</h1>
  <p>LeaseRun was built for investors who want the returns of US residential real estate without becoming a full-time landlord.</p>
</div></div>

<section>
  <div class="wrap two-col">
    <div>
      <h2>Who we are</h2>
      <p class="mt-m" style="color:var(--muted-dark);font-size:17px">LeaseRun combines acquisitions, underwriting and property management under one roof. Most investors work with a wholesaler, a turnkey seller and a property manager whose incentives don&rsquo;t line up. We underwrite every property as if we were going to manage it for the next ten years &mdash; because we are.</p>
      <p class="mt-s" style="color:var(--muted-dark);font-size:17px">We focus on cash-flowing single-family and 2&ndash;4 unit multi-family properties in Sunbelt and Midwest metros, with conservative underwriting assumptions, third-party inspections and verified rent data on every deal.</p>
      <div class="grid-2 mt-l">
        <div class="card-light"><h3>Our underwriting standard</h3><p>Rent comps, verified rent rolls, inspection-based rehab budgets and stress-tested vacancy and CapEx reserves.</p></div>
        <div class="card-light"><h3>Our alignment</h3><p>We earn management fees only on rent collected. If your property doesn&rsquo;t perform, neither do we.</p></div>
      </div>
      <div id="compliance" class="mt-l">
        <h2 style="font-size:28px">Compliance</h2>
        <ul style="list-style:none;margin-top:16px;color:var(--muted-dark)">
          <li style="padding:10px 0;border-top:1px solid var(--line-light)"><b style="color:var(--text-dark)">Fair Housing.</b> We comply with the Federal Fair Housing Act and all state and local fair housing laws, and apply written screening criteria uniformly to every applicant.</li>
          <li style="padding:10px 0;border-top:1px solid var(--line-light)"><b style="color:var(--text-dark)">Licensing.</b> Brokerage and property management services are provided through licensed entities in each state where we operate. [License numbers to be added.]</li>
          <li style="padding:10px 0;border-top:1px solid var(--line-light)"><b style="color:var(--text-dark)">Trust accounting.</b> Tenant security deposits and rents are held in segregated trust accounts as required by state law.</li>
          <li style="padding:10px 0;border-top:1px solid var(--line-light)"><b style="color:var(--text-dark)">No investment advice.</b> Projections are estimates, not guarantees. We are not a broker-dealer, investment adviser, CPA, attorney or Qualified Intermediary.</li>
          <li style="padding:10px 0;border-top:1px solid var(--line-light)"><b style="color:var(--text-dark)">Privacy.</b> We never sell your personal information. Applicant screening data is handled in accordance with the FCRA.</li>
        </ul>
      </div>
    </div>

    <div id="intake">
      <div class="panel">
        <span class="eyebrow" style="color:#119767"><span class="dot" style="background:#119767"></span>Free · 30 minutes</span>
        <h2 style="font-size:28px;margin-top:10px">Book a free portfolio audit</h2>
        <p style="color:var(--muted-dark);margin:8px 0 22px">Tell us about your goals. We&rsquo;ll come back with a buy box, target markets and a sample underwriting package.</p>
        <form data-lead="investor-intake" data-endpoint="{LEAD_ENDPOINT}">
          <div class="grid-2" style="gap:12px">
            <div class="field"><label>First name</label><input name="first_name" required autocomplete="given-name"></div>
            <div class="field"><label>Last name</label><input name="last_name" required autocomplete="family-name"></div>
          </div>
          <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
          <div class="field"><label>Phone</label><input name="phone" type="tel" autocomplete="tel"></div>
          <div class="field"><label>I&rsquo;m interested in</label><select name="interest" required>
            <option value="">Select one</option><option>Buying my first rental</option><option>Adding to my portfolio</option><option>Property management for a property I own</option><option>A 1031 exchange</option><option>Off-market / BRRRR deals</option></select></div>
          <div class="grid-2" style="gap:12px">
            <div class="field"><label>Capital available</label><select name="capital"><option>Under $50k</option><option>$50k – $100k</option><option>$100k – $250k</option><option>$250k – $500k</option><option>$500k+</option></select></div>
            <div class="field"><label>Timeline</label><select name="timeline"><option>Ready now</option><option>1–3 months</option><option>3–6 months</option><option>Just researching</option></select></div>
          </div>
          <div class="field"><label>Doors currently owned</label><select name="doors"><option>0</option><option>1–2</option><option>3–9</option><option>10+</option></select></div>
          <div class="field"><label>Anything we should know?</label><textarea name="notes" rows="3" placeholder="Target markets, 1031 deadlines, LLC setup, etc."></textarea></div>
          <button class="btn btn-primary" style="width:100%">Request My Portfolio Audit</button>
          <div class="ok-msg">Thanks &mdash; we&rsquo;ll reach out within one business day. Want to pick a time now? <a href="{CALENDLY}" target="_blank" rel="noopener" style="text-decoration:underline">Open the calendar</a>.</div>
        </form>
        <p class="fine" style="color:var(--muted-dark)">Prefer to schedule directly? <a href="{CALENDLY}" target="_blank" rel="noopener" style="color:#119767;font-weight:600">Pick a time on Calendly &rarr;</a></p>
      </div>
      <div class="panel mt-m">
        <h3>Investor Relations</h3>
        <p class="mt-s" style="color:var(--muted-dark)">Mon&ndash;Fri, 8am&ndash;7pm ET</p>
        <p class="mt-s num" style="font-size:22px;font-weight:700"><a href="tel:{PHONE.replace(" ", "").replace("(", "").replace(")", "").replace("-", "")}">{PHONE}</a></p>
        <p class="mt-s"><a href="mailto:{EMAIL}" style="color:#119767;font-weight:600">{EMAIL}</a></p>
        <p class="mt-s" style="color:var(--muted-dark);font-size:14px">Current tenants: maintenance emergencies are handled 24/7 through your tenant portal.</p>
      </div>
    </div>
  </div>
</section>
'''

PAGES = {
    "index.html": ("LeaseRun | Turnkey Rental Investing & Property Management", "Smarter real estate investing. Pre-underwritten US rental properties, full-service property management and 1031 exchange coordination for hands-off cash flow.", "/", HOME, True),
    "properties.html": ("Turnkey & Off-Market Rental Properties | LeaseRun", "Browse pre-underwritten single-family and multi-family rentals with cap rate, cash-on-cash, GRM and rehab estimates on every deal.", "/properties", PROPERTIES, False),
    "property-management.html": ("Full-Service Property Management & Pricing | LeaseRun", "Tenant placement, 24/7 maintenance, eviction protection and ACH payouts. 7–9% management, 14-day placement guarantee.", "/property-management", PM, False),
    "about-contact.html": ("About LeaseRun & Investor Contact", "Institutional-grade acquisitions and property management for US real estate investors. Book a free portfolio audit.", "/about-contact", ABOUT, False),
}

if __name__ == "__main__":
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for name, (title, desc, path, body, auto) in PAGES.items():
        (DIST / name).write_text(head(title, desc, path, auto) + body + foot(), encoding="utf-8")
    for a in ASSETS:
        shutil.copy(ROOT / a, DIST / a)
    (DIST / "vercel.json").write_text('{"cleanUrls": true, "trailingSlash": false}\n')
    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: https://leaserun.com/sitemap.xml\n")
    urls = "".join(f"<url><loc>https://leaserun.com{p[2]}</loc></url>" for p in PAGES.values())
    (DIST / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n')
    print("built", sorted(os.listdir(DIST)))
