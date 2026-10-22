// Tiny Supabase (PostgREST) client. Uses the service role key, so it only ever runs on the server.

export function dbClient({ url, key, fetchImpl = fetch }) {
  const rest = `${url.replace(/\/+$/, '')}/rest/v1`;

  async function req(method, path, body, prefer) {
    const res = await fetchImpl(`${rest}${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new Error(`Database ${method} ${path.split('?')[0]} failed (${res.status}): ${data?.message ?? text}`);
    }
    return data;
  }

  const eq = (v) => `eq.${encodeURIComponent(v)}`;
  // Embeds each registration's people as `attendees`.
  const WITH_ATTENDEES = '*,attendees:bagdad_attendees(*)';

  return {
    /** Inserts a registration and its attendees in one transaction. Returns the registration id. */
    createRegistration: (reg, people) => req('POST', '/rpc/bagdad_create_registration', { reg, people }),

    findRegistrationByOrder: async (orderId) =>
      (await req('GET', `/bagdad_registrations?paypal_order_id=${eq(orderId)}&select=${WITH_ATTENDEES}`))[0] ?? null,

    updateRegistration: async (id, patch) =>
      (await req('PATCH', `/bagdad_registrations?id=${eq(id)}`, patch, 'return=representation'))[0] ?? null,

    updateAttendee: async (id, patch) =>
      (await req('PATCH', `/bagdad_attendees?id=${eq(id)}`, patch, 'return=representation'))[0] ?? null,

    listRegistrations: () => req('GET', `/bagdad_registrations?select=${WITH_ATTENDEES}&order=created_at.desc`),
  };
}
