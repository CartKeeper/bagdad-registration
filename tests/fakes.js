export const BEFORE = new Date('2026-10-20T12:00:00Z');

// In-memory stand-ins for Supabase and PayPal.
export function fakes({ capture } = {}) {
  const regs = new Map();
  const sent = [];
  let n = 0;
  const db = {
    async createRegistration(reg, people) {
      const id = reg.id ?? `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
      const attendees = people.map((p, i) => ({
        id: `${id.slice(0, 24)}${String(i + 1).padStart(12, '0')}`,
        registration_id: id, position: i + 1, first_name: p.first, last_initial: p.initial,
        role: p.role, first_time: p.firstTime, checked_in_at: null,
      }));
      regs.set(id, { created_at: BEFORE.toISOString(), paid_cents: null, ...reg, id, attendees });
      return id;
    },
    async findRegistrationByOrder(orderId) {
      return [...regs.values()].find((r) => r.paypal_order_id === orderId) ?? null;
    },
    async updateRegistration(id, patch) {
      const r = regs.get(id);
      Object.assign(r, patch);
      const { attendees, ...row } = r;
      return row;
    },
    async updateAttendee(id, patch) {
      for (const r of regs.values()) for (const a of r.attendees) if (a.id === id) return Object.assign(a, patch);
      return null;
    },
    async listRegistrations() {
      return [...regs.values()];
    },
  };
  const paypal = {
    created: [],
    captures: 0,
    async createOrder(body) {
      this.created.push(body);
      return { id: `ORDER${this.created.length}ABC` };
    },
    async captureOrder(id) {
      this.captures++;
      if (capture) return capture(id, this);
      const value = this.created.at(-1).purchase_units[0].amount.value;
      return completed(value);
    },
    async getOrder() {
      return completed(this.created.at(-1).purchase_units[0].amount.value);
    },
  };
  const services = {
    env: { PAYPAL_CLIENT_ID: 'client-abc', PAYPAL_ENV: 'sandbox', ADMIN_PASSWORD: 'let-me-in' },
    db, paypal,
    send: async (to, message) => sent.push({ to, ...message }),
    now: () => BEFORE,
  };
  return { services, regs, sent, paypal };
}

export const completed = (value, status = 'COMPLETED') => ({
  status: 'COMPLETED',
  payer: { email_address: 'payer@example.com' },
  purchase_units: [{ payments: { captures: [{ id: 'CAP123', status, amount: { currency_code: 'USD', value } }] } }],
});
