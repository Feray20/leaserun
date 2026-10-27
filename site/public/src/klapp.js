// Collapsible texts: long explanations stay complete but are collapsed and labeled by kind
// (e.g. "Legal note", "Tip", "Financing explained"). Tapping the row opens the text. Applies to all pages and areas
// (consumer app, business portal, Web-Admin, calculators) – also to content created by scripts.
// Excluded: legal pages and Learn articles (there the text is the content), error messages and notes that must be fully
// visible at once (role=alert/status, aria-live), forms, tables, navigation. Single blocks can opt out with data-noklapp.
(() => {
  if (window.__iaKlapp) return;
  window.__iaKlapp = true;
  const P = location.pathname.replace(/\/+$/, '') || '/';
  if (/^\/(impressum|datenschutz|nutzungsbedingungen|widerrufen|kuendigen|sicherheit|legal-notice|privacy|terms|refund|cancel|security)$/.test(P)) return;
  if (/^\/(wissen|learn)\/(?!glossar$|erwerbsstatus$)[a-z0-9-]+$/.test(P)) return;
  // Guide articles and the approval-odds checker: the text is the content – collapse nothing.
  if (/^\/(ratgeber|guides)(\/[a-z0-9-]+)?$/.test(P) || P === '/calculators/approval-odds') return;

  const MIN = 140; // collapse from this text length on
  const BLOCK = new Set(['P', 'DIV', 'UL', 'OL', 'DL', 'TABLE', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'DETAILS', 'SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'LABEL', 'FIGURE', 'IMG', 'SVG', 'CANVAS', 'IFRAME', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIELDSET', 'VIDEO', 'A']);
  const SKIP = 'nav,header,footer,summary,label,button,table,form,dialog form,pre,code,[contenteditable],[role=alert],[role=status],[aria-live],.toast,.auth-message,.lr-legal,.mobile-nav,[class*=hero],.wl-prev,.wl-mail,.sim,[data-noklapp],.lr-kl-btn,.lr-kl,.lt-body,.lt-qa,.bw,.glossar,.gl-item,.route-accordion,.lr-gate-box';
  const leaf = (el) => { for (const c of el.children) { if (BLOCK.has(c.tagName) && !(c.tagName === 'A' && c.textContent.length < 80)) return false; } return true; };

  // Classify by content – a short, factual heading for the collapsed row (German patterns kept for older content).
  const CATS = [
    [/not (a |an )?(lender|broker|loan|financial|tax|legal|investment|credit)|no (loan|lending|tax|legal|investment|financial) advice|not (legal|tax|financial|investment) advice|loan (approval|commitment)|liabilit|no guarantee|does not replace|for (education|information)al purposes|nmls|keine (kredit|anlage|rechts|steuer|finanzierungs)/i, 'Legal note', 'legal'],
    [/privacy|ccpa|cpra|encrypt|stored|storage|password|sign[- ]in|datenschutz/i, 'Privacy & security', 'safe'],
    [/watermark|demo|plan\b|subscription|free\b|unlocked|invoice|receipt/i, 'What is included', 'plan'],
    [/\btax|depreciation|schedule e|1031|capital gains|irs|cpa\b/i, 'Tax background', 'tax'],
    [/e\.g\.|for example|example|sample case/i, 'Example', 'ex'],
    [/\btip\b|recommend|best to|make sure|watch out/i, 'Tip', 'tip'],
    [/lender|loan|mortgage|interest|rate|financ|amortiz|ltv|down payment|closing/i, 'Financing explained', 'fin'],
    [/yield|cash flow|cash-on-cash|rent|price|metric|dscr|cap rate|noi/i, 'Metrics explained', 'kpi'],
  ];
  const ICON = {
    legal: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M12 8v5M12 16v.5"/>',
    safe: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    plan: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    tax: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    ex: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/>',
    tip: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
    fin: '<path d="M3 10l9-6 9 6"/><path d="M5 10v9M19 10v9M9.5 10v9M14.5 10v9M3 21h18"/>',
    kpi: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  };
  const category = (txt) => { for (const [re, label, ic] of CATS) if (re.test(txt)) return [label, ic]; return ['Explanation', 'info']; };
  const svg = (k) => `<svg class="lr-kl-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

  // Styling once – overrides the former two-line view in all stylesheets.
  const css = document.createElement('style');
  css.textContent = `.lr-kl-host.lr-kl-host{display:block}
.lr-kl-host>.lr-kl-btn.lr-kl-btn{display:flex;align-items:center;gap:10px;width:100%;min-height:46px;margin:0;padding:11px 14px;border:1px solid #E2E8F0;border-radius:12px;background:rgba(248,250,252,.92);color:#0F2C59;font:inherit;font-size:14.5px;font-weight:700;line-height:1.3;text-align:left;cursor:pointer;text-decoration:none;-webkit-tap-highlight-color:transparent;transition:background .15s,border-color .15s}
.lr-kl-host>.lr-kl-btn.lr-kl-btn:hover{background:#F1F5F9;border-color:#CBD5E1;text-decoration:none}
.lr-kl-host>.lr-kl-btn .lr-kl-ic{flex:none;color:#0284C7}
.lr-kl-host>.lr-kl-btn .lr-kl-lbl{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.lr-kl-host>.lr-kl-btn .lr-kl-cat{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0284C7;margin:0}
.lr-kl-host>.lr-kl-btn .lr-kl-sum{display:block;font-size:14.5px;font-weight:700;color:#0F2C59;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lr-kl-host>.lr-kl-btn[aria-expanded=true] .lr-kl-sum{display:none}
.lr-kl-host>.lr-kl-btn .lr-kl-chev{flex:none;color:#94A3B8;transition:transform .2s}
.lr-kl-host>.lr-kl-btn[aria-expanded=true]{border-bottom-left-radius:0;border-bottom-right-radius:0;background:#F1F5F9}
.lr-kl-host>.lr-kl-btn[aria-expanded=true] .lr-kl-chev{transform:rotate(180deg)}
.lr-kl-host>.lr-kl.lr-kl:not(.lr-kl-open){display:none!important}
.lr-kl-host>.lr-kl.lr-kl-open{display:block!important;-webkit-line-clamp:unset;overflow:visible;margin:0;padding:12px 14px 14px;border:1px solid #E2E8F0;border-top:0;border-radius:0 0 12px 12px;background:#fff;color:#334155;cursor:auto}
.lr-kl-host+.lr-kl-host{margin-top:8px}
@media print{.lr-kl-host>.lr-kl{display:block!important;border:0!important;padding:0!important}.lr-kl-host>.lr-kl-btn{display:none!important}}`;
  (document.head || document.documentElement).appendChild(css);

  const toggle = (el, btn, open) => {
    el.classList.toggle('lr-kl-open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  let n = 0;
  // Pre-rendered pages may still contain the old collapsed view ("Show more"): undo it, then classify again.
  const unbake = (root) => {
    // Remove all old states (also double-nested): drop buttons without a runtime marker, unwrap the content.
    for (const btn of root.querySelectorAll('.lr-kl-btn:not([data-rt])')) {
      const host = btn.parentElement; btn.remove();
      if (host) { host.classList.remove('lr-kl-host'); delete host.dataset.kl; }
    }
    for (const t of root.querySelectorAll('span.lr-kl')) {
      const prev = t.previousElementSibling;
      if (prev && prev.classList.contains('lr-kl-btn')) continue; // belongs to a runtime button
      while (t.firstChild) t.parentNode.insertBefore(t.firstChild, t); t.remove();
    }
  };
  const scan = () => {
    const root = document.querySelector('main') || document.body;
    unbake(root);
    for (const el of root.querySelectorAll('p, div, blockquote')) {
      if (el.dataset.kl) continue;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length < MIN) { continue; }
      if (!leaf(el) || el.parentElement?.closest(SKIP) || el.matches(SKIP)) { el.dataset.kl = 'x'; continue; }
      // Never collapse jump/link lists (table of contents, letter bar).
      { let lt = 0; for (const l of el.querySelectorAll('a')) lt += (l.textContent || '').trim().length; if (lt > txt.length * 0.5) { el.dataset.kl = 'x'; continue; } }
      if (!el.offsetParent || !el.clientWidth) continue; // still invisible – check again later
      // Show legal notes only once per page or view – the full note is in the footer anyway.
      if ((/\bnot (a |an )?[^.]{0,60}(advice|lender|broker|loan approval|loan commitment|credit decision)/i.test(txt) || /keine[^.]{0,90}(beratung|kreditvermittlung|kreditzusage|kreditentscheidung)/i.test(txt)) && !/^\/(intern|internal)/.test(location.pathname)) {
        const scope = el.closest('[data-view], .dash-card, article, section') || root;
        if (root.querySelector('[data-kl-legal]') || scope.querySelector('[data-kl-legal]')) { el.dataset.kl = 'x'; el.hidden = true; continue; }
        el.dataset.klLegal = '1';
      }
      const t = document.createElement('span');
      t.className = 'lr-kl';
      while (el.firstChild) t.appendChild(el.firstChild);
      el.dataset.kl = '1';
      el.classList.add('lr-kl-host');
      const id = t.id = 'lr-kl-' + (++n);
      const [label, ic] = category(txt);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lr-kl-btn';
      btn.dataset.rt = '1'; // created at runtime (pre-rendered old states without a marker are undone)
      btn.setAttribute('aria-controls', id);
      btn.setAttribute('aria-expanded', 'false');
      const ABBR = /(?:^|\s)(e\.g|i\.e|incl|approx|vs|etc|max|min|mo|yr|No|Sec|St|Ave|Dr|Mr|Ms|Mrs|U\.S|e|i|g)\.$/;
      let first = '';
      for (const part of txt.split(/(?<=[.!?:])\s+/)) { first += (first ? ' ' : '') + part; if (!ABBR.test(first)) break; }
      first = first.replace(/[.:]$/, '');
      const head = first.length > 64 ? first.slice(0, 62).replace(/\s+\S*$/, '') + ' …' : first;
      const escT = (x) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      btn.innerHTML = `${svg(ic)}<span class="lr-kl-lbl"><small class="lr-kl-cat">${label}</small><span class="lr-kl-sum">${escT(head)}</span></span><svg class="lr-kl-chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      el.appendChild(btn);
      el.appendChild(t);
    }
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.lr-kl-btn');
    if (btn) { const el = document.getElementById(btn.getAttribute('aria-controls')); if (el) toggle(el, btn, !el.classList.contains('lr-kl-open')); }
  });
  let t = 0;
  const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 600 }) : (f) => requestAnimationFrame(f);
  const later = () => { clearTimeout(t); t = setTimeout(() => idle(scan), 160); };
  const start = () => {
    scan();
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
    addEventListener('hashchange', later);
    document.addEventListener('click', later); // re-check opened areas (e.g. a tool was opened)
    addEventListener('resize', later);
    addEventListener('load', later);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('beforeprint', () => document.querySelectorAll('.lr-kl').forEach((el) => el.classList.add('lr-kl-open')));
})();

// "Show more" for whole sections (home page, portals): heading, kicker and one intro sentence stay visible;
// the rest opens on a button press. data-mehr="N" on a list (e.g. questions) shows only the first N entries.
(() => {
  if (window.__iaMehr) return;
  window.__iaMehr = true;
  if (!document.getElementById('iaMehrCss')) { const st = document.createElement('style'); st.id = 'iaMehrCss'; st.textContent = '[data-mehr-hid]{display:none!important}.lr-mehr-btn{display:flex;margin:14px auto 0;min-height:44px}'; document.head.append(st); }
  const btn = (label, onOpen) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost lr-mehr-btn'; b.textContent = label; b.setAttribute('aria-expanded', 'false'); b.onclick = () => { onOpen(); b.remove(); }; return b; };
  const run = () => {
    document.querySelectorAll('section[data-mehr]:not([data-mehr-done])').forEach((sec) => {
      sec.dataset.mehrDone = '1';
      const n = parseInt(sec.dataset.mehr, 10);
      if (n > 0) {
        const items = [...sec.querySelectorAll('[data-faq] > details, [data-mehr-list] > *')];
        if (items.length <= n + 1) return;
        const rest = items.slice(n); rest.forEach((e) => { e.dataset.mehrHid = '1'; });
        items[n - 1].parentElement.after(btn(`Show all ${items.length} questions`, () => rest.forEach((e) => { delete e.dataset.mehrHid; })));
        return;
      }
      const h = sec.querySelector('h2'); const box = sec.querySelector('.container') || sec;
      if (!h) return;
      const hidden = [];
      let node = h, lead = null;
      for (let s = h.nextElementSibling; s; s = s.nextElementSibling) { if (!lead && s.tagName === 'P') { lead = s; continue; } hidden.push(s); }
      for (let s = h.previousElementSibling; s; s = s.previousElementSibling) if (!/^(SPAN|SMALL)$/.test(s.tagName) && !s.classList.contains('kicker')) hidden.push(s);
      while (node.parentElement && node.parentElement !== box && node !== box) {
        const p = node.parentElement;
        for (const c of p.parentElement ? p.parentElement.children : []) if (c !== p && p.parentElement !== sec.parentElement) hidden.push(c);
        node = p;
      }
      // Level directly below the container: everything except the branch with the heading.
      const top = [...box.children].find((c) => c.contains(h));
      [...box.children].forEach((c) => { if (c !== top && !hidden.includes(c)) hidden.push(c); });
      const list = [...new Set(hidden)].filter((e) => !e.contains(h));
      if (!list.length) return;
      list.forEach((e) => { e.dataset.mehrHid = '1'; });
      const b = btn('Show more', () => list.forEach((e) => { delete e.dataset.mehrHid; }));
      (lead || h).after(b);
    });
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', run, { once: true }); else run();
  setTimeout(run, 1500);
  // Jump via link (#features, #faq …) to a collapsed section: show everything there right away.
  const openFor = (hash) => { try { const t = hash && document.querySelector(hash); t?.closest?.('section[data-mehr]')?.querySelector('.lr-mehr-btn')?.click(); } catch { /* invalid anchor */ } };
  addEventListener('hashchange', () => openFor(location.hash));
  document.addEventListener('click', (e) => { const a = e.target.closest?.('a[href^="#"]'); if (a) openFor(a.getAttribute('href')); });
  if (location.hash) setTimeout(() => openFor(location.hash), 50);
})();
