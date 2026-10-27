// Shared session helpers for the portals and the internal area (Supabase session from localStorage).
// Area by path or subdomain (admin.leaserun.com = Web-Admin, partner.leaserun.com = business portal).
// Each area has its own, separate sign-in: consumer (B2C), business (B2B), Web-Admin, creator.
const HOST = location.hostname;
export const AREA = location.pathname.startsWith('/internal') || HOST.startsWith('admin.') ? 'admin' : location.pathname.startsWith('/creators') ? 'creator' : location.pathname.startsWith('/business-portal') || (HOST.startsWith('partner.') && location.pathname === '/') ? 'b2b' : 'app';
const SFX = AREA === 'admin' ? '-admin' : AREA === 'creator' ? '-creator' : AREA === 'b2b' ? '-b2b' : '';
const SESSION = AREA === 'admin' ? 'leaserun-admin-session-v1' : AREA === 'creator' ? 'leaserun-creator-session-v1' : AREA === 'b2b' ? 'leaserun-b2b-session-v1' : 'leaserun-auth-session-v1';
const ACT = 'lr-last-active' + SFX;
const REM = 'lr-remember' + SFX;
let cfg = null;

export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const session = () => { try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { return null; } };
export const setSession = (s) => { try { if (s) { localStorage.setItem(SESSION, JSON.stringify(s)); localStorage.setItem(ACT, String(Date.now())); } else localStorage.removeItem(SESSION); } catch { /* ignore */ } };
// Sign out (revokes the token, signs out all tabs); fallback without the session-guard script.
export const logout = () => { if (window.iaAuth) window.iaAuth.logout(); else { setSession(null); location.href = '/'; } };
export const token = () => session()?.access_token || '';

export async function config() {
  if (cfg) return cfg;
  const r = await fetch('/api/supabase-config', { cache: 'no-store' });
  if (!r.ok) throw Error('Sign-in is not configured.');
  cfg = await r.json();
  return cfg;
}

export async function supa(path, opts = {}) {
  const c = await config();
  return fetch(c.url + path, { ...opts, headers: { apikey: c.anonKey || c.key || c.publishableKey, 'content-type': 'application/json', ...(opts.headers || {}) } });
}

// Renew an expired session once with the refresh token.
export async function refresh() {
  const s = session();
  if (!s?.refresh_token) return false;
  let r;
  try { r = await supa('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) }); } catch { return false; }
  if (!r.ok) return false;
  setSession(await r.json());
  return true;
}

// Call our own APIs with authentication; returns { ok, status, data, res }.
export async function api(path, opts = {}, retry = true) {
  // Web-Admin: the active data scope (B2C / B2B / system) goes with every request – the server filters by it.
  let scope = null;
  if (AREA === 'admin' && path.startsWith('/api/admin/')) {
    try { scope = localStorage.getItem('lr-admin-seg'); } catch { /* ignore */ }
    // The former tax-bookkeeping scope ('steuer') was removed with the dropshipping/tax software; fall back to B2C.
    scope = ['b2c', 'b2b', 'system'].includes(scope) ? scope : 'b2c';
  }
  const headers = { Authorization: 'Bearer ' + token(), ...(scope ? { 'x-admin-scope': scope } : {}), ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) };
  let res;
  // Network failure (dead zone, tunnel, Safari "Load failed"): return a normal error instead of crashing.
  try { res = await fetch(path, { cache: 'no-store', ...opts, headers }); }
  catch { return { ok: false, status: 0, data: { error: 'No connection. Please check your network and try again.' }, res: null }; }
  if (res.status === 401 && retry && (await refresh())) return api(path, opts, false);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : null;
  return { ok: res.ok, status: res.status, data, res };
}

// Download a file response.
export async function download(path, opts = {}, fallbackName = 'download') {
  const r = await api(path, opts);
  if (!r.ok) throw Error(r.data?.error || 'Download failed.');
  const blob = await r.res.blob();
  const cd = r.res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(cd);
  const name = m ? decodeURIComponent(m[1] || m[2]) : fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  // Release only after 2 minutes: if the browser opens the file (e.g. a PDF in Chrome) instead of saving it,
  // it still needs the link – releasing it too early caused "access denied".
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 120_000);
  return r.res;
}

// Amounts in cents → USD. (Name eur kept for callers.)
export const eur = (c, d = 2) => (c == null ? '–' : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }));
export const usd = eur;
export const dt = (s) => (s ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(s)) : '–');
export const dtt = (s) => (s ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s)) : '–');

// ---------- Own sign-in form per area (Web-Admin, business portal) ----------
const ERR = {
  invalid_credentials: 'Incorrect email or password. Please check (passwords are case-sensitive).',
  email_not_confirmed: 'This email address is not confirmed yet. Please open the link in the confirmation email.',
  over_request_rate_limit: 'Too many attempts. Please wait a few minutes.',
};
function authError(d) {
  const c = (d && (d.error_code || d.code)) || '';
  if (ERR[c]) return ERR[c];
  const t = String((d && (d.error_description || d.msg || d.message)) || '');
  if (/invalid login credentials/i.test(t)) return ERR.invalid_credentials;
  if (/email not confirmed/i.test(t)) return ERR.email_not_confirmed;
  if (/rate|too many/i.test(t)) return ERR.over_request_rate_limit;
  return 'Sign-in failed. Please try again.';
}

// opts: { title, lead, signupLead, note, check(session) -> Promise<string|null> (error text if no access), signup: { next } }
// Express sign-in in the business portal (Google, Microsoft/Azure AD). Buttons appear only if the provider is enabled in Supabase.
const SSO_ICON = {
  apple: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9s-2.1-.9-3.4-.9c-1.8 0-3.4 1-4.3 2.6-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.6-1-2.6-4.2zM14 4.9c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg>',
  google: '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
  azure: '<svg viewBox="0 0 21 21" width="18" height="18" aria-hidden="true"><path fill="#F25022" d="M1 1h9v9H1z"/><path fill="#7FBA00" d="M11 1h9v9h-9z"/><path fill="#00A4EF" d="M1 11h9v9H1z"/><path fill="#FFB900" d="M11 11h9v9h-9z"/></svg>',
};
// Active providers: live from Supabase, otherwise from the server config, otherwise the last known state on this device.
// So the express buttons don't disappear when a single request fails (e.g. after signing out).
const SSO_KEY = 'lr-sso-providers';
async function ssoProviders(c) {
  let live = null;
  for (let i = 0; i < 2 && !live; i++) {
    try {
      const r = await fetch(c.url + '/auth/v1/settings', { headers: { apikey: c.key || c.anonKey || c.publishableKey }, cache: 'no-store' });
      if (r.ok) { const st = await r.json(); if (st && st.external) live = ['apple', 'google', 'azure'].filter((p) => st.external[p] === true); }
    } catch { /* second attempt */ }
  }
  const list = live || (Array.isArray(c.sso) ? c.sso : null);
  if (list) { try { localStorage.setItem(SSO_KEY, JSON.stringify(list)); } catch { /* no storage */ } return list; }
  try { const x = JSON.parse(localStorage.getItem(SSO_KEY) || 'null'); return Array.isArray(x) ? x : []; } catch { return []; }
}
async function ssoBind(root) {
  if (!root.querySelector('#aSso')) return;
  let c;
  try { c = await config(); } catch { return; }
  const on = await ssoProviders(c);
  // Look up only after the request: the form may have been redrawn in the meantime.
  const box = root.querySelector('#aSso'); if (!box) return;
  let any = false;
  box.querySelectorAll('[data-sso]').forEach((b) => {
    const prov = b.dataset.sso;
    if (!on.includes(prov)) return;
    b.hidden = false; any = true;
    b.onclick = () => {
      try { localStorage.setItem(REM, root.querySelector('#aRem')?.checked ? '1' : '0'); } catch { /* no storage */ }
      const scopes = prov === 'azure' ? '&scopes=' + encodeURIComponent('email openid profile') : '';
      // Creator area: return via /auth/callback (allowed in Supabase); the session lands in the creator session there.
      let back = location.origin + '/business-portal';
      if (AREA === 'creator') { try { sessionStorage.setItem('lr-next', '/creators'); } catch { /* no storage */ } back = location.origin + '/auth/callback'; }
      // Through our own domain once the keys are configured (the provider then shows leaserun.com instead of Supabase).
      if ((c.direct || []).includes(prov)) { location.href = '/api/auth/sso/start?provider=' + prov + '&back=' + encodeURIComponent(AREA === 'creator' ? '/auth/callback' : '/business-portal'); return; }
      location.href = c.url + '/auth/v1/authorize?provider=' + prov + scopes + '&redirect_to=' + encodeURIComponent(back);
    };
  });
  box.hidden = !any;
}

// Does the account belong to this area? Returns a message if not (the sign-in is then not accepted).
export async function areaCheck(d, want) {
  try {
    const r = await fetch('/api/auth/bereich', { headers: { Authorization: 'Bearer ' + d.access_token }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    if (j.admin && want !== 'admin') return 'This is an administrator account. It can only sign in to the Web-Admin.';
    if (want === 'b2b' && !j.b2b && !/einladung=/.test(location.hash)) return 'These credentials belong to a personal account. The Business Portal has separate logins – please sign in with your business login or request a business account.';
    if (want === 'b2c' && j.b2b) return 'These credentials belong to a business account. Please sign in to the Business Portal (partner.leaserun.com).';
    return null;
  } catch { return null; }
}

export function loginForm(root, opts) {
  const signup = opts.signup;
  const draw = (mode = 'login') => {
    root.innerHTML = `<div class="area-login"><a class="pt-brand dark" href="/"><img src="/logo-icon.svg" alt="" width="30" height="26"><span>Lease<span>Run</span></span></a>
      ${opts.back ? `<button type="button" class="area-back" id="aBack">← ${esc(opts.back.label)}</button>` : ''}
      <h1>${esc(opts.title)}</h1><p class="form-note">${esc(mode === 'signup' ? (opts.signupLead || 'Create a new login for your company. Then register your company here.') : opts.lead)}</p>
      ${signup ? `<div class="seg area-seg" role="tablist"><button type="button" role="tab" data-mode="login" aria-selected="${mode === 'login'}">Sign in</button><button type="button" role="tab" data-mode="signup" aria-selected="${mode === 'signup'}">Create account</button></div>` : ''}
      <form id="areaForm" method="post" action="#" autocomplete="on" novalidate>
        <label>Email<input id="aEmail" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label>Password<span class="pw-wrap"><input id="aPw" name="password" type="password" minlength="8" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required><button type="button" class="pw-eye" id="aEye">Show</button></span></label>
        ${mode === 'login' ? `<label class="chk remember"><input id="aRem" type="checkbox"${localStorage.getItem(REM) !== '0' ? ' checked' : ''}> Stay signed in <small>(on your own device only)</small></label>` : ''}
        <div class="auth-message" id="aMsg" role="alert" hidden></div>
        <button class="btn btn-dark btn-lg" type="submit">${mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>
      ${AREA === 'creator' ? `<div class="sso-box" id="aSso" hidden><div class="sso-or"><span>or faster</span></div><button type="button" class="btn sso-btn" data-sso="google" hidden>${SSO_ICON.google} Continue with Google</button><button type="button" class="btn sso-btn" data-sso="apple" hidden>${SSO_ICON.apple} Continue with Apple</button><button type="button" class="btn sso-btn" data-sso="azure" hidden>${SSO_ICON.azure} Continue with Microsoft</button><p class="form-note sso-legal">No creator account yet? It will be created automatically.</p></div>` : ''}
      ${AREA === 'b2b' && mode === 'login' ? `<div class="sso-box" id="aSso" hidden><div class="sso-or"><span>or</span></div><button type="button" class="btn sso-btn sso-apple" data-sso="apple" hidden>${SSO_ICON.apple} Sign in with Apple</button><button type="button" class="btn sso-btn" data-sso="google" hidden>${SSO_ICON.google} Sign in with Google</button><button type="button" class="btn sso-btn" data-sso="azure" hidden>${SSO_ICON.azure} Sign in with Microsoft</button><p class="form-note sso-legal">Existing business logins only: the email address of your Apple, Google or Microsoft account must match your login.</p></div>` : ''}
      <p class="form-note area-links">${mode === 'login' ? `<a class="ck-link" href="${AREA === 'creator' ? '/creators#passwort' : `/auth/forgot${AREA === 'b2b' ? '?bereich=b2b' : ''}`}">Forgot password?</a> · ` : ''}${opts.noteHtml || esc(opts.note || '')}</p></div>`;
    if ((AREA === 'b2b' && mode === 'login') || AREA === 'creator') ssoBind(root);
    const f = root.querySelector('#areaForm'), em = root.querySelector('#aEmail'), pw = root.querySelector('#aPw'), m = root.querySelector('#aMsg');
    const show = (t, kind = 'error') => { m.hidden = false; m.className = 'auth-message ' + kind; m.textContent = t; if (kind === 'error') { f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); [em, pw].forEach((x) => x.classList.add('bad')); } };
    [em, pw].forEach((x) => x.addEventListener('input', () => { x.classList.remove('bad'); m.hidden = true; }));
    root.querySelector('#aEye').onclick = (e) => { const sh = pw.type === 'password'; pw.type = sh ? 'text' : 'password'; e.target.textContent = sh ? 'Hide' : 'Show'; };
    root.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => draw(b.dataset.mode));
    root.querySelector('#aBack')?.addEventListener('click', () => opts.back.go());
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.dataset.busy) return;
      const email = em.value.trim().toLowerCase(), password = pw.value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { show('Please enter a valid email address.'); em.focus(); return; }
      if (password.length < 8) { show(mode === 'signup' ? 'Please choose a password with at least 8 characters.' : 'Incorrect sign-in details: the password is too short.'); pw.focus(); return; }
      f.dataset.busy = '1'; const btn = f.querySelector('button[type=submit]'); btn.disabled = true; show('Please wait …', 'info');
      try {
        if (AREA === 'creator') {
          // Creator area: own accounts – sign-in and sign-up through the server (internal account id).
          const r = await fetch('/api/creator/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: mode === 'signup' ? 'signup' : 'login', email, password }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw Error(d.error || (mode === 'signup' ? 'Sign-up failed.' : 'Sign-in failed.'));
          if (mode === 'signup') { show('Almost done: we sent you an email. Please confirm your email address – then you are signed in to the creator area.', 'success'); return; }
          try { localStorage.setItem(REM, root.querySelector('#aRem')?.checked ? '1' : '0'); } catch { /* ignore */ }
          setSession(d.session); location.reload(); return;
        }
        if (mode === 'signup') {
          const r = await fetch('/api/auth/mail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'signup', email, password, next: signup.next }) });
          if (r.status === 503) {
            const c = await config();
            const s2 = await supa('/auth/v1/signup?redirect_to=' + encodeURIComponent(location.origin + signup.next), { method: 'POST', body: JSON.stringify({ email, password }) });
            const d2 = await s2.json().catch(() => ({}));
            if (!s2.ok) throw Error(authError(d2));
            void c;
          } else if (!r.ok) { const d = await r.json().catch(() => ({})); throw Error(d.error || 'Sign-up failed.'); }
          show('Almost done: we sent you an email. Please confirm your email address, then sign in here.', 'success');
          return;
        }
        const r = await supa('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
        const d = await r.json().catch(() => ({}));
        // Report a failed attempt (anonymized IP only; after 10 attempts in 15 minutes the source is blocked).
        if (r.status === 400 || r.status === 401) fetch('/api/sec/login-fail?area=' + (AREA === 'b2b' ? 'b2b' : AREA === 'admin' ? 'admin' : AREA === 'creator' ? 'creator' : 'app'), { method: 'POST', keepalive: true }).catch(() => {});
        if (!r.ok) throw Error(authError(d));
        if (AREA === 'b2b') try { window.iaTrack?.('b2b_login'); } catch { /* ignore */ }
        // Separate sign-ins: business portal only for business accounts (exception: invitation link), Web-Admin only for admins.
        if (AREA === 'b2b') { const why = await areaCheck(d, 'b2b'); if (why) { show(why); return; } }
        if (opts.check) { const why = await opts.check(d); if (why) { show(why); return; } }
        try { localStorage.setItem(REM, root.querySelector('#aRem')?.checked ? '1' : '0'); } catch { /* ignore */ }
        if ((d.user?.factors || []).some((x) => x.status === 'verified')) {
          const mf = await import('./mfa.mjs?v=892f3666');
          root.innerHTML = '<div class="area-login" id="areaMfa"></div>';
          await mf.challengeUI(root.querySelector('#areaMfa'), d, () => location.reload());
          return;
        }
        setSession(d);
        location.reload();
      } catch (err) { show(err.message || 'Sign-in failed.'); }
      finally { delete f.dataset.busy; btn.disabled = false; }
    };
    // Express sign-in: detects while typing whether the email already has an account (shared by consumer and business areas).
    if (AREA !== 'admin' && AREA !== 'creator') import('./email-detect.mjs?v=892f3666').then((x) => x.attach(em, { mode: mode === 'signup' ? 'register' : 'login', actions: {
      ...(signup ? { register: (v) => { draw('signup'); root.querySelector('#aEmail').value = v; root.querySelector('#aPw')?.focus(); }, login: (v) => { draw('login'); root.querySelector('#aEmail').value = v; root.querySelector('#aPw')?.focus(); } } : {}),
      ...(opts.onUnknown ? { register: (v) => opts.onUnknown(v) } : {}),
      sso: (p) => root.querySelector(`[data-sso="${p}"]`)?.click(),
    } })).catch(() => {});
    em.focus();
  };
  draw();
}
