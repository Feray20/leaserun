// Software-Tools im Unternehmensportal, die Berater Stunden sparen. Alles rechnet im Browser des Beraters;
// Eingaben bleiben in diesem Browser (localStorage) und werden nicht an LeaseRun übertragen. Ausgabe: Druck / PDF, Text kopieren.
// Basic: Haushaltsrechnung, Unterlagen-Anforderung, Provisionsrechner, Inserats-Pflichtangaben, Ertragswert.
// Pro/Enterprise: zusätzlich Beratungsprotokoll, Bankangebote vergleichen, Vorfälligkeit & Anschluss.
import { monthlyRate, balanceAfterMonths } from './calc.mjs?v=892f3666';
import { compareOffers, forwardCalc, kuendigungsrecht489 } from './b2c-tools.mjs?v=892f3666';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const E2 = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const P = (v, d = 2) => `${(Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
const num = (v) => { let t = String(v ?? '').trim(); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const x = Number(t); return Number.isFinite(x) ? x : 0; };
// v2: ohne Beispielzahlen – alte gespeicherte Beispielwerte werden nicht mehr geladen.
const KEY = (k) => 'lr-b2b-prog2-' + k;
// Datenschutz: Tools mit Kundendaten (Namen, Freitexte) speichern nur für diesen Browser-Tab (sessionStorage) und werden
// beim Abmelden gelöscht. Reine Zahlen-Tools merken sich die letzten Annahmen (localStorage), ohne Personenbezug.
const PERSONAL = new Set(['protokoll', 'unterlagen', 'angebote']);
const store = (k) => (PERSONAL.has(k) ? sessionStorage : localStorage);
const load = (k, d) => { try { return { ...d, ...(JSON.parse(store(k).getItem(KEY(k)) || '{}')) }; } catch { return { ...d }; } };
const save = (k, v) => { try { store(k).setItem(KEY(k), JSON.stringify(v)); } catch { /* ohne Speicher */ } };
export function clearAll() {
  for (const st of [localStorage, sessionStorage]) { try { Object.keys(st).filter((k) => k.startsWith('lr-b2b-prog') || k === 'lr-fall-last').forEach((k) => st.removeItem(k)); } catch { /* ohne Speicher */ } }
}
// Letzte Fall-Analyse (nur Zahlen, nur dieser Tab) – zum Übernehmen in Haushaltsrechnung und Angebotsvergleich.
const lastFall = () => { try { return JSON.parse(sessionStorage.getItem('lr-fall-last') || 'null'); } catch { return null; } };

// Plausibilitätsprüfung: Hinweise auf untypische Eingaben, bevor ein Ergebnis weitergegeben wird.
export function plausi(tool, st) {
  const w = [];
  const z = (v, lo, hi, txt) => { if (v < lo || v > hi) w.push(txt); };
  if ('zins' in st && st.zins > 0) z(st.zins, 0.3, 9, 'Sollzins außerhalb des üblichen Bereichs (0,3–9 %).');
  if ('tilgung' in st && st.tilgung > 0 && tool !== 'vfe') z(st.tilgung, 1, 10, 'Tilgung unter 1 % verlängert die Laufzeit stark; viele Banken verlangen mindestens 1–2 %.');
  if (tool === 'haushalt') {
    if (st.pausch1 < 800) w.push('Lebenshaltungs-Pauschale für die erste Person wirkt niedrig – viele Banken setzen 800–1.200 € an.');
    if (st.mieteAnteil > 80) w.push('Mieteinnahmen werden meist nur zu 60–80 % angesetzt.');
    if (st.puffer < 5) w.push('Ohne Sicherheitspuffer reagiert die Rechnung empfindlich auf Kostensteigerungen.');
  }
  if (tool === 'provision' && st.gesamtPct > 7.14) w.push('Gesamtprovision über 7,14 % inkl. USt. ist ungewöhnlich hoch.');
  if (tool === 'ertrag' && st.preis > 0) { z(st.lz, 1, 7, 'Liegenschaftszins außerhalb von 1–7 % – Wert aus dem Grundstücksmarktbericht prüfen.'); z(st.bwkPct, 10, 40, 'Bewirtschaftungskosten liegen üblicherweise bei 15–30 % der Miete.'); z(st.rnd, 10, 80, 'Restnutzungsdauer meist zwischen 10 und 80 Jahren.'); }
  if (tool === 'vfe' && st.rest > 0) { if (st.restMonate > 180) w.push('Nach 10 Jahren ab Auszahlung gilt § 489 BGB – die Restbindung ist dann für die Entschädigung oft nicht maßgeblich.'); z(st.wiederanlage, 0, 6, 'Wiederanlagezins außerhalb des üblichen Bereichs.'); }
  if (tool === 'angebote') (st.o || []).forEach((o) => { if (num(o.rate) > 0 && num(o.eff) > 0 && num(o.eff) < num(o.rate)) w.push(`${o.bank || 'Angebot'}: Effektivzins liegt unter dem Sollzins – bitte prüfen.`); });
  return w;
}
// Leere Felder als 0 rechnen (Texte bleiben Texte).
const numify = (st) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, typeof v === 'string' && /^[\d.,\s-]*$/.test(v) ? num(v) : v]));
const warnBox = (w) => (w.length ? `<ul class="pg-warn">${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
const today = () => new Date().toLocaleDateString('de-DE');

// ---------- Rechenkerne (exportiert für Tests) ----------

// Haushaltsrechnung nach Bankpraxis: Einnahmen − Pauschalen − Verpflichtungen − neue Rate. Max. Rate/Darlehen aus Überschuss.
export function haushalt(h) {
  const ein = h.netto1 + h.netto2 + h.kindergeld + h.sonstEin + h.mieteNeu * (h.mieteAnteil / 100);
  const leben = h.pausch1 + Math.max(0, h.erwachsene - 1) * h.pauschWeitere + h.kinder * h.pauschKind;
  const aus = leben + h.warmmiete + h.kredite + h.versicherung + h.kfz + h.sonstAus + h.bewirtschaftung;
  const frei = ein - aus;
  const rate = monthlyRate(h.darlehen, h.zins / 100, h.tilgung / 100);
  const ueber = frei - rate;
  const maxRate = Math.max(0, frei * (1 - h.puffer / 100));
  const maxDarlehen = h.zins + h.tilgung > 0 ? (maxRate * 12) / ((h.zins + h.tilgung) / 100) : 0;
  return { ein, leben, aus, frei, rate, ueber, maxRate, maxDarlehen, quote: ein > 0 ? (rate / ein) * 100 : 0 };
}

// Maklerprovision mit Halbteilungsgrundsatz (§§ 656c, 656d BGB) für Wohnung/Einfamilienhaus an Verbraucher.
export function provision({ preis, gesamtPct, kaeuferPct, verbraucherWohnen }) {
  const vk = Math.max(0, gesamtPct - kaeuferPct);
  const brutto = (pct) => (preis * pct) / 100;
  const ok = !verbraucherWohnen || Math.abs(kaeuferPct - vk) < 1e-9 || kaeuferPct === 0 || kaeuferPct < vk;
  const hinweis = !verbraucherWohnen ? 'Keine Halbteilungspflicht (kein Verbraucher oder keine Wohnung / kein Einfamilienhaus).'
    : kaeuferPct === 0 ? 'Innenprovision: Der Verkäufer trägt die Provision allein – zulässig.'
      : Math.abs(kaeuferPct - vk) < 1e-9 ? 'Halbteilung eingehalten: Käufer und Verkäufer zahlen gleich viel (§ 656c BGB).'
        : kaeuferPct < vk ? 'Zulässig nur als Weitergabe: Der Käufer darf höchstens 50 % zahlen und erst, wenn der Verkäufer seinen Anteil nachweislich gezahlt hat (§ 656d BGB).'
          : 'Unzulässig: Der Käufer darf nicht mehr zahlen als der Verkäufer (§§ 656c, 656d BGB).';
  return { kaeufer: brutto(kaeuferPct), verkaeufer: brutto(vk), gesamt: brutto(gesamtPct), kaeuferNetto: brutto(kaeuferPct) / 1.19, verkaeuferPct: vk, ok: ok && !(verbraucherWohnen && kaeuferPct > vk), hinweis };
}

// Ertragswert (vereinfacht nach ImmoWertV 2021, §§ 27 ff.): Reinertrag, Bodenwertverzinsung, Barwertfaktor.
export function ertragswert({ jahresmiete, bwkPct, bodenwert, lz, rnd, preis }) {
  const re = jahresmiete * (1 - bwkPct / 100);
  const p = lz / 100;
  const geb = re - bodenwert * p;
  const v = p > 0 ? (1 - Math.pow(1 + p, -rnd)) / p : rnd;
  const ew = Math.max(0, geb) * v + bodenwert;
  return { re, geb, v, ew, faktor: jahresmiete > 0 ? preis / jahresmiete : 0, abw: ew > 0 ? ((preis - ew) / ew) * 100 : 0 };
}

// Vorfälligkeitsentschädigung (Schätzung nach Aktiv-Passiv-Methode): Zinsschaden über die Restbindung,
// abgezinst mit dem Wiederanlagezins, minus ersparte Risiko- und Verwaltungskosten, plus Bearbeitungsentgelt.
export function vfe({ rest, zins, tilgung, restMonate, wiederanlage, risikoPct = 0.06, verwaltungPct = 0.03, entgelt = 300 }) {
  const a = monthlyRate(rest, zins / 100, tilgung / 100);
  let bal = rest, schaden = 0, ersp = 0;
  const i = zins / 100 / 12, w = wiederanlage / 100 / 12;
  for (let m = 1; m <= restMonate && bal > 0.005; m++) {
    const zi = bal * i;
    const d = 1 / Math.pow(1 + w, m);
    schaden += (zi - bal * w) * d;
    ersp += bal * ((risikoPct + verwaltungPct) / 100 / 12) * d;
    bal -= Math.min(bal, a - zi);
  }
  // Restschuld am Ende der Bindung wird ohnehin fällig: kein Schaden darüber hinaus.
  const v = Math.max(0, schaden - ersp) + (schaden > 0 ? entgelt : 0);
  return { vfe: v, rate: a, schaden: Math.max(0, schaden), ersp };
}

// ---------- gemeinsame Oberfläche ----------
const field = (id, label, value, opts = {}) => `<label class="pg-f${opts.wide ? ' wide' : ''}"><span>${label}</span>${opts.select ? `<select data-k="${id}">${opts.select.map(([v, l]) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : opts.area ? `<textarea data-k="${id}" rows="${opts.rows || 3}" maxlength="3000">${esc(value)}</textarea>` : `<input data-k="${id}" ${opts.text ? 'type="text" maxlength="160"' : opts.date ? 'type="date"' : 'type="number" step="any" inputmode="decimal"'} value="${esc(value)}">`}</label>`;
const check = (id, label, on) => `<label class="pg-c"><input type="checkbox" data-k="${id}"${on ? ' checked' : ''}> <span>${label}</span></label>`;

function bind(box, key, state, run0) {
  const run = () => { run0(); const o = box.querySelector('#pgOut'); if (o) { o.querySelector('.pg-warn')?.remove(); o.insertAdjacentHTML('afterbegin', warnBox(plausi(key, state))); } };
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    state[k] = e.target.type === 'checkbox' ? e.target.checked : (e.target.type === 'number' ? num(e.target.value) : e.target.value);
    save(key, state); run();
  });
  box.addEventListener('change', (e) => { if (e.target.type === 'checkbox' && e.target.dataset.k) { state[e.target.dataset.k] = e.target.checked; save(key, state); run(); } });
  run();
}

function printHtml(title, inner, brand) {
  const w = window.open('', '_blank'); if (!w) return;
  const c = brand?.color || '#0F2C59';
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:13.5px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0F172A;margin:28px}
    header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid ${c};padding-bottom:8px;margin-bottom:14px}
    header img{max-height:46px;max-width:170px}header h1{margin:0;font-size:20px;color:${c}}header small{color:#475569}
    table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border-bottom:1px solid #CBD5E1;padding:6px;text-align:left;vertical-align:top}th{font-size:12px;color:#475569}
    .sig{display:flex;gap:40px;margin-top:40px}.sig div{flex:1;border-top:1px solid #0F172A;padding-top:4px;font-size:12px}
    .note{font-size:11px;color:#475569;margin-top:18px}h2{font-size:15px;color:${c};margin:16px 0 4px}ul{margin:4px 0;padding-left:18px}
  </style></head><body><header><div><h1>${esc(title)}</h1><small>${esc(brand?.sender || '')}${brand?.sender ? ' · ' : ''}${today()}</small></div>${brand?.logo ? `<img src="${esc(brand.logo)}" alt="">` : ''}</header>${inner}
  <p class="note">Erstellt mit LeaseRun. Rechnerische Orientierung auf Grundlage der eingegebenen Werte; keine Kreditzusage. Die aufsichtsrechtliche Prüfung verbleibt beim beratenden bzw. finanzierenden Institut.</p></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}
const copyBtn = (id) => `<button type="button" class="btn btn-outline" id="${id}">Text kopieren</button>`;
async function copy(text, toast) { try { await navigator.clipboard.writeText(text); toast?.('Kopiert.'); } catch { toast?.('Bitte markieren und kopieren.', true); } }

// ---------- 1. Haushaltsrechnung ----------
function pHaushalt(box, ctx) {
  const st = load('haushalt', { netto1: '', netto2: '', kindergeld: '', sonstEin: '', mieteNeu: '', mieteAnteil: 75, erwachsene: 1, kinder: 0, pausch1: 1000, pauschWeitere: 400, pauschKind: 300, warmmiete: '', kredite: '', versicherung: '', kfz: '', sonstAus: '', bewirtschaftung: '', darlehen: '', zins: '', tilgung: 2, puffer: 10 });
  box.innerHTML = `<p class="form-note">Wie eine Bank rechnet: Einnahmen minus Lebenshaltungs-Pauschalen, bestehende Verpflichtungen und neue Rate. Ergebnis: Überschuss, maximale Rate und maximales Darlehen.</p>
    <div class="pg-grid"><h4>Einnahmen / Monat</h4>${field('netto1', 'Netto Person 1', st.netto1)}${field('netto2', 'Netto Person 2', st.netto2)}${field('kindergeld', 'Kindergeld', st.kindergeld)}${field('sonstEin', 'Sonstige Einnahmen', st.sonstEin)}${field('mieteNeu', 'Mieteinnahme Objekt (kalt)', st.mieteNeu)}${field('mieteAnteil', 'davon angesetzt (%)', st.mieteAnteil)}
    <h4>Haushalt</h4>${field('erwachsene', 'Erwachsene', st.erwachsene)}${field('kinder', 'Kinder', st.kinder)}${field('pausch1', 'Pauschale 1. Person', st.pausch1)}${field('pauschWeitere', 'Pauschale weitere Erwachsene', st.pauschWeitere)}${field('pauschKind', 'Pauschale je Kind', st.pauschKind)}
    <h4>Ausgaben / Monat</h4>${field('warmmiete', 'Warmmiete (bleibt bestehen)', st.warmmiete)}${field('kredite', 'Raten bestehender Kredite', st.kredite)}${field('versicherung', 'Versicherungen, Vorsorge', st.versicherung)}${field('kfz', 'Kfz', st.kfz)}${field('sonstAus', 'Sonstiges', st.sonstAus)}${field('bewirtschaftung', 'Bewirtschaftung neue Immobilie', st.bewirtschaftung)}
    <h4>Finanzierung</h4>${field('darlehen', 'Darlehen (€)', st.darlehen)}${field('zins', 'Sollzins (%)', st.zins)}${field('tilgung', 'Tilgung (%)', st.tilgung)}${field('puffer', 'Sicherheitspuffer (%)', st.puffer)}</div>
    <div id="pgOut"></div><div class="pg-act">${lastFall() ? '<button type="button" class="btn btn-outline" id="pgFall">Aus letzter Fall-Analyse übernehmen</button>' : ''}<button type="button" class="btn btn-dark" id="pgPrint">Als PDF / drucken</button></div>`;
  const out = () => box.querySelector('#pgOut');
  box.querySelector('#pgFall')?.addEventListener('click', () => { const f = lastFall(); if (!f) return; Object.assign(st, { netto1: f.netto || st.netto1, netto2: 0, mieteNeu: f.miete || 0, erwachsene: Math.min(2, f.personen || 1), kinder: Math.max(0, (f.personen || 1) - 2), darlehen: Math.round(f.darlehen || st.darlehen), zins: f.zins || st.zins, tilgung: f.tilgung || st.tilgung }); save('haushalt', st); pHaushalt(box, ctx); ctx.toast?.('Werte aus der Fall-Analyse übernommen – bitte prüfen.'); });
  let last;
  bind(box, 'haushalt', st, () => {
    const r = last = haushalt(numify(st));
    if (!(r.ein > 0)) { out().innerHTML = '<p class="form-note">Bitte die Einnahmen des Haushalts eintragen – oder oben „Aus letzter Fall-Analyse übernehmen“.</p>'; return; }
    out().innerHTML = `<div class="pg-kpis"><div class="${r.ueber >= 0 ? 'ok' : 'bad'}"><small>Überschuss nach Rate</small><strong>${E(r.ueber)}</strong></div><div><small>Neue Rate</small><strong>${E(r.rate)}</strong><span>${P(r.quote, 0)} der Einnahmen</span></div><div><small>Maximale Rate (mit Puffer)</small><strong>${E(r.maxRate)}</strong></div><div><small>Maximales Darlehen</small><strong>${E(r.maxDarlehen)}</strong></div></div>
      <p class="form-note">Einnahmen ${E(r.ein)} · Lebenshaltung ${E(r.leben)} · Ausgaben gesamt ${E(r.aus)} · frei vor Rate ${E(r.frei)}. Pauschalen bitte an die Vorgaben Ihres Hauses anpassen.</p>`;
  });
  box.querySelector('#pgPrint').onclick = () => !(last?.ein > 0) ? ctx.toast?.('Bitte zuerst die Einnahmen eintragen.', true) : printHtml('Haushaltsrechnung', `<table><tr><th>Einnahmen</th><td>${E(last.ein)}</td></tr><tr><th>Lebenshaltung (${st.erwachsene} Erw., ${st.kinder} Kinder)</th><td>${E(last.leben)}</td></tr><tr><th>Ausgaben gesamt</th><td>${E(last.aus)}</td></tr><tr><th>Frei vor Rate</th><td>${E(last.frei)}</td></tr><tr><th>Neue Rate (${E(st.darlehen)}, ${P(st.zins)} / ${P(st.tilgung)})</th><td>${E2(last.rate)}</td></tr><tr><th>Überschuss</th><td><strong>${E(last.ueber)}</strong></td></tr><tr><th>Maximales Darlehen (Puffer ${st.puffer} %)</th><td>${E(last.maxDarlehen)}</td></tr></table>`, ctx.brand);
}

// ---------- 2. Unterlagen-Anforderung ----------
const DOCS = {
  basis: ['Personalausweis (Vorder- und Rückseite)', 'Selbstauskunft (unterschrieben)', 'Kontoauszüge der letzten 3 Monate', 'Eigenkapitalnachweis (Kontostand, Depot, Bausparvertrag)', 'Nachweis bestehender Kredite und Leasingverträge'],
  angestellt: ['Gehaltsabrechnungen der letzten 3 Monate', 'Dezember-Abrechnung des Vorjahres', 'Arbeitsvertrag (bei Probezeit oder Befristung)', 'Lohnsteuerbescheinigung'],
  beamter: ['Bezügemitteilungen der letzten 3 Monate', 'Ernennungsurkunde bzw. Nachweis der Verbeamtung'],
  selbst: ['Einkommensteuerbescheide der letzten 2 Jahre', 'Einkommensteuererklärungen der letzten 2 Jahre', 'Bilanzen bzw. EÜR der letzten 2 Jahre', 'Aktuelle BWA mit Summen- und Saldenliste', 'Bestätigung des Steuerberaters über keine Steuerrückstände'],
  rente: ['Aktueller Rentenbescheid', 'Nachweise über Betriebs- oder Privatrenten'],
  etw: ['Exposé', 'Grundbuchauszug (nicht älter als 3 Monate)', 'Teilungserklärung mit Aufteilungsplan', 'Protokolle der letzten 3 Eigentümerversammlungen', 'Wirtschaftsplan und letzte Hausgeldabrechnung', 'Energieausweis', 'Grundrisse und Wohnflächenberechnung', 'Kaufvertragsentwurf'],
  haus: ['Exposé', 'Grundbuchauszug (nicht älter als 3 Monate)', 'Flurkarte', 'Grundrisse, Schnitte, Ansichten', 'Wohnflächen- und Kubaturberechnung', 'Energieausweis', 'Fotos innen und außen', 'Kaufvertragsentwurf'],
  neubau: ['Baubeschreibung', 'Baugenehmigung bzw. Genehmigungsfreistellung', 'Bauzeichnungen und Kostenaufstellung (DIN 276)', 'Bauvertrag bzw. Bauträgervertrag', 'Grundstückskaufvertrag', 'Flurkarte und Lageplan'],
  vermietet: ['Mietvertrag bzw. Mieterliste', 'Nachweis der Mieteingänge (3 Monate)'],
};
export function unterlagenListe({ status, objekt, vermietet }) {
  return [...DOCS.basis, ...(DOCS[status] || []), ...(DOCS[objekt] || []), ...(vermietet ? DOCS.vermietet : [])];
}
function pUnterlagen(box, ctx) {
  const st = load('unterlagen', { kunde: '', anrede: 'Guten Tag', status: 'angestellt', objekt: 'etw', vermietet: false, frist: 14, extra: '' });
  box.innerHTML = `<p class="form-note">Erstellt die vollständige Unterlagenliste passend zu Einkommensart und Objekt – als E-Mail-Text oder Checkliste zum Ausdrucken.</p>
    <div class="pg-grid">${field('kunde', 'Name des Kunden', st.kunde, { text: true })}${field('anrede', 'Anrede', st.anrede, { select: [['Guten Tag', 'Guten Tag'], ['Sehr geehrte Frau', 'Sehr geehrte Frau'], ['Sehr geehrter Herr', 'Sehr geehrter Herr'], ['Hallo', 'Hallo']] })}
    ${field('status', 'Einkommen', st.status, { select: [['angestellt', 'Angestellt'], ['beamter', 'Beamter'], ['selbst', 'Selbstständig / Freiberufler'], ['rente', 'Rente / Pension']] })}${field('objekt', 'Objekt', st.objekt, { select: [['etw', 'Eigentumswohnung'], ['haus', 'Haus (Bestand)'], ['neubau', 'Neubau / Bauträger']] })}
    ${field('frist', 'Frist (Tage)', st.frist)}${check('vermietet', 'Objekt wird vermietet', st.vermietet)}${field('extra', 'Zusätzliche Unterlagen (eine pro Zeile)', st.extra, { area: true, wide: true })}</div>
    <div id="pgOut"></div><div class="pg-act">${copyBtn('pgCopy')}<button type="button" class="btn btn-outline" id="pgMail">Als E-Mail öffnen</button><button type="button" class="btn btn-dark" id="pgPrint">Checkliste drucken</button></div>`;
  let text = '', list = [];
  bind(box, 'unterlagen', st, () => {
    list = [...unterlagenListe(st), ...String(st.extra || '').split('\n').map((s) => s.trim()).filter(Boolean)];
    const bis = new Date(Date.now() + num(st.frist) * 864e5).toLocaleDateString('de-DE');
    text = `${st.anrede}${st.kunde ? ' ' + st.kunde : ''},\n\nfür die Prüfung Ihrer Finanzierung benötige ich bitte bis ${bis} die folgenden Unterlagen (gern als PDF):\n\n${list.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\nSollte etwas fehlen oder unklar sein, melden Sie sich gern. Vielen Dank!\n\nMit freundlichen Grüßen\n${ctx.brand?.sender || ''}`;
    box.querySelector('#pgOut').innerHTML = `<p class="form-note"><strong>${list.length} Unterlagen</strong> · Frist ${bis}</p><textarea class="pg-text" rows="12" readonly>${esc(text)}</textarea>`;
  });
  box.querySelector('#pgCopy').onclick = () => copy(text, ctx.toast);
  box.querySelector('#pgMail').onclick = () => { location.href = `mailto:?subject=${encodeURIComponent('Unterlagen für Ihre Finanzierung')}&body=${encodeURIComponent(text)}`; };
  box.querySelector('#pgPrint').onclick = () => printHtml(`Unterlagen-Checkliste${st.kunde ? ' – ' + st.kunde : ''}`, `<table><tr><th>Nr.</th><th>Unterlage</th><th>liegt vor</th></tr>${list.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d)}</td><td>☐</td></tr>`).join('')}</table>`, ctx.brand);
}

// ---------- 3. Provisionsrechner ----------
function pProvision(box, ctx) {
  const st = load('provision', { preis: '', gesamtPct: 7.14, kaeuferPct: 3.57, verbraucherWohnen: true });
  box.innerHTML = `<p class="form-note">Provision brutto und netto, Aufteilung nach Halbteilungsgrundsatz (§§ 656a–656d BGB) und der passende Satz für Ihr Exposé.</p>
    <div class="pg-grid">${field('preis', 'Kaufpreis (€)', st.preis)}${field('gesamtPct', 'Gesamtprovision inkl. USt. (%)', st.gesamtPct)}${field('kaeuferPct', 'davon Käufer (%)', st.kaeuferPct)}${check('verbraucherWohnen', 'Käufer ist Verbraucher und Objekt ist Wohnung oder Einfamilienhaus', st.verbraucherWohnen)}</div>
    <div id="pgOut"></div><div class="pg-act">${copyBtn('pgCopy')}</div>`;
  let text = '';
  bind(box, 'provision', st, () => {
    if (!(num(st.preis) > 0)) { box.querySelector('#pgOut').innerHTML = '<p class="form-note">Bitte den Kaufpreis eintragen.</p>'; text = ''; return; }
    const r = provision(numify(st));
    text = st.kaeuferPct > 0 ? `Käuferprovision: ${P(st.kaeuferPct)} des Kaufpreises inkl. gesetzlicher USt. (${E2(r.kaeufer)}), fällig mit notariellem Kaufvertrag. Der Verkäufer zahlt ${P(r.verkaeuferPct)}.` : 'Für den Käufer provisionsfrei.';
    box.querySelector('#pgOut').innerHTML = `<div class="pg-kpis"><div><small>Käufer zahlt</small><strong>${E2(r.kaeufer)}</strong><span>netto ${E2(r.kaeuferNetto)}</span></div><div><small>Verkäufer zahlt</small><strong>${E2(r.verkaeufer)}</strong><span>${P(r.verkaeuferPct)}</span></div><div><small>Provision gesamt</small><strong>${E2(r.gesamt)}</strong><span>netto ${E2(r.gesamt / 1.19)}</span></div></div>
      <p class="pg-verdict ${r.ok ? 'ok' : 'bad'}">${esc(r.hinweis)}</p><p class="form-note"><strong>Exposé-Text:</strong> ${esc(text)} Maklerverträge über Wohnungen und Einfamilienhäuser bedürfen der Textform (§ 656a BGB).</p>`;
  });
  box.querySelector('#pgCopy').onclick = () => copy(text, ctx.toast);
}

// ---------- 4. Inserats-Pflichtangaben (§ 87 GEG) ----------
export function gegText(g) {
  const fehlt = [];
  if (!g.art) fehlt.push('Art des Energieausweises');
  if (!(g.kennwert > 0)) fehlt.push('Energiekennwert');
  if (!g.traeger) fehlt.push('wesentlicher Energieträger');
  if (!(g.baujahr > 1000)) fehlt.push('Baujahr');
  if (g.wohn && !g.klasse) fehlt.push('Energieeffizienzklasse');
  const t = `Energieausweis: ${g.art === 'bedarf' ? 'Bedarfsausweis' : g.art === 'verbrauch' ? 'Verbrauchsausweis' : '–'}, Endenergie${g.art === 'bedarf' ? 'bedarf' : 'verbrauch'} ${g.kennwert ? String(g.kennwert).replace('.', ',') : '–'} kWh/(m²·a)${g.warmwasser && g.art === 'verbrauch' ? ' inkl. Warmwasser' : ''}, wesentlicher Energieträger: ${g.traeger || '–'}, Baujahr laut Energieausweis: ${g.baujahr || '–'}${g.wohn ? `, Energieeffizienzklasse: ${g.klasse || '–'}` : ''}.`;
  return { text: t, fehlt };
}
function pInserat(box, ctx) {
  const st = load('inserat', { art: 'verbrauch', kennwert: '', warmwasser: true, traeger: '', baujahr: '', wohn: true, klasse: '' });
  box.innerHTML = `<p class="form-note">Pflichtangaben in Immobilienanzeigen nach § 87 GEG – vollständig und im richtigen Wortlaut. Fehlende Angaben werden markiert (Bußgeldrisiko).</p>
    <div class="pg-grid">${field('art', 'Art des Ausweises', st.art, { select: [['verbrauch', 'Verbrauchsausweis'], ['bedarf', 'Bedarfsausweis']] })}${field('kennwert', 'Kennwert (kWh/m²a)', st.kennwert)}${field('traeger', 'Wesentlicher Energieträger', st.traeger, { select: [['Erdgas', 'Erdgas'], ['Heizöl', 'Heizöl'], ['Fernwärme', 'Fernwärme'], ['Strom (Wärmepumpe)', 'Strom (Wärmepumpe)'], ['Holz/Pellets', 'Holz/Pellets'], ['Flüssiggas', 'Flüssiggas'], ['Strom', 'Strom']] })}${field('baujahr', 'Baujahr (lt. Ausweis)', st.baujahr)}${field('klasse', 'Effizienzklasse', st.klasse, { select: [['', '–'], ...['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((k) => [k, k])] })}${check('wohn', 'Wohngebäude (Klasse anzugeben)', st.wohn)}${check('warmwasser', 'Warmwasser im Verbrauchswert enthalten', st.warmwasser)}</div>
    <div id="pgOut"></div><div class="pg-act">${copyBtn('pgCopy')}</div>`;
  let text = '';
  bind(box, 'inserat', st, () => {
    const r = gegText(numify(st)); text = r.text;
    box.querySelector('#pgOut').innerHTML = `<p class="pg-verdict ${r.fehlt.length ? 'bad' : 'ok'}">${r.fehlt.length ? 'Es fehlen: ' + esc(r.fehlt.join(', ')) + '.' : 'Alle Pflichtangaben vorhanden.'}</p><textarea class="pg-text" rows="3" readonly>${esc(text)}</textarea><p class="form-note">Liegt noch kein Energieausweis vor, muss er spätestens bei der Besichtigung vorgelegt werden (§ 80 Abs. 4 GEG).</p>`;
  });
  box.querySelector('#pgCopy').onclick = () => copy(text, ctx.toast);
}

// ---------- 5. Ertragswert-Schnellcheck ----------
function pErtrag(box, ctx) {
  const st = load('ertrag', { preis: '', jahresmiete: '', bwkPct: 22, bodenwert: '', lz: '', rnd: '' });
  box.innerHTML = `<p class="form-note">Vereinfachter Ertragswert nach ImmoWertV (Reinertrag, Bodenwertverzinsung, Barwertfaktor) und Abweichung zum Angebotspreis. Für Mehrfamilienhäuser und Anlageobjekte.</p>
    <div class="pg-grid">${field('preis', 'Angebotspreis (€)', st.preis)}${field('jahresmiete', 'Jahresnettokaltmiete (€)', st.jahresmiete)}${field('bwkPct', 'Bewirtschaftungskosten (% der Miete)', st.bwkPct)}${field('bodenwert', 'Bodenwert (€)', st.bodenwert)}${field('lz', 'Liegenschaftszins (%)', st.lz)}${field('rnd', 'Restnutzungsdauer (Jahre)', st.rnd)}</div>
    <div id="pgOut"></div><div class="pg-act"><button type="button" class="btn btn-dark" id="pgPrint">Als PDF / drucken</button></div>`;
  let r;
  bind(box, 'ertrag', st, () => {
    if (!(num(st.jahresmiete) > 0) || !(num(st.lz) > 0) || !(num(st.rnd) > 0)) { box.querySelector('#pgOut').innerHTML = '<p class="form-note">Bitte Jahresmiete, Liegenschaftszins und Restnutzungsdauer eintragen (Werte aus dem Grundstücksmarktbericht).</p>'; r = null; return; }
    r = ertragswert(numify(st));
    box.querySelector('#pgOut').innerHTML = `<div class="pg-kpis"><div><small>Ertragswert</small><strong>${E(r.ew)}</strong></div><div class="${r.abw > 10 ? 'bad' : r.abw < -5 ? 'ok' : ''}"><small>Preis vs. Ertragswert</small><strong>${r.abw >= 0 ? '+' : ''}${P(r.abw, 1)}</strong></div><div><small>Kaufpreisfaktor</small><strong>${r.faktor.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</strong><span>Rendite brutto ${P(st.preis ? st.jahresmiete / st.preis * 100 : 0)}</span></div></div>
      <p class="form-note">Reinertrag ${E(r.re)} − Bodenwertverzinsung ${E(st.bodenwert * st.lz / 100)} = Gebäudereinertrag ${E(r.geb)} × Barwertfaktor ${r.v.toFixed(2).replace('.', ',')} + Bodenwert ${E(st.bodenwert)}. Liegenschaftszins und Bodenwert aus dem Grundstücksmarktbericht bzw. BORIS übernehmen. Keine Verkehrswertermittlung nach § 194 BauGB.</p>`;
  });
  box.querySelector('#pgPrint').onclick = () => !r ? ctx.toast?.('Bitte zuerst die Werte eintragen.', true) : printHtml('Ertragswert-Schnellcheck', `<table><tr><th>Angebotspreis</th><td>${E(st.preis)}</td></tr><tr><th>Jahresnettokaltmiete</th><td>${E(st.jahresmiete)}</td></tr><tr><th>Bewirtschaftungskosten</th><td>${P(st.bwkPct, 0)}</td></tr><tr><th>Reinertrag</th><td>${E(r.re)}</td></tr><tr><th>Bodenwert / Liegenschaftszins</th><td>${E(st.bodenwert)} / ${P(st.lz)}</td></tr><tr><th>Restnutzungsdauer / Barwertfaktor</th><td>${st.rnd} J. / ${r.v.toFixed(2).replace('.', ',')}</td></tr><tr><th>Ertragswert</th><td><strong>${E(r.ew)}</strong></td></tr><tr><th>Abweichung Angebotspreis</th><td>${P(r.abw, 1)}</td></tr><tr><th>Kaufpreisfaktor</th><td>${r.faktor.toFixed(1).replace('.', ',')}</td></tr></table>`, ctx.brand);
}

// ---------- 6. Beratungsprotokoll (Immobiliar-Verbraucherdarlehen) ----------
const RISKS = [['zins', 'Zinsänderungsrisiko nach Ablauf der Sollzinsbindung erläutert (Anschlusszins kann höher sein)'], ['anschluss', 'Restschuld am Ende der Zinsbindung und Notwendigkeit der Anschlussfinanzierung erläutert'], ['sonder', 'Sondertilgungsrechte und Tilgungssatzwechsel besprochen'], ['vfe', 'Vorfälligkeitsentschädigung bei vorzeitiger Rückzahlung erläutert'], ['bereit', 'Bereitstellungszinsen und Auszahlungsvoraussetzungen erläutert'], ['absicherung', 'Absicherung von Tod, Berufsunfähigkeit und Arbeitslosigkeit angesprochen'], ['nk', 'Kaufnebenkosten und Eigenkapitaleinsatz besprochen'], ['esis', 'ESIS-Merkblatt rechtzeitig vor Vertragsschluss ausgehändigt'], ['bedenk', 'Widerrufsrecht bzw. Bedenkzeit erläutert']];
function pProtokoll(box, ctx) {
  const st = load('protokoll', { kunde: '', datum: new Date().toISOString().slice(0, 10), ort: '', anlass: '', bedarf: '', einkommen: '', vermoegen: '', wunsch: '', empfehlung: '', alternativen: '', begruendung: '', abweichung: '', ...Object.fromEntries(RISKS.map(([k]) => [k, false])) });
  box.innerHTML = `<p class="form-note">Strukturiertes Protokoll für die Beratung zu Immobiliar-Verbraucherdarlehen (§ 511 BGB): Bedarf, Empfehlung, Alternativen, Risikohinweise, Unterschriften. Ersetzt nicht die Vorgaben Ihres Hauses.</p>
    <div class="pg-grid">${field('kunde', 'Kunde(n)', st.kunde, { text: true })}${field('datum', 'Datum', st.datum, { date: true })}${field('ort', 'Ort / Kanal', st.ort, { text: true })}${field('anlass', 'Anlass', st.anlass, { text: true })}
    ${field('bedarf', 'Finanzierungsbedarf und Verwendung', st.bedarf, { area: true, wide: true })}${field('einkommen', 'Einkommens- und Ausgabensituation', st.einkommen, { area: true, wide: true })}${field('vermoegen', 'Vermögen und Eigenkapital', st.vermoegen, { area: true, wide: true })}${field('wunsch', 'Wünsche und Ziele des Kunden', st.wunsch, { area: true, wide: true })}
    ${field('empfehlung', 'Empfehlung (Darlehen, Zinsbindung, Tilgung, Anbieter)', st.empfehlung, { area: true, wide: true })}${field('alternativen', 'Geprüfte Alternativen', st.alternativen, { area: true, wide: true })}${field('begruendung', 'Begründung der Empfehlung', st.begruendung, { area: true, wide: true })}${field('abweichung', 'Abweichender Kundenwunsch (falls vorhanden)', st.abweichung, { area: true, wide: true })}</div>
    <h4 class="pg-h4">Hinweise und Risiken</h4><div class="pg-checks">${RISKS.map(([k, l]) => check(k, l, st[k])).join('')}</div>
    <div id="pgOut"></div><div class="pg-act"><button type="button" class="btn btn-dark" id="pgPrint">Protokoll als PDF / drucken</button></div>`;
  bind(box, 'protokoll', st, () => {
    const open = RISKS.filter(([k]) => !st[k]).length;
    const missing = ['kunde', 'bedarf', 'empfehlung', 'begruendung'].filter((k) => !String(st[k] || '').trim());
    box.querySelector('#pgOut').innerHTML = `<p class="pg-verdict ${open || missing.length ? 'bad' : 'ok'}">${missing.length ? `Noch leer: ${missing.map((k) => ({ kunde: 'Kunde', bedarf: 'Bedarf', empfehlung: 'Empfehlung', begruendung: 'Begründung' }[k])).join(', ')}. ` : ''}${open ? `${open} Hinweis${open === 1 ? '' : 'e'} noch nicht abgehakt.` : 'Alle Hinweise dokumentiert.'}</p>`;
  });
  box.querySelector('#pgPrint').onclick = () => {
    const sec = (h, v) => `<h2>${h}</h2><p>${esc(v || '–').replace(/\n/g, '<br>')}</p>`;
    printHtml('Beratungsprotokoll Immobilienfinanzierung', `<table><tr><th>Kunde</th><td>${esc(st.kunde)}</td><th>Datum</th><td>${st.datum ? new Date(st.datum).toLocaleDateString('de-DE') : ''}</td></tr><tr><th>Ort / Kanal</th><td>${esc(st.ort)}</td><th>Anlass</th><td>${esc(st.anlass)}</td></tr></table>
      ${sec('Bedarf', st.bedarf)}${sec('Einkommen und Ausgaben', st.einkommen)}${sec('Vermögen', st.vermoegen)}${sec('Wünsche und Ziele', st.wunsch)}${sec('Empfehlung', st.empfehlung)}${sec('Geprüfte Alternativen', st.alternativen)}${sec('Begründung', st.begruendung)}${st.abweichung ? sec('Abweichender Kundenwunsch', st.abweichung) : ''}
      <h2>Hinweise</h2><ul>${RISKS.map(([k, l]) => `<li>${st[k] ? '☑' : '☐'} ${esc(l)}</li>`).join('')}</ul>
      <div class="sig"><div>Ort, Datum, Unterschrift Kunde</div><div>Ort, Datum, Unterschrift Berater</div></div>`, ctx.brand);
  };
}

// ---------- 7. Bankangebote vergleichen ----------
function pAngebote(box, ctx) {
  const st = load('angebote', { kunde: '', o: Array.from({ length: 4 }, () => ({ bank: '', loan: '', rate: '', eff: '', repay: 2, years: '', fees: '' })) });
  const lf = lastFall(); if (lf?.darlehen) st.o.forEach((o) => { if (!num(o.loan)) o.loan = Math.round(lf.darlehen); });
  const F = [['bank', 'Anbieter', 'text'], ['loan', 'Darlehen'], ['rate', 'Soll %'], ['eff', 'Eff. %'], ['repay', 'Tilg. %'], ['years', 'Bindung J.'], ['fees', 'Gebühren €']];
  box.innerHTML = `<p class="form-note">Bis zu vier Angebote nebeneinander: Rate, Zinsen in der Bindung, Restschuld, Gesamtkosten – mit Empfehlung und druckfertigem Vergleich für den Kunden.</p>
    <div class="pg-grid">${field('kunde', 'Kunde', st.kunde, { text: true })}</div>
    <div class="pg-tablewrap"><table class="pg-in"><thead><tr>${F.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${st.o.map((o, i) => `<tr>${F.map(([k, , t]) => `<td><input data-o="${i}" data-ok="${k}" ${t ? 'type="text" maxlength="40"' : 'type="number" step="any"'} value="${esc(o[k])}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div id="pgOut"></div><div class="pg-act"><button type="button" class="btn btn-dark" id="pgPrint">Vergleich für den Kunden drucken</button></div>`;
  let r;
  const run = () => {
    r = compareOffers(st.o.map((o) => ({ ...o, loan: num(o.loan), rate: num(o.rate), eff: num(o.eff), repay: num(o.repay), years: num(o.years), fees: num(o.fees) })));
    box.querySelector('#pgOut').innerHTML = warnBox(plausi('angebote', st)) + (r.rows.length ? `<div class="pg-tablewrap"><table class="pg-res"><thead><tr><th>Anbieter</th><th>Rate</th><th>Zinsen Bindung</th><th>Gebühren</th><th>Restschuld</th></tr></thead><tbody>${r.rows.map((x) => `<tr class="${x === r.best ? 'best' : ''}"><td><strong>${esc(x.bank || '–')}</strong><small>${P(x.rate)} / eff. ${P(x.eff)} · ${x.years} J.</small></td><td>${E2(x.pay)}</td><td>${E(x.interest)}</td><td>${E(x.fees)}</td><td>${E(x.rest)}</td></tr>`).join('')}</tbody></table></div><p class="pg-verdict ok">Günstigstes Angebot (Zinsen + Gebühren + Restschuld): <strong>${esc(r.best.bank || '–')}</strong>${r.sameYears ? '' : ' – Achtung: unterschiedliche Zinsbindungen.'}</p>` : '<p class="form-note">Bitte Angebote eintragen.</p>');
  };
  box.addEventListener('input', (e) => { const t = e.target; if (t.dataset.o != null) { st.o[+t.dataset.o][t.dataset.ok] = t.value; } else if (t.dataset.k) st[t.dataset.k] = t.value; save('angebote', st); run(); });
  run();
  box.querySelector('#pgPrint').onclick = () => printHtml(`Finanzierungsangebote im Vergleich${st.kunde ? ' – ' + st.kunde : ''}`, `<table><tr><th>Anbieter</th><th>Sollzins / eff.</th><th>Bindung</th><th>Rate</th><th>Zinsen in der Bindung</th><th>Gebühren</th><th>Restschuld</th></tr>${r.rows.map((x) => `<tr${x === r.best ? ' style="background:#DCFCE7"' : ''}><td>${esc(x.bank)}</td><td>${P(x.rate)} / ${P(x.eff)}</td><td>${x.years} J.</td><td>${E2(x.pay)}</td><td>${E(x.interest)}</td><td>${E(x.fees)}</td><td>${E(x.rest)}</td></tr>`).join('')}</table><p>Empfehlung nach Kosten: <strong>${esc(r.best?.bank || '')}</strong>.</p>`, ctx.brand);
}

// ---------- 8. Vorfälligkeit & Anschluss ----------
function pVfe(box, ctx) {
  const st = load('vfe', { rest: '', zins: '', tilgung: 2, restMonate: '', wiederanlage: '', entgelt: 300, heute: '', aufschlag: 0.02, payout: '', neuTilgung: 2 });
  box.innerHTML = `<p class="form-note">Lohnt sich die vorzeitige Ablösung oder ein Forward? Schätzung der Vorfälligkeitsentschädigung (Aktiv-Passiv-Methode), Forward-Zins und Kündigungsrecht nach § 489 BGB.</p>
    <div class="pg-grid"><h4>Bestehendes Darlehen</h4>${field('rest', 'Restschuld heute (€)', st.rest)}${field('zins', 'Vertragszins (%)', st.zins)}${field('tilgung', 'Tilgung (%)', st.tilgung)}${field('restMonate', 'Restlaufzeit der Bindung (Monate)', st.restMonate)}${field('wiederanlage', 'Wiederanlagezins Pfandbriefe (%)', st.wiederanlage)}${field('entgelt', 'Bearbeitungsentgelt (€)', st.entgelt)}${field('payout', 'Vollständig ausgezahlt am', st.payout, { date: true })}
    <h4>Anschluss</h4>${field('heute', 'Heutiger Zins (%)', st.heute)}${field('aufschlag', 'Forward-Aufschlag / Monat (Pkt.)', st.aufschlag)}${field('neuTilgung', 'Tilgung danach (%)', st.neuTilgung)}</div>
    <div id="pgOut"></div>`;
  bind(box, 'vfe', st, () => {
    if (!(num(st.rest) > 0) || !(num(st.zins) > 0)) { box.querySelector('#pgOut').innerHTML = '<p class="form-note">Bitte Restschuld, Vertragszins und Restlaufzeit eintragen.</p>'; return; }
    const n = numify(st); const v = vfe(n);
    const restEnd = balanceAfterMonths(n.rest, n.zins / 100, n.tilgung / 100, n.restMonate);
    const f = forwardCalc({ rest: restEnd, monthsToEnd: n.restMonate, todayRate: n.heute || n.zins, surchargePerMonth: n.aufschlag, repay: n.neuTilgung });
    const k = kuendigungsrecht489(st.payout);
    box.querySelector('#pgOut').innerHTML = `<div class="pg-kpis"><div class="${v.vfe > 0 ? 'bad' : 'ok'}"><small>Vorfälligkeitsentschädigung (Schätzung)</small><strong>${E(v.vfe)}</strong><span>Zinsschaden ${E(v.schaden)} − Ersparnis ${E(v.ersp)}</span></div><div><small>Restschuld am Bindungsende</small><strong>${E(restEnd)}</strong></div><div><small>Forward-Zins</small><strong>${P(f.fwdRate)}</strong><span>Rate ${E2(f.fwdPay)}</span></div></div>
      <p class="pg-verdict">${st.wiederanlage >= st.zins ? 'Der Wiederanlagezins liegt über dem Vertragszins: Der Bank entsteht kein Zinsschaden – eine Ablösung ist meist ohne hohe Entschädigung möglich.' : 'Der Vertragszins liegt über dem Wiederanlagezins: Eine vorzeitige Ablösung kostet eine Entschädigung. Prüfen Sie Sonderkündigungsrechte und § 489 BGB.'}${k ? ` Kündigung nach § 489 BGB ohne Entschädigung möglich ab ${k.from.toLocaleDateString('de-DE')} (6 Monate Frist).` : ''}</p>
      <p class="form-note">Schätzung zur Orientierung: Banken rechnen mit tagesgenauen Pfandbriefrenditen und eigenen Abzügen. Bei fehlerhafter Pflichtangabe im Vertrag kann der Anspruch entfallen (§ 502 Abs. 2 BGB).</p>`;
  });
}

// ---------- Register ----------
export const PROGRAMS = [
  { id: 'haushalt', t: 'Haushaltsrechnung', d: 'Überschuss, maximale Rate und maximales Darlehen wie die Bank', tier: 'BASIC', fn: pHaushalt, br: ['bank', 'vermittler', 'finanzberater', 'allgemein'] },
  { id: 'unterlagen', t: 'Unterlagen-Anforderung', d: 'Vollständige Liste je Einkommensart und Objekt, als E-Mail oder Checkliste', tier: 'BASIC', fn: pUnterlagen, br: ['bank', 'vermittler', 'finanzberater', 'makler', 'allgemein'] },
  { id: 'angebote', t: 'Bankangebote vergleichen', d: 'Bis zu vier Angebote, Kosten bis Bindungsende, druckfertig für den Kunden', tier: 'PRO', fn: pAngebote, br: ['vermittler', 'finanzberater', 'bank', 'allgemein'] },
  { id: 'protokoll', t: 'Beratungsprotokoll', d: 'Bedarf, Empfehlung, Alternativen, Risikohinweise, Unterschriften (§ 511 BGB)', tier: 'PRO', fn: pProtokoll, br: ['bank', 'vermittler', 'finanzberater', 'allgemein'] },
  { id: 'vfe', t: 'Vorfälligkeit & Anschluss', d: 'Entschädigung schätzen, Forward-Zins, Kündigungsrecht § 489 BGB', tier: 'PRO', fn: pVfe, br: ['bank', 'vermittler', 'finanzberater', 'allgemein'] },
  { id: 'provision', t: 'Provisionsrechner', d: 'Halbteilung nach §§ 656c/656d BGB, brutto/netto, Exposé-Text', tier: 'BASIC', fn: pProvision, br: ['makler', 'allgemein'] },
  { id: 'inserat', t: 'Inserats-Pflichtangaben', d: 'Energieangaben nach § 87 GEG prüfen und Text erzeugen', tier: 'BASIC', fn: pInserat, br: ['makler', 'allgemein'] },
  { id: 'ertrag', t: 'Ertragswert-Schnellcheck', d: 'Ertragswert nach ImmoWertV, Kaufpreisfaktor, Abweichung zum Preis', tier: 'BASIC', fn: pErtrag, br: ['makler', 'finanzberater', 'bank', 'vermittler', 'allgemein'] },
];
const RANK = { BASIC: 1, PRO: 2, ENTERPRISE: 3 };

export function renderPrograms(box, { tier, branche, tools, brand, toast }) {
  // Tools je gebuchter Branche und Paket (Katalog im Web-Admin); ohne Katalogdaten wie bisher nach Tarif.
  const vis = tools?.visible ? new Set(tools.visible) : null, unl = tools?.unlocked ? new Set(tools.unlocked) : null;
  const has = (p) => (unl ? unl.has(p.id) : (RANK[tier] || 0) >= RANK[p.tier]);
  const order = [...PROGRAMS].filter((p) => !vis || vis.has(p.id)).sort((a, b) => (has(b) ? 1 : 0) - (has(a) ? 1 : 0) || (b.br.includes(branche) ? 1 : 0) - (a.br.includes(branche) ? 1 : 0));
  box.innerHTML = `<section class="pt-card"><h2>Software-Tools</h2><p class="form-note">Rechnet im Browser, Eingaben bleiben auf diesem Gerät. Ergebnisse als PDF oder Text${brand?.logo ? ' mit Ihrem Logo' : ' – mit Ihrem Logo ab Pro'}.</p>
    <div class="pg-list">${order.map((p) => `<button type="button" class="pg-tile${has(p) ? '' : ' locked'}" data-pg="${p.id}"><strong>${esc(p.t)}</strong><span>${esc(p.d)}</span><em>${has(p) ? 'öffnen' : !tier ? 'mit Paket' : 'im größeren Paket'}</em></button>`).join('')}</div><p class="form-note">Weitere Tools gibt es mit einer zusätzlichen Branche – unter <a href="#tarif">Tarif</a> dazubuchen.</p></section>
    <section class="pt-card" id="pgBox" hidden></section>`;
  const open = (id) => {
    const p = PROGRAMS.find((x) => x.id === id); if (!p) return;
    const b = box.querySelector('#pgBox'); b.hidden = false;
    box.querySelectorAll('.pg-tile').forEach((t) => t.classList.toggle('on', t.dataset.pg === id));
    if (!has(p)) { b.innerHTML = `<h3>${esc(p.t)}</h3><div class="pt-alert warn"><strong>${tier ? 'Dieses Tool ist im größeren Paket Ihrer Branche enthalten.' : 'Software-Tools gibt es mit einem Paket Ihrer Branche.'}</strong> <a class="btn btn-dark" href="#tarif">Tarif ansehen</a></div>`; return; }
    b.innerHTML = `<div class="pg-head"><h3>${esc(p.t)}</h3><span><button type="button" class="text-btn" id="pgReset">Eingaben löschen</button> <button type="button" class="text-btn" id="pgClose">Schließen</button></span></div><div id="pgBody"></div>
      <p class="pg-legal">${PERSONAL.has(p.id) ? 'Kundendaten in diesem Tool bleiben nur in diesem Browser-Tab und werden beim Abmelden gelöscht – sie werden nicht an LeaseRun übertragen. ' : 'Eingaben bleiben auf diesem Gerät und werden nicht an LeaseRun übertragen. '}Rechnerische Orientierung, keine Kreditentscheidung und keine Rechts- oder Steuerberatung; die berufsrechtliche Verantwortung (§§ 34c, 34i GewO, § 511 BGB) bleibt beim Berater.</p>`;
    b.querySelector('#pgReset').onclick = () => { try { store(p.id).removeItem(KEY(p.id)); } catch { /* ohne Speicher */ } open(id); toast?.('Eingaben gelöscht.'); };
    b.querySelector('#pgClose').onclick = () => { b.hidden = true; box.querySelectorAll('.pg-tile').forEach((t) => t.classList.remove('on')); };
    const body = b.querySelector('#pgBody');
    p.fn(body, { brand, toast });
    b.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  box.querySelectorAll('[data-pg]').forEach((t) => t.onclick = () => open(t.dataset.pg));
}
