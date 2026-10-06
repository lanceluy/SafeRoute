package com.saferoute.backend.websocket;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.saferoute.backend.closure.ClosureCategory;
import com.saferoute.backend.closure.ClosureStatus;
import com.saferoute.backend.event.dto.ClosureChangedEvent;

import java.time.Instant;
import java.util.UUID;

/**
 * Outbound road-closure frame, {@code type} = "closure_changed". {@code status} ACTIVE means draw it
 * (create or edit); LIFTED / EXPIRED mean remove it. {@code version} lets clients ignore stale frames.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ClosureEventFrame(
        String type,
        ClosureChangedEvent.Change change,
        UUID closureId,
        String name,
        String reason,
        ClosureCategory category,
        ClosureStatus status,
        int bufferMeters,
        Instant endsAt,
        double[][] coordinates,
        Instant occurredAt,
        long version
) {
    public static final String TYPE = "closure_changed";

    public static ClosureEventFrame of(ClosureChangedEvent e) {
        return new ClosureEventFrame(TYPE, e.change(), e.closureId(), e.name(), e.reason(), e.category(), e.status(),
                e.bufferMeters(), e.endsAt(), e.coordinates(), e.metadata().occurredAt(), e.version());
    }
}
