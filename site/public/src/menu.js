if(/[#&]type=recovery(&|$)/.test(location.hash)&&location.pathname.indexOf('/auth/reset')!==0)location.replace('/auth/reset'+location.hash);
// Mobile menu for all pages: full-screen sheet below the header.
// Event delegation, so it also works on pages that build their content with a script.
(() => {
  const label = (btn, open) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    const t = btn.querySelector('.mm-text');
    if (t) t.textContent = open ? 'Close' : 'Menu';
  };
  const setOpen = (open) => {
    const btn = document.querySelector('.mobile-menu');
    const nav = document.querySelector('.mobile-nav');
    if (!btn || !nav) return;
    // Start the sheet right below the header (its height depends on the width).
    const head = btn.closest('header');
    if (open && head) nav.style.top = Math.max(0, Math.round(head.getBoundingClientRect().bottom)) + 'px';
    nav.hidden = !open;
    document.body.classList.toggle('menu-open', open);
    label(btn, open);
    if (open) nav.querySelector('a')?.focus({ preventScroll: true });
  };
  const mark = () => {
    const here = location.pathname.replace(/\/+$/, '') || '/';
    document.querySelectorAll('.mobile-nav a, .desktop-nav a').forEach((a) => {
      if ((a.getAttribute('href') || '').replace(/\/+$/, '') === here) a.setAttribute('aria-current', 'page');
    });
    const btn = document.querySelector('.mobile-menu');
    if (btn && !btn.querySelector('.mm-text')) {
      btn.innerHTML = '<span class="mm-icon" aria-hidden="true"></span><span class="mm-text">Menu</span>';
      btn.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.mobile-menu');
    if (btn) {
      e.preventDefault();
      setOpen(btn.getAttribute('aria-expanded') !== 'true');
      return;
    }
    if (e.target.closest('.mobile-nav a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
      setOpen(false);
      document.querySelector('.mobile-menu')?.focus();
    }
  });
  // Back button (page from the browser cache) and tab switches: never leave the menu stuck open.
  addEventListener('pageshow', () => setOpen(false));
  // Back from an external page (e.g. Stripe): the browser shows the page as it was when the user left –
  // with spinners, semi-transparent overlays and disabled buttons. Remove all of these transient states right away
  // so every button responds again.
  const unstick = () => {
    document.querySelectorAll('.lr-work, #buyOverlay, .buy-overlay').forEach((el) => el.remove());
    document.body?.classList.remove('lr-working', 'lr-switching', 'menu-open');
    document.documentElement.classList.remove('buy-busy');
    document.querySelectorAll('button[disabled][data-busy], button[disabled][data-flow], .btn.is-busy').forEach((b) => {
      if (b.hasAttribute('data-keep-disabled')) return;
      b.disabled = false; b.classList.remove('is-busy'); b.removeAttribute('aria-busy'); b.removeAttribute('data-busy');
    });
    document.querySelectorAll('[data-busy-msg]').forEach((m) => { m.textContent = ''; });
  };
  addEventListener('pageshow', (e) => { if (e.persisted) unstick(); });
  addEventListener('pagehide', () => setOpen(false));
  addEventListener('hashchange', () => setOpen(false));
  // Close the menu when switching to desktop width.
  matchMedia('(min-width: 901px)').addEventListener?.('change', (m) => m.matches && setOpen(false));
  // Pages that write their header with a script: mark the current link once it is built.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mark, 0));
  else setTimeout(mark, 0);
  new MutationObserver(() => { const b = document.querySelector('.mobile-menu'); if (b && !b.querySelector('.mm-text')) mark(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();

// Navigation by status: new visitors see "Log in". "Open app" and the app bar are shown only to paying
// customers (plan, business account) and administrators; signed-in users without a plan see "My account".
// The status is cached for 10 minutes.
(() => {
  const K = 'leaserun-auth-session-v1', C = 'lr-access', TTL = 10 * 60 * 1000;
  const root = document.documentElement;
  const sess = () => { try { return JSON.parse(localStorage.getItem(K) || 'null'); } catch { return null; } };
  const uid = (s) => s?.user?.id || String(s?.refresh_token || '').slice(-10);
  let state = { user: false, paid: false, b2b: false };
  // Business customers work in the business portal: there is no consumer app for them, the link goes to the portal.
  const portal = () => {
    if (B2B_PAGE) return;
    document.querySelectorAll('a[href="/app/dashboard"], a[data-app-link]').forEach((a) => {
      if (!a.dataset.appLink) { a.dataset.appLink = '1'; a.dataset.appOrig = a.textContent; }
      a.setAttribute('href', state.b2b ? '/business-portal' : '/app/dashboard');
      if (/Open app/.test(a.dataset.appOrig)) a.textContent = state.b2b ? 'Open portal' : a.dataset.appOrig;
    });
  };
  // Business pages (/business …): "Log in" goes straight to the business portal login, not to the consumer app.
  const B2B_PAGE = /^\/business\/?$/.test(location.pathname);
  const b2bLogin = () => {
    // Header: "My account" (as in the consumer area) – always leads to the business portal, never to the consumer app.
    document.querySelectorAll('.nav-actions a[href="/auth/login"], .nav-actions a[href="/business-portal"].b2b-login').forEach((a) => {
      a.setAttribute('href', '/business-portal'); a.textContent = 'My account'; a.classList.add('b2b-login', 'b2b-acc'); a.dataset.orig = a.dataset.orig || 'Log in';
      a.setAttribute('aria-label', 'My account – business portal');
    });
    // No second "My account" in the menu – the button already sits next to "Menu".
    document.querySelectorAll('.mobile-nav a[href="/auth/login"], .mobile-nav a.b2b-login').forEach((a) => a.remove());
    // No link to the consumer app on the business pages.
    document.querySelectorAll('.nav-actions a[href="/app/dashboard"], .mobile-nav a[href="/app/dashboard"]').forEach((a) => { a.hidden = true; });
  };
  const relabel = () => {
    if (B2B_PAGE) { b2bLogin(); return; }
    // Business login only on the business pages (/business), not in the consumer menu.
    document.querySelectorAll('.mobile-nav a.b2b-login').forEach((a) => a.remove());
    document.querySelectorAll('.nav-actions a[href="/auth/login"], .mobile-nav a[href="/auth/login"], a.nav-acc').forEach((a) => {
      const acc = state.user && !state.paid;
      if (!a.dataset.orig) a.dataset.orig = a.textContent;
      a.textContent = acc ? 'My account' : a.dataset.orig;
      a.classList.toggle('nav-acc', acc);
      a.setAttribute('href', acc ? '/app/dashboard#start' : '/auth/login');
    });
  };
  const apply = (st) => {
    state = st;
    root.classList.toggle('lr-user', !!st.user);
    root.classList.toggle('lr-paid', !!st.paid);
    // Per-area unlocks (Web-Admin → Users → Unlock access); keys come from /api/me/access.
    for (const k of ['wissen', 'beispiele', 'rechner']) root.classList.toggle('lr-open-' + k, !!(st.areas && st.areas[k]));
    relabel();
    portal();
  };
  const save = (st, s) => { try { localStorage.setItem(C, JSON.stringify({ ...st, at: Date.now(), uid: uid(s) })); } catch { /* ignore */ } };
  async function refresh(s) {
    try {
      const c = await (await fetch('/api/supabase-config')).json();
      const r = await fetch(c.url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: c.anonKey || c.key || c.publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
      if (!r.ok) return null;
      const d = await r.json();
      localStorage.setItem(K, JSON.stringify(d));
      return d;
    } catch { return null; }
  }
  async function check(force) {
    let s = sess();
    if (!s?.access_token) { apply({ user: false, paid: false }); try { localStorage.removeItem(C); } catch { /* ignore */ } return; }
    let c = null; try { c = JSON.parse(localStorage.getItem(C) || 'null'); } catch { c = null; }
    if (c && c.uid === uid(s)) apply({ user: !!c.user, paid: !!c.paid, b2b: !!c.b2b, areas: c.areas || null });
    else apply({ user: true, paid: false });
    if (!force && c && c.uid === uid(s) && Date.now() - c.at < TTL) return;
    const ask = (tok) => fetch('/api/me/access', { headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' });
    try {
      let r = await ask(s.access_token);
      if (r.status === 401 && s.refresh_token) { const n = await refresh(s); if (n) { s = n; r = await ask(n.access_token); } }
      if (r.status === 401) { apply({ user: false, paid: false }); return; }
      if (!r.ok) return; // network error: keep the current state
      const d = await r.json();
      const st = { user: !!d.loggedIn, paid: !!d.paid, b2b: !!d.b2b, areas: d.areas || null };
      apply(st); save(st, s);
    } catch { /* offline: keep the current state */ }
  }
  check(false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', relabel);
  // Pages that build their header with a script, and changes in other tabs.
  new MutationObserver(() => { if (document.querySelector('.nav-actions a[href="/auth/login"]:not([data-orig])')) relabel(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('storage', (e) => { if (e.key === K || e.key === C) check(e.key === K); });
  window.__iaAccess = { check: () => check(true) };
})();

// Report technical errors to LeaseRun (no personal data): message, file, line, page (without parameters), browser type.
// At most 5 per page view, each message once. Errors from browser extensions and third-party scripts are ignored.
// Harmless browser messages do not count: aborted page transitions (fast clicking) and aborted or offline fetches.
(function(){if(window.__iaErr)return;window.__iaErr=1;var sent={},n=0;function rep(m,s,l,c){try{m=String(m||'').slice(0,300);s=String(s||'');if(!m||n>=5||sent[m])return;if(/ResizeObserver loop|^Script error\.?$/i.test(m))return;if(s&&s.indexOf(location.origin)!==0&&!/^\/src\//.test(s))return;sent[m]=1;n++;var b=JSON.stringify({m:m,s:s.replace(location.origin,'').split('?')[0].slice(0,200),l:l|0,c:c|0,p:location.pathname.slice(0,120)});if(navigator.sendBeacon)navigator.sendBeacon('/api/errors',new Blob([b],{type:'application/json'}));else fetch('/api/errors',{method:'POST',headers:{'content-type':'application/json'},body:b,keepalive:true}).catch(function(){})}catch(e){}}
function harmless(r,m){try{var nm=(r&&r.name)||'';m=String(m||'');if((nm==='AbortError'||nm==='InvalidStateError'||/^(AbortError|InvalidStateError)\b/.test(m))&&/Transition was aborted|skipTransition\(\) was called|ViewTransition/i.test(m))return 1;if(nm==='AbortError'||/^AbortError\b|The user aborted a request|signal is aborted/i.test(m))return 1;if(navigator.onLine===false&&/Failed to fetch|Load failed|NetworkError/i.test(m))return 1}catch(e){}return 0}
// Page transition animation: silently catch aborted transitions (fast clicking) so no unhandled rejection is raised.
(function(){function vt(t){try{if(t)['finished','ready','updateCallbackDone'].forEach(function(k){if(t[k]&&t[k].catch)t[k].catch(function(){})})}catch(e){}}addEventListener('pageswap',function(e){vt(e&&e.viewTransition)});addEventListener('pagereveal',function(e){vt(e&&e.viewTransition)});vt(document.activeViewTransition);var S=document.startViewTransition;if(typeof S==='function'&&!S.__ia){var W=function(){var t=S.apply(document,arguments);vt(t);return t};W.__ia=1;document.startViewTransition=W}})();
function heal(m){try{if(!/dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Unable to preload CSS/i.test(m))return 0;var k='lr-heal:'+location.pathname;if(sessionStorage.getItem(k))return 0;sessionStorage.setItem(k,'1');rep('[self-healed] '+m,'',0,0);setTimeout(function(){location.reload()},80);return 1}catch(e){return 0}}
addEventListener('error',function(e){if(e&&e.message&&!harmless(e.error,e.message)&&!heal(e.message))rep(e.message,e.filename,e.lineno,e.colno)});addEventListener('unhandledrejection',function(e){var r=e&&e.reason,mm=(r&&r.message)||String(r||'Unhandled error');if(harmless(r,mm)||heal(mm))return;rep(mm,(r&&r.stack||'').split('\n').map(function(x){var mm=x.match(/(\/src\/[^\s):]+)/);return mm?mm[1]:''}).filter(Boolean)[0]||'',0,0)});(function(){var F=window.fetch;if(!F||F.__ia)return;var W=function(i,o){var r=F.apply(this,arguments);try{var a=document.createElement('a');a.href=typeof i==='string'?i:(i&&i.url)||'';var api=a.origin===location.origin&&/^\/api\//.test(a.pathname)&&!/^\/api\/(errors|a|geo|version|health|site-config)\b/.test(a.pathname),sb=/\.supabase\.co$/.test(a.hostname)&&/\/auth\/v1\//.test(a.pathname);if(api||sb)r.then(function(x){var s=x.status;if(api&&(s>=500||(s>=400&&s!==401&&s!==404&&/\/api\/(billing|kontakt|formular|termin|kuendigung|widerruf|newsletter|feedback|support|unterlagen|kreditmappe|b2b\/contact)/.test(a.pathname))))rep('API '+s+' · '+a.pathname,'',0,0);else if(sb&&(s>=500||s===429))rep('Sign-in '+s+' · '+a.pathname.replace(/^.*\/auth\/v1/,'/auth'),'',0,0)},function(){if(!api||(o&&o.signal&&o.signal.aborted)||window.__iaGone||navigator.onLine===false)return;setTimeout(function(){if(!window.__iaGone&&document.visibilityState!=='hidden'&&navigator.onLine!==false)rep('API offline · '+a.pathname,'',0,0)},1500)})}catch(e){}return r};W.__ia=1;window.fetch=W;addEventListener('pagehide',function(){window.__iaGone=1});addEventListener('beforeunload',function(){window.__iaGone=1})})();})();

// Load the cookieless first-party analytics.
(function(){if(window.iaTrack||document.querySelector('script[src="/src/track.js"]'))return;var t=document.createElement('script');t.src='/src/track.js';t.defer=true;document.head.appendChild(t)})();

// Contact widget (bottom right) on public pages; loads as a separate module.
(function(){if(window.__iaCw)return;window.__iaCw=1;if(/^\/(app|business-portal|internal|auth|partners|data-room|p|verify|review|cancel|refund|business|creators|files)(\/|$)/.test(location.pathname))return;var s=document.createElement('script');s.type='module';s.src='/src/contact-widget.mjs';document.head.appendChild(s)})();
// Newsletter signup box (checklist + rate update) on the homepages, Learn/Guides, Checklist, Deadlines, Learning path, Examples.
(function(){if(window.__iaNl)return;window.__iaNl=1;if(!/^\/($|software\/?$|learn(\/|$)|guides(\/|$)|checklist\/?$|deadlines\/?$|learning-path\/?$|sample-loan-package\/?$)/.test(location.pathname))return;var cs=document.currentScript,v=cs&&/[?&]v=([A-Za-z0-9]+)/.exec(cs.src);var s=document.createElement('script');s.type='module';s.src='/src/newsletter-box.mjs'+(v?'?v='+v[1]:'?v='+Date.now().toString(36).slice(0,6));document.head.appendChild(s)})();
