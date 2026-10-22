# Bagdad Mini-Conference registration

Online registration for the Bagdad Mini-Conference: one page where people sign up, add T-shirts and a
scholarship donation, and pay with **Venmo, PayPal, or a debit/credit card**; plus a password-protected
**volunteer page** for the attendee list, Friday check-in, shirt counts, and entering mail-in or at-the-door
registrations.

It's deliberately small: a static page, four short server functions, and two database tables.
It runs on the free tiers of Netlify and Supabase.

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

## One-time setup

You need free accounts at [Supabase](https://supabase.com), [Netlify](https://netlify.com), and the
Bagdad Retreat Inc **PayPal business account** (the one already connected to the Ecwid store).

### 1. Database (Supabase)

1. Create a project (any name, e.g. `bagdad-registration`). Save the database password somewhere safe.
2. Open **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Under **Project Settings → API**, copy the **Project URL** and the **service_role** key (secret).

Row-level security is on with no public policies, so the tables can only be reached through these
server functions.

### 2. PayPal

1. Log in at [developer.paypal.com](https://developer.paypal.com) with the Bagdad Retreat Inc PayPal login.
2. **Apps & Credentials → Sandbox** → create an app. Copy its **Client ID** and **Secret**.
   Sandbox is practice mode with fake money; use it until everything is tested.
3. Later, for real payments, switch to **Live**, create an app there, and use those keys instead.
4. Make sure Venmo is enabled for the account (Account settings → Payment preferences).

### 3. Hosting (Netlify)

1. **Add new site → Import an existing project → GitHub →** `CartKeeper/bagdad-registration`.
   The build settings come from `netlify.toml`; there's no build command.
2. **Site configuration → Environment variables**, add:

   | Variable | Value |
   |---|---|
   | `PAYPAL_ENV` | `sandbox` (later `live`) |
   | `PAYPAL_CLIENT_ID` | from step 2 |
   | `PAYPAL_CLIENT_SECRET` | from step 2 (secret) |
   | `SUPABASE_URL` | from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1 (secret) |
   | `ADMIN_PASSWORD` | a long password for volunteers; change it each year |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | *optional*, for confirmation emails (see below) |

3. Deploy, then open the site address Netlify gives you.

### 4. Test with fake money

1. With `PAYPAL_ENV=sandbox`, register yourself on the site.
2. Pay with a **sandbox personal account** (developer.paypal.com → Sandbox → Accounts has one ready),
   or choose debit/credit card and use a test card from PayPal's developer site.
3. Open `/admin/`, sign in, and check the registration is there; try check-in and a mail-in entry.

### 5. Go live

1. Swap in the **Live** Client ID and Secret, and set `PAYPAL_ENV=live`. Redeploy.
2. Make one small real registration to confirm, then refund it from PayPal if you like.
3. Point the "Register" link and the flyer's QR code at the new address, or connect your own domain under
   **Domain management** in Netlify.

### Confirmation emails (optional)

Without email settings, people still get PayPal's receipt and see a confirmation on screen. To send your
own email (schedule, lodging code 7502, shirt pickup), fill in the `SMTP_*` and `EMAIL_FROM` variables with
any email service that offers SMTP: for example a free Brevo account, or a Gmail account with an
"app password". Replies go to the contact address in `lib/settings.js`. A failed email never loses a
registration.

## Next year

1. Edit **`lib/settings.js`**: event name and dates, deadline (`closesAt` is in UTC; end of day Eastern is
   04:00 UTC the next day during daylight time), prices, door price, lodging code, shirt designs and sizes.
2. Edit the schedule, speakers and mail-in text in **`public/index.html`**.
3. Put the new shirt image in `public/images/` and point `SHIRTS[].image` at it.
4. Start fresh: in Supabase SQL Editor run `truncate attendees, registrations;` (after downloading last
   year's CSVs from the volunteer page if you want to keep them).
5. Change `ADMIN_PASSWORD`.

## For developers

```bash
npm install
npm test            # unit + function tests (no network, PayPal and the database are faked)
cp .env.example .env
npm run dev         # needs the Netlify CLI: npm i -g netlify-cli
```

```
public/                 the two pages (plain HTML, CSS, JS)
netlify/functions/      config, create-order, capture-order, admin
lib/settings.js         everything that changes year to year
lib/order.js            form checking + server-side pricing
lib/paypal.js           PayPal Orders v2 calls
lib/db.js               Supabase (PostgREST) calls
lib/email.js            confirmation email
supabase/schema.sql     tables + the create_registration function
tests/                  node:test suites
```

### Privacy

The page only asks for a first name and last initial. Emails and phone numbers are visible only on the
password-protected volunteer page and in Supabase. Don't share the CSV downloads beyond the volunteers who
need them.
