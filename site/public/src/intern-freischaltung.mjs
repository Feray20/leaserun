// Web-Admin → B2C → Paywall & previews: controls what visitors without access see (preview) and what is open to all.
// One setting for the whole website; customers with access always see everything.
import { api, esc } from './sess.mjs?v=892f3666';

const L = '/api/admin/freischaltung';
const AREAS = [
  ['wissen', 'Learning center', 'Preview: questions visible, answers only as a sample (first sentence). Open: all answers for everyone.'],
  ['rechner', 'Calculators', 'Preview: sample case with example values only, inputs/export locked. Open: anyone can run their own numbers.'],
  ['beispiele', 'Examples & sample PDFs', 'Preview: key metrics, first section and part of the PDF pages. Open: everything in full.'],
];

export async function freischaltung(v, { msg }) {
  const r = await api(L);
  if (!r.ok) { v.innerHTML = `<div class="wa-state err" role="alert"><strong>Settings couldn't be loaded.</strong><span>${esc(r.data?.error || '')}</span></div>`; return; }
  const paint = (c, lp) => {
    v.innerHTML = `<section class="pt-card"><h2>Previews &amp; paywall</h2>
      <p class="form-note">Applies to the whole website right away. Customers with access (Buyer Pass, Investor Pro, business account, or granted by you under Users → "Grant access") always see everything. The paywall is enforced on the server.</p>
      <form id="gtF" class="fs-grid">
        ${AREAS.map(([k, t, d]) => `<fieldset class="fs-row"><legend><strong>${t}</strong></legend><p class="form-note">${d}</p>
          <div class="pc-chips" role="radiogroup" aria-label="${t}">${['vorschau', 'offen'].map((m) => `<label class="fs-opt"><input type="radio" name="${k}" value="${m}"${c[k] === m ? ' checked' : ''}> ${m === 'vorschau' ? 'Preview only without access' : 'Open to everyone'}</label>`).join('')}</div></fieldset>`).join('')}
        <fieldset class="fs-row"><legend><strong>Free samples in the learning center</strong></legend>
          <label>Number of freely readable answers (0–63)<input type="number" name="leseproben" min="0" max="63" value="${c.leseproben}"></label>
          <p class="form-note">Spread evenly across the four phases. Currently: ${lp.map((q) => esc(q)).join(' · ') || 'none'}.</p></fieldset>
        <fieldset class="fs-row"><legend><strong>Sample PDFs without access</strong></legend>
          <label>Share of pages in percent (5–100)<input type="number" name="pdfProzent" min="5" max="100" value="${c.pdfProzent}"></label>
          <p class="form-note">Followed by an "End of preview" page. 100% = full PDF.</p></fieldset>
        <div class="pt-row"><button class="btn btn-dark" type="submit">Save</button></div>
      </form></section>`;
    v.querySelector('#gtF').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const body = { wissen: f.get('wissen'), rechner: f.get('rechner'), beispiele: f.get('beispiele'), leseproben: Number(f.get('leseproben')), pdfProzent: Number(f.get('pdfProzent')) };
      const s = await api(L, { method: 'POST', body: JSON.stringify(body) });
      if (!s.ok) { msg(s.data?.error || 'Saving failed.', true); return; }
      msg('Saved – applies on the website within a minute.');
      paint(s.data.config, s.data.leseproben || []);
    };
  };
  paint(r.data.config, r.data.leseproben || []);
}
