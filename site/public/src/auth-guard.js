// Sitzungsschutz für alle Anmeldebereiche (Kundenbereich, Unternehmensportal, Admin-Zentrale).
// Läuft synchron im <head>, bevor die Anwendung die Sitzung liest:
//  - Automatische Abmeldung nach Inaktivität (tab-übergreifend gemessen).
//      ohne „Angemeldet bleiben": 12 Stunden · mit „Angemeldet bleiben" (Standard): 30 Tage · Admin-Zentrale: 2 Stunden
//  - 60 Sekunden vorher erscheint ein Hinweis mit „Angemeldet bleiben".
//  - Abmeldung in einem Tab meldet alle Tabs ab; das Refresh-Token wird bei Supabase widerrufen.
(function () {
  'use strict';
  var H = location.hostname;
  var AREA = location.pathname.indexOf('/internal') === 0 || H.indexOf('admin.') === 0 ? 'admin' : location.pathname.indexOf('/creators') === 0 ? 'creator' : location.pathname.indexOf('/business-portal') === 0 || (H.indexOf('partner.') === 0 && location.pathname === '/') ? 'b2b' : 'app';
  // Jeder Bereich hat eine eigene, getrennte Sitzung: Privatbereich (B2C), Unternehmensportal (B2B), Admin-Zentrale, Creator-Bereich.
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
  function remembered() { return g(REM) !== '0'; } // Standard: angemeldet bleiben
  function limit() { return isAdmin ? 120 * MIN : remembered() ? 30 * DAY : 12 * 60 * MIN; }
  function last() { var v = Number(g(ACT)); return v > 0 ? v : 0; }
  function touch() { s(ACT, String(Date.now())); }

  // Refresh-Token bei Supabase widerrufen (best effort, blockiert die Abmeldung nicht).
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
    // Weiterleitung erst nach dem Widerruf (höchstens 1,5 s warten).
    var done = false, nav = function () { if (!done && go) { done = true; location.replace(target); } };
    var p = revoke(raw);
    if (p && p.then) { p.then(nav, nav); setTimeout(nav, 1500); } else nav();
  }

  // Beim Laden: abgelaufene Sitzung sofort entfernen, bevor die Anwendung sie verwendet.
  if (has()) {
    var l = last();
    if (l && Date.now() - l > limit()) logout('inaktiv');
    else touch();
  }

  // Aktivität erfassen (gedrosselt, tab-übergreifend über localStorage).
  var lastWrite = 0;
  function activity() {
    if (!has() || warnEl) return; // während des Hinweises zählt nur der Knopf
    var now = Date.now();
    if (now - lastWrite > 15000) { lastWrite = now; touch(); }
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(function (ev) { addEventListener(ev, activity, { passive: true, capture: true }); });

  // Hinweis vor der Abmeldung.
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
      warnEl.innerHTML = '<div class="lr-idle-box"><h2 id="iaIdleT">Sind Sie noch da?</h2><p>Zu Ihrer Sicherheit werden Sie in <strong id="iaIdleS">60</strong> Sekunden automatisch abgemeldet.</p>' +
        '<div class="lr-idle-act"><button type="button" class="btn btn-dark" id="iaIdleStay">Angemeldet bleiben</button><button type="button" class="btn btn-outline" id="iaIdleOut">Jetzt abmelden</button></div></div>';
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

  // Andere Tabs: Abmeldung oder Aktivität übernehmen.
  addEventListener('storage', function (e) {
    if (e.key === K && !e.newValue) { hideWarn(); if (isProtected) location.replace(loginUrl()); }
    else if (e.key === ACT) tick();
  });

  // Zugangs-Token rechtzeitig im Hintergrund erneuern (läuft sonst nach ~1 Stunde ab und Aktionen schlagen fehl).
  // Tab-übergreifend gesperrt, damit nicht zwei Tabs gleichzeitig dasselbe Refresh-Token einlösen.
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
    }).catch(function () { /* offline: beim nächsten Durchlauf erneut */ }).then(function () { busy = false; s(LOCK, null); });
  }
  if (has()) keepFresh();
  setInterval(function () { if (has()) keepFresh(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && has()) keepFresh(); });

  // Öffentliche Schnittstelle für Anmeldeformular und Abmelde-Knöpfe.
  window.iaAuth = {
    remembered: remembered,
    setRemember: function (on) { s(REM, on ? '1' : '0'); },
    loggedIn: function () { touch(); s(WHY, null); },
    logout: function () { logout('manuell'); },
    // Einmaliger Hinweis für die Anmeldeseite (z. B. nach Inaktivität).
    takeReason: function () { var r = g(WHY); s(WHY, null); return r; },
    limitText: function () { return isAdmin ? '2 Stunden' : remembered() ? '30 Tagen' : '12 Stunden'; }
  };
})();

// Technische Fehlermeldungen (ohne Personendaten) an LeaseRun melden: Meldung, Datei, Zeile, Seite (ohne Parameter), Browser-Typ.
// Höchstens 5 je Seitenaufruf, gleiche Meldung nur einmal. Fehler von Browser-Erweiterungen und fremden Skripten werden ignoriert.
// Harmlose Browser-Meldungen zählen nicht: abgebrochene Seitenwechsel-Animationen (schnelles Weiterklicken) und abgebrochene oder offline gescheiterte Abrufe.
(function(){if(window.__iaErr)return;window.__iaErr=1;var sent={},n=0;function rep(m,s,l,c){try{m=String(m||'').slice(0,300);s=String(s||'');if(!m||n>=5||sent[m])return;if(/ResizeObserver loop|^Script error\.?$/i.test(m))return;if(s&&s.indexOf(location.origin)!==0&&!/^\/src\//.test(s))return;sent[m]=1;n++;var b=JSON.stringify({m:m,s:s.replace(location.origin,'').split('?')[0].slice(0,200),l:l|0,c:c|0,p:location.pathname.slice(0,120)});if(navigator.sendBeacon)navigator.sendBeacon('/api/errors',new Blob([b],{type:'application/json'}));else fetch('/api/errors',{method:'POST',headers:{'content-type':'application/json'},body:b,keepalive:true}).catch(function(){})}catch(e){}}
function harmless(r,m){try{var nm=(r&&r.name)||'';m=String(m||'');if((nm==='AbortError'||nm==='InvalidStateError'||/^(AbortError|InvalidStateError)\b/.test(m))&&/Transition was aborted|skipTransition\(\) was called|ViewTransition/i.test(m))return 1;if(nm==='AbortError'||/^AbortError\b|The user aborted a request|signal is aborted/i.test(m))return 1;if(navigator.onLine===false&&/Failed to fetch|Load failed|NetworkError/i.test(m))return 1}catch(e){}return 0}
// Seitenwechsel-Animation: Abgebrochene Übergänge (schnelles Klicken) still abfangen, damit keine unbehandelte Ablehnung entsteht.
(function(){function vt(t){try{if(t)['finished','ready','updateCallbackDone'].forEach(function(k){if(t[k]&&t[k].catch)t[k].catch(function(){})})}catch(e){}}addEventListener('pageswap',function(e){vt(e&&e.viewTransition)});addEventListener('pagereveal',function(e){vt(e&&e.viewTransition)});vt(document.activeViewTransition);var S=document.startViewTransition;if(typeof S==='function'&&!S.__ia){var W=function(){var t=S.apply(document,arguments);vt(t);return t};W.__ia=1;document.startViewTransition=W}})();
function heal(m){try{if(!/dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Unable to preload CSS/i.test(m))return 0;var k='lr-heal:'+location.pathname;if(sessionStorage.getItem(k))return 0;sessionStorage.setItem(k,'1');rep('[selbst behoben] '+m,'',0,0);setTimeout(function(){location.reload()},80);return 1}catch(e){return 0}}
addEventListener('error',function(e){if(e&&e.message&&!harmless(e.error,e.message)&&!heal(e.message))rep(e.message,e.filename,e.lineno,e.colno)});addEventListener('unhandledrejection',function(e){var r=e&&e.reason,mm=(r&&r.message)||String(r||'Unbehandelter Fehler');if(harmless(r,mm)||heal(mm))return;rep(mm,(r&&r.stack||'').split('\n').map(function(x){var mm=x.match(/(\/src\/[^\s):]+)/);return mm?mm[1]:''}).filter(Boolean)[0]||'',0,0)});(function(){var F=window.fetch;if(!F||F.__ia)return;var W=function(i,o){var r=F.apply(this,arguments);try{var a=document.createElement('a');a.href=typeof i==='string'?i:(i&&i.url)||'';var api=a.origin===location.origin&&/^\/api\//.test(a.pathname)&&!/^\/api\/(errors|a|geo|version|health|site-config)\b/.test(a.pathname),sb=/\.supabase\.co$/.test(a.hostname)&&/\/auth\/v1\//.test(a.pathname);if(api||sb)r.then(function(x){var s=x.status;if(api&&(s>=500||(s>=400&&s!==401&&s!==404&&/\/api\/(billing|kontakt|formular|termin|kuendigung|widerruf|newsletter|feedback|support|unterlagen|kreditmappe|b2b\/contact)/.test(a.pathname))))rep('API '+s+' · '+a.pathname,'',0,0);else if(sb&&(s>=500||s===429))rep('Anmeldung '+s+' · '+a.pathname.replace(/^.*\/auth\/v1/,'/auth'),'',0,0)},function(){if(!api||(o&&o.signal&&o.signal.aborted)||window.__iaGone||navigator.onLine===false)return;setTimeout(function(){if(!window.__iaGone&&document.visibilityState!=='hidden'&&navigator.onLine!==false)rep('API offline · '+a.pathname,'',0,0)},1500)})}catch(e){}return r};W.__ia=1;window.fetch=W;addEventListener('pagehide',function(){window.__iaGone=1});addEventListener('beforeunload',function(){window.__iaGone=1})})();})();
