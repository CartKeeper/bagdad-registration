// POST /api/create-order — checks the form, prices it on the server, opens a PayPal order,
// and saves the registration as "pending" until the payment is captured.

import { randomUUID } from 'node:crypto';
import { buildOrder } from '../lib/order.js';
import { orderBody } from '../lib/paypal.js';
import { endpoint, json, readJson } from '../lib/http.js';

export const handle = endpoint('POST', async (req, { db, paypal, now }) => {
  const order = buildOrder(await readJson(req), { now: now() });
  const id = randomUUID();
  const created = await paypal.createOrder(orderBody(order, id));
  await db.createRegistration(
    {
      id,
      status: 'pending',
      source: 'online',
      email: order.email,
      phone: order.phone,
      snack: order.snack,
      shirts: order.shirts,
      donation_cents: order.donation * 100,
      total_cents: order.totalCents,
      paypal_order_id: created.id,
    },
    order.people,
  );
  return json(200, { id: created.id });
});
