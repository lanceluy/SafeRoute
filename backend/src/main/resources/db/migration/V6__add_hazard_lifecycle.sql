-- DISPUTED / EXPIRED lifecycle, expiry, structured severity (review §8, §9, §27).
ALTER TABLE hazards ADD COLUMN dispute_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hazards ADD COLUMN last_confirmed_at TIMESTAMPTZ;
ALTER TABLE hazards ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE hazards ADD COLUMN severity_answer VARCHAR(40);
ALTER TABLE hazards ADD COLUMN reporter_rewarded BOOLEAN NOT NULL DEFAULT false;
-- Optimistic locking: consumers and moderators can race on the same hazard row.
ALTER TABLE hazards ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

UPDATE hazards h SET dispute_count =
    (SELECT count(*) FROM hazard_confirmations c WHERE c.hazard_id = h.id AND c.action = 'DISPUTE');

UPDATE hazards SET last_confirmed_at = updated_at;

-- Mirrors the default saferoute.hazard.expiry policy in application.yml.
UPDATE hazards SET expires_at = updated_at + CASE type
    WHEN 'FLOODING' THEN interval '12 hours'
    WHEN 'OPEN_MANHOLE' THEN interval '7 days'
    WHEN 'POOR_LIGHTING' THEN interval '30 days'
    WHEN 'BROKEN_SIDEWALK' THEN interval '45 days'
    WHEN 'ACCESSIBILITY_BARRIER' THEN interval '90 days'
    ELSE interval '3 days'
END;

ALTER TABLE hazards ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE hazards ALTER COLUMN last_confirmed_at SET NOT NULL;
ALTER TABLE hazards ALTER COLUMN last_confirmed_at SET DEFAULT now();

CREATE INDEX idx_hazard_active_expiry ON hazards (expires_at)
    WHERE status IN ('REPORTED', 'VERIFIED', 'DISPUTED');
CREATE INDEX idx_hazard_reporter ON hazards (reporter_id, created_at DESC);
