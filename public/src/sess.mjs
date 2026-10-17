// Gemeinsame Sitzungs-Helfer für Portal und internen Bereich (Supabase-Sitzung aus localStorage).
// Getrennte Bereiche: Website-Konto, Web-Admin und B2B-Portal haben je eine eigene Sitzung und eigene Anmeldung.
export const AREA = location.pathname.startsWith('/intern') ? 'admin' : location.pathname.startsWith('/b2b-portal') ? 'b2b' : 'app';
const SESSION = AREA === 'app' ? 'immoadv-auth-session-v1' : `immoadv-${AREA}-session-v1`;
const ACT = AREA === 'app' ? 'ia-last-active' : `ia-last-active-${AREA}`;
const REM = AREA === 'app' ? 'ia-remember' : `ia-remember-${AREA}`;
let cfg = null;

export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const session = () => { try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { return null; } };
export const setSession = (s) => { try { if (s) { localStorage.setItem(SESSION, JSON.stringify(s)); localStorage.setItem(ACT, String(Date.now())); } else localStorage.removeItem(SESSION); } catch { /* ignore */ } };
// Abmelden (widerruft das Token, meldet alle Tabs ab); Fallback ohne Sitzungsschutz-Skript.
export const logout = () => { if (window.iaAuth) window.iaAuth.logout(); else { setSession(null); location.href = '/'; } };
export const token = () => session()?.access_token || '';

export async function config() {
  if (cfg) return cfg;
  const r = await fetch('/api/supabase-config');
  if (!r.ok) throw Error('Anmeldung ist nicht konfiguriert.');
  cfg = await r.json();
  return cfg;
}

export async function supa(path, opts = {}) {
  const c = await config();
  return fetch(c.url + path, { ...opts, headers: { apikey: c.anonKey || c.key || c.publishableKey, 'content-type': 'application/json', ...(opts.headers || {}) } });
}

// Abgelaufene Sitzung einmal mit dem Refresh-Token erneuern.
export async function refresh() {
  const s = session();
  if (!s?.refresh_token) return false;
  const r = await supa('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) });
  if (!r.ok) return false;
  setSession(await r.json());
  return true;
}

// Aufruf eigener Schnittstellen mit Anmeldung; liefert { ok, status, data, res }.
export async function api(path, opts = {}, retry = true) {
  const headers = { Authorization: 'Bearer ' + token(), ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) };
  const res = await fetch(path, { cache: 'no-store', ...opts, headers });
  if (res.status === 401 && retry && (await refresh())) return api(path, opts, false);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : null;
  return { ok: res.ok, status: res.status, data, res };
}

// Datei-Antwort herunterladen.
export async function download(path, opts = {}, fallbackName = 'download') {
  const r = await api(path, opts);
  if (!r.ok) throw Error(r.data?.error || 'Download fehlgeschlagen.');
  const blob = await r.res.blob();
  const cd = r.res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(cd);
  const name = m ? decodeURIComponent(m[1] || m[2]) : fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return r.res;
}

export const eur = (c, d = 2) => (c == null ? '–' : (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }));
export const dt = (s) => (s ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(s)) : '–');
export const dtt = (s) => (s ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s)) : '–');

// ---------- Eigene Anmeldemaske je Bereich (Web-Admin, B2B-Portal) ----------
const ERR = {
  invalid_credentials: 'Falsche Anmeldedaten: E-Mail oder Passwort stimmt nicht. Bitte prüfen (auch Groß- und Kleinschreibung).',
  email_not_confirmed: 'Diese E-Mail-Adresse ist noch nicht bestätigt. Bitte den Link in der Bestätigungs-E-Mail öffnen.',
  over_request_rate_limit: 'Zu viele Versuche. Bitte einige Minuten warten.',
};
function authError(d) {
  const c = (d && (d.error_code || d.code)) || '';
  if (ERR[c]) return ERR[c];
  const t = String((d && (d.error_description || d.msg || d.message)) || '');
  if (/invalid login credentials/i.test(t)) return ERR.invalid_credentials;
  if (/email not confirmed/i.test(t)) return ERR.email_not_confirmed;
  if (/rate|too many/i.test(t)) return ERR.over_request_rate_limit;
  return 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.';
}

// opts: { title, lead, note, check(session) -> Promise<string|null> (Fehlertext, wenn kein Zugang), signup: { next } }
export function loginForm(root, opts) {
  const signup = opts.signup;
  const draw = (mode = 'login') => {
    root.innerHTML = `<div class="area-login"><a class="pt-brand dark" href="/"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a>
      <h1>${esc(opts.title)}</h1><p class="form-note">${esc(mode === 'signup' ? 'Neues Konto für Ihr Unternehmen anlegen. Danach registrieren Sie hier Ihr Unternehmen.' : opts.lead)}</p>
      ${signup ? `<div class="seg area-seg" role="tablist"><button type="button" role="tab" data-mode="login" aria-selected="${mode === 'login'}">Anmelden</button><button type="button" role="tab" data-mode="signup" aria-selected="${mode === 'signup'}">Konto anlegen</button></div>` : ''}
      <form id="areaForm" method="post" action="#" autocomplete="on" novalidate>
        <label>E-Mail<input id="aEmail" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label>Passwort<span class="pw-wrap"><input id="aPw" name="password" type="password" minlength="8" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required><button type="button" class="pw-eye" id="aEye">Anzeigen</button></span></label>
        ${mode === 'login' ? `<label class="chk remember"><input id="aRem" type="checkbox"${localStorage.getItem(REM) === '1' ? ' checked' : ''}> Angemeldet bleiben <small>(nur auf eigenem Gerät)</small></label>` : ''}
        <div class="auth-message" id="aMsg" role="alert" hidden></div>
        <button class="btn btn-dark btn-lg" type="submit">${mode === 'signup' ? 'Konto anlegen' : 'Anmelden'}</button>
      </form>
      <p class="form-note area-links">${mode === 'login' ? '<a class="ck-link" href="/auth/forgot">Passwort vergessen?</a> · ' : ''}${opts.noteHtml || esc(opts.note || '')}</p></div>`;
    const f = root.querySelector('#areaForm'), em = root.querySelector('#aEmail'), pw = root.querySelector('#aPw'), m = root.querySelector('#aMsg');
    const show = (t, kind = 'error') => { m.hidden = false; m.className = 'auth-message ' + kind; m.textContent = t; if (kind === 'error') { f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); [em, pw].forEach((x) => x.classList.add('bad')); } };
    [em, pw].forEach((x) => x.addEventListener('input', () => { x.classList.remove('bad'); m.hidden = true; }));
    root.querySelector('#aEye').onclick = (e) => { const sh = pw.type === 'password'; pw.type = sh ? 'text' : 'password'; e.target.textContent = sh ? 'Verbergen' : 'Anzeigen'; };
    root.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => draw(b.dataset.mode));
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.dataset.busy) return;
      const email = em.value.trim().toLowerCase(), password = pw.value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { show('Bitte eine gültige E-Mail-Adresse eingeben.'); em.focus(); return; }
      if (password.length < 8) { show(mode === 'signup' ? 'Bitte ein Passwort mit mindestens 8 Zeichen wählen.' : 'Falsche Anmeldedaten: Das Passwort ist zu kurz.'); pw.focus(); return; }
      f.dataset.busy = '1'; const btn = f.querySelector('button[type=submit]'); btn.disabled = true; show('Bitte warten …', 'info');
      try {
        if (mode === 'signup') {
          const r = await fetch('/api/auth/mail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'signup', email, password, next: signup.next }) });
          if (r.status === 503) {
            const c = await config();
            const s2 = await supa('/auth/v1/signup?redirect_to=' + encodeURIComponent(location.origin + signup.next), { method: 'POST', body: JSON.stringify({ email, password }) });
            const d2 = await s2.json().catch(() => ({}));
            if (!s2.ok) throw Error(authError(d2));
            void c;
          } else if (!r.ok) { const d = await r.json().catch(() => ({})); throw Error(d.error || 'Registrierung fehlgeschlagen.'); }
          show('Fast geschafft: Wir haben Ihnen eine E-Mail geschickt. Bitte bestätigen Sie darin Ihre E-Mail-Adresse und melden Sie sich danach hier an.', 'success');
          return;
        }
        const r = await supa('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw Error(authError(d));
        if (AREA === 'b2b') try { window.iaTrack?.('b2b_login'); } catch { /* ignore */ }
        if (opts.check) { const why = await opts.check(d); if (why) { show(why); return; } }
        try { localStorage.setItem(REM, root.querySelector('#aRem')?.checked ? '1' : '0'); } catch { /* ignore */ }
        if ((d.user?.factors || []).some((x) => x.status === 'verified')) {
          const mf = await import('./mfa.mjs');
          root.innerHTML = '<div class="area-login" id="areaMfa"></div>';
          await mf.challengeUI(root.querySelector('#areaMfa'), d, () => location.reload());
          return;
        }
        setSession(d);
        location.reload();
      } catch (err) { show(err.message || 'Anmeldung fehlgeschlagen.'); }
      finally { delete f.dataset.busy; btn.disabled = false; }
    };
    em.focus();
  };
  draw();
}
