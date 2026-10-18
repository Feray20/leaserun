#!/usr/bin/env python3
"""Adds the LeaseRun investor software (US version of ImmoAdv) to the built site.

Runs after build.py and extra.py, before finalize.py. Existing pages keep their content;
this script only adds new pages, nav links and one teaser section on the home page.
"""
import pathlib, re, shutil
import build, json, html as _html
import learn_content as LC

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "dist"
ASSETS = ["lr-calc.js", "lr-qr.js", "lr-app.js", "lr-app.css", "logo-mark.png", "widget.js", "sw.js", "manifest.webmanifest"]
V = "20261017"  # cache-busting for the app assets

DISCLAIMER = ('<p class="hint" style="font-size:13px;color:var(--muted-dark);margin-top:22px">LeaseRun software provides estimates for '
              'education and planning. It is not investment, tax, legal or lending advice, not a loan offer and not an appraisal. '
              'Verify every number with your lender, insurance agent, county assessor and CPA.</p>')


def head_block(title, sub, eyebrow=""):
    eb = f'<span class="eyebrow"><span class="dot"></span>{eyebrow}</span>' if eyebrow else ""
    return f'<section class="page-head" style="padding:48px 0 36px"><div class="wrap">{eb}<h1 style="font-size:clamp(30px,4.4vw,46px);margin:12px 0 0">{title}</h1><p>{sub}</p></div></section>'


def page(app, title, desc, path, body, index=True, sample=False):
    html = build.head(title, desc, path, False) + body + build.foot()
    attrs = f' data-app="{app}"' + (' data-sample="1"' if sample else "")
    html = html.replace("<body>", f"<body{attrs}>", 1)
    slug = path.strip("/").replace("learn/", "learn-") or "default"
    og = slug if (ROOT / "og" / f"{slug}.png").exists() else "default"
    extra = (f'<link rel="stylesheet" href="/lr-app.css?v={V}">\n'
             f'<meta property="og:image" content="https://leaserun.com/og/{og}.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
             '<meta name="twitter:card" content="summary_large_image">\n<link rel="manifest" href="/manifest.webmanifest">\n')
    if not index:
        extra = '<meta name="robots" content="noindex, nofollow">\n' + extra
    html = html.replace('<meta name="twitter:card" content="summary">\n', '', 1)
    html = html.replace("</head>", extra + "</head>", 1)
    html = html.replace('<script src="/app.js" defer></script>',
                        f'<script src="/app.js" defer></script>\n<script src="/lr-calc.js?v={V}" defer></script>\n<script src="/lr-qr.js?v={V}" defer></script>\n<script src="/lr-app.js?v={V}" defer></script>', 1)
    return html


def shell(inner=""):
    return f'<main class="app-shell"><div class="wrap">{inner}<div id="lr-root"><div class="empty-state"><span class="spin"></span> Loading&hellip;</div></div><noscript><p>Please enable JavaScript to use the LeaseRun analyzer.</p></noscript></div></main>'


PLANS = [
    ("free", "Free", "$0", "", "For your first numbers", False, "", [
        "Deal analyzer with stress test and red flags", "Beginner path through a real US purchase",
        "Account with 2 saved properties", "Closing costs, price check, extra payments", "Lender package as watermarked preview"]),
    ("loan-package", "Lender Package", "$39", "one-time per property", "Single purchase &middot; no subscription", True, "", [
        "Lender-ready PDF for one property", "Sources &amp; uses, PITIA, DSCR, reserves, stress test",
        "Underwriter notes and document checklist", "Footer &ldquo;Created with LeaseRun&rdquo;"]),
    ("buyer-pass", "Buyer Pass", "$49", "one-time, 90 days", "For your search", False, "Everything in Free, plus:", [
        "90 days of unlimited properties and analyses", "Compare Loan Estimates, lender meeting prep, offer letter",
        "Print &amp; PDF for every tool", "1 lender package included ($39 value)", "Ends automatically &ndash; nothing to cancel"]),
    ("investor-pro", "Investor Pro", "$29", "per month", "For landlords with rentals", False, "Everything in Buyer Pass, plus:", [
        "Unlimited properties and lender packages", "Portfolio stress test (rate, rent, vacancy shocks)",
        "Refinance &amp; cash-out calculator", "Schedule E export for your CPA", "Cancel any time, effective at the end of the month"]),
]
CMP = [
    ("Saved properties", "2", "2", "unlimited", "unlimited"),
    ("Lender package (PDF)", "preview", "1 property", "1 included", "unlimited"),
    ("Analyzer, stress test, red flags", "&check;", "&check;", "&check;", "&check;"),
    ("Closing costs, price check, extra payments", "&check;", "&check;", "&check;", "&check;"),
    ("Compare Loan Estimates, lender prep, offer letter", "&ndash;", "&ndash;", "&check;", "&check;"),
    ("Print &amp; PDF of tools", "&ndash;", "&ndash;", "&check;", "&check;"),
    ("Portfolio, refinance, Schedule E export", "&ndash;", "&ndash;", "&ndash;", "&check;"),
]

CALC_ITEMS = [
    ("/analyzer", "Deal analyzer", "Cash flow, cap rate, cash-on-cash, DSCR, red flags, stress test, 10-year projection and federal tax."),
    ("/start", "Your first rental in 3 steps", "A guided walk-through for beginners, with every term explained."),
    ("/deadlines", "Deadline calculator", "Contingencies, Closing Disclosure, first payment and 1031 exchange dates, with a calendar file."),
    ("/scenarios", "Sell, exchange, refinance or keep", "Capital gains, recapture and cash for each exit option."),
    ("/checklist", "Loan document checklist", "Everything lenders ask for on an investment-property loan."),
    ("/profiler", "Investor profiler", "Six questions to find the strategy that fits your cash and time."),
    ("/sample-loan-package", "Sample lender package", "See the PDF you can create for each property."),
    ("/learn", "Learn", "Plain-English answers on financing, taxes and being a landlord."),
    ("/program", "12-month landlord program", "What to do each month from closing to your first tax return."),
]
CALC_HUB = ('<main class="app-shell"><div class="wrap"><div class="tools">'
            + "".join(f'<a class="tool" href="{u}"><b>{t}</b><p>{d}</p><span class="pill good" style="align-self:flex-start">Open</span></a>' for u, t, d in CALC_ITEMS)
            + '</div></div></main><div id="lr-root" hidden></div>')

B2B_PLANS = [
    ("b2b-basic", "Business Basic", "$79", "per month", "For solo agents and loan officers", False, "", [
        "25 active client files with pipeline", "Unlimited client analyses", "Lender packages with your name, license and brand color",
        "Advisor playbook and compliance essentials", "All calculators and Pro tools"]),
    ("b2b-pro", "Business Pro", "$149", "per month", "Most popular", True, "Everything in Basic, plus:", [
        "Unlimited client files", "Portfolio stress test and refinance tools for client portfolios", "Schedule E export per client for their CPA",
        "Priority email support"]),
    ("b2b-enterprise", "Business Enterprise", "Custom", "", "Brokerages, lenders, PM firms", False, "Everything in Pro, plus:", [
        "Team seats and shared client pipeline", "Single sign-on", "White-label analyzer for your website", "Onboarding and API access on request"]),
]
B2B_CMP = [
    ("Active client files", "25", "unlimited", "unlimited"),
    ("Branded lender packages", "&check;", "&check;", "&check;"),
    ("Advisor playbook", "&check;", "&check;", "&check;"),
    ("Portfolio, refinance, Schedule E for clients", "&ndash;", "&check;", "&check;"),
    ("Team seats, SSO, white label", "&ndash;", "&ndash;", "&check;"),
]

def business_body():
    cards = ""
    for pid, name, amt, per, badge, feat, basis, feats in B2B_PLANS:
        btn = (f'<a class="btn btn-pay" href="mailto:invest@leaserun.com?subject=LeaseRun%20Business%20Enterprise">Contact sales</a>' if pid == "b2b-enterprise"
               else f'<button class="btn btn-pay" data-plan="{pid}">Get {name}</button>')
        cards += (f'<div class="plan{" feat" if feat else ""}"><span class="badge-t">{badge}</span><h3>{name}</h3>'
                  f'<div class="amt">{amt} <small>{per}</small></div>' + (f'<div class="basis">{basis}</div>' if basis else "")
                  + '<ul>' + "".join(f"<li>{f}</li>" for f in feats) + f'</ul>{btn}</div>')
    rows = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in B2B_CMP)
    who = [("Real estate agents", "Show investor clients the cash flow, DSCR and stress test of every listing before the showing, and hand over a clean package."),
           ("Loan officers and brokers", "Receive complete files: sources and uses, PITIA, lender DSCR, reserves and the document checklist in one PDF."),
           ("Property managers", "Help owners decide whether to keep, refinance, sell or 1031 &ndash; with numbers instead of opinions.")]
    return (head_block("LeaseRun for Business", "Client files, branded lender packages and a playbook for professionals who work with US rental investors.", "For agents, lenders and property managers")
            + '<main class="app-shell"><div class="wrap"><div class="grid-3" style="margin-bottom:26px">'
            + "".join(f'<div class="card-light"><h3>{t}</h3><p>{d}</p></div>' for t, d in who) + '</div>'
            + '<div class="plans" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">' + cards + '</div>'
            + '<div class="box" style="margin-top:22px"><h2>Compare business plans</h2><div class="scroll-x"><table class="tbl"><thead><tr><th></th><th>Basic</th><th>Pro</th><th>Enterprise</th></tr></thead>'
            + f'<tbody>{rows}</tbody></table></div><p class="hint" style="margin:10px 0 0">Prices in US dollars per account, billed monthly; applicable sales tax may be added. Already a customer? <a href="/business/portal" style="color:#0E7A53;font-weight:600">Open the business portal</a>.</p></div>'
            + '<div class="box"><h2>Built for compliance</h2><p class="hint" style="margin:0">Your license or NMLS number and disclaimer appear on every document. LeaseRun pays no referral fees (RESPA Section 8), describes properties and numbers instead of people (Fair Housing Act), and never asks for Social Security or bank account numbers.</p></div>'
            + DISCLAIMER + '</div></main><div id="lr-root" hidden></div>')

SECURITY_BODY = (
    '<main class="app-shell"><div class="wrap"><div class="article-grid"><article class="article">'
    '<h2>What we store</h2><ul><li>Your email and a hashed password, managed by our authentication provider (Supabase Auth). We never see your password.</li>'
    '<li>Your investor profile, saved properties and, for business accounts, client files and company details.</li>'
    '<li>Nothing else: no Social Security numbers, no bank or card numbers, no tax returns, no uploaded IDs.</li></ul>'
    '<h2>Who can see it</h2><p>Every table uses row-level security in the database. A signed-in account can read and change only its own rows; the public website key cannot read any account data at all. Plan upgrades can only be written by our billing system, never by the browser.</p>'
    '<h2>How it is protected</h2><ul><li>All traffic is encrypted with TLS; HTTP Strict Transport Security is enabled.</li>'
    '<li>A strict Content Security Policy allows scripts only from LeaseRun itself, which blocks most cross-site scripting.</li>'
    '<li>The site cannot be embedded in other websites (clickjacking protection), and pages that show account data are never cached.</li>'
    '<li>Calculations run in your browser. Pasted listing text and calculator inputs are not sent to us unless you save a property.</li>'
    '<li>Passwords need at least 10 characters; sign-in attempts are rate-limited by the authentication provider.</li></ul>'
    '<h2>Your controls</h2><ul><li>Download all your data as a file from your investor profile.</li><li>Delete properties and client files at any time.</li>'
    '<li>Ask us to delete your account: <a href="mailto:invest@leaserun.com?subject=Delete%20my%20LeaseRun%20account">invest@leaserun.com</a>.</li></ul>'
    '<h2>Report a vulnerability</h2><p>Found a security issue? Email <a href="mailto:invest@leaserun.com?subject=Security%20report">invest@leaserun.com</a> with the subject &ldquo;Security report&rdquo;. Please give us reasonable time to fix it before disclosure. See also our <a href="/.well-known/security.txt">security.txt</a>.</p>'
    '</article><aside class="article-side"><div class="box"><h3>Related</h3><ul class="rel"><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms of Use</a></li><li><a href="/learn/what-data-does-leaserun-store">What data does LeaseRun store?</a></li></ul></div></aside></div></div></main><div id="lr-root" hidden></div>')

MONTHS = [
    ("Month 1", "Closing and setup", ["Keep the Closing Disclosure, deed and title policy in one folder; they set your tax basis.", "Open a separate bank account for the property (and the LLC, if any).", "Set up landlord insurance (DP-3) and, where relevant, flood insurance; confirm the lender is listed.", "Change locks, test smoke and CO detectors, note meter readings."]),
    ("Month 2", "Make ready and list", ["Finish make-ready work; keep receipts and separate repairs from improvements.", "Write your tenant screening criteria before you advertise.", "Set the rent from current comps; list with good photos and a property description that describes the home, not people."]),
    ("Month 3", "Lease up", ["Screen every applicant the same way; send adverse action notices when a credit report leads to denial.", "Use a lease written for your state and the lead-paint disclosure for pre-1978 homes.", "Document the move-in condition with dated photos signed by the tenant."]),
    ("Month 4", "Systems", ["Collect rent electronically; set the late-fee rules your state allows.", "Create a simple bookkeeping sheet by Schedule E line.", "Agree a repair process and approval limit with your manager or tenant."]),
    ("Month 5", "Reserves", ["Move the monthly CapEx and repair budget into a reserve account.", "Check the escrow analysis from your servicer: did taxes or insurance change?"]),
    ("Month 6", "Mid-year review", ["Compare actual cash flow with your analysis in LeaseRun; update the property.", "Re-shop insurance if the premium jumped.", "If you bought in a high-tax area, check the new assessment and the appeal deadline."]),
    ("Month 7", "Preventive maintenance", ["Service HVAC before the heavy season; clean gutters; check the roof and water heater.", "Inspect with proper notice to the tenant, as your lease and state law require."]),
    ("Month 8", "Tax planning", ["Ask your CPA about depreciation, the passive loss allowance and whether a cost segregation study pays off.", "Make estimated tax payments if the rental produces taxable income."]),
    ("Month 9", "Renewal plan", ["Decide on renewal 60–90 days before the lease ends; check local rent increase rules and notice periods.", "Price the renewal from current comps; turnover usually costs more than a modest increase."]),
    ("Month 10", "Next deal readiness", ["Update your investor profile; check reserves and DTI for a second property.", "Request fresh Loan Estimates if rates have moved."]),
    ("Month 11", "Year-end", ["Collect W-9s from contractors you paid $600 or more; prepare 1099-NEC filings.", "Gather the Form 1098 (mortgage interest) and property tax receipts."]),
    ("Month 12", "First tax return", ["Export the Schedule E estimate from LeaseRun and hand it to your CPA with the actual records.", "Review: did the property meet the cash-flow and DSCR targets you set? Adjust the next buy box accordingly."]),
]
PROGRAM_BODY = ('<main class="app-shell"><div class="wrap"><div class="journey">'
    + "".join(f'<div class="jstep"><div><b>{m} &middot; {t}</b><ul style="padding-left:18px;margin-top:6px;display:grid;gap:5px;font-size:14px;color:var(--muted-dark)">' + "".join(f"<li>{x}</li>" for x in items) + '</ul></div></div>' for m, t, items in MONTHS)
    + '</div><div class="box" style="margin-top:18px"><h2>Keep it on track</h2><p class="hint">Investor Pro adds the portfolio stress test, refinance tool and Schedule E export that this program refers to.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-primary btn-sm" href="/pricing">See Investor Pro</a><button class="btn btn-line btn-sm" onclick="window.print()">Print the program</button></div></div>'
    + DISCLAIMER + '</div></main><div id="lr-root" hidden></div>')

PARTNERS_BODY = ('<main class="app-shell"><div class="wrap"><div class="grid-3">'
    + "".join(f'<div class="card-light"><h3>{t}</h3><p>{d}</p></div>' for t, d in [
        ("Educators and communities", "Real estate courses, meetups and newsletters can link members to the free analyzer and the learning center."),
        ("Websites of agents and lenders", "Embed the free cash-flow calculator on your website. It links visitors to the full analysis."),
        ("Brokerages and lenders", "Team plans with shared pipelines and white-label options under LeaseRun for Business Enterprise.")])
    + '</div><div class="box" style="margin-top:20px"><h2>Embed the calculator</h2><p class="hint">Copy these two lines into any page. Change the color, your reference name and the default state.</p>'
      '<pre style="background:#0C1A35;color:#E8EDF7;padding:14px;border-radius:10px;overflow:auto;font-size:13px">&lt;div data-leaserun-widget data-color="#0C1A35" data-ref="your-company" data-state="TX"&gt;&lt;/div&gt;\n&lt;script src="https://leaserun.com/widget.js" async&gt;&lt;/script&gt;</pre>'
      '<p class="hint">Live preview:</p><div data-leaserun-widget data-color="#119767" data-ref="partners-page" data-state="OH"></div></div>'
    + '<div class="box"><h2>How we work with partners</h2><ul style="padding-left:18px;display:grid;gap:6px;font-size:14px"><li>LeaseRun does not pay fees for referrals of settlement services (RESPA Section 8). Partnerships cover education, software and co-marketing only.</li><li>The widget collects no data and sets no cookies.</li><li>Questions: <a href="mailto:invest@leaserun.com?subject=Partnership" style="color:#0E7A53;font-weight:600">invest@leaserun.com</a></li></ul></div>'
    + '</div></main><div id="lr-root" hidden></div><script src="/widget.js" defer></script>')

VERIFY_BODY = ('<main class="app-shell"><div class="wrap" style="max-width:720px"><div class="box"><h2>Check a lender package</h2>'
    '<p class="hint">Every lender package carries a verification code and a QR code. The code is a fingerprint of the key figures in the document. If any of those figures were changed after the package was created, the fingerprint no longer matches.</p>'
    '<div id="lr-root"></div></div>' + DISCLAIMER + '</div></main>')

OFFLINE_BODY = ('<main class="app-shell"><div class="wrap" style="max-width:640px"><div class="box"><h2>You are offline</h2><p class="hint">The analyzer and the first-rental walk-through still work if you opened them before. Saved properties need a connection.</p><a class="btn btn-primary btn-sm" href="/analyzer">Open the analyzer</a></div></div></main><div id="lr-root" hidden></div>')


def pricing_body():
    cards = ""
    for pid, name, amt, per, badge, feat, basis, feats in PLANS:
        btn = ('<a class="btn btn-primary" href="/signup">Start free</a>' if pid == "free"
               else f'<button class="btn btn-pay" data-plan="{pid}">Get {name}</button>')
        cards += (f'<div class="plan{" feat" if feat else ""}"><span class="badge-t">{badge}</span><h3>{name}</h3>'
                  f'<div class="amt">{amt} <small>{per}</small></div>'
                  + (f'<div class="basis">{basis}</div>' if basis else "")
                  + '<ul>' + "".join(f"<li>{f}</li>" for f in feats) + f'</ul>{btn}</div>')
    rows = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in CMP)
    return (head_block("Plans and pricing", "Buy exactly what your purchase needs. No subscription unless you manage rentals.", "Investor software")
            + '<main class="app-shell"><div class="wrap">'
            + '<div class="gate" id="limit-note" hidden>The free plan includes 2 saved properties. Choose a plan below to add more.</div>'
            + f'<div class="plans">{cards}</div>'
            + '<div class="box" style="margin-top:22px"><h2>Compare plans</h2><div class="scroll-x"><table class="tbl"><thead><tr><th></th><th>Free</th><th>Lender Package</th><th>Buyer Pass</th><th>Investor Pro</th></tr></thead>'
            + f'<tbody>{rows}</tbody></table></div><p class="hint" style="margin:10px 0 0">Prices in US dollars. Applicable sales tax may be added at checkout.</p></div>'
            + DISCLAIMER + '</div></main><div id="lr-root" hidden></div>')


def build_learn():
    (DIST / "learn").mkdir(exist_ok=True)
    cats = dict(LC.CATS)
    strip = lambda t: _html.unescape(re.sub(r"<[^>]+>", "", t))
    for a in LC.A:
        rel = [b for b in LC.A if b["cat"] == a["cat"] and b["slug"] != a["slug"]][:4]
        tool = (f'<div class="cta-inline"><b>Try it with your numbers</b><a class="btn btn-primary btn-sm" href="{a["tool"][0]}">{a["tool"][1]} &rarr;</a></div>' if a["tool"] else "")
        ld = json.dumps({"@context": "https://schema.org", "@type": "Article", "headline": strip(a["title"]), "description": strip(a["summary"]),
                         "author": {"@type": "Organization", "name": "LeaseRun"}, "publisher": {"@type": "Organization", "name": "LeaseRun"},
                         "dateModified": "2026-10-18", "mainEntityOfPage": f"https://leaserun.com/learn/{a['slug']}"})
        body = (head_block(a["title"], a["summary"], cats[a["cat"]])
                + '<main class="app-shell"><div class="wrap"><div class="article-grid"><article class="article">'
                + '<nav class="crumbs"><a href="/learn">Learn</a> &rsaquo; ' + cats[a["cat"]] + '</nav>'
                + a["body"] + tool
                + '<p class="hint" style="margin-top:22px;font-size:13px">General information about US rules as of October 2026, not tax, legal or financial advice. Rules change and vary by state; confirm with a licensed professional.</p>'
                + '</article><aside class="article-side">'
                + ('<div class="box"><h3>Related</h3><ul class="rel">' + "".join(f'<li><a href="/learn/{b["slug"]}">{b["title"]}</a></li>' for b in rel) + '</ul></div>' if rel else "")
                + '<div class="box"><h3>Run the numbers</h3><p class="hint">Analyze any US rental in five minutes.</p><a class="btn btn-primary btn-sm" href="/analyzer">Open the analyzer</a></div>'
                + '</aside></div></div></main><div id="lr-root" hidden></div>'
                + f'<script type="application/ld+json">{ld}</script>')
        (DIST / "learn" / f"{a['slug']}.html").write_text(page("learn", strip(a["title"]) + " | LeaseRun Learn", strip(a["summary"]), f"/learn/{a['slug']}", body), encoding="utf-8")
    groups = ""
    for cid, cname in LC.CATS:
        items = [a for a in LC.A if a["cat"] == cid]
        groups += (f'<section class="lgroup" data-group><h2>{cname}</h2><div class="lcards">'
                   + "".join(f'<a class="lcard" href="/learn/{a["slug"]}" data-q="{_html.escape(strip(a["title"] + " " + a["summary"]).lower())}"><b>{a["title"]}</b><span>{a["summary"]}</span></a>' for a in items)
                   + '</div></section>')
    body = (head_block("Real estate investing, explained", f"{len(LC.A)} clear answers on US rentals: money, financing, taxes and being a landlord.", "Learn")
            + '<main class="app-shell"><div class="wrap"><label class="fl" style="max-width:520px;margin-bottom:22px">Search<input id="lsearch" type="search" placeholder="e.g. DSCR, 1031, closing costs" autocomplete="off"></label>'
            + groups + '<p class="empty-state" id="lnone" hidden>No answer matches your search. Try fewer words.</p></div></main><div id="lr-root" hidden></div>')
    (DIST / "learn.html").write_text(page("learn", "Learn: US Rental Property Investing Explained | LeaseRun",
        "Plain-English answers on US rental investing: cash flow, closing costs, DSCR loans, depreciation, 1031 exchanges, fair housing and more.", "/learn", body), encoding="utf-8")
    return ["/learn"] + [f"/learn/{a['slug']}" for a in LC.A]


def main():
    for a in ASSETS:
        shutil.copy(ROOT / a, DIST / a)
    for d in ("og", "icons"):
        if (DIST / d).exists():
            shutil.rmtree(DIST / d)
        shutil.copytree(ROOT / d, DIST / d)
    (DIST / ".well-known").mkdir(exist_ok=True)
    (DIST / ".well-known" / "security.txt").write_text("Contact: mailto:invest@leaserun.com\nExpires: 2027-10-18T00:00:00.000Z\nPreferred-Languages: en, de\nCanonical: https://leaserun.com/.well-known/security.txt\nPolicy: https://leaserun.com/security\n")
    (DIST / "app").mkdir(exist_ok=True)
    (DIST / "business").mkdir(exist_ok=True)

    pages = {
        "analyzer.html": page("analyzer", "Rental Property Analyzer: Cash Flow, Cap Rate, DSCR | LeaseRun",
            "Free US rental property calculator: closing costs, PITIA, cash flow, cash-on-cash, cap rate, DSCR, stress test, 10-year projection and federal tax estimate.",
            "/analyzer", head_block("Will this rental make money?", "Know in five minutes. Enter the price and rent – we add closing costs, taxes, insurance, the mortgage and a stress test.", "Deal analyzer") + shell(DISCLAIMER)),
        "start.html": page("start", "My First Rental Property: Run the Numbers in 3 Steps | LeaseRun",
            "A guided walk-through for first-time US real estate investors: loan and payment, leverage, cash flow, reserves and the picture in ten years, with every term explained.",
            "/start", head_block("Your first rental, in three steps", "Price and rent, your money and the loan, then the result – with every term explained in plain English.", "For beginners") + shell()),
        "pricing.html": page("pricing", "Plans and Pricing | LeaseRun Investor Software",
            "Free deal analyzer, a one-time lender package, a 90-day Buyer Pass and Investor Pro for landlords.", "/pricing", pricing_body()),
        "sample-loan-package.html": page("package", "Sample Lender Package for an Investment Property | LeaseRun",
            "See what a lender-ready package looks like: sources and uses, PITIA, DSCR, reserves, stress test and document checklist.",
            "/sample-loan-package", shell(), sample=True),
        "deadlines.html": page("deadlines", "1031 Exchange & Closing Deadline Calculator | LeaseRun",
            "Calculate your 45-day and 180-day 1031 exchange deadlines and every date in your home purchase: inspection, financing, appraisal, Closing Disclosure and first payment.",
            "/deadlines", head_block("Your deadlines, on one page", "Purchase contingencies, the Closing Disclosure and 1031 exchange dates \u2013 with a calendar file and reminders.", "Deadline calculator") + shell()),
        "scenarios.html": page("scenarios", "Sell, 1031 Exchange, Refinance or Keep? Rental Property Calculator | LeaseRun",
            "Compare selling a rental, a 1031 exchange, a cash-out refinance and keeping it: capital gains, depreciation recapture, NIIT and return on equity.",
            "/scenarios", head_block("Sell, exchange, refinance or keep?", "See the cash and the tax of each option side by side before you call a listing agent.", "Exit scenarios") + shell()),
        "checklist.html": page("checklist", "Mortgage Document Checklist for Investment Properties | LeaseRun",
            "Every document lenders ask for on an investment property loan: income, assets, real estate owned, the subject property and LLC paperwork.",
            "/checklist", head_block("Loan document checklist", "What lenders ask for on an investment-property loan, grouped so nothing is missing on day one.", "Checklist") + shell()),
        "profiler.html": page("profiler", "Investor Profiler: Which Rental Strategy Fits You? | LeaseRun",
            "Six questions to find your best-fitting US rental strategy: house hack, turnkey, buy and hold, BRRRR or DSCR scaling.",
            "/profiler", head_block("Which strategy fits you?", "Six questions about cash, time and goals \u2013 and an honest starting point.", "Investor profiler") + shell()),
        "calculators.html": page("calculators", "Free Real Estate Investment Calculators | LeaseRun",
            "Free US rental property calculators: deal analyzer, first-rental walk-through, deadlines, sell-or-hold, document checklist and investor profiler.",
            "/calculators", head_block("Free calculators for US rental investors", "No account needed. Sign up only when you want to save properties.", "Calculators") + CALC_HUB),
        "business.html": page("pricing", "LeaseRun for Business: Tools for Agents, Loan Officers and Property Managers",
            "Client files, branded lender packages, DSCR and stress tests, and an advisor playbook for professionals working with US rental investors.", "/business", business_body()),
        "business/portal.html": page("b2b", "Business portal | LeaseRun", "LeaseRun business portal.", "/business/portal", shell(), index=False),
        "security.html": page("learn", "Security and Data Protection | LeaseRun", "How LeaseRun protects your account and data: row-level security, encryption, strict content security policy, data export and deletion.", "/security",
            head_block("Security and data protection", "What we store, who can see it and how it is protected.", "Security") + SECURITY_BODY),
        "program.html": page("learn", "Your First Year as a Landlord: 12-Month Program | LeaseRun", "A month-by-month plan for new US landlords: closing, lease-up, systems, reserves, maintenance, renewals and the first tax return.", "/program",
            head_block("Your first year as a landlord", "A month-by-month program from closing day to your first Schedule E.", "12-month program") + PROGRAM_BODY),
        "partners.html": page("learn", "Partner With LeaseRun: Embed the Rental Calculator | LeaseRun", "Embed LeaseRun's free rental cash-flow calculator on your website, and partner with us on education and software.", "/partners",
            head_block("Partner with LeaseRun", "For educators, communities, agents, lenders and brokerages.", "Partners") + PARTNERS_BODY),
        "verify.html": page("verify", "Verify a Lender Package | LeaseRun", "Check whether a LeaseRun lender package is unchanged.", "/verify",
            head_block("Verify a lender package", "Confirm that the key figures in a package were not changed.", "Verification") + VERIFY_BODY, index=False),
        "offline.html": page("learn", "Offline | LeaseRun", "You are offline.", "/offline", OFFLINE_BODY, index=False),
        "login.html": page("login", "Sign in | LeaseRun", "Sign in to your LeaseRun investor account.", "/login", shell(), index=False),
        "signup.html": page("signup", "Create a free account | LeaseRun", "Create your free LeaseRun investor account.", "/signup", shell(), index=False),
        "forgot.html": page("forgot", "Reset password | LeaseRun", "Reset your LeaseRun password.", "/forgot", shell(), index=False),
        "reset.html": page("reset", "Choose a new password | LeaseRun", "Choose a new password.", "/reset", shell(), index=False),
        "app.html": page("dashboard", "Dashboard | LeaseRun", "Your LeaseRun dashboard.", "/app", shell(), index=False),
        "app/property.html": page("property", "Property | LeaseRun", "Analyze a property.", "/app/property", shell(), index=False),
        "app/profile.html": page("profile", "Investor profile | LeaseRun", "Your investor profile.", "/app/profile", shell(), index=False),
        "app/tools.html": page("tools", "Tools | LeaseRun", "Investor tools.", "/app/tools", shell(), index=False),
        "app/loan-package.html": page("package", "Lender package | LeaseRun", "Lender package.", "/app/loan-package", shell(), index=False),
    }
    for name, html in pages.items():
        (DIST / name).write_text(html, encoding="utf-8")
    learn_urls = build_learn()

    # Nav: add software links on every page (existing links stay).
    links = '<a href="/calculators">Calculators</a><a href="/learn">Learn</a><a href="/pricing">Pricing</a><a href="/login" class="nav-app">Sign in</a>'
    teaser = '''
<section style="padding:64px 0;background:#fff;border-top:1px solid var(--line-light)"><div class="wrap">
  <div class="sec-head"><span class="eyebrow"><span class="dot"></span>New &middot; Investor software</span>
  <h2>Run the numbers yourself &ndash; before you talk to anyone.</h2>
  <p>The LeaseRun analyzer adds closing costs, property taxes, insurance, the mortgage and a stress test to any US rental. Beginners get a step-by-step path through a real purchase; pros get DSCR, IRR, portfolio and refinance tools &ndash; plus a lender-ready PDF.</p></div>
  <div class="grid-3" style="margin-top:28px">
    <a class="card-light" href="/start"><h3>Your first rental in 3 steps</h3><p>Loan, leverage, cash flow, reserves and the picture in ten years &ndash; every term explained.</p></a>
    <a class="card-light" href="/analyzer"><h3>Deal analyzer</h3><p>Cash flow, cap rate, cash-on-cash, DSCR, red flags and a 10-year projection. Free.</p></a>
    <a class="card-light" href="/sample-loan-package"><h3>Lender package</h3><p>Sources &amp; uses, PITIA, DSCR and reserves on one document your lender can read.</p></a>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a class="btn btn-primary" href="/analyzer">Analyze a property &rarr;</a><a class="btn btn-dark" href="/pricing">See plans</a></div>
</div></section>
'''
    for f in DIST.rglob("*.html"):
        if f.name == "admin.html":
            continue
        html = f.read_text(encoding="utf-8")
        if 'href="/calculators">Calculators</a>' not in html:
            html = html.replace('<a href="#" data-modal class="btn btn-primary btn-sm">', links + '<a href="#" data-modal class="btn btn-primary btn-sm">', 1)
        if '/lr-app.js' not in html and 'nav-app' in html:
            html = html.replace('<script src="/app.js" defer></script>', f'<script src="/app.js" defer></script>\n<script src="/lr-calc.js?v={V}" defer></script>\n<script src="/lr-app.js?v={V}" defer></script>', 1)
        html = html.replace('<a href="/about-contact#compliance">Privacy</a>', '<a href="/privacy">Privacy</a>')
        html = html.replace('<a href="/about-contact#compliance">Terms</a>', '<a href="/terms">Terms</a>')
        if '/business">LeaseRun for Business' not in html:
            html = html.replace('<li><a href="#" data-modal>Weekly Deal Sheet</a></li></ul></div>',
                                '<li><a href="#" data-modal>Weekly Deal Sheet</a></li><li><a href="/calculators">Free Calculators</a></li><li><a href="/learn">Learn</a></li><li><a href="/business">LeaseRun for Business</a></li><li><a href="/partners">Partners</a></li><li><a href="/security">Security</a></li></ul></div>', 1)
        if f.name == "index.html" and f.parent == DIST and "Investor software" not in html:
            html = html.replace("\n<footer>", teaser + "\n<footer>", 1)
        f.write_text(html, encoding="utf-8")

    # robots + sitemap
    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /app\nDisallow: /business/portal\nDisallow: /login\nDisallow: /signup\nDisallow: /forgot\nDisallow: /reset\nSitemap: https://leaserun.com/sitemap.xml\n")
    sm = DIST / "sitemap.xml"
    xml = sm.read_text() if sm.exists() else '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'
    add = "".join(f"<url><loc>https://leaserun.com{u}</loc></url>" for u in ["/calculators", "/start", "/analyzer", "/deadlines", "/scenarios", "/checklist", "/profiler", "/pricing", "/business", "/sample-loan-package", "/security", "/program", "/partners"] + learn_urls if f"{u}<" not in xml)
    sm.write_text(xml.replace("</urlset>", add + "</urlset>"))
    print("software:", sorted(pages))


if __name__ == "__main__":
    main()
