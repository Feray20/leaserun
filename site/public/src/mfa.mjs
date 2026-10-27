// Two-factor protection (Supabase MFA): authenticator app (TOTP, free) or SMS code to a mobile number.
// Shared by sign-in, account and the admin center.

// Two-factor code: autofill from the keyboard (iOS/Android), clean the input and submit automatically at 6 digits.
if (!window.__iaOtp) {
  window.__iaOtp = true;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.autocomplete !== 'one-time-code') return;
    const d = el.value.replace(/\D/g, '').slice(0, 6);
    if (d !== el.value) el.value = d;
    if (d.length === 6 && el.form && !el.form.dataset.otpSent) { el.form.dataset.otpSent = '1'; setTimeout(() => { delete el.form.dataset.otpSent; }, 4000); el.form.requestSubmit(); }
  });
}

const AREA = location.pathname.startsWith('/internal') || location.hostname.startsWith('admin.') ? 'admin' : location.pathname.startsWith('/creators') ? 'creator' : location.pathname.startsWith('/business-portal') || (location.hostname.startsWith('partner.') && location.pathname === '/') ? 'b2b' : 'app';
const KEY = AREA === 'admin' ? 'leaserun-admin-session-v1' : AREA === 'creator' ? 'leaserun-creator-session-v1' : AREA === 'b2b' ? 'leaserun-b2b-session-v1' : 'leaserun-auth-session-v1';
const ACT = AREA === 'admin' ? 'lr-last-active-admin' : AREA === 'creator' ? 'lr-last-active-creator' : AREA === 'b2b' ? 'lr-last-active-b2b' : 'lr-last-active';
// SMS as a second factor is prepared but hidden (costs per SMS; TCPA consent wording needed). Set to true to enable.
const SMS_ENABLED = false;
let cfg = null;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function config() {
  if (cfg) return cfg;
  const r = await fetch('/api/supabase-config');
  cfg = await r.json();
  cfg.k = cfg.anonKey || cfg.key || cfg.publishableKey;
  return cfg;
}
async function sb(path, token, opts = {}) {
  const c = await config();
  const r = await fetch(c.url + path, { ...opts, headers: { apikey: c.k, Authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(opts.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.msg || d.error_description || d.message || 'Error'), { code: d.error_code || d.code, status: r.status });
  return d;
}
const saveSession = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); localStorage.setItem(ACT, String(Date.now())); } catch { /* ignore */ } };
export const currentSession = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
export const aalOf = (token) => { try { return JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch { return 'aal1'; } };
export const maskPhone = (p) => { const s = String(p || ''); return s.length > 6 ? s.slice(0, 3) + ' ••• ' + s.slice(-3) : s; };
export function normPhone(v) {
  let s = String(v || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  // US numbers: 10 digits → +1, 11 digits starting with 1 → +1.
  if (/^\d{10}$/.test(s)) s = '+1' + s;
  else if (/^1\d{10}$/.test(s)) s = '+' + s;
  if (!s.startsWith('+')) s = '+' + s;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}
const niceErr = (e) => {
  const m = String(e?.message || '');
  if (/invalid.*(code|totp)|expired|incorrect/i.test(m) || e?.code === 'mfa_verification_failed') return "The code is wrong or has expired. Please try again.";
  if (/phone.*(disabled|not enabled)|mfa_phone|sms.*provider|Unsupported phone provider/i.test(m) || e?.code === 'mfa_phone_enroll_not_enabled' || e?.code === 'mfa_phone_verify_not_enabled') return "SMS delivery isn't set up yet. Please use the authenticator app for now.";
  if (/rate|too many/i.test(m)) return 'Too many attempts. Please wait a moment.';
  return m || "That didn't work.";
};

// The user's verified factors.
export async function factorsOf(token) {
  const u = await sb('/auth/v1/user', token);
  return { user: u, factors: (u.factors || []).filter((f) => f.status === 'verified') };
}

// Code prompt after the password. Renders into `box`; calls onDone(newSession) after successful verification.
export async function challengeUI(box, session, onDone) {
  const { user, factors } = await factorsOf(session.access_token);
  let f = factors.find((x) => x.factor_type === 'totp') || factors[0];
  const render = () => {
    const other = factors.find((x) => x !== f);
    box.innerHTML = `<div class="mfa-box"><h2>Two-step verification</h2>
      <p class="form-note">${f.factor_type === 'phone' ? `We'll text a 6-digit code to ${esc(maskPhone(f.phone))}.` : 'Enter the current 6-digit LeaseRun code from Google Authenticator (or your authenticator app). The code changes every 30 seconds.'}</p>
      ${f.factor_type === 'phone' ? '<button type="button" class="btn btn-outline mfa-send" id="mfaSend">Text me a code</button>' : ''}
      <form id="mfaForm" class="mfa-form"><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus enterkeyhint="done" aria-label="Code" placeholder="123456"><button class="btn btn-dark" type="submit">Verify</button></form>
      ${other ? `<button type="button" class="link-btn" id="mfaSwitch">${other.factor_type === 'phone' ? 'Use a text message instead' : 'Use the authenticator app instead'}</button>` : ''}
      <p class="form-note" id="mfaMsg" role="status"></p></div>`;
    let challengeId = null;
    const msg = (t, bad) => { const m = box.querySelector('#mfaMsg'); m.textContent = t; m.className = 'form-note ' + (bad ? 'st bad' : ''); };
    const challenge = async () => { const c = await sb(`/auth/v1/factors/${f.id}/challenge`, session.access_token, { method: 'POST', body: '{}' }); challengeId = c.id; return c; };
    box.querySelector('#mfaSend')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await challenge(); msg('Code sent. It is valid for a few minutes.'); box.querySelector('#mfaCode').focus(); } catch (err) { msg(niceErr(err), true); }
      setTimeout(() => { e.target.disabled = false; e.target.textContent = 'Resend code'; }, 30000);
    });
    box.querySelector('#mfaSwitch')?.addEventListener('click', () => { f = other; render(); });
    box.querySelector('#mfaForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        if (!challengeId) await challenge();
        const v = await sb(`/auth/v1/factors/${f.id}/verify`, session.access_token, { method: 'POST', body: JSON.stringify({ challenge_id: challengeId, code: box.querySelector('#mfaCode').value.trim() }) });
        const s = { ...session, ...v, user: v.user || user };
        saveSession(s);
        onDone(s);
      } catch (err) { msg(niceErr(err), true); challengeId = null; btn.disabled = false; }
    };
    box.querySelector('#mfaCode')?.focus();
  };
  render();
}

// Account management: status, setup (app/SMS), removal.
export async function manageUI(box) {
  const s = currentSession();
  if (!s?.access_token) return;
  let data;
  try { data = await factorsOf(s.access_token); } catch { box.innerHTML = "<p class=\"form-note\">Status couldn't be loaded.</p>"; return; }
  const { factors } = data;
  const label = (f) => (f.factor_type === 'phone' ? `Text message to ${esc(maskPhone(f.phone))}` : `Authenticator app${f.friendly_name ? ` (${esc(f.friendly_name)})` : ''}`);
  box.innerHTML = `<p class="form-note"><strong>${factors.length ? '✓ Two-factor protection is on.' : 'Two-factor protection is off.'}</strong> ${factors.length ? 'Every sign-in also asks for a code.' : 'Protects your account with an extra code – even if someone knows your password.'}</p>
    ${factors.length ? `<ul class="mfa-list">${factors.map((f) => `<li><span>${label(f)}</span><button type="button" class="link-btn" data-unenroll="${esc(f.id)}">Remove</button></li>`).join('')}</ul>` : ''}
    <div class="sess-act">${factors.some((f) => f.factor_type === 'totp') ? '' : '<button type="button" class="btn btn-dark" id="mfaTotp">Set up authenticator app</button>'}${!SMS_ENABLED || factors.some((f) => f.factor_type === 'phone') ? '' : '<button type="button" class="btn btn-outline" id="mfaPhone">Set up text message code</button>'}</div>
    <p class="form-note">Free with an authenticator app, e.g. Google Authenticator (iPhone and Android), Microsoft Authenticator or Apple Passwords.</p>
    <div id="mfaFlow"></div><p class="form-note" id="mfaMsg2" role="status"></p>`;
  const flow = box.querySelector('#mfaFlow');
  const msg = (t, bad) => { const m = box.querySelector('#mfaMsg2'); m.textContent = t; m.className = 'form-note ' + (bad ? 'st bad' : 'st ok'); };
  const verifyStep = (factorId, intro, preChallenge = null) => {
    flow.insertAdjacentHTML('beforeend', `<form class="mfa-form" id="mfaEnrollForm"><input id="mfaEnrollCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus enterkeyhint="done" placeholder="123456" aria-label="Code"><button class="btn btn-dark" type="submit">Verify</button></form>`);
    if (intro) msg(intro);
    box.querySelector('#mfaEnrollForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const cur = currentSession();
        const cid = preChallenge || (await sb(`/auth/v1/factors/${factorId}/challenge`, cur.access_token, { method: 'POST', body: '{}' })).id;
        const v = await sb(`/auth/v1/factors/${factorId}/verify`, cur.access_token, { method: 'POST', body: JSON.stringify({ challenge_id: cid, code: box.querySelector('#mfaEnrollCode').value.trim() }) });
        saveSession({ ...cur, ...v, user: v.user || cur.user });
        await manageUI(box);
        msg('Two-factor protection is set up.');
      } catch (er) { msg(niceErr(er), true); }
    };
  };
  box.querySelector('#mfaTotp')?.addEventListener('click', async () => {
    try {
      const cur = currentSession();
      const e = await sb('/auth/v1/factors', cur.access_token, { method: 'POST', body: JSON.stringify({ factor_type: 'totp', friendly_name: 'LeaseRun ' + new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 5) }) });
      flow.innerHTML = `<div class="mfa-enroll"><p>1. Open Google Authenticator, tap "+" and choose "Scan a QR code":</p><img src="${esc(e.totp.qr_code)}" alt="QR code for the authenticator app" width="180" height="180"><p class="form-note">On the same phone? In Google Authenticator choose "Enter a setup key" and type this key: <code>${esc(e.totp.secret)}</code></p><p>2. Enter the 6-digit code from Google Authenticator here:</p></div>`;
      verifyStep(e.id);
    } catch (er) { msg(niceErr(er), true); }
  });
  box.querySelector('#mfaPhone')?.addEventListener('click', () => {
    flow.innerHTML = `<form class="mfa-form" id="mfaPhoneForm"><input id="mfaPhoneNo" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 123-4567" required aria-label="Mobile number"><button class="btn btn-dark" type="submit">Send code</button></form>`;
    box.querySelector('#mfaPhoneForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const phone = normPhone(box.querySelector('#mfaPhoneNo').value);
      if (!phone) { msg('Please enter a valid mobile number, e.g. (555) 123-4567.', true); return; }
      try {
        const cur = currentSession();
        const e = await sb('/auth/v1/factors', cur.access_token, { method: 'POST', body: JSON.stringify({ factor_type: 'phone', phone, friendly_name: 'SMS ' + phone.slice(-3) }) });
        const c = await sb(`/auth/v1/factors/${e.id}/challenge`, cur.access_token, { method: 'POST', body: '{}' });
        flow.innerHTML = '';
        verifyStep(e.id, `Code texted to ${maskPhone(phone)} – please enter it.`, c.id);
      } catch (er) { msg(niceErr(er), true); }
    };
  });
  box.querySelectorAll('[data-unenroll]').forEach((b) => b.onclick = async () => {
    if (!confirm('Really remove this second factor?')) return;
    try { await sb(`/auth/v1/factors/${b.dataset.unenroll}`, currentSession().access_token, { method: 'DELETE' }); await manageUI(box); msg('Removed.'); }
    catch (er) { msg(niceErr(er), true); }
  });
}
