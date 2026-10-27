// Express-Login: erkennt nach Eingabe der E-Mail, ob schon ein Konto besteht (→ anmelden) oder nicht (→ registrieren)
// und ob das Konto mit Google/Microsoft angelegt wurde (dann gibt es kein Passwort). Gilt für Privatbereich und Unternehmensportal.
const ok = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e);
const cache = new Map();

export async function emailStatus(email) {
  email = String(email || '').trim().toLowerCase();
  if (!ok(email)) return null;
  if (cache.has(email)) return cache.get(email);
  try {
    const r = await fetch('/api/auth/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), cache: 'no-store' });
    const d = r.ok ? await r.json() : null;
    const v = d && d.known ? d : null;
    cache.set(email, v);
    return v;
  } catch { return null; }
}

const SSO = { google: 'Google', apple: 'Apple', azure: 'Microsoft' };
// Dieses Gerät merkt sich, womit zuletzt angemeldet wurde (E-Mail + Weg) – beim nächsten Mal steht das schon bereit.
const LAST = 'lr-last-login';
const lastLogin = () => { try { const x = JSON.parse(localStorage.getItem(LAST) || 'null'); return x && ok(x.email) ? x : null; } catch { return null; } };
const remember = (method, email) => { try { if (ok(email)) localStorage.setItem(LAST, JSON.stringify({ method, email: email.trim().toLowerCase(), at: Date.now() })); } catch { /* privat */ } };

// mode: 'login' | 'register'. actions: { register(email), login(email), sso(provider) } – je nach Seite.
export function attach(input, { mode, actions = {} }) {
  if (!input || input.dataset.ed) return;
  input.dataset.ed = '1';
  const hint = document.createElement('p');
  hint.className = 'ed-hint'; hint.setAttribute('role', 'status'); hint.setAttribute('aria-live', 'polite'); hint.hidden = true;
  (input.closest('label') || input).insertAdjacentElement('afterend', hint);
  let t = 0, last = '';
  const put = (html, kind = 'info') => { hint.className = 'ed-hint ' + kind; hint.innerHTML = html; hint.hidden = !html; };
  const run = async () => {
    const em = input.value.trim().toLowerCase();
    if (em === last) return; last = em;
    if (!ok(em)) { put(''); return; }
    const s = await emailStatus(em);
    if (input.value.trim().toLowerCase() !== em) return;
    if (!s) { put(''); return; }
    const sso = (s.sso || []).filter((p) => SSO[p]);
    if (mode === 'login' && !s.exists) {
      put(`Zu dieser E-Mail gibt es noch kein Konto.${actions.register ? ' <button type="button" class="link-btn" data-ed="reg">Jetzt mit dieser E-Mail registrieren</button>' : ''}`, 'warn');
    } else if (mode === 'register' && s.exists) {
      put(`Mit dieser E-Mail sind Sie bereits registriert.${actions.login ? ' <button type="button" class="link-btn" data-ed="login">Stattdessen anmelden</button>' : ''}`, 'warn');
    } else if (mode === 'login' && s.exists && !s.password && sso.length) {
      put(`Dieses Konto nutzt die Anmeldung mit ${sso.map((p) => SSO[p]).join(' oder ')} – ein Passwort ist nicht hinterlegt.${actions.sso ? ` <button type="button" class="link-btn" data-ed="sso" data-p="${sso[0]}">Mit ${SSO[sso[0]]} anmelden</button>` : ''}`, 'info');
    } else if (mode === 'login' && s.exists && !s.confirmed) {
      put('Ihre E-Mail-Adresse ist noch nicht bestätigt. Bitte öffnen Sie den Link aus unserer E-Mail – oder fordern Sie unten einen Anmeldelink an.', 'info');
    } else if (mode === 'login' && s.exists) {
      put('Konto gefunden – bitte Passwort eingeben.', 'ok');
    } else put('');
  };
  hint.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]'); if (!b) return;
    const em = input.value.trim().toLowerCase();
    if (b.dataset.ed === 'reg') actions.register?.(em);
    else if (b.dataset.ed === 'login') actions.login?.(em);
    else if (b.dataset.ed === 'sso') actions.sso?.(b.dataset.p);
  });
  // Merken, womit sich jemand anmeldet (Passwort oder Apple/Google) – nur auf diesem Gerät.
  if (mode === 'login') {
    input.form?.addEventListener('submit', () => remember('password', input.value));
    document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-sso]'); if (b) remember(b.dataset.sso, input.value); }, true);
    const L = lastLogin();
    if (L && !input.value) {
      input.value = L.email;
      if (SSO[L.method]) { put(`Zuletzt auf diesem Gerät mit ${SSO[L.method]} angemeldet.${actions.sso ? ` <button type="button" class="link-btn" data-ed="sso" data-p="${L.method}">Weiter mit ${SSO[L.method]}</button>` : ''}`, 'ok'); last = L.email; }
      else setTimeout(() => input.form?.querySelector('input[type=password]')?.focus({ preventScroll: true }), 0);
    }
  }
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 650); });
  input.addEventListener('blur', run);
  input.addEventListener('change', run);
  if (input.value) run();
}
