-- Expand source values without rebuilding registrations or disturbing the
-- auth_queue foreign key. Retain the original constrained column for recovery.
ALTER TABLE registrations RENAME COLUMN submission_source TO submission_source_legacy;

ALTER TABLE registrations ADD COLUMN submission_source TEXT NOT NULL DEFAULT 'wifi'
  CHECK (submission_source IN ('wifi', 'team_test', 'public_web'));

UPDATE registrations SET submission_source = submission_source_legacy;

CREATE INDEX registrations_source_created_v2_idx
  ON registrations(submission_source, created_at);
