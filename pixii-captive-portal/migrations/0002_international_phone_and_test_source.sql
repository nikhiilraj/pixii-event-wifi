ALTER TABLE registrations ADD COLUMN phone_country TEXT;

ALTER TABLE registrations ADD COLUMN submission_source TEXT NOT NULL DEFAULT 'wifi'
  CHECK (submission_source IN ('wifi', 'team_test'));

CREATE INDEX registrations_source_created_idx
  ON registrations(submission_source, created_at);
