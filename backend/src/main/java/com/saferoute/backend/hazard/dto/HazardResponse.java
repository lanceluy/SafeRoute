package com.saferoute.backend.hazard.dto;

import com.saferoute.backend.hazard.*;

import java.time.Instant;
import java.util.UUID;

public record HazardResponse(
        UUID id,
        HazardType type,
        double latitude,
        double longitude,
        String description,
        String photoUrl,
        HazardStatus status,
        Severity severity,
        String severityAnswer,
        /** Independent VERIFY confirmations (the reporter's own report is not counted). */
        int confirmationCount,
        int disputeCount,
        /** Null for RESOLVED/EXPIRED/REMOVED hazards. */
        Confidence confidence,
        UUID reporterId,
        Instant createdAt,
        Instant updatedAt,
        Instant lastConfirmedAt,
        Instant expiresAt,
        Instant resolvedAt,
        /** Committed row version; clients keep the highest version they have seen per hazard. */
        long version
) {
    public static HazardResponse from(Hazard hazard) {
        return new HazardResponse(
                hazard.getId(),
                hazard.getType(),
                hazard.latitude(),
                hazard.longitude(),
                hazard.getDescription(),
                hazard.getPhotoUrl(),
                hazard.getStatus(),
                hazard.getSeverity(),
                hazard.getSeverityAnswer(),
                hazard.getConfirmationCount(),
                hazard.getDisputeCount(),
                hazard.confidence(),
                hazard.getReporterId(),
                hazard.getCreatedAt(),
                hazard.getUpdatedAt(),
                hazard.getLastConfirmedAt(),
                hazard.getExpiresAt(),
                hazard.getResolvedAt(),
                hazard.getVersion() != null ? hazard.getVersion() : 0
        );
    }
}
