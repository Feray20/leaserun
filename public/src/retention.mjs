// Werkzeuge mit Nutzen über Monate: Profi-Monatsbericht mit Fristen und Anlage-V-Hilfe; Einsteiger-Sparplan mit monatlichem Check-in.
// Alle Berechnungen im Browser aus den Angaben im Konto. Keine Steuer- oder Finanzierungsberatung.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => (v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('de-DE') + ' €');
const n = (v) => Number(v) || 0;
const ym = (d) => d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const addM = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const monthsUntil = (d) => Math.round((d.getTime() - Date.now()) / (30.44 * 864e5));

export function loanOf(o) { return n(o.loan) || Math.max(0, Math.round(n(o.price) * (1 + n(o.purchaseCostPct) / 100) - n(o.equity))); }
// Zins und Tilgung je Monat ab Auszahlung (Annuität mit fester Anfangsrate).
export function schedule(o) {
  const L = loanOf(o), z = n(o.interestPct) / 100, t = n(o.repaymentPct) / 100;
  const rate = (L * (z + t)) / 12;
  const start = o.payoutDate ? new Date(o.payoutDate) : null;
  return { L, z, rate, start, restAt(date) { if (!start || !L || !rate) return L; const m = Math.max(0, Math.round((date - start) / (30.44 * 864e5))); let s = L; for (let i = 0; i < m && s > 0; i++) s -= rate - (s * z) / 12; return Math.max(0, s); },
    interestInYear(y) { if (!start || !L || !rate) return L * z; let s = L, sum = 0; const d = new Date(start); for (let i = 0; i < 600 && s > 0; i++) { const zi = (s * z) / 12; if (d.getFullYear() === y) sum += zi; if (d.getFullYear() > y) break; s -= rate - zi; d.setMonth(d.getMonth() + 1); } return sum; } };
}
export function afaRate(o) { const y = n(o.yearBuilt); return y >= 2023 ? 0.03 : y && y < 1925 ? 0.025 : 0.02; }

// Fristen je Objekt (nächste 36 Monate bzw. offen).
export function deadlines(o) {
  const out = [];
  if (o.payoutDate && n(o.fixedYears) > 0) { const e = addM(new Date(o.payoutDate), n(o.fixedYears) * 12); const m = monthsUntil(e); if (m <= 60) out.push({ m, t: `Zinsbindung endet ${ym(e)}`, tip: m <= 60 && m > 6 ? 'Forward-Darlehen möglich' : 'Anschluss jetzt vergleichen' }); }
  if (o.purchaseDate) {
    const k = new Date(o.purchaseDate);
    const s = addM(k, 120), ms = monthsUntil(s); if (ms > 0 && ms <= 36) out.push({ m: ms, t: `10-Jahres-Frist (§ 23 EStG) endet ${ym(s)}`, tip: 'Verkauf danach steuerfrei' });
    const f = addM(k, 36), mf = monthsUntil(f); if (mf > 0) out.push({ m: mf, t: `15-%-Grenze (§ 6 Abs. 1 Nr. 1a EStG) bis ${ym(f)}`, tip: 'Instandsetzung bis dahin im Blick behalten' });
  }
  if (o.lastRentChange) { const r = addM(new Date(o.lastRentChange), 12), mr = monthsUntil(r); out.push({ m: Math.max(0, mr), t: mr <= 0 ? 'Mieterhöhung kann verlangt werden' : `Mieterhöhung frühestens verlangbar ab ${ym(r)}`, tip: 'Mieterhöhungs-Rechner nutzen', href: '/rechner/mieterhoehung' }); }
  return out.sort((a, b) => a.m - b.m);
}

function profiReport(objs) {
  const now = new Date();
  const rows = objs.map((o) => {
    const sc = schedule(o), rent = n(o.rent) * (1 - n(o.vacancyPct) / 100);
    const cf = rent - n(o.nonRecoverable) - n(o.maintenance) - sc.rate;
    return { o, rate: sc.rate, rest: sc.restAt(now), cf, dl: deadlines(o) };
  });
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return { rows, rest: sum('rest'), cf: sum('cf'), rate: sum('rate'), dl: rows.flatMap((r) => r.dl.map((d) => ({ ...d, name: r.o.name }))).sort((a, b) => a.m - b.m).slice(0, 8) };
}

export function anlageVCsv(objs, year) {
  const head = ['Objekt', 'Mieteinnahmen (geschätzt)', 'Schuldzinsen (berechnet)', 'AfA (linear, Gebäudeanteil)', 'Nicht umlagefähige Kosten', 'Instandhaltung (Ansatz)', 'Überschuss/Verlust (vereinfacht)'];
  const lines = objs.map((o) => {
    const ein = n(o.rent) * 12 * (1 - n(o.vacancyPct) / 100), zins = schedule(o).interestInYear(year);
    const afa = n(o.price) * (n(o.buildingSharePct) || 75) / 100 * afaRate(o) * (o.purchaseDate && new Date(o.purchaseDate).getFullYear() === year ? (12 - new Date(o.purchaseDate).getMonth()) / 12 : 1);
    const nk = n(o.nonRecoverable) * 12, inst = n(o.maintenance) * 12;
    return [o.name, ein, zins, afa, nk, inst, ein - zins - afa - nk - inst];
  });
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : '"' + String(v).replace(/"/g, '""') + '"');
  return '﻿' + [head.map(fmt).join(';'), ...lines.map((l) => l.map(fmt).join(';')), '', fmt(`Hilfe für die Anlage V ${year} – berechnet aus Ihren Angaben in ImmoAdv. Keine Steuerberatung; maßgeblich sind Ihre Belege (Kontoauszüge, Zinsbescheinigung der Bank, Rechnungen).`)].join('\n');
}

export function mountRetention(grid, { mode, d, u, saveData, paid }) {
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.name);
  if (mode === 'profi') {
    const el = document.createElement('article');
    el.className = 'dash-card wide ret-card'; el.dataset.view = 'start'; el.id = 'monatsbericht';
    if (!objs.length) { el.innerHTML = `<h3>Monatsbericht</h3><p class="form-note">Sobald Sie ein Objekt mit Darlehensdaten anlegen, sehen Sie hier jeden Monat Cashflow, Restschuld und anstehende Fristen.</p>`; grid.append(el); return; }
    const r = profiReport(objs), y = new Date().getFullYear();
    el.innerHTML = `<div class="ret-h"><h3>Monatsbericht ${esc(ym(new Date()))}</h3><span class="form-note">${objs.length} Objekt${objs.length === 1 ? '' : 'e'}</span></div>
      <div class="ret-kpis"><div><small>Cashflow vor Steuern / Monat</small><strong class="${r.cf < 0 ? 'neg' : 'pos'}">${E(r.cf)}</strong></div><div><small>Raten gesamt / Monat</small><strong>${E(r.rate)}</strong></div><div><small>Restschuld heute</small><strong>${E(r.rest)}</strong></div></div>
      <h4 class="ret-sub">Anstehende Fristen</h4>${r.dl.length ? `<ul class="ret-dl">${r.dl.map((x) => `<li class="${x.m <= 12 ? 'hot' : ''}"><span><strong>${esc(x.name)}</strong> · ${esc(x.t)}</span><small>${x.href ? `<a href="${x.href}">${esc(x.tip)}</a>` : esc(x.tip)}</small></li>`).join('')}</ul>` : '<p class="form-note">Keine Fristen in Sicht. Tipp: Kaufdatum, Auszahlungsdatum, Zinsbindung und letzte Mietänderung im Objekt eintragen.</p>'}
      <div class="ret-act">${paid ? `<button type="button" class="btn btn-outline" id="anlV">Anlage-V-Hilfe ${y - 1} (CSV)</button><button type="button" class="btn btn-ghost" id="anlV2">${y} bisher</button>` : `<a class="btn btn-outline" href="#angebot">Anlage-V-Hilfe mit Investor Pro</a>`}</div>
      <p class="form-note">Berechnet aus Ihren Angaben (Instandhaltung und nicht umlagefähige Kosten als Monatswerte). Keine Steuerberatung.</p>`;
    grid.append(el);
    const dl = (yy) => { const b = new Blob([anlageVCsv(objs, yy)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `immoadv-anlage-v-${yy}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    el.querySelector('#anlV')?.addEventListener('click', () => dl(y - 1));
    el.querySelector('#anlV2')?.addEventListener('click', () => dl(y));
    return;
  }
  // Einsteiger: Sparplan bis zum Eigenkapital-Ziel mit monatlichem Check-in.
  const p = d.profile || (d.profile = {});
  const el = document.createElement('article');
  el.className = 'dash-card wide ret-card'; el.dataset.view = 'start'; el.id = 'sparplan';
  const paint = () => {
    const goal = n(p.savingsGoal) || Math.round((n(p.targetPrice) || 300000) * 0.2 / 1000) * 1000;
    const have = n(p.equity), rate = n(p.savingsMonthly), left = Math.max(0, goal - have);
    const months = rate > 0 ? Math.ceil(left / rate) : null, pct = goal ? Math.min(100, Math.round((have / goal) * 100)) : 0;
    const log = Array.isArray(p.savingsLog) ? p.savingsLog.slice(-12) : [];
    const thisM = new Date().toISOString().slice(0, 7), done = log.some((x) => x.m === thisM);
    const max = Math.max(goal, ...log.map((x) => n(x.v)), 1);
    el.innerHTML = `<div class="ret-h"><h3>Mein Sparplan bis zum Eigenkapital</h3><span class="form-note">${pct} % geschafft</span></div>
      <div class="ret-bar" role="img" aria-label="${pct} Prozent des Ziels"><i style="width:${pct}%"></i></div>
      <div class="ret-kpis"><div><small>Angespart</small><strong>${E(have)}</strong></div><div><small>Ziel</small><strong>${E(goal)}</strong></div><div><small>${months === 0 ? 'Ziel erreicht' : 'Erreicht voraussichtlich'}</small><strong>${months === 0 ? '🎉' : months ? esc(ym(addM(new Date(), months))) : '–'}</strong></div></div>
      ${log.length > 1 ? `<div class="ret-hist" aria-label="Verlauf">${log.map((x) => `<span title="${esc(x.m)}: ${E(n(x.v))}"><i style="height:${Math.max(4, (n(x.v) / max) * 100)}%"></i><small>${esc(x.m.slice(5))}</small></span>`).join('')}</div>` : ''}
      <form class="ret-form" id="spF"><label>Ziel (€)<input name="goal" type="number" min="0" step="500" value="${goal}"></label><label>Angespart heute (€)<input name="have" type="number" min="0" step="100" value="${have}"></label><label>Sparrate / Monat (€)<input name="rate" type="number" min="0" step="25" value="${rate || ''}" placeholder="z. B. 500"></label>
        <button class="btn btn-dark" type="submit">${done ? 'Aktualisieren' : 'Monats-Check-in speichern'}</button></form>
      <p class="form-note">${done ? 'Check-in für diesen Monat erledigt – bis nächsten Monat!' : 'Einmal im Monat den Stand eintragen: So sehen Sie, wie Sie Ihrem Ziel näherkommen.'} Faustregel: Kaufnebenkosten plus 10–20 % des Kaufpreises als Eigenkapital.</p>`;
    el.querySelector('#spF').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      p.savingsGoal = n(f.goal); p.equity = n(f.have); p.savingsMonthly = n(f.rate);
      const L = (Array.isArray(p.savingsLog) ? p.savingsLog : []).filter((x) => x.m !== thisM); L.push({ m: thisM, v: p.equity }); p.savingsLog = L.slice(-24);
      try { await saveData(u, d); } catch { /* bleibt lokal sichtbar */ }
      paint();
    };
  };
  paint();
  grid.append(el);
}
