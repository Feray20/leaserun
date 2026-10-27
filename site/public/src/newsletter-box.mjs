// Newsletter-Anmeldebox „Kauf-Checkliste als PDF + monatliches Zins-Update“ auf Startseite, Wissen/Ratgeber,
// /checklist, /deadlines, /learning-path und /mustermappe. Wird von menu.js nachgeladen.
// Double-Opt-in über /api/newsletter (box: true): eingetragen erst nach Klick auf den Bestätigungslink,
// die Checkliste kommt danach per E-Mail. Pflicht-Häkchen, nicht vorausgewählt. Kein Cookie, keine lokale Speicherung.
// Zählung: Ereignis „newsletter_signup“ im Besucher-Tracking (Seite = path).
const PAGES = /^\/($|wissen(\/|$)|ratgeber(\/|$)|checkliste$|fristen$|lernpfad$|mustermappe$)/;
const PDF = '/api/newsletter/checkliste';
const here = () => location.pathname.replace(/\/+$/, '') || '/';

const CSS = `.nlb-wrap{padding:28px 0}.nlb{max-width:720px;margin:0 auto;padding:22px 20px;border:1px solid var(--ia-line,#e2e8f0);border-radius:var(--ia-radius,18px);background:var(--ia-soft,#f8fafc)}
.nlb h2{margin:0 0 6px;font-size:1.25rem;line-height:1.3}.nlb>p{margin:0 0 14px;color:var(--ia-muted,#64748b)}
.nlb-row{display:flex;flex-direction:column;gap:10px}.nlb-row input[type=email]{width:100%;min-height:48px;padding:10px 14px;font-size:16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:inherit;box-sizing:border-box}
.nlb-row .btn{width:100%;min-height:48px;font-size:16px;justify-content:center}
.nlb-ok{display:flex;gap:10px;align-items:flex-start;margin:14px 0 0;font-size:.95rem;line-height:1.45;cursor:pointer}.nlb-ok input{flex:none;width:22px;height:22px;margin:1px 0 0}
.nlb-msg{margin:10px 0 0;font-size:.95rem;min-height:1em}.nlb-msg.err{color:#b91c1c}.nlb-hp,.nlb-sr{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.nlb-in{padding:8px 0 24px}
.nlb input:focus-visible,.nlb .btn:focus-visible{outline:3px solid var(--ia-link,#0369a1);outline-offset:2px}
@media (min-width:640px){.nlb{padding:26px 28px}.nlb-row{flex-direction:row}.nlb-row input[type=email]{flex:1}.nlb-row .btn{width:auto;flex:none}}
.nlb-banner{position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:60;max-width:560px;margin:0 auto;padding:14px 16px;border-radius:14px;background:#0F2C59;color:#fff;box-shadow:0 12px 40px rgba(15,23,42,.25);font-size:16px}
.nlb-banner a{color:#fff;font-weight:700}.nlb-banner button{float:right;margin:-4px -6px 0 8px;min-width:44px;min-height:44px;border:0;background:none;color:#fff;font-size:22px;cursor:pointer}`;

function style() {
  if (document.getElementById('nlb-css')) return;
  const s = document.createElement('style'); s.id = 'nlb-css'; s.textContent = CSS; document.head.appendChild(s);
}

const HTML = (n) => `<div class="container"><form class="nlb" novalidate aria-labelledby="nlbH${n}">
<h2 id="nlbH${n}">Kauf-Checkliste als PDF + monatliches Zins-Update</h2>
<p>Alle Unterlagen, die Banken typischerweise sehen wollen – zum Abhaken. Dazu einmal im Monat die Zinsentwicklung kurz erklärt.</p>
<div class="nlb-row"><label class="nlb-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
<label for="nlbE${n}" class="nlb-sr">E-Mail-Adresse</label><input id="nlbE${n}" name="email" type="email" required maxlength="200" autocomplete="email" inputmode="email" placeholder="Ihre E-Mail-Adresse">
<button class="btn btn-dark" type="submit">Checkliste anfordern</button></div>
<label class="nlb-ok"><input type="checkbox" name="consent" required> <span>Ich möchte den LeaseRun-Newsletter erhalten. Abmeldung jederzeit über den Link in jeder E-Mail. Mehr in den <a href="/privacy">Datenschutzhinweisen</a>.</span></label>
<p class="nlb-msg" role="status" aria-live="polite"></p></form></div>`;

function bind(form) {
  if (form.dataset.nlb) return;
  form.dataset.nlb = '1';
  const ts = Date.now();
  const msg = form.querySelector('.nlb-msg');
  const say = (t, err) => { msg.textContent = t; msg.classList.toggle('err', Boolean(err)); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { say('Bitte eine gültige E-Mail-Adresse eingeben.', true); form.email.focus(); return; }
    // Ohne Häkchen keine Eintragung (der Server prüft das zusätzlich).
    if (!form.consent.checked) { say('Bitte das Häkchen setzen, damit wir Ihnen die Checkliste und den Newsletter schicken dürfen.', true); form.consent.focus(); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; say('Wird gesendet …');
    try {
      const r = await fetch('/api/newsletter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, segment: 'b2c', box: true, source: here().slice(0, 56), consent: true, website: form.website.value, ts }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { say(d.error || 'Das hat nicht geklappt. Bitte später erneut versuchen.', true); btn.disabled = false; return; }
      if (d.already) { msg.innerHTML = `Sie sind bereits angemeldet. Hier ist Ihre <a href="${PDF}" target="_blank" rel="noopener">Kauf-Checkliste als PDF</a>.`; msg.classList.remove('err'); return; }
      say('Fast geschafft: Bitte bestätigen Sie die Anmeldung über den Link in der E-Mail, die wir Ihnen gerade geschickt haben (auch im Spam-Ordner nachsehen). Danach erhalten Sie die Checkliste.');
      form.email.value = ''; form.consent.checked = false;
      try { window.iaTrack?.('newsletter_signup'); } catch { /* Messung darf nie stören */ }
    } catch { say('Keine Verbindung. Bitte später erneut versuchen.', true); btn.disabled = false; }
  });
}

// Einbaustelle je Seite: Startseite unter dem ersten Abschnitt, Beispiele unter den Muster-PDFs, sonst am Ende des Inhalts.
function place(main) {
  const sec = document.createElement('section');
  sec.className = 'nlb-wrap'; sec.setAttribute('data-noklapp', ''); sec.innerHTML = HTML(1);
  // Immer ganz unten, direkt über der Fußzeile (Wunsch Feray, 27.10.2026) – auf allen Seiten, auch Startseite.
  main.appendChild(sec);
  return sec.querySelector('form');
}

// Rückmeldung nach Klick auf den Bestätigungs- bzw. Abmeldelink (?newsletter=…).
function banner() {
  const k = new URLSearchParams(location.search).get('newsletter');
  const t = { bestaetigt: `Danke – Ihre Anmeldung ist bestätigt. Hier ist Ihre <a href="${PDF}" target="_blank" rel="noopener">Kauf-Checkliste als PDF</a> (der Link kommt auch per E-Mail).`, abgemeldet: 'Sie sind abgemeldet und erhalten keine Newsletter mehr.', ungueltig: 'Dieser Link ist ungültig oder abgelaufen.' }[k];
  if (!t || document.querySelector('.nlb-banner')) return;
  const m = document.createElement('div');
  m.className = 'nlb-banner'; m.setAttribute('role', 'status');
  m.innerHTML = `<button type="button" aria-label="Hinweis schließen">×</button>${t}`;
  m.querySelector('button').onclick = () => m.remove();
  document.body.appendChild(m);
  if (k !== 'bestaetigt') setTimeout(() => m.remove(), 8000);
}

function mount() {
  if (!PAGES.test(here()) || document.body.classList.contains('is-app')) return;
  const main = document.querySelector('main#inhalt') || document.querySelector('main');
  if (!main) return;
  style();
  banner();
  // Vorgerendert vorhanden (Prerender übernimmt den Seiteninhalt) → nur verbinden, nicht doppelt einfügen.
  bind(main.querySelector('form.nlb') || place(main));
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount); else mount();
