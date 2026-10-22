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

  return {
    /** Inserts a registration and its attendees in one transaction. Returns the registration id. */
    createRegistration: (reg, people) => req('POST', '/rpc/create_registration', { reg, people }),

    findRegistrationByOrder: async (orderId) =>
      (await req('GET', `/registrations?paypal_order_id=${eq(orderId)}&select=*,attendees(*)`))[0] ?? null,

    updateRegistration: async (id, patch) =>
      (await req('PATCH', `/registrations?id=${eq(id)}`, patch, 'return=representation'))[0] ?? null,

    updateAttendee: async (id, patch) =>
      (await req('PATCH', `/attendees?id=${eq(id)}`, patch, 'return=representation'))[0] ?? null,

    listRegistrations: () => req('GET', '/registrations?select=*,attendees(*)&order=created_at.desc'),
  };
}
