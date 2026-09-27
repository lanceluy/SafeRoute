-- Municipal workflow: which department is handling a hazard, and how urgently the city ranks it.
-- Priority is the city's call and is separate from severity (how dangerous commuters say it is).
ALTER TABLE hazards ADD COLUMN assigned_department VARCHAR(40);
ALTER TABLE hazards ADD COLUMN municipal_priority VARCHAR(10);
ALTER TABLE hazards ADD COLUMN assigned_at TIMESTAMPTZ;
ALTER TABLE hazards ADD CONSTRAINT ck_hazard_priority CHECK (municipal_priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'));
CREATE INDEX idx_hazard_department ON hazards (assigned_department) WHERE assigned_department IS NOT NULL;

-- A staff member's named queue filters in the portal (tab, filters, sort), as the portal's JSON.
CREATE TABLE saved_views (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(80) NOT NULL,
    config      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_saved_view_name UNIQUE (user_id, name)
);
