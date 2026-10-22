import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayPalError } from '../lib/paypal.js';
import { handle as config } from '../netlify/functions/config.mjs';
import { handle as createOrder } from '../netlify/functions/create-order.mjs';
import { handle as captureOrder } from '../netlify/functions/capture-order.mjs';
import { handle as admin } from '../netlify/functions/admin.mjs';

const BEFORE = new Date('2026-10-20T12:00:00Z');

// In-memory stand-ins for Supabase and PayPal.
function fakes({ capture } = {}) {
  const regs = new Map();
  const sent = [];
  let n = 0;
  const db = {
    async createRegistration(reg, people) {
      const id = reg.id ?? `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
      const attendees = people.map((p, i) => ({
        id: `${id.slice(0, 24)}${String(i + 1).padStart(12, '0')}`,
        registration_id: id, position: i + 1, first_name: p.first, last_initial: p.initial,
        role: p.role, first_time: p.firstTime, checked_in_at: null,
      }));
      regs.set(id, { created_at: BEFORE.toISOString(), paid_cents: null, ...reg, id, attendees });
      return id;
    },
    async findRegistrationByOrder(orderId) {
      return [...regs.values()].find((r) => r.paypal_order_id === orderId) ?? null;
    },
    async updateRegistration(id, patch) {
      const r = regs.get(id);
      Object.assign(r, patch);
      const { attendees, ...row } = r;
      return row;
    },
    async updateAttendee(id, patch) {
      for (const r of regs.values()) for (const a of r.attendees) if (a.id === id) return Object.assign(a, patch);
      return null;
    },
    async listRegistrations() {
      return [...regs.values()];
    },
  };
  const paypal = {
    created: [],
    captures: 0,
    async createOrder(body) {
      this.created.push(body);
      return { id: `ORDER${this.created.length}ABC` };
    },
    async captureOrder(id) {
      this.captures++;
      if (capture) return capture(id, this);
      const value = this.created.at(-1).purchase_units[0].amount.value;
      return completed(value);
    },
    async getOrder() {
      return completed(this.created.at(-1).purchase_units[0].amount.value);
    },
  };
  const services = {
    env: { PAYPAL_CLIENT_ID: 'client-abc', PAYPAL_ENV: 'sandbox', ADMIN_PASSWORD: 'let-me-in' },
    db, paypal,
    send: async (to, message) => sent.push({ to, ...message }),
    now: () => BEFORE,
  };
  return { services, regs, sent, paypal };
}

const completed = (value, status = 'COMPLETED') => ({
  status: 'COMPLETED',
  payer: { email_address: 'payer@example.com' },
  purchase_units: [{ payments: { captures: [{ id: 'CAP123', status, amount: { currency_code: 'USD', value } }] } }],
});

const post = (url, body, headers = {}) =>
  new Request(`https://example.org${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (url, headers = {}) => new Request(`https://example.org${url}`, { headers });

const form = {
  people: [{ first: 'Pat', initial: 'M', role: 'AA', firstTime: true }, { first: 'Sam', initial: 'K', role: 'Guest' }],
  shirts: [{ id: 'odaat', size: 'L', qty: 3 }],
  donation: 10,
  email: 'pat@example.com',
  snack: true,
};

async function register(f, body = form) {
  const res = await createOrder(post('/api/create-order', body), f.services);
  assert.equal(res.status, 200);
  return (await res.json()).id;
}

test('config shares only public settings', async () => {
  const { services } = fakes();
  const body = await (await config(get('/api/config'), services)).json();
  assert.equal(body.paypalClientId, 'client-abc');
  assert.equal(body.open, true);
  assert.equal(body.prices.registration, 30);
  assert.ok(!JSON.stringify(body).includes('let-me-in'));
});

test('create-order prices on the server and saves a pending registration', async () => {
  const f = fakes();
  const orderId = await register(f, { ...form, total: 1 });
  const pu = f.paypal.created[0].purchase_units[0];
  assert.equal(pu.amount.value, '160.00'); // 2 × 30 + 3 × 30 + 10
  const reg = [...f.regs.values()][0];
  assert.equal(reg.status, 'pending');
  assert.equal(reg.paypal_order_id, orderId);
  assert.equal(reg.total_cents, 16000);
  assert.equal(pu.custom_id, reg.id);
  assert.equal(reg.attendees.length, 2);
});

test('create-order turns form mistakes into a 400 and opens no PayPal order', async () => {
  const f = fakes();
  const res = await createOrder(post('/api/create-order', { ...form, email: 'nope' }), f.services);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /valid email/);
  assert.equal(f.paypal.created.length, 0);
});

test('capture marks the registration paid and emails a confirmation', async () => {
  const f = fakes();
  const orderId = await register(f);
  const res = await captureOrder(post('/api/capture-order', { orderId }), f.services);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.people, ['Pat M.', 'Sam K.']);
  assert.equal(body.paid, '160.00');
  assert.equal(body.shirtCount, 3);
  assert.equal(body.confirmation, 'CAP123');
  const reg = [...f.regs.values()][0];
  assert.equal(reg.status, 'paid');
  assert.equal(reg.paid_cents, 16000);
  assert.equal(reg.payer_email, 'payer@example.com');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'pat@example.com');
  assert.match(f.sent[0].text, /7502/);
  assert.match(f.sent[0].text, /pick up at check-in under Pat M\./);
});

test('capturing twice does not charge or email twice', async () => {
  const f = fakes();
  const orderId = await register(f);
  await captureOrder(post('/api/capture-order', { orderId }), f.services);
  const again = await (await captureOrder(post('/api/capture-order', { orderId }), f.services)).json();
  assert.equal(again.status, 'paid');
  assert.equal(f.paypal.captures, 1);
  assert.equal(f.sent.length, 1);
});

test('a payment for the wrong amount is flagged for review', async () => {
  const f = fakes({ capture: () => completed('1.00') });
  const orderId = await register(f);
  const body = await (await captureOrder(post('/api/capture-order', { orderId }), f.services)).json();
  assert.equal(body.status, 'review');
  assert.equal([...f.regs.values()][0].status, 'review');
});

test('a declined card asks the buyer to choose another way to pay', async () => {
  const f = fakes({
    capture: () => { throw new PayPalError('declined', 422, { details: [{ issue: 'INSTRUMENT_DECLINED' }] }); },
  });
  const orderId = await register(f);
  const body = await (await captureOrder(post('/api/capture-order', { orderId }), f.services)).json();
  assert.deepEqual(body, { restart: true });
  assert.equal([...f.regs.values()][0].status, 'pending');
});

test('an order PayPal already captured is still recorded', async () => {
  const f = fakes({
    capture: () => { throw new PayPalError('dup', 422, { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }); },
  });
  const orderId = await register(f);
  const body = await (await captureOrder(post('/api/capture-order', { orderId }), f.services)).json();
  assert.equal(body.status, 'paid');
});

test('capture rejects unknown orders', async () => {
  const f = fakes();
  const res = await captureOrder(post('/api/capture-order', { orderId: 'NOPE12345' }), f.services);
  assert.equal(res.status, 400);
  const bad = await captureOrder(post('/api/capture-order', { orderId: '../../etc' }), f.services);
  assert.equal(bad.status, 400);
});

test('a failed email does not lose the registration', async () => {
  const f = fakes();
  f.services.send = async () => { throw new Error('smtp down'); };
  const orderId = await register(f);
  const res = await captureOrder(post('/api/capture-order', { orderId }), f.services);
  assert.equal(res.status, 200);
  assert.equal([...f.regs.values()][0].status, 'paid');
});

test('admin needs the password', async () => {
  const f = fakes();
  assert.equal((await admin(get('/api/admin'), f.services)).status, 401);
  assert.equal((await admin(get('/api/admin', { Authorization: 'Bearer wrong' }), f.services)).status, 401);
  f.services.env.ADMIN_PASSWORD = '';
  assert.equal((await admin(get('/api/admin', { Authorization: 'Bearer ' }), f.services)).status, 401);
});

test('admin lists registrations, checks people in, and adds door registrations', async () => {
  const f = fakes();
  const auth = { Authorization: 'Bearer let-me-in' };
  const orderId = await register(f);
  await captureOrder(post('/api/capture-order', { orderId }), f.services);

  const { registrations } = await (await admin(get('/api/admin', auth), f.services)).json();
  assert.equal(registrations.length, 1);
  const attendeeId = registrations[0].attendees[0].id;

  const checked = await (await admin(post('/api/admin', { action: 'checkin', attendeeId, checkedIn: true }, auth), f.services)).json();
  assert.equal(checked.attendee.checked_in_at, BEFORE.toISOString());
  const unchecked = await (await admin(post('/api/admin', { action: 'checkin', attendeeId, checkedIn: false }, auth), f.services)).json();
  assert.equal(unchecked.attendee.checked_in_at, null);

  const door = await (await admin(post('/api/admin', {
    action: 'add', source: 'door', note: 'cash',
    people: [{ first: 'Lee', initial: 'R', role: 'AA' }], shirts: [], donation: 0, email: '',
  }, auth), f.services)).json();
  assert.equal(door.totalCents, 3500);
  const added = f.regs.get(door.id);
  assert.equal(added.status, 'paid');
  assert.equal(added.source, 'door');
  assert.equal(added.note, 'cash');

  const bad = await admin(post('/api/admin', { action: 'drop-tables' }, auth), f.services);
  assert.equal(bad.status, 400);
});

test('wrong HTTP methods are refused', async () => {
  const f = fakes();
  assert.equal((await createOrder(get('/api/create-order'), f.services)).status, 405);
  assert.equal((await config(post('/api/config', {}), f.services)).status, 405);
});
