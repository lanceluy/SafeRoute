-- Road closures: a moderator/official blocks a road or path (construction, flooding, an event).
-- Shown on every client's map and avoided by route planning while ACTIVE.
CREATE TABLE road_closures (
    id            UUID PRIMARY KEY,
    geom          geography(LineString,4326) NOT NULL,
    name          VARCHAR(120) NOT NULL,
    reason        VARCHAR(500) NOT NULL,
    category      VARCHAR(20)  NOT NULL,
    status        VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
    buffer_meters INTEGER      NOT NULL DEFAULT 15,
    starts_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ends_at       TIMESTAMPTZ,
    created_by    UUID         NOT NULL REFERENCES users(id),
    lifted_by     UUID         REFERENCES users(id),
    lifted_at     TIMESTAMPTZ,
    version       BIGINT       NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_road_closures_geom ON road_closures USING GIST (geom);
CREATE INDEX idx_road_closures_active ON road_closures (status, ends_at);

-- Separate from hazard_audit_log, whose hazard_id references hazards.
CREATE TABLE road_closure_audit (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closure_id  UUID NOT NULL REFERENCES road_closures(id),
    actor_id    UUID REFERENCES users(id),
    action      VARCHAR(20) NOT NULL,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_road_closure_audit ON road_closure_audit (closure_id, created_at);
