-- Six more hazard types (traffic signal outage, fallen tree, vehicle blocking the sidewalk, road debris,
-- crosswalk issue, safety concern). hazards.type is a plain VARCHAR, so only the per-user alert
-- preferences need new columns; existing users get every new type switched on, like the originals.
ALTER TABLE user_notification_preferences
    ADD COLUMN traffic_signal_outage_enabled    BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN fallen_tree_enabled              BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN vehicle_blocking_sidewalk_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN road_debris_enabled              BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN crosswalk_issue_enabled          BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN safety_concern_enabled           BOOLEAN NOT NULL DEFAULT true;
