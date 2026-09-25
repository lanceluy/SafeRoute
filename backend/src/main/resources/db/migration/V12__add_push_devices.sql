-- APNs devices for background hazard alerts. Only the latest location is kept (never a history),
-- and PushDeviceService clears it once it is older than saferoute.push.location-max-age.
CREATE TABLE push_devices (
    device_token        VARCHAR(200) PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES users(id),
    latitude            DOUBLE PRECISION,
    longitude           DOUBLE PRECISION,
    location_updated_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_devices_user ON push_devices (user_id);
CREATE INDEX idx_push_devices_location_at ON push_devices (location_updated_at);
