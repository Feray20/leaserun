#!/usr/bin/env python3
"""Adds the LeaseRun investor software (US version of ImmoAdv) to the built site.

Runs after build.py and extra.py, before finalize.py. Existing pages keep their content;
this script only adds new pages, nav links and one teaser section on the home page.
"""
import pathlib, re, shutil
import build

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "dist"
ASSETS = ["lr-calc.js", "lr-app.js", "lr-app.css", "logo-mark.png"]
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
    extra = f'<link rel="stylesheet" href="/lr-app.css?v={V}">\n'
    if not index:
        extra = '<meta name="robots" content="noindex, nofollow">\n' + extra
    html = html.replace("</head>", extra + "</head>", 1)
    html = html.replace('<script src="/app.js" defer></script>',
                        f'<script src="/app.js" defer></script>\n<script src="/lr-calc.js?v={V}" defer></script>\n<script src="/lr-app.js?v={V}" defer></script>', 1)
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


def main():
    for a in ASSETS:
        shutil.copy(ROOT / a, DIST / a)
    (DIST / "app").mkdir(exist_ok=True)

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

    # Nav: add software links on every page (existing links stay).
    links = '<a href="/start">First Rental</a><a href="/analyzer">Analyzer</a><a href="/pricing">Pricing</a><a href="/login" class="nav-app">Sign in</a>'
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
        if 'href="/analyzer">Analyzer</a>' not in html:
            html = html.replace('<a href="#" data-modal class="btn btn-primary btn-sm">', links + '<a href="#" data-modal class="btn btn-primary btn-sm">', 1)
        if '/lr-app.js' not in html and 'nav-app' in html:
            html = html.replace('<script src="/app.js" defer></script>', f'<script src="/app.js" defer></script>\n<script src="/lr-calc.js?v={V}" defer></script>\n<script src="/lr-app.js?v={V}" defer></script>', 1)
        html = html.replace('<a href="/about-contact#compliance">Privacy</a>', '<a href="/privacy">Privacy</a>')
        html = html.replace('<a href="/about-contact#compliance">Terms</a>', '<a href="/terms">Terms</a>')
        if f.name == "index.html" and f.parent == DIST and "Investor software" not in html:
            html = html.replace("\n<footer>", teaser + "\n<footer>", 1)
        f.write_text(html, encoding="utf-8")

    # robots + sitemap
    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /app\nDisallow: /login\nDisallow: /signup\nDisallow: /forgot\nDisallow: /reset\nSitemap: https://leaserun.com/sitemap.xml\n")
    sm = DIST / "sitemap.xml"
    xml = sm.read_text() if sm.exists() else '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'
    add = "".join(f"<url><loc>https://leaserun.com{u}</loc></url>" for u in ["/start", "/analyzer", "/pricing", "/sample-loan-package"] if f"{u}<" not in xml)
    sm.write_text(xml.replace("</urlset>", add + "</urlset>"))
    print("software:", sorted(pages))


if __name__ == "__main__":
    main()
