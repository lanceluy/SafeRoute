package com.saferoute.backend.event.dto;

import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.hazard.HazardType;

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
        UUID reporterUserId
) {
}
