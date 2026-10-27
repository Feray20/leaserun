// Headquarters: „Prüfen & erledigen“ – die einzige Prüfstelle im Web-Admin (Sicherheit, E-Mail, Technik, Betrieb).
// Prüft beim Öffnen automatisch. Automatisch behebbare Befunde: ein Knopf je Befund und „Alles erledigen“.
// Alles andere mit kurzer Anleitung. Details und Protokolle bleiben darunter eingeklappt erreichbar.
import { api, esc } from './sess.mjs?v=892f3666';

const SEV = { critical: ['bad', 'Kritisch'], warning: ['warn', 'Warnung'], info: ['info', 'Hinweis'] };
const stamp = (t) => new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function checkPanel(host, { goTab, msg }) {
  host.innerHTML = `<section class="ck-panel" aria-labelledby="ckT"><div class="ck-head"><div><h2 id="ckT">Prüfen &amp; erledigen</h2><p class="ck-sub" id="ckSub">Wird geprüft …</p></div>
    <div class="ck-btns"><button type="button" class="btn btn-outline" id="ckRun">Jetzt prüfen</button><button type="button" class="btn btn-dark" id="ckAll" hidden>Alle bestätigen</button></div></div>
    <div id="ckRes" aria-live="polite"><div class="ck-sk"></div></div><div id="ckDone" aria-live="polite"></div></section>`;
  const $ = (s) => host.querySelector(s);
  // Je Punkt nur: was ist los (ein Satz) + Bestätigen / Ablehnen. Was nur Feray außerhalb tun kann, steht als ein Satz da.
  const item = (x) => { const [c, l] = SEV[x.sev] || SEV.info; return `<li class="ck-it s-${c}">
      <div class="ck-top"><span class="hq-st ${c}">${l}</span><span class="ck-area">${esc(x.area)}</span></div>
      <strong>${esc(x.title)}</strong>
      ${!x.auto && x.how ? `<p class="ck-how">${esc(x.how)}</p>` : ''}
      <div class="ck-act">${x.auto ? `<button type="button" class="btn btn-dark btn-sm" data-fix="${esc(x.id)}">Bestätigen</button>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-dis="${esc(x.id)}">${x.auto ? 'Ablehnen' : 'Ausblenden'}</button></div></li>`; };
  const paint = (d) => {
    const f = d.findings || [], auto = f.filter((x) => x.auto);
    // Wichtiges offen, reine Hinweise eingeklappt – die Seite bleibt kurz.
    const main = f.filter((x) => x.sev !== 'info' || x.auto);
    $('#ckSub').textContent = `Stand: heute, ${stamp(d.checkedAt || Date.now())} · ${main.length ? `${main.length} ${main.length === 1 ? 'Punkt wartet' : 'Punkte warten'} auf dich` : 'nichts zu entscheiden'}`;
    const all = $('#ckAll'); all.hidden = auto.length < 2; all.textContent = `Alle bestätigen (${auto.length})`;
    $('#ckRes').innerHTML = main.length ? `<ul class="ck-list">${main.map(item).join('')}</ul>` : '<p class="ck-ok">✓ Alles in Ordnung – nichts zu entscheiden.</p>';
    $('#ckRes').querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => fix({ ids: [b.dataset.fix] }, b));
    $('#ckRes').querySelectorAll('[data-dis]').forEach((b) => b.onclick = () => fix({ dismiss: b.dataset.dis }, b));
  };
  const run = async (fresh = false) => {
    $('#ckRun').disabled = true; $('#ckRun').textContent = 'Prüft …'; $('#ckRes').innerHTML = '<div class="ck-sk"></div>';
    const r = await api('/api/admin/fix' + (fresh ? '?fresh=1' : ''));
    $('#ckRun').disabled = false; $('#ckRun').textContent = 'Jetzt prüfen';
    if (!host.isConnected) return;
    if (!r.ok) { $('#ckRes').innerHTML = `<p class="form-note">${esc(r.data?.error || 'Prüfung nicht möglich.')}</p>`; $('#ckSub').textContent = 'Prüfung fehlgeschlagen – bitte „Jetzt prüfen“ erneut tippen.'; return; }
    paint(r.data);
  };
  const fix = async (body, btn) => {
    const buttons = host.querySelectorAll('button'); buttons.forEach((b) => { b.disabled = true; });
    if (btn) btn.textContent = body.dismiss ? 'Wird ausgeblendet …' : 'Wird erledigt …';
    const r = await api('/api/admin/fix', { method: 'POST', body: JSON.stringify(body) });
    buttons.forEach((b) => { b.disabled = false; });
    if (!r.ok) { msg(r.data?.error || 'Konnte nicht erledigt werden.', true); run(); return; }
    const res = r.data.results || [];
    paint(r.data);
    const bad = res.filter((x) => !x.ok);
    msg(body.dismiss ? 'Ausgeblendet (7 Tage).' : bad.length ? bad.map((x) => x.text).join(' · ') : 'Erledigt.', bad.length > 0);
    host.dispatchEvent(new CustomEvent('ck-fixed', { bubbles: true }));
  };
  $('#ckRun').onclick = () => run(true);
  $('#ckAll').onclick = () => fix({ all: true }, $('#ckAll'));
  run();
  return { run };
}
