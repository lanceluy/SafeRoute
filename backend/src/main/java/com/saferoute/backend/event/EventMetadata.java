package com.saferoute.backend.event;

import com.saferoute.backend.common.Correlation;

import java.time.Instant;
import java.util.UUID;

/** Envelope fields carried by every event (review §22, §59). */
public record EventMetadata(
        UUID eventId,
        String eventType,
        int schemaVersion,
        Instant occurredAt,
        String correlationId,
        String producer
) {
    public static final int SCHEMA_VERSION = 2;
    public static final String PRODUCER = "saferoute-backend";

    public static EventMetadata create(String eventType) {
        return new EventMetadata(UUID.randomUUID(), eventType, SCHEMA_VERSION, Instant.now(),
                Correlation.currentOrNew(), PRODUCER);
    }
}
