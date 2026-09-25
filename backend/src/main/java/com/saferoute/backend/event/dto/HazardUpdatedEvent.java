package com.saferoute.backend.event.dto;

import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.hazard.Hazard;
import com.saferoute.backend.hazard.HazardStatus;
import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.hazard.Severity;

import java.util.UUID;

/**
 * Outcome event: a snapshot of the hazard after a change. Published on both hazard_created and
 * hazard_updated so the Notification module never has to re-read the database.
 *
 * <p>{@code version} is the hazard row's committed optimistic-lock version. Snapshots can arrive
 * out of order (hazard_created and hazard_updated are separate topics), so consumers must keep the
 * highest version they have seen.
 */
public record HazardUpdatedEvent(
        EventMetadata metadata,
        UUID hazardId,
        HazardChange change,
        UUID actorUserId,
        HazardType type,
        double latitude,
        double longitude,
        HazardStatus status,
        Severity severity,
        int confirmationCount,
        int disputeCount,
        long version
) {
    public static HazardUpdatedEvent of(String eventType, Hazard hazard, HazardChange change, UUID actorUserId) {
        return new HazardUpdatedEvent(EventMetadata.create(eventType), hazard.getId(), change, actorUserId,
                hazard.getType(), hazard.latitude(), hazard.longitude(), hazard.getStatus(), hazard.getSeverity(),
                hazard.getConfirmationCount(), hazard.getDisputeCount(), hazard.getVersion());
    }
}
