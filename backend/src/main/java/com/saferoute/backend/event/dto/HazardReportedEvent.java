package com.saferoute.backend.event.dto;

import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.hazard.HazardType;

import java.time.Instant;
import java.util.UUID;

public record HazardReportedEvent(
        EventMetadata metadata,
        UUID submissionId,
        HazardType type,
        double latitude,
        double longitude,
        String description,
        String photoUrl,
        String severityAnswer,
        UUID reporterUserId,
        /** When the reporter saw the hazard; null for legacy events (treated as processing time). */
        Instant observedAt
) {
}
