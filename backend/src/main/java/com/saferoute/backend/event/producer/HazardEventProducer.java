package com.saferoute.backend.event.producer;

import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.*;
import com.saferoute.backend.hazard.Hazard;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * The sole Kafka producer. Commands from the REST layer are sent synchronously so the API can
 * answer 503 if Kafka is unreachable instead of silently dropping a report. Outcome events are
 * deferred until the surrounding DB transaction commits, so listeners never see state that
 * was rolled back. (A transactional outbox would close the remaining crash window — future work.)
 */
@Service
public class HazardEventProducer {

    private static final long SEND_TIMEOUT_SECONDS = 5;

    private final KafkaTemplate<String, Object> kafkaTemplate;

    public HazardEventProducer(KafkaTemplate<String, Object> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    // --- Commands (sent immediately, awaited) ---

    public void publishReported(HazardReportedEvent event) {
        sendAndWait(KafkaTopics.HAZARD_REPORTED, event.submissionId(), event);
    }

    public void publishVerified(HazardVerifiedEvent event) {
        sendAndWait(KafkaTopics.HAZARD_VERIFIED, event.hazardId(), event);
    }

    public void publishResolutionRequested(ResolutionRequestedEvent event) {
        sendAndWait(KafkaTopics.HAZARD_RESOLUTION_REQUESTED, event.hazardId(), event);
    }

    public void publishResolved(HazardResolvedEvent event) {
        sendAndWait(KafkaTopics.HAZARD_RESOLVED, event.hazardId(), event);
    }

    // --- Outcomes (sent after commit) ---

    public void publishCreated(Hazard hazard, UUID actorUserId) {
        HazardUpdatedEvent event = HazardUpdatedEvent.of(KafkaTopics.HAZARD_CREATED, hazard, HazardChange.CREATED, actorUserId);
        afterCommit(KafkaTopics.HAZARD_CREATED, hazard.getId(), event);
    }

    public void publishUpdated(Hazard hazard, HazardChange change, UUID actorUserId) {
        HazardUpdatedEvent event = HazardUpdatedEvent.of(KafkaTopics.HAZARD_UPDATED, hazard, change, actorUserId);
        afterCommit(KafkaTopics.HAZARD_UPDATED, hazard.getId(), event);
    }

    public void publishSubmissionProcessed(SubmissionProcessedEvent event) {
        afterCommit(KafkaTopics.SUBMISSION_PROCESSED, event.submissionId(), event);
    }

    private void sendAndWait(String topic, UUID key, Object event) {
        try {
            kafkaTemplate.send(topic, key.toString(), event).get(SEND_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EventPublishException(topic, e);
        } catch (ExecutionException | TimeoutException e) {
            throw new EventPublishException(topic, e);
        }
    }

    private void afterCommit(String topic, UUID key, Object event) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    kafkaTemplate.send(topic, key.toString(), event);
                }
            });
        } else {
            kafkaTemplate.send(topic, key.toString(), event);
        }
    }
}
