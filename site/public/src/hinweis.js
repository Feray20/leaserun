// Privacy notice (CCPA/CPRA and other US state privacy laws). Default: LeaseRun sets no tracking cookies – then only a short,
// non-blocking notice. If Google Analytics 4 is turned on in the Web-Admin, it becomes a consent banner:
// Google Analytics loads only after "Allow"; "Decline" is equally prominent. Do Not Track / Global Privacy Control count as decline
// (GPC is honored as an opt-out of sale/sharing). The choice is stored locally (lr-ga = yes/no) and can be changed via
// window.iaConsent() (link in the privacy policy).
(() => {
  if (window.__iaHinweis) return;
  window.__iaHinweis = true;
  const KEY = 'lr-privacy-ok', GA = 'lr-ga';
  const P = location.pathname;
  const skip = /^\/(intern|internal|kasse|checkout|b2b-portal|business-portal|creator|creators|app|auth|datenraum|data-room|pruefen|review|verify)(\/|\.|$)/.test(P) || navigator.webdriver;
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* no storage */ } };
  const optOut = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  let gaId = null;
  // Fetch public settings (/api/site-config) robustly: wait at most 5 s, retry once after 2 s on error,
  // otherwise silently use the last stored value (sessionStorage) or built-in defaults. One request per page, shared with demo-gate.js.
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

  const loadGa = () => {
    if (!gaId) return;
    if (window.__iaGaOn) {
      // Consent given again after withdrawal in the same session: enable measurement again.
      window[`ga-disable-${gaId}`] = false;
      if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }
    window.__iaGaOn = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', gaId, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    const sc = document.createElement('script'); sc.async = true; sc.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(sc);
  };
  const dropGa = () => {
    // Withdrawal: stop an already loaded Google Analytics immediately (not only after reload), then remove its cookies.
    if (gaId) {
      window[`ga-disable-${gaId}`] = true;
      if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: 'denied' });
    }
    document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => /^_ga/.test(n)).forEach((n) => {
      const h = location.hostname.replace(/^www\./, '');
      [`${n}=; Max-Age=0; path=/`, `${n}=; Max-Age=0; path=/; domain=.${h}`].forEach((c) => { document.cookie = c; });
    });
  };

  const banner = (consent) => {
    if (document.getElementById('iaPriv')) return;
    if (consent && !document.getElementById('iaPrivCss')) {
      const st = document.createElement('style'); st.id = 'iaPrivCss';
      st.textContent = '.lr-priv-b{display:flex;gap:8px;flex:none}.lr-priv-no{flex:none;min-height:40px;padding:0 16px;border:1.5px solid #0F2C59;border-radius:10px;background:#fff;color:#0F2C59;font:inherit;font-weight:700;cursor:pointer}@media (max-width:420px){.lr-priv-b{width:100%}.lr-priv-b button{flex:1}}';
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.id = 'iaPriv';
    el.className = 'lr-priv';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', consent ? 'Analytics consent' : 'Privacy notice');
    el.setAttribute('data-noklapp', '');
    el.innerHTML = consent
      ? '<p><strong>Analytics with your consent.</strong> May we use Google Analytics (cookies, pseudonymous usage data) to see which pages are helpful? No advertising features, not linked to your account, no sale or sharing of personal information – you can change this anytime. <a href="/privacy#google-analytics">Details</a></p><span class="lr-priv-b"><button type="button" class="lr-priv-no">Decline</button><button type="button" class="lr-priv-ok">Allow</button></span>'
      : '<p><strong>No tracking cookies.</strong> LeaseRun only stores what is technically needed on your device for sign-in and your progress – no advertising, and we do not sell or share your personal information. <a href="/privacy">Privacy policy</a></p><button type="button" class="lr-priv-ok">Got it</button>';
    el.querySelector('.lr-priv-ok').onclick = () => { if (consent) { set(GA, 'yes'); loadGa(); } set(KEY, '1'); el.remove(); };
    const no = el.querySelector('.lr-priv-no'); if (no) no.onclick = () => { set(GA, 'no'); set(KEY, '1'); dropGa(); el.remove(); };
    document.body.appendChild(el);
  };
  window.iaConsent = () => { if (!gaId) { alert('LeaseRun currently does not use analytics cookies.'); return; } document.getElementById('iaPriv')?.remove(); banner(true); };

  // Privacy policy: show the Google Analytics section only when it is turned on.
  const legal = () => {
    document.querySelectorAll('[data-ga-on]').forEach((x) => { x.hidden = !gaId; });
    document.querySelectorAll('[data-ga-off]').forEach((x) => { x.hidden = Boolean(gaId); });
    document.querySelectorAll('[data-ga-consent]').forEach((x) => { x.onclick = (e) => { e.preventDefault(); window.iaConsent(); }; });
  };

  const start = () => {
    if (skip) return;
    siteConfig().then((cfg) => {
      gaId = typeof cfg.ga === 'string' && /^G-[A-Z0-9]{4,14}$/.test(cfg.ga) ? cfg.ga : null;
      legal();
      if (gaId) {
        const c = get(GA);
        if (c === 'yes' && !optOut) { loadGa(); return; }
        if (c === 'no' || optOut || /^\/(datenschutz|impressum|privacy|legal-notice)/.test(P)) return;
        setTimeout(() => banner(true), 600);
        return;
      }
      if (get(KEY) || /^\/(datenschutz|impressum|privacy|legal-notice)/.test(P)) return;
      setTimeout(() => banner(false), 600);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// Busy signal: a button that is disabled during a task and ends in "…" (e.g. "Sending …") automatically gets the
// spinning LeaseRun ring – everywhere on the site, without changing individual forms.
(() => {
  if (window.__iaBusy) return;
  window.__iaBusy = true;
  const css = '.lr-busy{position:relative;cursor:progress!important;opacity:.9!important}.lr-busy::after{content:"";display:inline-block;width:1em;height:1em;margin-left:.55em;vertical-align:-.15em;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;opacity:.75;animation:iaBusySpin .75s linear infinite}@keyframes iaBusySpin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.lr-busy::after{animation-duration:2s}}';
  const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);
  const check = (b) => { const on = b.disabled && /…\s*$/.test(b.textContent || ''); b.classList.toggle('lr-busy', on); if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); };
  const scan = (root) => { if (root.nodeType !== 1) return; if (root.matches('button, .btn')) check(root); root.querySelectorAll?.('button:disabled').forEach(check); };
  const start = () => new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') check(m.target); else if (m.type === 'characterData') { const b = m.target.parentElement?.closest('button'); if (b) check(b); } else { const b = m.target.closest?.('button'); if (b) check(b); m.addedNodes.forEach(scan); } } })
    .observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

// Automatic cache clearing: after every update (new version on the server) caches and offline files on this device are
// cleared once and the page reloads – nobody has to clear the cache manually.
// Back button (mobile): pages restored from the back-forward cache with a stuck loading state are reloaded.
(() => {
  if (window.__iaFresh) return;
  window.__iaFresh = true;
  const KEY = 'lr-build', LAST = 'lr-build-at', LOOP = 'lr-build-reload';
  const get = (s, k) => { try { return s.getItem(k); } catch { return null; } };
  const set = (s, k, v) => { try { s.setItem(k, v); } catch { /* private mode */ } };
  const clearAll = async () => {
    try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
    try { const rs = await navigator.serviceWorker?.getRegistrations?.(); for (const r of rs || []) r.update().catch(() => {}); } catch { /* ignore */ }
  };
  const check = async (force) => {
    const now = Date.now();
    if (!force && now - Number(get(sessionStorage, LAST) || 0) < 60_000) return;
    set(sessionStorage, LAST, String(now));
    let v = '';
    try { const r = await fetch('/api/version', { cache: 'no-store' }); if (r.ok) v = (await r.json()).v || ''; } catch { return; }
    if (!v || v === 'dev') return;
    const old = get(localStorage, KEY);
    set(localStorage, KEY, v);
    if (!old || old === v) return;
    await clearAll();
    // Reload only once per version (no reload loops); never discard forms with input.
    if (get(sessionStorage, LOOP) === v) return;
    const typing = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea')].some((x) => x.value && x.defaultValue !== x.value);
    // Reload only right after opening; never interrupt during use (the new version then applies on the next page change).
    if (typing || performance.now() > 6000) return;
    set(sessionStorage, LOOP, v);
    location.reload();
  };
  if (document.readyState === 'complete') check(false); else addEventListener('load', () => check(false), { once: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(false); });
  const APPISH = /^\/(intern|internal|b2b-portal|business-portal|app|creator|creators|kasse|checkout|auth|karten\/konto|card\/account|datenraum|data-room)/;
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    // App areas always fresh (sign-in, data); elsewhere only when a loading/lock state got stuck.
    const stuck = document.querySelector('.lr-ld.full, .buy-ov, [aria-busy="true"], .lr-work, form[data-busy]');
    if (stuck || ((APPISH.test(location.pathname) || location.hostname.startsWith('admin.') || location.hostname.startsWith('partner.')) && (!window.__iaNeedReload || window.__iaNeedReload()))) location.reload();
    else check(true);
  });
})();

// Safety net against "scrolling/buttons don't work" (mainly mobile after Back or canceled tasks):
// lock classes without a matching open window are removed, orphaned loading overlays closed.
(() => {
  if (window.__iaUnstick) return;
  window.__iaUnstick = true;
  const LOCKS = [['menu-open', '.mobile-nav:not([hidden])'], ['pt-sheet-open', '#ptSheet:not([hidden])'], ['dk-open', '#faDeck'], ['lr-pdfv-open', '.lr-pdfv'], ['lr-working', '.lr-work']];
  let last = 0;
  const unstick = () => {
    const now = Date.now(); if (now - last < 400) return; last = now;
    const b = document.body; if (!b) return;
    for (const [c, sel] of LOCKS) if (b.classList.contains(c) && !document.querySelector(sel)) b.classList.remove(c);
    if ((b.style.overflow === 'hidden' || document.documentElement.style.overflow === 'hidden') && !document.querySelector('dialog[open], .lr-pdfv, .lr-work, #ptSheet:not([hidden]), .mobile-nav:not([hidden])')) { b.style.overflow = ''; document.documentElement.style.overflow = ''; }
  };
  ['hashchange', 'popstate', 'pageshow', 'focus'].forEach((e) => addEventListener(e, () => setTimeout(unstick, 50)));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') unstick(); });
  document.addEventListener('touchstart', unstick, { passive: true, capture: true });
})();

// Open order: subtle, dismissible note to resume (no pop-ups, no pressure, no countdown).
(() => {
  if (window.__iaKasseHint || /^\/(kasse|checkout|intern|internal|creator|creators)/.test(location.pathname)) return;
  window.__iaKasseHint = true;
  const q = new URLSearchParams(location.search);
  if (q.get('checkout') === 'success' || q.has('session_id')) { try { localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ } return; }
  let d = null; try { d = JSON.parse(localStorage.getItem('lr-kasse-open') || 'null'); } catch { return; }
  if (!d || !d.at || Date.now() - d.at > 23 * 3600_000 || d.summary?.kind === 'setup') { if (d) try { localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ } return; }
  // Show only shortly after leaving checkout (at most 4 minutes), then hide by itself. The order can still be resumed at /checkout.
  const SHOW_MS = 4 * 60_000, left = SHOW_MS - (Date.now() - (d.left || d.at));
  if (left <= 0) return;
  // Show only once per order (first page view or after sign-in) – not on every page change.
  const seenKey = 'lr-kasse-hint-seen';
  try { const k = String(d.left || d.at); if (localStorage.getItem(seenKey) === k) return; localStorage.setItem(seenKey, k); } catch { return; }
  const show = () => {
    const el = document.createElement('div');
    el.className = 'lr-kasse-hint'; el.setAttribute('role', 'status');
    el.innerHTML = '<span>Your order' + (d.summary?.title ? ' "' + String(d.summary.title).replace(/[<>&"]/g, '') + '"' : '') + ' is still open.</span><a href="/checkout">Resume</a><button type="button" aria-label="Dismiss">×</button>';
    // In the page flow at the top (not floating) – so it covers neither the chat button nor the action bar.
    el.style.cssText = 'position:relative;max-width:720px;margin:12px auto;width:calc(100% - 24px);box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;border-radius:14px;color:#fff;font:600 14px/1.35 Inter,system-ui,sans-serif;background:linear-gradient(135deg,#0F2C59,#2F7FC1);box-shadow:0 14px 40px -16px rgba(15,44,89,.6)';
    const a = el.querySelector('a'); a.style.cssText = 'margin-left:auto;background:#fff;color:#0F2C59;border-radius:999px;padding:8px 14px;text-decoration:none;white-space:nowrap';
    const x = el.querySelector('button'); x.style.cssText = 'background:none;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:4px 6px;min-width:36px;min-height:36px';
    x.onclick = () => el.remove();
    const host = document.querySelector('main') || document.body; host.prepend(el);
    setTimeout(() => el.remove(), left);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', show, { once: true }); else show();
})();

// Back button: continue exactly where you left a page (section, opened panels, scroll position).
// Applies to all pages; the consumer app restores its own state (same logic, see app-shell).
// An anchor is stored too (the tapped element with an id and its distance from the top), so the position is exact
// even if content is slightly taller or shorter when rebuilt.
(() => {
  if (window.__iaRet) return;
  window.__iaRet = true;
  const key = () => 'lr-ret:' + location.pathname + location.search;
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch { /* private mode */ } return null; };
  const anchorOf = (el) => {
    const a = el && el.closest && el.closest('[id]:not(html):not(body):not(main):not(#app):not(#portal):not(#intern)');
    return a ? { aid: a.id, ay: Math.round(a.getBoundingClientRect().top) } : {};
  };
  let clickAt = 0;
  const save = (from) => {
    try {
      const pt = from || document.elementFromPoint(innerWidth / 2, Math.min(140, innerHeight / 3));
      sessionStorage.setItem(key(), JSON.stringify({
        hash: location.hash, y: Math.round(scrollY), at: Date.now(), ...anchorOf(pt),
        open: [...document.querySelectorAll('details[open][data-topic]')].map((d) => d.dataset.topic),
        more: [...document.querySelectorAll('.lt-more:not([hidden])')].map((e) => e.id).filter(Boolean),
        det: [...document.querySelectorAll('details[open]')].map((d) => d.id).filter(Boolean),
        qa: [...document.querySelectorAll('.route-a:not([hidden])')].map((x) => x.previousElementSibling?.querySelector('strong')?.textContent || '').filter(Boolean),
        mehr: [...document.querySelectorAll('section[data-mehr]')].filter((x) => !x.querySelector('.lr-mehr-btn')).map((x) => x.id).filter(Boolean),
      }));
    } catch { /* private mode */ }
  };
  addEventListener('pagehide', () => { ss('lr-hid:' + location.pathname, String(Date.now())); if (Date.now() - clickAt > 4000) save(); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (a && !a.target && a.origin === location.origin && (a.pathname !== location.pathname || a.search !== location.search)) { clickAt = Date.now(); ss('lr-int-nav:' + location.pathname, String(clickAt)); save(a); }
  }, true);
  // Page from the back-forward cache: reload only when needed (returning from an external page like Stripe,
  // away for a long time or a stuck loading state). After an internal page change everything stays exactly as it was.
  window.__iaNeedReload = () => {
    const t = +ss('lr-int-nav:' + location.pathname) || 0, h = +ss('lr-hid:' + location.pathname) || 0;
    const internal = t && h && h - t > -1000 && h - t < 10000;
    const fresh = h && Date.now() - h < 30 * 60_000;
    const stuck = document.querySelector('.lr-ld.full, .buy-ov, #buyOverlay, .lr-work, form[data-busy]');
    return !(internal && fresh && !stuck);
  };
  addEventListener('pageshow', (e) => { if (e.persisted && window.__iaNeedReload()) ss('lr-ret-back', '1'); }, { capture: true });
  if (/^\/(app|auth)/.test(location.pathname)) return;
  let rec = null;
  try {
    const nav = performance.getEntriesByType?.('navigation')?.[0]?.type;
    const flag = ss('lr-ret-back');
    if (nav === 'back_forward' || flag) { sessionStorage.removeItem('lr-ret-back'); rec = JSON.parse(ss(key()) || 'null'); }
  } catch { rec = null; }
  // Newly opened page (link, bookmark, typed): always start at the top – unless a jump target (#…) is given.
  try {
    const nav = performance.getEntriesByType?.('navigation')?.[0]?.type;
    if (!rec && nav === 'navigate' && !location.hash) { history.scrollRestoration = 'manual'; const top = () => { if (scrollY > 0) window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }; top(); addEventListener('load', top, { once: true }); }
  } catch { /* ignore */ }
  if (!rec || Date.now() - rec.at > 2 * 3600_000 || !(rec.y > 0 || rec.aid)) return;
  if (rec.hash && rec.hash !== location.hash) { try { history.replaceState(null, '', location.pathname + location.search + rec.hash); dispatchEvent(new HashChangeEvent('hashchange')); } catch { /* ignore */ } }
  try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  // Keep adjusting for up to 12 s (content may load later on mobile); stop as soon as the user scrolls or taps.
  let stop = false, ok = 0;
  const end = () => { stop = true; };
  ['touchstart', 'wheel', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, end, { once: true, passive: true, capture: true }));
  const t0 = Date.now();
  const go = () => {
    if (stop || Date.now() - t0 > 12000) return;
    (rec.det || []).forEach((id) => { const d = document.getElementById(id); if (d && !d.open) d.open = true; });
    (rec.mehr || []).forEach((id) => document.getElementById(id)?.querySelector('.lr-mehr-btn')?.click());
    (rec.qa || []).forEach((q) => { const b = [...document.querySelectorAll('.route-q')].find((x) => x.querySelector('strong')?.textContent === q); const a = b?.nextElementSibling; if (b && a && a.hidden) b.click(); });
    const a = rec.aid && document.getElementById(rec.aid);
    const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const vis = !!(a && a.getClientRects().length);
    const want = vis ? Math.round(a.getBoundingClientRect().top + scrollY - (rec.ay || 0)) : rec.y;
    const top = Math.max(0, Math.min(want, maxY));
    if (Math.abs(scrollY - top) > 1) window.scrollTo({ top, left: 0, behavior: 'instant' });
    ok = ((rec.aid ? vis : maxY >= want) && Math.abs(scrollY - top) <= 2) ? ok + 1 : 0;
    if (ok < 4) setTimeout(go, 120);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => setTimeout(go, 30), { once: true }); else setTimeout(go, 30);
})();

// Load the preview gate (sample values / short answer) for calculators, Learn and the sample lender package.
(()=>{const p=location.pathname.replace(/\/+$/,'');if(/^\/(calculators\/[a-z-]+(\/[a-z-]+)?|learn(\/[a-z0-9-]+)?|sample-loan-package)$/.test(p)&&!document.querySelector('script[src*="demo-gate"]')){const s=document.createElement('script');const v=(document.currentScript&&document.currentScript.src.split('?v=')[1])||'';s.src='/src/demo-gate.js'+(v?'?v='+v:'');document.head.append(s)}})();
