package com.saferoute.backend.event;

import com.saferoute.backend.common.Correlation;
import org.slf4j.MDC;

/**
 * Puts an event's correlation/event ids into the logging MDC for the duration of a consumer
 * callback, so consumer logs line up with the originating REST request.
 */
public final class EventContext implements AutoCloseable {

    private EventContext() {
    }

    public static EventContext enter(EventMetadata metadata) {
        if (metadata != null) {
            Correlation.set(metadata.correlationId());
            MDC.put("eventId", String.valueOf(metadata.eventId()));
            MDC.put("eventType", metadata.eventType());
        }
        return new EventContext();
    }

    @Override
    public void close() {
        Correlation.clear();
        MDC.remove("eventId");
        MDC.remove("eventType");
    }
}
