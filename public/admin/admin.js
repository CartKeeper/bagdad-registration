// Volunteer page: attendee list, check-in, shirt counts, mail-in/door entry, CSV downloads.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (cents) => '$' + ((cents || 0) / 100).toFixed(2).replace(/\.00$/, '');
  const KEY = 'bagdad-admin';
  let password = '';
  let regs = [];
  let shirtId = '';
  fetch('/api/config').then((r) => r.json()).then((c) => { shirtId = c.shirts?.[0]?.id || ''; }).catch(() => {});

  try { password = sessionStorage.getItem(KEY) || ''; } catch { /* private mode */ }

  async function api(method, body) {
    const res = await fetch('/api/admin', {
      method,
      headers: { Authorization: `Bearer ${password}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { signOut(); throw new Error('Wrong password.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function msg(id, text, kind = 'error') {
    $(id).textContent = text;
    $(id).className = text ? `msg ${kind}` : 'msg';
  }

  // ---- Sign in / out --------------------------------------------------------------------
  function signOut() {
    password = '';
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    $('app').hidden = true;
    $('login').hidden = false;
  }

  $('login-form').onsubmit = async (e) => {
    e.preventDefault();
    password = $('password').value;
    try {
      await load();
      try { sessionStorage.setItem(KEY, password); } catch { /* ignore */ }
      $('password').value = '';
      msg('login-msg', '');
    } catch (err) {
      msg('login-msg', err.message);
    }
  };
  $('logout').onclick = signOut;

  // ---- Data -----------------------------------------------------------------------------
  async function load() {
    regs = (await api('GET')).registrations;
    $('login').hidden = true;
    $('app').hidden = false;
    render();
  }

  const isPaid = (r) => r.status === 'paid' || r.status === 'review';
  const byPosition = (r) => [...(r.attendees || [])].sort((a, b) => a.position - b.position);
  const nameOf = (a) => `${a.first_name} ${a.last_initial}.`;

  function rows() {
    const showUnpaid = $('show-unpaid').checked;
    const q = $('search').value.trim().toLowerCase();
    const out = [];
    for (const r of regs) {
      if (r.status === 'cancelled' || (!isPaid(r) && !showUnpaid)) continue;
      for (const a of byPosition(r)) {
        const hay = `${a.first_name} ${a.last_initial} ${r.email || ''} ${r.phone || ''}`.toLowerCase();
        if (q && !hay.includes(q)) continue;
        out.push({ r, a });
      }
    }
    return out.sort((x, y) => nameOf(x.a).localeCompare(nameOf(y.a)));
  }

  function shirtTotals(paid) {
    const totals = new Map();
    for (const r of paid) for (const s of r.shirts || []) {
      const k = `${s.name}|${s.size}`;
      totals.set(k, (totals.get(k) || 0) + s.qty);
    }
    return [...totals].map(([k, qty]) => { const [name, size] = k.split('|'); return { name, size, qty }; })
      .sort((a, b) => a.name.localeCompare(b.name) || SIZE_ORDER(a.size) - SIZE_ORDER(b.size));
  }
  const SIZE_ORDER = (s) => { const i = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'].indexOf(s); return i < 0 ? 99 : i; };

  function render() {
    const paid = regs.filter(isPaid);
    const people = paid.flatMap(byPosition);
    const shirts = shirtTotals(paid);
    const stat = (n, label) => `<div class="stat"><b>${esc(n)}</b>${esc(label)}</div>`;
    $('stats').innerHTML =
      stat(people.length, 'people registered') +
      stat(people.filter((a) => a.checked_in_at).length, 'checked in') +
      stat(people.filter((a) => a.first_time).length, 'first-timers') +
      stat(shirts.reduce((n, s) => n + s.qty, 0), 'T-shirts') +
      stat(money(paid.reduce((n, r) => n + (r.donation_cents || 0), 0)), 'scholarship donations') +
      stat(money(paid.reduce((n, r) => n + (r.paid_cents || 0), 0)), 'collected') +
      stat(paid.filter((r) => r.snack).length, 'bringing snacks');

    const list = rows();
    $('people').innerHTML = list.length ? list.map(({ r, a }) => `
      <tr>
        <td><strong>${esc(nameOf(a))}</strong>${r.source !== 'online' ? ` <span class="tag">${esc(r.source)}</span>` : ''}</td>
        <td>${esc(a.role)}</td>
        <td>${a.first_time ? 'Yes' : ''}</td>
        <td>${esc(r.email || '')}${r.phone ? `<br>${esc(r.phone)}` : ''}</td>
        <td>${isPaid(r) ? money(r.paid_cents) : ''} ${r.status !== 'paid' ? `<span class="tag ${esc(r.status)}">${esc(r.status === 'pending' ? 'unfinished' : r.status)}</span>` : ''}</td>
        <td>${isPaid(r) ? `<button type="button" class="secondary checkin ${a.checked_in_at ? 'done' : ''}" data-id="${esc(a.id)}" data-in="${a.checked_in_at ? 1 : 0}">
              ${a.checked_in_at ? '✓ Checked in' : 'Check in'}</button>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="6">No one matches.</td></tr>';

    $('shirt-totals').innerHTML = shirts.length
      ? shirts.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.size)}</td><td>${s.qty}</td></tr>`).join('')
      : '<tr><td colspan="3">No shirts ordered yet.</td></tr>';
    const pickups = paid.filter((r) => (r.shirts || []).length && byPosition(r).length);
    $('shirt-pickups').innerHTML = pickups.length
      ? pickups.map((r) => `<tr><td>${esc(nameOf(byPosition(r)[0]))}</td>
          <td>${esc(r.shirts.map((s) => `${s.qty} × ${s.name}, ${s.size}`).join('; '))}</td></tr>`).join('')
      : '<tr><td colspan="2">None yet.</td></tr>';

    const review = regs.filter((r) => r.status === 'review');
    $('review').innerHTML = review.length
      ? review.map((r) => `<tr><td>${esc(new Date(r.created_at).toLocaleString())}</td>
          <td>${esc(byPosition(r).map(nameOf).join(', '))}</td><td>${esc(r.email || '')}</td>
          <td>${money(r.total_cents)}</td><td>${money(r.paid_cents)}</td><td>${esc(r.paypal_capture_id || '')}</td></tr>`).join('')
      : '<tr><td colspan="6">Nothing needs a look.</td></tr>';
  }

  $('people').onclick = async (e) => {
    const b = e.target.closest('button.checkin');
    if (!b) return;
    b.disabled = true;
    try {
      const { attendee } = await api('POST', { action: 'checkin', attendeeId: b.dataset.id, checkedIn: b.dataset.in !== '1' });
      for (const r of regs) for (const a of r.attendees || []) if (a.id === attendee.id) a.checked_in_at = attendee.checked_in_at;
      render();
    } catch (err) {
      alert(err.message);
      b.disabled = false;
    }
  };
  $('search').oninput = render;
  $('show-unpaid').onchange = render;
  $('refresh').onclick = () => load().catch((err) => alert(err.message));

  // ---- Mail-in / door -------------------------------------------------------------------
  function parsePeople(text) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [first = '', initial = '', role = 'AA', flag = ''] = line.split(',').map((s) => s.trim());
      const r = role.toLowerCase().replace(/[^a-z]/g, '');
      return {
        first, initial,
        role: r.startsWith('al') ? 'Al-Anon' : r.startsWith('g') ? 'Guest' : 'AA',
        firstTime: /^(first|yes|y|1)/i.test(flag),
      };
    });
  }
  function parseShirts(text) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [size = '', qty = '1'] = line.split(',').map((s) => s.trim());
      return { id: shirtId, size: size.toUpperCase(), qty: parseInt(qty, 10) || 1 };
    });
  }

  $('add-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    try {
      const r = await api('POST', {
        action: 'add',
        source: $('add-source').value,
        note: $('add-note').value,
        people: parsePeople($('add-people').value),
        shirts: parseShirts($('add-shirts').value),
        donation: $('add-donation').value,
        email: $('add-email').value,
        phone: $('add-phone').value,
      });
      msg('add-msg', `Added. Total ${money(r.totalCents)} — make sure that matches what they paid.`, 'info');
      e.target.reset();
      await load();
    } catch (err) {
      msg('add-msg', err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  // ---- CSV ------------------------------------------------------------------------------
  function download(name, header, data) {
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheets from treating it as a formula
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...data].map((row) => row.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  $('csv-people').onclick = () => {
    const paid = regs.filter(isPaid);
    download('bagdad-attendees.csv',
      ['First name', 'Last initial', 'Attending as', 'First time', 'Email', 'Phone', 'Source', 'Status', 'Checked in', 'Bringing snack', 'Registered'],
      paid.flatMap((r) => byPosition(r).map((a) => [
        a.first_name, a.last_initial, a.role, a.first_time ? 'yes' : '', r.email, r.phone, r.source, r.status,
        a.checked_in_at ? new Date(a.checked_in_at).toLocaleString() : '', r.snack ? 'yes' : '',
        new Date(r.created_at).toLocaleString(),
      ])));
  };
  $('csv-shirts').onclick = () => {
    const paid = regs.filter(isPaid);
    download('bagdad-shirts.csv', ['Pick up under', 'Design', 'Size', 'Qty', 'Email'],
      paid.flatMap((r) => (r.shirts || []).map((s) => [byPosition(r)[0] ? nameOf(byPosition(r)[0]) : '', s.name, s.size, s.qty, r.email])));
  };

  if (password) load().catch(() => signOut());
})();
