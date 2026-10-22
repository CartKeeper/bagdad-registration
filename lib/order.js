// Turns what someone typed into the form into a checked order with server-side prices.
// The browser never decides what anything costs.

import { EVENT, PRICES, SHIRTS, SHIRT_SIZES, ROLES, LIMITS } from './settings.js';

export class ValidationError extends Error {}

const fail = (msg) => {
  throw new ValidationError(msg);
};

// Trim, drop control characters, collapse runs of spaces.
function clean(value, max) {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') fail('Unexpected value in the form.');
  const s = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) fail(`"${s.slice(0, 20)}…" is too long.`);
  return s;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isOpen(now = new Date()) {
  return now < new Date(EVENT.closesAt);
}

export const badge = (p) => `${p.first} ${p.initial}.`;

/**
 * @param {object} input  raw JSON from the browser (or the volunteer page)
 * @param {object} [opts]
 * @param {Date}   [opts.now]
 * @param {boolean}[opts.ignoreDeadline]  volunteers can enter mail-in/door registrations after the deadline
 * @param {number} [opts.registrationPrice]  e.g. the door price
 * @param {boolean}[opts.requireEmail]  online registrations need an email; mail-in may not have one
 */
export function buildOrder(input, opts = {}) {
  const {
    now = new Date(),
    ignoreDeadline = false,
    registrationPrice = PRICES.registration,
    requireEmail = true,
  } = opts;
  if (!input || typeof input !== 'object') fail('The form was empty.');
  if (!ignoreDeadline && !isOpen(now)) {
    fail(`Online registration closed on ${EVENT.closesLabel}. You can still register at the door for $${EVENT.doorPrice}.`);
  }

  const rawPeople = Array.isArray(input.people) ? input.people : [];
  if (rawPeople.length === 0) fail('Please add at least one person.');
  if (rawPeople.length > LIMITS.people) fail(`Please register at most ${LIMITS.people} people at a time.`);
  const people = rawPeople.map((p, i) => {
    const first = clean(p?.first, 40);
    const initial = clean(p?.initial, 3).replace(/\.+$/, '');
    if (!first || !initial) fail(`Please fill in a first name and last initial for person ${i + 1}.`);
    const role = clean(p?.role, 20);
    if (!ROLES.includes(role)) fail(`Please choose AA, Al-Anon or Guest for person ${i + 1}.`);
    return { first, initial, role, firstTime: p?.firstTime === true };
  });

  const rawShirts = Array.isArray(input.shirts) ? input.shirts : [];
  if (rawShirts.length > LIMITS.shirtLines) fail('Too many different shirts in one order.');
  const shirtMap = new Map();
  for (const s of rawShirts) {
    const design = SHIRTS.find((d) => d.id === s?.id);
    if (!design) fail('That T-shirt design is no longer available.');
    if (!SHIRT_SIZES.includes(s?.size)) fail('Please choose a size for each shirt.');
    const qty = Number(s?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.shirtQty) fail(`Shirt quantity must be between 1 and ${LIMITS.shirtQty}.`);
    const key = `${design.id}|${s.size}`;
    const prev = shirtMap.get(key);
    if (prev) prev.qty = Math.min(LIMITS.shirtQty, prev.qty + qty);
    else shirtMap.set(key, { id: design.id, name: design.name, size: s.size, qty });
  }
  const shirts = [...shirtMap.values()];

  const donationRaw = input.donation === '' || input.donation == null ? 0 : Number(input.donation);
  if (!Number.isFinite(donationRaw) || donationRaw < 0) fail('The scholarship donation must be a positive amount.');
  const donation = Math.round(donationRaw);
  if (donation > LIMITS.donation) fail(`For donations over $${LIMITS.donation}, please contact us directly.`);

  const email = clean(input.email, 254);
  if (email ? !EMAIL.test(email) : requireEmail) fail('Please enter a valid email address.');
  const phone = clean(input.phone, 30);
  const snack = input.snack === true;

  const items = [
    ...people.map((p) => ({
      name: `Registration – ${badge(p)} (${p.role}${p.firstTime ? ', first time' : ''})`,
      unitCents: registrationPrice * 100,
      qty: 1,
      category: 'DIGITAL_GOODS',
    })),
    ...shirts.map((s) => ({
      name: `T-shirt – ${s.name}, size ${s.size}`,
      unitCents: PRICES.shirt * 100,
      qty: s.qty,
      category: 'PHYSICAL_GOODS',
    })),
  ];
  if (donation) {
    items.push({ name: 'Richard VanCleave Scholarship donation', unitCents: donation * 100, qty: 1, category: 'DONATION' });
  }
  const totalCents = items.reduce((sum, i) => sum + i.unitCents * i.qty, 0);

  return { people, shirts, donation, email, phone, snack, items, totalCents };
}

export const dollars = (cents) => (cents / 100).toFixed(2);
