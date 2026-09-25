package com.saferoute.backend.event.consumer;

import com.saferoute.backend.confirmation.*;
import com.saferoute.backend.event.EventContext;
import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.NonRetryableEventException;
import com.saferoute.backend.event.ProcessedEventRepository;
import com.saferoute.backend.event.dto.*;
import com.saferoute.backend.event.producer.HazardEventProducer;
import com.saferoute.backend.hazard.*;
import com.saferoute.backend.metrics.SafeRouteMetrics;
import com.saferoute.backend.spatial.GeoUtils;
import com.saferoute.backend.spatial.HazardClassifier;
import com.saferoute.backend.submission.HazardSubmission;
import com.saferoute.backend.submission.HazardSubmissionRepository;
import com.saferoute.backend.submission.SubmissionStatus;
import com.saferoute.backend.user.ReputationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The Hazard Processing module: validates, deduplicates, classifies and persists reports, and
 * owns the community-driven state machine (see {@link HazardLifecycle}). Runs in its own
 * consumer group so it receives every command independently of the Notification module.
 *
 * <p>Every handler is idempotent: the event id is recorded in processed_events inside the same
 * transaction, and status is recomputed from counts rather than incremented, so a Kafka
 * redelivery cannot double-apply a side effect. Outcome events are written to the outbox in the
 * same transaction, so a committed change always yields its outcome.
 *
 * <p>Concurrency: the hazard row is locked for the whole evaluation of a command (votes change
 * child rows, which the hazard's @Version alone would not serialize), and hazard creation takes a
 * per-type advisory lock so two reports of the same hazard can't both miss each other.
 */
@Component
public class HazardProcessingConsumer {

    public static final String GROUP_ID = "hazard-processing-service-group";
    /** Listener container ids, used by the benchmark's consumer stop/start control. */
    public static final String REPORTED_LISTENER_ID = "hazard-reported-processor";

    private static final Logger log = LoggerFactory.getLogger(HazardProcessingConsumer.class);
    private static final String CONSUMER = "hazard-processing";

    /** What an opinion command did to the user's stored opinion. */
    private enum OpinionUpdate { CHANGED, REPEATED }

    private final HazardRepository hazardRepository;
    private final HazardSubmissionRepository submissionRepository;
    private final HazardConfirmationRepository confirmationRepository;
    private final ResolutionVoteRepository resolutionVoteRepository;
    private final ProcessedEventRepository processedEvents;
    private final HazardAuditService audit;
    private final HazardClassifier classifier;
    private final HazardLifecycle lifecycle;
    private final ExpiryPolicy expiryPolicy;
    private final ReputationService reputationService;
    private final HazardEventProducer eventProducer;
    private final SafeRouteMetrics metrics;
    private final JdbcTemplate jdbc;
    private final double duplicateRadiusMeters;
    private final int resolutionThreshold;

    public HazardProcessingConsumer(HazardRepository hazardRepository,
                                    HazardSubmissionRepository submissionRepository,
                                    HazardConfirmationRepository confirmationRepository,
                                    ResolutionVoteRepository resolutionVoteRepository,
                                    ProcessedEventRepository processedEvents,
                                    HazardAuditService audit,
                                    HazardClassifier classifier,
                                    HazardLifecycle lifecycle,
                                    ExpiryPolicy expiryPolicy,
                                    ReputationService reputationService,
                                    HazardEventProducer eventProducer,
                                    SafeRouteMetrics metrics,
                                    JdbcTemplate jdbc,
                                    @Value("${saferoute.hazard.duplicate-radius-meters}") double duplicateRadiusMeters,
                                    @Value("${saferoute.hazard.resolution-threshold}") int resolutionThreshold) {
        this.hazardRepository = hazardRepository;
        this.submissionRepository = submissionRepository;
        this.confirmationRepository = confirmationRepository;
        this.resolutionVoteRepository = resolutionVoteRepository;
        this.processedEvents = processedEvents;
        this.audit = audit;
        this.classifier = classifier;
        this.lifecycle = lifecycle;
        this.expiryPolicy = expiryPolicy;
        this.reputationService = reputationService;
        this.eventProducer = eventProducer;
        this.metrics = metrics;
        this.jdbc = jdbc;
        this.duplicateRadiusMeters = duplicateRadiusMeters;
        this.resolutionThreshold = resolutionThreshold;
    }

    // ------------------------------------------------------------------ hazard_reported

    @KafkaListener(id = REPORTED_LISTENER_ID, idIsGroup = false, topics = KafkaTopics.HAZARD_REPORTED, groupId = GROUP_ID)
    @Transactional
    public void onHazardReported(HazardReportedEvent event) {
        try (var ignored = EventContext.enter(event.metadata())) {
            if (!firstDelivery(event.metadata())) return;

            HazardSubmission submission = submissionRepository.findById(event.submissionId())
                    .orElseThrow(() -> new NonRetryableEventException("Unknown submission " + event.submissionId()));
            if (submission.getProcessingStatus().isTerminal()) {
                log.info("Submission {} already {}; skipping", submission.getId(), submission.getProcessingStatus());
                return;
            }
            if (event.type() == null || !validCoordinates(event.latitude(), event.longitude())) {
                throw new NonRetryableEventException("Invalid hazard_reported payload for submission " + event.submissionId());
            }

            // Serializes "find duplicate, else create" per hazard type, across consumer threads and instances.
            jdbc.query("SELECT pg_advisory_xact_lock(hashtext(?))", rs -> null, "hazard-dedup:" + event.type().name());
            List<Hazard> duplicates = hazardRepository.findPotentialDuplicates(
                    event.latitude(), event.longitude(), event.type().name(), duplicateRadiusMeters);

            Instant observedAt = observedAt(event);
            if (duplicates.isEmpty()) {
                createHazard(submission, event, observedAt);
            } else {
                Hazard existing = hazardRepository.findByIdForUpdate(duplicates.get(0).getId()).orElseThrow();
                mergeIntoExistingHazard(existing, submission, event, observedAt);
            }
            metrics.recordProcessingLatency(event.metadata().occurredAt());
        }
    }

    private void createHazard(HazardSubmission submission, HazardReportedEvent event, Instant observedAt) {
        Hazard hazard = hazardRepository.save(Hazard.builder()
                .id(UUID.randomUUID())
                .type(event.type())
                .location(GeoUtils.point(event.latitude(), event.longitude()))
                .description(event.description())
                .photoUrl(event.photoUrl())
                .severity(classifier.classify(event.type(), event.severityAnswer()))
                .severityAnswer(event.severityAnswer())
                .reporterId(event.reporterUserId())
                .lastConfirmedAt(observedAt)
                .expiresAt(expiryPolicy.expiryFrom(event.type(), observedAt))
                .build());
        audit.record(hazard.getId(), event.reporterUserId(), HazardAuditLog.Action.CREATED,
                "type", null, hazard.getType(), "Severity " + hazard.getSeverity());
        completeSubmission(submission, SubmissionStatus.CREATED, hazard.getId());

        log.info("Submission {} created hazard {} ({}) at ({}, {})",
                submission.getId(), hazard.getId(), hazard.getType(), event.latitude(), event.longitude());
        metrics.reportCreated();
        eventProducer.publishCreated(hazard, event.reporterUserId());
    }

    private void mergeIntoExistingHazard(Hazard existing, HazardSubmission submission, HazardReportedEvent event,
                                         Instant observedAt) {
        UUID reporter = event.reporterUserId();
        HazardChange change = HazardChange.DUPLICATE_MERGED;
        if (existing.getReporterId().equals(reporter)) {
            // Re-reporting your own hazard is a "still here", not an independent confirmation.
            touchConfirmed(existing, observedAt);
        } else if (upsertConfirmation(existing, reporter, ConfirmationAction.VERIFY, observedAt) == OpinionUpdate.CHANGED) {
            change = recountAndEvaluate(existing, reporter, "Duplicate report merged", HazardChange.DUPLICATE_MERGED);
        }
        if (existing.getPhotoUrl() == null && event.photoUrl() != null) {
            existing.setPhotoUrl(event.photoUrl());
        }
        hazardRepository.save(existing);
        audit.record(existing.getId(), reporter, HazardAuditLog.Action.DUPLICATE_MERGED, "Submission " + submission.getId());
        completeSubmission(submission, SubmissionStatus.MERGED, existing.getId());

        log.info("Submission {} merged into existing hazard {}", submission.getId(), existing.getId());
        metrics.reportMerged();
        eventProducer.publishUpdated(existing, change, reporter);
    }

    private void completeSubmission(HazardSubmission submission, SubmissionStatus status, UUID hazardId) {
        submission.setProcessingStatus(status);
        submission.setCanonicalHazardId(hazardId);
        submission.setProcessedAt(Instant.now());
        submissionRepository.save(submission);
        eventProducer.publishSubmissionProcessed(new SubmissionProcessedEvent(
                EventMetadata.create(KafkaTopics.SUBMISSION_PROCESSED),
                submission.getId(), submission.getReporterId(), status, hazardId, null));
    }

    // ------------------------------------------------------------------ hazard_verified

    @KafkaListener(topics = KafkaTopics.HAZARD_VERIFIED, groupId = GROUP_ID)
    @Transactional
    public void onHazardVerified(HazardVerifiedEvent event) {
        try (var ignored = EventContext.enter(event.metadata())) {
            if (!firstDelivery(event.metadata())) return;
            Hazard hazard = lockActiveHazard(event.hazardId(), event.hazardRevision());
            if (hazard == null) return;
            if (hazard.getReporterId().equals(event.verifierUserId())) {
                log.warn("Ignoring self-confirmation on hazard {}", hazard.getId());
                return;
            }
            if (upsertConfirmation(hazard, event.verifierUserId(), event.action(), Instant.now()) == OpinionUpdate.REPEATED) {
                // Same opinion again: a VERIFY is a fresh sighting (already applied to expiry above),
                // but it is not another vote and earns nothing.
                hazardRepository.save(hazard);
                return;
            }
            HazardChange change = recountAndEvaluate(hazard, event.verifierUserId(), null, HazardChange.CONFIRMATIONS_CHANGED);
            hazardRepository.save(hazard);
            eventProducer.publishUpdated(hazard, change, event.verifierUserId());
        }
    }

    // ------------------------------------------------------------------ hazard_resolution_requested

    @KafkaListener(topics = KafkaTopics.HAZARD_RESOLUTION_REQUESTED, groupId = GROUP_ID)
    @Transactional
    public void onResolutionRequested(ResolutionRequestedEvent event) {
        try (var ignored = EventContext.enter(event.metadata())) {
            if (!firstDelivery(event.metadata())) return;
            Hazard hazard = lockActiveHazard(event.hazardId(), event.hazardRevision());
            if (hazard == null) return;

            ResolutionVote vote = resolutionVoteRepository.findByHazardIdAndUserId(hazard.getId(), event.userId())
                    .orElseGet(() -> ResolutionVote.builder().hazardId(hazard.getId()).userId(event.userId()).build());
            ResolutionAction previous = vote.getAction();
            vote.setAction(event.action());
            vote.setHazardRevision(hazard.getContentRevision());
            vote.setUpdatedAt(Instant.now());
            resolutionVoteRepository.save(vote);
            audit.record(hazard.getId(), event.userId(), HazardAuditLog.Action.RESOLUTION_VOTE,
                    "resolutionVote", previous, event.action(), null);

            HazardChange change = HazardChange.CONFIRMATIONS_CHANGED;
            if (event.action() == ResolutionAction.STILL_PRESENT) {
                touchConfirmed(hazard, Instant.now());
            } else {
                long gone = resolutionVoteRepository.countByHazardIdAndAction(hazard.getId(), ResolutionAction.NO_LONGER_PRESENT);
                long still = resolutionVoteRepository.countByHazardIdAndAction(hazard.getId(), ResolutionAction.STILL_PRESENT);
                if (gone >= resolutionThreshold && gone > still) {
                    resolve(hazard, null, "Resolved by community: " + gone + " users reported it is no longer present");
                    change = HazardChange.RESOLVED;
                }
            }
            hazardRepository.save(hazard);
            eventProducer.publishUpdated(hazard, change, event.userId());
        }
    }

    // ------------------------------------------------------------------ hazard_resolved (moderator)

    @KafkaListener(topics = KafkaTopics.HAZARD_RESOLVED, groupId = GROUP_ID)
    @Transactional
    public void onHazardResolved(HazardResolvedEvent event) {
        try (var ignored = EventContext.enter(event.metadata())) {
            if (!firstDelivery(event.metadata())) return;
            Hazard hazard = lockActiveHazard(event.hazardId(), event.hazardRevision());
            if (hazard == null) return;
            resolve(hazard, event.resolvedByUserId(), event.resolutionNote());
            audit.record(hazard.getId(), event.resolvedByUserId(), HazardAuditLog.Action.MODERATOR_RESOLVED, event.resolutionNote());
            hazardRepository.save(hazard);
            log.info("Hazard {} RESOLVED by moderator {}", hazard.getId(), event.resolvedByUserId());
            eventProducer.publishUpdated(hazard, HazardChange.RESOLVED, event.resolvedByUserId());
        }
    }

    // ------------------------------------------------------------------ helpers

    private boolean firstDelivery(EventMetadata metadata) {
        if (metadata == null || metadata.eventId() == null) {
            throw new NonRetryableEventException("Event is missing metadata.eventId");
        }
        if (!processedEvents.markProcessed(metadata.eventId(), CONSUMER)) {
            log.info("Event {} ({}) already processed; skipping redelivery", metadata.eventId(), metadata.eventType());
            return false;
        }
        return true;
    }

    /**
     * Locks the hazard for this transaction. Returns null (command dropped) if the hazard is gone,
     * inactive, or its content changed since the command was accepted — e.g. a vote accepted
     * before a moderator removed and then reopened it, or before the reporter changed its type.
     */
    private Hazard lockActiveHazard(UUID hazardId, Integer acceptedRevision) {
        Hazard hazard = hazardRepository.findByIdForUpdate(hazardId).orElse(null);
        if (hazard == null) {
            log.warn("Ignoring event for unknown hazard {}", hazardId);
            return null;
        }
        if (!hazard.getStatus().isActive()) {
            log.info("Ignoring event for {} hazard {}", hazard.getStatus(), hazardId);
            return null;
        }
        if (acceptedRevision != null && acceptedRevision != hazard.getContentRevision()) {
            log.info("Ignoring stale command for hazard {}: accepted at revision {}, hazard is at {}",
                    hazardId, acceptedRevision, hazard.getContentRevision());
            return null;
        }
        return hazard;
    }

    /**
     * Upserts the user's single opinion. A VERIFY is also a sighting, so it refreshes the hazard's
     * freshness even when the opinion itself is unchanged.
     */
    private OpinionUpdate upsertConfirmation(Hazard hazard, UUID userId, ConfirmationAction action, Instant observedAt) {
        if (action == ConfirmationAction.VERIFY) touchConfirmed(hazard, observedAt);
        HazardConfirmation confirmation = confirmationRepository.findByHazardIdAndUserId(hazard.getId(), userId).orElse(null);
        ConfirmationAction previous = confirmation != null ? confirmation.getAction() : null;
        if (previous == action) return OpinionUpdate.REPEATED;
        if (confirmation == null) {
            confirmation = HazardConfirmation.builder().hazardId(hazard.getId()).userId(userId).action(action).build();
        } else {
            confirmation.setAction(action);
            confirmation.setUpdatedAt(Instant.now());
        }
        confirmation.setHazardRevision(hazard.getContentRevision());
        confirmationRepository.save(confirmation);
        audit.record(hazard.getId(), userId, HazardAuditLog.Action.CONFIRMATION_CHANGED, "confirmation", previous, action, null);
        return OpinionUpdate.CHANGED;
    }

    private HazardChange recountAndEvaluate(Hazard hazard, UUID actorId, String note, HazardChange noStatusChange) {
        int verifies = (int) confirmationRepository.countByHazardIdAndAction(hazard.getId(), ConfirmationAction.VERIFY);
        int disputes = (int) confirmationRepository.countByHazardIdAndAction(hazard.getId(), ConfirmationAction.DISPUTE);
        hazard.setConfirmationCount(verifies);
        hazard.setDisputeCount(disputes);

        HazardStatus oldStatus = hazard.getStatus();
        HazardStatus newStatus = lifecycle.evaluate(oldStatus, verifies, disputes);
        if (newStatus == HazardStatus.VERIFIED) {
            // Idempotent: awards only confirmations/reporters not yet rewarded.
            reputationService.onHazardVerified(hazard);
        }
        if (newStatus == oldStatus) return noStatusChange;

        hazard.setStatus(newStatus);
        audit.statusChanged(hazard.getId(), actorId, oldStatus, newStatus,
                note != null ? note : verifies + " confirmation(s), " + disputes + " dispute(s)");
        return switch (newStatus) {
            case VERIFIED -> HazardChange.VERIFIED;
            case DISPUTED -> HazardChange.DISPUTED;
            default -> HazardChange.REINSTATED;
        };
    }

    /** Records a sighting at {@code at}; never moves freshness backwards. */
    private void touchConfirmed(Hazard hazard, Instant at) {
        if (at.isAfter(hazard.getLastConfirmedAt())) hazard.setLastConfirmedAt(at);
        Instant extended = expiryPolicy.expiryFrom(hazard.getType(), at);
        if (extended.isAfter(hazard.getExpiresAt())) hazard.setExpiresAt(extended);
    }

    private void resolve(Hazard hazard, UUID actorId, String note) {
        HazardStatus oldStatus = hazard.getStatus();
        hazard.setStatus(HazardStatus.RESOLVED);
        hazard.setResolvedAt(Instant.now());
        audit.statusChanged(hazard.getId(), actorId, oldStatus, HazardStatus.RESOLVED, note);
    }

    /** The reporter's observation time, falling back to now for legacy events. */
    private static Instant observedAt(HazardReportedEvent event) {
        Instant now = Instant.now();
        return event.observedAt() != null && event.observedAt().isBefore(now) ? event.observedAt() : now;
    }

    private static boolean validCoordinates(double lat, double lon) {
        return Double.isFinite(lat) && Double.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    }
}
