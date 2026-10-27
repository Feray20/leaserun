// Vorschau für Nicht-Kunden: Rechner laufen nur mit Beispielwerten, die Wissenszentrale zeigt nur Allgemeines –
// die ausführlichen Antworten (Rechenweg, Rechtsgrundlage, Bankpraxis) lädt nur ein zahlender Kunde vom Server.
// Kunden erkennt menu.js (Klasse ia-paid am <html>, Zwischenspeicher ia-access); sobald sie gesetzt ist, ist alles offen.
(() => {
  if (window.__iaGate) return;
  window.__iaGate = true;
  const P = location.pathname.replace(/\/+$/, '') || '/';
  const CALC = /^\/rechner\/[a-z-]+$/.test(P) && P !== '/calculators/closing-costs';
  const WISSEN = (P === '/learn' || /^\/wissen\/[a-z0-9-]+$/.test(P)) && !/^\/wissen\/(glossar|erwerbsstatus|warum-investieren)$/.test(P);
  const MUSTER = P === '/sample-loan-package';
  if (!CALC && !WISSEN && !MUSTER) return;
  const root = document.documentElement;
  const cached = () => { try { return !!JSON.parse(localStorage.getItem('lr-access') || 'null')?.paid; } catch { return false; } };
  const paid = () => root.classList.contains('lr-paid') || cached();
  const user = () => root.classList.contains('lr-user');

  const css = document.createElement('style');
  css.textContent = `
  .ia-gate-box{display:none}
  html.ia-demo .ia-gate-box{display:grid;gap:8px;position:relative;margin:12px 0;padding:16px 18px;border-radius:14px;border:1px solid #BFDBFE;background:linear-gradient(135deg,#EFF6FF,#F8FAFC);color:#0F2C59;font:500 15px/1.5 Inter,system-ui,sans-serif}
  .ia-gate-box strong{font-size:16px}
  .ia-gate-box .ia-gate-act{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .ia-gate-box a.btn{min-height:44px}
  html.ia-demo .ia-demo-ctl{opacity:.75;cursor:not-allowed}
  html.ia-demo [data-gate-hid]{display:none!important}
  html.ia-demo .ia-gate-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;box-sizing:border-box;width:100%;margin:0 0 18px;padding:12px 16px}
  html.ia-demo .ia-gate-bar .btn{min-height:40px}
  html.ia-demo .wq-more{display:none!important}
  .wq-tag{display:none}
  html.ia-demo .wq-tag{display:block;width:fit-content;margin-top:6px;padding:1px 9px;border-radius:999px;font:600 12px/1.6 Inter,system-ui,sans-serif;font-style:normal;white-space:nowrap}
  html.ia-demo .wq-free{background:#DCFCE7;color:#166534}
  html.ia-demo .wq-lock{background:#EEF2FF;color:#3730A3}
  .wq-hook{display:none}
  html.ia-demo .wq-hook{display:block;margin:10px 0 4px;padding-left:12px;border-left:3px solid #93C5FD;color:#0F2C59;font-weight:600}
  .ia-gate-note{display:none}
  html.ia-demo .ia-gate-note{display:block;margin:8px 0 0;color:#475569;font-size:14px}
  .report > h2 .ia-gate-tag{display:inline-block;margin:0 0 0 8px;vertical-align:middle}
  html.ia-demo .report .route-a .ia-gate-hook{margin:4px 0 8px}`;
  document.head.append(css);

  // Eine kurze Anleitung ganz oben – und nur dort ein Knopf „Zugang freischalten“ (keine Wiederholung je Eintrag).
  const OPEN = CALC ? 'jeder Rechner mit Ihren eigenen Zahlen – speichern, drucken, teilen.' : MUSTER ? 'die komplette Mustermappe und Ihre eigene Kreditmappe.' : 'alle Antworten mit Kernaussage, nächstem Schritt, Rechenweg und Rechtsgrundlage.';
  const guide = () => {
    const d = document.createElement('div');
    d.className = 'lr-gate-box ia-gate-bar'; d.setAttribute('role', 'note');
    d.innerHTML = `<span><strong>Vorschau.</strong> Mit Zugang sofort offen: ${OPEN}</span>
      <span class="lr-gate-act"><a class="btn btn-dark" href="/pricing">Zugang freischalten</a>${user() ? '' : '<a class="ck-link" href="/auth/login">Schon Kunde? Anmelden</a>'}</span>`;
    return d;
  };
  // Kopftext der Seite als kleiner Vorgeschmack (ohne Zugang) – mit Zugang wieder der normale Text.
  const TEASE = WISSEN ? (P === '/learn' ? '63 Antworten in vier Phasen – von „Was kann ich mir leisten?“ bis zum Bankgespräch. Einige Antworten sind als Leseprobe frei; alle Antworten mit Rechenweg und Rechtsgrundlage gibt es mit Zugang.' : 'Eine Frage aus der LeaseRun-Wissenszentrale. Die Antwort mit Rechenweg, Beispiel und nächstem Schritt gibt es mit Zugang.')
    : MUSTER ? 'So sehen die Unterlagen aus, die LeaseRun für Ihre Bank erstellt – Kennzahlen und der erste Abschnitt als Vorschau, die PDFs als Leseprobe.'
      : 'Rechnen Sie den Musterfall durch und sehen Sie, wie das Ergebnis aussieht – mit Ihren eigenen Zahlen nach der Freischaltung.';
  const heroText = (demo) => {
    const p = document.querySelector('.route-hero .container > p, .route-hero p');
    if (!p) return;
    if (demo) { if (p.dataset.orig === undefined) p.dataset.orig = p.textContent; if (p.textContent !== TEASE) p.textContent = TEASE; }
    else if (p.dataset.orig !== undefined) { p.textContent = p.dataset.orig; delete p.dataset.orig; }
  };
  const placeGuide = () => {
    const main = document.querySelector('main'); if (!main || main.querySelector('.ia-gate-bar')) return;
    const host = main.querySelector('.route-search, .calc-pages > .crumbs, .calc-pages, form[data-bcc], .ex-grid');
    const g = guide();
    if (host && host.classList.contains('crumbs')) host.after(g); else if (host && host.classList.contains('calc-pages')) host.prepend(g); else if (host) host.before(g); else main.prepend(g);
  };

  // ---------- Wissenszentrale: auf der Website nur Frage, Kernaussage und nächster Schritt ----------
  // Die ausführliche Antwort steht nicht im Seitenquelltext; Kunden laden sie nach der Anmeldung vom Server.
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lnk = (t) => esc(t).replace(/https:\/\/[^\s<]*[^\s<.,;)]/g, (u) => `<a class="ck-link" href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https:\/\/(www\.)?/, '')}</a>`);
  // Einstellungen aus dem Web-Admin (Freischaltung): welche Bereiche ohne Zugang nur Vorschau sind.
  let GATE = { wissen: 'vorschau', rechner: 'vorschau', beispiele: 'vorschau' };
  // Öffentliche Einstellungen (/api/site-config) robust abrufen: höchstens 5 s warten, bei Fehler ein Wiederholversuch nach 2 s,
  // sonst still der zuletzt gespeicherte Stand (sessionStorage) bzw. die eingebauten Standardwerte. Ein Abruf je Seite, geteilt mit hinweis.js.
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
  const areaOpen = () => (WISSEN && GATE.wissen === 'offen') || (CALC && GATE.rechner === 'offen') || (MUSTER && GATE.beispiele === 'offen');
  // Freigabe je Bereich (Tarif oder Einzelfreigabe im Web-Admin) – ia-open-wissen / -beispiele / -rechner von menu.js
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
      // Öffentliche Kurzantwort (fest im HTML): mit Zugang steht sie im vollständigen Teil – dann ausblenden, nicht doppeln.
      const kurz = host?.querySelector('.wq-kurz');
      if (kurz) kurz.hidden = want === 'paid';
      if (want === 'free' && kurz) {
        if (tag) { tag.textContent = 'Kurzantwort'; tag.className = 'wq-tag wq-free'; }
        el.innerHTML = `<p class="wq-hook">${esc(el.dataset.hook || 'Die vollständige Antwort zeigt Rechenweg, Beispiel und den nächsten Schritt.')}</p>`;
        return;
      }
      if (want === 'free') {
        const t = PREV.get(el.dataset.q);
        if (tag) { tag.textContent = t ? 'Leseprobe' : 'Mit Zugang'; tag.className = 'wq-tag ' + (t ? 'wq-free' : 'wq-lock'); }
        el.innerHTML = `${t ? `<div class="callout wq-teaser"><strong>Leseprobe</strong><p>${esc(t)}</p></div>` : ''}<p class="wq-hook">${esc(el.dataset.hook || 'Die vollständige Antwort zeigt Rechenweg, Beispiel und den nächsten Schritt.')}</p>`;
        return;
      }
      if (tag) { tag.textContent = ''; tag.className = 'wq-tag'; }
      if (want === 'paid') { const e = DET.get(el.dataset.q) || {}; el.innerHTML = `<div class="callout"><strong>Kurz gesagt</strong><p>${lnk(e.l1 || '')}</p></div>${e.next ? `<div class="next"><strong>Nächster Schritt:</strong> ${lnk(e.next)}</div>` : ''}${e.l2 ? `<h3 class="wq-h">Im Detail: Rechenweg, Rechtsgrundlage, Bankpraxis</h3><p class="wq-l2">${lnk(e.l2)}</p>` : ''}`; return; }
      el.innerHTML = '<p class="form-note">Antwort wird geladen …</p>';
      loadDetails().then(fillWissen).catch((e) => { el.dataset.state = 'err'; el.innerHTML = `<p class="form-note">${e.message === 'login' || e.message === '401' ? 'Bitte melden Sie sich erneut an, um die Antwort zu sehen.' : 'Die Antwort konnte gerade nicht geladen werden. Bitte die Seite neu laden.'}</p>`; });
    });
  };

  // ---------- Rechner: Beispielwerte zeigen, eigene Eingaben gesperrt ----------
  const NOFREE = /csv|herunterlad|drucken|pdf|link zum ergebnis|ins konto|kopieren/i;
  const lockCalc = () => {
    const main = document.querySelector('main'); if (!main) return;
    main.querySelectorAll('input:not([type=search]):not([data-gate]), select:not([data-gate]), textarea:not([data-gate])').forEach((el) => {
      if (el.closest('.cw-panel, .site-header, footer')) return;
      el.dataset.gate = el.disabled ? 'was' : '1'; el.disabled = true; el.classList.add('lr-demo-ctl');
    });
    main.querySelectorAll('button:not([data-gate]), a.btn:not([data-gate])').forEach((el) => {
      if (!NOFREE.test(el.textContent || '') || el.closest('.ia-gate-box')) return;
      el.dataset.gate = el.tagName === 'BUTTON' && el.disabled ? 'was' : '1';
      if (el.tagName === 'BUTTON') el.disabled = true; else { el.dataset.href = el.getAttribute('href') || ''; el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); }
      el.classList.add('lr-demo-ctl');
    });
  };
  // ---------- Mustermappe: Kennzahlen und erster Abschnitt als Einblick, der Rest mit Zugang ----------
  const lockMuster = () => {
    // Wie in der Wissenszentrale: alle Abschnitte sichtbar benannt, der erste als Leseprobe offen, die übrigen „Mit Zugang“.
    const rep = document.querySelector('main .report');
    if (rep && !rep.dataset.gateDone) {
      rep.dataset.gateDone = '1';
      // Abschnitte als Fragen wie in der Wissenszentrale: der erste offen als Leseprobe, die übrigen zeigen nur,
      // was mit Zugang zu sehen wäre (Inhalt bleibt ausgeblendet).
      const arts = [...rep.querySelectorAll('.route-accordion > article')];
      arts.forEach((a, k) => {
        const tag = a.querySelector('.route-q .wq-tag');
        if (tag) { tag.textContent = k ? 'Mit Zugang' : 'Leseprobe'; tag.className = 'wq-tag ia-gate-tag ' + (k ? 'wq-lock' : 'wq-free'); }
        if (!k) return;
        const body = a.querySelector('.route-a'); if (!body) return;
        [...body.children].forEach((el) => { el.dataset.gateHid = '1'; });
        const hook = document.createElement('p'); hook.className = 'wq-hook ia-gate-hook'; hook.textContent = a.dataset.hook || 'Diesen Abschnitt sehen Sie vollständig mit Zugang.';
        body.append(hook);
      });
      // Ältere Darstellung (Überschriften statt Fragen): erster Abschnitt offen, Rest ausgeblendet.
      if (!arts.length) [...rep.querySelectorAll(':scope > h2')].forEach((h, k) => {
        const tag = document.createElement('em'); tag.className = 'wq-tag ia-gate-tag ' + (k ? 'wq-lock' : 'wq-free'); tag.textContent = k ? 'Mit Zugang' : 'Leseprobe';
        h.append(' ', tag);
        if (!k) return;
        const labels = [];
        for (let el = h.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
          if (el.matches('#print')) continue;
          el.querySelectorAll('tr').forEach((tr) => { const c = tr.querySelector('th, td'); const t = (c?.textContent || '').trim(); if (t && t.length < 40 && labels.length < 5) labels.push(t); });
          el.dataset.gateHid = '1';
        }
        // Kleiner Einblick: was der Abschnitt enthält (nur Bezeichnungen, keine Werte).
        const note = document.createElement('p'); note.className = 'lr-gate-note ia-gate-sec';
        note.textContent = labels.length ? `Enthält: ${labels.join(', ')} …` : 'Mit Zugang vollständig sichtbar.';
        h.after(note);
      });
    }
    document.querySelectorAll('main .ex-grid a[href*="/api/mustermappe"]:not([href*="download"])').forEach((a) => {
      const box = a.parentElement; if (!box || box.nextElementSibling?.classList.contains('lr-gate-note')) return;
      const n = document.createElement('p'); n.className = 'lr-gate-note'; n.textContent = 'Ansehen zeigt eine Leseprobe – das ganze PDF gibt es mit Zugang.';
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
      if (win) win.location.href = url; else { const d = document.createElement('a'); d.href = url; d.download = /analyse/.test(a.href) ? 'LeaseRun_Muster_Objekt-Analyse.pdf' : 'LeaseRun_Muster_Kreditmappe.pdf'; d.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { if (win) win.close(); location.href = a.href; }
  });
  const unlock = () => {
    document.querySelectorAll('[data-gate]').forEach((el) => {
      if (el.dataset.gate === '1') { if ('disabled' in el && el.tagName !== 'A') el.disabled = false; if (el.dataset.href !== undefined) { el.setAttribute('href', el.dataset.href); el.removeAttribute('aria-disabled'); delete el.dataset.href; } }
      el.classList.remove('lr-demo-ctl'); delete el.dataset.gate;
    });
    document.querySelectorAll('.ia-gate-bar, .ia-gate-more, .ia-gate-note, .ia-gate-hook').forEach((b) => b.remove());
    document.querySelectorAll('.ia-gate-tag').forEach((t) => { if (t.closest('.route-q')) { t.textContent = ''; t.className = 'wq-tag'; } else t.remove(); });
    document.querySelectorAll('[data-gate-done]').forEach((e) => { delete e.dataset.gateDone; });
    heroText(false);
    document.querySelectorAll('[data-gate-hid]').forEach((e) => { delete e.dataset.gateHid; });
  };

  // Wissensinhalte (auch für Kunden) nicht kopier- oder druckbar: kein Markieren, Kopieren, Rechtsklick oder Ziehen.
  if (WISSEN) {
    const pc = document.createElement('style');
    pc.textContent = '.route-a,.wq-art{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}@media print{.route-a,.wq-art{display:none!important}main::after{content:"Die Inhalte der LeaseRun-Wissenszentrale sind nur online abrufbar.";display:block;padding:24px;font:16px/1.5 sans-serif}}';
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
    // Inhalte entstehen teils per Skript, und der Kundenstatus kommt erst nach der Prüfung – beides beobachten.
    new MutationObserver(() => { if (on || WISSEN) apply(); }).observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
    new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
