PRAGMA foreign_keys = ON;

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  created_at TEXT NOT NULL
);

CREATE TABLE routers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  profile_id TEXT NOT NULL,
  gateway_name TEXT NOT NULL UNIQUE,
  gateway_hash TEXT NOT NULL UNIQUE CHECK (length(gateway_hash) = 64),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE bootstrap_tokens (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  router_id TEXT NOT NULL REFERENCES routers(id),
  profile_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  exchange_count INTEGER NOT NULL DEFAULT 0 CHECK (exchange_count BETWEEN 0 AND 2),
  first_exchanged_at TEXT,
  last_exchanged_at TEXT
);

CREATE TABLE registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  router_id TEXT NOT NULL REFERENCES routers(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  consent_email_marketing INTEGER NOT NULL CHECK (consent_email_marketing = 1),
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  authorization_status TEXT NOT NULL CHECK (authorization_status IN ('pending','acknowledged','expired','failed')),
  form_idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE auth_queue (
  rhid TEXT PRIMARY KEY CHECK (length(rhid) = 64),
  registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
  gateway_hash TEXT NOT NULL,
  auth_record TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','delivered','acknowledged','expired')),
  delivery_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  acknowledged_at TEXT
);

CREATE INDEX registrations_event_created_idx ON registrations(event_id, created_at);
CREATE INDEX registrations_email_idx ON registrations(email_normalized);
CREATE INDEX registrations_status_idx ON registrations(authorization_status);
CREATE INDEX auth_queue_gateway_state_created_idx ON auth_queue(gateway_hash, state, created_at);
