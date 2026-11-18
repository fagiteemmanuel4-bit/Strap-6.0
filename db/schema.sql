-- =====================================================================
-- STRAP — Neon (Postgres) schema.  Safe to run more than once.
-- Neon console -> SQL Editor -> paste this whole file -> Run.
-- =====================================================================

-- ---------- accounts ----------
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  phone          text,
  name           text not null,
  password_hash  text not null,
  dob            date,
  status         text not null default 'active' check (status in ('active','review','suspended','deleted')),
  review_ticket  text,
  totp_secret    text,                         -- AES-GCM encrypted, never plain text
  totp_enabled   boolean not null default false,
  backup_email   text,
  backup_phone   text,
  activity_pin   text,                         -- scrypt hash of the 4-digit activity PIN
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table if not exists stores (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id),
  bizname     text not null,
  country     text,
  currency    text not null default 'NGN',
  profile     jsonb not null default '{}'::jsonb,   -- address, website, branch count, etc. from sign-up
  order_seq   integer not null default 1000,         -- online order numbers: O-1001, O-1002 ...
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists stores_owner_idx on stores(owner_id);

create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  ip           text,
  ua           text
);
create index if not exists sessions_user_idx on sessions(user_id);

-- Neon Managed Auth sessions that have completed Strap's optional TOTP challenge.
create table if not exists auth_mfa_sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists auth_mfa_sessions_expiry_idx on auth_mfa_sessions(expires_at);

-- ---------- email / SMS verification codes (powered by Neon, no Redis needed) ----------
create table if not exists verification_codes (
  id           bigserial primary key,
  target       text not null,                    -- email address or phone number
  purpose      text not null,                    -- signup | reset | contact | pin
  code_hash    text not null,                    -- HMAC of the code, never the code itself
  attempts     integer not null default 0,
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists vc_lookup_idx on verification_codes(target, purpose, id desc);

create table if not exists rate_limits (
  key       text primary key,
  count     integer not null,
  reset_at  timestamptz not null
);

-- ---------- the dashboard's data, one JSON document per key per store ----------
create table if not exists kv_state (
  store_id    uuid not null references stores(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (store_id, key)
);

-- ---------- uploaded pictures (product photos, profile photo) ----------
create table if not exists media (
  id          text primary key,                  -- sha256 of the bytes, so duplicates are stored once
  store_id    uuid references stores(id) on delete cascade,
  mime        text not null,
  size        integer not null,
  bytes       bytea not null,
  created_at  timestamptz not null default now()
);

-- ---------- billing ----------
create table if not exists subscriptions (
  store_id             uuid primary key references stores(id) on delete cascade,
  plan                 text not null default 'free' check (plan in ('free','premium')),
  status               text not null default 'inactive' check (status in ('inactive','active','past_due','cancelled')),
  currency             text,
  cycle                integer not null default 0,        -- number of paid months so far (drives intro price)
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  card_token           text,                              -- Flutterwave card token, AES-GCM encrypted
  card_last4           text,
  card_brand           text,
  past_due_since       timestamptz,
  updated_at           timestamptz not null default now()
);

create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  tx_ref      text not null unique,
  store_id    uuid not null references stores(id),
  user_id     uuid not null references users(id),
  purpose     text not null default 'subscription',      -- subscription | renewal
  amount      numeric(14,2) not null,
  currency    text not null,
  status      text not null default 'pending' check (status in ('pending','successful','failed')),
  flw_tx_id   text,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create index if not exists payments_store_idx on payments(store_id, created_at desc);

create table if not exists webhook_events (
  id           bigserial primary key,
  provider     text not null,
  event_key    text not null,
  payload      jsonb,
  received_at  timestamptz not null default now(),
  unique (provider, event_key)
);

-- ---------- online store (public) ----------
create table if not exists stores_public (
  store_id         uuid primary key references stores(id) on delete cascade,
  slug             text unique,                          -- e.g. "amaka" for amaka.strap.store
  custom_domain    text unique,
  domain_token     text,
  domain_verified  boolean not null default false,
  config           jsonb not null default '{}'::jsonb,
  catalog          jsonb not null default '[]'::jsonb,   -- products the public storefront may show
  published        boolean not null default true,
  updated_at       timestamptz not null default now()
);

create table if not exists orders (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete cascade,
  order_no     text not null,                            -- O-1001
  tracking     text not null,
  customer     jsonb not null,
  address      text,
  note         text,
  method       text,                                     -- delivery | pickup
  payment      text,                                     -- cod | transfer | link
  payment_ref  text,
  proof        jsonb,                                    -- optional payment proof (<= 2 MB)
  lines        jsonb not null,
  subtotal     numeric(14,2) not null default 0,
  discount     numeric(14,2) not null default 0,
  delivery     numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  promo        text,
  status       text not null default 'new',
  paid         boolean not null default false,
  events       jsonb not null default '[]'::jsonb,
  pulled       boolean not null default false,           -- true once the dashboard has downloaded it
  created_at   timestamptz not null default now(),
  unique (store_id, order_no)
);
create index if not exists orders_store_idx on orders(store_id, created_at desc);
create index if not exists orders_track_idx on orders(tracking);

-- ---------- team, account lifecycle, audit ----------
create table if not exists staff (
  id          text not null,
  store_id    uuid not null references stores(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        text,
  branch_id   text,
  pin_hash    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (store_id, id),
  unique (email)
);

create table if not exists account_deletions (
  id          bigserial primary key,
  user_id     uuid not null,
  store_id    uuid,
  email       text,
  snapshot    jsonb,                                     -- store record kept for reference
  survey      jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists review_requests (
  id          bigserial primary key,
  user_id     uuid not null references users(id),
  ticket      text not null,
  note        text,
  email       text,
  phone       text,
  created_at  timestamptz not null default now()
);

create table if not exists audit_log (
  id          bigserial primary key,
  store_id    uuid,
  user_id     uuid,
  action      text not null,
  meta        jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_store_idx on audit_log(store_id, created_at desc);

-- ---------- housekeeping (optional, run any time) ----------
-- delete from sessions where expires_at < now();
-- delete from verification_codes where created_at < now() - interval '2 days';
-- delete from rate_limits where reset_at < now();
