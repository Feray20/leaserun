// Startseite: Finanzierungs-Ampel und kleine Helfer (keine Immobiliensuche mehr – Objekte kommen per Exposé-Import).
const $ = (id) => document.getElementById(id);

// Finanzierungs-Ampel im Kopfbereich: 3 Schritte (Budget, Objekt, Nutzung) mit Schiebereglern und Schnellwahl,
// Ergebnis als Tacho und Ampeln statt Fachbegriffen. Rechnet ausschließlich im Browser; gespeichert wird nur lokal.
const qz = $('qz');
if (qz) {
  import('./calc.mjs?v=892f3666').then(({ einstieg, kaufnebenkosten, monthlyRate }) => {
    const KEY = 'lr-qz';
    const IDS = ['qz_e', 'qz_b', 'qz_p', 'qz_l', 'qz_r', 'qz_i', 'qz_t', 'qz_m'];
    const n = (id) => { const v = Number(String($(id).value).replace(',', '.')); return Number.isFinite(v) ? v : 0; };
    const E = (v) => Math.round(v).toLocaleString('de-DE') + ' €';
    let use = 'owner', step = 1;
    try { const st = JSON.parse(localStorage.getItem(KEY) || '{}'); IDS.forEach((id) => { if (st[id] != null && $(id)) $(id).value = st[id]; }); if (st.use === 'investor') use = 'investor'; } catch { /* ohne Speicher */ }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...Object.fromEntries(IDS.map((id) => [id, $(id).value])), use })); } catch { /* ohne Speicher */ } };
    const outs = () => {
      [['qz_e', ''], ['qz_b', ' / Monat'], ['qz_p', ''], ['qz_r', ' / Monat']].forEach(([id, suf]) => { const o = $(id + '_o'); if (o) o.textContent = E(n(id)) + suf; });
      qz.querySelectorAll('.qz-range').forEach((r) => r.style.setProperty('--pct', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'));
      qz.querySelectorAll('.qz-chips').forEach((c) => c.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === n(c.dataset.for)))));
    };
    // Ampel: 0 = grün, 1 = gelb, 2 = rot
    const LBL = ['Passt', 'Knapp', 'Kritisch'];
    const lv = [];
    const lamp = (lvl, title, value, text, weight = 2) => { lv.push(Math.min(lvl, weight)); return `<li class="qz-lamp l${lvl}"><span class="qz-dot" aria-hidden="true"></span><div><strong>${title}</strong><b>${value}</b><small>${text}</small></div><em>${LBL[lvl]}</em></li>`; };
    const gauge = (pct) => {
      const v = Math.max(0, Math.min(1.5, pct)), a = Math.PI * (1 - v / 1.5), x = 60 + 46 * Math.cos(a), y = 62 - 46 * Math.sin(a);
      const lvl = pct <= 0.9 ? 0 : pct <= 1.1 ? 1 : 2;
      return `<div class="qz-gauge l${lvl}"><svg viewBox="0 0 120 70" aria-hidden="true"><path d="M14 62A46 46 0 0 1 74.2 18.3" class="g0"/><path d="M74.2 18.3A46 46 0 0 1 90.8 27.8" class="g1"/><path d="M90.8 27.8A46 46 0 0 1 106 62" class="g2"/><line x1="60" y1="62" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="gn"/><circle cx="60" cy="62" r="4" class="gn"/></svg>
        <div><strong>${Math.round(pct * 100)}\u00a0%</strong><span>deines Monatsbudgets</span></div></div>`;
    };
    const result = () => {
      lv.length = 0;
      const equity = n('qz_e'), budget = n('qz_b'), price = n('qz_p'), land = $('qz_l').value, rent = n('qz_r');
      const i = n('qz_i') / 100, t = n('qz_t') / 100, broker = n('qz_m');
      const nk = kaufnebenkosten({ price, land, brokerPct: broker });
      if (!nk || !(price > 0)) { $('qz_out').innerHTML = '<p class="qz-fine">Bitte einen Kaufpreis wählen.</p>'; return; }
      const loan = Math.max(0, price + nk.total - equity);
      const rate = monthlyRate(loan, i, t), rateS = monthlyRate(loan, i + 0.02, t);
      let burden, burdenS, rows = [];
      const ekL = equity >= nk.total + price * 0.1 ? 0 : equity >= nk.total ? 1 : 2;
      rows.push(lamp(ekL, 'Eigenkapital', E(equity), ekL === 2 ? `Deckt die Kaufnebenkosten von ${E(nk.total)} nicht – die Bank müsste mehr als den Kaufpreis finanzieren.` : ekL === 1 ? `Deckt die Kaufnebenkosten (${E(nk.total)}), aber wenig darüber hinaus.` : `Deckt Kaufnebenkosten (${E(nk.total)}) und einen Teil des Kaufpreises.`));
      if (use === 'investor') {
        const e = einstieg({ price, rent, equity, land, ratePa: i, repaymentPa: t, brokerPct: broker, costSharePct: 15 });
        const eS = einstieg({ price, rent, equity, land, ratePa: i + 0.02, repaymentPa: t, brokerPct: broker, costSharePct: 15 });
        burden = Math.max(0, -e.cashflow); burdenS = Math.max(0, -eS.cashflow);
        const cover = e.rate > 0 ? (rent - e.costs) / e.rate : 9;
        const cL = cover >= 1 ? 0 : cover >= 0.8 ? 1 : 2;
        rows.push(lamp(cL, 'Miete trägt die Rate', `${Math.round(cover * 100)}\u00a0%`, cL === 0 ? 'Die Miete deckt nach Kosten die ganze Rate.' : `Die Miete deckt nach Kosten ${Math.round(cover * 100)}\u00a0% der Rate – den Rest zahlst du zu.`, 1));
        const tL = burden <= budget * 0.9 ? 0 : burden <= budget * 1.1 ? 1 : 2;
        rows.unshift(lamp(tL, 'Deine Zuzahlung', burden > 0 ? E(burden) + ' / Monat' : 'keine', burden > 0 ? `Rate ${E(e.rate)} minus Miete nach Kosten. Davon tilgst du ${E(e.firstPrincipal)} – das ist Vermögensaufbau.` : `Die Miete trägt Rate und Kosten. Tilgung im ersten Monat: ${E(e.firstPrincipal)}.`));
      } else {
        burden = rate; burdenS = rateS;
        const tL = rate <= budget * 0.9 ? 0 : rate <= budget * 1.1 ? 1 : 2;
        rows.unshift(lamp(tL, 'Monatliche Rate', E(rate), `Darlehen ${E(loan)} bei ${(i * 100).toLocaleString('de-DE')} % Zins und ${(t * 100).toLocaleString('de-DE')} % Tilgung. Hausgeld und Nebenkosten des Wohnens kommen hinzu.`));
      }
      const sL = burdenS <= budget ? 0 : burdenS <= budget * 1.2 ? 1 : 2;
      rows.push(lamp(sL, 'Zins-Puffer', `+2\u00a0% Zins → ${E(burdenS)}`, sL === 0 ? 'Auch bei 2 Prozentpunkten mehr Zins bleibst du im Budget.' : 'Steigt der Zins bei der Anschlussfinanzierung um 2 Prozentpunkte, wird es eng.'));
      const pct = budget > 0 ? burden / budget : 2;
      const worst = Math.max(...lv);
      const head = ['Das sieht tragfähig aus.', 'Machbar – mit ein paar Stellschrauben.', 'So wird es schwierig.'][worst];
      const tipTxt = worst === 0 ? 'Halte das Ergebnis fest und bereite die Kreditmappe für die Bank vor.' : worst === 1 ? 'Mehr Eigenkapital, ein günstigeres Objekt oder eine längere Zinsbindung verbessern das Bild.' : 'Prüfe Kaufpreis, Eigenkapital oder dein Monatsbudget – oder rechne ein anderes Objekt durch.';
      $('qz_out').innerHTML = `<div class="qz-sum l${worst}"><h3>${head}</h3><p>${tipTxt}</p></div>${gauge(pct)}<ul class="qz-lamps">${rows.join('')}</ul>`;
      try { window.iaTrack?.('qz_result', { use, worst }); } catch { /* ignore */ }
    };
    const show = (k) => {
      step = k;
      qz.querySelectorAll('.qz-step').forEach((f) => { f.hidden = Number(f.dataset.qz) !== k; });
      $('qz_count').textContent = k < 4 ? `Schritt ${k} von 3` : 'Dein Ergebnis';
      $('qz_bar').style.width = Math.min(100, (k / 3) * 100) + '%';
      if (k === 4) result();
      const f = qz.querySelector(`.qz-step[data-qz="${k}"]`);
      f?.querySelector('legend, h3, input, button')?.focus?.({ preventScroll: true });
      if (k > 1 && qz.getBoundingClientRect().top < 0) qz.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const setUse = (u) => {
      use = u;
      qz.querySelectorAll('[data-use]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.use === u)));
      $('qz_rw').hidden = u !== 'investor';
    };
    qz.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); save(); show(Number(go.dataset.go)); return; }
      const ch = e.target.closest('.qz-chips button'); if (ch) { $(ch.parentElement.dataset.for).value = ch.dataset.v; outs(); save(); if (step === 4) result(); return; }
      const us = e.target.closest('[data-use]'); if (us) { setUse(us.dataset.use); save(); }
    });
    qz.addEventListener('input', () => { outs(); save(); if (step === 4) result(); });
    qz.addEventListener('submit', (e) => e.preventDefault());
    document.querySelectorAll('[data-qz-focus]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); qz.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('qz_e').focus({ preventScroll: true }), 350); }));
    setUse(use); outs(); show(1);
  });
}

// Erklär-Hinweise (?): Klick oder Tastatur öffnet, Escape oder Klick daneben schließt.
document.addEventListener('click', (e) => {
  const b = e.target.closest('.tip');
  document.querySelectorAll('.tip[aria-expanded="true"]').forEach((x) => { if (x !== b) { x.setAttribute('aria-expanded', 'false'); x.nextElementSibling.hidden = true; } });
  if (b) { e.preventDefault(); const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); b.nextElementSibling.hidden = !open; }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.tip[aria-expanded="true"]').forEach((x) => { x.setAttribute('aria-expanded', 'false'); x.nextElementSibling.hidden = true; }); });

// „Kreditmappe erstellen“ öffnet direkt den Kaufdialog (mit Garantie am Bezahlknopf); ohne JavaScript führt der Link in die Anwendung.
document.querySelectorAll('.km-go').forEach((a) => a.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const [{ openBuy }, P] = await Promise.all([import('./buy.mjs?v=892f3666'), fetch('/data/preise.json').then((r) => r.json())]);
    const o = P.privat.plans.find((x) => x.id === 'credit-map');
    if (o) { openBuy(o); return; }
  } catch { /* weiter mit Link */ }
  location.href = a.href;
}));

// Kreditmappe: 3D-Neigung bei Mausbewegung (nur Maus/Trackpad, nicht bei reduzierter Bewegung).
(() => {
  const m = document.querySelector('.km-mock');
  if (!m || !matchMedia('(hover:hover) and (pointer:fine)').matches || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  let raf = 0;
  m.addEventListener('pointermove', (e) => {
    const r = m.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { m.classList.add('is-tilting'); m.style.setProperty('--ry', `${(x * 14).toFixed(2)}deg`); m.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`); m.style.setProperty('--px', `${(-x * 18).toFixed(1)}px`); m.style.setProperty('--py', `${(-y * 14).toFixed(1)}px`); });
  });
  m.addEventListener('pointerleave', () => { cancelAnimationFrame(raf); m.classList.remove('is-tilting'); m.style.setProperty('--ry', '0deg'); m.style.setProperty('--rx', '0deg'); m.style.setProperty('--px', '0px'); m.style.setProperty('--py', '0px'); });
})();
