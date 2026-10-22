-- Bagdad registration database. Paste this whole file into Supabase Studio → SQL Editor → Run.
-- Safe to run again: it only creates what is missing and replaces the function.
-- Everything is prefixed bagdad_ so it can share a self-hosted Supabase with other apps.

create table if not exists bagdad_registrations (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  -- pending: started checkout but hasn't paid (abandoned carts stay here)
  -- paid:    payment confirmed
  -- review:  paid, but something needs a volunteer to look (amount mismatch, PayPal holding it)
  -- cancelled
  status            text not null default 'pending' check (status in ('pending', 'paid', 'review', 'cancelled')),
  source            text not null default 'online' check (source in ('online', 'mail', 'door')),
  email             text,
  phone             text,
  snack             boolean not null default false,
  shirts            jsonb not null default '[]'::jsonb,   -- [{ id, name, size, qty }]
  donation_cents    integer not null default 0 check (donation_cents >= 0),
  total_cents       integer not null check (total_cents >= 0),
  paid_cents        integer,
  paypal_order_id   text unique,
  paypal_capture_id text,
  payer_email       text,
  paid_at           timestamptz,
  note              text
);

create table if not exists bagdad_attendees (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references bagdad_registrations (id) on delete cascade,
  position        smallint not null,
  first_name      text not null,
  last_initial    text not null,
  role            text not null,
  first_time      boolean not null default false,
  checked_in_at   timestamptz
);

create index if not exists bagdad_attendees_registration_id_idx on bagdad_attendees (registration_id);

-- Only the server (which uses the service role key) can read or write. No public access at all.
alter table bagdad_registrations enable row level security;
alter table bagdad_attendees enable row level security;

-- Saves a registration and its people together, so there is never one without the other.
create or replace function bagdad_create_registration(reg jsonb, people jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := coalesce((reg ->> 'id')::uuid, gen_random_uuid());
begin
  insert into bagdad_registrations (
    id, status, source, email, phone, snack, shirts,
    donation_cents, total_cents, paid_cents, paypal_order_id, paid_at, note
  ) values (
    new_id,
    coalesce(reg ->> 'status', 'pending'),
    coalesce(reg ->> 'source', 'online'),
    nullif(reg ->> 'email', ''),
    nullif(reg ->> 'phone', ''),
    coalesce((reg ->> 'snack')::boolean, false),
    coalesce(reg -> 'shirts', '[]'::jsonb),
    coalesce((reg ->> 'donation_cents')::integer, 0),
    (reg ->> 'total_cents')::integer,
    (reg ->> 'paid_cents')::integer,
    reg ->> 'paypal_order_id',
    (reg ->> 'paid_at')::timestamptz,
    nullif(reg ->> 'note', '')
  );

  insert into bagdad_attendees (registration_id, position, first_name, last_initial, role, first_time)
  select new_id, p.ord::smallint, p.val ->> 'first', p.val ->> 'initial', p.val ->> 'role',
         coalesce((p.val ->> 'firstTime')::boolean, false)
  from jsonb_array_elements(people) with ordinality as p (val, ord);

  return new_id;
end;
$$;

revoke execute on function bagdad_create_registration (jsonb, jsonb) from public, anon, authenticated;
grant execute on function bagdad_create_registration (jsonb, jsonb) to service_role;
