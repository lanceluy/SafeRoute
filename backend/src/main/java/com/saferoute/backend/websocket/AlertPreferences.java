package com.saferoute.backend.websocket;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.user.QuietHours;

import java.util.Set;

/** Immutable snapshot of a user's alert preferences held per live WebSocket session. */
public record AlertPreferences(int radiusMeters, Set<HazardType> enabledTypes, QuietHours quietHours) {
}
