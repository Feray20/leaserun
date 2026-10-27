// LeaseRun Bank-Chancen-Checker – Darstellung (reine Funktionen, liefern HTML-Text).
// Wird beim Build (Vorab-Darstellung ohne JavaScript) und im Browser (ratgeber.mjs) identisch verwendet.
import { ASSUMPTIONS, val } from './finanz-config.mjs';
import { GREST } from './calc.mjs';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const euro = (n) => `${Math.round(Number(n) || 0).toLocaleString('de-DE')} €`;
const pc = (n) => `${String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',')} %`;

export const STATUS = {
  green: 'Im gewählten Modell tragfähige Ausgangslage',
  yellow: 'Erhöhter Prüfbedarf',
  red: 'In dieser Modellrechnung derzeit nicht tragfähig',
  na: 'Bitte Haushaltsnetto und Darlehensbetrag eintragen',
};
export const DISCLAIMER = 'Das Ergebnis ist eine modellhafte Orientierung und ersetzt keine individuelle Kreditwürdigkeitsprüfung durch ein Kreditinstitut.';

const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const dayLabel = (d = new Date()) => `${WD[d.getDay()]}, ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

export const DEFAULTS = { netIncome: 4500, adults: 2, children: 0, commitments: 0, loan: 300000, ratePct: null, repaymentPct: null, propertyCosts: null, price: '', equity: '', land: 'hessen', brokerPct: '', rentIncome: '', employment: 'angestellt', livingOverride: '' };

const pair = (name, label, v, min, max, step, hint) => `<label class="bcc-field" for="bcc-${name}-{{id}}">${label}${hint ? `<small>${hint}</small>` : ''}<span class="bcc-pair"><input type="range" aria-label="${label.replace(/ \(.*\)$/, '')} (Schieberegler)" min="${min}" max="${max}" step="${step}" value="${esc(v)}" data-pair="${name}"><input id="bcc-${name}-{{id}}" name="${name}" type="number" inputmode="decimal" min="0" step="${step}" value="${esc(v)}"></span></label>`;
const num = (name, label, v, step, hint, ph = '') => `<label class="bcc-field" for="bcc-${name}-{{id}}">${label}${hint ? `<small>${hint}</small>` : ''}<input id="bcc-${name}-{{id}}" name="${name}" type="number" inputmode="decimal" min="0" step="${step}" value="${esc(v ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}></label>`;
const sel = (name, label, v, opts, hint) => `<label class="bcc-field" for="bcc-${name}-{{id}}">${label}${hint ? `<small>${hint}</small>` : ''}<select id="bcc-${name}-{{id}}" name="${name}">${opts.map(([k, t]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;

/** Formular (id unterscheidet mehrere Checker auf einer Seite; slug für die Herkunft der Registrierung). */
export function renderForm(d = {}, { id = 'a', slug = 'checker', heading = 'Bank-Chancen-Checker', intro = '' } = {}) {
  const v = { ...DEFAULTS, ...d };
  const rate = v.ratePct ?? val('zins_modell'), rep = v.repaymentPct ?? val('tilgung_modell'), pk = v.propertyCosts ?? val('objektkosten_modell');
  const lands = Object.entries(GREST).map(([k, g]) => [k, g.name]);
  const html = `<form class="bcc" data-bcc data-slug="${esc(slug)}" novalidate aria-labelledby="bcc-h-{{id}}">
<h2 id="bcc-h-{{id}}">${esc(heading)}</h2>${intro ? `<p class="rg-note">${intro}</p>` : ''}
<div class="bcc-grid">
${pair('netIncome', 'Haushaltsnetto pro Monat (€)', v.netIncome, 1000, 15000, 50, 'Alle Darlehensnehmer zusammen, inkl. Kindergeld')}
${pair('loan', 'Darlehensbetrag (€)', v.loan, 50000, 1500000, 5000)}
${sel('adults', 'Erwachsene im Haushalt', v.adults, [[1, '1'], [2, '2']])}
${sel('children', 'Kinder im Haushalt', v.children, [[0, 'keine'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']])}
${num('commitments', 'Bestehende Raten pro Monat (€)', v.commitments, 10, 'z. B. Autokredit, Leasing, Ratenkauf')}
${num('propertyCosts', 'Laufende Objektkosten pro Monat (€)', pk, 10, 'Hausgeld bzw. Nebenkosten und Rücklage – Annahme, bitte anpassen')}
${num('ratePct', 'Sollzins p. a. (%)', rate, 0.05, 'Modellannahme, kein Angebot')}
${num('repaymentPct', 'Anfängliche Tilgung p. a. (%)', rep, 0.1)}
</div>
<details><summary>Weitere Angaben (optional)</summary>
<div class="bcc-grid">
${num('price', 'Kaufpreis (€)', v.price, 1000, 'Für Kaufnebenkosten und Darlehensanteil')}
${num('equity', 'Eigenkapital (€)', v.equity, 1000)}
${sel('land', 'Bundesland', v.land, lands, 'Bestimmt die Grunderwerbsteuer')}
${num('brokerPct', 'Makler, Käuferanteil (%)', v.brokerPct, 0.01, '', String(val('makler_pct')).replace('.', ','))}
${num('rentIncome', 'Kaltmiete bei Vermietung (€ / Monat)', v.rentIncome, 10, `Wird im Modell zu ${val('mietanrechnung')} % angerechnet`)}
${sel('employment', 'Beschäftigung', v.employment, [['angestellt', 'Angestellt (unbefristet)'], ['probezeit', 'Angestellt in der Probezeit'], ['befristet', 'Befristet angestellt'], ['beamtet', 'Verbeamtet'], ['selbststaendig', 'Selbstständig / freiberuflich'], ['rente', 'In Rente / Pension']])}
${num('livingOverride', 'Eigene Lebenshaltungskosten (€ / Monat)', v.livingOverride, 10, 'Leer lassen = LeaseRun-Modell')}
</div>
<p class="bcc-geo" data-geo hidden></p>
</details>
<div class="bcc-out" data-bcc-out aria-live="polite">{{result}}</div>
</form>`;
  return html.replaceAll('{{id}}', esc(id));
}

/** Ergebnis-Block. res = bankChance(...); input = verwendete Eingaben. */
export function renderResult(res, input = {}, { slug = 'checker', date = new Date(), profileNote = '' } = {}) {
  const st = res.status;
  const rows = [
    ['Monatliche Rate (Zins + Tilgung)', euro(res.rate)],
    [`Lebenshaltung${input.livingOverride !== '' && input.livingOverride != null ? ' (eigene Angabe)' : ' (LeaseRun-Modell)'}`, `−${euro(res.living)}`],
    ...(res.commitments ? [['Bestehende Raten', `−${euro(res.commitments)}`]] : []),
    ['Laufende Objektkosten', `−${euro(res.propertyCosts)}`],
    ...(res.rentIn ? [[`Angerechnete Miete (${val('mietanrechnung')} %)`, `+${euro(res.rentIn)}`]] : []),
    ['Modellierter Überschuss nach Rate', `<strong>${euro(res.surplus)}</strong>`],
  ];
  const ob = res.objekt;
  return `<p class="bcc-status ${st}" role="status">${esc(STATUS[st])}</p>
${st === 'na' ? '' : `<div class="bcc-kpis">
<div class="bcc-kpi"><span>Rate pro Monat</span><strong>${euro(res.rate)}</strong></div>
<div class="bcc-kpi"><span>Überschuss nach Rate</span><strong>${euro(res.surplus)}</strong></div>
<div class="bcc-kpi"><span>Im Modell tragfähig bis ca.</span><strong>${euro(res.maxLoan)}</strong></div>
<div class="bcc-kpi"><span>Benötigtes Netto für „tragfähig“</span><strong>${euro(res.netNeeded)}</strong></div>
</div>
<div class="rg-scroll"><table class="rg-table"><tbody>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}
<tr><td>Restschuld nach 10 Jahren</td><td>${euro(res.restAfter10)}</td></tr>
${ob ? `<tr><td>Kaufnebenkosten ${esc(ob.land)} (${pc(ob.nkPct)})</td><td>${euro(ob.nebenkosten)}</td></tr><tr><td>Darlehen im Verhältnis zum Kaufpreis</td><td>${pc(ob.loanToPrice)}</td></tr>${ob.gap > 0 ? `<tr><td>Noch nicht gedeckt (Kaufpreis + Nebenkosten − Eigenkapital − Darlehen)</td><td>${euro(ob.gap)}</td></tr>` : ''}` : ''}
</tbody></table></div>
<p class="rg-note">Gerechnet mit ${pc(res.ratePct)} Sollzins und ${pc(res.repaymentPct)} anfänglicher Tilgung. „Tragfähig“ heißt hier: Nach der Rate bleiben mindestens ${val('ueberschuss_gruen')} % des Haushaltsnettos übrig (LeaseRun-Modell).</p>
${res.flags.length ? `<h3>Das sollten Sie prüfen</h3><ul class="bcc-flags">${res.flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>` : ''}`}
${profileNote ? `<p class="rg-note">${esc(profileNote)}</p>` : ''}
<p class="rg-note">${DISCLAIMER} Berechnet am <span data-today>${esc(dayLabel(date))}</span>.</p>
${st === 'na' ? '' : `<div class="bcc-cta"><p><strong>Möchten Sie Ihre persönliche Finanzierungsrechnung strukturiert aufbereiten?</strong> Mit LeaseRun können Sie Haushaltsrechnung, Finanzierungsdaten und Selbstauskunft zentral vorbereiten.</p><a class="btn btn-dark" href="/auth/register?source=criteria_${esc(String(slug).replace(/[^a-z0-9-]/g, '').slice(0, 60))}">Kostenloses Konto anlegen</a></div>`}`;
}

/** Liest die Formularwerte (Browser) in das Eingabeformat von bankChance. */
export function readForm(form) {
  const g = (n) => form.elements[n]?.value ?? '';
  const nz = (n) => { const s = String(g(n)).replace(',', '.').trim(); return s === '' ? '' : Number(s); };
  return {
    netIncome: nz('netIncome'), loan: nz('loan'), adults: Number(g('adults')) || 1, children: Number(g('children')) || 0,
    commitments: nz('commitments'), propertyCosts: nz('propertyCosts'), ratePct: nz('ratePct'), repaymentPct: nz('repaymentPct'),
    price: nz('price'), equity: nz('equity'), land: g('land'), brokerPct: nz('brokerPct'), rentIncome: nz('rentIncome'),
    employment: g('employment'), livingOverride: nz('livingOverride'),
  };
}

export { ASSUMPTIONS };
