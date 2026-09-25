package com.saferoute.backend.common;

import org.slf4j.MDC;

import java.util.UUID;

/**
 * One correlation id follows a request through REST -> Kafka event -> consumer -> DB mutation
 * -> WebSocket delivery. Stored in the SLF4J MDC so every log line carries it.
 */
public final class Correlation {

    public static final String HEADER = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";

    private Correlation() {
    }

    public static String currentId() {
        return MDC.get(MDC_KEY);
    }

    public static String currentOrNew() {
        String id = MDC.get(MDC_KEY);
        return id != null ? id : UUID.randomUUID().toString();
    }

    public static void set(String correlationId) {
        if (correlationId == null) {
            MDC.remove(MDC_KEY);
        } else {
            MDC.put(MDC_KEY, correlationId);
        }
    }

    public static void clear() {
        MDC.remove(MDC_KEY);
    }
}
