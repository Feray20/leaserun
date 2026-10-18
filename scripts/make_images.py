#!/usr/bin/env python3
"""Generates PWA icons and 1200x630 social preview images (run locally; needs Pillow + Inter font).
Outputs are committed to site/icons and site/og so the Vercel build needs no image libraries."""
import pathlib, sys, textwrap
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "site"))
import learn_content as LC
import html, re

SITE = pathlib.Path(__file__).resolve().parent.parent / "site"
F = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
INK, ACC, BLUE, MUT = (12, 26, 53), (26, 197, 133), (18, 144, 231), (184, 195, 219)
mark = Image.open(SITE / "logo-mark.png").convert("RGBA")

def icons():
    out = SITE / "icons"; out.mkdir(exist_ok=True)
    for size, pad, name in [(192, 0.12, "icon-192.png"), (512, 0.12, "icon-512.png"), (512, 0.22, "icon-512-maskable.png"), (192, 0.22, "icon-192-maskable.png")]:
        im = Image.new("RGBA", (size, size), INK + (255,))
        m = mark.resize((int(size * (1 - 2 * pad)),) * 2, Image.LANCZOS)
        im.alpha_composite(m, (int(size * pad), int(size * pad)))
        im.convert("RGB").save(out / name, optimize=True)

def og(slug, eyebrow, title, sub):
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(im)
    for i in range(0, 420, 2):  # soft glow
        a = int(38 * (1 - i / 420))
        d.ellipse((W - 260 - i, -260 - i, W + 260 + i, 260 + i), outline=(INK[0] + a // 4, INK[1] + a // 2, INK[2] + a))
    im.paste(mark.resize((88, 88), Image.LANCZOS), (72, 64), mark.resize((88, 88), Image.LANCZOS))
    d.text((176, 84), "LeaseRun", font=ImageFont.truetype(F.format("Bold"), 40), fill=(255, 255, 255))
    d.text((72, 200), eyebrow.upper(), font=ImageFont.truetype(F.format("Bold"), 26), fill=ACC)
    tf = ImageFont.truetype(F.format("Bold"), 64 if len(title) < 46 else 54)
    y = 246
    for line in textwrap.wrap(title, 30 if len(title) < 46 else 36)[:3]:
        d.text((72, y), line, font=tf, fill=(255, 255, 255)); y += tf.size + 12
    sf = ImageFont.truetype(F.format("Regular"), 28)
    for line in textwrap.wrap(sub, 62)[:2]:
        d.text((72, y + 14), line, font=sf, fill=MUT); y += 40
    d.rectangle((0, H - 10, W, H), fill=ACC)
    d.rectangle((0, H - 10, W // 3, H), fill=BLUE)
    out = SITE / "og"; out.mkdir(exist_ok=True)
    im.quantize(colors=96, method=Image.Quantize.MEDIANCUT).save(out / f"{slug}.png", optimize=True)

strip = lambda t: html.unescape(re.sub(r"<[^>]+>", "", t))
PAGES = [
    ("default", "US rental investing", "Know in five minutes if a rental makes money", "Analyzer, lender package, calculators and guides for US real estate investors."),
    ("analyzer", "Deal analyzer", "Will this rental make money?", "Closing costs, PITIA, cash flow, cap rate, DSCR, stress test and taxes."),
    ("start", "For beginners", "Your first rental, in three steps", "Every term explained in plain English."),
    ("pricing", "Plans and pricing", "Buy exactly what your purchase needs", "Free, Lender Package, Buyer Pass and Investor Pro."),
    ("calculators", "Free calculators", "Calculators for US rental investors", "Deals, deadlines, exits, documents and strategy."),
    ("deadlines", "Deadline calculator", "Contingencies, closing and 1031 dates", "With a calendar file and reminders."),
    ("scenarios", "Exit scenarios", "Sell, exchange, refinance or keep?", "Capital gains, recapture and cash side by side."),
    ("checklist", "Checklist", "Loan document checklist", "Everything lenders ask for on an investment-property loan."),
    ("profiler", "Investor profiler", "Which rental strategy fits you?", "Six questions about cash, time and goals."),
    ("learn", "Learn", "Real estate investing, explained", "Plain-English answers on US rentals."),
    ("business", "LeaseRun for Business", "Tools for agents, lenders and property managers", "Client files, branded lender packages and an advisor playbook."),
    ("sample-loan-package", "Lender package", "A lender-ready package for every property", "Sources and uses, PITIA, DSCR, reserves and stress test."),
    ("security", "Security", "How we protect your data", "Encryption, access rules and what we never store."),
    ("program", "12-month program", "Your first year as a landlord, month by month", "From closing to your first tax return."),
    ("partners", "Partners", "Partner with LeaseRun", "For educators, communities and professionals."),
]
if __name__ == "__main__":
    icons()
    for p in PAGES: og(*p)
    for a in LC.A: og("learn-" + a["slug"], dict(LC.CATS)[a["cat"]], strip(a["title"]), strip(a["summary"]))
    print("icons + og images written")
