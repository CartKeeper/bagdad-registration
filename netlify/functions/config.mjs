// GET /api/config — public settings the registration page needs (no secrets).

import { EVENT, PRICES, SHIRTS, SHIRT_SIZES, ROLES, LIMITS } from '../../lib/settings.js';
import { isOpen } from '../../lib/order.js';
import { endpoint, json } from '../../lib/http.js';

export const handle = endpoint('GET', async (req, { env, now }) =>
  json(200, {
    paypalClientId: env.PAYPAL_CLIENT_ID,
    paypalEnv: env.PAYPAL_ENV || 'sandbox',
    open: isOpen(now()),
    event: EVENT,
    prices: PRICES,
    shirts: SHIRTS,
    sizes: SHIRT_SIZES,
    roles: ROLES,
    limits: LIMITS,
  }),
);

export default (req) => handle(req);
export const config = { path: '/api/config' };
