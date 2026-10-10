-- Quiet hours: no background (push) alerts during a daily window. Minutes are since local midnight in the stored zone;
-- the window may wrap past midnight (22:00 -> 07:00). Live in-app frames are unaffected.
ALTER TABLE user_notification_preferences
    ADD COLUMN quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320 CHECK (quiet_hours_start_minute BETWEEN 0 AND 1439),
    ADD COLUMN quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420 CHECK (quiet_hours_end_minute BETWEEN 0 AND 1439),
    ADD COLUMN quiet_hours_zone VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila';
