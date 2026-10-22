# Bagdad Mini-Conference registration

Online registration for the Bagdad Mini-Conference: one page where people sign up, add T-shirts and a
scholarship donation, and pay with **Venmo, PayPal, or a debit/credit card**; plus a password-protected
**volunteer page** for the attendee list, Friday check-in, shirt counts, and entering mail-in or at-the-door
registrations.

It's deliberately small: one Node process (no framework, one dependency), two database tables, and a
Dockerfile for Coolify.

| Page | Who uses it |
|---|---|
| `/` | Attendees: register and pay |
| `/admin/` | Volunteers: list, check-in, shirts, mail-in/door entries, CSV downloads |

## How it works

1. The page loads its prices and options from `/api/config`.
2. When someone taps a PayPal/Venmo/card button, `/api/create-order` re-checks the form, **works out the
   price on the server** (the page's total is only a preview), opens a PayPal order, and saves the
   registration as *pending*.
3. After they approve the payment, `/api/capture-order` takes the payment, checks PayPal charged exactly
   the expected amount, marks the registration *paid* and (optionally) emails a confirmation with the
   schedule and the lodging code. Anything unexpected is marked *review* for a volunteer to check.
4. People who start checkout but never pay stay *pending* and don't count anywhere.

PayPal also emails every payer a receipt, and each PayPal transaction lists who it covers.

## Deploying on Coolify (self-hosted)

You need the self-hosted Supabase, Coolify, and the Bagdad Retreat Inc **PayPal business account**
(the one already connected to the Ecwid store).

### 1. Database (self-hosted Supabase)

1. In Supabase Studio open **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and
   click **Run**. It is safe to run again.
2. Everything is named `bagdad_…` (two tables and one function), so it can share an instance with other
   apps without clashing.
3. You need the instance's public URL (the Kong gateway, e.g. `https://supabase.example.com`) and its
   **service_role** key (`SERVICE_ROLE_KEY` in the Supabase stack's environment). The key is secret and is
   only used by this server.

Row-level security is on with no public policies, and the save function isn't callable by the public
roles, so the data is only reachable through this server.

### 2. PayPal

1. Log in at [developer.paypal.com](https://developer.paypal.com) with the Bagdad Retreat Inc PayPal login.
2. **Apps & Credentials → Sandbox** → create an app. Copy its **Client ID** and **Secret**.
   Sandbox is practice mode with fake money; use it until everything is tested.
3. Later, for real payments, switch to **Live**, create an app there, and use those keys instead.
4. Make sure Venmo is enabled for the account (Account settings → Payment preferences).

### 3. Coolify

1. **New Resource → Application →** this GitHub repo (via the GitHub App or as a private repo), branch `main`.
2. **Build pack: Dockerfile.** The image has no compile step (it just installs one small package), so it is
   fine to build on the Coolify box itself.
3. **Ports exposes: `8080`.** Health check path: `/api/health` (the Dockerfile also declares a health check).
4. **Domain:** e.g. `http://register.<your-domain>`. If Cloudflare terminates TLS through a tunnel (as with
   the other apps on this box), use the **`http://`** scheme and leave **force HTTPS off** in Coolify;
   forcing HTTPS there causes a redirect loop. Add the matching public hostname in the Cloudflare tunnel.
5. **Environment variables** (runtime, not build arguments):

   | Variable | Value |
   |---|---|
   | `PAYPAL_ENV` | `sandbox` (later `live`) |
   | `PAYPAL_CLIENT_ID` | from step 2 |
   | `PAYPAL_CLIENT_SECRET` | from step 2 (secret) |
   | `SUPABASE_URL` | the Supabase gateway URL from step 1 (no trailing `/rest/v1`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1 (secret) |
   | `ADMIN_PASSWORD` | a long password for volunteers; change it each year |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | *optional*, for confirmation emails (see below) |

   If a required variable is missing, the container logs which one and exits, so the deploy fails
   visibly instead of serving a broken page.
6. Deploy. Any number of replicas is fine; the app keeps no state in the process.

If the app and Supabase run on the same Coolify server, `SUPABASE_URL` can be the internal address of the
Supabase gateway instead of the public one, as long as the app's container can reach it.

### 4. Test with fake money

1. With `PAYPAL_ENV=sandbox`, register yourself on the site.
2. Pay with a **sandbox personal account** (developer.paypal.com → Sandbox → Accounts has one ready),
   or choose debit/credit card and use a test card from PayPal's developer site.
3. Open `/admin/`, sign in, and check the registration is there; try check-in and a mail-in entry.

### 5. Go live

1. Swap in the **Live** Client ID and Secret, set `PAYPAL_ENV=live`, and redeploy.
2. Make one small real registration to confirm, then refund it from PayPal if you like.
3. Point the website's "Register" link and the flyer's QR code at the new address.

### Confirmation emails (optional)

Without email settings, people still get PayPal's receipt and see a confirmation on screen. To send your
own email (schedule, lodging code 7502, shirt pickup), fill in the `SMTP_*` and `EMAIL_FROM` variables with
any SMTP service: for example a free Brevo account, a Gmail account with an "app password", or a mail
server you already run. Replies go to the contact address in `lib/settings.js`. A failed email never
loses a registration.

## Next year

1. Edit **`lib/settings.js`**: event name and dates, deadline (`closesAt` is in UTC; end of day Eastern is
   04:00 UTC the next day during daylight time), prices, door price, lodging code, shirt designs and sizes.
2. Edit the schedule, speakers and mail-in text in **`public/index.html`**.
3. Put the new shirt image in `public/images/` and point `SHIRTS[].image` at it.
4. Start fresh: in Supabase SQL Editor run `truncate bagdad_attendees, bagdad_registrations;` (after
   downloading last year's CSVs from the volunteer page if you want to keep them).
5. Change `ADMIN_PASSWORD` in Coolify and redeploy.

## For developers

```bash
npm install
npm test                 # unit, function and server tests (PayPal and the database are faked)
cp .env.example .env     # fill in sandbox keys and a Supabase URL/key
npm run dev              # http://localhost:8080, restarts on changes

docker build -t bagdad-registration .
docker run --env-file .env -p 8080:8080 bagdad-registration
```

```
server.js               the whole app: static files from public/ + the /api routes
api/                    config, create-order, capture-order, admin (each exports handle(req, services))
lib/settings.js         everything that changes year to year
lib/order.js            form checking + server-side pricing
lib/paypal.js           PayPal Orders v2 calls
lib/db.js               Supabase (PostgREST) calls
lib/email.js            confirmation email
public/                 the two pages (plain HTML, CSS, JS)
supabase/schema.sql     tables + the bagdad_create_registration function
tests/                  node:test suites
```

### Privacy

The page only asks for a first name and last initial. Emails and phone numbers are visible only on the
password-protected volunteer page and in Supabase. Don't share the CSV downloads beyond the volunteers who
need them.
