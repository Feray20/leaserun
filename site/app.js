// LEASERUN front-end behavior
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const usd = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const pct = n => (isFinite(n) ? n.toFixed(1) : '0.0') + '%';

  // Mobile nav
  const mb = $('.menu-btn');
  if (mb) mb.addEventListener('click', () => $('.nav-links').classList.toggle('open'));

  // ROI / underwriting calculator
  const calc = $('#roi-calc');
  if (calc) {
    const f = id => +$('#' + id).value;
    const run = () => {
      const price = f('c-price'), rent = f('c-rent'), down = f('c-down') / 100, rate = f('c-rate') / 100, rehab = f('c-rehab');
      $('#o-price').textContent = usd(price);
      $('#o-rent').textContent = usd(rent);
      $('#o-down').textContent = (down * 100).toFixed(0) + '%';
      $('#o-rate').textContent = (rate * 100).toFixed(2) + '%';
      $('#o-rehab').textContent = usd(rehab);
      // Operating assumptions: 5% vacancy, 8% mgmt, 35% of gross for taxes/ins/maint/capex/HOA (excl. mgmt)
      const gross = rent * 12;
      const egi = gross * 0.95;
      const opex = egi * 0.08 + gross * 0.30;
      const noi = egi - opex;
      const loan = price * (1 - down);
      const r = rate / 12, n = 360;
      const pmt = loan > 0 ? (r > 0 ? loan * r / (1 - Math.pow(1 + r, -n)) : loan / n) : 0;
      const cashFlow = noi - pmt * 12;
      const cashIn = price * down + price * 0.03 + rehab; // 3% closing costs
      $('#k-noi').textContent = usd(noi);
      $('#k-cap').textContent = pct(noi / (price + rehab) * 100);
      $('#k-coc').textContent = pct(cashFlow / cashIn * 100);
      $('#k-cf').textContent = usd(cashFlow / 12) + '/mo';
      $('#k-grm').textContent = (price / gross).toFixed(1) + 'x';
      $('#k-cash').textContent = usd(cashIn);
    };
    $$('input', calc).forEach(i => i.addEventListener('input', run));
    run();
  }

  // Lead modal: opens on [data-modal] click, after 25s, or on exit intent (desktop); once per visitor
  const modal = $('#lead-modal');
  const seen = () => { try { return localStorage.getItem('lr_modal') === '1'; } catch (e) { return false; } };
  const mark = () => { try { localStorage.setItem('lr_modal', '1'); } catch (e) {} };
  const open = () => modal && modal.classList.add('show');
  const close = () => { if (modal) { modal.classList.remove('show'); mark(); } };
  $$('[data-modal]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); open(); }));
  if (modal) {
    $('.x', modal).addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    if (!seen() && document.body.dataset.autoModal === '1') {
      setTimeout(() => { if (!seen()) open(); }, 25000);
      document.addEventListener('mouseout', e => { if (!e.relatedTarget && e.clientY < 8 && !seen()) open(); });
    }
  }

  // Forms → Supabase `leads` table (insert-only via RLS; publishable key is safe in the browser)
  const SB_URL = 'https://pxexxguhgqfxwhtnwcrj.supabase.co';
  const SB_KEY = 'sb_publishable_7Ga_tZ-JbJyVbA5e8YaGUg_DvftkCHP';
  const FIELDS = ['email', 'first_name', 'last_name', 'phone', 'interest', 'budget', 'capital', 'timeline', 'doors', 'notes'];
  $$('form[data-lead]').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const raw = Object.fromEntries(new FormData(form).entries());
      const row = { source: form.dataset.lead, page: location.pathname };
      FIELDS.forEach(k => { if (raw[k]) row[k] = String(raw[k]).trim().slice(0, k === 'notes' ? 2000 : 250); });
      const btn = $('button', form), ok = $('.ok-msg', form.parentElement) || $('.ok-msg', form);
      let err = $('.err-msg', form.parentElement);
      if (!err) { err = document.createElement('div'); err.className = 'err-msg'; err.style.cssText = 'padding:12px 14px;border-radius:10px;background:rgba(245,90,90,.12);color:#E5484D;font-weight:600;font-size:14px;margin-top:10px'; (ok || form).after(err); }
      err.style.display = 'none';
      if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = 'Sending…'; }
      try {
        const res = await fetch(SB_URL + '/rest/v1/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' },
          body: JSON.stringify(row)
        });
        if (!res.ok) throw new Error(res.status);
        form.reset();
        if (ok) ok.style.display = 'block';
        mark();
        if (window.gtag) window.gtag('event', 'generate_lead', { form: row.source });
      } catch (x) {
        err.textContent = 'Something went wrong. Please try again or email invest@leaserun.com.';
        err.style.display = 'block';
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.t; }
      }
    });
  });

  // Property filters
  const grid = $('#listing-grid');
  if (grid) {
    const cards = $$('.listing', grid);
    const apply = () => {
      const st = $('#f-state').value, mx = +$('#f-price').value, cap = +$('#f-cap').value, coc = +$('#f-coc').value, ty = $('#f-type').value;
      let shown = 0;
      cards.forEach(c => {
        const d = c.dataset;
        const ok = (!st || d.state === st) && (!mx || +d.price <= mx) && (+d.cap >= cap) && (+d.coc >= coc) && (!ty || d.type === ty);
        c.style.display = ok ? '' : 'none'; if (ok) shown++;
      });
      $('#f-count').textContent = shown + ' of ' + cards.length + ' deals';
      $('.empty').style.display = shown ? 'none' : 'block';
    };
    $$('.filters select').forEach(s => s.addEventListener('change', apply));
    $('#f-reset').addEventListener('click', () => { $$('.filters select').forEach(s => (s.selectedIndex = 0)); apply(); });
    apply();
  }

  // Year
  $$('.yr').forEach(e => (e.textContent = new Date().getFullYear()));
})();
