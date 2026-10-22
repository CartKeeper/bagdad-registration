# Handoff: Bagdad Mini-Conference registration

You are picking up a small, working codebase. Read this whole file before changing anything.
The README is the operator guide (setup, Coolify, next year); this file is for the engineer.

## What this is

Online registration for the **Bagdad Mini-Conference** (AA & Al-Anon speakers and fellowship,
Nov 6–7, 2026, Relevant Church, Carrollton, KY), run by **Bagdad Retreat Inc**, a small volunteer
nonprofit. It replaces a confusing Yola site + Ecwid shopping cart + mail-in form.

- `/` public page: attendees (first name + last initial), one T-shirt add-on, scholarship donation,
  snack sign-up, pay via **PayPal JS SDK buttons** (Venmo, PayPal, debit/credit card).
- `/admin/` volunteer page (one shared password): attendee list + search, Friday check-in, totals,
  shirt counts and pickup list, mail-in/at-the-door entry, CSV downloads.

Repo: `CartKeeper/bagdad-registration`, branch `main`. Hosted on the owner's **self-hosted Coolify**
with **self-hosted Supabase**, behind a **Cloudflare tunnel**.

## Architecture (deliberately small, keep it that way)

```
server.js            Node http server, no framework: static files from public/ + /api routes
api/*.mjs            config, create-order, capture-order, admin — each exports handle(req, services)
lib/settings.js      ALL year-to-year values (dates, deadline, prices, shirts, lodging code)
lib/order.js         form validation + server-side pricing (buildOrder) — the core rules
lib/paypal.js        PayPal Orders v2 REST (token, create, capture, get) + orderBody()
lib/db.js            Supabase via PostgREST REST calls (no supabase-js)
lib/email.js         optional SMTP confirmation email (nodemailer, the only dependency)
lib/http.js          json(), endpoint() wrapper, servicesFromEnv(), isAdmin()
public/              index.html + register.js, admin/index.html + admin.js, styles.css, images/
supabase/schema.sql  bagdad_registrations, bagdad_attendees, bagdad_create_registration()
tests/               node:test — order, functions (handlers with fakes), server
Dockerfile           node:22-slim, npm ci --omit=dev, port 8080, HEALTHCHECK /api/health
```

Services are injected (`handle(req, services)` with `{ env, db, paypal, send, now }`), so every
handler is testable with fakes (`tests/fakes.js`). Keep that pattern.

### Payment flow

1. Page loads `/api/config` (public settings + PayPal client id).
2. PayPal button → `POST /api/create-order` → `buildOrder()` re-validates and **prices on the server**
   → PayPal order created with `custom_id` = our registration UUID → row saved `status='pending'`
   via the `bagdad_create_registration` RPC (registration + attendees in one transaction).
3. Buyer approves → `POST /api/capture-order` → capture with `PayPal-Request-Id` (idempotent) →
   verify captured amount/currency equals `total_cents` → `paid` (or `review` on mismatch or
   PayPal `PENDING`) → optional confirmation email (failure is logged, never fatal).
4. `INSTRUMENT_DECLINED` → `{ restart: true }` so the page calls `actions.restart()`.
   `ORDER_ALREADY_CAPTURED` → fetch the order and record it.

## Rules you must not break

- **Prices are only ever computed on the server** (`lib/order.js`). The browser total is a preview.
- **Anonymity:** collect first name + last initial only. Never add full names or show contact details
  publicly. Emails/phones appear only on the password-protected admin page.
- **Database objects keep the `bagdad_` prefix** (shared self-hosted Supabase). RLS stays on with no
  public policies; the RPC stays revoked from `public/anon/authenticated`. Only the server, with the
  service role key, touches data.
- **No secrets in the repo.** Config is env vars only (see `.env.example`).
- Escape all user text rendered in HTML (both pages already use `esc()`); CSV export guards formula
  injection. Keep both.
- Keep it boring: no framework, no build step, no new dependencies without a strong reason. Volunteers
  have to be able to run this.
- Year-to-year changes belong in `lib/settings.js` (and schedule/speaker text in `public/index.html`).

## Status

**Done and verified**
- 27 tests pass: `npm install && npm test`.
- Docker image builds and runs; container reported `healthy`.
- `supabase/schema.sql` applied (twice, idempotent) to Postgres 16 configured like Supabase (anon,
  authenticated, service_role roles + Supabase's default grants) behind PostgREST v12:
  anon cannot read, insert, or call the RPC; service role can.
- Real container + real DB: admin list, mail-in add (totals correct), check-in, CSV-backed views.
- Online flow on the real DB with PayPal faked: pending → paid, capture id/payer stored,
  second capture is a no-op (no double charge/email).
- Browser runs (Playwright) of both pages: validation, totals, thank-you screen, admin login/stats,
  check-in, HTML-in-names rendered as text.

**Not verified (no network access to PayPal from the build environment)**
- A real PayPal **sandbox** order end-to-end, including the Venmo button. This is the first thing to do.
- SMTP sending against a real mail server.

## Your tasks

### 1. Deploy (needs the owner for credentials)
- [ ] Run `supabase/schema.sql` in the self-hosted Supabase Studio SQL editor.
- [ ] Coolify: Application from this repo, build pack **Dockerfile**, port **8080**, health check
      `/api/health`, domain `http://register.<domain>` with **force-HTTPS off** (Cloudflare terminates
      TLS; forcing HTTPS in Coolify causes a redirect loop). Add the hostname to the Cloudflare tunnel.
- [ ] Env vars: `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `SUPABASE_URL`
      (gateway URL, no `/rest/v1`), `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`; optional `SMTP_HOST`,
      `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`. The server exits on boot naming any missing
      required var.
- [ ] Sandbox test on a phone and a desktop: PayPal, card, and Venmo (Venmo shows only on US mobile;
      the page adds `buyer-country=US` in sandbox). Confirm the row turns `paid` and shows on `/admin/`.
- [ ] If PayPal rejects `application_context` in `lib/paypal.js` `orderBody()` (it is deprecated in
      Orders v2), move `brand_name` / `shipping_preference: 'NO_SHIPPING'` to
      `payment_source.paypal.experience_context` and confirm Venmo and card still work. Update the test
      in `tests/order.test.js` accordingly.
- [ ] Go live: Live PayPal app keys, `PAYPAL_ENV=live`, one small real payment, refund it.

### 2. Content placeholders in `public/index.html`
- [ ] "Download the registration form" link is `href="#"`. Needs the mail-in form as a **PDF** in
      `public/` (the current one on the old site is a .docx).
- [ ] "Facebook group" link is `href="#"`. The old site uses
      `https://www.facebook.com/groups/417314777378477` — confirm with the owner, then use it.
- [ ] Confirm T-shirt sizes (`SHIRT_SIZES` in `lib/settings.js`, currently S–3XL) with the printer.

### 3. Cut over from the old site (owner decisions; ask before acting)
- Point the old Yola site's registration link and the flyer QR code at the new domain.
- Retire the Ecwid "November 2026 Pre-Registration" product (or the whole store) so people don't
  register in two places. Remove the "Gift card" product.
- The old Yola page has a hidden footer with a speaker's full name and phone number visible in the
  page source. Recommend the owner remove it (anonymity).

## Known limitations (fine for now; don't fix unless asked)
- `create-order` is unauthenticated, so abandoned or spammed checkouts leave `pending` rows. They are
  hidden from counts. If it becomes a problem: rate-limit by IP in `server.js`, and/or a periodic
  `delete from bagdad_registrations where status = 'pending' and created_at < now() - interval '2 days'`.
- One shared admin password, stored in `sessionStorage`; no per-volunteer accounts or audit trail.
- No PayPal webhooks. If a buyer closes the tab after approving but before capture, nothing is charged
  and the row stays `pending`. Captures returned as `PENDING` are marked `review` and are not updated
  later; a volunteer checks them in PayPal.
- Refunds are done in PayPal and aren't reflected in the DB (set `status='cancelled'` by hand if needed).
- The admin "add" form handles only the first shirt design (`SHIRTS[0]`) — fine while there is one.

## Working on it

```bash
npm install
npm test                 # must stay green; add tests with any behavior change
cp .env.example .env     # sandbox keys + Supabase URL/key
npm run dev              # http://localhost:8080
docker build -t bagdad-registration . && docker run --env-file .env -p 8080:8080 bagdad-registration
```

Event facts used in the copy: check-in Fri 3–5 pm and 7:30–8 pm; $30 per person by Oct 30, $35 at the door;
lodging at General Butler State Resort Park, (502) 732-4384, group code **7502**; checks payable to
Bagdad Retreat Inc, 421 Stonehedge Place, Lexington, KY 40517; contact BagdadAA@Outlook.com;
scholarship requests go to Cole W., (859) 797-4120 (as listed on the old public site).
