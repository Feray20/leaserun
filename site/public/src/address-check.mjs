// US address check in forms: ZIP → city and state filled in automatically, ZIP must match state and city, house number
// required. Wrong combinations are shown and blocked before submitting; a city name not listed for the ZIP (e.g. a
// neighborhood or new development) can be confirmed deliberately.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ZIP_RE = /^\d{5}(-\d{4})?$/;
async function check(zip, city, street, state) {
  try { const r = await fetch(`/api/address?zip=${encodeURIComponent(zip)}&city=${encodeURIComponent(city)}&street=${encodeURIComponent(street)}&state=${encodeURIComponent(state)}`); return r.ok ? r.json() : { unavailable: true, plzValid: true, cityOk: true, stateOk: true }; } catch { return { unavailable: true, plzValid: true, cityOk: true, stateOk: true }; }
}

export function attachAddress(form, { street = 'street', postalCode = 'postalCode', city = 'city', state = 'state' } = {}) {
  const S = form.elements[street], Z = form.elements[postalCode], C = form.elements[city], ST = form.elements[state] || null;
  if (!S || !Z || !C || form.dataset.addr) return;
  form.dataset.addr = '1';
  const isUS = () => !form.elements.country || form.elements.country.value === 'US';
  Z.setAttribute('inputmode', 'numeric'); Z.setAttribute('maxlength', '10'); Z.setAttribute('autocomplete', 'postal-code');
  const box = document.createElement('div'); box.className = 'addr-msg'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  (S.closest('label') || S).after(box);
  const dl = document.createElement('datalist'); dl.id = 'addrCities' + Math.random().toString(36).slice(2, 7); form.append(dl); C.setAttribute('list', dl.id);
  let state0 = null, confirmed = false, seq = 0;
  const confirmBox = () => form.querySelector('[name="addressConfirmed"]');
  const paint = (r) => {
    state0 = r; box.className = 'addr-msg';
    if (!r || (r.unavailable && r.plzValid && r.stateOk !== false)) { box.innerHTML = ''; return; }
    const parts = [];
    if (!r.plzValid) { box.classList.add('bad'); parts.push(esc(r.message || 'Unknown ZIP code.')); }
    else if (r.stateOk === false) { box.classList.add('bad'); parts.push(esc(r.message || 'ZIP code and state do not match.')); }
    else if (!r.cityOk) {
      box.classList.add('warn');
      parts.push(`This ZIP code belongs to: ${r.cities.map((c) => `<button type="button" class="addr-sug" data-city="${esc(c)}">${esc(c)}</button>`).join(' ')}`);
      parts.push(`<label class="chk addr-ok"><input type="checkbox" name="addressConfirmed"${confirmed ? ' checked' : ''}> My city name is correct anyway (e.g. a neighborhood or unincorporated area)</label>`);
    } else if (!r.houseNumber && S.value.trim()) { box.classList.add('warn'); parts.push('Please add the house number (e.g. 123 Main St).'); }
    else if (r.houseNumber) { box.classList.add('ok'); parts.push('✓ ZIP, city and state match'); }
    box.innerHTML = parts.join('<br>');
    confirmBox()?.addEventListener('change', (e) => { confirmed = e.target.checked; });
  };
  const run = async () => {
    if (!isUS()) { state0 = null; box.innerHTML = ''; return null; }
    const zip = Z.value.trim();
    if (!ZIP_RE.test(zip)) { state0 = null; box.innerHTML = zip ? '<span>ZIP code: 5 digits (or ZIP+4)</span>' : ''; box.className = 'addr-msg' + (zip ? ' warn' : ''); return null; }
    const my = ++seq;
    const r = await check(zip, C.value.trim(), S.value.trim(), ST ? ST.value : '');
    if (my !== seq) return state0;
    if (r.cities?.length) { dl.innerHTML = r.cities.map((c) => `<option value="${esc(c)}">`).join(''); if (!C.value.trim() && r.cities.length === 1) { C.value = r.cities[0]; r.cityOk = true; } }
    if (ST && r.state && !ST.value) { ST.value = r.state; r.stateOk = true; }
    paint(r); return r;
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.addr-sug'); if (!b) return;
    if (b.dataset.city) C.value = b.dataset.city;
    run();
  });
  Z.addEventListener('input', () => { if (ZIP_RE.test(Z.value.trim())) run(); });
  [S, C, ST].filter(Boolean).forEach((el) => el.addEventListener('change', run));
  // Check before submitting (capture phase, so it runs before the form's own save handler).
  form.addEventListener('submit', async (e) => {
    if (form.dataset.addrOk === '1') { delete form.dataset.addrOk; return; }
    if (!isUS()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const r = await run();
    const blocked = !r ? Boolean(Z.value.trim()) : !r.plzValid || r.stateOk === false || (!r.unavailable && ((!r.cityOk && !confirmed) || !r.houseNumber));
    if (blocked) { box.scrollIntoView({ block: 'center' }); return; }
    form.dataset.addrOk = '1';
    if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
  }, true);
}
