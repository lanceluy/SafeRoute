-- Reporters hear what happened to their reports (assigned, resolved, removed, expired) unless they opt out.
ALTER TABLE user_notification_preferences ADD COLUMN report_updates_enabled BOOLEAN NOT NULL DEFAULT true;
