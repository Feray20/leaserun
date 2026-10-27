if(/[#&]type=recovery(&|$)/.test(location.hash)&&location.pathname.indexOf('/auth/reset')!==0)location.replace('/auth/reset'+location.hash);
// Mobiles Menü für alle Seiten: Vollbild-Blatt unter der Kopfzeile.
// Ereignis-Delegation, damit es auch auf Seiten funktioniert, die ihren Inhalt erst per Skript aufbauen.
(() => {
  const label = (btn, open) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    const t = btn.querySelector('.mm-text');
    if (t) t.textContent = open ? 'Schließen' : 'Menü';
  };
  const setOpen = (open) => {
    const btn = document.querySelector('.mobile-menu');
    const nav = document.querySelector('.mobile-nav');
    if (!btn || !nav) return;
    // Blatt direkt unter der Kopfzeile beginnen lassen (Höhe je nach Breite verschieden).
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
      btn.innerHTML = '<span class="mm-icon" aria-hidden="true"></span><span class="mm-text">Menü</span>';
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
  // Zurück-Taste (Seite aus dem Browser-Zwischenspeicher) und Tab-Wechsel: Menü nie offen „hängen“ lassen.
  addEventListener('pageshow', () => setOpen(false));
  // Zurück von einer externen Seite (z. B. Stripe): Der Browser zeigt die Seite im Zustand beim Verlassen –
  // mit Ladeanzeigen, halbtransparenten Ebenen und gesperrten Knöpfen. Alles Zwischenzustände sofort entfernen,
  // damit jeder Knopf wieder reagiert.
  const unstick = () => {
    document.querySelectorAll('.ia-work, #buyOverlay, .buy-overlay').forEach((el) => el.remove());
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
  // Beim Wechsel auf Desktopbreite Menü schließen.
  matchMedia('(min-width: 901px)').addEventListener?.('change', (m) => m.matches && setOpen(false));
  // Seiten, die ihren Kopf erst per Skript schreiben: nach dem Aufbau markieren.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mark, 0));
  else setTimeout(mark, 0);
  new MutationObserver(() => { const b = document.querySelector('.mobile-menu'); if (b && !b.querySelector('.mm-text')) mark(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();

// Navigation je Status: Neue Besucher sehen „Anmelden“. „Zur Anwendung“ und die App-Leiste
// erscheinen nur für zahlende Kunden (Tarif, Unternehmenskonto) und Administratoren;
// angemeldete Nutzer ohne Tarif sehen „Mein Konto“. Der Status wird 10 Minuten zwischengespeichert.
(() => {
  const K = 'leaserun-auth-session-v1', C = 'lr-access', TTL = 10 * 60 * 1000;
  const root = document.documentElement;
  const sess = () => { try { return JSON.parse(localStorage.getItem(K) || 'null'); } catch { return null; } };
  const uid = (s) => s?.user?.id || String(s?.refresh_token || '').slice(-10);
  let state = { user: false, paid: false, b2b: false };
  // Unternehmenskunden arbeiten im Unternehmensportal: dort gibt es keine „Anwendung“, der Link führt ins Portal.
  const portal = () => {
    if (B2B_PAGE) return;
    document.querySelectorAll('a[href="/app/dashboard"], a[data-app-link]').forEach((a) => {
      if (!a.dataset.appLink) { a.dataset.appLink = '1'; a.dataset.appOrig = a.textContent; }
      a.setAttribute('href', state.b2b ? '/business-portal' : '/app/dashboard');
      if (/Zur Anwendung/.test(a.dataset.appOrig)) a.textContent = state.b2b ? 'Zum Portal' : a.dataset.appOrig;
    });
  };
  // Unternehmensseiten (/business …): „Anmelden“ führt direkt zum Login des Unternehmensportals, nicht zur Privatkunden-App.
  const B2B_PAGE = /^\/b2b(\/|$)/.test(location.pathname);
  const b2bLogin = () => {
    // Kopfzeile: „Mein Konto“ (wie im Privatbereich) – führt immer ins Unternehmensportal, nie in die Privatkunden-App.
    document.querySelectorAll('.nav-actions a[href="/auth/login"], .nav-actions a[href="/business-portal"].b2b-login').forEach((a) => {
      a.setAttribute('href', '/business-portal'); a.textContent = 'Mein Konto'; a.classList.add('b2b-login', 'b2b-acc'); a.dataset.orig = a.dataset.orig || 'Anmelden';
      a.setAttribute('aria-label', 'Mein Konto – Unternehmensportal');
    });
    // Im Menü kein zweites „Mein Konto“ – der Knopf steht schon neben „Menü“.
    document.querySelectorAll('.mobile-nav a[href="/auth/login"], .mobile-nav a.b2b-login').forEach((a) => a.remove());
    // Kein Link in die Privatkunden-Anwendung auf den Unternehmensseiten.
    document.querySelectorAll('.nav-actions a[href="/app/dashboard"], .mobile-nav a[href="/app/dashboard"]').forEach((a) => { a.hidden = true; });
  };
  const relabel = () => {
    if (B2B_PAGE) { b2bLogin(); return; }
    // Login für Unternehmen nur auf den Unternehmensseiten (/business), nicht im Privatkunden-Menü.
    document.querySelectorAll('.mobile-nav a.b2b-login').forEach((a) => a.remove());
    document.querySelectorAll('.nav-actions a[href="/auth/login"], .mobile-nav a[href="/auth/login"], a.nav-acc').forEach((a) => {
      const acc = state.user && !state.paid;
      if (!a.dataset.orig) a.dataset.orig = a.textContent;
      a.textContent = acc ? 'Mein Konto' : a.dataset.orig;
      a.classList.toggle('nav-acc', acc);
      a.setAttribute('href', acc ? '/app/dashboard#start' : '/auth/login');
    });
  };
  const apply = (st) => {
    state = st;
    root.classList.toggle('lr-user', !!st.user);
    root.classList.toggle('lr-paid', !!st.paid);
    // Einzelfreigaben je Bereich (Web-Admin → Nutzer → Zugriff freischalten)
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
      if (!r.ok) return; // Netzfehler: bisherigen Stand behalten
      const d = await r.json();
      const st = { user: !!d.loggedIn, paid: !!d.paid, b2b: !!d.b2b, areas: d.areas || null };
      apply(st); save(st, s);
    } catch { /* offline: bisherigen Stand behalten */ }
  }
  check(false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', relabel);
  // Seiten, die ihren Kopf per Skript aufbauen, und Wechsel in anderen Tabs.
  new MutationObserver(() => { if (document.querySelector('.nav-actions a[href="/auth/login"]:not([data-orig])')) relabel(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('storage', (e) => { if (e.key === K || e.key === C) check(e.key === K); });
  window.__iaAccess = { check: () => check(true) };
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

// Reichweitenmessung (cookielos) laden.
(function(){if(window.iaTrack||document.querySelector('script[src="/src/track.js"]'))return;var t=document.createElement('script');t.src='/src/track.js';t.defer=true;document.head.appendChild(t)})();

// Kontakt-Widget (unten rechts) auf öffentlichen Seiten; lädt als eigenes Modul.
(function(){if(window.__iaCw)return;window.__iaCw=1;if(/^\/(app|b2b-portal|intern|auth|partner|datenraum|p|verify|pruefen|kuendigen|widerrufen|b2b)(\/|$)/.test(location.pathname))return;var s=document.createElement('script');s.type='module';s.src='/src/contact-widget.mjs';document.head.appendChild(s)})();
// Newsletter-Anmeldebox (Checkliste + Zins-Update) auf Startseite, Wissen/Ratgeber, Checkliste, Fristen, Lernpfad, Beispiele.
(function(){if(window.__iaNl)return;window.__iaNl=1;if(!/^\/($|wissen(\/|$)|ratgeber(\/|$)|checkliste\/?$|fristen\/?$|lernpfad\/?$|mustermappe\/?$)/.test(location.pathname))return;var cs=document.currentScript,v=cs&&/[?&]v=([A-Za-z0-9]+)/.exec(cs.src);var s=document.createElement('script');s.type='module';s.src='/src/newsletter-box.mjs'+(v?'?v='+v[1]:'?v='+Date.now().toString(36).slice(0,6));document.head.appendChild(s)})();
