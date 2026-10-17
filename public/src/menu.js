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
  // Beim Wechsel auf Desktopbreite Menü schließen.
  matchMedia('(min-width: 901px)').addEventListener?.('change', (m) => m.matches && setOpen(false));
  // Seiten, die ihren Kopf erst per Skript schreiben: nach dem Aufbau markieren.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mark, 0));
  else setTimeout(mark, 0);
  new MutationObserver(() => { if (document.querySelector('.mobile-menu:not(:has(.mm-text))')) mark(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();

// Navigation je Status: Neue Besucher sehen „Anmelden“. „Zur Anwendung“ und die App-Leiste
// erscheinen nur für zahlende Kunden (Tarif, Unternehmenskonto) und Administratoren;
// angemeldete Nutzer ohne Tarif sehen „Mein Konto“. Der Status wird 10 Minuten zwischengespeichert.
(() => {
  const K = 'immoadv-auth-session-v1', C = 'ia-access', TTL = 10 * 60 * 1000;
  const root = document.documentElement;
  const sess = () => { try { return JSON.parse(localStorage.getItem(K) || 'null'); } catch { return null; } };
  const uid = (s) => s?.user?.id || String(s?.refresh_token || '').slice(-10);
  let state = { user: false, paid: false };
  const relabel = () => {
    document.querySelectorAll('.nav-actions a[href="/auth/login"], .mobile-nav a[href="/auth/login"], a.nav-acc').forEach((a) => {
      const acc = state.user && !state.paid;
      if (!a.dataset.orig) a.dataset.orig = a.textContent;
      a.textContent = acc ? 'Mein Konto' : a.dataset.orig;
      a.classList.toggle('nav-acc', acc);
      a.setAttribute('href', acc ? '/app/dashboard#konto' : '/auth/login');
    });
  };
  const apply = (st) => {
    state = st;
    root.classList.toggle('ia-user', !!st.user);
    root.classList.toggle('ia-paid', !!st.paid);
    relabel();
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
    if (c && c.uid === uid(s)) apply({ user: !!c.user, paid: !!c.paid });
    else apply({ user: true, paid: false });
    if (!force && c && c.uid === uid(s) && Date.now() - c.at < TTL) return;
    const ask = (tok) => fetch('/api/me/access', { headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' });
    try {
      let r = await ask(s.access_token);
      if (r.status === 401 && s.refresh_token) { const n = await refresh(s); if (n) { s = n; r = await ask(n.access_token); } }
      if (r.status === 401) { apply({ user: false, paid: false }); return; }
      if (!r.ok) return; // Netzfehler: bisherigen Stand behalten
      const d = await r.json();
      const st = { user: !!d.loggedIn, paid: !!d.paid };
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

// Footer-Akkordeon: auf allen Geräten ist immer nur ein Bereich geöffnet.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('foot-col') || !d.open) return;
  document.querySelectorAll('details.foot-col[open]').forEach((x) => { if (x !== d) x.open = false; });
}, true);

// Technische Fehlermeldungen (ohne Personendaten) an ImmoAdv melden: Meldung, Datei, Zeile, Seite (ohne Parameter), Browser-Typ.
// Höchstens 5 je Seitenaufruf, gleiche Meldung nur einmal. Fehler von Browser-Erweiterungen und fremden Skripten werden ignoriert.
(function(){if(window.__iaErr)return;window.__iaErr=1;var sent={},n=0;function rep(m,s,l,c){try{m=String(m||'').slice(0,300);s=String(s||'');if(!m||n>=5||sent[m])return;if(/ResizeObserver loop|^Script error\.?$/i.test(m))return;if(s&&s.indexOf(location.origin)!==0&&!/^\/src\//.test(s))return;sent[m]=1;n++;var b=JSON.stringify({m:m,s:s.replace(location.origin,'').split('?')[0].slice(0,200),l:l|0,c:c|0,p:location.pathname.slice(0,120)});if(navigator.sendBeacon)navigator.sendBeacon('/api/errors',new Blob([b],{type:'application/json'}));else fetch('/api/errors',{method:'POST',headers:{'content-type':'application/json'},body:b,keepalive:true}).catch(function(){})}catch(e){}}
addEventListener('error',function(e){if(e&&e.message)rep(e.message,e.filename,e.lineno,e.colno)});addEventListener('unhandledrejection',function(e){var r=e&&e.reason;rep((r&&r.message)||String(r||'Unbehandelter Fehler'),(r&&r.stack||'').split('\n').map(function(x){var mm=x.match(/(\/src\/[^\s):]+)/);return mm?mm[1]:''}).filter(Boolean)[0]||'',0,0)})})();

// Reichweitenmessung (cookielos) laden.
(function(){if(window.iaTrack||document.querySelector('script[src="/src/track.js"]'))return;var t=document.createElement('script');t.src='/src/track.js';t.defer=true;document.head.appendChild(t)})();
