// Startseite: Immobiliensuche öffnet die Trefferlisten der Portale (keine Inhalte von Portalen auf ImmoAdv).
import { portalLinks } from './calc.mjs';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IDS = ['h_art', 'h_ort', 'h_land', 'h_pmin', 'h_price', 'h_area', 'h_rooms'];
const form = $('homeSearch'), box = $('homePortals');
if (form && box) {
  try { const s = JSON.parse(localStorage.getItem('ia-home-search') || '{}'); IDS.forEach((id) => { if (s[id] != null && $(id)) $(id).value = s[id]; }); } catch { /* ohne Speicher */ }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ort = $('h_ort').value.trim();
    if (!ort) { $('h_ort').focus(); return; }
    try { localStorage.setItem('ia-home-search', JSON.stringify(Object.fromEntries(IDS.map((id) => [id, $(id).value])))); } catch { /* ohne Speicher */ }
    const links = portalLinks({ land: $('h_land').value, kreis: '', ort, art: $('h_art').value, minPrice: Number($('h_pmin').value) || 0, maxPrice: Number($('h_price').value) || 0, minArea: Number($('h_area').value) || 0, minRooms: Number($('h_rooms').value) || 0 });
    const q = new URLSearchParams({ ort, land: $('h_land').value, art: $('h_art').value, ...Object.fromEntries([['preisab', 'h_pmin'], ['preis', 'h_price'], ['flaeche', 'h_area'], ['zimmer', 'h_rooms']].filter(([, id]) => $(id).value).map(([k, id]) => [k, $(id).value])) });
    box.innerHTML = links.map((l) => `<a class="hp-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow"><strong>${l.name} ↗</strong><span>Übergeben: ${esc(l.filters)}</span></a>`).join('') +
      `<a class="hp-link hp-app" href="/app/dashboard?${q}#suche"><strong>Mehr Filter und Analyse</strong><span>in der Anwendung →</span></a>`;
    box.hidden = false;
    box.querySelector('a')?.focus();
  });
}

// Schnellrechner im Kopfbereich: Kapitalanlage (Rendite, Cashflow, Rate) oder Eigenheim (Rate, Nebenkosten, Leistbarkeit).
// Rechnet ausschließlich im Browser; nichts wird gesendet oder gespeichert (außer den Eingaben lokal in diesem Browser).
const qc = $('qc');
if (qc) {
  import('./calc.mjs').then(({ einstieg, kaufnebenkosten, monthlyRate }) => {
    const QIDS = ['qc_p', 'qc_r', 'qc_e', 'qc_l', 'qc_i', 'qc_t', 'qc_m', 'qc_c'];
    const n = (id) => { const v = Number(String($(id).value).replace(',', '.')); return Number.isFinite(v) ? v : 0; };
    const E = (v) => (Math.round(v)).toLocaleString('de-DE') + ' €';
    const P = (v, d = 2) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';
    let mode = 'investor';
    try { const s = JSON.parse(localStorage.getItem('ia-qc') || '{}'); QIDS.forEach((id) => { if (s[id] != null) $(id).value = s[id]; }); if (s.mode === 'owner') mode = 'owner'; } catch { /* ohne Speicher */ }
    const tile = (k, v, t, tone = '') => `<div class="qc-tile${tone ? ' ' + tone : ''}"><small>${k}</small><strong>${v}</strong>${t ? `<span>${t}</span>` : ''}</div>`;
    const run = () => {
      try { localStorage.setItem('ia-qc', JSON.stringify({ ...Object.fromEntries(QIDS.map((id) => [id, $(id).value])), mode })); } catch { /* ohne Speicher */ }
      const price = n('qc_p'), r = n('qc_r'), equity = n('qc_e'), land = $('qc_l').value, i = n('qc_i') / 100, t = n('qc_t') / 100, broker = n('qc_m');
      const out = $('qc_out');
      if (!(price > 0)) { out.innerHTML = '<p class="qc-note">Bitte einen Kaufpreis eintragen.</p>'; return; }
      if (mode === 'investor') {
        const e = einstieg({ price, rent: r, equity, land, ratePa: i, repaymentPa: t, brokerPct: broker, costSharePct: n('qc_c') });
        if (!e) { out.innerHTML = ''; return; }
        const gross = (r * 12 / price) * 100;
        out.innerHTML = `<div class="qc-tiles">${tile('Bruttomietrendite', P(gross), 'Jahreskaltmiete ÷ Kaufpreis', gross >= 4.5 ? 'ok' : gross < 3.5 ? 'warn' : '')}
          ${tile('Cashflow vor Steuern / Monat', (e.cashflow >= 0 ? '+' : '') + E(e.cashflow), e.cashflow >= 0 ? 'trägt sich selbst' : 'Ihre monatliche Zuzahlung', e.cashflow >= 0 ? 'ok' : 'warn')}
          ${tile('Rate / Monat', E(e.rate), `davon ${E(e.firstPrincipal)} Tilgung im 1. Monat`)}</div>
          <p class="qc-note">Darlehen ${E(e.loan)} · Kaufnebenkosten ${E(e.nk.total)} (${P(e.nk.totalPct, 1)})${e.equityCoversCosts ? '' : ' · <strong>Eigenkapital deckt die Nebenkosten nicht</strong>'} · nicht umlagefähige Kosten ${E(e.costs)}/Monat angenommen.</p>`;
      } else {
        const nk = kaufnebenkosten({ price, land, brokerPct: broker });
        if (!nk) { out.innerHTML = ''; return; }
        const loan = Math.max(0, price + nk.total - equity);
        const rate = monthlyRate(loan, i, t);
        const wish = r;
        const maxLoan = i + t > 0 ? (wish * 12) / (i + t) : 0;
        const maxPrice = (maxLoan + equity) / (1 + nk.totalPct / 100);
        const income = rate / 0.35;
        out.innerHTML = `<div class="qc-tiles">${tile('Rate / Monat', E(rate), `Darlehen ${E(loan)}`)}
          ${tile('Kaufnebenkosten', E(nk.total), P(nk.totalPct, 1) + ' – zahlen Sie meist aus Eigenkapital', equity >= nk.total ? 'ok' : 'warn')}
          ${tile(wish > 0 ? 'Mit Ihrer Wunschrate leistbar' : 'Wunschrate eintragen', wish > 0 ? 'bis ca. ' + E(maxPrice) : '–', wish > 0 ? `Kaufpreis bei ${E(wish)} Rate` : 'Feld „Wunschrate“ oben', wish > 0 ? (maxPrice >= price ? 'ok' : 'warn') : '')}</div>
          <p class="qc-note">Faustregel: Die Rate sollte höchstens rund 35 % des Haushaltsnettos ausmachen – hier also ab ca. ${E(income)} netto im Monat. Entscheidend für die Bank ist Ihre vollständige Haushaltsrechnung. Hausgeld, Rücklagen und Nebenkosten des Wohnens kommen zur Rate hinzu.</p>`;
      }
    };
    const setMode = (m) => {
      mode = m;
      qc.querySelectorAll('[data-qm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.qm === m)));
      $('qc_rl').textContent = m === 'owner' ? 'Wunschrate pro Monat (€)' : 'Kaltmiete pro Monat (€)';
      $('qc_cw').hidden = m === 'owner';
      if (m === 'owner' && n('qc_r') === 1100) $('qc_r').value = 1400;
      if (m === 'investor' && n('qc_r') === 1400) $('qc_r').value = 1100;
      run();
    };
    qc.querySelectorAll('[data-qm]').forEach((b) => b.onclick = () => setMode(b.dataset.qm));
    qc.addEventListener('input', run);
    qc.addEventListener('submit', (e) => e.preventDefault());
    setMode(mode);
  });
}
