-- Defences against spam and collusion (see docs/ADVERSARIAL_RESULTS.md).
--  - suspended_at: an account that has had reports removed as false can be blocked from contributing.
--  - registration_source: a keyed hash of the IP the account registered from, so the processing consumer can
--    count each source once per hazard (opt-in, saferoute.trust.distinct-sources). Never the raw address.
--  - reward_due_at: reputation for a verified hazard is paid only after it has stood for a while.
ALTER TABLE users
    ADD COLUMN suspended_at TIMESTAMPTZ,
    ADD COLUMN suspension_reason VARCHAR(300),
    ADD COLUMN registration_source VARCHAR(64);

ALTER TABLE hazards
    ADD COLUMN reward_due_at TIMESTAMPTZ;

CREATE INDEX idx_hazards_reward_due ON hazards (reward_due_at)
    WHERE reporter_rewarded = false AND reward_due_at IS NOT NULL;
