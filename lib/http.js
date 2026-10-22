import { createHash, timingSafeEqual } from 'node:crypto';
import { ValidationError } from './order.js';
import { dbClient } from './db.js';
import { paypalClient } from './paypal.js';
import { mailer } from './email.js';

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const REQUIRED = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

/** Real services from environment variables. Tests pass their own. */
export function servicesFromEnv(env = process.env, fetchImpl = fetch) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  return {
    env,
    db: dbClient({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl }),
    paypal: paypalClient({
      clientId: env.PAYPAL_CLIENT_ID,
      secret: env.PAYPAL_CLIENT_SECRET,
      env: env.PAYPAL_ENV || 'sandbox',
      fetchImpl,
    }),
    send: mailer(env),
    now: () => new Date(),
  };
}

/** Wraps a handler(req, services): form mistakes become 400s, anything else a logged 500. */
export function endpoint(method, handler) {
  return async (req, services) => {
    if (req.method !== method) return json(405, { error: 'Method not allowed' });
    try {
      return await handler(req, services ?? servicesFromEnv());
    } catch (err) {
      if (err instanceof ValidationError) return json(400, { error: err.message });
      console.error(err);
      return json(500, { error: `Something went wrong on our end. Nothing was charged. Please try again or email us.` });
    }
  };
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new ValidationError('The form could not be read.');
  }
}

/** Constant-time check of "Authorization: Bearer <ADMIN_PASSWORD>". */
export function isAdmin(req, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) return false;
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const h = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}
