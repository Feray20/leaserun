// Express sign-in: after the email is entered, detects whether an account exists (→ sign in) or not (→ sign up) and whether
// the account was created with Google/Microsoft (then there is no password). Applies to the consumer area and the Business Portal.
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
// This device remembers how you last signed in (email + method) – it's ready next time.
const LAST = 'lr-last-login';
const lastLogin = () => { try { const x = JSON.parse(localStorage.getItem(LAST) || 'null'); return x && ok(x.email) ? x : null; } catch { return null; } };
const remember = (method, email) => { try { if (ok(email)) localStorage.setItem(LAST, JSON.stringify({ method, email: email.trim().toLowerCase(), at: Date.now() })); } catch { /* private mode */ } };

// mode: 'login' | 'register'. actions: { register(email), login(email), sso(provider) } – depending on the page.
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
      put(`There's no account for this email yet.${actions.register ? ' <button type="button" class="link-btn" data-ed="reg">Sign up with this email now</button>' : ''}`, 'warn');
    } else if (mode === 'register' && s.exists) {
      put(`You're already signed up with this email.${actions.login ? ' <button type="button" class="link-btn" data-ed="login">Sign in instead</button>' : ''}`, 'warn');
    } else if (mode === 'login' && s.exists && !s.password && sso.length) {
      put(`This account signs in with ${sso.map((p) => SSO[p]).join(' or ')} – no password is set.${actions.sso ? ` <button type="button" class="link-btn" data-ed="sso" data-p="${sso[0]}">Sign in with ${SSO[sso[0]]}</button>` : ''}`, 'info');
    } else if (mode === 'login' && s.exists && !s.confirmed) {
      put("Your email address isn't confirmed yet. Please open the link in our email – or request a sign-in link below.", 'info');
    } else if (mode === 'login' && s.exists) {
      put('Account found – please enter your password.', 'ok');
    } else put('');
  };
  hint.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]'); if (!b) return;
    const em = input.value.trim().toLowerCase();
    if (b.dataset.ed === 'reg') actions.register?.(em);
    else if (b.dataset.ed === 'login') actions.login?.(em);
    else if (b.dataset.ed === 'sso') actions.sso?.(b.dataset.p);
  });
  // Remember how someone signs in (password or Apple/Google) – on this device only.
  if (mode === 'login') {
    input.form?.addEventListener('submit', () => remember('password', input.value));
    document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-sso]'); if (b) remember(b.dataset.sso, input.value); }, true);
    const L = lastLogin();
    if (L && !input.value) {
      input.value = L.email;
      if (SSO[L.method]) { put(`Last signed in on this device with ${SSO[L.method]}.${actions.sso ? ` <button type="button" class="link-btn" data-ed="sso" data-p="${L.method}">Continue with ${SSO[L.method]}</button>` : ''}`, 'ok'); last = L.email; }
      else setTimeout(() => input.form?.querySelector('input[type=password]')?.focus({ preventScroll: true }), 0);
    }
  }
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 650); });
  input.addEventListener('blur', run);
  input.addEventListener('change', run);
  if (input.value) run();
}
