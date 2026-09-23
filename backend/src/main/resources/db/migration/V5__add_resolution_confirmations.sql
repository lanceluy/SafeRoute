-- Community resolution voting (review §5): normal users can't resolve directly; after enough
-- independent "no longer present" votes the hazard resolves itself.
CREATE TABLE hazard_resolution_votes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hazard_id    UUID NOT NULL REFERENCES hazards(id),
    user_id      UUID NOT NULL REFERENCES users(id),
    action       VARCHAR(20) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_resolution_vote UNIQUE (hazard_id, user_id),
    CONSTRAINT ck_resolution_action CHECK (action IN ('NO_LONGER_PRESENT', 'STILL_PRESENT'))
);
