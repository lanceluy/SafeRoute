package com.saferoute.backend.websocket;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.saferoute.backend.event.dto.HazardChange;
import com.saferoute.backend.hazard.HazardStatus;
import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.hazard.Severity;

import java.time.Instant;
import java.util.UUID;

/**
 * Outbound hazard frame. {@code type} is one of hazard_created | hazard_verified |
 * hazard_disputed | hazard_resolved | hazard_expired | hazard_updated, so the client can patch
 * its map state immediately. {@code alert=true} means "notify the user": the hazard
 * is new/newly verified, of a type they enabled, and on their route ahead of them (or, with no
 * active route, within their alert radius).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record HazardEventFrame(
        String type,
        HazardChange change,
        UUID hazardId,
        HazardType hazardType,
        double latitude,
        double longitude,
        HazardStatus status,
        Severity severity,
        int confirmationCount,
        int disputeCount,
        double distanceMeters,
        boolean alert,
        boolean onRoute,
        Double distanceAheadMeters,
        Instant occurredAt,
        /** Hazard row version: clients ignore a frame older than the state they already hold. */
        long version
) {
}
