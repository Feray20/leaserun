"""Vorschaubilder (Open Graph, 1200×630) je Seite aus <title> und Beschreibung erzeugen.

Entwicklerwerkzeug (Pillow, Schrift Inter). Aufruf nach build-seo:
    python3 scripts/og-images.py && node scripts/build-seo.mjs
Schreibt public/og/<pfad>.png; build-seo verweist automatisch darauf, wenn die Datei existiert.
"""
import html, re, xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent / 'public'
OUT = ROOT / 'og'
FONT = '/usr/share/fonts/opentype/inter/Inter-{}.otf'
NAVY, BLUE, SKY, WHITE, MUTED = (15, 44, 89), (2, 132, 199), (56, 189, 248), (255, 255, 255), (186, 206, 230)
LOGO = [
    [(50, 8.3), (63.1, 19.4), (62.6, 22.5), (49, 34), (45.2, 31.1), (5.3, 68.9), (2.5, 70), (3.1, 51.7)],
    [(98.8, 0.7), (93.4, 37.3), (83.6, 29.8), (50.8, 62.3), (43.7, 57.9), (17.2, 82.6), (0.2, 82.6), (42.2, 38.4), (50.3, 40.1), (69.6, 19.5), (64.6, 8.1)],
    [(82.3, 37.6), (99.5, 53.6), (99.6, 84), (88.6, 83.6), (62.5, 57)],
]


def font(w, size):
    return ImageFont.truetype(FONT.format(w), size)


def wrap(d, text, f, width, max_lines):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while d.textlength(lines[-1] + ' …', font=f) > width:
            lines[-1] = lines[-1].rsplit(' ', 1)[0]
        lines[-1] += ' …'
    return lines


def render(title, desc, kicker, dest):
    im = Image.new('RGB', (1200, 630), NAVY)
    d = ImageDraw.Draw(im)
    # dezenter Verlauf rechts
    for x in range(600, 1200):
        a = (x - 600) / 600
        d.line([(x, 0), (x, 630)], fill=tuple(int(NAVY[i] + (BLUE[i] - NAVY[i]) * a * 0.35) for i in range(3)))
    s, ox, oy = 0.62, 72, 58
    for poly, col in zip(LOGO, (SKY, BLUE, SKY)):
        d.polygon([(ox + x * s, oy + y * s) for x, y in poly], fill=col)
    d.text((ox + 76, oy + 10), 'Immo', font=font('Bold', 40), fill=WHITE)
    d.text((ox + 76 + d.textlength('Immo', font=font('Bold', 40)), oy + 10), 'Adv', font=font('Bold', 40), fill=SKY)
    d.text((72, 168), kicker.upper(), font=font('SemiBold', 24), fill=SKY)
    y = 210
    tf = font('Bold', 58 if len(title) < 48 else 50)
    for line in wrap(d, title, tf, 1056, 3):
        d.text((72, y), line, font=tf, fill=WHITE)
        y += tf.size + 12
    y += 14
    df = font('Regular', 28)
    for line in wrap(d, desc, df, 1056, 3 if y < 420 else 2):
        d.text((72, y), line, font=df, fill=MUTED)
        y += 40
    d.line([(72, 560), (1128, 560)], fill=(60, 90, 140), width=2)
    d.text((72, 574), 'immoadv.de', font=font('SemiBold', 24), fill=WHITE)
    d.text((1128 - d.textlength('Technisches Analysewerkzeug · keine Finanzierungsberatung', font=font('Regular', 20)), 578),
           'Technisches Analysewerkzeug · keine Finanzierungsberatung', font=font('Regular', 20), fill=MUTED)
    im.convert('P', palette=Image.ADAPTIVE, colors=128).save(dest, optimize=True)


def main():
    OUT.mkdir(exist_ok=True)
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    n = 0
    for loc in ET.parse(ROOT / 'sitemap.xml').getroot().findall('s:url/s:loc', ns):
        path = loc.text.replace('https://immoadv.de', '').strip('/')
        if not path:
            continue  # Startseite behält og-image.png
        f = ROOT / path / 'index.html'
        if not f.exists():
            continue
        src = f.read_text(encoding='utf-8')
        title = html.unescape(re.search(r'<title>([^<]*)</title>', src).group(1)).replace(' | ImmoAdv', '')
        m = re.search(r'<meta name="description" content="([^"]*)"', src)
        desc = html.unescape(m.group(1)) if m else ''
        kicker = 'Wissen' if path.startswith('wissen') else 'Rechner' if path.startswith('rechner') else 'ImmoAdv'
        render(title, desc, kicker, OUT / (path.replace('/', '--') + '.png'))
        n += 1
    print(f'{n} Vorschaubilder in public/og/')


if __name__ == '__main__':
    main()
