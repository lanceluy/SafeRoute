package com.saferoute.backend.submission.dto;

import com.saferoute.backend.hazard.HazardType;
import com.saferoute.backend.submission.HazardSubmission;
import com.saferoute.backend.submission.SubmissionStatus;

import java.time.Instant;
import java.util.UUID;

public record HazardSubmissionResponse(
        UUID submissionId,
        SubmissionStatus status,
        /** The canonical hazard once processed (CREATED or MERGED); null while queued. */
        UUID hazardId,
        HazardType submittedType,
        double latitude,
        double longitude,
        String failureReason,
        Instant createdAt,
        Instant processedAt
) {
    public static HazardSubmissionResponse from(HazardSubmission s) {
        return new HazardSubmissionResponse(s.getId(), s.getProcessingStatus(), s.getCanonicalHazardId(),
                s.getSubmittedType(), s.getLatitude(), s.getLongitude(), s.getFailureReason(),
                s.getCreatedAt(), s.getProcessedAt());
    }
}
