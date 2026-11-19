-- Strap compatibility migration: legacy Neon schema -> Strap-6.0
-- Additive and idempotent. Preserves the legacy users/businesses/account_data rows.
-- Apply once to the target Neon branch after taking a backup. Do NOT drop legacy tables.

ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dob date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS review_ticket text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_pin text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE users
SET name = COALESCE(NULLIF(BTRIM(name), ''), NULLIF(BTRIM(full_name), ''), split_part(email, '@', 1))
WHERE name IS NULL OR BTRIM(name) = '';
ALTER TABLE users ALTER COLUMN name SET NOT NULL;

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  bizname text NOT NULL,
  country text,
  currency text NOT NULL DEFAULT 'NGN',
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_seq integer NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
INSERT INTO stores(id, owner_id, bizname, country, currency, profile, created_at)
SELECT id, owner_id, name, country, currency, profile, created_at
FROM businesses ON CONFLICT (id) DO NOTHING;
CREATE INDEX IF NOT EXISTS stores_owner_idx ON stores(owner_id);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ua text;

CREATE TABLE IF NOT EXISTS auth_mfa_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_mfa_sessions_expiry_idx ON auth_mfa_sessions(expires_at);

CREATE TABLE IF NOT EXISTS verification_codes (
  id bigserial PRIMARY KEY,
  target text NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vc_lookup_idx ON verification_codes(target, purpose, id DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_state (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(store_id, key)
);
CREATE TABLE IF NOT EXISTS media (
  id text PRIMARY KEY,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  mime text NOT NULL,
  size integer NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')),
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','active','past_due','cancelled')),
  currency text,
  cycle integer NOT NULL DEFAULT 0,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  card_token text,
  card_last4 text,
  card_brand text,
  past_due_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO subscriptions(store_id, plan, status, currency)
SELECT id, 'free', 'inactive', currency FROM stores
ON CONFLICT (store_id) DO NOTHING;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS flw_tx_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at timestamptz;
UPDATE payments p SET store_id = s.id
FROM stores s WHERE p.store_id IS NULL AND s.owner_id = p.user_id;
CREATE INDEX IF NOT EXISTS payments_store_idx ON payments(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  event_key text NOT NULL,
  payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, event_key)
);
CREATE TABLE IF NOT EXISTS stores_public (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  slug text UNIQUE,
  custom_domain text UNIQUE,
  domain_token text,
  domain_verified boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  catalog jsonb NOT NULL DEFAULT '[]'::jsonb,
  published boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  tracking text NOT NULL,
  customer jsonb NOT NULL,
  address text,
  note text,
  method text,
  payment text,
  payment_ref text,
  proof jsonb,
  lines jsonb NOT NULL,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  delivery numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  promo text,
  status text NOT NULL DEFAULT 'new',
  paid boolean NOT NULL DEFAULT false,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  pulled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, order_no)
);
CREATE INDEX IF NOT EXISTS orders_store_idx ON orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_track_idx ON orders(tracking);

CREATE TABLE IF NOT EXISTS staff (
  id text NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  role text,
  branch_id text,
  pin_hash text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(store_id, id),
  UNIQUE(email)
);
CREATE TABLE IF NOT EXISTS account_deletions (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  store_id uuid,
  email text,
  snapshot jsonb,
  survey jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS review_requests (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  ticket text NOT NULL,
  note text,
  email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  store_id uuid,
  user_id uuid,
  action text NOT NULL,
  meta jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_store_idx ON audit_log(store_id, created_at DESC);

-- Preserve legacy application state in the new per-store key/value format.
INSERT INTO kv_state(store_id, key, value)
SELECT s.id, 'strap.v1', COALESCE(ad.data->'store', '{}'::jsonb)
FROM account_data ad JOIN stores s ON s.owner_id = ad.user_id
ON CONFLICT (store_id, key) DO NOTHING;
INSERT INTO kv_state(store_id, key, value)
SELECT s.id, 'strap.f1', COALESCE(ad.data->'features', '{}'::jsonb)
FROM account_data ad JOIN stores s ON s.owner_id = ad.user_id
ON CONFLICT (store_id, key) DO NOTHING;
INSERT INTO kv_state(store_id, key, value)
SELECT s.id, 'strap.f1.items.b0', COALESCE(ad.data->'features'->'itemsByBranch'->'b0', '[]'::jsonb)
FROM account_data ad JOIN stores s ON s.owner_id = ad.user_id
WHERE jsonb_typeof(ad.data->'features'->'itemsByBranch'->'b0') = 'array'
ON CONFLICT (store_id, key) DO NOTHING;
