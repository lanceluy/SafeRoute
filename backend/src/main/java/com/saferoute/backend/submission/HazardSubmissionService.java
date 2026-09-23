package com.saferoute.backend.submission;

import com.saferoute.backend.common.ApiException;
import com.saferoute.backend.common.Correlation;
import com.saferoute.backend.coverage.CoverageArea;
import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.event.KafkaTopics;
import com.saferoute.backend.event.dto.HazardReportedEvent;
import com.saferoute.backend.event.producer.EventPublishException;
import com.saferoute.backend.event.producer.HazardEventProducer;
import com.saferoute.backend.metrics.SafeRouteMetrics;
import com.saferoute.backend.spatial.HazardClassifier;
import com.saferoute.backend.submission.dto.HazardSubmissionRequest;
import com.saferoute.backend.submission.dto.HazardSubmissionResponse;
import com.saferoute.backend.upload.ImageUploadService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.UUID;

@Service
public class HazardSubmissionService {

    private final HazardSubmissionRepository submissionRepository;
    private final HazardEventProducer eventProducer;
    private final CoverageArea coverageArea;
    private final HazardClassifier classifier;
    private final ImageUploadService imageUploadService;
    private final SafeRouteMetrics metrics;

    public HazardSubmissionService(HazardSubmissionRepository submissionRepository,
                                   HazardEventProducer eventProducer,
                                   CoverageArea coverageArea,
                                   HazardClassifier classifier,
                                   ImageUploadService imageUploadService,
                                   SafeRouteMetrics metrics) {
        this.submissionRepository = submissionRepository;
        this.eventProducer = eventProducer;
        this.coverageArea = coverageArea;
        this.classifier = classifier;
        this.imageUploadService = imageUploadService;
        this.metrics = metrics;
    }

    /**
     * Records the submission as QUEUED, then publishes hazard_reported. Not @Transactional on
     * purpose: the row must be committed before the consumer can possibly read it.
     */
    public HazardSubmissionResponse submit(HazardSubmissionRequest request, UUID reporterId) {
        coverageArea.requireCovered(request.latitude(), request.longitude());
        if (!classifier.isValidAnswer(request.type(), request.severityAnswer())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SEVERITY_ANSWER",
                    "severityAnswer is not a valid option for " + request.type());
        }
        imageUploadService.requireExistingUpload(request.photoUrl());

        HazardSubmission submission = submissionRepository.save(HazardSubmission.builder()
                .id(UUID.randomUUID())
                .reporterId(reporterId)
                .submittedType(request.type())
                .latitude(request.latitude())
                .longitude(request.longitude())
                .description(blankToNull(request.description()))
                .photoUrl(request.photoUrl())
                .severityAnswer(request.severityAnswer())
                .correlationId(Correlation.currentId())
                .build());

        try {
            eventProducer.publishReported(new HazardReportedEvent(
                    EventMetadata.create(KafkaTopics.HAZARD_REPORTED),
                    submission.getId(),
                    request.type(),
                    request.latitude(),
                    request.longitude(),
                    submission.getDescription(),
                    request.photoUrl(),
                    request.severityAnswer(),
                    reporterId));
        } catch (EventPublishException e) {
            submission.setProcessingStatus(SubmissionStatus.FAILED);
            submission.setFailureReason("Event bus unavailable");
            submission.setProcessedAt(Instant.now());
            submissionRepository.save(submission);
            throw e;
        }
        metrics.reportAccepted();
        return HazardSubmissionResponse.from(submission);
    }

    public HazardSubmissionResponse get(UUID submissionId, UUID requesterId, boolean isModerator) {
        return submissionRepository.findById(submissionId)
                .filter(s -> isModerator || s.getReporterId().equals(requesterId))
                .map(HazardSubmissionResponse::from)
                // 404 rather than 403 so submission ids can't be probed.
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SUBMISSION_NOT_FOUND", "Submission not found"));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
