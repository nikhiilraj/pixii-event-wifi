-- Opt in only new submissions. Existing pending sessions keep their old release time.
ALTER TABLE registrations ADD COLUMN ad_gate_required INTEGER NOT NULL DEFAULT 0 CHECK (ad_gate_required IN (0, 1));
ALTER TABLE registrations ADD COLUMN ad_started_at INTEGER;
ALTER TABLE registrations ADD COLUMN ad_visible_ms INTEGER NOT NULL DEFAULT 0 CHECK (ad_visible_ms BETWEEN 0 AND 7000);
ALTER TABLE registrations ADD COLUMN ad_completed_at INTEGER;
