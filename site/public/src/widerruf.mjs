// "Request a refund" (LeaseRun refund policy): always reachable, no login, two steps
// (1. details, 2. confirm), confirmation by email with content and time of receipt.
const root = document.getElementById('wdr');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ts = Date.now();
const CONTRACTS = ['Lender Package (one-time purchase)', 'Buyer Pass (90 days)', 'Investor Pro (subscription)', 'Legacy plan (Starter, Pro)', 'Other purchase'];
let data = { name: '', email: '', contract: CONTRACTS[0], ref: '', date: '', reason: '' };
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

function step1() {
  root.innerHTML = `<form id="wdrF" class="cancel-form" novalidate><h2>Request a refund – step 1 of 2</h2>
    <p class="form-note">Not happy with a LeaseRun purchase? Request a refund here – no login and no reason needed. We review every request under our <a href="#policy">Refund Policy</a> within 2 business days.</p>
    <label>Full name<input name="name" required autocomplete="name" value="${esc(data.name)}"></label>
    <label>Email address (for your confirmation)<input name="email" type="email" required autocomplete="email" value="${esc(data.email)}"></label>
    <label>Purchase<select name="contract">${CONTRACTS.map((c) => `<option${c === data.contract ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label>Receipt or order number (if you have it)<input name="ref" maxlength="80" value="${esc(data.ref)}"></label>
    <label>Purchase date (if known)<input name="date" type="date" value="${esc(data.date)}"></label>
    <label>Comment (optional)<textarea name="reason" rows="3" maxlength="1000">${esc(data.reason)}</textarea></label>
    <div class="pp-hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <p class="form-note" id="wdrMsg" role="alert"></p>
    <button class="btn btn-dark btn-lg" type="submit">Continue to confirmation</button>
    <p class="form-note">You can also request a refund by emailing <a href="mailto:support@leaserun.com">support@leaserun.com</a>. To stop a subscription from renewing: <a href="/cancel">Cancel online</a>.</p></form>`;
  const f = root.querySelector('#wdrF');
  f.onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (String(d.name).trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email).trim())) { root.querySelector('#wdrMsg').textContent = 'Please enter your name and a valid email address.'; return; }
    data = { ...data, ...d, name: String(d.name).trim(), email: String(d.email).trim() };
    step2();
  };
}

function step2() {
  root.innerHTML = `<div class="cancel-form"><h2>Confirm refund request – step 2 of 2</h2>
    <p>I am requesting a refund for the following purchase:</p>
    <dl class="wdr-sum"><dt>Name</dt><dd>${esc(data.name)}</dd><dt>Email</dt><dd>${esc(data.email)}</dd><dt>Purchase</dt><dd>${esc(data.contract)}</dd>${data.ref ? `<dt>Receipt/order number</dt><dd>${esc(data.ref)}</dd>` : ''}${data.date ? `<dt>Purchased on</dt><dd>${esc(fmtDate(data.date))}</dd>` : ''}${data.reason ? `<dt>Comment</dt><dd>${esc(data.reason)}</dd>` : ''}</dl>
    <p class="form-note" id="wdrMsg" role="alert"></p>
    <div class="pt-row"><button class="btn btn-dark btn-lg" type="button" id="wdrGo">Submit refund request</button><button class="btn btn-ghost" type="button" id="wdrBack">Edit details</button></div></div>`;
  root.querySelector('#wdrBack').onclick = step1;
  root.querySelector('#wdrGo').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await fetch('/api/widerruf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, ts }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error || 'Your refund request could not be sent.');
      root.innerHTML = `<div class="cancel-form"><h2>Refund request received</h2><p>Received: <strong>${esc(j.receivedAt)}</strong></p>
        <dl class="wdr-sum"><dt>Name</dt><dd>${esc(data.name)}</dd><dt>Purchase</dt><dd>${esc(data.contract)}</dd>${data.ref ? `<dt>Number</dt><dd>${esc(data.ref)}</dd>` : ''}</dl>
        <p>We sent a confirmation with the details and time of your request to <strong>${esc(data.email)}</strong>. We review it within 2 business days; approved refunds go back to your original payment method (banks usually post them within 5–10 business days).</p>
        <button class="btn btn-ghost" type="button" id="wdrPrint">Print confirmation</button></div>`;
      root.querySelector('#wdrPrint').onclick = () => print();
    } catch (err) { root.querySelector('#wdrMsg').textContent = err.message; b.disabled = false; }
  };
}

if (root) step1();
