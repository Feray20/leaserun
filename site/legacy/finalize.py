#!/usr/bin/env python3
"""Launch-readiness pass over the built site in ./dist.

Removes placeholder contact details and unverifiable performance claims, and adds
remaining head tags. Runs after build.py (see vercel.json buildCommand).
"""
import pathlib, re, shutil

DIST = pathlib.Path(__file__).parent / "dist"
EMAIL = "invest@leaserun.com"

METRICS = '''<div class="metrics"><div class="wrap">
  <div class="metric"><div class="v">7%+</div><div class="k">Target cap rate on listed deals</div></div>
  <div class="metric"><div class="v">14 days</div><div class="k">Tenant placement guarantee</div></div>
  <div class="metric"><div class="v">4 checks</div><div class="k">Screening on every applicant</div></div>
  <div class="metric"><div class="v">45 / 180</div><div class="k">1031 deadlines tracked for you</div></div>
  <div class="metric"><div class="v">1st</div><div class="k">ACH owner payout, every month</div></div>
</div></div>'''

# (pattern, replacement, is_regex)
RULES = [
    # Performance stats → service commitments (no unverifiable track-record claims)
    (r'<!-- Metrics bar.*?-->\s*', '', True),
    (r'<div class="metrics">.*?</div>\s*</div></div>', METRICS, True),
    # Placeholder licensing text
    (' [license numbers to be added].', '. License information is available upon request.', False),
    ('[License numbers to be added.]', 'License information is available upon request.', False),
    # Placeholder phone number
    (r'<a href="tel:\d+">\(888\) 555-0142</a><br>', '', True),
    (r'<p class="mt-s num"[^>]*><a href="tel:\d+">\(888\) 555-0142</a></p>\s*', '', True),
    ('Mon&ndash;Fri, 8am&ndash;7pm ET', 'Email us any time &mdash; we reply within one business day.', False),
    # Placeholder Calendly link
    (r' Want to pick a time now\? <a href="https://calendly\.com[^"]*"[^>]*>Open the calendar</a>\.', '', True),
    (r'Prefer to schedule directly\? <a href="https://calendly\.com[^"]*"[^>]*>Pick a time on Calendly &rarr;</a>',
     f'Prefer email? <a href="mailto:{EMAIL}?subject=Portfolio%20Audit" style="color:#119767;font-weight:600">{EMAIL} &rarr;</a>', True),
    # Sample inventory clearly labeled
    (r'<!-- Sample inventory.*?-->\s*', '', True),
    ('<span class="eyebrow"><span class="dot"></span>Current Inventory</span>', '<span class="eyebrow"><span class="dot"></span>Sample Deals</span>', False),
    ('<span class="tag">Single Family</span>', '<span class="tag">Sample &middot; Single Family</span>', False),
    ('<span class="tag">Multi-Family</span>', '<span class="tag">Sample &middot; Multi-Family</span>', False),
    ('Filter by your buy box and request the full package on any deal.',
     'These sample deals show how every property is underwritten. Filter by your buy box, then request live inventory that matches.', False),
    ('>Request Underwriting Package</a>', '>Request Similar Deals</a>', False),
    ('Browse Current Inventory &rarr;', 'Browse Sample Deals &rarr;', False),
    ('Current markets are listed on the Properties page.', 'Sample deals from these markets are shown on the Properties page.', False),
    # Client-base claims → positioning
    ('Most LeaseRun clients are out-of-state investors.', 'LeaseRun is built for out-of-state investors.', False),
    ('We regularly close into', 'We close into', False),
    ('Bank-Level Encrypted Owner Portal', 'SSL-Encrypted Data', False),
]

HEAD_EXTRA = ('<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
              '<meta name="twitter:card" content="summary">\n'
              '<meta property="og:image" content="https://leaserun.com/apple-touch-icon.png">\n'
              '<meta property="og:site_name" content="LeaseRun">\n')


def main():
    for page in sorted(DIST.rglob("*.html")):
        html = page.read_text(encoding="utf-8")
        for pat, rep, rx in RULES:
            html = re.sub(pat, rep, html, count=1 if 'metrics' in pat else 0, flags=re.S) if rx else html.replace(pat, rep)
        if 'apple-touch-icon' not in html:
            html = html.replace('<link rel="icon"', HEAD_EXTRA + '<link rel="icon"', 1)
        if 'scroll-margin-top' not in html:  # keep anchor targets clear of the sticky header
            html = html.replace('</head>', '<style>[id]{scroll-margin-top:84px}</style>\n</head>', 1)
        for bad in ("555-0142", "calendly.com", "to be added", "98.4%"):
            assert bad not in html, f"{page.name}: leftover '{bad}'"
        page.write_text(html, encoding="utf-8")
    src = pathlib.Path(__file__).parent / "apple-touch-icon.png"
    if src.exists():
        shutil.copy(src, DIST / "apple-touch-icon.png")
    print("finalized", [p.name for p in DIST.glob("*.html")])


if __name__ == "__main__":
    main()
