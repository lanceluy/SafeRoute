-- Transactional outbox. Every Kafka message (command or outcome) is written here in the same
-- transaction as the state change that caused it, and a relay publishes it afterwards. A crash
-- between commit and publish, or a slow broker acknowledgement, can therefore delay a message
-- but never lose it or turn an accepted report into a false FAILED.
CREATE TABLE outbox_events (
    seq           BIGSERIAL PRIMARY KEY,
    event_id      UUID NOT NULL UNIQUE,
    topic         VARCHAR(120) NOT NULL,
    message_key   VARCHAR(80) NOT NULL,
    payload_type  VARCHAR(200) NOT NULL,
    payload       JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    -- Set only for rows that can never be published (unreadable payload); they are kept for
    -- inspection instead of blocking the queue.
    failed_at     TIMESTAMPTZ
);

CREATE INDEX idx_outbox_pending ON outbox_events (seq) WHERE published_at IS NULL AND failed_at IS NULL;

-- Idempotent HTTP reporting: a client-generated key per logical report, so a retry after an
-- ambiguous network failure returns the original submission instead of creating another.
ALTER TABLE hazard_submissions ADD COLUMN client_request_id UUID;
CREATE UNIQUE INDEX uq_submission_client_request
    ON hazard_submissions (reporter_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- When the reporter actually saw the hazard (e.g. a report queued offline). Freshness and
-- expiry are measured from this, not from when the server happened to process the report.
ALTER TABLE hazard_submissions ADD COLUMN observed_at TIMESTAMPTZ;

-- Content revision: incremented when a hazard's assessed content changes (a moderator reopens it,
-- or its type/location/severity is edited). Community commands carry the revision they were
-- accepted under and are ignored if the hazard has moved on, so a vote can't be applied to
-- content its author never saw. Each opinion also records the revision it assessed.
ALTER TABLE hazards ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hazard_confirmations ADD COLUMN hazard_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hazard_resolution_votes ADD COLUMN hazard_revision INTEGER NOT NULL DEFAULT 0;

-- Photo ownership: only the uploader can attach an upload to a report, and uploads that are
-- never attached are cleaned up.
CREATE TABLE uploads (
    url          VARCHAR(500) PRIMARY KEY,
    owner_id     UUID NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    attached_at  TIMESTAMPTZ
);

CREATE INDEX idx_uploads_unattached ON uploads (created_at) WHERE attached_at IS NULL;

-- Audit trail for privilege changes (moderator provisioning).
CREATE TABLE role_grants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    old_role    VARCHAR(30) NOT NULL,
    new_role    VARCHAR(30) NOT NULL,
    granted_by  UUID REFERENCES users(id),
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
