package com.saferoute.backend.closure.dto;

import com.saferoute.backend.closure.ClosureCategory;
import com.saferoute.backend.closure.ClosureStatus;
import com.saferoute.backend.closure.RoadClosure;

import java.time.Instant;
import java.util.UUID;

/** @param coordinates the blocked line as [latitude, longitude] pairs */
public record ClosureResponse(
        UUID id,
        String name,
        String reason,
        ClosureCategory category,
        ClosureStatus status,
        int bufferMeters,
        Instant startsAt,
        Instant endsAt,
        Instant createdAt,
        long version,
        double[][] coordinates
) {
    public static ClosureResponse from(RoadClosure c) {
        return new ClosureResponse(c.getId(), c.getName(), c.getReason(), c.getCategory(), c.getStatus(),
                c.getBufferMeters(), c.getStartsAt(), c.getEndsAt(), c.getCreatedAt(), c.getVersion(),
                c.latLonVertices());
    }
}
