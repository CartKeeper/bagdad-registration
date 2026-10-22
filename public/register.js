// Registration page. Prices and options come from /api/config; the server re-checks
// everything and sets the amount PayPal charges, so the totals here are only a preview.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const list = $('attendees');
  const shirtCart = []; // [{ id, size, qty }]
  let cfg;

  function showMsg(text, kind = 'error') {
    const m = $('msg');
    m.textContent = text;
    m.className = text ? `msg ${kind}` : 'msg';
  }

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Nothing was charged. Please try again.');
    return data;
  }

  // ---- Filling the page from settings -------------------------------------------------
  function applySettings() {
    document.querySelectorAll('[data-event]').forEach((el) => (el.textContent = cfg.event[el.dataset.event]));
    document.querySelectorAll('[data-price]').forEach((el) => (el.textContent = cfg.prices[el.dataset.price]));
    document.querySelectorAll('[data-event-href]').forEach((el) => {
      const v = cfg.event[el.dataset.eventHref];
      el.href = el.dataset.eventHref === 'lodgingPhone' ? 'tel:' + v.replace(/\D/g, '') : v;
    });
  }

  // ---- People ---------------------------------------------------------------------------
  function addAttendee() {
    if (list.children.length >= cfg.limits.people) return;
    const n = list.children.length + 1;
    const div = document.createElement('div');
    div.className = 'attendee';
    div.innerHTML = `
      <h3><span>Person ${n}</span>
        ${n > 1 ? '<button type="button" class="remove">Remove</button>' : ''}</h3>
      <div class="row">
        <div><label>First name<input type="text" class="first" placeholder="Pat" autocomplete="${n === 1 ? 'given-name' : 'off'}" maxlength="40"></label></div>
        <div><label>Last initial<input type="text" class="initial" maxlength="3" placeholder="M"></label></div>
      </div>
      <label>I'm attending as
        <select class="role">${cfg.roles.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" class="first-time"><span>This is my first Bagdad conference</span></label>`;
    const rm = div.querySelector('.remove');
    if (rm) rm.onclick = () => { div.remove(); renumber(); update(); };
    list.appendChild(div);
    $('add').hidden = list.children.length >= cfg.limits.people;
    update();
  }

  function renumber() {
    [...list.children].forEach((d, i) => (d.querySelector('h3 span').textContent = `Person ${i + 1}`));
    $('add').hidden = list.children.length >= cfg.limits.people;
  }

  // ---- Shirts ---------------------------------------------------------------------------
  const shirtById = (id) => cfg.shirts.find((s) => s.id === id);

  function renderShirtCards() {
    if (!cfg.shirts.length) { $('shirt-section').hidden = true; return; }
    $('shirt-grid').innerHTML = cfg.shirts.map((s) => `
      <div class="shirt-card" data-id="${esc(s.id)}">
        <img src="${esc(s.image)}" alt="${esc(s.name)} T-shirt, front and back" loading="lazy">
        <h3>${esc(s.name)}</h3>
        <div class="hint">${esc(s.tagline)}</div>
        <div class="price">$${cfg.prices.shirt}</div>
        <div class="row">
          <div><label>Size<select class="size"><option value="">Choose</option>
            ${cfg.sizes.map((z) => `<option>${esc(z)}</option>`).join('')}</select></label></div>
          <div><label>Qty<input type="number" class="qty" min="1" max="${cfg.limits.shirtQty}" value="1" inputmode="numeric"></label></div>
        </div>
        <button type="button" class="secondary add-shirt">Add shirt</button>
      </div>`).join('');
    $('shirt-grid').querySelectorAll('.shirt-card').forEach((card) => {
      card.querySelector('.add-shirt').onclick = () => {
        const size = card.querySelector('.size');
        const max = cfg.limits.shirtQty;
        const qty = Math.min(max, Math.max(1, parseInt(card.querySelector('.qty').value, 10) || 1));
        if (!size.value) { size.classList.add('invalid'); size.focus(); return; }
        const existing = shirtCart.find((c) => c.id === card.dataset.id && c.size === size.value);
        if (existing) existing.qty = Math.min(max, existing.qty + qty);
        else shirtCart.push({ id: card.dataset.id, size: size.value, qty });
        size.value = '';
        card.querySelector('.qty').value = 1;
        renderShirtCart();
      };
    });
  }

  function renderShirtCart() {
    $('shirt-cart').innerHTML = shirtCart.length
      ? '<strong>Your shirts</strong>' + shirtCart.map((c, i) => `
          <div><span>${c.qty} × ${esc(shirtById(c.id).name)}, size ${esc(c.size)}</span>
            <span>$${c.qty * cfg.prices.shirt}
              <button type="button" class="remove" data-i="${i}">Remove</button></span></div>`).join('')
      : '';
    $('shirt-cart').querySelectorAll('.remove').forEach((b) =>
      (b.onclick = () => { shirtCart.splice(+b.dataset.i, 1); renderShirtCart(); }));
    update();
  }

  // ---- Reading the form + preview total ------------------------------------------------
  function readForm() {
    return {
      people: [...list.children].map((d) => ({
        first: d.querySelector('.first').value.trim(),
        initial: d.querySelector('.initial').value.trim(),
        role: d.querySelector('.role').value,
        firstTime: d.querySelector('.first-time').checked,
      })),
      shirts: shirtCart.map((c) => ({ ...c })),
      donation: Math.max(0, Math.round(parseFloat($('donation').value) || 0)),
      email: $('email').value.trim(),
      phone: $('phone').value.trim(),
      snack: $('snack').checked,
    };
  }

  function update() {
    if (!cfg) return;
    const f = readForm();
    const shirts = f.shirts.reduce((n, c) => n + c.qty, 0);
    const lines = [[`Registration × ${f.people.length}`, f.people.length * cfg.prices.registration]];
    if (shirts) lines.push([`T-shirt × ${shirts}`, shirts * cfg.prices.shirt]);
    if (f.donation) lines.push(['Scholarship donation', f.donation]);
    $('lines').innerHTML = lines.map(([k, v]) => `<div><span>${esc(k)}</span><span>$${v}</span></div>`).join('');
    $('total').textContent = '$' + lines.reduce((s, [, v]) => s + v, 0);
  }

  // Marks empty fields; returns a message, or '' when ready to pay.
  function validate() {
    let ok = true;
    const need = (el, good) => { el.classList.toggle('invalid', !good); if (!good) ok = false; };
    list.querySelectorAll('.first, .initial').forEach((el) => need(el, el.value.trim() !== ''));
    need($('email'), /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('email').value.trim()));
    return ok ? '' : 'Please fill in a first name and last initial for each person, and your email.';
  }

  // ---- Payment --------------------------------------------------------------------------
  function showThanks(r) {
    $('thanks-summary').textContent =
      `${r.people.join(', ')} — paid $${r.paid}. ` +
      (r.shirtCount ? `Your ${r.shirtCount} T-shirt${r.shirtCount > 1 ? 's' : ''} will be waiting at check-in under ${r.shirtPickup} ` : '') +
      (r.confirmation ? `Confirmation #${r.confirmation}. ` : '') +
      (r.status === 'review' ? 'We\'ll double-check this payment and contact you if anything is off.' : '');
    $('register').style.display = 'none';
    $('thanks').style.display = 'block';
    $('thanks').focus();
    $('thanks').scrollIntoView({ behavior: 'smooth' });
  }

  function renderPayPal() {
    paypal.Buttons({
      style: { layout: 'vertical', shape: 'rect', label: 'pay' },

      onClick(data, actions) {
        const problem = validate();
        showMsg(problem);
        return problem ? actions.reject() : actions.resolve();
      },

      async createOrder() {
        showMsg('');
        try {
          return (await api('/api/create-order', readForm())).id;
        } catch (err) {
          showMsg(err.message);
          throw err;
        }
      },

      async onApprove(data, actions) {
        try {
          const r = await api('/api/capture-order', { orderId: data.orderID });
          if (r.restart) {
            showMsg('That payment method was declined. Please choose another way to pay.', 'info');
            return actions.restart();
          }
          showThanks(r);
        } catch (err) {
          showMsg(err.message);
        }
      },

      onCancel() {
        showMsg('Payment was cancelled. Nothing was charged — you can try again.', 'info');
      },

      onError(err) {
        console.error(err);
        if (!$('msg').textContent) {
          showMsg(`Something went wrong with the payment. Nothing was charged. Please try again, or email ${cfg.event.contactEmail}.`);
        }
      },
    }).render('#paypal-buttons');
  }

  function loadPayPal() {
    const params = new URLSearchParams({
      'client-id': cfg.paypalClientId,
      currency: 'USD',
      intent: 'capture',
      components: 'buttons',
      'enable-funding': 'venmo',
    });
    // Sandbox only: pretend the buyer is in the US so the Venmo button shows when testing.
    if (cfg.paypalEnv === 'sandbox') params.set('buyer-country', 'US');
    const s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?' + params;
    s.onload = renderPayPal;
    s.onerror = () => showMsg('Online payment could not load. Please refresh the page, or register by mail below.');
    document.head.appendChild(s);
  }

  // ---- Start ----------------------------------------------------------------------------
  async function start() {
    try {
      cfg = await api('/api/config');
    } catch {
      $('register').style.display = 'none';
      $('closed').style.display = 'block';
      $('closed').querySelector('h2').textContent = 'Online registration is unavailable right now';
      return;
    }
    applySettings();
    if (!cfg.open) {
      $('register').style.display = 'none';
      $('closed').style.display = 'block';
      return;
    }
    $('add').onclick = addAttendee;
    $('donation').oninput = update;
    $('register').onsubmit = (e) => e.preventDefault();
    document.addEventListener('input', (e) => e.target.classList.remove('invalid'));
    document.addEventListener('change', (e) => e.target.classList.remove('invalid'));
    renderShirtCards();
    addAttendee();
    if (window.paypal) renderPayPal();
    else loadPayPal();
  }

  start();
})();
