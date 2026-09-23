package com.saferoute.backend.websocket;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.saferoute.backend.submission.SubmissionStatus;

import java.util.UUID;

/** Sent only to the submitting user's sessions so the client can reconcile its temporary pin. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SubmissionProcessedFrame(String type, UUID submissionId, SubmissionStatus status, UUID hazardId, String message) {

    public SubmissionProcessedFrame(UUID submissionId, SubmissionStatus status, UUID hazardId, String message) {
        this("submission_processed", submissionId, status, hazardId, message);
    }
}
