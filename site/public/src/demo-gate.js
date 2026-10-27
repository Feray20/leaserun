// Preview for non-customers: calculators run with sample values only, Learn shows general info only –
// the full answers (formula, legal basis, lender practice) are loaded from the server for paying customers only.
// menu.js detects customers (class lr-paid on <html>, cache lr-access); once set, everything is open.
(() => {
  if (window.__iaGate) return;
  window.__iaGate = true;
  const P = location.pathname.replace(/\/+$/, '') || '/';
  const CALC = /^\/calculators\/[a-z-]+$/.test(P) && P !== '/calculators/closing-costs';
  const WISSEN = (P === '/learn' || /^\/learn\/[a-z0-9-]+$/.test(P)) && !/^\/learn\/(glossar|glossary|erwerbsstatus|employment-types|warum-investieren|why-invest)$/.test(P);
  const MUSTER = P === '/sample-loan-package';
  if (!CALC && !WISSEN && !MUSTER) return;
  const root = document.documentElement;
  const cached = () => { try { return !!JSON.parse(localStorage.getItem('lr-access') || 'null')?.paid; } catch { return false; } };
  const paid = () => root.classList.contains('lr-paid') || cached();
  const user = () => root.classList.contains('lr-user');

  const css = document.createElement('style');
  css.textContent = `
  .lr-gate-box{display:none}
  html.lr-demo .lr-gate-box{display:grid;gap:8px;position:relative;margin:12px 0;padding:16px 18px;border-radius:14px;border:1px solid #BFDBFE;background:linear-gradient(135deg,#EFF6FF,#F8FAFC);color:#0F2C59;font:500 15px/1.5 Inter,system-ui,sans-serif}
  .lr-gate-box strong{font-size:16px}
  .lr-gate-box .lr-gate-act{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .lr-gate-box a.btn{min-height:44px}
  html.lr-demo .lr-demo-ctl{opacity:.75;cursor:not-allowed}
  html.lr-demo [data-gate-hid]{display:none!important}
  html.lr-demo .lr-gate-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;box-sizing:border-box;width:100%;margin:0 0 18px;padding:12px 16px}
  html.lr-demo .lr-gate-bar .btn{min-height:40px}
  html.lr-demo .wq-more{display:none!important}
  .wq-tag{display:none}
  html.lr-demo .wq-tag{display:block;width:fit-content;margin-top:6px;padding:1px 9px;border-radius:999px;font:600 12px/1.6 Inter,system-ui,sans-serif;font-style:normal;white-space:nowrap}
  html.lr-demo .wq-free{background:#DCFCE7;color:#166534}
  html.lr-demo .wq-lock{background:#EEF2FF;color:#3730A3}
  .wq-hook{display:none}
  html.lr-demo .wq-hook{display:block;margin:10px 0 4px;padding-left:12px;border-left:3px solid #93C5FD;color:#0F2C59;font-weight:600}
  .lr-gate-note{display:none}
  html.lr-demo .lr-gate-note{display:block;margin:8px 0 0;color:#475569;font-size:14px}
  .report > h2 .lr-gate-tag{display:inline-block;margin:0 0 0 8px;vertical-align:middle}
  html.lr-demo .report .route-a .lr-gate-hook{margin:4px 0 8px}`;
  document.head.append(css);

  // One short note at the top – and only there an "Unlock access" button (not repeated per entry).
  const OPEN = CALC ? 'every calculator with your own numbers – save, print, share.' : MUSTER ? 'the complete sample lender package and your own Lender Package.' : 'every answer with the short answer, next step, formula and legal basis.';
  const guide = () => {
    const d = document.createElement('div');
    d.className = 'lr-gate-box lr-gate-bar'; d.setAttribute('role', 'note');
    d.innerHTML = `<span><strong>Preview.</strong> Unlocked right away with access: ${OPEN}</span>
      <span class="lr-gate-act"><a class="btn btn-dark" href="/pricing">Unlock access</a>${user() ? '' : '<a class="ck-link" href="/auth/login">Already a customer? Sign in</a>'}</span>`;
    return d;
  };
  // Page intro as a small teaser (without access) – with access the normal text returns.
  const TEASE = WISSEN ? (P === '/learn' ? 'Answers in four stages – from "What can I afford?" to your lender meeting. Some answers are free samples; every answer with formula and legal basis comes with access.' : 'A question from the LeaseRun Learn center. The answer with formula, example and next step comes with access.')
    : MUSTER ? 'This is what LeaseRun prepares for your lender – key metrics and the first section as a preview, the PDFs as a sample.'
      : 'Run the sample case and see what the result looks like – with your own numbers once unlocked.';
  const heroText = (demo) => {
    const p = document.querySelector('.route-hero .container > p, .route-hero p');
    if (!p) return;
    if (demo) { if (p.dataset.orig === undefined) p.dataset.orig = p.textContent; if (p.textContent !== TEASE) p.textContent = TEASE; }
    else if (p.dataset.orig !== undefined) { p.textContent = p.dataset.orig; delete p.dataset.orig; }
  };
  const placeGuide = () => {
    const main = document.querySelector('main'); if (!main || main.querySelector('.lr-gate-bar')) return;
    const host = main.querySelector('.route-search, .calc-pages > .crumbs, .calc-pages, form[data-bcc], .ex-grid');
    const g = guide();
    if (host && host.classList.contains('crumbs')) host.after(g); else if (host && host.classList.contains('calc-pages')) host.prepend(g); else if (host) host.before(g); else main.prepend(g);
  };

  // ---------- Learn: the website shows only question, short answer and next step ----------
  // The full answer is not in the page source; customers load it from the server after signing in.
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lnk = (t) => esc(t).replace(/https:\/\/[^\s<]*[^\s<.,;)]/g, (u) => `<a class="ck-link" href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https:\/\/(www\.)?/, '')}</a>`);
  // Web-Admin settings (unlocking): which areas are preview-only without access. ('vorschau' = preview, 'offen' = open; stored values.)
  let GATE = { wissen: 'vorschau', rechner: 'vorschau', beispiele: 'vorschau' };
  // Fetch public settings (/api/site-config) robustly: wait at most 5 s, retry once after 2 s on error,
  // otherwise silently use the last stored value (sessionStorage) or built-in defaults. One request per page, shared with hinweis.js.
  const siteConfig = () => window.__iaCfgP || (window.__iaCfgP = (() => {
    const SK = 'lr-site-config';
    const once = () => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      return fetch('/api/site-config', { credentials: 'omit', signal: ac.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`site-config ${r.status}`)))).finally(() => clearTimeout(t));
    };
    return once().catch(() => new Promise((ok) => setTimeout(ok, 2000)).then(once))
      .then((c) => { try { sessionStorage.setItem(SK, JSON.stringify(c)); } catch { /* no storage */ } return c; })
      .catch(() => { try { return JSON.parse(sessionStorage.getItem(SK) || 'null') || {}; } catch { return {}; } });
  })());
  const areaOpen = () => (WISSEN && GATE.wissen === 'offen') || (CALC && GATE.rechner === 'offen') || (MUSTER && GATE.beispiele === 'offen');
  // Access per area (plan or individual unlock in the Web-Admin) – lr-open-wissen / -beispiele / -rechner from menu.js
  const granted = () => root.classList.contains('lr-open-' + (WISSEN ? 'wissen' : MUSTER ? 'beispiele' : 'rechner')) || (() => { try { const a = JSON.parse(localStorage.getItem('lr-access') || 'null'); return !!(a && (a.areas ? a.areas[WISSEN ? 'wissen' : MUSTER ? 'beispiele' : 'rechner'] : a.paid)); } catch { return false; } })();
  const full = () => granted() || areaOpen();
  let DET = null, detP = null, PREV = null, prevP = null;
  const tokenOf = () => { try { return JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null')?.access_token || ''; } catch { return ''; } };
  const loadDetails = () => (detP ||= (async () => {
    if (areaOpen()) { const r = await fetch('/api/wissen/vorschau'); if (!r.ok) throw new Error(String(r.status)); DET = new Map(((await r.json()).entries || []).map((e) => [e.q, e])); return; }
    const tok = tokenOf();
    if (!tok) throw new Error('login');
    const r = await fetch('/api/wissen/details', { headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    DET = new Map(((await r.json()).entries || []).map((e) => [e.q, e]));
  })().catch((e) => { detP = null; throw e; }));
  const loadPreview = () => (prevP ||= fetch('/api/wissen/vorschau').then((r) => r.json()).then((d) => { PREV = new Map((d.open ? [] : d.entries || []).map((e) => [e.q, e.t])); }).catch(() => { PREV = new Map(); }));
  const fillWissen = () => {
    const isFull = full();
    if (!isFull && !PREV) { loadPreview().then(fillWissen); return; }
    document.querySelectorAll('.wq-detail').forEach((el) => {
      const want = isFull ? (DET ? 'paid' : 'loading') : 'free';
      if (el.dataset.state === want) return;
      el.dataset.state = want;
      const host = el.closest('article, .wq-art');
      const tag = host?.querySelector('.wq-tag');
      host?.querySelector('.wq-teaser')?.remove();
      // Public short answer (static in the HTML): with access it is part of the full answer – hide it then, don't duplicate.
      const kurz = host?.querySelector('.wq-kurz');
      if (kurz) kurz.hidden = want === 'paid';
      if (want === 'free' && kurz) {
        if (tag) { tag.textContent = 'Short answer'; tag.className = 'wq-tag wq-free'; }
        el.innerHTML = `<p class="wq-hook">${esc(el.dataset.hook || 'The full answer shows the formula, an example and the next step.')}</p>`;
        return;
      }
      if (want === 'free') {
        const t = PREV.get(el.dataset.q);
        if (tag) { tag.textContent = t ? 'Free sample' : 'With access'; tag.className = 'wq-tag ' + (t ? 'wq-free' : 'wq-lock'); }
        el.innerHTML = `${t ? `<div class="callout wq-teaser"><strong>Free sample</strong><p>${esc(t)}</p></div>` : ''}<p class="wq-hook">${esc(el.dataset.hook || 'The full answer shows the formula, an example and the next step.')}</p>`;
        return;
      }
      if (tag) { tag.textContent = ''; tag.className = 'wq-tag'; }
      if (want === 'paid') { const e = DET.get(el.dataset.q) || {}; el.innerHTML = `<div class="callout"><strong>In short</strong><p>${lnk(e.l1 || '')}</p></div>${e.next ? `<div class="next"><strong>Next step:</strong> ${lnk(e.next)}</div>` : ''}${e.l2 ? `<h3 class="wq-h">In detail: formula, legal basis, lender practice</h3><p class="wq-l2">${lnk(e.l2)}</p>` : ''}`; return; }
      el.innerHTML = '<p class="form-note">Loading the answer …</p>';
      loadDetails().then(fillWissen).catch((e) => { el.dataset.state = 'err'; el.innerHTML = `<p class="form-note">${e.message === 'login' || e.message === '401' ? 'Please sign in again to see the answer.' : 'The answer could not be loaded right now. Please reload the page.'}</p>`; });
    });
  };

  // ---------- Calculators: show sample values, own input locked ----------
  const NOFREE = /csv|download|print|pdf|link to (the )?result|to (my )?account|save to account|copy/i;
  const lockCalc = () => {
    const main = document.querySelector('main'); if (!main) return;
    main.querySelectorAll('input:not([type=search]):not([data-gate]), select:not([data-gate]), textarea:not([data-gate])').forEach((el) => {
      if (el.closest('.cw-panel, .site-header, footer')) return;
      el.dataset.gate = el.disabled ? 'was' : '1'; el.disabled = true; el.classList.add('lr-demo-ctl');
    });
    main.querySelectorAll('button:not([data-gate]), a.btn:not([data-gate])').forEach((el) => {
      if (!NOFREE.test(el.textContent || '') || el.closest('.lr-gate-box')) return;
      el.dataset.gate = el.tagName === 'BUTTON' && el.disabled ? 'was' : '1';
      if (el.tagName === 'BUTTON') el.disabled = true; else { el.dataset.href = el.getAttribute('href') || ''; el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); }
      el.classList.add('lr-demo-ctl');
    });
  };
  // ---------- Sample lender package: metrics and first section as a preview, the rest with access ----------
  const lockMuster = () => {
    // Like Learn: all sections named, the first open as a sample, the others "With access".
    const rep = document.querySelector('main .report');
    if (rep && !rep.dataset.gateDone) {
      rep.dataset.gateDone = '1';
      // Sections as questions like in Learn: the first open as a sample, the others only show
      // what would be visible with access (content stays hidden).
      const arts = [...rep.querySelectorAll('.route-accordion > article')];
      arts.forEach((a, k) => {
        const tag = a.querySelector('.route-q .wq-tag');
        if (tag) { tag.textContent = k ? 'With access' : 'Free sample'; tag.className = 'wq-tag lr-gate-tag ' + (k ? 'wq-lock' : 'wq-free'); }
        if (!k) return;
        const body = a.querySelector('.route-a'); if (!body) return;
        [...body.children].forEach((el) => { el.dataset.gateHid = '1'; });
        const hook = document.createElement('p'); hook.className = 'wq-hook lr-gate-hook'; hook.textContent = a.dataset.hook || 'You can see this full section with access.';
        body.append(hook);
      });
      // Older layout (headings instead of questions): first section open, the rest hidden.
      if (!arts.length) [...rep.querySelectorAll(':scope > h2')].forEach((h, k) => {
        const tag = document.createElement('em'); tag.className = 'wq-tag lr-gate-tag ' + (k ? 'wq-lock' : 'wq-free'); tag.textContent = k ? 'With access' : 'Free sample';
        h.append(' ', tag);
        if (!k) return;
        const labels = [];
        for (let el = h.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
          if (el.matches('#print')) continue;
          el.querySelectorAll('tr').forEach((tr) => { const c = tr.querySelector('th, td'); const t = (c?.textContent || '').trim(); if (t && t.length < 40 && labels.length < 5) labels.push(t); });
          el.dataset.gateHid = '1';
        }
        // Small preview: what the section contains (labels only, no values).
        const note = document.createElement('p'); note.className = 'lr-gate-note lr-gate-sec';
        note.textContent = labels.length ? `Includes: ${labels.join(', ')} …` : 'Fully visible with access.';
        h.after(note);
      });
    }
    document.querySelectorAll('main .ex-grid a[href*="/api/mustermappe"]:not([href*="download"])').forEach((a) => {
      const box = a.parentElement; if (!box || box.nextElementSibling?.classList.contains('lr-gate-note')) return;
      const n = document.createElement('p'); n.className = 'lr-gate-note'; n.textContent = 'Viewing shows a sample – the full PDF comes with access.';
      box.after(n);
    });
    document.querySelectorAll('main #print:not([data-gate])').forEach((el) => {
      el.dataset.gate = '1'; el.classList.add('lr-demo-ctl');
      if (el.tagName === 'BUTTON') el.disabled = true; else { el.dataset.href = el.getAttribute('href') || ''; el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); }
    });
  };
  if (MUSTER) document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('a[href^="/api/mustermappe"]');
    if (!a || !granted() || areaOpen()) return;
    let tok = ''; try { tok = JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null')?.access_token || ''; } catch { /* ignore */ }
    if (!tok) return;
    e.preventDefault();
    const win = /download=1/.test(a.href) ? null : window.open('', '_blank');
    try {
      const r = await fetch(a.href, { headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' });
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob());
      if (win) win.location.href = url; else { const d = document.createElement('a'); d.href = url; d.download = /analyse/.test(a.href) ? 'LeaseRun_Sample_Property_Analysis.pdf' : 'LeaseRun_Sample_Lender_Package.pdf'; d.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { if (win) win.close(); location.href = a.href; }
  });
  const unlock = () => {
    document.querySelectorAll('[data-gate]').forEach((el) => {
      if (el.dataset.gate === '1') { if ('disabled' in el && el.tagName !== 'A') el.disabled = false; if (el.dataset.href !== undefined) { el.setAttribute('href', el.dataset.href); el.removeAttribute('aria-disabled'); delete el.dataset.href; } }
      el.classList.remove('lr-demo-ctl'); delete el.dataset.gate;
    });
    document.querySelectorAll('.lr-gate-bar, .lr-gate-more, .lr-gate-note, .lr-gate-hook').forEach((b) => b.remove());
    document.querySelectorAll('.lr-gate-tag').forEach((t) => { if (t.closest('.route-q')) { t.textContent = ''; t.className = 'wq-tag'; } else t.remove(); });
    document.querySelectorAll('[data-gate-done]').forEach((e) => { delete e.dataset.gateDone; });
    heroText(false);
    document.querySelectorAll('[data-gate-hid]').forEach((e) => { delete e.dataset.gateHid; });
  };

  // Learn content (also for customers) cannot be copied or printed: no selecting, copying, right-click or dragging.
  if (WISSEN) {
    const pc = document.createElement('style');
    pc.textContent = '.route-a,.wq-art{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}@media print{.route-a,.wq-art{display:none!important}main::after{content:"LeaseRun Learn content is available online only.";display:block;padding:24px;font:16px/1.5 sans-serif}}';
    document.head.append(pc);
    const guard = (e) => { if (e.target.closest?.('.route-a, .wq-art')) e.preventDefault(); };
    ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart'].forEach((ev) => document.addEventListener(ev, guard, true));
  }

  let on = false;
  const apply = () => {
    if (WISSEN) fillWissen();
    if (full()) { if (on || root.classList.contains('lr-demo')) { on = false; root.classList.remove('lr-demo'); unlock(); } return; }
    on = true; if (!root.classList.contains('lr-demo')) root.classList.add('lr-demo');
    placeGuide(); heroText(true);
    if (CALC) lockCalc();
    if (MUSTER) lockMuster();
  };
  const start = () => {
    apply();
    siteConfig().then((c) => { if (c && c.gate) { GATE = { ...GATE, ...c.gate }; detP = null; DET = null; document.querySelectorAll('.wq-detail').forEach((el) => { delete el.dataset.state; }); apply(); } }).catch(() => {});
    // Content is partly created by scripts and customer status arrives after the check – observe both.
    new MutationObserver(() => { if (on || WISSEN) apply(); }).observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
    new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
