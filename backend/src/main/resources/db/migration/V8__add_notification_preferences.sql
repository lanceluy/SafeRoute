-- Per-user alert preferences (review §35, §53) and a reputation ledger for the Profile
-- screen's "recent activity" (review §7, §34).
CREATE TABLE user_notification_preferences (
    user_id                         UUID PRIMARY KEY REFERENCES users(id),
    radius_meters                   INTEGER NOT NULL DEFAULT 400,
    flooding_enabled                BOOLEAN NOT NULL DEFAULT true,
    broken_sidewalk_enabled         BOOLEAN NOT NULL DEFAULT true,
    open_manhole_enabled            BOOLEAN NOT NULL DEFAULT true,
    poor_lighting_enabled           BOOLEAN NOT NULL DEFAULT true,
    accessibility_barrier_enabled   BOOLEAN NOT NULL DEFAULT true,
    construction_enabled            BOOLEAN NOT NULL DEFAULT true,
    path_obstruction_enabled        BOOLEAN NOT NULL DEFAULT true,
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_pref_radius CHECK (radius_meters BETWEEN 100 AND 5000)
);

CREATE TABLE reputation_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    hazard_id   UUID REFERENCES hazards(id),
    delta       INTEGER NOT NULL,
    reason      VARCHAR(40) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reputation_user ON reputation_events (user_id, created_at DESC);
