package com.saferoute.backend.user;

import com.saferoute.backend.hazard.HazardType;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

/** One row per user; simple boolean columns per type are fine at prototype scale (review §53). */
@Entity
@Table(name = "user_notification_preferences")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NotificationPreferences {

    public static final int DEFAULT_RADIUS_METERS = 400;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "radius_meters", nullable = false)
    @Builder.Default
    private int radiusMeters = DEFAULT_RADIUS_METERS;

    @Column(name = "flooding_enabled", nullable = false) @Builder.Default private boolean floodingEnabled = true;
    @Column(name = "broken_sidewalk_enabled", nullable = false) @Builder.Default private boolean brokenSidewalkEnabled = true;
    @Column(name = "open_manhole_enabled", nullable = false) @Builder.Default private boolean openManholeEnabled = true;
    @Column(name = "poor_lighting_enabled", nullable = false) @Builder.Default private boolean poorLightingEnabled = true;
    @Column(name = "accessibility_barrier_enabled", nullable = false) @Builder.Default private boolean accessibilityBarrierEnabled = true;
    @Column(name = "construction_enabled", nullable = false) @Builder.Default private boolean constructionEnabled = true;
    @Column(name = "path_obstruction_enabled", nullable = false) @Builder.Default private boolean pathObstructionEnabled = true;

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    public static NotificationPreferences defaultsFor(UUID userId) {
        return NotificationPreferences.builder().userId(userId).build();
    }

    public Set<HazardType> enabledTypes() {
        Set<HazardType> types = EnumSet.noneOf(HazardType.class);
        for (HazardType type : HazardType.values()) {
            if (isEnabled(type)) types.add(type);
        }
        return types;
    }

    public boolean isEnabled(HazardType type) {
        return switch (type) {
            case FLOODING -> floodingEnabled;
            case BROKEN_SIDEWALK -> brokenSidewalkEnabled;
            case OPEN_MANHOLE -> openManholeEnabled;
            case POOR_LIGHTING -> poorLightingEnabled;
            case ACCESSIBILITY_BARRIER -> accessibilityBarrierEnabled;
            case CONSTRUCTION -> constructionEnabled;
            case PATH_OBSTRUCTION -> pathObstructionEnabled;
        };
    }

    public void setEnabledTypes(Set<HazardType> types) {
        floodingEnabled = types.contains(HazardType.FLOODING);
        brokenSidewalkEnabled = types.contains(HazardType.BROKEN_SIDEWALK);
        openManholeEnabled = types.contains(HazardType.OPEN_MANHOLE);
        poorLightingEnabled = types.contains(HazardType.POOR_LIGHTING);
        accessibilityBarrierEnabled = types.contains(HazardType.ACCESSIBILITY_BARRIER);
        constructionEnabled = types.contains(HazardType.CONSTRUCTION);
        pathObstructionEnabled = types.contains(HazardType.PATH_OBSTRUCTION);
    }
}
