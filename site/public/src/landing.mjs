// Startseite (B2C): Beispielrechnung, dezente Einblendungen, mobiler Sticky-CTA und Conversion-Ereignisse.
// Rechnet ausschließlich im Browser mit dem gemeinsamen Rechenkern; es wird nichts gespeichert.
// Ereignisse gehen an die cookielose Reichweitenmessung (track.js) – ohne Eingabewerte, nur Ereignisname und Ort.
// Alte Sprungmarken der verschobenen Startseiten-Abschnitte auf die neuen Unterseiten weiterleiten.
{ const moved = { '#warum': '/learn/warum-investieren' }; if (moved[location.hash]) location.replace(moved[location.hash]); }
import { demoAnalyse } from './calc.mjs?v=892f3666';

const $ = (id) => document.getElementById(id);
const ev = (name, where) => { try { window.iaTrack?.(name, where ? { plan: String(where).slice(0, 40) } : undefined); } catch { /* Messung darf nie stören */ } };
const once = new Set();
const evOnce = (name, where) => { if (once.has(name)) return; once.add(name); ev(name, where); };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Ereignisse ----------
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-track]');
  if (a) ev(a.dataset.track, a.dataset.trackPlan);
});
document.querySelectorAll('.lp-faq-list details').forEach((d) => d.addEventListener('toggle', () => {
  if (d.open) ev('faq_open', d.querySelector('summary')?.firstChild?.textContent?.trim().slice(0, 40));
}));
const qz = $('qz');
if (qz) qz.addEventListener('click', (e) => { if (e.target.closest?.('[data-go="2"]')) evOnce('property_check_started', 'ampel'); });

// ---------- Beispielrechnung ----------
const form = $('lpDemo');
if (form) {
  const E = (v) => Math.round(v).toLocaleString('de-DE') + ' €';
  const P = (v, d = 1) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';
  const LV = { ok: ['l0', 'Passt'], warn: ['l1', 'Prüfen'], bad: ['l2', 'Kritisch'] };
  const NK = { grest: 'Grunderwerbsteuer', notar: 'Notar', grundbuch: 'Grundbuch', makler: 'Makler' };
  const ids = { price: 'lpd_price', rent: 'lpd_rent', equity: 'lpd_equity', ratePct: 'lpd_rate', netIncome: 'lpd_income' };
  let use = 'owner';

  const li = (cls, chip, title, text) => {
    const el = document.createElement('li'); el.className = cls;
    const em = document.createElement('em'); em.textContent = chip;
    const sp = document.createElement('span'); const st = document.createElement('strong'); st.textContent = title;
    sp.append(st, text); el.append(em, sp); return el;
  };
  const text = (l, d) => {
    if (l.key === 'haushalt') return ['Monatliche Belastung', l.surplus < 0 ? `Nach Rate und Lebenshaltung fehlen ${E(-l.surplus)} im Monat.` : `Nach Rate und Lebenshaltung bleiben ${E(l.surplus)} im Monat übrig.`];
    if (l.key === 'eigenkapital') return ['Eigenkapital', l.status === 'ok' ? `Deckt Nebenkosten, 10 % des Kaufpreises und eine Reserve (Richtwert ${E(l.target)}).`
      : l.status === 'warn' ? `Deckt die Nebenkosten, liegt aber unter dem Richtwert von ${E(l.target)} (Nebenkosten, 10 % des Kaufpreises und Reserve).`
      : `Deckt nicht einmal die Nebenkosten von ${E(d.nk.total)} – die finanziert die Bank selten mit.`];
    if (l.key === 'objekt') return ['Objekt', `Bruttomietrendite ${P(l.yieldPct)}, Instandhaltung ist eingeplant.`];
    return ['Zins-Puffer +2 %', l.surplus < 0 ? `Mit 2 Prozentpunkten mehr Zins fehlen ${E(-l.surplus)} im Monat.` : `Auch mit 2 Prozentpunkten mehr Zins bleiben ${E(l.surplus)} übrig.`];
  };

  const render = () => {
    const input = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, Number($(id).value)]));
    let d;
    try { d = demoAnalyse({ ...input, use }); } catch { d = null; }
    const res = $('lpd_result');
    if (!d || !d.nk) { res.dataset.state = 'error'; $('lpd_label').textContent = 'Beispiel konnte nicht berechnet werden – bitte Werte ändern.'; return; }
    res.dataset.state = '';
    $('lpd_price_o').textContent = E(input.price);
    $('lpd_rent_o').textContent = E(input.rent);
    $('lpd_equity_o').textContent = E(input.equity);
    $('lpd_rate_o').textContent = P(input.ratePct);
    $('lpd_income_o').textContent = E(input.netIncome);
    $('lpd_qm').textContent = `${E(input.price / d.input.area)} pro m²`;
    form.querySelectorAll('.qz-range').forEach((r) => r.style.setProperty('--pct', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'));

    $('lpd_k_price').textContent = E(input.price);
    $('lpd_k_nk').textContent = E(d.nk.total);
    $('lpd_k_nkparts').replaceChildren(...d.nk.parts.map((p) => { const x = document.createElement('li'); x.textContent = `${NK[p.key] || p.label} ${E(p.amount)}`; return x; }));
    $('lpd_k_eq_v').textContent = E(input.equity);
    $('lpd_k_eq').textContent = `Eigenkapitalquote ${P(d.equityQuotePct)}`;
    $('lpd_k_loan').textContent = E(d.loan);
    $('lpd_k_rate').textContent = E(d.rate);
    $('lpd_k_burden').textContent = `${P(d.burdenPct)} des Haushaltsnettos · Zins + Tilgung`;

    $('lpd_score').textContent = d.score == null ? '–' : String(d.score);
    $('lpd_label').textContent = d.label;
    $('lpd_bar').style.width = (d.score ?? 0) + '%';
    res.dataset.level = d.score == null ? '1' : d.score >= 65 ? '0' : d.score >= 45 ? '1' : '2';
    const n = d.openPoints + 2;
    $('lpd_open').textContent = `${n} Punkt${n === 1 ? '' : 'e'} prüfen`;
    $('lpd_risks').replaceChildren(
      li('l0', 'Passt', 'Kosten vollständig berücksichtigt', 'Grunderwerbsteuer, Notar, Grundbuch und Makler sind in der Finanzierung enthalten.'),
      ...d.lamps.map((l) => { const [c, chip] = LV[l.status]; const [t, x] = text(l, d); return li(c, chip, t, x); }),
      li('l1', 'Prüfen', 'Unterlagen prüfen', 'Teilungserklärung, Protokolle und Energieausweis gehören vor den Kauf auf den Tisch.'),
      li('l1', 'Prüfen', 'Finanzierung individuell prüfen', 'Zins und Konditionen legt die Bank fest – der Wert hier ist eine Annahme.'),
      li('li', 'Hinweis', 'Anschlussfinanzierung', `Nach 10 Jahren bleiben ${E(d.rest10)} Restschuld, die zu dann gültigen Zinsen weiterfinanziert werden.`),
    );
  };

  form.addEventListener('input', () => { render(); evOnce('demo_interaction', 'slider'); });
  form.querySelectorAll('[data-lpuse]').forEach((b) => b.addEventListener('click', () => {
    use = b.dataset.lpuse;
    form.querySelectorAll('[data-lpuse]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    $('lpd_rent_w').hidden = use !== 'investor';
    render(); evOnce('demo_interaction', 'use');
  }));
  render();

  // Orientierungswert beim ersten Sichtkontakt hochzählen (nicht bei reduzierter Bewegung).
  const scoreEl = $('lpd_score');
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      if (!es.some((x) => x.isIntersecting)) return;
      io.disconnect();
      const target = Number(scoreEl.textContent); if (!Number.isFinite(target)) return;
      const t0 = performance.now(), dur = 700;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); scoreEl.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }, { threshold: 0.5 });
    io.observe(scoreEl);
  }
}

// ---------- Dezente Einblendung beim Scrollen ----------
if (!reduce && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('lp-anim');
  const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('lp-in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
}

// ---------- Preise gesehen ----------
const preise = $('preise');
if (preise && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); evOnce('pricing_view'); } }, { threshold: 0.3 });
  io.observe(preise);
}

// ---------- Mobiler Sticky-CTA ----------
// Erscheint, sobald der Hero aus dem Bild ist; verschwindet, solange Ampel, Demo-CTA oder Abschluss-CTA sichtbar sind.
const sticky = $('lpSticky');
const hero = document.querySelector('.home-hero');
if (sticky && hero && 'IntersectionObserver' in window) {
  const seen = new Map();
  const update = () => {
    const show = !seen.get(hero) && ![...seen.entries()].some(([el, v]) => el !== hero && v);
    sticky.hidden = !show;
    document.body.classList.toggle('lp-sticky-on', show);
    document.body.classList.toggle('lp-hero-in', !!seen.get(hero)); // Fragen-Button verdeckt sonst den Hero-CTA auf kleinen Handys
  };
  const io = new IntersectionObserver((es) => { es.forEach((x) => seen.set(x.target, x.isIntersecting)); update(); });
  [hero, qz, document.querySelector('.lp-final'), document.querySelector('.lp-after-demo')].filter(Boolean).forEach((el) => io.observe(el));
}
