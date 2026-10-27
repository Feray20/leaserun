// Verbesserungsvorschläge für Kunden (Privatbereich) und Unternehmen (Unternehmensportal).
// Vorschläge gehen an den Web-Admin des jeweiligen Bereichs; der Kunde sieht Status und Antwort.
import { api, dt, esc } from './sess.mjs?v=892f3666';

const TOPICS = { bedienung: 'Bedienung & Navigation', rechner: 'Rechner & Kennzahlen', kreditmappe: 'Kreditmappe & Dokumente', inhalte: 'Inhalte & Erklärungen', neue_funktion: 'Neue Funktion', fehler: 'Fehler gefunden', sonstiges: 'Sonstiges' };
const STATUS = { neu: 'Eingegangen', in_pruefung: 'In Prüfung', geplant: 'Geplant', umgesetzt: 'Umgesetzt', abgelehnt: 'Derzeit nicht geplant' };
const IMP = ['', 'Kleinigkeit', 'Wäre schön', 'Wichtig', 'Sehr wichtig', 'Unverzichtbar'];

export async function mountFeedback(box, { area }) {
  let imp = 3;
  box.innerHTML = `<p class="form-note">Was sollen wir verbessern? Ihr Vorschlag geht direkt an das LeaseRun-Team. Bitte keine persönlichen Finanzdaten eintragen.</p>
    <form class="fb-form" id="fbF" novalidate>
      <label>Thema<select name="topic" required>${Object.entries(TOPICS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="fb-wide">Ihr Vorschlag<textarea name="text" rows="4" minlength="10" maxlength="4000" required placeholder="Was genau soll anders oder besser werden – und warum?"></textarea></label>
      <div class="fb-wide"><span class="fb-l">Wie wichtig ist Ihnen das?</span><span class="fb-stars" role="radiogroup" aria-label="Wichtigkeit">${[1, 2, 3, 4, 5].map((k) => `<button type="button" role="radio" data-imp="${k}" aria-label="${k} von 5 – ${IMP[k]}" aria-checked="${k === imp}" class="${k <= imp ? 'on' : ''}">★</button>`).join('')}</span> <small class="fb-imp" id="fbImp">${IMP[imp]}</small></div>
      <div class="fb-wide fb-act"><button class="btn btn-dark" type="submit">Vorschlag senden</button><span class="form-note" id="fbMsg" role="status" aria-live="polite"></span></div>
    </form>
    <h4 class="fb-h">Ihre Vorschläge</h4><div id="fbMine" class="fb-mine"><p class="lr-ld" role="status">Wird geladen …</p></div>`;
  const f = box.querySelector('#fbF');
  const paintImp = () => { f.querySelectorAll('[data-imp]').forEach((b) => { const k = Number(b.dataset.imp); b.classList.toggle('on', k <= imp); b.setAttribute('aria-checked', String(k === imp)); }); box.querySelector('#fbImp').textContent = IMP[imp]; };
  f.querySelectorAll('[data-imp]').forEach((b) => b.onclick = () => { imp = Number(b.dataset.imp); paintImp(); });
  const mine = async () => {
    const r = await api(`/api/feedback?area=${area}`);
    const el = box.querySelector('#fbMine'); if (!el) return;
    const items = r.ok ? r.data.items || [] : [];
    el.innerHTML = items.length ? `<ul>${items.map((x) => `<li><div><strong>${esc(TOPICS[x.topic] || x.topic)}</strong><small>${dt(x.created_at)} · ${STATUS[x.status] || x.status}</small></div><p>${esc(x.text.length > 220 ? x.text.slice(0, 220) + ' …' : x.text)}</p>${x.answer ? `<p class="fb-ans"><b>Antwort des LeaseRun-Teams:</b> ${esc(x.answer)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Noch keine Vorschläge gesendet.</p>';
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const m = box.querySelector('#fbMsg'), btn = f.querySelector('[type=submit]');
    const text = f.text.value.trim();
    if (text.length < 10) { m.textContent = 'Bitte beschreiben Sie Ihren Vorschlag in mindestens 10 Zeichen.'; f.text.focus(); return; }
    btn.disabled = true; m.textContent = 'Wird gesendet …';
    const r = await api('/api/feedback', { method: 'POST', body: JSON.stringify({ area, topic: f.topic.value, text, importance: imp, page: location.pathname + location.hash }) });
    btn.disabled = false;
    if (!r.ok) { m.textContent = r.data?.error || 'Senden fehlgeschlagen.'; return; }
    f.reset(); imp = 3; paintImp(); m.textContent = 'Danke! Ihr Vorschlag ist angekommen.'; mine();
  };
  mine();
}
