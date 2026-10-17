"""Vorrendern der statischen Unterseiten (Entwicklerwerkzeug, benötigt Python-Playwright).

Startet einen lokalen Server auf public/, öffnet jede Seite in Chromium und schreibt den gerenderten
<body>-Inhalt zwischen <!--pre:start--> und <!--pre:end--> in die jeweilige index.html. Die Skripte bleiben
erhalten und rendern im Browser wie bisher; Suchmaschinen und Nutzer ohne JavaScript sehen den Inhalt sofort.

Aufruf (nach Änderungen an routes.js, content.js oder tools.mjs):
    python3 scripts/prerender.py && node scripts/build-seo.mjs
"""
import functools, http.server, re, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / 'public'
SKIP = {'index.html', 'auth-login.html', 'offline.html'}
SKIP_DIRS = {'b2b-portal', 'intern', 'og', 'datenraum', 'pruefen', 'partner', 'auth', 'src', 'data', 'brand'}


def pages():
    for f in sorted(ROOT.rglob('index.html')):
        rel = f.relative_to(ROOT)
        if str(rel) in SKIP or rel.parts[0] in SKIP_DIRS:
            continue
        yield '/' + '/'.join(rel.parts[:-1]) + '/', f


def main():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(ROOT))
    with socketserver.TCPServer(('127.0.0.1', 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
            # API-Aufrufe lokal nicht vorhanden: sofort mit leerem Ergebnis beantworten (wie Produktion ohne Bezahlung).
            ctx.route('**/api/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"enabled":false}'))
            for url, f in pages():
                pg = ctx.new_page()
                pg.goto(f'http://127.0.0.1:{port}{url}', wait_until='networkidle')
                pg.wait_for_timeout(150)
                body = pg.evaluate("""() => { const c = document.body.cloneNode(true);
                    c.querySelectorAll('script').forEach(s => s.remove());
                    c.querySelectorAll('[data-pro], [data-doc]').forEach(i => i.removeAttribute('checked'));
                    return c.innerHTML.trim(); }""")
                pg.close()
                html = f.read_text(encoding='utf-8')
                html = re.sub(r'<!--pre:start-->[\s\S]*?<!--pre:end-->', '', html)
                html = html.replace('<body>', f'<body><!--pre:start-->{body}<!--pre:end-->', 1)
                f.write_text(html, encoding='utf-8')
                print(f'{url:45} {len(body):>7} Zeichen')
            b.close()
        srv.shutdown()


if __name__ == '__main__':
    main()
