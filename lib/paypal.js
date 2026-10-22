// Minimal PayPal Orders v2 client: create an order, capture it, look it up.

import { EVENT } from './settings.js';
import { dollars } from './order.js';

const BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

export class PayPalError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
  // e.g. INSTRUMENT_DECLINED, ORDER_ALREADY_CAPTURED
  get issue() {
    return this.body?.details?.[0]?.issue;
  }
}

// PayPal limits these text fields to 127 characters.
const clip = (s) => (s.length > 127 ? s.slice(0, 126) + '…' : s);

/** The order body PayPal sees, built only from a server-checked order. */
export function orderBody(order, registrationId) {
  const total = dollars(order.totalCents);
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        custom_id: registrationId,
        description: clip(`${EVENT.name} · ${order.email}`),
        amount: {
          currency_code: 'USD',
          value: total,
          breakdown: { item_total: { currency_code: 'USD', value: total } },
        },
        items: order.items.map((i) => ({
          name: clip(i.name),
          quantity: String(i.qty),
          category: i.category,
          unit_amount: { currency_code: 'USD', value: dollars(i.unitCents) },
        })),
      },
    ],
    application_context: { brand_name: EVENT.org, shipping_preference: 'NO_SHIPPING' },
  };
}

export function paypalClient({ clientId, secret, env = 'sandbox', fetchImpl = fetch }) {
  const base = BASE[env];
  if (!base) throw new Error(`PAYPAL_ENV must be "sandbox" or "live", not "${env}"`);

  async function token() {
    const res = await fetchImpl(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError('PayPal sign-in failed — check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET', res.status, body);
    return body.access_token;
  }

  async function call(method, path, payload, extraHeaders = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(`PayPal ${method} ${path} failed (${res.status})`, res.status, body);
    return body;
  }

  return {
    createOrder: (body) => call('POST', '/v2/checkout/orders', body),
    // The request id makes a repeated capture of the same order safe.
    captureOrder: (id) =>
      call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { 'PayPal-Request-Id': `capture-${id}` }),
    getOrder: (id) => call('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`),
  };
}

/** The (first) capture on an order, or null. */
export function captureOf(order) {
  return order?.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}
