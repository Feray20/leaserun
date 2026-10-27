// Unternehmensportal → Fall-Analyse: Unterlagen eines Kunden hochladen, sofort auswerten,
// Analyse für den Berater, verständliche Fassung für den Kunden und Präsentation mit Varianten.
// Die PDFs werden ausschließlich im Browser gelesen und nicht übertragen; der Server zählt nur das Kontingent.
import { analyseText, caseFacts, crossCheck, missingDocs, quality, TYPES } from './doc-check.mjs?v=892f3666';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v, d = 0) => (v == null || !isFinite(v) ? '–' : v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }));
const P = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v * 100).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %');
const num = (v) => { const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const PDFJS = '/vendor/pdfjs-4.10.38/';
const FONTS = { sans: 'Inter, "Segoe UI", system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', klassisch: 'Arial, Helvetica, sans-serif' };

async function pdfText(file) {
  const pdfjs = await import(PDFJS + 'pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const out = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      let line = '';
      for (const it of tc.items) { line += it.str || ''; if (it.hasEOL) { out.push(line); line = ''; } else if (it.str) line += ' '; }
      if (line.trim()) out.push(line);
    }
  } finally { await doc.destroy(); }
  return out.join('\n');
}

// ---------- Rechenkern ----------
function rest(D, z, t, years) { const r = (D * (z + t)) / 12; let s = D; for (let m = 0; m < years * 12 && s > 0; m++) s -= r - (s * z) / 12; return Math.max(0, s); }
function rateAnn(S, z, years) { const m = z / 12, n = years * 12; return m === 0 ? S / n : (S * m) / (1 - Math.pow(1 + m, -n)); }
export function calc(i) {
  const nk = i.kaufpreis * i.nkPct;
  const bedarf = i.kaufpreis + nk + i.modern;
  const D = Math.max(0, bedarf - i.eigenkapital);
  const beleihung = i.kaufpreis * (1 - i.abschlag);
  const lebens = i.lebens1 + Math.max(0, i.personen - 1) * i.lebensWeitere;
  const variants = i.varianten.map((v) => {
    const rate = (D * (v.zins + v.tilgung)) / 12;
    const rs = rest(D, v.zins, v.tilgung, v.bindung);
    const stress = rs > 0 ? rateAnn(rs, v.zins + 0.02, Math.max(5, 30 - v.bindung)) : 0;
    const ueber = i.netto + i.miete * 0.75 - lebens - i.hausgeld - i.sonst - rate;
    return { ...v, rate, rest: rs, stress, ueber, zinsen: rate * 12 * v.bindung - (D - rs) };
  });
  return { nk, bedarf, D, beleihung, auslauf: beleihung ? D / beleihung : null, ekQuote: bedarf ? i.eigenkapital / bedarf : null, lebens, variants, nkGedeckt: i.eigenkapital >= nk };
}

// ---------- Strukturierter Export (zum Übertragen in Ihr CRM oder Ihre Finanzierungsplattform) ----------
// Eigenes, offen dokumentiertes Format (schema leaserun.fall/1); keine Zertifizierung für eine bestimmte Plattform.
export function exportCase(st) {
  const i = st.inputs, c = calc(i);
  return {
    schema: 'leaserun.fall/1', erstellt: new Date().toISOString(),
    kunde: i.kunde || null,
    vorhaben: { kaufpreis: i.kaufpreis, nebenkosten: Math.round(c.nk), modernisierung: i.modern, gesamtbedarf: Math.round(c.bedarf), eigenkapital: i.eigenkapital, darlehen: Math.round(c.D) },
    objekt: { beleihungswertAnnahme: Math.round(c.beleihung), beleihungsauslauf: c.auslauf != null ? +(c.auslauf * 100).toFixed(1) : null, kaltmiete: i.miete, hausgeld: i.hausgeld },
    haushalt: { nettoMonat: i.netto, personen: i.personen, lebenshaltung: Math.round(c.lebens), sonstigeVerpflichtungen: i.sonst },
    varianten: c.variants.map((v) => ({ name: v.name, sollzins: +(v.zins * 100).toFixed(3), tilgung: +(v.tilgung * 100).toFixed(2), zinsbindungJahre: v.bindung, rateMonat: +v.rate.toFixed(2), restschuldEnde: Math.round(v.rest), haushaltsueberschuss: Math.round(v.ueber) })),
    unterlagen: (st.docs || []).map((d) => ({ art: d.label, gruppe: d.group, befunde: (d.findings || []).map((f) => f[1]) })),
  };
}
export function exportCsv(x) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Bereich', 'Feld', 'Wert']];
  for (const [k, o] of Object.entries({ vorhaben: x.vorhaben, objekt: x.objekt, haushalt: x.haushalt })) for (const [f, v] of Object.entries(o)) rows.push([k, f, v]);
  x.varianten.forEach((v) => Object.entries(v).forEach(([f, w]) => rows.push(['variante ' + v.name, f, w])));
  x.unterlagen.forEach((u) => rows.push(['unterlagen', u.art, u.befunde.join(' | ')]));
  return '\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n');
}
function dl(text, type, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = `${new Date().toISOString().slice(0, 10)}_LeaseRun_Fall.${ext}`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 120_000);
}

// ---------- Zustand ----------
let S = null; // { docs, facts, inputs, br, quota }
const DEF_VAR = [{ name: 'Variante A', zins: 0.036, tilgung: 0.02, bindung: 10 }, { name: 'Variante B', zins: 0.038, tilgung: 0.025, bindung: 15 }, { name: 'Variante C', zins: 0.041, tilgung: 0.03, bindung: 20 }];

export async function renderFall(box, { api, toast, me }) {
  const r = await api('/api/b2b/fall');
  if (!r.ok) { box.innerHTML = `<div class="pt-alert warn">${esc(r.data?.error || 'Nicht verfügbar.')}</div>`; return; }
  const info = r.data;
  if (info.blocked) { box.innerHTML = '<div class="pt-alert warn"><strong>Schnellrechner und Fall-Analysen sind für Ihr Unternehmenskonto nicht freigeschaltet.</strong> Bitte wenden Sie sich an support@leaserun.com.</div>'; return; }
  info.noStress = me?.modules?.stresstest === false;
  const lim = (n) => (n == null ? 'unbegrenzt' : n);
  box.innerHTML = `<div class="fa">
    <section class="pt-card fa-hero"><div><span class="bw-kick">Fall-Analyse</span><h2>Unterlagen hochladen – Analyse in Sekunden</h2>
      <p>Unterlagen hochladen – relevante Informationen strukturiert erfassen und Prüfpunkte erkennen. Gehaltsabrechnungen, Kontoauszug, Exposé, Grundbuch, Energieausweis, Teilungserklärung, Protokolle, Kaufvertragsentwurf …</p>
      <details class="fa-priv"><summary><b>Datenschutz:</b> Die PDFs werden nur in Ihrem Browser gelesen – nicht an LeaseRun übertragen oder gespeichert.</summary><p>Die Fall-Analyse ist eine clientseitige Vorprüfung für maximale Diskretion bei sensiblen Gehaltsnachweisen. Unterlagen, die Ihr Kunde selbst im Kundenbereich hochlädt und für Sie freigibt, liegen dagegen verschlüsselt (AES-256) in einem ISO-27001-zertifizierten Rechenzentrum in Frankfurt am Main (AWS eu-central-1) – zur gemeinsamen Bearbeitung nach dem Auftragsverarbeitungsvertrag (Art. 28 DSGVO).</p></details></div>
      <div class="fa-quota"><div><small>Fall-Analysen diesen Monat</small><strong>${info.usage.fall} / ${lim(info.limits.fall)}</strong></div><div><small>Präsentationen</small><strong>${info.usage.praes} / ${lim(info.limits.praes)}</strong></div><div><small>Erscheinungsbild</small><strong>${({ leaserun: 'LeaseRun', eigen: 'Ihr Logo', whitelabel: 'White-Label' })[info.branding.mode]}</strong></div></div></section>
    ${info.verified ? '' : '<div class="pt-alert warn">Die Fall-Analyse steht nach der Freischaltung Ihres Unternehmenskontos zur Verfügung.</div>'}
    <label class="fa-drop" id="faDrop"><input type="file" id="faFiles" accept="application/pdf" multiple hidden ${info.verified ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg><strong>PDFs auswählen oder hierher ziehen</strong><span>Bis zu 15 Dateien, je max. 25 MB. Gescannte Bilder ohne Text werden erkannt und markiert.</span></label>
    <div id="faOut"></div></div>`;
  const inp = box.querySelector('#faFiles'), drop = box.querySelector('#faDrop');
  const go = (files) => run([...files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)).slice(0, 15), box, { api, toast, info, me });
  inp.onchange = () => go(inp.files);
  ['dragenter', 'dragover'].forEach((k) => drop.addEventListener(k, (e) => { e.preventDefault(); drop.classList.add('on'); }));
  ['dragleave', 'drop'].forEach((k) => drop.addEventListener(k, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
  drop.addEventListener('drop', (e) => { if (info.verified) go(e.dataTransfer.files); });
  if (S && S.docs.length) { S.info = info; paint(box, { api, toast }); }
}

async function run(files, box, ctx) {
  const out = box.querySelector('#faOut');
  if (!files.length) { ctx.toast('Bitte PDF-Dateien auswählen.', true); return; }
  if (files.some((f) => f.size > 25 * 1024 * 1024)) { ctx.toast('Eine Datei ist größer als 25 MB.', true); return; }
  const take = await ctx.api('/api/b2b/fall', { method: 'POST', body: JSON.stringify({ kind: 'fall' }) });
  if (!take.ok) { out.innerHTML = `<div class="pt-alert warn">${esc(take.data?.error || 'Kontingent nicht verfügbar.')}${take.data?.code === 'quota' ? ' <a href="#tarif">Tarif ansehen</a>' : ''}</div>`; return; }
  out.innerHTML = `<section class="pt-card"><h2>Unterlagen werden ausgewertet …</h2><ol class="fa-prog">${files.map((f, i) => `<li id="fp${i}">${esc(f.name)} <span>wartet</span></li>`).join('')}</ol></section>`;
  const docs = [];
  for (let i = 0; i < files.length; i++) {
    const li = out.querySelector('#fp' + i);
    li.querySelector('span').textContent = 'wird gelesen …';
    try { const t = await pdfText(files[i]); docs.push(analyseText(t, files[i].name)); li.querySelector('span').textContent = '✓ ' + docs.at(-1).label; li.classList.add('ok'); }
    catch { docs.push({ type: 'fehler', label: 'Nicht lesbar', group: '–', values: {}, findings: [['bad', 'Datei konnte nicht gelesen werden (beschädigt oder passwortgeschützt).']], name: files[i].name }); li.querySelector('span').textContent = 'nicht lesbar'; li.classList.add('bad'); }
  }
  const f = caseFacts(docs);
  S = {
    docs, facts: f, info: ctx.info, tab: 'berater', slides: ['titel', 'ueberblick', 'varianten', 'stress', 'unterlagen', 'schritte'].filter((k) => !(ctx.info?.noStress && k === 'stress')),
    inputs: {
      kunde: '', objekt: '', flaeche: f.flaeche || 0, baujahr: f.baujahr || 0, energie: f.klasse || '', kaufpreis: f.kaufpreis || 0, nkPct: 0.105, modern: 0, eigenkapital: f.eigenkapital || 0, abschlag: 0.1,
      netto: f.nettoMonat || 0, miete: f.kaltmiete || 0, hausgeld: f.hausgeld || 0, sonst: 0, personen: 2, lebens1: 1000, lebensWeitere: 350,
      varianten: DEF_VAR.map((v) => ({ ...v })),
    },
  };
  paint(box, ctx);
}

// ---------- Ausgabe ----------
function sev(docs) { const all = docs.flatMap((d) => d.findings); return { bad: all.filter((x) => x[0] === 'bad').length, warn: all.filter((x) => x[0] === 'warn').length, ok: all.filter((x) => x[0] === 'ok').length }; }
const VAL_LABEL = { brutto: 'Brutto', netto: 'Netto / Auszahlung', monat: 'Monat', jahr: 'Jahr', zvE: 'Zu versteuerndes Einkommen', einkuenfte: 'Summe der Einkünfte', ergebnis: 'Ergebnis', umsatz: 'Umsatz', stand: 'Stand', saldo: 'Kontostand', lasten: 'Abt. II', grundschulden: 'Grundschulden Abt. III', abruf: 'Datum', klasse: 'Effizienzklasse', kwh: 'Endenergie kWh/(m²·a)', gueltigBis: 'Gültig bis', art: 'Art', mea: 'Miteigentumsanteil', sondernutzung: 'Sondernutzungsrecht', themen: 'Themen', datum: 'Datum', hausgeld: 'Hausgeld mtl.', ruecklage: 'Erhaltungsrücklage', kaltmiete: 'Kaltmiete', staffel: 'Staffelmiete', index: 'Indexmiete', beginn: 'Datum', kaufpreis: 'Kaufpreis', inventar: 'Inventar', flaeche: 'Wohnfläche m²', baujahr: 'Baujahr', kinder: 'Kinder', verbindlichkeiten: 'Verbindlichkeiten mtl.' };
const MONEY = new Set(['brutto', 'netto', 'zvE', 'einkuenfte', 'ergebnis', 'umsatz', 'saldo', 'hausgeld', 'ruecklage', 'kaltmiete', 'kaufpreis', 'inventar', 'verbindlichkeiten']);
function valStr(k, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
  if (typeof v === 'boolean') return v ? 'ja' : null;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? E(x) : x)).join(', ');
  if (MONEY.has(k) && typeof v === 'number') return E(v, v % 1 ? 2 : 0);
  return typeof v === 'number' ? v.toLocaleString('de-DE') : String(v);
}

function paint(box, ctx) {
  const out = box.querySelector('#faOut');
  const c = calc(S.inputs), f = S.facts, sv = sev(S.docs);
  // Nur Zahlen für die Übernahme in die Software-Tools (Haushaltsrechnung, Angebotsvergleich); nur in diesem Tab.
  try { const v = c.variants[0] || {}; sessionStorage.setItem('lr-fall-last', JSON.stringify({ netto: S.inputs.netto, miete: S.inputs.miete, personen: S.inputs.personen, darlehen: c.D, zins: v.zins ? +(v.zins * 100).toFixed(3) : null, tilgung: v.tilgung ? +(v.tilgung * 100).toFixed(2) : null, kaufpreis: S.inputs.kaufpreis })); } catch { /* ohne Speicher */ }
  const miss = missingDocs(S.docs.map((d) => d.type), f);
  out.innerHTML = `<div class="seg fa-tabs" role="tablist">${[['berater', 'Analyse für Sie'], ['kunde', 'Fassung für den Kunden'], ['praes', 'Präsentation']].map(([k, l]) => `<button type="button" role="tab" data-ft="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div>
    <div id="faTab"></div>`;
  out.querySelectorAll('[data-ft]').forEach((b) => b.onclick = () => { S.tab = b.dataset.ft; paint(box, ctx); });
  const tab = out.querySelector('#faTab');
  if (S.tab === 'berater') tab.innerHTML = berater(c, f, sv, miss);
  else if (S.tab === 'kunde') tab.innerHTML = kunde(c, f, miss);
  else tab.innerHTML = praesUI(c);
  bindInputs(tab, box, ctx);
}

function berater(c, f, sv, miss) {
  const i = S.inputs, v0 = c.variants[0];
  const kpi = [['Darlehensbedarf', E(c.D)], ['Beleihungsauslauf', P(c.auslauf)], ['Eigenkapitalquote', P(c.ekQuote)], ['Rate (A)', E(v0.rate) + ' mtl.'], ['Haushaltsüberschuss (A)', E(v0.ueber)], ['Rate bei +2 % Anschluss', E(v0.stress)]];
  return `<section class="pt-card"><div class="fa-sum"><span class="fa-amp bad">${sv.bad} kritisch</span><span class="fa-amp warn">${sv.warn} prüfen</span><span class="fa-amp ok">${sv.ok} unauffällig</span><span class="fa-amp">${S.docs.length} Dokumente</span>${miss.length ? `<span class="fa-amp miss">${miss.length} fehlen</span>` : '<span class="fa-amp ok">vollständig</span>'}</div>
      <div class="bw-kpis fa-kpis">${kpi.map(([k, x]) => `<div><small>${k}</small><strong>${x}</strong></div>`).join('')}</div>
      ${!c.nkGedeckt && i.kaufpreis ? '<p class="fa-flag bad">Eigenkapital deckt die Erwerbsnebenkosten nicht – Finanzierung über 100 % des Kaufpreises.</p>' : ''}
      ${v0.ueber < 0 && i.netto ? '<p class="fa-flag bad">Haushaltsrechnung negativ – Kapitaldienstfähigkeit nicht gegeben (mit den angesetzten Pauschalen).</p>' : ''}
      ${v0.stress > v0.rate * 1.2 && v0.rest ? `<p class="fa-flag warn">Anschlussrisiko: Rate steigt bei +2 Prozentpunkten um ${P(v0.stress / v0.rate - 1, 0)}.</p>` : ''}
      ${f.lasten.length ? `<p class="fa-flag warn">Grundbuch Abt. II: ${esc(f.lasten.join(', '))}</p>` : ''}</section>
    ${xcheckHtml(S.docs)}
    <section class="pt-card"><h2>Eckdaten – aus den Unterlagen übernommen, bitte prüfen</h2>
      <div class="fa-in">${inField('kunde', 'Kunde (für Präsentation)', i.kunde, 'text')}${inField('objekt', 'Objekt (Titel)', i.objekt, 'text')}${inField('flaeche', 'Wohnfläche m²', i.flaeche)}${inField('baujahr', 'Baujahr', i.baujahr)}${inField('energie', 'Energieeffizienz (A+–H)', i.energie, 'text')}${inField('kaufpreis', 'Kaufpreis €', i.kaufpreis)}${inField('nkPct', 'Nebenkosten %', +(i.nkPct * 100).toFixed(2))}${inField('modern', 'Modernisierung €', i.modern)}${inField('eigenkapital', 'Eigenkapital €', i.eigenkapital)}${inField('netto', 'Haushaltsnetto mtl. €', i.netto)}${inField('miete', 'Mieteinnahmen mtl. €', i.miete)}${inField('hausgeld', 'Hausgeld / Bewirtschaftung mtl. €', i.hausgeld)}${inField('sonst', 'Sonstige Raten mtl. €', i.sonst)}${inField('personen', 'Personen im Haushalt', i.personen)}${inField('lebens1', 'Lebenshaltung 1. Person €', i.lebens1)}${inField('lebensWeitere', 'je weitere Person €', i.lebensWeitere)}${inField('abschlag', 'Sicherheitsabschlag %', +(i.abschlag * 100).toFixed(1))}</div>
      <p class="form-note">Netto aus ${f.gehaltsMonate || 0} Gehaltsabrechnung(en) gemittelt${f.selbststaendig ? '; selbstständig – Einkommen aus Steuerbescheiden/BWA bitte manuell ansetzen' : ''}. Mieten zu 75 % angesetzt. Lebenshaltungspauschalen sind Annahmen – bitte durch die Werte Ihres Hauses ersetzen.</p></section>
    <section class="pt-card"><h2>Varianten</h2>${varTable(c)}</section>
    <section class="pt-card"><h2>Unterlagen im Einzelnen</h2><div class="fa-docs">${S.docs.map((d, k) => docCard(d, k)).join('')}</div>
      ${miss.length ? `<h3 class="bw-h3">Es fehlen</h3><ul class="fa-miss">${miss.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>
    <p class="form-note">Automatische Lesehilfe. Werte und Hinweise ersetzen nicht die Prüfung der Originale und nicht die Kreditwürdigkeitsprüfung Ihres Hauses.</p>`;
}
const inField = (k, l, v, type = 'number') => `<label>${l}<input data-in="${k}" type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : 'maxlength="80"'} value="${esc(v)}"></label>`;
function varTable(c) {
  return `<div class="wa-wrap"><table class="bw-table fa-var"><thead><tr><th></th>${c.variants.map((v, k) => `<th><input data-vn="${k}" value="${esc(v.name)}" maxlength="30" aria-label="Name"></th>`).join('')}</tr></thead><tbody>
    <tr><td>Sollzins %</td>${c.variants.map((v, k) => `<td><input data-vz="${k}" type="number" step="0.01" value="${+(v.zins * 100).toFixed(2)}"></td>`).join('')}</tr>
    <tr><td>Anfangstilgung %</td>${c.variants.map((v, k) => `<td><input data-vt="${k}" type="number" step="0.1" value="${+(v.tilgung * 100).toFixed(2)}"></td>`).join('')}</tr>
    <tr><td>Zinsbindung Jahre</td>${c.variants.map((v, k) => `<td><input data-vb="${k}" type="number" step="1" min="5" max="30" value="${v.bindung}"></td>`).join('')}</tr>
    <tr><td>Rate monatlich</td>${c.variants.map((v) => `<td><strong>${E(v.rate)}</strong></td>`).join('')}</tr>
    <tr><td>Restschuld Ende Zinsbindung</td>${c.variants.map((v) => `<td>${E(v.rest)}</td>`).join('')}</tr>
    <tr><td>Zinskosten in der Bindung</td>${c.variants.map((v) => `<td>${E(v.zinsen)}</td>`).join('')}</tr>
    <tr><td>Rate bei +2 % Anschluss</td>${c.variants.map((v) => `<td>${E(v.stress)}</td>`).join('')}</tr>
    <tr><td>Haushaltsüberschuss</td>${c.variants.map((v) => `<td class="${v.ueber < 0 ? 'neg' : ''}">${E(v.ueber)}</td>`).join('')}</tr></tbody></table></div>`;
}
// Abgleich zwischen Dokumenten mit Quellenangabe (Dokumentart und Datei).
function xcheckHtml(docs) {
  const xs = crossCheck(docs);
  if (!xs.length) return '';
  const fmt = (x, v) => (x.unit === '€' ? E(v) : v.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' ' + x.unit);
  return `<section class="pt-card fa-xc"><h2>Abgleich zwischen Dokumenten</h2><ul class="fa-xc-l">${xs.map((x) => `<li class="${x.differs ? 'warn' : 'ok'}"><span class="st ${x.differs ? 'warn' : 'ok'}">${x.differs ? 'Abweichung erkannt' : 'Übereinstimmung'}</span><div><strong>${x.differs ? `${x.label} unterscheidet sich zwischen ${x.hits.length} Dokumenten.` : `${x.label} stimmt in ${x.hits.length} Dokumenten überein.`}</strong>
    <details${x.differs ? ' open' : ''}><summary>Details anzeigen</summary><ul>${x.hits.map((h) => `<li><b>${esc(fmt(x, h.value))}</b> – Quelle: ${esc(h.label)}${h.name ? ` (${esc(h.name)})` : ''}</li>`).join('')}</ul>${x.differs ? '<p class="form-note">Nächster Schritt: Originale vergleichen und den verbindlichen Wert in den Eckdaten unten eintragen.</p>' : ''}</details></div></li>`).join('')}</ul></section>`;
}

function docCard(d, k) {
  const vals = Object.entries(d.values || {}).filter(([x]) => !x.startsWith('_')).map(([x, v]) => [VAL_LABEL[x] || x, valStr(x, v)]).filter(([, v]) => v);
  return `<article class="fa-doc"><header><select data-dt="${k}" aria-label="Dokumentart">${[['', d.label], ...TYPES.map((t) => [t.id, t.label])].map(([id, l], j) => `<option value="${id}"${j === 0 ? ' selected' : ''}>${esc(j === 0 ? l : '→ ' + l)}</option>`).join('')}</select><small>${esc(d.name)}</small>${d.confidence != null && d.type !== 'scan' ? (quality(d.confidence) === 'niedrig' ? '<span class="st warn fa-q">Erkennung: niedrig – bitte prüfen</span>' : `<span class="st fa-q">Erkennung: ${quality(d.confidence)}</span>`) : ''}</header>
    ${vals.length ? `<dl>${vals.map(([a, b]) => `<div><dt>${esc(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>` : ''}
    ${d.findings.length ? `<ul>${d.findings.map(([s, t]) => `<li class="${s}">${esc(t)}</li>`).join('')}</ul>` : ''}</article>`;
}

function kunde(c, f, miss) {
  const i = S.inputs, v = c.variants;
  const good = [], todo = [];
  if (c.nkGedeckt && i.kaufpreis) good.push('Ihr Eigenkapital deckt die Kaufnebenkosten – das verbessert die Konditionen.');
  if (c.auslauf != null && c.auslauf <= 0.8) good.push('Der Finanzierungsanteil liegt in einem Bereich, den Banken gern finanzieren.');
  if (v[0].ueber > 300) good.push(`Nach der Rate bleiben Ihnen rechnerisch rund ${E(Math.floor(v[0].ueber / 50) * 50)} im Monat.`);
  if (f.klasse && /A|B/.test(f.klasse)) good.push(`Energieeffizienzklasse ${f.klasse} – niedrige Energiekosten.`);
  if (!c.nkGedeckt && i.kaufpreis) todo.push('Mehr Eigenkapital einbringen, mindestens für die Kaufnebenkosten.');
  if (v[0].ueber < 300 && i.netto) todo.push('Den monatlichen Spielraum gemeinsam genauer ansehen – zum Beispiel über Tilgung oder Laufzeit.');
  miss.forEach((x) => todo.push(`Unterlage nachreichen: ${x}`));
  S.docs.flatMap((d) => d.findings.filter(([s]) => s !== 'ok').map(([, t]) => [d.label, t])).slice(0, 6).forEach(([l, t]) => todo.push(`${l}: ${t}`));
  const txt = `Ihre Finanzierung auf einen Blick\n\nKaufpreis: ${E(i.kaufpreis)}\nGesamtkosten inkl. Nebenkosten: ${E(c.bedarf)}\nIhr Eigenkapital: ${E(i.eigenkapital)}\nDarlehen: ${E(c.D)}\n\n${v.map((x) => `${x.name}: ${E(x.rate)} pro Monat, ${x.bindung} Jahre fester Zins, Restschuld danach ${E(x.rest)}`).join('\n')}\n\nDas spricht für Sie:\n${good.map((x) => '– ' + x).join('\n') || '–'}\n\nNächste Schritte:\n${todo.map((x) => '– ' + x).join('\n') || '– Keine offenen Punkte.'}\n\nUnverbindliche Berechnung auf Basis Ihrer Unterlagen; keine Finanzierungszusage.`;
  return `<section class="pt-card fa-kunde"><h2>Ihre Finanzierung auf einen Blick</h2>
    <div class="bw-kpis">${[['Kaufpreis', E(i.kaufpreis)], ['Gesamtkosten', E(c.bedarf)], ['Ihr Eigenkapital', E(i.eigenkapital)], ['Darlehen', E(c.D)]].map(([a, b]) => `<div><small>${a}</small><strong>${b}</strong></div>`).join('')}</div>
    <h3 class="bw-h3">Ihre Möglichkeiten</h3><div class="fa-opts">${v.map((x) => `<div><strong>${esc(x.name)}</strong><b>${E(x.rate)}</b><span>pro Monat · ${x.bindung} Jahre fester Zins</span><span>Restschuld danach ${E(x.rest)}</span></div>`).join('')}</div>
    ${good.length ? `<h3 class="bw-h3">Das spricht für Sie</h3><ul class="fa-good">${good.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <h3 class="bw-h3">Nächste Schritte</h3><ul class="fa-todo">${todo.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Keine offenen Punkte.</li>'}</ul>
    <p class="form-note">Unverbindliche Berechnung auf Basis Ihrer Unterlagen; keine Finanzierungszusage.</p>
    <div class="pt-row"><button class="btn btn-dark" type="button" id="faCopy">Text kopieren (für E-Mail)</button><button class="btn btn-outline" type="button" id="faJson">Export JSON</button><button class="btn btn-outline" type="button" id="faCsv">Export CSV</button><button class="btn btn-outline" type="button" data-ft2="praes">Als Präsentation zeigen</button></div>
    <textarea id="faTxt" hidden>${esc(txt)}</textarea></section>`;
}

const SLIDES = [['titel', 'Titelseite'], ['ueberblick', 'Ihre Finanzierung auf einen Blick'], ['varianten', 'Varianten im Vergleich'], ['stress', 'Zinsrisiko nach der Zinsbindung'], ['haushalt', 'Ihr monatlicher Spielraum'], ['unterlagen', 'Stand Ihrer Unterlagen'], ['schritte', 'Nächste Schritte']];
function praesUI() {
  const b = S.info.branding;
  return `<section class="pt-card"><h2>Präsentation für den Kunden</h2>
    <p class="form-note">Erscheinungsbild: <strong>${({ leaserun: 'LeaseRun', eigen: 'Ihr Logo und Ihre Farben', whitelabel: 'komplett im Erscheinungsbild Ihres Hauses' })[b.mode]}</strong>${b.mode === 'leaserun' ? ' · Eigenes Logo ab Pro, vollständiges White-Label mit Enterprise.' : ''} <a href="#profil">Anpassen</a></p>
    <fieldset class="fa-slides"><legend>Folien auswählen</legend>${SLIDES.filter(([k]) => !(S.info?.noStress && k === 'stress')).map(([k, l]) => `<label class="chk"><input type="checkbox" data-sl="${k}"${S.slides.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
    <div class="pt-row"><button class="btn btn-dark" type="button" id="faShow">Präsentation starten</button><button class="btn btn-outline" type="button" id="faPrint">Als PDF speichern / drucken</button></div>
    <div class="fa-dual"><h3>Download-Paket für den Kundentermin</h3>
      <div class="fa-dual-g"><button type="button" class="fa-dl" id="faPptx"><b>PowerPoint (.pptx)</b><span>6 Folien: Deckblatt, Objekt, Haushalt, Finanzierung, Stresstest, nächste Schritte${b.mode === 'leaserun' ? '' : ' – im Erscheinungsbild Ihres Hauses'}</span></button>
      <a class="fa-dl" href="/app/dashboard#objekte"><b>BankReady-Kreditmappe (PDF)</b><span>Mit SHA-256-Prüfsumme, nummeriertem Anlagenverzeichnis und Selbstauskunft – im Studio erstellen</span></a></div></div>
    <p class="form-note">Varianten und Eckdaten stellen Sie unter „Analyse für Sie“ ein. Im Präsentationsmodus mit Pfeiltasten oder Wischen blättern, Esc beendet.</p></section>`;
}

function bindInputs(tab, box, ctx) {
  const i = S.inputs;
  const pct = new Set(['nkPct', 'abschlag']);
  tab.querySelectorAll('[data-in]').forEach((el) => el.onchange = () => { const k = el.dataset.in; i[k] = ['kunde', 'objekt', 'energie'].includes(k) ? el.value.trim().slice(0, 80) : pct.has(k) ? num(el.value) / 100 : num(el.value); paint(box, ctx); });
  tab.querySelectorAll('[data-vz],[data-vt],[data-vb],[data-vn]').forEach((el) => el.onchange = () => {
    const k = +(el.dataset.vz ?? el.dataset.vt ?? el.dataset.vb ?? el.dataset.vn), v = i.varianten[k];
    if (el.dataset.vz != null) v.zins = num(el.value) / 100; else if (el.dataset.vt != null) v.tilgung = num(el.value) / 100; else if (el.dataset.vb != null) v.bindung = Math.min(30, Math.max(5, Math.round(num(el.value)))); else v.name = el.value.trim().slice(0, 30) || v.name;
    paint(box, ctx);
  });
  tab.querySelectorAll('[data-dt]').forEach((el) => el.onchange = () => { if (!el.value) return; const d = S.docs[+el.dataset.dt]; const T = TYPES.find((t) => t.id === el.value); d.type = T.id; d.label = T.label; d.group = T.group; d.findings = [['ok', 'Dokumentart manuell zugeordnet – Werte bitte im Original prüfen.']]; S.facts = { ...caseFacts(S.docs) }; paint(box, ctx); });
  tab.querySelector('#faJson')?.addEventListener('click', () => dl(JSON.stringify(exportCase(S), null, 2), 'application/json', 'json'));
  tab.querySelector('#faCsv')?.addEventListener('click', () => dl(exportCsv(exportCase(S)), 'text/csv;charset=utf-8', 'csv'));
  tab.querySelector('#faCopy')?.addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(tab.querySelector('#faTxt').value); e.target.textContent = 'Kopiert ✓'; } catch { ctx.toast('Kopieren nicht möglich.', true); } });
  tab.querySelector('[data-ft2]')?.addEventListener('click', () => { S.tab = 'praes'; paint(box, ctx); });
  tab.querySelectorAll('[data-sl]').forEach((el) => el.onchange = () => { S.slides = SLIDES.map(([k]) => k).filter((k) => tab.querySelector(`[data-sl="${k}"]`).checked); });
  const open = async (print) => {
    if (!S.slides.length) { ctx.toast('Bitte mindestens eine Folie auswählen.', true); return; }
    if (!S.praesTaken) {
      const t = await ctx.api('/api/b2b/fall', { method: 'POST', body: JSON.stringify({ kind: 'praesentation' }) });
      if (!t.ok) { ctx.toast(t.data?.error || 'Kontingent nicht verfügbar.', true); return; }
      S.praesTaken = true;
    }
    showDeck(print);
  };
  tab.querySelector('#faShow')?.addEventListener('click', () => open(false));
  tab.querySelector('#faPrint')?.addEventListener('click', () => open(true));
  tab.querySelector('#faPptx')?.addEventListener('click', async (e) => {
    if (!S.praesTaken) { const t = await ctx.api('/api/b2b/fall', { method: 'POST', body: JSON.stringify({ kind: 'praesentation' }) }); if (!t.ok) { ctx.toast(t.data?.error || 'Kontingent nicht verfügbar.', true); return; } S.praesTaken = true; }
    e.currentTarget.disabled = true;
    try { await exportPptx(); ctx.toast('PowerPoint erstellt.'); } catch (err) { ctx.toast('PowerPoint konnte nicht erstellt werden.', true); console.warn(err); } finally { e.currentTarget.disabled = false; }
  });
}

// ---------- Präsentation ----------
function bars(items, max, fmt) {
  return `<div class="dk-bars">${items.map(([l, v, c]) => `<div class="dk-bar"><span>${esc(l)}</span><i style="width:${Math.max(2, Math.min(100, (v / max) * 100))}%;${c ? `background:${c}` : ''}"></i><b>${fmt(v)}</b></div>`).join('')}</div>`;
}
function slideHtml(k, c) {
  const i = S.inputs, v = c.variants, b = S.info.branding, miss = missingDocs(S.docs.map((d) => d.type), S.facts);
  const date = new Date().toLocaleDateString('de-DE');
  switch (k) {
    case 'titel': return `<div class="dk-title"><span class="dk-k">${esc(b.title)}</span><h1>${esc(i.kunde ? 'für ' + i.kunde : 'Ihre Immobilienfinanzierung')}</h1><p>${E(i.kaufpreis)} Kaufpreis · ${E(c.D)} Darlehen</p><p class="dk-sub">${esc(b.sender || b.company)} · ${date}</p></div>`;
    case 'ueberblick': return `<h2>Ihre Finanzierung auf einen Blick</h2><div class="dk-kpis">${[['Kaufpreis', E(i.kaufpreis)], ['Nebenkosten', E(c.nk)], ['Eigenkapital', E(i.eigenkapital)], ['Darlehen', E(c.D)]].map(([a, x]) => `<div><small>${a}</small><strong>${x}</strong></div>`).join('')}</div>${bars([['Eigenkapital', i.eigenkapital], ['Darlehen', c.D]], c.bedarf || 1, (x) => E(x))}<p class="dk-note">Gesamtkosten ${E(c.bedarf)} · Eigenkapitalquote ${P(c.ekQuote, 0)}</p>`;
    case 'varianten': return `<h2>Varianten im Vergleich</h2><div class="dk-vars">${v.map((x) => `<div><strong>${esc(x.name)}</strong><b>${E(x.rate)}</b><span>pro Monat</span><dl><div><dt>Sollzins</dt><dd>${P(x.zins, 2)}</dd></div><div><dt>Tilgung</dt><dd>${P(x.tilgung, 1)}</dd></div><div><dt>Zinsbindung</dt><dd>${x.bindung} Jahre</dd></div><div><dt>Restschuld danach</dt><dd>${E(x.rest)}</dd></div></dl></div>`).join('')}</div><p class="dk-note">Beispielkonditionen, unverbindlich. Maßgeblich ist das Angebot mit ESIS-Merkblatt.</p>`;
    case 'stress': return `<h2>Was passiert nach der Zinsbindung?</h2><p>Rate für die Restschuld, wenn der Zins dann um 2 Prozentpunkte höher liegt:</p>${bars(v.flatMap((x) => [[x.name + ' heute', x.rate], [x.name + ' danach', x.stress, 'var(--dk2)']]), Math.max(...v.map((x) => Math.max(x.rate, x.stress))) || 1, (x) => E(x))}<p class="dk-note">Längere Zinsbindung und höhere Tilgung senken dieses Risiko.</p>`;
    case 'haushalt': { const x = v[0]; const items = [['Einkommen', i.netto + i.miete * 0.75], ['Lebenshaltung', c.lebens], ['Wohnkosten', i.hausgeld], ['Rate', x.rate], ['Spielraum', Math.max(0, x.ueber), 'var(--dk2)']]; return `<h2>Ihr monatlicher Spielraum</h2>${bars(items, Math.max(...items.map((y) => y[1])) || 1, (y) => E(y))}<p class="dk-note">${esc(x.name)}. Lebenshaltung pauschal angesetzt.</p>`; }
    case 'unterlagen': { const have = S.docs.filter((d) => !['unbekannt', 'scan', 'fehler'].includes(d.type)); return `<h2>Stand Ihrer Unterlagen</h2><div class="dk-docs"><div><h3>Liegt vor</h3><ul>${have.map((d) => `<li class="ok">${esc(d.label)}</li>`).join('') || '<li>–</li>'}</ul></div><div><h3>Bitte nachreichen</h3><ul>${miss.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="ok">Alles vollständig</li>'}</ul></div></div>`; }
    case 'schritte': return `<h2>Nächste Schritte</h2><ol class="dk-steps">${[miss.length ? 'Fehlende Unterlagen nachreichen' : 'Unterlagen sind vollständig', 'Variante auswählen', 'Verbindliches Angebot mit ESIS-Merkblatt', 'Kaufvertrag beim Notar', 'Auszahlung'].map((x) => `<li>${esc(x)}</li>`).join('')}</ol><p class="dk-sub">${esc(S.info.branding.advisor || '')}${S.info.branding.city ? ' · ' + esc(S.info.branding.city) : ''}</p>`;
    default: return '';
  }
}
function showDeck(print) {
  const c = calc(S.inputs), b = S.info.branding;
  document.getElementById('faDeck')?.remove();
  const d = document.createElement('div');
  d.id = 'faDeck'; d.className = 'dk' + (print ? ' dk-print' : '');
  d.style.setProperty('--dk1', b.color); d.style.setProperty('--dk2', b.color2); d.style.setProperty('--dkf', FONTS[b.font] || FONTS.sans);
  const logo = b.logo ? `<img src="${b.logo}" alt="${esc(b.company)}">` : b.mode === 'leaserun' ? '<img src="/logo-icon.svg" alt=""><span class="dk-brand">Immo<span>Adv</span></span>' : `<span class="dk-brand">${esc(b.company)}</span>`;
  const foot = `${b.footer ? esc(b.footer) : esc(b.company)}${b.mode === 'eigen' ? ' · erstellt mit LeaseRun' : ''}${b.mode === 'leaserun' ? ' · leaserun.com' : ''}`;
  d.innerHTML = `${S.slides.map((k, n) => `<section class="dk-slide${n === 0 ? ' on' : ''}" data-n="${n}"><header class="dk-h">${logo}</header><div class="dk-body">${slideHtml(k, c)}</div><footer class="dk-f"><span>${foot}</span><span>${n + 1} / ${S.slides.length}</span></footer></section>`).join('')}
    <div class="dk-ctl"><button type="button" data-dk="-1" aria-label="Zurück">‹</button><button type="button" data-dk="1" aria-label="Weiter">›</button><button type="button" data-dk="x" aria-label="Beenden">×</button></div>`;
  document.body.append(d); document.body.classList.add('dk-open');
  let n = 0; const sl = d.querySelectorAll('.dk-slide');
  const go = (k) => { n = Math.min(sl.length - 1, Math.max(0, n + k)); sl.forEach((s, j) => s.classList.toggle('on', j === n)); };
  const close = () => { d.remove(); document.body.classList.remove('dk-open'); removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') go(1); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1); else if (e.key === 'Escape') close(); };
  addEventListener('keydown', key);
  d.querySelector('.dk-ctl').onclick = (e) => { const k = e.target.closest('[data-dk]')?.dataset.dk; if (k === 'x') close(); else if (k) go(+k); };
  let x0 = null; d.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  d.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); x0 = null; });
  if (d.requestFullscreen && !print) d.requestFullscreen().catch(() => {});
  if (print) { const done = () => { removeEventListener('afterprint', done); close(); }; addEventListener('afterprint', done); setTimeout(() => print && window.print(), 300); }
}


// ---------- PowerPoint (.pptx) – erzeugt im Browser mit PptxGenJS (MIT), Daten verlassen das Gerät nicht ----------
// Whitelabel: Ab „Kanzlei & Baufi Pro“ Logo, Hausfarben und Schrift des Unternehmens im Master-Layout.
const PPTX_JS = '/vendor/pptxgenjs-4.0.1/pptxgen.bundle.js';
function loadPptx() {
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  return new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = PPTX_JS; sc.onload = () => ok(window.PptxGenJS); sc.onerror = bad; document.head.append(sc); });
}
const hex = (c, d) => (/^#?[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).replace('#', '').toUpperCase() : d);
const PFONT = { sans: 'Calibri', serif: 'Georgia', klassisch: 'Arial' };
export async function exportPptx() {
  const Pptx = await loadPptx();
  const c = calc(S.inputs), i = S.inputs, b = S.info.branding, v = c.variants, v0 = v[0];
  const own = b.mode !== 'leaserun';
  const C1 = hex(b.color, '0F2C59'), C2 = hex(b.color2, '0284C7'), F = own ? PFONT[b.font] || 'Calibri' : 'Calibri';
  const pres = new Pptx();
  pres.layout = 'LAYOUT_WIDE'; // 13,33 × 7,5 Zoll (16:9)
  pres.author = b.advisor || b.company || 'LeaseRun'; pres.company = b.company || 'LeaseRun'; pres.title = `${b.title || 'Finanzierungsübersicht'}${i.kunde ? ' – ' + i.kunde : ''}`;
  const logo = b.logo && /^data:image\/(png|jpe?g);base64,/.test(b.logo) ? b.logo : null;
  const foot = `${b.footer || b.company || 'LeaseRun'}${b.mode === 'eigen' ? ' · erstellt mit LeaseRun' : ''}${b.mode === 'leaserun' ? ' · leaserun.com' : ''}`;
  pres.defineSlideMaster({
    title: 'IA', background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: C1 } } },
      ...(logo ? [{ image: { data: logo, x: 11.4, y: 0.3, w: 1.6, h: 0.6, sizing: { type: 'contain', w: 1.6, h: 0.6 } } }] : [{ text: { text: own ? (b.company || '') : 'LeaseRun', options: { x: 9.3, y: 0.3, w: 3.7, h: 0.5, align: 'right', fontFace: F, fontSize: 14, bold: true, color: C1 } } }]),
      { line: { x: 0.6, y: 6.85, w: 12.1, h: 0, line: { color: 'E2E8F0', width: 1 } } },
      { text: { text: foot, options: { x: 0.6, y: 6.9, w: 9, h: 0.35, fontFace: F, fontSize: 10, color: '64748B' } } },
    ],
    slideNumber: { x: 12.2, y: 6.9, w: 0.6, h: 0.35, fontFace: F, fontSize: 10, color: '64748B', align: 'right' },
  });
  const H = (sl, t, sub) => { sl.addText(t, { x: 0.6, y: 0.45, w: 10.5, h: 0.7, fontFace: F, fontSize: 28, bold: true, color: C1 }); if (sub) sl.addText(sub, { x: 0.6, y: 1.1, w: 11.5, h: 0.4, fontFace: F, fontSize: 14, color: '475569' }); };
  const card = (sl, x, y, w, h, label, value, tone) => {
    sl.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: tone === 'bad' ? 'FEF2F2' : tone === 'ok' ? 'F0FDF4' : 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 } });
    sl.addText(label, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.35, fontFace: F, fontSize: 12, color: '64748B' });
    sl.addText(value, { x: x + 0.2, y: y + 0.5, w: w - 0.4, h: h - 0.65, fontFace: F, fontSize: 24, bold: true, color: C1, valign: 'top' });
  };
  const date = new Date().toLocaleDateString('de-DE');

  // 1 Deckblatt
  const s1 = pres.addSlide({ masterName: 'IA' });
  s1.addShape(pres.ShapeType.rect, { x: 0, y: 0.12, w: 13.33, h: 3.6, fill: { color: C1 } });
  s1.addText(b.title || 'Finanzierungsübersicht', { x: 0.8, y: 0.9, w: 11, h: 0.5, fontFace: F, fontSize: 16, color: 'CBD5E1' });
  s1.addText(i.kunde ? `für ${i.kunde}` : 'Ihre Immobilienfinanzierung', { x: 0.8, y: 1.4, w: 11.5, h: 1.1, fontFace: F, fontSize: 40, bold: true, color: 'FFFFFF' });
  s1.addText(i.objekt || `Kaufpreis ${E(i.kaufpreis)} · Darlehen ${E(c.D)}`, { x: 0.8, y: 2.6, w: 11.5, h: 0.6, fontFace: F, fontSize: 20, color: 'E2E8F0' });
  s1.addText([{ text: 'Ihr Berater', options: { color: '64748B', fontSize: 12, breakLine: true } }, { text: [b.advisor, b.company].filter(Boolean).join(' · ') || 'LeaseRun', options: { color: C1, fontSize: 18, bold: true, breakLine: true } }, { text: `${b.city ? b.city + ', ' : ''}${date}`, options: { color: '475569', fontSize: 14 } }], { x: 0.8, y: 4.3, w: 8, h: 1.4, fontFace: F, valign: 'top' });

  // 2 Objekt- & Standortübersicht
  const s2 = pres.addSlide({ masterName: 'IA' });
  H(s2, 'Objekt im Überblick', i.objekt || 'Eckdaten der Immobilie');
  const qm = i.flaeche > 0 ? E(i.kaufpreis / i.flaeche) : '–';
  [['Kaufpreis', E(i.kaufpreis)], ['Kaufpreis je m²', qm], ['Wohnfläche', i.flaeche > 0 ? `${Math.round(i.flaeche).toLocaleString('de-DE')} m²` : '–'], ['Baujahr', i.baujahr > 0 ? String(Math.round(i.baujahr)) : '–'], ['Energieeffizienz', i.energie || '–'], ['Mieteinnahmen', i.miete > 0 ? E(i.miete) + ' / Monat' : 'Eigennutzung']]
    .forEach(([l, x], k) => card(s2, 0.6 + (k % 3) * 4.1, 1.8 + Math.floor(k / 3) * 2.2, 3.9, 1.9, l, x, l === 'Energieeffizienz' && /^[F-H]/i.test(i.energie || '') ? 'bad' : ''));

  // 3 Haushaltsrechnung & Leistbarkeit (Wasserfall)
  const s3 = pres.addSlide({ masterName: 'IA' });
  H(s3, 'Haushaltsrechnung & Leistbarkeit', 'Einkommen minus Fixkosten = monatlicher Spielraum (Variante ' + (v0?.name || 'A') + ')');
  const inc = i.netto + i.miete * 0.75;
  const steps = [['Einkommen', inc, 0, C2], ['Lebenshaltung', -c.lebens, inc, '94A3B8'], ['Wohnkosten', -i.hausgeld - i.sonst, inc - c.lebens, '94A3B8'], ['Kreditrate', -v0.rate, inc - c.lebens - i.hausgeld - i.sonst, 'F59E0B'], ['Überschuss', v0.ueber, 0, v0.ueber >= 0 ? '22C55E' : 'EF4444']];
  const maxV = Math.max(1, inc), X0 = 0.9, Wb = 2.1, base = 6.2, Hmax = 4.2;
  steps.forEach(([l, val, start, col], k) => {
    const top = val >= 0 ? start + val : start, bottom = val >= 0 ? start : start + val;
    const y = base - (Math.max(top, bottom) / maxV) * Hmax, h = Math.max(0.04, (Math.abs(val) / maxV) * Hmax);
    s3.addShape(pres.ShapeType.rect, { x: X0 + k * 2.45, y: Math.min(base - 0.04, y), w: Wb, h, fill: { color: col } });
    s3.addText(`${val < 0 ? '− ' : ''}${E(Math.abs(val))}`, { x: X0 + k * 2.45, y: Math.min(base - 0.04, y) - 0.4, w: Wb, h: 0.35, align: 'center', fontFace: F, fontSize: 13, bold: true, color: C1 });
    s3.addText(l, { x: X0 + k * 2.45, y: base + 0.08, w: Wb, h: 0.35, align: 'center', fontFace: F, fontSize: 12, color: '334155' });
  });

  // 4 Finanzierungsstruktur
  const s4 = pres.addSlide({ masterName: 'IA' });
  H(s4, 'Finanzierungsstruktur', `Gesamtbedarf ${E(c.bedarf)} = Kaufpreis ${E(i.kaufpreis)} + Nebenkosten ${E(c.nk)}${i.modern ? ' + Modernisierung ' + E(i.modern) : ''}`);
  card(s4, 0.6, 1.8, 3.9, 1.7, 'Eigenkapital', E(i.eigenkapital), c.nkGedeckt ? 'ok' : 'bad');
  card(s4, 4.7, 1.8, 3.9, 1.7, 'Darlehen', E(c.D));
  card(s4, 8.8, 1.8, 3.9, 1.7, 'Beleihungsauslauf', P(c.auslauf));
  const th = (t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: C1 } } });
  s4.addTable([[th('Variante'), th('Sollzins'), th('Tilgung'), th('Zinsbindung'), th('Monatsrate'), th('Restschuld am Ende')], ...v.map((x) => [x.name, P(x.zins, 2), P(x.tilgung, 1), `${x.bindung} Jahre`, E(x.rate), E(x.rest)])],
    { x: 0.6, y: 3.8, w: 12.1, colW: [2.2, 1.7, 1.7, 1.9, 2.1, 2.5], fontFace: F, fontSize: 14, color: '0F172A', border: { type: 'solid', color: 'E2E8F0', pt: 1 }, rowH: 0.5 });

  // 5 Stresstest & Sicherheit
  if (!S.info?.noStress) {
  const s5 = pres.addSlide({ masterName: 'IA' });
  H(s5, 'Stresstest & Sicherheit', 'Rate für die Restschuld, wenn der Zins nach der Zinsbindung um 2 Prozentpunkte höher liegt');
  s5.addChart(pres.ChartType.bar, [{ name: 'Rate heute', labels: v.map((x) => x.name), values: v.map((x) => Math.round(x.rate)) }, { name: 'Rate danach (+2 %)', labels: v.map((x) => x.name), values: v.map((x) => Math.round(x.stress)) }],
    { x: 0.6, y: 1.7, w: 7.6, h: 4.9, barGrouping: 'clustered', chartColors: [C1, 'F59E0B'], showLegend: true, legendPos: 'b', legendFontFace: F, catAxisLabelFontFace: F, valAxisLabelFontFace: F, showValue: true, dataLabelFormatCode: '#,##0 "€"', valAxisLabelFormatCode: '#,##0 "€"' });
  v.forEach((x, k) => card(s5, 8.6, 1.7 + k * 1.65, 4.1, 1.5, `${x.name}: Mehrbelastung`, `+ ${E(Math.max(0, x.stress - x.rate))}`, x.ueber - Math.max(0, x.stress - x.rate) < 0 ? 'bad' : 'ok'));

  }
  // 6 Nächste Schritte
  const miss = missingDocs(S.docs.map((d) => d.type), S.facts);
  const s6 = pres.addSlide({ masterName: 'IA' });
  H(s6, 'Nächste Schritte bis zum Notartermin');
  const todo = [[miss.length ? 'Unterlagen nachreichen' : 'Unterlagen vollständig', miss.length ? miss.slice(0, 4).join(', ') : 'Alles liegt vor', 'diese Woche'], ['Variante festlegen', 'Zinsbindung und Tilgung gemeinsam auswählen', 'im Termin'], ['Finanzierungsanfrage', 'Einreichung mit BankReady-Kreditmappe', '1–2 Wochen'], ['Darlehensangebot & ESIS', 'Verbindliches Angebot prüfen und unterschreiben', '2–4 Wochen'], ['Notartermin', 'Kaufvertrag beurkunden, Grundschuld bestellen', 'nach Zusage']];
  todo.forEach(([t, d, when], k) => {
    const y = 1.5 + k * 1.02;
    s6.addShape(pres.ShapeType.ellipse, { x: 0.7, y: y + 0.08, w: 0.5, h: 0.5, fill: { color: k === 0 && miss.length ? 'F59E0B' : C2 } });
    s6.addText(String(k + 1), { x: 0.7, y: y + 0.08, w: 0.5, h: 0.5, align: 'center', valign: 'middle', fontFace: F, fontSize: 14, bold: true, color: 'FFFFFF' });
    s6.addText([{ text: t, options: { bold: true, color: C1, fontSize: 17, breakLine: true } }, { text: d, options: { color: '475569', fontSize: 13 } }], { x: 1.4, y, w: 8.6, h: 0.9, fontFace: F, valign: 'top' });
    s6.addText(when, { x: 10.2, y, w: 2.5, h: 0.6, align: 'right', fontFace: F, fontSize: 13, color: '64748B' });
  });
  s6.addText('Rechnerische Orientierung, keine Kreditzusage. Die Entscheidung trifft das finanzierende Institut.', { x: 0.6, y: 6.45, w: 12, h: 0.35, fontFace: F, fontSize: 10, italic: true, color: '94A3B8' });

  const safe = (t) => String(t || '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 40);
  await pres.writeFile({ fileName: `${new Date().toISOString().slice(0, 10)}_Beratung_${safe(i.kunde) || 'Kunde'}.pptx` });
}
