package com.saferoute.backend.hazard;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;

/**
 * How long a hazard stays on the map without a fresh confirmation. Every VERIFY or
 * "still here" vote pushes {@code expiresAt} out again.
 */
@ConfigurationProperties(prefix = "saferoute.hazard.expiry")
public class ExpiryPolicy {

    private Map<HazardType, Duration> ttl = new EnumMap<>(Map.ofEntries(
            Map.entry(HazardType.FLOODING, Duration.ofHours(12)),
            Map.entry(HazardType.PATH_OBSTRUCTION, Duration.ofHours(24)),
            Map.entry(HazardType.CONSTRUCTION, Duration.ofDays(3)),
            Map.entry(HazardType.OPEN_MANHOLE, Duration.ofDays(7)),
            Map.entry(HazardType.POOR_LIGHTING, Duration.ofDays(30)),
            Map.entry(HazardType.BROKEN_SIDEWALK, Duration.ofDays(45)),
            Map.entry(HazardType.ACCESSIBILITY_BARRIER, Duration.ofDays(90)),
            // Short-lived, situational: a parked car or a spill is gone within hours.
            Map.entry(HazardType.VEHICLE_BLOCKING_SIDEWALK, Duration.ofHours(6)),
            Map.entry(HazardType.TRAFFIC_SIGNAL_OUTAGE, Duration.ofHours(12)),
            Map.entry(HazardType.ROAD_DEBRIS, Duration.ofHours(12)),
            Map.entry(HazardType.SAFETY_CONCERN, Duration.ofHours(12)),
            Map.entry(HazardType.FALLEN_TREE, Duration.ofDays(2)),
            // Faded or missing markings stay until the city repaints them.
            Map.entry(HazardType.CROSSWALK_ISSUE, Duration.ofDays(30))
    ));

    public Map<HazardType, Duration> getTtl() {
        return ttl;
    }

    public void setTtl(Map<HazardType, Duration> ttl) {
        this.ttl.putAll(ttl);
    }

    public Duration ttlFor(HazardType type) {
        return ttl.getOrDefault(type, Duration.ofDays(3));
    }

    public Instant expiryFrom(HazardType type, Instant confirmedAt) {
        return confirmedAt.plus(ttlFor(type));
    }

    /** True in the last 20% of the window — the client then asks "Is this hazard still here?". */
    public boolean isExpiringSoon(HazardType type, Instant expiresAt, Instant now) {
        Duration remaining = Duration.between(now, expiresAt);
        return !remaining.isNegative() && remaining.compareTo(ttlFor(type).dividedBy(5)) <= 0;
    }
}
