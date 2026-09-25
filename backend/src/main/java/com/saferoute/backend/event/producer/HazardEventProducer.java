package com.saferoute.backend.event.producer;

import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.*;
import com.saferoute.backend.event.outbox.OutboxWriter;
import com.saferoute.backend.hazard.Hazard;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * The sole Kafka producer. Every message — commands from the REST layer and outcomes from the
 * consumers — goes through the transactional outbox: it is recorded in the same transaction as
 * the state change and published by {@link com.saferoute.backend.event.outbox.OutboxRelay} after
 * commit. Callers must therefore be inside a transaction.
 */
@Service
public class HazardEventProducer {

    private final OutboxWriter outbox;
    private final EntityManager entityManager;

    public HazardEventProducer(OutboxWriter outbox, EntityManager entityManager) {
        this.outbox = outbox;
        this.entityManager = entityManager;
    }

    // --- Commands ---

    public void publishReported(HazardReportedEvent event) {
        outbox.enqueue(KafkaTopics.HAZARD_REPORTED, event.submissionId(), event.metadata().eventId(), event);
    }

    public void publishVerified(HazardVerifiedEvent event) {
        outbox.enqueue(KafkaTopics.HAZARD_VERIFIED, event.hazardId(), event.metadata().eventId(), event);
    }

    public void publishResolutionRequested(ResolutionRequestedEvent event) {
        outbox.enqueue(KafkaTopics.HAZARD_RESOLUTION_REQUESTED, event.hazardId(), event.metadata().eventId(), event);
    }

    public void publishResolved(HazardResolvedEvent event) {
        outbox.enqueue(KafkaTopics.HAZARD_RESOLVED, event.hazardId(), event.metadata().eventId(), event);
    }

    // --- Outcomes ---

    public void publishCreated(Hazard hazard, UUID actorUserId) {
        publishSnapshot(KafkaTopics.HAZARD_CREATED, hazard, HazardChange.CREATED, actorUserId);
    }

    public void publishUpdated(Hazard hazard, HazardChange change, UUID actorUserId) {
        publishSnapshot(KafkaTopics.HAZARD_UPDATED, hazard, change, actorUserId);
    }

    public void publishSubmissionProcessed(SubmissionProcessedEvent event) {
        outbox.enqueue(KafkaTopics.SUBMISSION_PROCESSED, event.submissionId(), event.metadata().eventId(), event);
    }

    private void publishSnapshot(String topic, Hazard hazard, HazardChange change, UUID actorUserId) {
        // Flush first so the snapshot carries the version this transaction will commit; clients
        // use it to ignore snapshots older than the state they already have.
        entityManager.flush();
        HazardUpdatedEvent event = HazardUpdatedEvent.of(topic, hazard, change, actorUserId);
        outbox.enqueue(topic, hazard.getId(), event.metadata().eventId(), event);
    }
}
