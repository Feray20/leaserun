// Adressprüfung in Formularen (wie USPS, für Deutschland): PLZ → Ort automatisch, Straße gegen das amtliche
// Straßenverzeichnis, Hausnummer Pflicht. Falsche Kombinationen werden vor dem Absenden angezeigt und blockiert;
// eine nicht verzeichnete Straße (z. B. Neubaugebiet) kann bewusst bestätigt werden.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function check(plz, ort, street) {
  try { const r = await fetch(`/api/address?plz=${encodeURIComponent(plz)}&ort=${encodeURIComponent(ort)}&street=${encodeURIComponent(street)}`); return r.ok ? r.json() : { unavailable: true, plzValid: true, cityOk: true }; } catch { return { unavailable: true, plzValid: true, cityOk: true }; }
}

export function attachAddress(form, { street = 'street', postalCode = 'postalCode', city = 'city' } = {}) {
  const S = form.elements[street], Z = form.elements[postalCode], C = form.elements[city];
  if (!S || !Z || !C || form.dataset.addr) return;
  form.dataset.addr = '1';
  Z.setAttribute('inputmode', 'numeric'); Z.setAttribute('maxlength', '5'); Z.setAttribute('pattern', '[0-9]{5}');
  const box = document.createElement('div'); box.className = 'addr-msg'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  (S.closest('label') || S).after(box);
  const dl = document.createElement('datalist'); dl.id = 'addrCities' + Math.random().toString(36).slice(2, 7); form.append(dl); C.setAttribute('list', dl.id);
  let state = null, confirmed = false, seq = 0;
  const confirmBox = () => form.querySelector('[name="addressConfirmed"]');
  const paint = (r) => {
    state = r; box.className = 'addr-msg';
    if (!r || r.unavailable) { box.innerHTML = ''; return; }
    const parts = [];
    if (!r.plzValid) { box.classList.add('bad'); parts.push(esc(r.message || 'Postleitzahl unbekannt.')); }
    else if (!r.cityOk) { box.classList.add('bad'); parts.push(`Zur PLZ passt: ${r.cities.map((c) => `<button type="button" class="addr-sug" data-city="${esc(c)}">${esc(c)}</button>`).join(' ')}`); }
    else if (r.streetOk === false) {
      box.classList.add('warn');
      parts.push(`Diese Straße ist unter der PLZ nicht verzeichnet.${r.suggestions.length ? ' Meinten Sie: ' + r.suggestions.map((s) => `<button type="button" class="addr-sug" data-street="${esc(s)}">${esc(s)}</button>`).join(' ') : ''}`);
      parts.push(`<label class="chk addr-ok"><input type="checkbox" name="addressConfirmed"${confirmed ? ' checked' : ''}> Die Adresse stimmt trotzdem (z. B. Neubaugebiet)</label>`);
    } else if (r.streetOk && !r.houseNumber) { box.classList.add('warn'); parts.push('Bitte die Hausnummer ergänzen.'); }
    else if (r.streetOk) { box.classList.add('ok'); parts.push('✓ Adresse geprüft'); }
    box.innerHTML = parts.join('<br>');
    confirmBox()?.addEventListener('change', (e) => { confirmed = e.target.checked; });
  };
  const run = async () => {
    const plz = Z.value.trim();
    if (!/^\d{5}$/.test(plz)) { state = null; box.innerHTML = plz ? '<span>Postleitzahl: fünf Ziffern</span>' : ''; box.className = 'addr-msg' + (plz ? ' warn' : ''); return null; }
    const my = ++seq;
    const r = await check(plz, C.value.trim(), S.value.trim());
    if (my !== seq) return state;
    if (r.cities?.length) { dl.innerHTML = r.cities.map((c) => `<option value="${esc(c)}">`).join(''); if (!C.value.trim() && r.cities.length === 1) { C.value = r.cities[0]; r.cityOk = true; } }
    paint(r); return r;
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.addr-sug'); if (!b) return;
    if (b.dataset.city) C.value = b.dataset.city;
    if (b.dataset.street) { const no = (/(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)\s*$/.exec(S.value) || [''])[0]; S.value = `${b.dataset.street} ${no}`.trim(); }
    run();
  });
  Z.addEventListener('input', () => { if (/^\d{5}$/.test(Z.value.trim())) run(); });
  [S, C].forEach((el) => el.addEventListener('change', run));
  // Vor dem Absenden prüfen (Capture-Phase, damit es vor dem eigenen Speichern-Handler läuft).
  form.addEventListener('submit', async (e) => {
    if (form.dataset.addrOk === '1') { delete form.dataset.addrOk; return; }
    e.preventDefault(); e.stopImmediatePropagation();
    const r = await run();
    const blocked = !r ? Boolean(Z.value.trim()) : !r.unavailable && (!r.plzValid || !r.cityOk || (r.streetOk === false && !confirmed) || (r.streetOk && !r.houseNumber));
    if (blocked) { box.scrollIntoView({ block: 'center' }); return; }
    form.dataset.addrOk = '1';
    if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
  }, true);
}
