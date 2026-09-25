package com.saferoute.backend.event.outbox;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.UUID;

/**
 * Records an outgoing Kafka message in {@code outbox_events}, inside the caller's transaction.
 * The message exists if and only if the state change that caused it committed; {@link OutboxRelay}
 * publishes it afterwards, retrying until Kafka acknowledges it.
 */
@Component
public class OutboxWriter {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final OutboxRelay relay;

    public OutboxWriter(JdbcTemplate jdbc, ObjectMapper objectMapper, OutboxRelay relay) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.relay = relay;
    }

    /** Must run inside the transaction that makes the corresponding state change. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void enqueue(String topic, UUID key, UUID eventId, Object event) {
        String payload;
        try {
            payload = objectMapper.writeValueAsString(event);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Event is not serializable: " + event.getClass().getName(), e);
        }
        jdbc.update("""
                INSERT INTO outbox_events (event_id, topic, message_key, payload_type, payload)
                VALUES (?, ?, ?, ?, ?::jsonb)""",
                eventId, topic, key.toString(), event.getClass().getName(), payload);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                relay.requestDrain(); // publish now rather than waiting for the next sweep
            }
        });
    }
}
