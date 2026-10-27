// "Report a technical problem" for consumer accounts (b2c) and the Business Portal (b2b).
// Description + up to 3 screenshots (downscaled in the browser) + device details automatically. Goal: answer within 12 hours.
import { api, dtt, esc } from './sess.mjs?v=892f3666';

const CATS = { anmeldung: 'Sign-in & account', zahlung: 'Payment & plan', anzeige: 'Display & usability', werkzeug: 'Calculators & tools', dokument: 'PDF, Lender Package & documents', langsam: "Slow / won't load", sonstiges: 'Other' };
const SEV = [['blockiert', "I'm stuck"], ['stoert', 'Annoying, but works'], ['klein', 'Minor issue']];
const STATUS = { neu: ['Received', 'warn'], in_arbeit: ['In progress', 'info'], rueckfrage: ['Waiting for your reply', 'warn'], geloest: ['Resolved', 'ok'], geschlossen: ['Closed', ''] };
const MAX = 3;
const ERRS = [];
addEventListener('error', (e) => { if (ERRS.length < 5 && e?.message) ERRS.push(String(e.message).slice(0, 300)); });
addEventListener('unhandledrejection', (e) => { const m = e?.reason?.message || String(e?.reason || ''); if (ERRS.length < 5 && m) ERRS.push(m.slice(0, 300)); });

const CSS = `.sp{display:grid;gap:14px}.sp-intro{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:#F0F7FF;border:1px solid #DBEAFE;color:#1E3A5F;font-size:14px;line-height:1.5}
.sp-intro b{color:#0F2C59}.sp-f{display:grid;grid-template-columns:1fr 1fr;gap:14px}.sp-f .w{grid-column:1/-1}
.sp-f label,.sp-f fieldset{display:grid;gap:6px;font-size:14px;font-weight:600;color:#334155;margin:0;min-width:0}
.sp-f input[type=text],.sp-f select,.sp-f textarea{width:100%;box-sizing:border-box;border:1px solid #CBD5E1;border-radius:10px;padding:11px 12px;font:inherit;font-size:16px;font-weight:400;background:#fff;color:#0F172A}
.sp-f textarea{resize:vertical;min-height:110px}.sp-f fieldset{border:0;padding:0}.sp-f legend{padding:0;margin-bottom:6px}
.sp-sev{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.sp-sev label{display:flex;align-items:center;gap:8px;border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px;font-weight:500;cursor:pointer;min-height:44px}
.sp-sev label:has(input:checked){border-color:#1D4ED8;background:#EFF6FF;color:#0F2C59}.sp-sev input{accent-color:#1D4ED8}
.sp-drop{display:grid;place-items:center;gap:6px;border:1.5px dashed #94A3B8;border-radius:12px;padding:18px;text-align:center;color:#475569;font-weight:500;cursor:pointer;background:#F8FAFC}
.sp-drop[hidden]{display:none}.sp-drop.on{border-color:#1D4ED8;background:#EFF6FF}.sp-drop .sp-sm{color:#64748B;font-weight:400;font-size:13px}.sp-opt{font-weight:400;color:#64748B}.sp-drop input{position:absolute;width:1px;height:1px;opacity:0}
.sp-shots{display:flex;flex-wrap:wrap;gap:10px}.sp-shot{position:relative;width:96px;height:72px;border-radius:8px;overflow:hidden;border:1px solid #E2E8F0;background:#F1F5F9}
.sp-shot img{width:100%;height:100%;object-fit:cover}.sp-shot button{position:absolute;top:4px;right:4px;width:26px;height:26px;border-radius:50%;border:0;background:rgba(15,23,42,.75);color:#fff;font-size:15px;line-height:1;cursor:pointer}
.sp-act{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.sp-msg{font-size:14px}.sp-msg.ok{color:#047857}.sp-msg.err{color:#B91C1C}
.sp-auto{font-size:12.5px;color:#64748B;margin:0}.sp-h{margin:10px 0 0;color:#0F2C59;font-size:16px}
.sp-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}.sp-list li{border:1px solid #E2E8F0;border-radius:12px;padding:12px 14px;background:#fff;display:grid;gap:6px}
.sp-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 12px;align-items:baseline}.sp-top strong{color:#0F2C59;overflow-wrap:anywhere}
.sp-meta{font-size:12.5px;color:#64748B}.sp-st{display:inline-block;font-size:12px;font-weight:700;border-radius:999px;padding:3px 9px;background:#F1F5F9;color:#334155}
.sp-st.warn{background:#FEF3C7;color:#92400E}.sp-st.info{background:#DBEAFE;color:#1E40AF}.sp-st.ok{background:#D1FAE5;color:#065F46}
.sp-ans{background:#F0F9FF;border-radius:10px;padding:10px 12px;font-size:14px;white-space:pre-wrap}.sp-add{display:flex;gap:8px;flex-wrap:wrap}.sp-add textarea{flex:1 1 220px;min-height:60px;border:1px solid #CBD5E1;border-radius:10px;padding:8px 10px;font:inherit;font-size:16px}
@media (max-width:640px){.sp-f{grid-template-columns:1fr}.sp-sev{grid-template-columns:1fr}}`;

function style() { if (document.getElementById('spCss')) return; const s = document.createElement('style'); s.id = 'spCss'; s.textContent = CSS; document.head.append(s); }

// Downscale the image (max. 1600 px, JPEG) – so even large iPhone screenshots fit safely into the report.
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('decode')); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    let q = 0.85, blob = null;
    do { blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q)); q -= 0.15; } while (blob && blob.size > 1_300_000 && q > 0.3);
    if (!blob) throw new Error('encode');
    return { blob, preview: URL.createObjectURL(blob) };
  } finally { URL.revokeObjectURL(url); }
}

function device() {
  let standalone = false; try { standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { /* ignore */ }
  return { ua: navigator.userAgent.slice(0, 400), vw: innerWidth, vh: innerHeight, dpr: Math.round((devicePixelRatio || 1) * 100) / 100, lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, standalone, online: navigator.onLine, touch: 'ontouchstart' in window, errors: ERRS.slice(0, 5) };
}
const devLabel = () => { const u = navigator.userAgent; const os = /iPad|Macintosh.*Mobile|Macintosh(?=.*Safari)(?=.*Version)/.test(u) && 'ontouchstart' in window ? 'iPad' : /iPhone/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac/.test(u) ? 'Mac' : 'Device'; const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) && !/Edg\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser'; return `${os} · ${br} · ${innerWidth}×${innerHeight}`; };

export function mountSupport(box, { area }) {
  if (!box) return;
  style();
  const shots = [];
  box.innerHTML = `<div class="sp">
    <div class="sp-intro" data-noklapp><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="10" fill="none" stroke="#1D4ED8" stroke-width="2"/><path d="M12 7v6M12 16.5v.5" stroke="#1D4ED8" stroke-width="2.2" stroke-linecap="round"/></svg>
      <span>Something not working? Briefly describe what happened and, ideally, attach a <b>screenshot</b>. We'll get back to you <b>within 12 hours</b> – usually much sooner.</span></div>
    <form class="sp-f" id="spF" novalidate>
      <label>Area<select name="category">${Object.entries(CATS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Subject<input type="text" name="title" maxlength="140" required placeholder="e.g. Lender Package won't download"></label>
      <fieldset class="w"><legend>How much is this affecting you?</legend><div class="sp-sev">${SEV.map(([k, l], i) => `<label><input type="radio" name="severity" value="${k}"${i === 1 ? ' checked' : ''}> ${l}</label>`).join('')}</div></fieldset>
      <label class="w">What happened?<textarea name="text" rows="4" maxlength="4000" required placeholder="What did you do (step by step), and what happened then? Was there an error message?"></textarea></label>
      <label class="w"><span>What did you expect? <span class="sp-opt">(optional)</span></span><textarea name="expected" rows="2" maxlength="2000" style="min-height:60px"></textarea></label>
      <div class="w"><label class="sp-drop" id="spDrop"><input type="file" accept="image/*" multiple id="spFile"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 7h3l2-2h6l2 2h3v12H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>Add screenshot<span class="sp-sm">up to ${MAX} images · tap to choose or drag here</span></label>
        <div class="sp-shots" id="spShots"></div></div>
      <p class="sp-auto w" data-noklapp>Sent automatically so we can find the issue faster: page, device and browser (${esc(devLabel())}). Please don't include passwords or account numbers in the text or screenshot.</p>
      <div class="sp-act w"><button class="btn btn-dark" type="submit">Send report</button><span class="sp-msg" id="spMsg" role="status" aria-live="polite"></span></div>
    </form>
    <h4 class="sp-h">Your reports</h4><div id="spMine"><p class="lr-ld" role="status">Loading …</p></div></div>`;
  const f = box.querySelector('#spF'), msg = box.querySelector('#spMsg'), drop = box.querySelector('#spDrop'), input = box.querySelector('#spFile');
  const say = (t, cls = '') => { msg.textContent = t; msg.className = 'sp-msg ' + cls; };
  const paint = () => {
    box.querySelector('#spShots').innerHTML = shots.map((s, i) => `<div class="sp-shot"><img src="${s.preview}" alt="Screenshot ${i + 1}"><button type="button" data-rm="${i}" aria-label="Remove screenshot ${i + 1}">×</button></div>`).join('');
    drop.hidden = shots.length >= MAX;
  };
  box.querySelector('#spShots').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; const [s] = shots.splice(Number(b.dataset.rm), 1); if (s) URL.revokeObjectURL(s.preview); paint(); });
  const add = async (list) => {
    const files = [...list].filter((x) => /^image\//.test(x.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(x.name));
    if (!files.length) { say('Please choose an image (e.g. a screenshot).', 'err'); return; }
    say('Preparing image …');
    for (const file of files.slice(0, MAX - shots.length)) {
      try { shots.push(await shrink(file)); } catch { say("Your browser can't read this image format. Please save it as JPG or PNG.", 'err'); return; }
    }
    paint(); say(files.length > MAX ? `${MAX} images were added.` : '');
  };
  input.addEventListener('change', () => { add(input.files || []); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('on'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
  drop.addEventListener('drop', (e) => add(e.dataTransfer?.files || []));
  // Paste a screenshot from the clipboard (desktop: Ctrl/Cmd + V in the form).
  f.addEventListener('paste', (e) => { const fl = [...(e.clipboardData?.files || [])]; if (fl.length) { e.preventDefault(); add(fl); } });

  f.onsubmit = async (e) => {
    e.preventDefault();
    const E = f.elements, title = E.title.value.trim(), text = E.text.value.trim();
    if (title.length < 3) { say('Please enter a short subject.', 'err'); E.title.focus(); return; }
    if (text.length < 10) { say('Please describe the problem in at least 10 characters.', 'err'); E.text.focus(); return; }
    const fd = new FormData();
    fd.set('area', area); fd.set('category', E.category.value); fd.set('severity', E.severity.value || 'stoert'); fd.set('title', title); fd.set('text', text);
    if (E.expected.value.trim()) fd.set('expected', E.expected.value.trim());
    fd.set('page', (location.pathname + location.hash).slice(0, 300));
    fd.set('device', JSON.stringify(device()));
    shots.forEach((s, i) => fd.append('shots', s.blob, `screenshot-${i + 1}.jpg`));
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; say(shots.length ? 'Sending (with screenshots) …' : 'Sending …');
    const r = await api('/api/support', { method: 'POST', body: fd });
    btn.disabled = false;
    if (!r.ok) { say(r.data?.error || 'Sending failed. Please try again or email support@leaserun.com.', 'err'); return; }
    shots.splice(0).forEach((s) => URL.revokeObjectURL(s.preview)); paint(); f.reset();
    say(`Thank you! Ticket ${r.data.ref} received – answer by ${dtt(r.data.dueAt)}. A confirmation is on its way by email.`, 'ok');
    mine();
  };

  async function mine() {
    const el = box.querySelector('#spMine'); if (!el) return;
    const r = await api(`/api/support?area=${area}`);
    const items = r.ok ? r.data.items || [] : [];
    el.innerHTML = items.length ? `<ul class="sp-list">${items.map((t) => { const [sl, sc] = STATUS[t.status] || [t.status, '']; return `<li><div class="sp-top"><strong>${esc(t.title)}</strong><span class="sp-st ${sc}">${sl}</span></div>
      <span class="sp-meta">${esc(t.ref)} · ${esc(CATS[t.category] || t.category)} · reported ${dtt(t.created_at)}${t.shots ? ` · ${t.shots} Screenshot${t.shots > 1 ? 's' : ''}` : ''}${['neu', 'in_arbeit'].includes(t.status) ? ` · answer by ${dtt(t.due_at)}` : ''}</span>
      ${t.answer ? `<div class="sp-ans"><b>Answer from the LeaseRun team${t.answered_at ? ` (${dtt(t.answered_at)})` : ''}:</b>\n${esc(t.answer)}</div>` : ''}
      ${['neu', 'in_arbeit', 'rueckfrage'].includes(t.status) ? `<details><summary class="sp-meta" style="cursor:pointer">Add something</summary><div class="sp-add"><textarea data-addt="${esc(t.id)}" maxlength="2000" placeholder="Your addition or reply"></textarea><button type="button" class="btn btn-outline" data-add="${esc(t.id)}">Send</button></div></details>` : ''}</li>`; }).join('')}</ul>`
      : "<p class=\"form-note\">No reports yet – glad everything's working.</p>";
    el.querySelectorAll('[data-add]').forEach((b) => b.onclick = async () => {
      const ta = el.querySelector(`[data-addt="${b.dataset.add}"]`); const text = ta?.value.trim() || '';
      if (text.length < 3) { ta?.focus(); return; }
      b.disabled = true; const x = await api('/api/support', { method: 'PATCH', body: JSON.stringify({ id: b.dataset.add, text }) }); b.disabled = false;
      if (x.ok) mine(); else say(x.data?.error || 'Sending failed.', 'err');
    });
  }
  mine();
}
