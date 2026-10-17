#!/usr/bin/env python3
"""Second build step: legal pages, 404, lead admin dashboard, iPhone icon, sitemap/robots.

Runs after build.py and before finalize.py (see vercel.json buildCommand).
Pure standard library so it runs on Vercel's build image without installs.
"""
import pathlib, struct, zlib, re
import build  # reuse the shared header/footer

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "dist"
EMAIL = "invest@leaserun.com"
UPDATED = "October 17, 2026"
ADMIN_API = "https://pxexxguhgqfxwhtnwcrj.supabase.co/functions/v1/leads-admin"


# ----------------------------------------------------------------- legal pages
def legal(title, intro, sections):
    body = "".join(f'<h2 style="font-size:22px;margin-top:36px">{h}</h2>{t}' for h, t in sections)
    return f'''
<div class="page-head"><div class="wrap">
  <span class="eyebrow"><span class="dot"></span>Legal</span>
  <h1 style="font-size:clamp(30px,4vw,44px)">{title}</h1>
  <p>Last updated: {UPDATED}</p>
</div></div>
<section style="padding-top:48px"><div class="wrap legal-doc" style="max-width:820px">
  <p>{intro}</p>{body}
</div></section>'''


P = lambda *ps: "".join(f"<p>{p}</p>" for p in ps)
UL = lambda *li: "<ul>" + "".join(f"<li>{x}</li>" for x in li) + "</ul>"

PRIVACY = legal("Privacy Policy",
    "This Privacy Policy explains how LeaseRun (&ldquo;LeaseRun,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects, uses and shares personal information when you visit leaserun.com or contact us. We do not sell your personal information.",
    [("Information we collect",
      P("<b>Information you provide.</b> When you subscribe to our deal sheet, request a portfolio audit or start owner onboarding, we collect what you enter, such as your name, email address, phone number, investment budget, available capital, timeline, number of properties owned and any notes you include.",
        "<b>Information collected automatically.</b> Our hosting provider records standard technical data such as IP address, browser type, pages visited and timestamps for security and performance. We do not use advertising cookies. Your browser may store a small preference so that our newsletter pop-up is not shown repeatedly.")),
     ("How we use information",
      UL("Respond to your inquiry and provide the services you request",
         "Send the weekly deal sheet and related investment and property-management information you asked for",
         "Evaluate investment fit and prepare underwriting materials",
         "Operate, secure and improve our website",
         "Comply with legal obligations, including fair housing, consumer reporting and recordkeeping laws")),
     ("How we share information",
      P("We share personal information only with service providers that help us operate (for example, website hosting, database and email delivery providers) under contracts that restrict their use of it; with lenders, title companies, inspectors or other parties when you ask us to proceed with a transaction; and when required by law or to protect our rights. We do not sell or rent personal information, and we do not share it for cross-context behavioral advertising.")),
     ("Tenant screening data",
      P("If you apply to rent a property we manage, consumer reports are obtained only with your authorization and are handled in accordance with the Fair Credit Reporting Act (FCRA). If we take adverse action based on a consumer report, you will receive the notices the FCRA requires.")),
     ("Email preferences",
      P("Every marketing email includes a one-click unsubscribe link. You can also email us at any time to stop receiving messages. Transactional messages about an active engagement may continue.")),
     ("Data retention and security",
      P("We keep personal information only as long as needed for the purposes above or as required by law. Data is transmitted over encrypted (TLS) connections and stored with access controls limited to authorized personnel. No method of transmission or storage is completely secure, but we work to protect your information.")),
     ("Your privacy rights",
      P("Depending on where you live (including California, Colorado, Connecticut, Virginia, Texas and other states with consumer privacy laws), you may have the right to know what personal information we hold about you, to access, correct or delete it, to obtain a copy, and to opt out of the sale or sharing of personal information or targeted advertising. We do not sell or share personal information as those terms are defined in these laws. To exercise any right, email us; we will verify your request and respond within the time required by law. We will not discriminate against you for exercising your rights. You may use an authorized agent where permitted.")),
     ("Children",
      P("Our services are intended for adults. We do not knowingly collect personal information from anyone under 18.")),
     ("Changes and contact",
      P(f'We may update this policy and will revise the date above when we do. Questions or requests: <a href="mailto:{EMAIL}?subject=Privacy%20Request">{EMAIL}</a>.'))])

TERMS = legal("Terms of Use",
    "These Terms of Use govern your use of leaserun.com. By using the site you agree to these terms. If you do not agree, please do not use the site.",
    [("Informational purpose only",
      P("Content on this site, including deal sheets, sample properties, calculators, projections, cap rates, cash-on-cash returns and market commentary, is provided for general information. It is not investment, tax, legal or accounting advice, and it is not an offer to sell or a solicitation of an offer to buy any security.")),
     ("Projections and sample deals",
      P("All projections are estimates based on stated assumptions and may differ materially from actual results. Sample properties illustrate our underwriting format and may not be available. Past or projected performance does not guarantee future results. Real estate investing involves risk, including loss of capital, vacancy, unexpected repairs, changes in interest rates and changes in law.")),
     ("Your responsibilities",
      P("You are responsible for your own investment decisions and for obtaining independent advice from qualified professionals, including a CPA, attorney and, for 1031 exchanges, a Qualified Intermediary. You agree to provide accurate information and not to misuse the site, interfere with its operation, or attempt to access data you are not authorized to access.")),
     ("Services and agreements",
      P("Brokerage, acquisition and property-management services are provided only under separate written agreements, which control over anything on this site. Guarantees described on this site are subject to the terms, limits and eligibility requirements in those agreements.")),
     ("Fair housing",
      P("LeaseRun is committed to equal housing opportunity and complies with the Federal Fair Housing Act and applicable state and local laws.")),
     ("Intellectual property",
      P("The LeaseRun name, logo, site design and content are owned by LeaseRun or its licensors. You may view and print pages for personal, non-commercial use. Any other use requires our written permission.")),
     ("Third-party links",
      P("Links to third-party sites are provided for convenience. We are not responsible for their content or practices.")),
     ("Disclaimer and limitation of liability",
      P("The site is provided &ldquo;as is&rdquo; without warranties of any kind. To the fullest extent permitted by law, LeaseRun is not liable for any indirect, incidental, consequential or punitive damages, or for any loss arising from reliance on information on this site.")),
     ("Changes and contact",
      P(f'We may update these terms at any time by posting a revised version. Questions: <a href="mailto:{EMAIL}">{EMAIL}</a>.'))])

NOT_FOUND = '''
<section class="dark" style="padding:120px 0;text-align:center">
  <div class="wrap">
    <span class="eyebrow"><span class="dot"></span>404</span>
    <h1 style="font-size:clamp(32px,5vw,52px)">This listing is off the market.</h1>
    <p style="color:#B8C3DB;max-width:520px;margin:12px auto 28px">The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.</p>
    <div class="hero-ctas" style="justify-content:center"><a href="/" class="btn btn-primary">Back to Home</a><a href="/properties" class="btn btn-ghost">Browse Sample Deals</a></div>
  </div>
</section>'''

LEGAL_CSS = '''<style>
.legal-doc p,.legal-doc li{color:var(--muted-dark);font-size:16px;margin-top:12px}
.legal-doc ul{margin:12px 0 0 20px}
.legal-doc a{color:#119767;font-weight:600}
</style>
'''

# ------------------------------------------------------------------ admin page
ADMIN = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Leads | LeaseRun Admin</title>
<link rel="icon" type="image/png" href="/favicon.png">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Montserrat:wght@700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<style>
body{background:var(--paper)}
.bar{background:var(--ink);border-bottom:1px solid var(--line)}
.bar .wrap{display:flex;align-items:center;justify-content:space-between;height:60px;max-width:1400px}
.bar img{height:32px}
.bar button{background:none;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 12px;cursor:pointer;font:inherit;font-size:13px}
.awrap{max-width:1400px;margin:0 auto;padding:28px 20px 60px}
.login{max-width:400px;margin:80px auto;background:#fff;border:1px solid var(--line-light);border-radius:16px;padding:30px}
.login h1{font-size:24px;margin:0 0 6px}
.login p{color:var(--muted-dark);font-size:14px;margin-bottom:18px}
.msg{display:none;margin-top:12px;padding:10px 12px;border-radius:10px;font-size:14px;font-weight:600;background:rgba(229,72,77,.1);color:#C8343A}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.kpis div{background:#fff;border:1px solid var(--line-light);border-radius:12px;padding:14px 16px}
.kpis span{display:block;font-size:12px;color:var(--muted-dark);text-transform:uppercase;letter-spacing:.06em}
.kpis b{font-family:var(--mono);font-size:26px}
.tools{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.tools input,.tools select{width:auto;flex:1;min-width:160px;padding:10px 12px}
.tools button{flex:0 0 auto}
.tbl{overflow-x:auto;background:#fff;border:1px solid var(--line-light);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:11px 12px;text-align:left;border-bottom:1px solid var(--line-light);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-dark);background:var(--paper);white-space:nowrap;position:sticky;top:0}
td small{display:block;color:var(--muted-dark);font-size:12px}
td.notes{max-width:280px;white-space:pre-wrap;color:var(--muted-dark)}
td select{padding:6px 8px;font-size:13px;width:auto}
.src{display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:#E7F8F1;color:#0E7A54;white-space:nowrap}
.empty-row{text-align:center;color:var(--muted-dark);padding:40px}
@media (max-width:760px){.kpis{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="bar"><div class="wrap"><a href="/"><img src="/logo.png" alt="LeaseRun"></a><button id="logout" hidden>Log out</button></div></div>

<div id="login" class="login">
  <h1>Lead Dashboard</h1>
  <p>Enter the admin password to view and manage website leads.</p>
  <form id="lf"><input id="pw" type="password" placeholder="Admin password" autocomplete="current-password" required>
  <button class="btn btn-primary" style="width:100%;margin-top:12px">Sign In</button></form>
  <div class="msg" id="lmsg"></div>
</div>

<div id="app" class="awrap" hidden>
  <div class="kpis">
    <div><span>Total leads</span><b id="k-total">0</b></div>
    <div><span>New</span><b id="k-new">0</b></div>
    <div><span>Last 7 days</span><b id="k-7d">0</b></div>
    <div><span>Qualified + won</span><b id="k-q">0</b></div>
  </div>
  <div class="tools">
    <input id="q" placeholder="Search name, email, notes&hellip;">
    <select id="fs"><option value="">All sources</option><option value="deal-sheet-modal">Deal sheet (pop-up)</option><option value="deal-sheet-footer">Deal sheet (footer)</option><option value="investor-intake">Portfolio audit</option></select>
    <select id="fst"><option value="">All statuses</option><option>new</option><option>contacted</option><option>qualified</option><option>won</option><option>lost</option></select>
    <button class="btn btn-sm btn-dark" id="refresh">Refresh</button>
    <button class="btn btn-sm btn-primary" id="csv">Export CSV</button>
  </div>
  <div class="tbl"><table>
    <thead><tr><th>Received</th><th>Contact</th><th>Source</th><th>Interest</th><th>Budget / Capital</th><th>Timeline</th><th>Doors</th><th>Notes</th><th>Status</th></tr></thead>
    <tbody id="rows"></tbody>
  </table></div>
</div>

<script>
(function () {
  const API = '__ADMIN_API__';
  const $ = s => document.querySelector(s);
  const STAT = ['new', 'contacted', 'qualified', 'won', 'lost'];
  const SRC = { 'deal-sheet-modal': 'Deal sheet', 'deal-sheet-footer': 'Deal sheet', 'investor-intake': 'Portfolio audit' };
  let leads = [];
  const store = { get() { try { return sessionStorage.getItem('lr_admin') || ''; } catch (e) { return ''; } },
                  set(v) { try { v ? sessionStorage.setItem('lr_admin', v) : sessionStorage.removeItem('lr_admin'); } catch (e) {} } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function call(body) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ password: store.get() }, body)) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || res.status); e.code = data.error; throw e; }
    return data;
  }
  function showMsg(t) { const m = $('#lmsg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; }

  async function load() {
    try {
      const d = await call({ action: 'list' });
      leads = d.leads || [];
      $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
      render();
    } catch (e) {
      $('#app').hidden = true; $('#login').hidden = false; $('#logout').hidden = true;
      if (e.code === 'not_configured') showMsg('Admin password is not set yet. In Supabase open Edge Functions > Secrets and add LEASERUN_ADMIN_PASSWORD (at least 8 characters).');
      else if (e.code === 'unauthorized') { showMsg(store.get() ? 'Wrong password.' : ''); store.set(''); }
      else showMsg('Could not load leads. Please try again.');
    }
  }

  function filtered() {
    const q = $('#q').value.trim().toLowerCase(), fs = $('#fs').value, fst = $('#fst').value;
    return leads.filter(l => (!fs || l.source === fs) && (!fst || l.status === fst) &&
      (!q || [l.first_name, l.last_name, l.email, l.phone, l.notes, l.interest].join(' ').toLowerCase().includes(q)));
  }

  function render() {
    const wk = Date.now() - 7 * 864e5;
    $('#k-total').textContent = leads.length;
    $('#k-new').textContent = leads.filter(l => l.status === 'new').length;
    $('#k-7d').textContent = leads.filter(l => new Date(l.created_at) > wk).length;
    $('#k-q').textContent = leads.filter(l => l.status === 'qualified' || l.status === 'won').length;
    const rows = filtered();
    $('#rows').innerHTML = rows.length ? rows.map(l => `<tr>
      <td>${esc(new Date(l.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}<small>${esc(l.page || '')}</small></td>
      <td><b>${esc([l.first_name, l.last_name].filter(Boolean).join(' ') || '—')}</b><small><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></small>${l.phone ? `<small><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a></small>` : ''}</td>
      <td><span class="src">${esc(SRC[l.source] || l.source)}</span></td>
      <td>${esc(l.interest || '—')}</td>
      <td>${esc(l.budget || l.capital || '—')}</td>
      <td>${esc(l.timeline || '—')}</td>
      <td>${esc(l.doors || '—')}</td>
      <td class="notes">${esc(l.notes || '')}</td>
      <td><select data-id="${esc(l.id)}">${STAT.map(s => `<option${s === l.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty-row">No leads yet. They appear here as soon as someone submits a form on the site.</td></tr>';
  }

  $('#rows').addEventListener('change', async e => {
    const sel = e.target.closest('select[data-id]'); if (!sel) return;
    const lead = leads.find(l => l.id === sel.dataset.id), prev = lead.status;
    lead.status = sel.value; render();
    try { await call({ action: 'update', id: lead.id, status: lead.status }); }
    catch (x) { lead.status = prev; render(); alert('Could not update status.'); }
  });
  ['#q', '#fs', '#fst'].forEach(s => $(s).addEventListener('input', render));
  $('#refresh').addEventListener('click', load);
  $('#csv').addEventListener('click', () => {
    const cols = ['created_at', 'source', 'status', 'first_name', 'last_name', 'email', 'phone', 'interest', 'budget', 'capital', 'timeline', 'doors', 'notes', 'page'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = [cols.join(',')].concat(filtered().map(l => cols.map(c => q(l[c])).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'leaserun-leads-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  });
  $('#lf').addEventListener('submit', e => { e.preventDefault(); store.set($('#pw').value); $('#pw').value = ''; showMsg(''); load(); });
  $('#logout').addEventListener('click', () => { store.set(''); leads = []; $('#app').hidden = true; $('#login').hidden = false; $('#logout').hidden = true; });
  if (store.get()) load();
})();
</script>
</body>
</html>
'''


# ------------------------------------------------------- iPhone icon (stdlib)
def _read_png(path):
    d = path.read_bytes()
    pos, idat, plte, trns = 8, b"", b"", b""
    while pos < len(d):
        n, t = struct.unpack(">I4s", d[pos:pos + 8])
        c = d[pos + 8:pos + 8 + n]
        if t == b"IHDR": w, h, depth, ctype = struct.unpack(">IIBB", c[:10])
        elif t == b"PLTE": plte = c
        elif t == b"tRNS": trns = c
        elif t == b"IDAT": idat += c
        pos += 12 + n
    assert depth == 8 and ctype == 3, "expects 8-bit palette PNG"
    raw, stride, rows, prev = zlib.decompress(idat), w, [], bytearray(w)
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - 1] if x else 0; b = prev[x]; c = prev[x - 1] if x else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    pal = [tuple(plte[i * 3:i * 3 + 3]) + (trns[i] if i < len(trns) else 255,) for i in range(len(plte) // 3)]
    return w, h, [[pal[i] for i in r] for r in rows]


def _write_png(path, w, h, px):
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in px)
    chunk = lambda t, c: struct.pack(">I", len(c)) + t + c + struct.pack(">I", zlib.crc32(t + c) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def make_touch_icon(out, size=180, bg=(12, 26, 53)):
    w, h, px = _read_png(ROOT / "logo.png")
    cols = [any(px[y][x][3] > 40 for y in range(h)) for x in range(w)]
    x0 = cols.index(True); x1 = x0
    while x1 < w and (cols[x1] or any(cols[x1:x1 + 6])): x1 += 1  # mark ends at first wide gap
    rows = [y for y in range(h) if any(px[y][x][3] > 40 for x in range(x0, x1))]
    y0, y1 = rows[0], rows[-1] + 1
    mw, mh = x1 - x0, y1 - y0
    scale = (size * 0.72) / max(mw, mh)
    ox, oy = (size - mw * scale) / 2, (size - mh * scale) / 2
    out_px = []
    for Y in range(size):
        row = []
        for X in range(size):
            # 3x3 supersampling for smooth edges
            acc = [0.0, 0.0, 0.0]
            for sy in (0.17, 0.5, 0.83):
                for sx in (0.17, 0.5, 0.83):
                    u, v = (X + sx - ox) / scale, (Y + sy - oy) / scale
                    if 0 <= u < mw and 0 <= v < mh:
                        r, g, b, a = px[y0 + int(v)][x0 + int(u)]; a /= 255
                    else:
                        r = g = b = 0; a = 0
                    acc[0] += r * a + bg[0] * (1 - a); acc[1] += g * a + bg[1] * (1 - a); acc[2] += b * a + bg[2] * (1 - a)
            row.append(tuple(int(c / 9 + .5) for c in acc))
        out_px.append(row)
    _write_png(out, size, size, out_px)


# ------------------------------------------------------------------------ main
def main():
    pages = {
        "privacy.html": ("Privacy Policy | LeaseRun", "How LeaseRun collects, uses and protects your personal information.", "/privacy", PRIVACY),
        "terms.html": ("Terms of Use | LeaseRun", "Terms governing use of the LeaseRun website.", "/terms", TERMS),
        "404.html": ("Page Not Found | LeaseRun", "The page you are looking for could not be found.", "/404", NOT_FOUND),
    }
    for name, (title, desc, path, body) in pages.items():
        html = build.head(title, desc, path, False) + body + build.foot()
        html = html.replace("</head>", LEGAL_CSS + "</head>", 1)
        if name == "404.html":
            html = html.replace("<head>", '<head>\n<meta name="robots" content="noindex">', 1)
        (DIST / name).write_text(html, encoding="utf-8")

    (DIST / "admin.html").write_text(ADMIN.replace("__ADMIN_API__", ADMIN_API), encoding="utf-8")

    # Footer + consent links now point at the real legal pages
    for page in DIST.glob("*.html"):
        html = page.read_text(encoding="utf-8")
        html = html.replace('<a href="/about-contact#compliance">Privacy</a>', '<a href="/privacy">Privacy</a>')
        html = html.replace('<a href="/about-contact#compliance">Terms</a>', '<a href="/terms">Terms</a>')
        html = html.replace("you agree to our Privacy Policy.", 'you agree to our <a href="/privacy" style="text-decoration:underline">Privacy Policy</a>.')
        page.write_text(html, encoding="utf-8")

    make_touch_icon(DIST / "apple-touch-icon.png")

    (DIST / "robots.txt").write_text("User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://leaserun.com/sitemap.xml\n")
    urls = ["/", "/properties", "/property-management", "/about-contact", "/privacy", "/terms"]
    (DIST / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                      + "".join(f"<url><loc>https://leaserun.com{u}</loc></url>" for u in urls) + "</urlset>\n")
    print("extra: privacy, terms, 404, admin, apple-touch-icon, robots, sitemap")


if __name__ == "__main__":
    main()
