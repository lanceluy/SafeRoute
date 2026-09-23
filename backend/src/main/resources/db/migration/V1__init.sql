CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255) NOT NULL UNIQUE,
    password_hash     VARCHAR(255) NOT NULL,
    display_name      VARCHAR(120) NOT NULL,
    reputation_score  INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hazards (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                  VARCHAR(40) NOT NULL,
    location              geography(Point, 4326) NOT NULL,
    description           TEXT,
    photo_url             VARCHAR(500),
    status                VARCHAR(20) NOT NULL DEFAULT 'REPORTED',
    severity              VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    confirmation_count    INTEGER NOT NULL DEFAULT 0,
    reporter_id           UUID NOT NULL REFERENCES users(id),
    duplicate_of_hazard_id UUID REFERENCES hazards(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ
);

CREATE INDEX idx_hazard_location ON hazards USING GIST (location);
CREATE INDEX idx_hazard_status ON hazards (status);
CREATE INDEX idx_hazard_type ON hazards (type);

CREATE TABLE hazard_confirmations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hazard_id    UUID NOT NULL REFERENCES hazards(id),
    user_id      UUID NOT NULL REFERENCES users(id),
    action       VARCHAR(10) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_confirmation UNIQUE (hazard_id, user_id, action)
);

CREATE TABLE hazard_status_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hazard_id    UUID NOT NULL REFERENCES hazards(id),
    old_status   VARCHAR(20),
    new_status   VARCHAR(20) NOT NULL,
    changed_by   UUID REFERENCES users(id),
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    note         TEXT
);

CREATE INDEX idx_hazard_status_history_hazard ON hazard_status_history (hazard_id);
