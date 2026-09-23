-- Asynchronous submission tracking (review §10): the client gets a submissionId back from the
-- 202 and learns later whether it CREATED a new hazard or was MERGED into an existing one.
CREATE TABLE hazard_submissions (
    id                   UUID PRIMARY KEY,
    reporter_id          UUID NOT NULL REFERENCES users(id),
    submitted_type       VARCHAR(40) NOT NULL,
    latitude             DOUBLE PRECISION NOT NULL,
    longitude            DOUBLE PRECISION NOT NULL,
    description          TEXT,
    photo_url            VARCHAR(500),
    severity_answer      VARCHAR(40),
    processing_status    VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    canonical_hazard_id  UUID REFERENCES hazards(id),
    failure_reason       TEXT,
    correlation_id       VARCHAR(64),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at         TIMESTAMPTZ,
    CONSTRAINT ck_submission_status CHECK (processing_status IN ('QUEUED', 'PROCESSING', 'CREATED', 'MERGED', 'FAILED'))
);

CREATE INDEX idx_submission_reporter ON hazard_submissions (reporter_id, created_at DESC);

-- Backfill: hazards reported before this migration become CREATED submissions so they still
-- show up under "My Reports". Reuses the hazard id as the submission id (V1 set them equal).
INSERT INTO hazard_submissions (id, reporter_id, submitted_type, latitude, longitude, description,
                                photo_url, processing_status, canonical_hazard_id, created_at, processed_at)
SELECT id, reporter_id, type, ST_Y(location::geometry), ST_X(location::geometry), description,
       photo_url, 'CREATED', id, created_at, created_at
FROM hazards
WHERE duplicate_of_hazard_id IS NULL;
