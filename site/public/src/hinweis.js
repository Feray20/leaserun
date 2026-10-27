// Datenschutz-Hinweis (DSGVO / § 25 TDDDG). Standard: LeaseRun setzt keine Tracking-Cookies – dann nur ein kurzer,
// nicht blockierender Hinweis. Ist im Web-Admin Google Analytics 4 eingeschaltet, wird daraus ein Einwilligungs-Banner:
// Google Analytics lädt erst nach „Zulassen“; „Ablehnen“ ist gleichwertig. „Do Not Track“/GPC zählt als Ablehnung.
// Die Wahl liegt im lokalen Speicher (ia-ga = yes/no) und lässt sich über window.iaConsent() (Link in der Datenschutzerklärung) ändern.
(() => {
  if (window.__iaHinweis) return;
  window.__iaHinweis = true;
  const KEY = 'lr-privacy-ok', GA = 'lr-ga';
  const P = location.pathname;
  const skip = /^\/(intern|kasse|b2b-portal|creator|app|auth|datenraum|pruefen)(\/|\.|$)/.test(P) || navigator.webdriver;
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ohne Speicher */ } };
  const optOut = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  let gaId = null;
  // Öffentliche Einstellungen (/api/site-config) robust abrufen: höchstens 5 s warten, bei Fehler ein Wiederholversuch nach 2 s,
  // sonst still der zuletzt gespeicherte Stand (sessionStorage) bzw. die eingebauten Standardwerte. Ein Abruf je Seite, geteilt mit demo-gate.js.
  const siteConfig = () => window.__iaCfgP || (window.__iaCfgP = (() => {
    const SK = 'lr-site-config';
    const once = () => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      return fetch('/api/site-config', { credentials: 'omit', signal: ac.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`site-config ${r.status}`)))).finally(() => clearTimeout(t));
    };
    return once().catch(() => new Promise((ok) => setTimeout(ok, 2000)).then(once))
      .then((c) => { try { sessionStorage.setItem(SK, JSON.stringify(c)); } catch { /* ohne Speicher */ } return c; })
      .catch(() => { try { return JSON.parse(sessionStorage.getItem(SK) || 'null') || {}; } catch { return {}; } });
  })());

  const loadGa = () => {
    if (!gaId) return;
    if (window.__iaGaOn) {
      // Erneute Einwilligung nach Widerruf in derselben Sitzung: Messung wieder freigeben.
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
    // Widerruf: bereits geladenes Google Analytics sofort stoppen (nicht erst nach Neuladen), dann Cookies entfernen.
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
      st.textContent = '.ia-priv-b{display:flex;gap:8px;flex:none}.ia-priv-no{flex:none;min-height:40px;padding:0 16px;border:1.5px solid #0F2C59;border-radius:10px;background:#fff;color:#0F2C59;font:inherit;font-weight:700;cursor:pointer}@media (max-width:420px){.ia-priv-b{width:100%}.ia-priv-b button{flex:1}}';
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.id = 'iaPriv';
    el.className = 'lr-priv';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', consent ? 'Einwilligung Statistik' : 'Datenschutz-Hinweis');
    el.setAttribute('data-noklapp', '');
    el.innerHTML = consent
      ? '<p><strong>Statistik mit Ihrer Einwilligung.</strong> Dürfen wir mit Google Analytics (Cookies, pseudonyme Nutzungsdaten, mögliche Übermittlung in die USA) messen, welche Seiten hilfreich sind? Ohne Werbefunktionen, keine Verknüpfung mit Ihrem Konto – jederzeit widerrufbar. <a href="/privacy#google-analytics">Details</a></p><span class="lr-priv-b"><button type="button" class="lr-priv-no">Ablehnen</button><button type="button" class="lr-priv-ok">Zulassen</button></span>'
      : '<p><strong>Keine Tracking-Cookies.</strong> LeaseRun speichert auf Ihrem Gerät nur, was für Anmeldung und Fortschritt technisch nötig ist – ohne Werbung, Datenbank in Frankfurt. <a href="/privacy">Datenschutzerklärung</a></p><button type="button" class="lr-priv-ok">Verstanden</button>';
    el.querySelector('.ia-priv-ok').onclick = () => { if (consent) { set(GA, 'yes'); loadGa(); } set(KEY, '1'); el.remove(); };
    const no = el.querySelector('.ia-priv-no'); if (no) no.onclick = () => { set(GA, 'no'); set(KEY, '1'); dropGa(); el.remove(); };
    document.body.appendChild(el);
  };
  window.iaConsent = () => { if (!gaId) { alert('LeaseRun verwendet derzeit keine Analyse-Cookies.'); return; } document.getElementById('iaPriv')?.remove(); banner(true); };

  // Datenschutzerklärung: Abschnitt zu Google Analytics nur zeigen, wenn es eingeschaltet ist.
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
        if (c === 'no' || optOut || /^\/(datenschutz|impressum)/.test(P)) return;
        setTimeout(() => banner(true), 600);
        return;
      }
      if (get(KEY) || /^\/(datenschutz|impressum)/.test(P)) return;
      setTimeout(() => banner(false), 600);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// Warte-Signal: Ein Knopf, der während eines Vorgangs gesperrt ist und „… “ zeigt (z. B. „Wird gesendet …“),
// bekommt automatisch den drehenden LeaseRun-Ring – überall auf der Website, ohne Änderungen an den einzelnen Formularen.
(() => {
  if (window.__iaBusy) return;
  window.__iaBusy = true;
  const css = '.ia-busy{position:relative;cursor:progress!important;opacity:.9!important}.ia-busy::after{content:"";display:inline-block;width:1em;height:1em;margin-left:.55em;vertical-align:-.15em;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;opacity:.75;animation:iaBusySpin .75s linear infinite}@keyframes iaBusySpin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.ia-busy::after{animation-duration:2s}}';
  const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);
  const check = (b) => { const on = b.disabled && /…\s*$/.test(b.textContent || ''); b.classList.toggle('lr-busy', on); if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); };
  const scan = (root) => { if (root.nodeType !== 1) return; if (root.matches('button, .btn')) check(root); root.querySelectorAll?.('button:disabled').forEach(check); };
  const start = () => new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') check(m.target); else if (m.type === 'characterData') { const b = m.target.parentElement?.closest('button'); if (b) check(b); } else { const b = m.target.closest?.('button'); if (b) check(b); m.addedNodes.forEach(scan); } } })
    .observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

// Automatischer Cache-Leerer: Nach jedem Update (neue Version auf dem Server) werden Zwischenspeicher und
// Offline-Dateien dieses Geräts einmal geleert und die Seite frisch geladen – niemand muss mehr selbst Cache leeren.
// Zurück-Taste (Handy): Seiten aus dem Zurück-Speicher (bfcache) mit hängendem Ladezustand werden frisch geladen.
(() => {
  if (window.__iaFresh) return;
  window.__iaFresh = true;
  const KEY = 'lr-build', LAST = 'lr-build-at', LOOP = 'lr-build-reload';
  const get = (s, k) => { try { return s.getItem(k); } catch { return null; } };
  const set = (s, k, v) => { try { s.setItem(k, v); } catch { /* privat */ } };
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
    // Nur einmal je Version neu laden (Schutz vor Endlosschleifen); Formulare mit Eingaben nicht verwerfen.
    if (get(sessionStorage, LOOP) === v) return;
    const typing = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea')].some((x) => x.value && x.defaultValue !== x.value);
    // Nur direkt nach dem Öffnen neu laden; mitten in der Nutzung nie unterbrechen (dann gilt die neue Version beim nächsten Seitenwechsel).
    if (typing || performance.now() > 6000) return;
    set(sessionStorage, LOOP, v);
    location.reload();
  };
  if (document.readyState === 'complete') check(false); else addEventListener('load', () => check(false), { once: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(false); });
  const APPISH = /^\/(intern|b2b-portal|app|creator|kasse|auth|karten\/konto|datenraum)/;
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    // App-Bereiche immer frisch (Anmeldung, Daten); sonst nur, wenn ein Lade-/Sperrzustand hängen geblieben ist.
    const stuck = document.querySelector('.ia-ld.full, .buy-ov, [aria-busy="true"], .ia-work, form[data-busy]');
    if (stuck || ((APPISH.test(location.pathname) || location.hostname.startsWith('admin.') || location.hostname.startsWith('partner.')) && (!window.__iaNeedReload || window.__iaNeedReload()))) location.reload();
    else check(true);
  });
})();

// Sicherheitsnetz gegen „Scrollen/Knöpfe gehen nicht“ (v. a. Handy nach Zurück oder abgebrochenen Vorgängen):
// Sperr-Klassen ohne zugehöriges offenes Fenster werden entfernt, verwaiste Lade-Overlays geschlossen.
(() => {
  if (window.__iaUnstick) return;
  window.__iaUnstick = true;
  const LOCKS = [['menu-open', '.mobile-nav:not([hidden])'], ['pt-sheet-open', '#ptSheet:not([hidden])'], ['dk-open', '#faDeck'], ['lr-pdfv-open', '.ia-pdfv'], ['lr-working', '.ia-work']];
  let last = 0;
  const unstick = () => {
    const now = Date.now(); if (now - last < 400) return; last = now;
    const b = document.body; if (!b) return;
    for (const [c, sel] of LOCKS) if (b.classList.contains(c) && !document.querySelector(sel)) b.classList.remove(c);
    if ((b.style.overflow === 'hidden' || document.documentElement.style.overflow === 'hidden') && !document.querySelector('dialog[open], .ia-pdfv, .ia-work, #ptSheet:not([hidden]), .mobile-nav:not([hidden])')) { b.style.overflow = ''; document.documentElement.style.overflow = ''; }
  };
  ['hashchange', 'popstate', 'pageshow', 'focus'].forEach((e) => addEventListener(e, () => setTimeout(unstick, 50)));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') unstick(); });
  document.addEventListener('touchstart', unstick, { passive: true, capture: true });
})();

// Offene Bestellung: dezenter, schließbarer Hinweis zum Fortsetzen (keine Pop-ups, kein Druck, kein Countdown).
(() => {
  if (window.__iaKasseHint || /^\/(kasse|intern|creator)/.test(location.pathname)) return;
  window.__iaKasseHint = true;
  const q = new URLSearchParams(location.search);
  if (q.get('checkout') === 'success' || q.has('session_id')) { try { localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ } return; }
  let d = null; try { d = JSON.parse(localStorage.getItem('lr-kasse-open') || 'null'); } catch { return; }
  if (!d || !d.at || Date.now() - d.at > 23 * 3600_000 || d.summary?.kind === 'setup') { if (d) try { localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ } return; }
  // Nur kurz nach dem Abbruch zeigen (höchstens 4 Minuten), danach von selbst ausblenden. Die Bestellung bleibt über /checkout fortsetzbar.
  const SHOW_MS = 4 * 60_000, left = SHOW_MS - (Date.now() - (d.left || d.at));
  if (left <= 0) return;
  // Nur einmal je Bestellung zeigen (beim ersten Seitenaufruf bzw. nach der Anmeldung) – nicht bei jedem Seitenwechsel.
  const seenKey = 'lr-kasse-hint-seen';
  try { const k = String(d.left || d.at); if (localStorage.getItem(seenKey) === k) return; localStorage.setItem(seenKey, k); } catch { return; }
  const show = () => {
    const el = document.createElement('div');
    el.className = 'lr-kasse-hint'; el.setAttribute('role', 'status');
    el.innerHTML = '<span>Ihre Bestellung' + (d.summary?.title ? ' „' + String(d.summary.title).replace(/[<>&"]/g, '') + '“' : '') + ' ist noch offen.</span><a href="/checkout">Fortsetzen</a><button type="button" aria-label="Hinweis schließen">×</button>';
    // Im Seitenfluss oben (kein schwebendes Element) – überdeckt so weder Chat-Knopf noch Aktionsleiste.
    el.style.cssText = 'position:relative;max-width:720px;margin:12px auto;width:calc(100% - 24px);box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;border-radius:14px;color:#fff;font:600 14px/1.35 Inter,system-ui,sans-serif;background:linear-gradient(135deg,#0F2C59,#2F7FC1);box-shadow:0 14px 40px -16px rgba(15,44,89,.6)';
    const a = el.querySelector('a'); a.style.cssText = 'margin-left:auto;background:#fff;color:#0F2C59;border-radius:999px;padding:8px 14px;text-decoration:none;white-space:nowrap';
    const x = el.querySelector('button'); x.style.cssText = 'background:none;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:4px 6px;min-width:36px;min-height:36px';
    x.onclick = () => el.remove();
    const host = document.querySelector('main') || document.body; host.prepend(el);
    setTimeout(() => el.remove(), left);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', show, { once: true }); else show();
})();

// Zurück-Taste: genau dort weitermachen, wo man eine Seite verlassen hat (Bereich, geöffnete Klappen, Scrollposition).
// Gilt für alle Seiten; der Privatbereich (App) stellt seinen Zustand selbst wieder her (gleiche Logik, siehe app-shell).
// Gemerkt wird zusätzlich ein Anker (das angetippte Element mit Kennung und sein Abstand zum oberen Rand) – so stimmt
// die Stelle auch dann exakt, wenn Inhalte beim Neuaufbau etwas anders hoch sind.
(() => {
  if (window.__iaRet) return;
  window.__iaRet = true;
  const key = () => 'lr-ret:' + location.pathname + location.search;
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch { /* privat */ } return null; };
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
        mehr: [...document.querySelectorAll('section[data-mehr]')].filter((x) => !x.querySelector('.ia-mehr-btn')).map((x) => x.id).filter(Boolean),
      }));
    } catch { /* privat */ }
  };
  addEventListener('pagehide', () => { ss('lr-hid:' + location.pathname, String(Date.now())); if (Date.now() - clickAt > 4000) save(); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (a && !a.target && a.origin === location.origin && (a.pathname !== location.pathname || a.search !== location.search)) { clickAt = Date.now(); ss('lr-int-nav:' + location.pathname, String(clickAt)); save(a); }
  }, true);
  // Seite aus dem Zurück-Speicher: nur neu laden, wenn es nötig ist (Rückkehr von einer fremden Seite wie Stripe,
  // lange weg gewesen oder ein Lade-/Sperrzustand hängt). Nach einem internen Seitenwechsel bleibt alles exakt so stehen.
  window.__iaNeedReload = () => {
    const t = +ss('lr-int-nav:' + location.pathname) || 0, h = +ss('lr-hid:' + location.pathname) || 0;
    const internal = t && h && h - t > -1000 && h - t < 10000;
    const fresh = h && Date.now() - h < 30 * 60_000;
    const stuck = document.querySelector('.ia-ld.full, .buy-ov, #buyOverlay, .ia-work, form[data-busy]');
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
  // Neu geöffnete Seite (Link, Lesezeichen, eingetippt): immer ganz oben beginnen – außer ein Sprungziel (#…) ist angegeben.
  try {
    const nav = performance.getEntriesByType?.('navigation')?.[0]?.type;
    if (!rec && nav === 'navigate' && !location.hash) { history.scrollRestoration = 'manual'; const top = () => { if (scrollY > 0) window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }; top(); addEventListener('load', top, { once: true }); }
  } catch { /* ignore */ }
  if (!rec || Date.now() - rec.at > 2 * 3600_000 || !(rec.y > 0 || rec.aid)) return;
  if (rec.hash && rec.hash !== location.hash) { try { history.replaceState(null, '', location.pathname + location.search + rec.hash); dispatchEvent(new HashChangeEvent('hashchange')); } catch { /* ignore */ } }
  try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  // Bis zu 12 s nachführen (Inhalte laden auf dem Handy teils später); sobald man selbst scrollt oder tippt, sofort aufhören.
  let stop = false, ok = 0;
  const end = () => { stop = true; };
  ['touchstart', 'wheel', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, end, { once: true, passive: true, capture: true }));
  const t0 = Date.now();
  const go = () => {
    if (stop || Date.now() - t0 > 12000) return;
    (rec.det || []).forEach((id) => { const d = document.getElementById(id); if (d && !d.open) d.open = true; });
    (rec.mehr || []).forEach((id) => document.getElementById(id)?.querySelector('.ia-mehr-btn')?.click());
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

// Vorschau-Sperre (Beispielwerte / Kernaussage) für Rechner und Wissenszentrale nachladen.
(()=>{const p=location.pathname.replace(/\/+$/,'');if(/^\/(rechner\/[a-z-]+|wissen(\/[a-z0-9-]+)?|mustermappe)$/.test(p)&&!document.querySelector('script[src*="demo-gate"]')){const s=document.createElement('script');const v=(document.currentScript&&document.currentScript.src.split('?v=')[1])||'';s.src='/src/demo-gate.js'+(v?'?v='+v:'');document.head.append(s)}})();
