package com.saferoute.backend.event.dto;

import com.saferoute.backend.closure.ClosureCategory;
import com.saferoute.backend.closure.ClosureStatus;
import com.saferoute.backend.closure.RoadClosure;
import com.saferoute.backend.event.EventMetadata;

import java.time.Instant;
import java.util.UUID;

/** Outcome event: a snapshot of a road closure after it was created, edited, lifted or expired. */
public record ClosureChangedEvent(
        EventMetadata metadata,
        UUID closureId,
        Change change,
        UUID actorUserId,
        String name,
        String reason,
        ClosureCategory category,
        ClosureStatus status,
        int bufferMeters,
        Instant endsAt,
        double[][] coordinates,
        long version
) {
    public enum Change { CREATED, UPDATED, LIFTED, EXPIRED }

    public static ClosureChangedEvent of(String eventType, RoadClosure c, Change change, UUID actorUserId) {
        return new ClosureChangedEvent(EventMetadata.create(eventType), c.getId(), change, actorUserId,
                c.getName(), c.getReason(), c.getCategory(), c.getStatus(), c.getBufferMeters(), c.getEndsAt(),
                c.latLonVertices(), c.getVersion());
    }
}
