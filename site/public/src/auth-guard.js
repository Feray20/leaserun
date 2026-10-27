// Session protection for all sign-in areas (consumer app, business portal, admin headquarters).
// Runs synchronously in <head>, before the app reads the session:
//  - Automatic sign-out after inactivity (measured across tabs).
//      without "Stay signed in": 12 hours · with "Stay signed in" (default): 30 days · admin: 2 hours
//  - 60 seconds before, a notice with "Stay signed in" appears.
//  - Signing out in one tab signs out all tabs; the refresh token is revoked at Supabase.
(function () {
  'use strict';
  var H = location.hostname;
  var AREA = location.pathname.indexOf('/internal') === 0 || H.indexOf('admin.') === 0 ? 'admin' : location.pathname.indexOf('/creators') === 0 ? 'creator' : location.pathname.indexOf('/business-portal') === 0 || (H.indexOf('partner.') === 0 && location.pathname === '/') ? 'b2b' : 'app';
  // Each area has its own separate session: consumer app (B2C), business portal (B2B), admin, creator area.
  var SFX = AREA === 'admin' ? '-admin' : AREA === 'creator' ? '-creator' : AREA === 'b2b' ? '-b2b' : '';
  var K = AREA === 'admin' ? 'leaserun-admin-session-v1' : AREA === 'creator' ? 'leaserun-creator-session-v1' : AREA === 'b2b' ? 'leaserun-b2b-session-v1' : 'leaserun-auth-session-v1', ACT = 'lr-last-active' + SFX, REM = 'lr-remember' + SFX, WHY = 'lr-logout-reason' + SFX;
  var MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  var path = location.pathname.replace(/\/+$/, '') || '/';
  var isAdmin = AREA === 'admin';
  var isProtected = isAdmin || path.indexOf('/app/') === 0 || AREA === 'b2b';
  var ls = (function () { try { var t = '__ia'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch (e) { return null; } })();
  function g(k) { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } }
  function s(k, v) { try { if (ls) { v == null ? ls.removeItem(k) : ls.setItem(k, v); } } catch (e) { /* ignore */ } }
  function has() { return !!g(K); }
  function remembered() { return g(REM) !== '0'; } // default: stay signed in
  function limit() { return isAdmin ? 120 * MIN : remembered() ? 30 * DAY : 12 * 60 * MIN; }
  function last() { var v = Number(g(ACT)); return v > 0 ? v : 0; }
  function touch() { s(ACT, String(Date.now())); }

  // Revoke the refresh token at Supabase (best effort, does not block sign-out).
  function revoke(raw) {
    try {
      var at = JSON.parse(raw || 'null'); at = at && at.access_token;
      if (!at || !window.fetch) return Promise.resolve();
      return fetch('/api/supabase-config').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
        if (!c || !c.url) return;
        return fetch(c.url + '/auth/v1/logout?scope=local', { method: 'POST', keepalive: true, headers: { apikey: c.anonKey || c.key || c.publishableKey, Authorization: 'Bearer ' + at } });
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  function loginUrl() {
    var next = location.pathname + location.search + location.hash;
    if (AREA !== 'app') return location.pathname;
    return '/auth/login' + (isProtected ? '?next=' + encodeURIComponent(next) : '');
  }

  function logout(reason) {
    var raw = g(K);
    s(K, null); s(ACT, null);
    try { sessionStorage.removeItem(K); } catch (e) { /* ignore */ }
    if (reason) s(WHY, reason);
    hideWarn();
    var go = isProtected || reason === 'manuell';
    var target = reason === 'manuell' ? (AREA === 'app' ? '/' : location.pathname) : loginUrl();
    // Redirect only after the revoke (wait at most 1.5 s).
    var done = false, nav = function () { if (!done && go) { done = true; location.replace(target); } };
    var p = revoke(raw);
    if (p && p.then) { p.then(nav, nav); setTimeout(nav, 1500); } else nav();
  }

  // On load: remove an expired session right away, before the app uses it.
  if (has()) {
    var l = last();
    if (l && Date.now() - l > limit()) logout('inaktiv');
    else touch();
  }

  // Track activity (throttled, across tabs via localStorage).
  var lastWrite = 0;
  function activity() {
    if (!has() || warnEl) return; // during the notice only the button counts
    var now = Date.now();
    if (now - lastWrite > 15000) { lastWrite = now; touch(); }
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(function (ev) { addEventListener(ev, activity, { passive: true, capture: true }); });

  // Notice before sign-out.
  var warnEl = null, warnTimer = null;
  function hideWarn() { if (warnEl) { warnEl.remove(); warnEl = null; } }
  function showWarn(ms) {
    if (!document.body) return;
    if (!warnEl) {
      warnEl = document.createElement('div');
      warnEl.className = 'lr-idle';
      warnEl.setAttribute('role', 'alertdialog');
      warnEl.setAttribute('aria-modal', 'true');
      warnEl.setAttribute('aria-labelledby', 'iaIdleT');
      warnEl.innerHTML = '<div class="lr-idle-box"><h2 id="iaIdleT">Are you still there?</h2><p>For your security you will be signed out automatically in <strong id="iaIdleS">60</strong> seconds.</p>' +
        '<div class="lr-idle-act"><button type="button" class="btn btn-dark" id="iaIdleStay">Stay signed in</button><button type="button" class="btn btn-outline" id="iaIdleOut">Sign out now</button></div></div>';
      document.body.appendChild(warnEl);
      document.getElementById('iaIdleStay').onclick = function () { lastWrite = Date.now(); touch(); hideWarn(); };
      document.getElementById('iaIdleOut').onclick = function () { logout('manuell'); };
      try { document.getElementById('iaIdleStay').focus(); } catch (e) { /* ignore */ }
    }
    var sec = document.getElementById('iaIdleS');
    if (sec) sec.textContent = String(Math.max(0, Math.ceil(ms / 1000)));
  }

  function tick() {
    if (!has()) { hideWarn(); return; }
    var l = last();
    if (!l) { touch(); return; }
    var left = limit() - (Date.now() - l);
    if (left <= 0) logout('inaktiv');
    else if (left <= 60000) showWarn(left);
    else hideWarn();
  }
  warnTimer = setInterval(tick, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  // Other tabs: adopt sign-out or activity.
  addEventListener('storage', function (e) {
    if (e.key === K && !e.newValue) { hideWarn(); if (isProtected) location.replace(loginUrl()); }
    else if (e.key === ACT) tick();
  });

  // Renew the access token in the background in time (otherwise it expires after ~1 hour and actions fail).
  // Locked across tabs so two tabs never redeem the same refresh token at once.
  var LOCK = 'lr-refresh-lock' + SFX, busy = false;
  function expOf(sess) {
    if (sess && sess.expires_at) return Number(sess.expires_at) * 1000;
    try { var p = String(sess.access_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p)).exp * 1000; } catch (e) { return 0; }
  }
  function keepFresh() {
    if (busy || !window.fetch) return;
    var raw = g(K), cur; try { cur = JSON.parse(raw || 'null'); } catch (e) { cur = null; }
    if (!cur || !cur.refresh_token) return;
    var exp = expOf(cur);
    if (exp && exp - Date.now() > 5 * MIN) return;
    var lk = Number(g(LOCK)); if (lk && Date.now() - lk < 20000) return;
    busy = true; s(LOCK, String(Date.now()));
    fetch('/api/supabase-config').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (!c || !c.url) return;
      return fetch(c.url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: c.anonKey || c.key || c.publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: cur.refresh_token }) })
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          if (!d || !d.access_token) return;
          var now; try { now = JSON.parse(g(K) || 'null'); } catch (e) { now = null; }
          // Nur speichern, wenn inzwischen niemand anders erneuert oder abgemeldet hat.
          if (now && now.refresh_token === cur.refresh_token) s(K, JSON.stringify(d.user ? d : Object.assign({}, d, { user: now.user })));
        });
    }).catch(function () { /* offline: retry on the next run */ }).then(function () { busy = false; s(LOCK, null); });
  }
  if (has()) keepFresh();
  setInterval(function () { if (has()) keepFresh(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && has()) keepFresh(); });

  // Public interface for the sign-in form and sign-out buttons. (Reason codes 'inaktiv'/'manuell' are internal values.)
  window.iaAuth = {
    remembered: remembered,
    setRemember: function (on) { s(REM, on ? '1' : '0'); },
    loggedIn: function () { touch(); s(WHY, null); },
    logout: function () { logout('manuell'); },
    // One-time note for the sign-in page (e.g. after inactivity).
    takeReason: function () { var r = g(WHY); s(WHY, null); return r; },
    limitText: function () { return isAdmin ? '2 hours' : remembered() ? '30 days' : '12 hours'; }
  };
})();

// Report technical errors (no personal data) to LeaseRun: message, file, line, page (without parameters), browser type.
// At most 5 per page view, the same message only once. Errors from browser extensions and third-party scripts are ignored.
// Harmless browser messages don't count: aborted page transitions (fast clicking) and aborted or offline failed requests.
(function(){if(window.__iaErr)return;window.__iaErr=1;var sent={},n=0;function rep(m,s,l,c){try{m=String(m||'').slice(0,300);s=String(s||'');if(!m||n>=5||sent[m])return;if(/ResizeObserver loop|^Script error\.?$/i.test(m))return;if(s&&s.indexOf(location.origin)!==0&&!/^\/src\//.test(s))return;sent[m]=1;n++;var b=JSON.stringify({m:m,s:s.replace(location.origin,'').split('?')[0].slice(0,200),l:l|0,c:c|0,p:location.pathname.slice(0,120)});if(navigator.sendBeacon)navigator.sendBeacon('/api/errors',new Blob([b],{type:'application/json'}));else fetch('/api/errors',{method:'POST',headers:{'content-type':'application/json'},body:b,keepalive:true}).catch(function(){})}catch(e){}}
function harmless(r,m){try{var nm=(r&&r.name)||'';m=String(m||'');if((nm==='AbortError'||nm==='InvalidStateError'||/^(AbortError|InvalidStateError)\b/.test(m))&&/Transition was aborted|skipTransition\(\) was called|ViewTransition/i.test(m))return 1;if(nm==='AbortError'||/^AbortError\b|The user aborted a request|signal is aborted/i.test(m))return 1;if(navigator.onLine===false&&/Failed to fetch|Load failed|NetworkError/i.test(m))return 1}catch(e){}return 0}
// Page transition animation: silently catch aborted transitions (fast clicking) so no unhandled rejection occurs.
(function(){function vt(t){try{if(t)['finished','ready','updateCallbackDone'].forEach(function(k){if(t[k]&&t[k].catch)t[k].catch(function(){})})}catch(e){}}addEventListener('pageswap',function(e){vt(e&&e.viewTransition)});addEventListener('pagereveal',function(e){vt(e&&e.viewTransition)});vt(document.activeViewTransition);var S=document.startViewTransition;if(typeof S==='function'&&!S.__ia){var W=function(){var t=S.apply(document,arguments);vt(t);return t};W.__ia=1;document.startViewTransition=W}})();
function heal(m){try{if(!/dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Unable to preload CSS/i.test(m))return 0;var k='lr-heal:'+location.pathname;if(sessionStorage.getItem(k))return 0;sessionStorage.setItem(k,'1');rep('[self-healed] '+m,'',0,0);setTimeout(function(){location.reload()},80);return 1}catch(e){return 0}}
addEventListener('error',function(e){if(e&&e.message&&!harmless(e.error,e.message)&&!heal(e.message))rep(e.message,e.filename,e.lineno,e.colno)});addEventListener('unhandledrejection',function(e){var r=e&&e.reason,mm=(r&&r.message)||String(r||'Unhandled error');if(harmless(r,mm)||heal(mm))return;rep(mm,(r&&r.stack||'').split('\n').map(function(x){var mm=x.match(/(\/src\/[^\s):]+)/);return mm?mm[1]:''}).filter(Boolean)[0]||'',0,0)});(function(){var F=window.fetch;if(!F||F.__ia)return;var W=function(i,o){var r=F.apply(this,arguments);try{var a=document.createElement('a');a.href=typeof i==='string'?i:(i&&i.url)||'';var api=a.origin===location.origin&&/^\/api\//.test(a.pathname)&&!/^\/api\/(errors|a|geo|version|health|site-config)\b/.test(a.pathname),sb=/\.supabase\.co$/.test(a.hostname)&&/\/auth\/v1\//.test(a.pathname);if(api||sb)r.then(function(x){var s=x.status;if(api&&(s>=500||(s>=400&&s!==401&&s!==404&&/\/api\/(billing|kontakt|contact|formular|termin|kuendigung|widerruf|newsletter|feedback|support|unterlagen|kreditmappe|b2b\/contact)/.test(a.pathname))))rep('API '+s+' · '+a.pathname,'',0,0);else if(sb&&(s>=500||s===429))rep('Sign-in '+s+' · '+a.pathname.replace(/^.*\/auth\/v1/,'/auth'),'',0,0)},function(){if(!api||(o&&o.signal&&o.signal.aborted)||window.__iaGone||navigator.onLine===false)return;setTimeout(function(){if(!window.__iaGone&&document.visibilityState!=='hidden'&&navigator.onLine!==false)rep('API offline · '+a.pathname,'',0,0)},1500)})}catch(e){}return r};W.__ia=1;window.fetch=W;addEventListener('pagehide',function(){window.__iaGone=1});addEventListener('beforeunload',function(){window.__iaGone=1})})();})();
