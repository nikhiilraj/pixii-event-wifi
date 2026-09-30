-- Additive, rollout-forward enrollment. NULL leaves all legacy records untouched.
ALTER TABLE registrations ADD COLUMN analytics_visit_id TEXT;
ALTER TABLE auth_queue ADD COLUMN analytics_ack_at TEXT;
CREATE TABLE analytics_visits (
  id TEXT PRIMARY KEY,
  attribution_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('wifi','public_web')),
  created_at TEXT NOT NULL,
  suppressed INTEGER NOT NULL DEFAULT 0 CHECK (suppressed IN (0,1)),
  expires_at INTEGER NOT NULL
);
CREATE TABLE analytics_outbox (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  visit_id TEXT NOT NULL REFERENCES analytics_visits(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('wifi_form_viewed','wifi_signup_completed','wifi_connected','wifi_pixii_open_requested')),
  occurred_at TEXT NOT NULL,
  detail TEXT CHECK (detail IN ('click','automatic') OR detail IS NULL),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  delivered_at TEXT,
  last_error TEXT
);
CREATE INDEX analytics_outbox_pending ON analytics_outbox(delivered_at, next_attempt_at);
CREATE INDEX registrations_analytics_visit ON registrations(analytics_visit_id);
CREATE TABLE attribution_handoffs (
  token_hash TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES analytics_visits(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER
);
