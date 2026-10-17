// Sitzungsschutz für alle Anmeldebereiche (Kundenbereich, Unternehmensportal, Admin-Zentrale).
// Läuft synchron im <head>, bevor die Anwendung die Sitzung liest:
//  - Automatische Abmeldung nach Inaktivität (tab-übergreifend gemessen).
//      ohne „Angemeldet bleiben": 30 Minuten · mit „Angemeldet bleiben": 30 Tage · Admin-Zentrale: immer 15 Minuten
//  - 60 Sekunden vorher erscheint ein Hinweis mit „Angemeldet bleiben".
//  - Abmeldung in einem Tab meldet alle Tabs ab; das Refresh-Token wird bei Supabase widerrufen.
(function () {
  'use strict';
  var AREA = location.pathname.indexOf('/intern') === 0 ? 'admin' : location.pathname.indexOf('/b2b-portal') === 0 ? 'b2b' : 'app';
  var SFX = AREA === 'app' ? '' : '-' + AREA;
  var K = AREA === 'app' ? 'immoadv-auth-session-v1' : 'immoadv-' + AREA + '-session-v1', ACT = 'ia-last-active' + SFX, REM = 'ia-remember' + SFX, WHY = 'ia-logout-reason' + SFX;
  var MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  var path = location.pathname.replace(/\/+$/, '') || '/';
  var isAdmin = path.indexOf('/intern') === 0;
  var isProtected = isAdmin || path.indexOf('/app/') === 0 || path === '/b2b-portal';
  var ls = (function () { try { var t = '__ia'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch (e) { return null; } })();
  function g(k) { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } }
  function s(k, v) { try { if (ls) { v == null ? ls.removeItem(k) : ls.setItem(k, v); } } catch (e) { /* ignore */ } }
  function has() { return !!g(K); }
  function remembered() { return g(REM) === '1'; }
  function limit() { return isAdmin ? 15 * MIN : remembered() ? 30 * DAY : 30 * MIN; }
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
      warnEl.className = 'ia-idle';
      warnEl.setAttribute('role', 'alertdialog');
      warnEl.setAttribute('aria-modal', 'true');
      warnEl.setAttribute('aria-labelledby', 'iaIdleT');
      warnEl.innerHTML = '<div class="ia-idle-box"><h2 id="iaIdleT">Sind Sie noch da?</h2><p>Zu Ihrer Sicherheit werden Sie in <strong id="iaIdleS">60</strong> Sekunden automatisch abgemeldet.</p>' +
        '<div class="ia-idle-act"><button type="button" class="btn btn-dark" id="iaIdleStay">Angemeldet bleiben</button><button type="button" class="btn btn-outline" id="iaIdleOut">Jetzt abmelden</button></div></div>';
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

  // Öffentliche Schnittstelle für Anmeldeformular und Abmelde-Knöpfe.
  window.iaAuth = {
    remembered: remembered,
    setRemember: function (on) { s(REM, on ? '1' : '0'); },
    loggedIn: function () { touch(); s(WHY, null); },
    logout: function () { logout('manuell'); },
    // Einmaliger Hinweis für die Anmeldeseite (z. B. nach Inaktivität).
    takeReason: function () { var r = g(WHY); s(WHY, null); return r; },
    limitText: function () { return isAdmin ? '15 Minuten' : remembered() ? '30 Tagen' : '30 Minuten'; }
  };
})();

// Technische Fehlermeldungen (ohne Personendaten) an ImmoAdv melden: Meldung, Datei, Zeile, Seite (ohne Parameter), Browser-Typ.
// Höchstens 5 je Seitenaufruf, gleiche Meldung nur einmal. Fehler von Browser-Erweiterungen und fremden Skripten werden ignoriert.
(function(){if(window.__iaErr)return;window.__iaErr=1;var sent={},n=0;function rep(m,s,l,c){try{m=String(m||'').slice(0,300);s=String(s||'');if(!m||n>=5||sent[m])return;if(/ResizeObserver loop|^Script error\.?$/i.test(m))return;if(s&&s.indexOf(location.origin)!==0&&!/^\/src\//.test(s))return;sent[m]=1;n++;var b=JSON.stringify({m:m,s:s.replace(location.origin,'').split('?')[0].slice(0,200),l:l|0,c:c|0,p:location.pathname.slice(0,120)});if(navigator.sendBeacon)navigator.sendBeacon('/api/errors',new Blob([b],{type:'application/json'}));else fetch('/api/errors',{method:'POST',headers:{'content-type':'application/json'},body:b,keepalive:true}).catch(function(){})}catch(e){}}
addEventListener('error',function(e){if(e&&e.message)rep(e.message,e.filename,e.lineno,e.colno)});addEventListener('unhandledrejection',function(e){var r=e&&e.reason;rep((r&&r.message)||String(r||'Unbehandelter Fehler'),(r&&r.stack||'').split('\n').map(function(x){var mm=x.match(/(\/src\/[^\s):]+)/);return mm?mm[1]:''}).filter(Boolean)[0]||'',0,0)})})();
