// Web-Admin → B2C → Freischaltung: steuert, was Besucher ohne Zugang sehen (Vorschau) und was für alle offen ist.
// Eine Einstellung für die ganze Website; Kunden mit Zugang sehen immer alles.
import { api, esc } from './sess.mjs?v=892f3666';

const L = '/api/admin/freischaltung';
const AREAS = [
  ['wissen', 'Wissenszentrale', 'Vorschau: Fragen sichtbar, Antworten nur als Leseprobe (erster Satz). Offen: alle Antworten für alle.'],
  ['rechner', 'Rechner', 'Vorschau: nur Musterfall mit Beispielwerten, Eingaben/Export gesperrt. Offen: jeder kann eigene Zahlen rechnen.'],
  ['beispiele', 'Beispiele & Muster-PDFs', 'Vorschau: Kennzahlen, erster Abschnitt und ein Teil der PDF-Seiten. Offen: alles vollständig.'],
];

export async function freischaltung(v, { msg }) {
  const r = await api(L);
  if (!r.ok) { v.innerHTML = `<div class="wa-state err" role="alert"><strong>Einstellungen konnten nicht geladen werden.</strong><span>${esc(r.data?.error || '')}</span></div>`; return; }
  const paint = (c, lp) => {
    v.innerHTML = `<section class="pt-card"><h2>Vorschau &amp; Freischaltung</h2>
      <p class="form-note">Gilt sofort für die ganze Website. Kundinnen und Kunden mit Zugang (Käufer-Pass, Investor Pro, Unternehmenskonto oder von Ihnen unter Nutzer → „Zugriff freischalten“) sehen immer alles.</p>
      <form id="gtF" class="fs-grid">
        ${AREAS.map(([k, t, d]) => `<fieldset class="fs-row"><legend><strong>${t}</strong></legend><p class="form-note">${d}</p>
          <div class="pc-chips" role="radiogroup" aria-label="${t}">${['vorschau', 'offen'].map((m) => `<label class="fs-opt"><input type="radio" name="${k}" value="${m}"${c[k] === m ? ' checked' : ''}> ${m === 'vorschau' ? 'Nur Vorschau ohne Zugang' : 'Für alle offen'}</label>`).join('')}</div></fieldset>`).join('')}
        <fieldset class="fs-row"><legend><strong>Leseproben in der Wissenszentrale</strong></legend>
          <label>Anzahl frei lesbarer Antworten (0–63)<input type="number" name="leseproben" min="0" max="63" value="${c.leseproben}"></label>
          <p class="form-note">Werden gleichmäßig über die vier Phasen verteilt. Aktuell: ${lp.map((q) => esc(q)).join(' · ') || 'keine'}.</p></fieldset>
        <fieldset class="fs-row"><legend><strong>Muster-PDFs ohne Zugang</strong></legend>
          <label>Anteil der Seiten in Prozent (5–100)<input type="number" name="pdfProzent" min="5" max="100" value="${c.pdfProzent}"></label>
          <p class="form-note">Danach folgt eine Hinweisseite „Ende der Vorschau“. 100 % = ganzes PDF.</p></fieldset>
        <div class="pt-row"><button class="btn btn-dark" type="submit">Speichern</button></div>
      </form></section>`;
    v.querySelector('#gtF').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const body = { wissen: f.get('wissen'), rechner: f.get('rechner'), beispiele: f.get('beispiele'), leseproben: Number(f.get('leseproben')), pdfProzent: Number(f.get('pdfProzent')) };
      const s = await api(L, { method: 'POST', body: JSON.stringify(body) });
      if (!s.ok) { msg(s.data?.error || 'Speichern fehlgeschlagen.', true); return; }
      msg('Gespeichert – gilt innerhalb einer Minute auf der Website.');
      paint(s.data.config, s.data.leseproben || []);
    };
  };
  paint(r.data.config, r.data.leseproben || []);
}
