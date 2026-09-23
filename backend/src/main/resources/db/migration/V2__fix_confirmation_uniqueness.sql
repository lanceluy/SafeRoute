-- One current opinion per user per hazard (review §3). V1's UNIQUE(hazard_id, user_id, action)
-- let the same user both VERIFY and DISPUTE a hazard.

-- Drop self-confirmations: the reporter's submission is already their claim (review §4).
DELETE FROM hazard_confirmations c
USING hazards h
WHERE c.hazard_id = h.id AND c.user_id = h.reporter_id;

-- Resolve existing contradictions by keeping each user's most recent opinion.
DELETE FROM hazard_confirmations c
USING hazard_confirmations newer
WHERE c.hazard_id = newer.hazard_id
  AND c.user_id = newer.user_id
  AND (c.created_at, c.id) < (newer.created_at, newer.id);

ALTER TABLE hazard_confirmations DROP CONSTRAINT uq_confirmation;
ALTER TABLE hazard_confirmations ADD CONSTRAINT uq_confirmation_hazard_user UNIQUE (hazard_id, user_id);
ALTER TABLE hazard_confirmations ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE hazard_confirmations ADD CONSTRAINT ck_confirmation_action CHECK (action IN ('VERIFY', 'DISPUTE'));

-- Tracks whether this confirmation has already earned reputation, so a hazard bouncing
-- VERIFIED -> DISPUTED -> VERIFIED can't award it twice.
ALTER TABLE hazard_confirmations ADD COLUMN reputation_awarded BOOLEAN NOT NULL DEFAULT false;

UPDATE hazards h SET confirmation_count =
    (SELECT count(*) FROM hazard_confirmations c WHERE c.hazard_id = h.id AND c.action = 'VERIFY');
