// /api/admin — the volunteer page. Requires "Authorization: Bearer <ADMIN_PASSWORD>".
//   GET                                  every registration with its attendees
//   POST { action: 'checkin', attendeeId, checkedIn }
//   POST { action: 'add', source: 'mail' | 'door', note, ...same fields as the public form }

import { EVENT, PRICES } from '../../lib/settings.js';
import { ValidationError, buildOrder } from '../../lib/order.js';
import { endpoint, isAdmin, json, readJson } from '../../lib/http.js';

const UUID = /^[0-9a-f-]{36}$/i;

async function handleAdmin(req, { env, db, now }) {
  if (!isAdmin(req, env)) return json(401, { error: 'Wrong password.' });

  if (req.method === 'GET') return json(200, { registrations: await db.listRegistrations() });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const body = await readJson(req);

  if (body.action === 'checkin') {
    if (!UUID.test(String(body.attendeeId))) throw new ValidationError('Unknown attendee.');
    const attendee = await db.updateAttendee(body.attendeeId, {
      checked_in_at: body.checkedIn ? now().toISOString() : null,
    });
    if (!attendee) throw new ValidationError('Unknown attendee.');
    return json(200, { attendee });
  }

  if (body.action === 'add') {
    const source = body.source === 'door' ? 'door' : 'mail';
    const order = buildOrder(body, {
      now: now(),
      ignoreDeadline: true,
      requireEmail: false,
      registrationPrice: source === 'door' ? EVENT.doorPrice : PRICES.registration,
    });
    const note = String(body.note ?? '').slice(0, 300);
    const id = await db.createRegistration(
      {
        status: 'paid',
        source,
        email: order.email || null,
        phone: order.phone,
        snack: order.snack,
        shirts: order.shirts,
        donation_cents: order.donation * 100,
        total_cents: order.totalCents,
        paid_cents: order.totalCents,
        paid_at: now().toISOString(),
        note,
      },
      order.people,
    );
    return json(200, { id, totalCents: order.totalCents });
  }

  throw new ValidationError('Unknown action.');
}

// The admin endpoint answers both GET and POST, so it checks the method itself.
const get = endpoint('GET', handleAdmin);
const post = endpoint('POST', handleAdmin);
export const handle = (req, services) => (req.method === 'GET' ? get : post)(req, services);

export default (req) => handle(req);
export const config = { path: '/api/admin' };
