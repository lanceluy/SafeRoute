package com.saferoute.backend.submission;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.common.Correlation;
import com.saferoute.backend.coverage.CoverageArea;
import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.HazardReportedEvent;
import com.saferoute.backend.event.producer.HazardEventProducer;
import com.saferoute.backend.hazard.ExpiryPolicy;
import com.saferoute.backend.metrics.SafeRouteMetrics;
import com.saferoute.backend.spatial.HazardClassifier;
import com.saferoute.backend.submission.dto.HazardSubmissionRequest;
import com.saferoute.backend.submission.dto.HazardSubmissionResponse;
import com.saferoute.backend.upload.ImageUploadService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Service
public class HazardSubmissionService {

    /** Tolerated device clock skew for observedAt. */
    static final Duration MAX_CLOCK_SKEW = Duration.ofMinutes(2);
    private static final double SAME_COORDINATE_DEGREES = 1e-6;

    private final HazardSubmissionRepository submissionRepository;
    private final HazardEventProducer eventProducer;
    private final CoverageArea coverageArea;
    private final HazardClassifier classifier;
    private final ImageUploadService imageUploadService;
    private final ExpiryPolicy expiryPolicy;
    private final SafeRouteMetrics metrics;

    public HazardSubmissionService(HazardSubmissionRepository submissionRepository,
                                   HazardEventProducer eventProducer,
                                   CoverageArea coverageArea,
                                   HazardClassifier classifier,
                                   ImageUploadService imageUploadService,
                                   ExpiryPolicy expiryPolicy,
                                   SafeRouteMetrics metrics) {
        this.submissionRepository = submissionRepository;
        this.eventProducer = eventProducer;
        this.coverageArea = coverageArea;
        this.classifier = classifier;
        this.imageUploadService = imageUploadService;
        this.expiryPolicy = expiryPolicy;
        this.metrics = metrics;
    }

    /**
     * Records the submission as QUEUED and its hazard_reported command in one transaction (the
     * outbox relay publishes the command after commit). Kafka being slow or down therefore delays
     * processing but never loses the report or marks it FAILED.
     */
    @Transactional
    public HazardSubmissionResponse submit(HazardSubmissionRequest request, UUID reporterId) {
        coverageArea.requireCovered(request.latitude(), request.longitude());
        if (!classifier.isValidAnswer(request.type(), request.severityAnswer())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SEVERITY_ANSWER",
                    "severityAnswer is not a valid option for " + request.type());
        }
        imageUploadService.requireOwnedUpload(request.photoUrl(), reporterId);
        Instant observedAt = resolveObservedAt(request);

        HazardSubmission submission = submissionRepository.saveAndFlush(HazardSubmission.builder()
                .id(UUID.randomUUID())
                .reporterId(reporterId)
                .submittedType(request.type())
                .latitude(request.latitude())
                .longitude(request.longitude())
                .description(blankToNull(request.description()))
                .photoUrl(request.photoUrl())
                .severityAnswer(request.severityAnswer())
                .clientRequestId(request.clientRequestId())
                .observedAt(observedAt)
                .correlationId(Correlation.currentId())
                .build());
        imageUploadService.markAttached(request.photoUrl());

        eventProducer.publishReported(new HazardReportedEvent(
                EventMetadata.create(KafkaTopics.HAZARD_REPORTED),
                submission.getId(),
                request.type(),
                request.latitude(),
                request.longitude(),
                submission.getDescription(),
                request.photoUrl(),
                request.severityAnswer(),
                reporterId,
                observedAt));
        metrics.reportAccepted();
        return HazardSubmissionResponse.from(submission);
    }

    /**
     * If this is a retry of a report the server already accepted (same clientRequestId from the
     * same user), returns the original submission. The same key with different content is a
     * client bug and is rejected rather than silently answered with the wrong report.
     */
    @Transactional(readOnly = true)
    public Optional<HazardSubmissionResponse> findReplay(HazardSubmissionRequest request, UUID reporterId) {
        if (request.clientRequestId() == null) return Optional.empty();
        return submissionRepository.findByReporterIdAndClientRequestId(reporterId, request.clientRequestId())
                .map(existing -> {
                    if (!samePayload(existing, request)) {
                        throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                                "clientRequestId was already used for a different report");
                    }
                    return HazardSubmissionResponse.from(existing);
                });
    }

    public HazardSubmissionResponse get(UUID submissionId, UUID requesterId, boolean isModerator) {
        return submissionRepository.findById(submissionId)
                .filter(s -> isModerator || s.getReporterId().equals(requesterId))
                .map(HazardSubmissionResponse::from)
                // 404 rather than 403 so submission ids can't be probed.
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SUBMISSION_NOT_FOUND", "Submission not found"));
    }

    /**
     * observedAt defaults to now. A report older than its type's lifetime (e.g. a flood seen
     * 13 hours ago, flooding lasts 12) would be expired the moment it was published, so it is
     * rejected and the client tells the reporter instead.
     */
    private Instant resolveObservedAt(HazardSubmissionRequest request) {
        Instant now = Instant.now();
        Instant observedAt = request.observedAt();
        if (observedAt == null) return now;
        if (observedAt.isAfter(now.plus(MAX_CLOCK_SKEW))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_OBSERVED_AT", "observedAt is in the future");
        }
        if (observedAt.isAfter(now)) return now;
        if (!expiryPolicy.expiryFrom(request.type(), observedAt).isAfter(now)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "REPORT_TOO_OLD",
                    "This report is older than a " + request.type() + " report stays on the map, so it was not published.");
        }
        return observedAt;
    }

    private static boolean samePayload(HazardSubmission existing, HazardSubmissionRequest request) {
        return existing.getSubmittedType() == request.type()
                && Math.abs(existing.getLatitude() - request.latitude()) < SAME_COORDINATE_DEGREES
                && Math.abs(existing.getLongitude() - request.longitude()) < SAME_COORDINATE_DEGREES
                && Objects.equals(existing.getSeverityAnswer(), request.severityAnswer())
                && Objects.equals(existing.getPhotoUrl(), request.photoUrl());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
