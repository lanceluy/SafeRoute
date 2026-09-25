package com.saferoute.backend.event;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.UUID;

/**
 * Consumer idempotency ledger. Call inside the consumer's transaction: if the
 * handler later fails, the insert rolls back with it and the redelivery is processed normally.
 */
@Repository
public class ProcessedEventRepository {

    private final JdbcTemplate jdbc;

    public ProcessedEventRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** @return true if this is the first time {@code consumer} sees {@code eventId}. */
    public boolean markProcessed(UUID eventId, String consumer) {
        int inserted = jdbc.update(
                "INSERT INTO processed_events (event_id, consumer_name) VALUES (?, ?) ON CONFLICT DO NOTHING",
                eventId, consumer);
        return inserted == 1;
    }
}
