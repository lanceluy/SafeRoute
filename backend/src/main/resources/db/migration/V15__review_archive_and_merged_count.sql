-- Staff review clock (Task 2, revision 4): a report no staff member has acted on within a week is
-- archived out of the portal's working queues. It stays active, so commuters still see it.
ALTER TABLE hazards ADD COLUMN reviewed_at TIMESTAMPTZ;
ALTER TABLE hazards ADD COLUMN reviewed_by UUID REFERENCES users(id);
ALTER TABLE hazards ADD COLUMN archived_at TIMESTAMPTZ;
CREATE INDEX idx_hazard_unreviewed ON hazards (created_at)
    WHERE reviewed_at IS NULL AND archived_at IS NULL AND status IN ('REPORTED', 'VERIFIED', 'DISPUTED');

-- Collated reports (revision 3): how many other submissions were merged into this hazard.
ALTER TABLE hazards ADD COLUMN merged_report_count INT NOT NULL DEFAULT 0;
UPDATE hazards h SET merged_report_count = m.n
FROM (SELECT canonical_hazard_id, count(*) AS n FROM hazard_submissions
      WHERE processing_status = 'MERGED' AND canonical_hazard_id IS NOT NULL
      GROUP BY canonical_hazard_id) m
WHERE m.canonical_hazard_id = h.id;
CREATE INDEX idx_hazard_merged ON hazards (merged_report_count) WHERE merged_report_count > 0;

-- Hazards staff already acted on count as reviewed, so the first archive run doesn't sweep them.
UPDATE hazards h SET reviewed_at = a.at, reviewed_by = a.actor_id
FROM (SELECT DISTINCT ON (hazard_id) hazard_id, actor_id, created_at AS at
      FROM hazard_audit_log
      WHERE action IN ('MODERATOR_RESOLVED', 'MODERATOR_REOPENED', 'MODERATOR_REMOVED',
                       'MUNICIPAL_ASSIGNED', 'MUNICIPAL_PRIORITY')
      ORDER BY hazard_id, created_at) a
WHERE a.hazard_id = h.id;
