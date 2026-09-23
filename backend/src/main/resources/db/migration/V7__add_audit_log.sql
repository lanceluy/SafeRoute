-- Full audit trail (review §29): every edit, vote, status change and moderator action.
CREATE TABLE hazard_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hazard_id       UUID NOT NULL REFERENCES hazards(id),
    actor_id        UUID REFERENCES users(id),
    action          VARCHAR(40) NOT NULL,
    field_name      VARCHAR(40),
    old_value       TEXT,
    new_value       TEXT,
    note            TEXT,
    correlation_id  VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_hazard ON hazard_audit_log (hazard_id, created_at);

-- Backfill so hazards created before this migration still have a readable timeline.
INSERT INTO hazard_audit_log (hazard_id, actor_id, action, new_value, created_at)
SELECT id, reporter_id, 'CREATED', type, created_at FROM hazards;

INSERT INTO hazard_audit_log (hazard_id, actor_id, action, field_name, old_value, new_value, note, created_at)
SELECT hazard_id, changed_by, 'STATUS_CHANGED', 'status', old_status, new_status, note, changed_at
FROM hazard_status_history;
