package com.saferoute.backend.hazard;

import java.util.EnumSet;
import java.util.Set;

public enum HazardStatus {
    REPORTED,
    VERIFIED,
    /** Community reports disagree — shown, never hidden (review §8). */
    DISPUTED,
    RESOLVED,
    /** No recent confirmation within the type's expiry window (review §9). */
    EXPIRED,
    /** Removed by a moderator as false/spam. */
    REMOVED;

    public static final Set<HazardStatus> ACTIVE = EnumSet.of(REPORTED, VERIFIED, DISPUTED);

    public boolean isActive() {
        return ACTIVE.contains(this);
    }
}
