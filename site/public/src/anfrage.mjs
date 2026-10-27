// Antwortseite für Knöpfe in persönlichen Akquise-Mails (/request?art=…&w=…&t=…):
// Wunsch ankreuzen und absenden – landet als E-Mail im Postfach. Daneben: Termin über Microsoft Teams und „Kein Interesse“.
// Das Token t stammt aus der Mail (wie der Abmeldelink) und ordnet die Antwort zu; es enthält keine E-Mail-Adresse.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICON = {
  ok: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2Zm12 8H5v9h14v-9Z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M6 2h8l6 6v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm7 1.5V9h5.5L13 3.5ZM8 13h8v1.6H8V13Zm0 4h8v1.6H8V17Z"/></svg>',
};

// Inhalte je Art. du = Ansprache mit „ihr/du“ (Creator), sonst „Sie“.
const ART = {
  unterlagen: {
    h: 'Unterlagen anfordern', sub: 'Kreuzen Sie an, was Sie brauchen – wir schicken es Ihnen innerhalb eines Werktags per E-Mail.',
    org: 'Redaktion / Unternehmen', btn: 'Unterlagen anfordern',
    opts: [['keyfacts', 'Kurzporträt & Keyfacts zu LeaseRun'], ['zahlen', 'Zahlen & Rechenbeispiel zum Thema'], ['muster', 'Musterunterlagen (Kreditmappe, Objekt-Analyse)'], ['beitrag', 'Themenvorschlag, Gliederung oder Gastbeitrag'], ['interview', 'Interview oder Gesprächspartner']],
  },
  kooperation: {
    h: 'Kooperation mit LeaseRun', sub: 'Am schnellsten klären wir das in einem kurzen Teams-Gespräch. Oder sagen Sie uns hier, wie es weitergehen soll.',
    org: 'Unternehmen', btn: 'Antwort senden',
    opts: [['unterlagen', 'Bitte Unterlagen und Konditionen schicken'], ['testzugang', 'Kostenlosen Testzugang einrichten'], ['rueckruf', 'Bitte um Rückruf']],
  },
  creator: {
    du: true, h: 'Euer Creator-Zugang', sub: 'Kurz eintragen – wir schicken euch euren persönlichen Zugang mit Investor Pro zum Testen und euren eigenen Rabattcode.',
    org: 'Kanal / Community', btn: 'Zugang anfordern',
    opts: [['zugang', 'Persönlicher Zugang (Investor Pro testen)'], ['code', 'Eigener Rabattcode für die Community'], ['provision', 'Infos zu Provision & Abrechnung']],
    more: ['/creators', 'Mehr zum Creator-Programm'],
  },
  zugang: {
    h: 'Testzugang anfordern', sub: 'Wir richten Ihnen einen kostenlosen Testzugang ein und schicken die Zugangsdaten per E-Mail.',
    org: 'Unternehmen / Academy', btn: 'Testzugang anfordern',
    opts: [['zugang', 'Testzugang Investor Pro'], ['demo', 'Kurze Demo im Teams-Gespräch'], ['community', 'Angebot für unsere Mitglieder / Community']],
  },
};

async function post(body) {
  try {
    const r = await fetch('/api/anfrage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  } catch { return { ok: false, data: { error: 'Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung.' } }; }
}

function start() {
  const root = document.getElementById('anfrageApp');
  if (!root) return;
  const q = new URLSearchParams(location.search);
  const art = ART[q.get('art')] ? q.get('art') : 'unterlagen';
  const a = ART[art], du = !!a.du;
  const pre = new Set((q.get('w') || '').split(',').filter(Boolean));
  if (!pre.size) pre.add(a.opts[0][0]);
  const t = /^[A-Za-z0-9_-]{16,64}$/.test(q.get('t') || '') ? q.get('t') : '';
  const termin = `/book?thema=${encodeURIComponent('Presse & Kooperation')}${t ? `&t=${t}` : ''}`;
  const t0 = Date.now();
  document.title = `${a.h} | LeaseRun`;
  const hero = document.querySelector('.route-hero');
  if (hero) { const h = hero.querySelector('h1'), p = hero.querySelector('p'); if (h) h.textContent = a.h; if (p) p.textContent = du ? 'Antwort auf Ferays E-Mail – dauert eine Minute.' : 'Antwort auf unsere E-Mail – dauert eine Minute.'; }

  root.innerHTML = `<div class="tm-grid">
    <form class="tm-card tm-form" id="afForm" novalidate>
      <div class="tm-step"><span>1</span>${du ? 'Was braucht ihr?' : 'Was benötigen Sie?'}</div>
      <p class="tm-intro">${esc(a.sub)}</p>
      <fieldset class="af-opts"><legend class="af-sr">Auswahl</legend>${a.opts.map(([k, l]) => `<label class="af-opt"><input type="checkbox" name="opt" value="${k}"${pre.has(k) ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</fieldset>
      <div class="tm-step af-step2"><span>2</span>${du ? 'Eure Angaben' : 'Ihre Angaben'}</div>
      <div class="tm-two"><label>Name *<input name="name" autocomplete="name" required maxlength="120"></label><label>E-Mail *<input name="email" type="email" autocomplete="email" required maxlength="200"></label></div>
      <label>${esc(a.org)}<input name="org" autocomplete="organization" maxlength="160"></label>
      <label>${du ? 'Noch etwas, das wir wissen sollten?' : 'Nachricht'} (optional)<textarea name="message" rows="3" maxlength="2000"></textarea></label>
      <label class="tm-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <label class="tm-consent"><input type="checkbox" name="consent" required><span>Ich bin einverstanden, dass LeaseRun meine Angaben zur Bearbeitung der Anfrage verarbeitet (<a href="/privacy" target="_blank">Datenschutz</a>).</span></label>
      <button class="btn btn-dark tm-submit" type="submit">${esc(a.btn)}</button><p class="tm-msg" role="status"></p>
    </form>
    <aside class="af-side">
      <a class="tm-card af-link" href="${esc(termin)}"><span class="af-ic">${ICON.cal}</span><span><strong>Lieber direkt sprechen?</strong><span class="af-d">Freien Termin wählen – 30 Minuten per Microsoft Teams, kostenlos.</span></span></a>
      ${pre.has('muster') || art === 'unterlagen' ? `<a class="tm-card af-link" href="/sample-loan-package"><span class="af-ic">${ICON.doc}</span><span><strong>Beispiele sofort ansehen</strong><span class="af-d">Muster-Kreditmappe und Objekt-Analyse als PDF.</span></span></a>` : ''}
      ${a.more ? `<a class="tm-card af-link" href="${a.more[0]}"><span class="af-ic">${ICON.doc}</span><span><strong>${esc(a.more[1])}</strong><span class="af-d">Eigener Link, Material und monatliche Abrechnung.</span></span></a>` : ''}
      ${t ? `<p class="af-no">Kein Interesse? <a href="/api/abmelden?t=${t}">${du ? 'Dann meldet euch hier ab' : 'Hier abmelden'}</a> – wir melden uns dann nicht wieder.</p>` : ''}
    </aside></div>`;

  const form = $('#afForm', root), submit = $('.tm-submit', form), msg = $('.tm-msg', form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form), opts = fd.getAll('opt');
    if (!opts.length) { msg.textContent = du ? 'Bitte mindestens eine Sache ankreuzen.' : 'Bitte kreuzen Sie mindestens eine Sache an.'; return; }
    if (!form.checkValidity()) { form.reportValidity(); return; }
    submit.disabled = true; submit.classList.add('busy'); submit.textContent = 'Wird gesendet …'; msg.textContent = '';
    const rr = await post({ art, opts, name: fd.get('name'), email: fd.get('email'), org: fd.get('org') || '', message: fd.get('message') || '', t, website: fd.get('website') || '', ts: t0, privacy: true });
    if (rr.ok) {
      const first = String(fd.get('name')).split(' ')[0];
      root.innerHTML = `<div class="tm-card tm-center tm-done"><span class="tm-ok">${ICON.ok}</span><h2>Danke, ${esc(first)}!</h2>
        <p>${du ? 'Eure Anfrage ist da. Wir melden uns innerhalb eines Werktags an' : 'Ihre Anfrage ist bei uns. Wir melden uns innerhalb eines Werktags an'} <strong>${esc(fd.get('email'))}</strong>.</p>
        <a class="btn btn-ghost" href="${esc(termin)}">Gleich einen Termin wählen</a></div>`;
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    submit.disabled = false; submit.classList.remove('busy'); submit.textContent = a.btn;
    msg.textContent = rr.data.error || 'Senden fehlgeschlagen. Bitte erneut versuchen.';
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
