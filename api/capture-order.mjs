// POST /api/capture-order { orderId } — takes the payment the person just approved,
// checks PayPal charged exactly what we priced, and marks the registration paid.

import { PayPalError, captureOf } from '../lib/paypal.js';
import { ValidationError, badge, dollars } from '../lib/order.js';
import { confirmationEmail } from '../lib/email.js';
import { endpoint, json, readJson } from '../lib/http.js';

const peopleOf = (reg) =>
  [...(reg.attendees ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((a) => ({ first: a.first_name, initial: a.last_initial }));

function summary(reg) {
  const people = peopleOf(reg);
  return {
    status: reg.status,
    confirmation: reg.paypal_capture_id,
    paid: dollars(reg.paid_cents ?? 0),
    people: people.map(badge),
    shirtCount: (reg.shirts ?? []).reduce((n, s) => n + s.qty, 0),
    shirtPickup: people[0] ? badge(people[0]) : '',
  };
}

export const handle = endpoint('POST', async (req, { db, paypal, send, now }) => {
  const { orderId } = await readJson(req);
  if (typeof orderId !== 'string' || !/^[A-Z0-9-]{5,40}$/i.test(orderId)) throw new ValidationError('Unknown order.');

  const reg = await db.findRegistrationByOrder(orderId);
  if (!reg) throw new ValidationError('We could not find that registration. Nothing was charged.');
  if (reg.status === 'paid' || reg.status === 'review') return json(200, summary(reg)); // already done

  let order;
  try {
    order = await paypal.captureOrder(orderId);
  } catch (err) {
    if (!(err instanceof PayPalError)) throw err;
    // The card or Venmo balance was declined: let the person pick another way to pay.
    if (err.issue === 'INSTRUMENT_DECLINED') return json(200, { restart: true });
    if (err.issue === 'ORDER_ALREADY_CAPTURED') order = await paypal.getOrder(orderId);
    else throw err;
  }

  const capture = captureOf(order);
  if (!capture || !['COMPLETED', 'PENDING'].includes(capture.status)) {
    console.error('Capture not completed', orderId, JSON.stringify(order));
    return json(402, { error: 'The payment did not go through. Nothing was charged. Please try again.' });
  }

  const paidCents = Math.round(Number(capture.amount?.value) * 100);
  const amountOk = capture.amount?.currency_code === 'USD' && paidCents === reg.total_cents;
  // Anything unexpected (wrong amount, PayPal still reviewing) is flagged for a volunteer to look at.
  const status = amountOk && capture.status === 'COMPLETED' ? 'paid' : 'review';
  if (!amountOk) console.error(`Amount mismatch on ${orderId}: expected ${reg.total_cents}, got ${paidCents}`);

  const updated = await db.updateRegistration(reg.id, {
    status,
    paid_cents: paidCents,
    paypal_capture_id: capture.id,
    payer_email: order.payer?.email_address ?? null,
    paid_at: now().toISOString(),
  });
  const done = { ...reg, ...updated, attendees: reg.attendees };

  if (send && done.email) {
    try {
      await send(
        done.email,
        confirmationEmail({ people: peopleOf(done), shirts: done.shirts ?? [], paidCents, confirmation: capture.id }),
      );
    } catch (err) {
      console.error('Confirmation email failed (registration is still saved):', err);
    }
  }
  return json(200, summary(done));
});
