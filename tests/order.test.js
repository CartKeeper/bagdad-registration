import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrder, isOpen, ValidationError } from '../lib/order.js';
import { orderBody } from '../lib/paypal.js';
import { EVENT } from '../lib/settings.js';

const BEFORE = new Date('2026-10-20T12:00:00Z');
const valid = () => ({
  people: [
    { first: 'Pat', initial: 'M.', role: 'AA', firstTime: true },
    { first: 'Sam', initial: 'K', role: 'Al-Anon' },
  ],
  shirts: [{ id: 'odaat', size: 'XL', qty: 2 }],
  donation: '20',
  email: 'pat@example.com',
  phone: '',
  snack: true,
});

test('prices a valid order on the server', () => {
  const o = buildOrder(valid(), { now: BEFORE });
  assert.equal(o.totalCents, (30 * 2 + 30 * 2 + 20) * 100);
  assert.deepEqual(o.people[0], { first: 'Pat', initial: 'M', role: 'AA', firstTime: true });
  assert.equal(o.people[1].firstTime, false);
  assert.deepEqual(o.shirts, [{ id: 'odaat', name: 'One Day at a Time', size: 'XL', qty: 2 }]);
  assert.equal(o.donation, 20);
  assert.equal(o.snack, true);
  assert.equal(o.items.find((i) => i.category === 'DONATION').unitCents, 2000);
});

test('ignores any price or total the browser sends', () => {
  const o = buildOrder({ ...valid(), total: 1, prices: { registration: 0 } }, { now: BEFORE });
  assert.equal(o.totalCents, 14000);
});

test('merges duplicate shirt lines', () => {
  const input = { ...valid(), shirts: [{ id: 'odaat', size: 'L', qty: 1 }, { id: 'odaat', size: 'L', qty: 3 }] };
  assert.deepEqual(buildOrder(input, { now: BEFORE }).shirts.map((s) => s.qty), [4]);
});

test('rejects bad input with a friendly message', () => {
  const cases = [
    [{ people: [] }, /at least one person/],
    [{ people: [{ first: '', initial: 'M', role: 'AA' }] }, /first name and last initial for person 1/],
    [{ people: [{ first: 'Pat', initial: 'M', role: 'Hacker' }] }, /AA, Al-Anon or Guest/],
    [{ people: Array(11).fill({ first: 'A', initial: 'B', role: 'AA' }) }, /at most 10/],
    [{ shirts: [{ id: 'nope', size: 'L', qty: 1 }] }, /no longer available/],
    [{ shirts: [{ id: 'odaat', size: 'XXXXL', qty: 1 }] }, /choose a size/],
    [{ shirts: [{ id: 'odaat', size: 'L', qty: 0 }] }, /between 1 and 20/],
    [{ shirts: [{ id: 'odaat', size: 'L', qty: 1.5 }] }, /between 1 and 20/],
    [{ donation: -5 }, /positive amount/],
    [{ donation: 'abc' }, /positive amount/],
    [{ donation: 100000 }, /contact us directly/],
    [{ email: 'not-an-email' }, /valid email/],
    [{ email: '' }, /valid email/],
    [{ people: [{ first: 'x'.repeat(41), initial: 'M', role: 'AA' }] }, /too long/],
  ];
  for (const [patch, re] of cases) {
    assert.throws(() => buildOrder({ ...valid(), ...patch }, { now: BEFORE }), (e) => e instanceof ValidationError && re.test(e.message));
  }
});

test('closes after the deadline, unless a volunteer is entering it', () => {
  const after = new Date(new Date(EVENT.closesAt).getTime() + 1000);
  assert.equal(isOpen(BEFORE), true);
  assert.equal(isOpen(after), false);
  assert.throws(() => buildOrder(valid(), { now: after }), /closed/);
  const door = buildOrder({ ...valid(), shirts: [], donation: 0 }, { now: after, ignoreDeadline: true, registrationPrice: 35 });
  assert.equal(door.totalCents, 7000);
});

test('mail-in registrations may have no email', () => {
  const o = buildOrder({ ...valid(), email: '' }, { now: BEFORE, requireEmail: false });
  assert.equal(o.email, '');
});

test('PayPal order body adds up and carries the registration id', () => {
  const o = buildOrder(valid(), { now: BEFORE });
  const body = orderBody(o, 'reg-123');
  const pu = body.purchase_units[0];
  assert.equal(pu.custom_id, 'reg-123');
  assert.equal(pu.amount.value, '140.00');
  const sum = pu.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_amount.value), 0);
  assert.equal(sum.toFixed(2), pu.amount.value);
  assert.equal(pu.amount.breakdown.item_total.value, pu.amount.value);
  assert.ok(pu.items.every((i) => i.name.length <= 127));
  assert.equal(body.application_context.shipping_preference, 'NO_SHIPPING');
});
