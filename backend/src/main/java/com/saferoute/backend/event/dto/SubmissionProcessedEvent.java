package com.saferoute.backend.event.dto;

import com.saferoute.backend.event.EventMetadata;
import com.saferoute.backend.submission.SubmissionStatus;

import java.util.UUID;

public record SubmissionProcessedEvent(
        EventMetadata metadata,
        UUID submissionId,
        UUID reporterUserId,
        SubmissionStatus status,
        UUID hazardId,
        String failureReason
) {
}
